# LLM No Magic · Just Tokens and Conventions

> 繁體中文版: [README.md](./README.md)

A 6-tab visualization tool that makes LLM internals visible: tokens, probabilities, chat templates, Agent flow, Skill progressive disclosure, and MCP — layer by layer.

Runs entirely local on your Mac — `llama.cpp` + Qwen3 GGUF models.

---

## What you'll see

- **① Chaining** — Type something → watch the model emit tokens one at a time + the top-10 probability distribution at each step. Three Chinese example prompts (you type them into the input box) form a complete teaching arc: `床前明月光,疑是地上` (peaked — the model has this Tang poem memorized → completes `霜` at top-1 94%+), `祖樹星上最高的山叫做` (peaked, but **you made up** the star name — the model still confidently invents an answer → **peaked ≠ truth**), `他打開冰箱,拿出一包` (flat — top-1 barely above 10%, the model has no idea what to fill in). Together they show "confidence ≠ correctness" + "shape of the distribution reflects model certainty".
- **② Q&A** — Watch "how chaining becomes Q&A": send the same `一年有幾個月?` ("How many months in a year?") three ways — raw prompt (pure chaining, loops without answering), hand-typed "Q:/A:" (a plain text pattern alone flips it into answer mode, but it spirals into more questions), and the real Qwen3 chat template (swaps in reserved tokens like `<|im_start|>` whose boundary meaning was assigned during training, which is what gives a clean stop signal). The raw-vs-chat-template final prompt stays visible on screen (markers highlighted in blue), showing exactly what the product layer adds.
- **③ Reasoning** — Thinking on/off. Same question, direct answer vs writing a think block first (effect of reasoning on accuracy).
- **④ Agent** — Multi-turn function calling. The model emits `<tool_call>` tokens → client parses them → **actually executes** (`get_time`, reading the real system clock) → result goes back into the conversation → the model continues, until final.
- **⑤ Skill (preview)** — Send a query and watch the model decide, on its own, whether to load a skill and which one (3 presets: organize files → `organize_files`, Taipei weather → `check_weather`, `1+1` → no match, answers directly). Mirrors Claude Code's three-layer progressive disclosure: L1 metadata always in the system prompt, L2 `SKILL.md` body loaded on demand, L3 bundled scripts read but never enter context.
- **⑥ MCP** — A static article, no model interaction. Covers "how an AI picks/operates tools on its own when the toolset isn't fixed", using web-browsing as the example.

Tabs 1-3 let you click any token to see the top-10 distribution at that step (bar chart pops up). Tab ④ tokens aren't clickable — instead, expand the "Received / Sent again" details to see how the chat template text and conversation accumulate.

Each tab also has small `(?)` explainer drop-downs (System prompt, chat template, thinking mode, Agent, tool_call, turn) — click them to read inline definitions while you experiment.

---

## Quick start (Mac)

No manual install, no terminal needed first. Open the **Claude desktop app**, switch to the **Code** tab in the left sidebar, start a new session, and paste:

```
Please download: https://github.com/NatChung/llm-no-magic, and start this tutorial.
```

The AI grabs the repo, reads [AGENTS.md](./AGENTS.md), asks whether you're the teacher or a student, then:

- runs `python3 init.py` to check your environment (llama.cpp, models) and guides any
  installs — teaching only needs an HTTP-capable AI plus a browser you open once, no Node
  and no MCP required
- runs the course from [teaching/](./teaching/): the AI **drives the page over HTTP**
  (`POST /drive`) while the page reflects every action live via SSE (`/events`), narrating
  as it goes, and leaves it open for you to try
- you open the page once (http://localhost:9000/) and leave it up; from there you just watch, listen, and occasionally drive it yourself — the AI does the rest over HTTP

A terminal-based AI coding agent (Claude Code / Codex) works the same way — just `git clone` first:

```bash
git clone https://github.com/NatChung/llm-no-magic.git
cd llm-no-magic
```

Open Claude Code / Codex and say "hi".

**Dependencies** (the AI checks/installs these for you — listed here for reference):
`llama.cpp` (brew), `huggingface_hub` (`pip install -U "huggingface_hub[cli]"`),
Python 3.10+, `requests`. No npm, no build step.

---

## Code tour

- `frontend/index.html` + `index.zh-TW.html` + `app.js` + `styles.css` — Tailwind Play CDN (zero build), 6-tab UI (① Chaining / ② Q&A / ③ Reasoning / ④ Agent / ⑤ Skill / ⑥ MCP)
- `agent/server.py` — single-port stdlib http.server (no FastAPI): static frontend files + API endpoints (`/drive` `/inspect` `/stop` `/agent` `/skill-agent` `/preview` `/events` `/health`), swap orchestrator (`handle_swap`, called by `/drive`)
- `agent/agent.py` — CLI fallback REPL + 4 tools (`get_time` / `read_file` / `write_file` / `exec_bash`) + `dispatch_tool_call` + `AgentLoop`
- `agent/skill_agent.py` — Tab ⑤'s three-layer progressive disclosure simulator (lazy-loads `SKILL.md` body + bundled scripts/)
- `agent/skills/` — the two demo skills Tab ⑤ uses (`check_weather`, `organize_files`)
- `agent/tests/` — pytest suite (mocked subprocess + requests + socket; run with `pytest agent/tests -q`)
- `agent/SETUP.md` — port layout / Fri morning check / fallback ops notes
- `agent/smoke.py` — creator's playwright regression harness (`--smoke`)
- `prompts.md` — teaching prompt material (token-level demo inputs)

---

## About

This repo is the open-source version of LLM teaching material. Curriculum designed by [Nat Chung](https://github.com/NatChung); implementation done together with Claude Code (Anthropic). MIT licensed — free to fork, use commercially, remix, share for teaching.

Issues / PRs / forks welcome. Nat doesn't actively maintain but will read PRs.
