# LLM No Magic · Just Tokens and Conventions

> 繁體中文版: [README.md](./README.md)

A 6-tab visualization tool that makes LLM internals visible: tokens, probabilities, chat templates, Agent flow, Skill progressive disclosure, and MCP — layer by layer.

Runs entirely local on your Mac — `llama.cpp` + Qwen3 GGUF models.

---

## Quick start (Mac)

No manual install, no terminal needed first. Open the **Claude desktop app**, switch to the **Code** tab in the left sidebar, start a new session, and paste:

```
Please download: https://github.com/NatChung/llm-no-magic, and start this tutorial.
```

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
