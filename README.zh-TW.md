# LLM 沒有魔法 · 只有 token 跟約定

> English: [README.md](./README.md)

4-tab 視覺化教學工具,讓 LLM 內部運作看得見:Token / 機率 / chat template / Agent 流程,逐層可見。

跑在你 Mac 上,完全 local — `llama.cpp` + Qwen3 GGUF 模型。

---

## What you'll see

- **① 基礎** — 打字進去 → 看 model 一個一個吐 token + 每個 token 當下 top-10 機率分佈。中文 preset 3 個有完整教學弧:`床前明月光,疑是地上`(peaked,model 背過整首詩 → 接「霜」top-1 94%+)、`祖樹星上最高的山叫做`(peaked,**你瞎掰**的星球 model 照樣自信編 → **peaked ≠ 真實**)、`他打開冰箱,拿出`(flat,model 不知接啥)。3 個對比展示「confidence ≠ correctness」+「分佈形狀反映 model 把握度」
- **② 產品層加工** — 加 system prompt + Qwen3 chat template,看「加工後」prompt 跟 raw 對比。中文 preset 3 個 user prompt 一鍵試:`一年有幾個月?`(常識短答)、`寫一個夏季冰飲的促銷文案`(創作)、`請寫一首關於月亮的五言絕句`(文學)— system 自填(textarea placeholder 已 hint「你是行銷顧問,用條列式回答,只給 3 點」)
- **③ 推理** — thinking 開關。同題目,直答 vs 寫 think block 後再答(reasoning 對精度的影響)
- **④ Agent** — multi-turn function calling,model 吐 `<tool_call>` token → client parse → **真的執行**(read/write 檔案、跑 bash)→ 結果塞回對話再吐字,直到 final

Tab 1-3 點 token 看當下 top-10 機率(bar chart 跳階);Tab ④ token 不 clickable,改展開「收到 / 再送出」details 看 chat template text 跟 conversation 怎麼累積。

每個 tab 上方都有小 `(?)` explainer 下拉(System prompt / chat template / thinking mode / Agent / tool_call / turn 等)— 點開就看到 inline 解釋,邊試邊讀。

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

# 4. 起 server(同時吐 HTML + API on :9000,auto-launch llama-server on :8080)
nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &

# 5. 開 browser
open http://localhost:9000/
```

切 tab 時 server 自動 swap model(Tab 1-3 → 0.6B、Tab ④/⑥ → 4B,Tab ⑤/⑦ 是純 article 不切)。第一次切會看「載入 X 中…」banner 等 3-5 秒。

**課堂 LAN demo**(同 WiFi 學員可連你 Mac):

```bash
LISTEN_HOST=0.0.0.0 nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
# 學員開 http://<你 Mac 的 LAN IP>:9000/(例 192.168.x.x:9000/)
# llama-server 也會自動帶 --host 0.0.0.0 launch
# 注意:GPU 一次只一個 model、多學員同時切不同 tab 會互踢
```

**Dependencies**:`llama.cpp`(brew)、`huggingface_hub`(`pip install -U "huggingface_hub[cli]"`)、Python 3.10+、`requests`(`pip install requests`)。沒 npm / build step。

---

## 🤖 AI 帶課模式(Claude Code / Codex)

不想自己摸?用 AI coding agent 打開這個 repo,它會讀 [AGENTS.md](./AGENTS.md)、
問你是老師還是學員,然後:

- 跑 `python3 init.py` 幫你檢查環境(llama.cpp、模型、playwright),缺什麼帶你裝
- 照 [teaching/](./teaching/) 的課綱帶課:先問你預測 → 跑 Playwright demo 給你看畫面動 → 再揭曉
- 你只要回答問題、看畫面、偶爾自己動手

學員用法:clone 後在 repo 資料夾開 Claude Code,打聲「hi」就會開始。

---

## Try it

### Tab ① 基礎 — 60 秒對比

1. 切到 Tab ① (default active)
2. preset 1「`床前明月光,疑是地上`」+ 送出 → 預期 model 接「霜」,top-1 94%+(次高才 3%,model 對熟悉文本極高 confidence)
3. preset 2「`祖樹星上最高的山叫做`」+ 送出 → 預期 model 自信編一個假地名,top-1 也很高 — **同樣 peaked,但這次是瞎掰** (peaked ≠ 真實 / confidence ≠ correctness)
4. preset 3「`他打開冰箱,拿出`」+ 送出 → 預期 top-10 分散(水 / 雞蛋 / 剩飯 / 啤酒...flat),model 表達「不知接啥」
5. 點任一 token 看 top-10 bar chart;3 個 preset 的「形狀對比」就是 Tab ① 全部教學

### Tab ② 產品層加工 — 加工 vs 不加工

1. 切到 Tab ②(0.6B,banner ~3 秒)
2. preset 1「`一年有幾個月?`」**raw mode** + 送出 → 看 model 散開答(可能講「12 個月」+ 冗詞)
3. 同 prompt + 加 system「你是行銷顧問,用條列式回答,只給 3 點。」+ **chat mode** + 送出 → 看「加工後」變整齊條列
4. 展開「實際送進 model 的 final prompt」details → 看 `<|im_start|>system\n...<|im_end|>` 怎麼被包進去
5. 試 preset 2「夏季冰飲文案」對比同樣方式

### Tab ④ Agent — 真執行 demo

1. 切到 Tab ④(會看到「載入 4B 中…」banner ~5 秒)
2. preset 1「現在幾點?」+ 送出
3. 預期:
   - Turn 1:model 吐的 token 序列(`<tool_call>` 開頭)+ 紫色「↑ 工具呼叫」block 顯示 `get_time({})` + 綠色「↓ 工具結果」顯示 `HH:MM:SS`
   - Turn 2:final「現在是 HH:MM:SS」
4. 展開 turn block 內「再送出 — 累積 N turn 後送進下次 model 的 prompt」details → 看 chat template text 跟 conversation 怎麼累積成下次 input

3 個 Tab ④ preset:
- 1. **現在幾點?** — `get_time` demo(最快,1-2 turn)
- 2. **讀+寫 摘要** — `read_file` → `write_file` 真寫一個檔到 `~/Desktop/llm-summary.md`
- 3. **數 .md 檔** — `exec_bash` 跑 `find` 真數 repo 下檔

---

## How it works

```
Browser
    ↓ GET / (HTML)    ↓ POST /agent /skill-agent /swap /preview (SSE/JSON)
