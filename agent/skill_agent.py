"""Skill simulator — Tab ⑦ preview, faithful to Claude Code's 3-layer
progressive disclosure pattern.

Layers (per https://platform.claude.com/docs/zh-TW/agents-and-tools/agent-skills/overview):
  L1 metadata — SKILL.md frontmatter (`name` + `description`), always in
                system prompt. ~100 tokens per skill.
  L2 instructions — SKILL.md body, loaded on demand. <5k tokens.
  L3 resources & code — extra .md references + bundled scripts/. Loaded
                or executed on demand. Scripts emit output only; code
                itself never enters context.

Skill structure on disk:
    skills/{name}/
        SKILL.md              ← L1 frontmatter + L2 body
        scripts/*.py          ← L3 executable code
        REFERENCE.md (etc)    ← L3 additional .md instructions

Modes:
  - "naive":  ALL skill bodies + L3 contents pre-loaded into the system
              prompt at startup. No lazy loading. Token cost balloons.
  - "proper": only L1 metadata pre-loaded. Model uses load_skill /
              read_skill_file / run_skill_script to bring L2 + L3 in on
              demand.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

import requests

LLAMA_URL = "http://localhost:8080/v1/chat/completions"
SKILLS_DIR = Path(__file__).parent / "skills"
MAX_TURNS = 8


# ── tool specs (always-exposed in proper mode) ───────────────────────
LOAD_SKILL_TOOL = {
    "type": "function",
    "function": {
        "name": "load_skill",
        "description": (
            "Load the L2 SKILL.md body (instructions) for a named skill "
            "into the conversation context. ALWAYS load the relevant "
            "skill before attempting downstream work."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Skill name from the index"}
            },
            "required": ["name"],
        },
    },
}

READ_SKILL_FILE_TOOL = {
    "type": "function",
    "function": {
        "name": "read_skill_file",
        "description": (
            "Read an L3 reference file bundled with a skill (e.g. "
            "REFERENCE.md, FORMS.md). Only use when the SKILL.md body "
            "tells you to."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "skill": {"type": "string", "description": "Skill name"},
                "filename": {"type": "string", "description": "Filename inside the skill dir (e.g. REFERENCE.md)"},
            },
            "required": ["skill", "filename"],
        },
    },
}

RUN_SKILL_SCRIPT_TOOL = {
    "type": "function",
    "function": {
        "name": "run_skill_script",
        "description": (
            "Execute an L3 bundled script and return its output. The "
            "script's code never enters the conversation context — only "
            "its stdout. Use this when SKILL.md body tells you to."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "skill": {"type": "string"},
                "script": {"type": "string", "description": "Filename inside the skill's scripts/ dir (e.g. organize.py)"},
                "args": {"type": "string", "description": "Single-string argument(s) passed to the script after the filename"},
            },
            "required": ["skill", "script"],
        },
    },
}


# ── skill loading ────────────────────────────────────────────────────
def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Parse the leading YAML-ish frontmatter (--- delimited) from SKILL.md.

    Returns (meta_dict, body_text). Minimal parser: handles key: value lines
    only (no nested structures, sufficient for the Claude Code spec).
    """
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)", text, re.DOTALL)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        meta[k.strip()] = v.strip()
    return meta, m.group(2)


def load_index() -> dict:
    """Return dict[name -> {name, description, dir, files}].

    Walks skills/, finds dirs containing SKILL.md, parses frontmatter.
    L1-only — never loads L2 body or L3 contents.
    """
    index = {}
    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        meta, _ = parse_frontmatter(skill_md.read_text())
        if "name" not in meta:
            continue
        # also surface L3 files (just listing, not content)
        extras = [f.name for f in skill_dir.iterdir() if f.is_file() and f.name != "SKILL.md"]
        scripts_dir = skill_dir / "scripts"
        scripts = [s.name for s in scripts_dir.iterdir() if s.is_file()] if scripts_dir.exists() else []
        index[meta["name"]] = {
            "name": meta["name"],
            "description": meta.get("description", ""),
            "dir": str(skill_dir.relative_to(SKILLS_DIR.parent)),
            "extras": extras,
            "scripts": scripts,
        }
    return index


def load_skill_body(name: str) -> str | None:
    skill_md = SKILLS_DIR / name / "SKILL.md"
    if not skill_md.exists():
        return None
    _, body = parse_frontmatter(skill_md.read_text())
    return body.strip()


def read_skill_file(skill: str, filename: str) -> str | None:
    """Read an L3 reference file (markdown) from a skill's directory."""
    if "/" in filename or filename.startswith(".."):
        return None
    p = SKILLS_DIR / skill / filename
    if not p.exists() or not p.is_file():
        return None
    return p.read_text()


