# AGENTS.md — read this first

> 中文對照:[AGENTS.zh-TW.md](./AGENTS.zh-TW.md)(same content, for human readers)

This repo is **"LLM, no magic"** — a hands-on, fully-local LLM teaching tool: a web UI
(tabs ⓪–⑧) served by a stdlib Python server on :9000, driving llama.cpp + Qwen3 GGUF
models on :8080. Tabs ①–④ are interactive (tokens/probabilities, chat template,
thinking mode, function-calling agent); ⑤–⑧ are articles.

**This repo supports AI-led teaching.** You (the AI agent) can run the course.

## Your first action — ask the user's role

Before anything else, ask:

> Are you the **creator/teacher** of this course (developing or maintaining it),
> or a **student** here to learn how LLMs work?

Then follow the matching mode below. Speak the user's language (zh-TW student →
use the `.zh-TW` files and reply in 繁體中文).

## Creator → development mode

- Architecture: `agent/server.py` (single-port stdlib server :9000 — static frontend
  + `/agent` `/skill-agent` `/swap` `/preview` APIs, auto-launches llama-server :8080),
  `frontend/app.js` (zero-build Tailwind Play CDN UI), `agent/agent.py` (CLI agent loop
  + 4 tools), `teaching/` (AI-led course material), `init.py` (env checker).
- Tests: `pytest agent/tests -q` (plain pytest functions + mocks; keep that style).
- Conventions: **bilingual** — every user-facing change lands in BOTH the EN and zh-TW
  file (`index.html`/`index.zh-TW.html`, `README.md`/`README.zh-TW.md`, lessons).
  Bump the `?v=NN` cache-bust query in both HTML files whenever frontend files change.
- Start server: `nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`

## Student → teaching mode

1. Run `python3 init.py`. If the last line is not `READY*`, walk the user through the
   printed `fix:` lines (`python3 init.py --fix` handles the pip ones). Teaching ALSO
   requires playwright — if the summary has `WARN teaching: playwright missing`,
   install it before continuing (`pip install playwright && playwright install chromium`).
2. Make sure the server is up (init.py's Port 9000 line reports it as running — or start
   it with the command above), then have the student open http://localhost:9000/ (zh-TW:
   http://localhost:9000/index.zh-TW.html).
3. Open `teaching/README.md` (zh-TW: `teaching/README.zh-TW.md`) and follow it. It
   defines the course arc (lesson 1→4), the teaching rules, and how to run the demo
   scripts in `teaching/demos/`.
4. Demos are **pre-written Playwright scripts** — always run them via
   `python3 teaching/demos/demo_tabN.py --segment K [--lang zh-TW]`. Do NOT drive the
   page with a live browser-automation MCP instead; the scripts are the demo.

## Troubleshooting

- `Model swap failed: port 8080 still busy` → another process owns :8080. Find it with
  `lsof -nP -iTCP:8080 -sTCP:LISTEN`, stop it, retry (init.py also detects this).
- Server not up / page won't load → start it (command above), log at
  `/tmp/agent-server.log`.
- A demo script fails fast → it prints a one-line reason (server down / model missing /
  model swap failed / selector not found). Fix per init.py, rerun the same segment.
- First switch into a tab shows a "loading model" banner for 3–5 s — that's the
  0.6B↔4B swap, normal.
