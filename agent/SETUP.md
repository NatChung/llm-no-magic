# V2 Agent stack setup

> 繁體中文版: [SETUP.zh-TW.md](./SETUP.zh-TW.md)

Verified 2026-05-29. **Two-port setup** — one Python server on `:9000` serves HTML + API + SSE; `llama-server` on `:8080` runs the model (0.6B or 4B, swapped by `/swap`). Backend `:8082` from earlier architectures has been merged into `:9000`.

| Port | Purpose | When it runs |
|------|---------|--------------|
| **:8080** | llama-server (0.6B or 4B, controlled by `/swap`) | auto-managed |
| **:9000** | unified server (static HTML + API endpoints) | always |

- **Launch server**: `cd ~/projects/llm-no-magic && nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`
- **No need to launch llama manually.** On startup, `_detect_model()` probes `:8080`; if nothing is there, the first tab click triggers `/swap`, which launches it (with `--host $LISTEN_HOST` propagated).
- **Model source** (if the GGUF is missing): `hf download Qwen/Qwen3-4B-GGUF Qwen3-4B-Q4_K_M.gguf --local-dir ~/models` (same syntax for the 0.6B, just swap the name).
- **Endpoints**: `/`, `/index.zh-TW.html`, `/app.js`, `/styles.css` (static) + `/agent`, `/skill-agent`, `/swap`, `/preview` (API) — all on `:9000`. Legacy `/frontend/*` URLs 301-redirect to `/*`. The direct llama endpoint is `http://localhost:8080/v1/chat/completions` (only the CLI `agent.py` talks to it directly).
- **Function calling**: relies on the 4B (the 0.6B is unstable). Switching to Tab ④/⑥ in the frontend triggers a swap to 4B.
- **GPU footprint**: ~3GB max — only one model is on the GPU at a time. During a swap, the old process is killed and the new one launches in ~5s.

## Classroom LAN demo

Students on the same WiFi can join your Mac without each running their own stack:

```bash
LISTEN_HOST=0.0.0.0 nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
# Students open http://<your-mac-LAN-ip>:9000/  (find IP via `ipconfig getifaddr en0`)
# llama-server is auto-launched with --host 0.0.0.0 (propagated from LISTEN_HOST)
# First connection: macOS firewall may prompt to allow Python / llama-server inbound — accept
```

Caveat: GPU only holds one model at a time. If multiple students switch tabs to different models simultaneously, they will compete (swap-banner thrash). For trainer-led demo this isn't an issue.

## History (reference only)

From 2026-05-26 PM to 2026-05-27 AM we ran dual-port (`:8080` 0.6B + `:8081` 4B) to avoid swap risk, but running both at once on an 18GB Mac caused occasional Ghostty GPU warnings. The auto-swap orchestrator shipped 2026-05-27 PM and `:8081` was retired.

## Verification output

```
tool_calls: [{'type': 'function', 'function': {'name': 'get_time', 'arguments': '{}'}, 'id': 'yYrxTrxpQ7aXZfBvF9Zk3DuI7NmXgTZs'}]
```

## End-to-end smoke (2026-05-26)

Ran `python3 -m agent.smoke` × 3 full runs (3 sub-runs each demo).
Log: `/tmp/smoke-3runs.log`

### Results

| Demo | Runs | Pass | Notes |
|------|------|------|-------|
| Demo 1 · get_time · `現在幾點?` | 3×3 | 9/9 | tool_call=get_time, time in result + final content |
| Demo 2 · read+write · prompts.md → Desktop | 3×3 | 9/9 | read_file + write_file; ~/Desktop/llm-summary.md written with 3-point summary (624 bytes) |
| Demo 3a · exec_bash count · `.md 檔數` | 3×3 | 9/9 | exec_bash `find . -type f -name "*.md" | wc -l` → 30 |
| Demo 3b · exec_bash find · Desktop >10MB | 3×3 | 9/9 | exec_bash `find ~/Desktop -size +10M` → empty (no large files, which is correct) |
| Edge · no-tool · `你好` | 3×1 | 3/3 | assistant replied directly, no tool_calls |

### Bug fixed during smoke

`write_file` / `read_file` in `agent.py` did not call `Path.expanduser()` — writing to `~/Desktop/...` raised `FileNotFoundError` on the literal `~` path. Fixed: added `.expanduser()` + `parent.mkdir(parents=True, exist_ok=True)`.

### Concerns / Observations

- One run-2 v1 attempt hit a 60s ReadTimeout on llama-server (model under sustained load from back-to-back runs). Fixed in `smoke.py` with per-run `try/except` so one timeout does not abort the entire suite.
- The model sometimes calls `write_file` multiple times per Demo 2 turn (retries after error) before getting the path right — still counts as PASS because the final write succeeds.

### `say` Mandarin voice test

`say "你好,我是你的電腦"` — command ran successfully (exit 0). **Human verification needed**: the macOS default Mandarin voices (Ting-Ting / Mei-Jia) tend to sound robotic. For the Phase 0 demo, prefer `say -v Mei-Jia "..."` for the best available quality.

## Unified server (:9000) — serves HTML + API in one process

**Launch command** (from repo root):
```bash
cd ~/projects/llm-no-magic
nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
```

**cwd must be the repo root** — the relative paths in Tab ④ Agent presets 2/3 (`prompts.md`, `course/`) are resolved from the repo root. Don't launch from `agent/`.

**Verify:**
```bash
curl -s http://localhost:9000/ | grep -q "LLM, no magic" && echo "9000 ✓ HTML"
curl -s -X OPTIONS http://localhost:9000/agent | grep -q "204" || curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/agent
```

**Port summary:**

| Port | Service | When it runs |
|------|---------|--------------|
| :9000 | unified server: HTML + API endpoints (server.py) | always |
| :8080 | llama-server (0.6B or 4B, swappable) | always (controlled by `/swap`) |

Full Tab ④ flow: browser → `:9000` HTML/JS → fetch `/agent` (same origin) → `:8080` llama-server (0.6B by default, `/swap` to 4B).

## Fri AM 30-second pre-class check

```bash
# 1. Both ports up?
curl -s http://localhost:9000/ | grep -q "LLM, no magic" && echo "9000 ✓ server (HTML+API)"
curl -s http://localhost:8080/v1/models | grep -qE "Qwen3-0\.6B|Qwen3-4B" && echo "8080 ✓ llama"

# 2. Start whichever is missing
# (server) cd ~/projects/llm-no-magic && nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
# (llama)  No need to start manually. server.py detects whether :8080 is alive on startup;
#          if not, it waits for a tab click in the frontend to auto-swap one in.
```

## Fri AM fallback if things break

If the backend or Tab ④ misbehaves in class:
- **Fall back to CLI `agent.py`**: first confirm 4B is on `:8080` (`curl -s http://localhost:8080/v1/models | grep -q "Qwen3-4B"`); if not, swap first: `curl -X POST http://localhost:9000/swap -H "Content-Type: application/json" -d '{"model":"4B"}'`. Then run `python3 -m agent.agent`.
- **Manually swap to 0.6B** (if the backend is down but the frontend can still demo): `pkill -f llama-server` && `nohup llama-server -m ~/models/Qwen3-0.6B-Q4_K_M.gguf --port 8080 -ngl 99 > /tmp/llama-0.6b.log 2>&1 &`
- **Manually swap to 4B**: same as above but swap the model file to `Qwen3-4B-Q4_K_M.gguf`.