def run_skill_script(skill: str, script: str, args: str = "") -> str:
    """Execute an L3 script and return its stdout (+ stderr if non-empty).

    Code itself is never returned — only output. Models the real Claude
    Code behaviour where bundled scripts run via bash.
    """
    if "/" in script or script.startswith(".."):
        return f"ERROR: invalid script name '{script}'"
    p = SKILLS_DIR / skill / "scripts" / script
    if not p.exists() or not p.is_file():
        return f"ERROR: script '{script}' not found in skill '{skill}'"
    cmd = [sys.executable, str(p)]
    if args:
        cmd.extend(args.split())
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        out = proc.stdout.strip()
        err = proc.stderr.strip()
        if proc.returncode != 0 and err:
            return f"(script exit {proc.returncode})\nSTDOUT:\n{out}\nSTDERR:\n{err}"
        return out or "(no output)"
    except subprocess.TimeoutExpired:
        return "ERROR: script timeout (>15s)"
    except Exception as exc:
        return f"ERROR: {type(exc).__name__}: {exc}"


# ── system prompt builders ───────────────────────────────────────────
def proper_system_prompt(index: dict) -> str:
    lines = [
        "You are an agent. Skills listed below give you specialised capabilities.",
        "",
        "**Three-layer progressive disclosure** (the lazy-load contract):",
        "  L1 metadata — the entries you see below; always in context",
        "  L2 SKILL.md body — load on demand via `load_skill(name=...)`",
        "  L3 resources & scripts — read additional .md via `read_skill_file(skill, file)`, "
        "execute bundled scripts via `run_skill_script(skill, script, args)`",
        "",
        "Rules:",
        "- If a skill applies, ALWAYS `load_skill` first; never improvise.",
        "- Follow the loaded SKILL.md body strictly (formats, rules, etc).",
        "- If SKILL.md tells you to read a REFERENCE.md or run a script, do that next.",
        "- If no skill matches, answer the user directly.",
        "",
        "## Skill index (L1)",
        "",
    ]
    for name, meta in index.items():
        lines.append(f"- **{name}** ({meta['dir']}/): {meta['description']}")
        if meta.get("extras"):
            lines.append(f"  - L3 docs: {', '.join(meta['extras'])}")
        if meta.get("scripts"):
            lines.append(f"  - L3 scripts: {', '.join(meta['scripts'])}")
    return "\n".join(lines)


def no_skills_system_prompt() -> str:
    """No skills at all — what the model produces from its own knowledge.

    Pedagogical contrast: shows that without L1 skill index in the system
    prompt, the model has no way to know skills exist, can't demand
    load_skill, and just answers naively (often wrong for tasks that
    need real-time data or specific tooling).
    """
    return (
        "You are a helpful assistant. Answer the user's question directly "
        "using your own knowledge."
    )


def naive_system_prompt(index: dict) -> str:
    """Naive mode: pre-load EVERYTHING into the system prompt.

    Shows the token-explosion problem that progressive disclosure solves.
    """
    lines = [
        "You are an agent. All skill knowledge is pre-loaded below — use any of it as needed.",
        "",
        "## All skills (pre-loaded, no lazy disclosure)",
        "",
    ]
    for name, meta in index.items():
        lines.append(f"### Skill: {name}")
        lines.append(f"Description: {meta['description']}")
        # L2 body
        body = load_skill_body(name) or ""
        lines.append("\n#### SKILL.md body:\n" + body)
        # L3 extras
        for extra in meta.get("extras", []):
            content = read_skill_file(name, extra) or ""
            lines.append(f"\n#### {extra}:\n" + content)
        # L3 scripts (in naive mode we even dump source — illustrating the cost)
        for script in meta.get("scripts", []):
            p = SKILLS_DIR / name / "scripts" / script
            try:
                code = p.read_text()
            except Exception:
                code = "(unreadable)"
            lines.append(f"\n#### scripts/{script}:\n```python\n{code}\n```")
        lines.append("")
    lines.append("(Note: this naive layout dumps everything up front — token cost balloons. "
                 "Toggle to Proper to see lazy disclosure.)")
    return "\n".join(lines)