Server :9000 (agent/server.py — 同個 process 吐靜態 + API)
    ↓ POST /v1/chat/completions  (non-stream + logprobs + tools)
llama-server :8080 (Qwen3 model — auto-swap by /swap)
```

**核心**:
- Tab 1-3 frontend 直接打 llama `/completion`(stream + n_probs)— Tab 2-3 自己拼 chat template tag
- Tab ④ Agent:frontend → `/agent`(SSE)→ server 跑 multi-turn agent loop、OpenAI chat completions API + tools schema、real execute tool、結果塞回 messages、直到 model 不再 tool_call
- Tab ⑥ Skill:frontend → `/skill-agent`(SSE)→ server 跑 3-layer progressive disclosure simulator(lazy 載 SKILL.md body + bundled scripts/)
- Tab ⑤/⑦:純 article、不跟 model 互動
- Tab 切換時 `ensureModel(wanted)` POST `/swap?model=X` → server `SWAP_LOCK` 守單 flight → `pkill llama-server` + 等 port free + `subprocess.Popen` 起新 model + poll /v1/models 直到 ready(~3-5s)

---

## Code tour

- `frontend/index.html` + `app.js` + `styles.css` — Tailwind Play CDN(零 build),7 tab UI
- `agent/server.py` — 單 port stdlib http.server(no FastAPI):同時 serve 靜態 frontend + API endpoints(agent loop、skill simulator、`/swap` orchestrator、`/preview` apply-template proxy)。`LISTEN_HOST=0.0.0.0` opt-in 給 LAN demo。
- `agent/agent.py` — CLI fallback REPL + 4 tools(`get_time` / `read_file` / `write_file` / `exec_bash`)+ `dispatch_tool_call` + `AgentLoop`
- `agent/tests/` — 43 tests(mocked subprocess + requests + socket;`pytest agent/tests -q`)
- `agent/SETUP.md` — port / Fri AM check / fallback 操作備忘
- `prompts.md` — 教學用 prompt 素材(token-level demo 的 input)

---

## About

本 repo 是 LLM 教學內容開源版本。教材設計 [Nat Chung](https://github.com/NatChung)、實作協作 Claude Code(Anthropic),MIT license — 自由 fork / 商業使用 / re-mix / 教學分享。

歡迎 issue / PR / fork,Nat 不積極 maintain 但會收 PR 看。
