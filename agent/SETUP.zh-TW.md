# V2 Agent stack setup

> English: [SETUP.md](./SETUP.md)

Verified 2026-05-29。**Two-port setup** — `:9000` 一個 Python server 同時吐 HTML + API + SSE;`:8080` llama-server 跑 model(0.6B 或 4B,`/swap` 切換)。原 `:8082` backend 已合進 `:9000`。

| Port | 用途 | 何時起 |
|------|------|--------|
| **:8080** | llama-server(0.6B 或 4B,by `/swap`)| auto-managed |
| **:9000** | 單一 server(靜態 HTML + API endpoints)| always |

- **Launch server**: `cd ~/projects/llm-no-magic && nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`
- **llama 不用手動起!** server startup `_detect_model()` 偵測 :8080;若 down,frontend 第一次 tab click → `/swap` → 自動 launch(會帶 `--host $LISTEN_HOST`)
- **Model source**(若 GGUF 不存在): `hf download Qwen/Qwen3-4B-GGUF Qwen3-4B-Q4_K_M.gguf --local-dir ~/models`(0.6B 同樣語法、換名)
- **Endpoint**: `/`、`/index.zh-TW.html`、`/app.js`、`/styles.css`(靜態) + `/agent`、`/skill-agent`、`/swap`、`/preview`(API)— 全在 `:9000`。舊 `/frontend/*` URL 會 301 redirect 到 `/*`。llama 直接 endpoint 是 `http://localhost:8080/v1/chat/completions`(只有 CLI agent.py 直接打)
- **Function calling**: 仰賴 4B(0.6B 不穩);Tab ④/⑥ frontend 切到時 trigger swap to 4B
- **GPU 負擔**: ~3GB max(同時間只一個 model 在 GPU 上;swap 期間舊 process kill 後新 process launch ~5s)

## 課堂 LAN demo

同 WiFi 學員不必自己起 stack、可直接連你 Mac:

```bash
LISTEN_HOST=0.0.0.0 nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
# 學員開 http://<你 Mac 的 LAN IP>:9000/(用 `ipconfig getifaddr en0` 看你 IP)
# llama-server 也自動帶 --host 0.0.0.0 launch(從 LISTEN_HOST 傳)
# 第一次連 macOS 可能跳 firewall prompt,允許 Python / llama-server inbound
```

注意:GPU 一次只一個 model。多學員同時切不同 tab 會競爭(swap-banner 抖動)。Trainer 主導的 demo 場合不會撞。

## 歷史(refer only)

2026-05-26 PM ~ 2026-05-27 AM 採 dual-port(:8080 0.6B + :8081 4B)避免 swap 風險,但 18GB Mac 並存時 Ghostty 偶報 GPU。2026-05-27 PM auto-swap orchestrator 上線,`:8081` 退場。

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

`write_file` / `read_file` in `agent.py` did not call `Path.expanduser()` — writing to `~/Desktop/...` raised `FileNotFoundError` on literal `~` path. Fixed: added `.expanduser()` + `parent.mkdir(parents=True, exist_ok=True)`.

### Concerns / Observations

- One run-2 v1 attempt hit a 60s ReadTimeout on llama-server (model under sustained load from back-to-back runs). Fixed in `smoke.py` with per-run `try/except` so one timeout does not abort the entire suite.
- Model sometimes calls `write_file` multiple times per Demo 2 turn (retries after error) before getting the correct path — still counts as PASS because final write succeeds.

### `say` 中文聲音測試

`say "你好,我是你的電腦"` — command ran successfully (exit 0). **Human verification needed**: macOS default Mandarin voice is typically robotic (Ting-Ting / Mei-Jia). For Phase 0 demo 建議 `say -v Mei-Jia "..."` for best available quality.

## 單一 server(:9000)— 同時 serve HTML + API

**啟動指令**(從 repo root):
```bash
cd ~/projects/llm-no-magic
nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
```

**cwd 必須是 repo root** — Tab ④ Agent preset 2 / 3 的相對路徑(`prompts.md`、`course/`)從 repo root 解析。不要從 `agent/` 跑。

**驗證:**
```bash
curl -s http://localhost:9000/ | grep -q "LLM, no magic" && echo "9000 ✓ HTML"
curl -s -o /dev/null -w "/agent OPTIONS = %{http_code}\n" -X OPTIONS http://localhost:9000/agent
```

**Port 整理:**

| Port | 服務 | 何時起 |
|------|------|--------|
| :9000 | 單一 server:HTML + API endpoints(server.py)| always |
| :8080 | llama-server(0.6B 或 4B 可 swap)| always(by `/swap` 控制)|

Tab ④ 完整 flow:browser → `:9000` HTML/JS → fetch `/agent`(同 origin)→ `:8080` llama-server(0.6B 預設,/swap 切 4B)。

## Fri AM 課前 30 秒 check

```bash
# 1. 兩個 port 都在?
curl -s http://localhost:9000/ | grep -q "LLM, no magic" && echo "9000 ✓ server (HTML+API)"
curl -s http://localhost:8080/v1/models | grep -qE "Qwen3-0\.6B|Qwen3-4B" && echo "8080 ✓ llama"

# 2. 缺哪個就起哪個
# (server) cd ~/projects/llm-no-magic && nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
# (llama)  不用手動起!server.py 啟動會 detect 是否 :8080 alive;若沒就等 frontend 點 tab 自動 swap 起
```

## Fri AM 出包 fallback

如果 server 或 Tab ④ 在課堂上出包:
- **退回 CLI agent.py**:先確認 :8080 跑 4B(`curl -s http://localhost:8080/v1/models | grep -q "Qwen3-4B"`),否則先 swap:`curl -X POST http://localhost:9000/swap -H "Content-Type: application/json" -d '{"model":"4B"}'`。然後 `python3 -m agent.agent`。
- **手動 swap 0.6B**(若 backend 出包但 frontend 還能 demo):`pkill -f llama-server` && `nohup llama-server -m ~/models/Qwen3-0.6B-Q4_K_M.gguf --port 8080 -ngl 99 > /tmp/llama-0.6b.log 2>&1 &`
- **手動 swap 4B**:同上但 model file 換 `Qwen3-4B-Q4_K_M.gguf`
