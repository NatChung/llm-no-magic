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
   printed `fix:` lines. Teaching needs **Node/npx + a browser MCP** (Playwright MCP,
   shipped as `.mcp.json` / `.codex/config.toml`); `python3 init.py --fix` restores the
   config and installs pip-class deps. (pip `playwright` is only for the creator's
   `--smoke` regression harness — a `WARN creator:` line is fine to ignore as a student.)
2. Approve the browser MCP once: Claude Code shows `⏸ Pending approval` (run `/mcp`,
   approve `playwright`); Codex asks to trust the folder on first launch (answer yes).
3. Make sure the server is up (init.py's Port 9000 line — or start it:
   `nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`).
4. Open `teaching/README.md` (zh-TW: `teaching/README.zh-TW.md`) and follow it. **You (the
   AI) drive the page via the browser MCP** — open http://localhost:9000/ yourself, run the
   lesson playbook, and **leave the browser open** for the student to try. Do NOT ask the
   student to open their own browser; do NOT fall back to running the Python demo scripts as
   the student-facing demo (those are the creator's regression harness now).

### Division of labour (tell the student this)

The **web page is the instrument** — the student watches it to see the numbers move (tokens,
probability bars, turn traces, results). **You are the narration** — all explanation comes
from you; do not read the page's own text aloud. Say it plainly: "watch the screen, listen
to me." Point them at a `(?)` dropdown only if they want the written version.

### Driving the page via MCP — how to wait / handle failure

- **Model swap:** clicking a tab triggers a 0.6B↔4B swap. The page shows a visible
  "loading model" banner — re-take an accessibility snapshot until that banner text is gone
  before continuing (first swap ~3–5 s, longer for 4B). Tell the student to wait.
- **Generation done:** the "送出/Send" button is disabled during generation and re-enables
  when done (visible in the a11y snapshot as a disabled→enabled state); the probability
  numbers appear in the snapshot text after you click a token — read them directly.
- **Swap failure:** a failed swap raises a JS dialog "Model swap failed…". Handle the
  dialog (read + dismiss) and tell the student in plain words it failed, then follow
  Troubleshooting (port 8080). Don't get stuck waiting on a selector that won't appear.

## Troubleshooting

- `Model swap failed: port 8080 still busy` → another process owns :8080. Find it with
  `lsof -nP -iTCP:8080 -sTCP:LISTEN`, stop it, retry (init.py also detects this).
- Server not up / page won't load → start it (command above), log at
  `/tmp/agent-server.log`.
- A lesson step won't progress → re-snapshot to see the current page state. If a swap
  banner is stuck >15 s, the model swap likely failed (see port 8080 above); narrate the
  failure to the student rather than retrying blindly.
- First switch into a tab shows a "loading model" banner for 3–5 s — that's the
  0.6B↔4B swap, normal.