# ── main agent loop ──────────────────────────────────────────────────
def skill_agent_loop(user_query, mode):
    """Run agent. mode in {'naive','proper'}. Yields SSE events."""
    index = load_index()
    if mode == "proper":
        system_prompt = proper_system_prompt(index)
    elif mode == "no_skills":
        system_prompt = no_skills_system_prompt()
        index = {}  # don't surface any skills to UI either
    else:  # "naive" — deprecated, kept for backend testing
        system_prompt = naive_system_prompt(index)

    # estimate tokens (rough char/4 approx) — compute both modes so the
    # frontend can show the contrast without a toggle
    sys_token_est = len(system_prompt) // 4
    proper_tokens_est = len(proper_system_prompt(index)) // 4
    naive_tokens_est = len(naive_system_prompt(index)) // 4

    # bundle script source code so the human (not model) can inspect L3
    # — pedagogical point: "you can see this; the model never does"
    script_sources = {}
    for name, m in index.items():
        for script in m.get("scripts", []):
            p = SKILLS_DIR / name / "scripts" / script
            try:
                script_sources[f"{name}/{script}"] = p.read_text()
            except Exception:
                script_sources[f"{name}/{script}"] = "(unreadable)"

    yield {
        "type": "index",
        "mode": mode,
        "skills": [
            {
                "name": n,
                "description": m["description"],
                "dir": m["dir"],
                "extras": m.get("extras", []),
                "scripts": m.get("scripts", []),
            }
            for n, m in index.items()
        ],
        "system_prompt": system_prompt,
        "system_prompt_tokens_est": sys_token_est,
        "proper_tokens_est": proper_tokens_est,
        "naive_tokens_est": naive_tokens_est,
        "script_sources": script_sources,
    }

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_query},
    ]

    # tool exposure
    if mode == "proper":
        active_tools = [LOAD_SKILL_TOOL, READ_SKILL_FILE_TOOL, RUN_SKILL_SCRIPT_TOOL]
    else:
        # no_skills + naive: no fetch tools needed
        active_tools = []

    yield {
        "type": "tools_exposed",
        "turn": 0,
        "tools": [t["function"]["name"] for t in active_tools],
    }

    for turn in range(1, MAX_TURNS + 1):
        req_body = {
            "model": "any",
            "messages": messages,
            "temperature": 0.3,
        }
        if active_tools:
            req_body["tools"] = active_tools
            req_body["tool_choice"] = "auto"

        # surface what is being sent to the model — reader sees the
        # accumulated messages + active tools for this turn (Tab ④ pattern)
        yield {
            "type": "sent",
            "turn": turn,
            "messages": messages,
            "tools": [t["function"]["name"] for t in active_tools],
        }

        try:
            resp = requests.post(LLAMA_URL, json=req_body, timeout=60).json()
        except Exception as exc:
            yield {"type": "error", "message": f"{type(exc).__name__}: {exc}"}
            return

        # surface the raw model response (full json from llama-server)
        yield {
            "type": "received",
            "turn": turn,
            "response": resp,
        }

        msg = resp["choices"][0]["message"]
        content = msg.get("content") or ""
        tool_calls = msg.get("tool_calls", []) or []

        yield {
            "type": "turn",
            "turn": turn,
            "content": content,
            "tool_calls": [
                {"id": tc["id"], "name": tc["function"]["name"], "args": tc["function"]["arguments"]}
                for tc in tool_calls
            ],
        }

        if not tool_calls:
            yield {"type": "final", "content": content}
            return

        messages.append(msg)

        for tc in tool_calls:
            name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"])
            except Exception:
                args = {}

            if name == "load_skill":
                skill_name = args.get("name", "")
                body = load_skill_body(skill_name)
                if body is not None:
                    result = (
                        f"=== L2 SKILL.md body for '{skill_name}' (loaded into context) ===\n\n"
                        f"{body}\n\n"
                        f"=== NEXT ACTION ===\nNow follow the body's instructions to complete the user's original request. "
                        f"If the body says to run a script, call `run_skill_script` now. "
                        f"If it says to read a reference file, call `read_skill_file` now. "
                        f"Do not stop here — continue until you have a final answer for the user."
                    )
                    yield {
                        "type": "skill_loaded",
                        "name": skill_name,
                        "body": body,
                        "layer": "L2",
                    }
                else:
                    result = f"ERROR: skill '{skill_name}' not found"
                    yield {"type": "tool_result", "name": name, "result": result, "error": True}
            elif name == "read_skill_file":
                skill = args.get("skill", "")
                fname = args.get("filename", "")
                content_out = read_skill_file(skill, fname)
                if content_out is not None:
                    result = f"=== L3 file '{fname}' from skill '{skill}' ===\n\n{content_out}"
                    yield {
                        "type": "l3_loaded",
                        "skill": skill,
                        "filename": fname,
                        "kind": "reference",
                        "content": content_out,
                    }
                else:
                    result = f"ERROR: file '{fname}' not found in skill '{skill}'"
                    yield {"type": "tool_result", "name": name, "result": result, "error": True}
            elif name == "run_skill_script":
                skill = args.get("skill", "")
                script = args.get("script", "")
                script_args = args.get("args", "")
                output = run_skill_script(skill, script, script_args)
                result = f"=== L3 script output (code itself NOT in context) ===\n\n{output}"
                yield {
                    "type": "l3_loaded",
                    "skill": skill,
                    "filename": f"scripts/{script}",
                    "kind": "script_output",
                    "content": output,
                    "args": script_args,
                }
            else:
                result = f"ERROR: unknown tool '{name}'"
                yield {"type": "tool_result", "name": name, "result": result, "error": True}

            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})

        if mode == "proper":
            yield {
                "type": "tools_exposed",
                "turn": turn,
                "tools": [t["function"]["name"] for t in active_tools],
            }

    yield {"type": "error", "message": f"max_turns ({MAX_TURNS}) reached"}
