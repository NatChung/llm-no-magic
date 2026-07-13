"""Skill simulator — Tab ⑤ preview, faithful to Claude Code's 3-layer
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
  - "proper": only L1 metadata pre-loaded. Model uses the generic
              read_file / run_script tools to bring L2 + L3 in on
              demand (the Anthropic Agent Skills shape: no bespoke
              skill tools, just filesystem + convention).
"""

import json
import re
import subprocess
import sys
from pathlib import Path

import requests

LLAMA_URL = "http://localhost:8080/v1/chat/completions"
LLAMA_TEMPLATE_URL = LLAMA_URL.replace("/v1/chat/completions", "/apply-template")
SKILLS_DIR = Path(__file__).parent / "skills"
MAX_TURNS = 8


# ── tool specs (always-exposed in proper mode) ───────────────────────
# 正規做法(Anthropic Agent Skills):不做專用 skill 工具,agent 用通用的
# 檔案工具讀 SKILL.md、跑腳本 — skill 只是「檔案結構 + 慣例」。
READ_FILE_TOOL = {
    "type": "function",
    "function": {
        "name": "read_file",
        "description": (
            "讀取磁碟上的檔案,回傳原始內容。skill 的說明書(SKILL.md)"
            "和參考檔都用這支工具讀。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "檔案路徑(例如 skills/check_weather/SKILL.md)"},
            },
            "required": ["path"],
        },
    },
}

RUN_SCRIPT_TOOL = {
    "type": "function",
    "function": {
        "name": "run_script",
        "description": (
            "執行一個腳本並回傳輸出。腳本的程式碼不會進入對話 context — "
            "只有 stdout 會。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "腳本路徑(例如 skills/check_weather/scripts/weather.py)"},
                "args": {"type": "string", "description": "接在腳本後的單一字串參數"},
            },
            "required": ["path"],
        },
    },
}


def _resolve_skill_path(path: str):
    """把 model 給的路徑解析到 skills/ 底下;越界回 None(安全與教學都單純)。"""
    p = (SKILLS_DIR.parent / path).resolve()
    try:
        p.relative_to(SKILLS_DIR.resolve())
    except ValueError:
        return None
    return p


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


def skill_anatomy() -> list[dict]:
    """Anatomy card data (spec 2026-07-08 §2): the on-disk three layers.

    SKILL.md is deliberately split into two entries — the pedagogical point
    is that ONE file carries L1 (frontmatter) and L2 (body).
    """
    files = []
    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        skill_md = skill_dir / "SKILL.md"
        if not skill_dir.is_dir() or not skill_md.exists():
            continue
        text = skill_md.read_text()
        m = re.match(r"^(---\s*\n.*?\n---\s*\n)(.*)", text, re.DOTALL)
        fm, body = (m.group(1), m.group(2)) if m else ("", text)
        rel = str(skill_dir.relative_to(SKILLS_DIR.parent))
        files.append({"path": f"{rel}/SKILL.md#frontmatter", "layer": "L1", "content": fm.strip()})
        files.append({"path": f"{rel}/SKILL.md#body", "layer": "L2", "content": body.strip()})
        scripts_dir = skill_dir / "scripts"
        if scripts_dir.exists():
            for s in sorted(scripts_dir.iterdir()):
                if s.is_file():
                    files.append({"path": f"{rel}/scripts/{s.name}", "layer": "L3",
                                  "content": s.read_text()})
    return files


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
        "你是一個 agent,有兩支通用工具:`read_file`(讀檔案)、`run_script`(跑腳本)。",
        "下方是 skill 索引(L1)— 每包 skill 的說明書和腳本都在磁碟上,要用就自己拿。",
        "",
        "規則:",
        "- 有 skill 適用時,先用 `read_file` 讀它的 SKILL.md,再嚴格照裡面的指示做。",
        "- 沒有 skill 適用時,直接回答 user。",
        "",
        "## Skill 索引(L1)",
        "",
    ]
    for name, meta in index.items():
        lines.append(f"- **{name}**:{meta['description']}")
        lines.append(f"  - 說明書:{meta['dir']}/SKILL.md")
        for extra in meta.get("extras", []):
            lines.append(f"  - 參考檔:{meta['dir']}/{extra}")
        for script in meta.get("scripts", []):
            lines.append(f"  - 腳本:{meta['dir']}/scripts/{script}")
    return "\n".join(lines)


def no_skills_system_prompt() -> str:
    """No skills at all — what the model produces from its own knowledge.

    Pedagogical contrast: shows that without L1 skill index in the system
    prompt, the model has no way to know skills exist, can't demand
    load_skill, and just answers naively (often wrong for tasks that
    need real-time data or specific tooling).
    """
    return "你是一個樂於助人的助理。直接用你自己的知識回答 user 的問題。"


