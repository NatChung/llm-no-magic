# LLM 沒有魔法 · 只有 token 跟約定

4-tab 視覺化教學工具,讓 LLM 內部運作看得見:Token / 機率 / chat template / Agent 流程,逐層可見。

跑在你 Mac 上,完全 local — `llama.cpp` + Qwen3 GGUF 模型。

---

## What you'll see

- **① 基礎** — 打字進去 → 看 model 一個一個吐 token + 每個 token 當下 top-10 機率分佈
- **② 產品層加工** — 加 system prompt + Qwen3 chat template,看「加工後」prompt 跟 raw 對比
- **③ 推理** — thinking 開關。同題目,直答 vs 寫 think block 後再答(reasoning 對精度的影響)
- **④ Agent** — multi-turn function calling,model 吐 `<tool_call>` token → client parse → **真的執行**(read/write 檔案、跑 bash)→ 結果塞回對話再吐字,直到 final

每 tab 點 token 都能看當下機率分佈(bar chart 跳階),Tab ④ 更會展開「累積 N turn 後送進下次 model 的 prompt」chat template text。

> **Tip**:本 repo 不只是 demo — 也是完整的 60-90 min 課程教材(見 `引導手冊.html`)。

---

## Quick start(Mac)

```bash
# 1. Install llama.cpp
brew install llama.cpp

# 2. Download Qwen3 模型(2 種 size:0.6B 給 token 教學、4B 給 Agent function calling)
mkdir -p ~/models
hf download Qwen/Qwen3-0.6B-GGUF Qwen3-0.6B-Q4_K_M.gguf --local-dir ~/models
hf download Qwen/Qwen3-4B-GGUF   Qwen3-4B-Q4_K_M.gguf   --local-dir ~/models

# 3. Clone
git clone https://github.com/NatChung/llm-no-magic.git
cd llm-no-magic

# 4. 起 backend(會 auto-launch + auto-swap llama-server on :8080)
nohup python3 -m agent.server > /tmp/agent-server.log 2>&1 &

# 5. 起 static frontend + 開 browser
python3 -m http.server 9000 &
open http://localhost:9000/frontend/
```

切 tab 時 backend 自動 swap model(Tab 1-3 → 0.6B、Tab ④ → 4B)。第一次切會看「載入 X 中…」banner 等 3-5 秒。

**Dependencies**:`llama.cpp`(brew)、`huggingface_hub`(`pip install -U "huggingface_hub[cli]"`)、Python 3.10+、`requests`(`pip install requests`)。沒 npm / build step。

---

## Try it(Tab ④ Agent)

1. 切到 Tab ④
2. 選 preset 1「現在幾點?」+ 送出
3. 預期:
   - Turn 1:看到 model 吐的 token 序列(`<tool_call>` 開頭)+ 紫色「↑ 工具呼叫」block 顯示 `get_time({})` + 綠色「↓ 工具結果」顯示 `HH:MM:SS`
   - Turn 2:final「現在是 HH:MM:SS」
4. 點 Turn 1 token 序列任一 token → 右下 bar chart 顯示當下 top-10 機率(第一個 `<tool_call>` token 99%+ 一面倒)
5. 展開 turn block 內「再送出 — 累積 N turn 後送進下次 model 的 prompt」details → 看 chat template text 跟 conversation 怎麼累積

3 個 preset:
- 1. 現在幾點? — `get_time` demo(最快,1-2 turn)
- 2. 讀+寫 摘要 — `read_file` → `write_file` 真寫一個檔到 ~/Desktop(`read_file` + `write_file` demo)
- 3. 數 .md 檔 — `exec_bash` 跑 `find` 真數 repo 下檔(`exec_bash` demo)

---

## How it works

```
Browser (frontend)
    ↓ POST /agent (SSE)        ↓ POST /swap (tab 切換 trigger)
Backend :8082 (agent/server.py)
    ↓ POST /v1/chat/completions (non-stream + logprobs + tools)
llama-server :8080 (Qwen3 model — auto-swap by /swap)
```

**核心**:
- Tab 1-3 frontend 直接打 llama `/completion`(stream + n_probs)— Tab 2-3 自己拼 chat template tag
- Tab ④ frontend 打 backend `/agent`(SSE)→ backend 跑 multi-turn agent loop,每 turn 用 OpenAI chat completions API + tools schema,real execute tool 結果塞回 messages,直到 model 不再 tool_call
- Tab 切換時 `ensureModel(wanted)` POST `/swap?model=X` → backend `SWAP_LOCK` 守單 flight → `pkill llama-server` + 等 port free + `subprocess.Popen` 起新 model + poll /v1/models 直到 ready(~3-5s)

完整 architecture / SSE protocol / swap orchestrator 細節在 `引導手冊.html`。

---

## Code tour

- `frontend/index.html` + `app.js` + `styles.css` — Tailwind Play CDN(零 build),4 tab UI
- `agent/server.py` — HTTP backend stdlib `http.server`(no FastAPI),agent loop + `/swap` orchestrator + `/preview`(/apply-template proxy)
- `agent/agent.py` — CLI fallback REPL + 4 tools(`get_time` / `read_file` / `write_file` / `exec_bash`)+ `dispatch_tool_call` + `AgentLoop`
- `agent/tests/` — 43 tests(mocked subprocess + requests + socket;`pytest agent/tests -q`)
- `agent/SETUP.md` — port / Fri AM check / fallback 操作備忘
- `prompts.md` — 教學用 prompt 素材(token-level demo 的 input)
- `引導手冊.html` — 完整 60-90 min 課程材料(self-read,跟著做完一遍)

---

## Lesson plan

`引導手冊.html` 是 self-read 教學手冊:跟著走過 4 個 tab 各個段落,~60-90 min 看完。配 trainer 帶課也適用(每段有 demo 操作 + 解釋)。

如果你想拿去公司教 / 自己學 / fork 改成自己版本 — MIT license,自由用。

---

## About

本 repo 是 LLM 教學內容開源版本。教材設計 [Nat Chung](https://github.com/NatChung)、實作協作 Claude Code(Anthropic),MIT license — 自由 fork / 商業使用 / re-mix / 教學分享。

歡迎 issue / PR / fork,Nat 不積極 maintain 但會收 PR 看。
