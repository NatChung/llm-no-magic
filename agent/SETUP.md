# V2 Agent stack setup

> 繁體中文版: [SETUP.zh-TW.md](./SETUP.zh-TW.md)

Verified 2026-05-27 PM. **Single-port auto-swap setup** — one model (0.6B or 4B) runs on `:8080`, and the backend swaps it via `/swap`. `:8081` has been retired (see the LLM auto-swap spec / plan in `docs/superpowers/{specs,plans}/2026-05-27-llm-auto-swap.md`).

| Port | Purpose | When it runs |
|------|---------|--------------|
| **:8080** | llama-server (0.6B or 4B, controlled by backend `/swap`) | auto-managed |
| **:8082** | backend orchestrator + agent loop | always |
| **:9000** | static frontend (no-cache server) | always |

- **Launch backend (orchestrator)**: `cd ~/projects/llm-no-magic && nohup python3 -m agent.server > /tmp/agent-server.log 2>&1 &`
- **Launch static**: `python3 /tmp/no_cache_server.py ~/projects/llm-no-magic &`
- **No need to launch llama manually.** On startup, the backend's `_detect_model()` probes `:8080`; if nothing is there, the first tab click in the frontend triggers `/swap`, which launches it.
- **Model source** (if the GGUF is missing): `hf download Qwen/Qwen3-4B-GGUF Qwen3-4B-Q4_K_M.gguf --local-dir ~/models` (same syntax for the 0.6B, just swap the name).
- **Endpoints**: backend `/agent` / `/preview` / `/swap` all hit `http://localhost:8082/...`. The direct llama endpoint is `http://localhost:8080/v1/chat/completions` (only the CLI `agent.py` talks to it directly).
- **Function calling**: relies on the 4B (the 0.6B is unstable). Switching to Tab ④ in the frontend triggers a swap to 4B.
- **GPU footprint**: ~3GB max — only one model is on the GPU at a time. During a swap, the old process is killed and the new one launches in ~5s.

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

## Web backend (:8082) — used by Tab ④ Agent

**Launch command** (from repo root):
```bash
cd ~/projects/llm-no-magic
nohup python3 -m agent.server > /tmp/agent-server.log 2>&1 &
```

**cwd must be the repo root** — the relative paths in presets 2 and 3 (`prompts.md`, `course/`) are resolved from the repo root. Don't launch it from `agent/`.

**Verify:**
```bash
curl -s http://localhost:8082/agent -I -X OPTIONS | grep -q "204" && echo "8082 ✓ backend"
```

**Port summary:**

| Port | Service | When it runs |
|------|---------|--------------|
| :9000 | static frontend (no-cache server) | always (LLM session + Agent session) |
| :8080 | llama-server (0.6B or 4B, swappable) | always (controlled by backend `/swap`) |
| :8082 | agent web backend (server.py) | Agent session on Fri (Tab ④ frontend talks to this) |

**Fri AM needs both servers up** (8080 + 8082 + 9000). Full Tab ④ flow: browser → `:9000` frontend → `:8082` backend → `:8080` llama-server (0.6B by default, `/swap` to 4B).

## Fri AM 30-second pre-class check

```bash
# 1. All three servers up? (:8081 is retired; we use :8080 single-port now)
curl -s http://localhost:9000/ > /dev/null && echo "9000 ✓ static"
curl -s http://localhost:8080/v1/models | grep -qE "Qwen3-0\.6B|Qwen3-4B" && echo "8080 ✓ llama"
curl -s http://localhost:8082/agent -I -X OPTIONS 2>&1 | grep -q "204" && echo "8082 ✓ backend"

# 2. Start whichever is missing
# (static)  python3 /tmp/no_cache_server.py ~/projects/llm-no-magic &
# (backend) cd ~/projects/llm-no-magic && nohup python3 -m agent.server > /tmp/agent-server.log 2>&1 &
# (llama)   No need to start manually. The backend detects whether :8080 is alive on startup;
#           if not, it waits for a tab click in the frontend to auto-swap one in.
```

## Fri AM fallback if things break

If the backend or Tab ④ misbehaves in class:
- **Fall back to CLI `agent.py`**: first confirm 4B is on `:8080` (`curl -s http://localhost:8080/v1/models | grep -q "Qwen3-4B"`); if not, swap first: `curl -X POST http://localhost:8082/swap -H "Content-Type: application/json" -d '{"model":"4B"}'`. Then run `python3 -m agent.agent`.
- **Manually swap to 0.6B** (if the backend is down but the frontend can still demo): `pkill -f llama-server` && `nohup llama-server -m ~/models/Qwen3-0.6B-Q4_K_M.gguf --port 8080 -ngl 99 > /tmp/llama-0.6b.log 2>&1 &`
- **Manually swap to 4B**: same as above but swap the model file to `Qwen3-4B-Q4_K_M.gguf`.