def naive_system_prompt(index: dict) -> str:
    """Naive mode: pre-load EVERYTHING into the system prompt.

    Shows the token-explosion problem that progressive disclosure solves.
    """
    lines = [
        "你是一個 agent。所有 skill 知識已全部預載在下方 — 需要就直接用。",
        "",
        "## 所有 skill(全部預載、沒有漸進式載入)",
        "",
    ]
    for name, meta in index.items():
        lines.append(f"### Skill: {name}")
        lines.append(f"說明:{meta['description']}")
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
    lines.append("(注意:naive 排法把所有東西一次全塞進來 — token 成本爆炸。"
                 "切回 Proper 看漸進式載入。)")
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
        active_tools = [READ_FILE_TOOL, RUN_SCRIPT_TOOL]
    else:
        # no_skills + naive: no fetch tools needed
        active_tools = []

    yield {
        "type": "tools_exposed",
        "turn": 0,
        "tools": [t["function"]["name"] for t in active_tools],
    }

    empty_final_retry = 1   # 空回應護欄:見下方 not tool_calls 分支
    for turn in range(1, MAX_TURNS + 1):
        req_body = {
            "model": "any",
            "messages": messages,
            "temperature": 0.3,
            # 同 tab4 agent_loop:壓掉 Qwen3 thinking — 中文輸入特別容易觸發
            # <think>,token 全花在思考、content 變空(空 final 偶發的主因)
            "chat_template_kwargs": {"enable_thinking": False},
        }
        if active_tools:
            req_body["tools"] = active_tools
            req_body["tool_choice"] = "auto"

        # 顯示用的 templated prompt —— 跟 tab④ 一致,讓三個 tab 同格式。
        # ⚠️ 不傳 chat_template_kwargs:傳 enable_thinking:false 會讓 Qwen3 把
        # <think></think> 塞進結尾生成提示 assistant,結尾就不再是空 body,前端
        # 的 highlight(_lastContentfulIndex)會落到錯的訊息上。
        tpl_payload = {"messages": messages, "add_generation_prompt": True}
        if active_tools:
            tpl_payload["tools"] = active_tools
        try:
            tpl = requests.post(LLAMA_TEMPLATE_URL, json=tpl_payload, timeout=5)
            tpl.raise_for_status()
            sent_prompt = tpl.json().get("prompt", "")
        except Exception as exc:
            sent_prompt = f"[template error] {type(exc).__name__}: {exc}"

        # surface what is being sent to the model — reader sees the
        # accumulated messages + active tools for this turn (Tab ④ pattern)
        yield {
            "type": "sent",
            "turn": turn,
            "messages": messages,
            "tools": [t["function"]["name"] for t in active_tools],
            "sent_prompt": sent_prompt,
        }

        try:
            resp = requests.post(LLAMA_URL, json=req_body, timeout=60).json()
        except Exception as exc:
            yield {"type": "error", "message": f"{type(exc).__name__}: {exc}"}
            return

        msg = resp["choices"][0]["message"]
        usage_raw = resp.get("usage") or {}
        usage = {"prompt_tokens": usage_raw.get("prompt_tokens"),
                 "completion_tokens": usage_raw.get("completion_tokens")}

        # surface the model response — trimmed to the assistant message +
        # usage (the full llama json bloats every relay frame; the UI's
        # ▸ expander only needs these two)
        yield {
            "type": "received",
            "turn": turn,
            "response": {"message": msg, "usage": usage},
        }

        content = msg.get("content") or ""
        tool_calls = msg.get("tool_calls", []) or []

        yield {
            "type": "turn",
            "turn": turn,
            "content": content,
            "usage": usage,
            "tool_calls": [
                {"id": tc["id"], "name": tc["function"]["name"], "args": tc["function"]["arguments"]}
                for tc in tool_calls
            ],
        }

        if not tool_calls:
            if not content.strip() and empty_final_retry > 0:
                # 4B 偶發:L2 注入後直接吐空字串(無 tool call、無內容)。
                # 不把空訊息塞進 messages,原樣重問一次 — 教學 demo 斷在
                # 這裡比多花一個 turn 更傷。
                empty_final_retry -= 1
                continue
            yield {"type": "final", "content": content}
            return

        messages.append(msg)

        for tc in tool_calls:
            name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"])
            except Exception:
                args = {}

            if name == "read_file":
                path = args.get("path", "")
                p = _resolve_skill_path(path)
                if p is None or not p.is_file():
                    result = f"ERROR: 檔案 '{path}' 不存在(這個 demo 只能讀 skills/ 底下的檔案)"
                    yield {"type": "tool_result", "name": name, "result": result, "error": True}
                elif p.name == "SKILL.md":
                    # 讀到說明書 = L2 注入的瞬間(read_file 回傳原始檔案內容,
                    # 沒有任何加工 — skill 沒有魔法)
                    text = p.read_text()
                    skill_name = p.parent.name
                    result = (
                        f"=== {path}(原樣讀出,已進入 context)===\n\n{text}\n\n"
                        f"=== 下一步 ===\n照上面說明書的指示完成 user 原本的請求;"
                        f"說明書說要跑腳本,就立刻用 `run_script`。"
                        f"不要停在這裡 — 一直做到給出最終回答為止。"
                    )
                    yield {
                        "type": "skill_loaded",
                        "name": skill_name,
                        "body": text,
                        "layer": "L2",
                    }
                else:
                    text = p.read_text()
                    skill_name = p.relative_to(SKILLS_DIR).parts[0]
                    result = f"=== {path} ===\n\n{text}"
                    yield {
                        "type": "l3_loaded",
                        "skill": skill_name,
                        "filename": p.name,
                        "kind": "reference",
                        "content": text,
                    }
            elif name == "run_script":
                path = args.get("path", "")
                script_args = args.get("args", "")
                p = _resolve_skill_path(path)
                if p is None or not p.is_file():
                    result = f"ERROR: 腳本 '{path}' 不存在(這個 demo 只能跑 skills/*/scripts/ 底下的腳本)"
                    yield {"type": "tool_result", "name": name, "result": result, "error": True}
                else:
                    skill_name = p.relative_to(SKILLS_DIR).parts[0]
                    output = run_skill_script(skill_name, p.name, script_args)
                    result = f"=== 腳本輸出(程式碼本身沒進 context)===\n\n{output}"
                    yield {
                        "type": "l3_loaded",
                        "skill": skill_name,
                        "filename": f"scripts/{p.name}",
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
