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
  file (`index.html`/`index.zh-TW.html`, `README.md` (zh-TW)/`README.en.md`, lessons).
  Bump the `?v=NN` cache-bust query in both HTML files whenever frontend files change.
- Start server: `nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`

## Student → teaching mode

1. Run `python3 init.py`. If the last line is not `READY*`, walk the user through the
   printed `fix:` lines. Teaching needs only an HTTP-capable AI (Claude Code / Codex,
   driving via Bash `curl`) plus a browser the student opens once — no Node, no MCP.
   `python3 init.py --fix` installs pip-class deps (no config written). (pip `playwright`
   is only for the creator's `--smoke` regression harness — a `WARN creator:` line is fine
   to ignore as a student.)
2. Make sure the server is up (init.py's Port 9000 line — or start it:
   `nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`).
3. Open `teaching/README.md` (zh-TW: `teaching/README.zh-TW.md`) and follow it. **You (the
   AI) drive the page via the relay**: `POST /drive` to run each action, and the page
   reflects live via its `/events` subscription. First `GET /health` to confirm
   `subscribers >= 1` (else ask the student to open http://localhost:9000/). Leave the
   browser open for the student to try. Do NOT fall back to running the Python demo scripts
   as the student-facing demo (those are the creator's regression harness now).

### Division of labour (tell the student this)

The **web page is the instrument** — the student watches it to see the numbers move (tokens,
probability bars, turn traces, results). **You are the narration** — all explanation comes
from you; do not read the page's own text aloud. Say it plainly: "watch the screen, listen
to me." Point them at a `(?)` dropdown only if they want the written version.

### Driving the page via the relay

- **Model swap:** driving a tab-4 action (or any model-changing tab) triggers a 0.6B↔4B
  swap inside `/drive`; the page shows a "loading model" banner (from the `swap_start`
  frame). The `/drive` call returns after generation completes — no snapshot-polling
  needed. Tell the student to wait if the call is slow (first swap ~3–5 s, longer for 4B).
- **Generation done:** `/drive` returns the aggregate (tokens/turns/final) when done; the
  page's Send button re-enables on the terminal `final` — read the aggregate directly
  instead of polling the page.
- **Swap failure:** a failed swap returns `/drive` 5xx `{error}` and the page shows the
  error and recovers (no freeze). Narrate the failure to the student in plain words, then
  follow Troubleshooting (port 8080).

## Troubleshooting

- `Model swap failed: port 8080 still busy` → another process owns :8080. Find it with
  `lsof -nP -iTCP:8080 -sTCP:LISTEN`, stop it, retry (init.py also detects this).
- Server not up / page won't load → start it (command above), log at
  `/tmp/agent-server.log`.
- A lesson step won't progress → check `GET /health` for the current state. If a swap
  banner is stuck >15 s, the model swap likely failed (see port 8080 above); narrate the
  failure to the student rather than retrying blindly.
- First switch into a tab shows a "loading model" banner for 3–5 s — that's the
  0.6B↔4B swap, normal.
