# LLM 沒有魔法 · 只有 token 跟約定

> English: [README.en.md](./README.en.md)

6-tab 視覺化教學工具,讓 LLM 內部運作看得見:Token / 機率 / chat template / Agent 流程 / Skill 漸進載入 / MCP,逐層可見。

跑在你 Mac 上,完全 local — `llama.cpp` + Qwen3 GGUF 模型。

---

## What you'll see

- **① 接龍** — 打字進去 → 看 model 一個一個吐 token + 每個 token 當下 top-10 機率分佈。3 個中文範例句(自己打進輸入框)有完整教學弧:`床前明月光,疑是地上`(peaked,model 背過整首詩 → 接「霜」top-1 94%+)、`祖樹星上最高的山叫做`(peaked,**你瞎掰**的星球 model 照樣自信編 → **peaked ≠ 真實**)、`他打開冰箱,拿出一包`(flat,top-1 只有一成多,model 不知接啥)。3 個對比展示「confidence ≠ correctness」+「分佈形狀反映 model 把握度」
- **② 問答** — 看「接龍怎麼變問答」:同一句 `一年有幾個月?` 三種送法對比 — 裸 prompt(純接龍、跳針不回答)、手打「問:答:」(單純文字 pattern 就讓它切成回答模式,但會失控續問)、真 Qwen3 chat template(換成 `<|im_start|>` 這種訓練賦予邊界意義的保留 token,才有乾淨的停止訊號)。畫面常駐顯示 raw vs chat template 的 final prompt 對照(marker 以藍色標示),看產品層到底加了什麼
- **③ 推理** — thinking 開關。同題目,直答 vs 寫 think block 後再答(reasoning 對精度的影響)
- **④ 代理** — multi-turn function calling,model 吐 `<tool_call>` token → client parse → **真的執行**(`get_time` 查真實系統時間)→ 結果塞回對話再吐字,直到 final
- **⑤ Skill(預覽)** — 送一句 query 進去,看 model 自己判斷要不要載入 skill、載哪個(3 個 preset:整理檔案 → `organize_files`、台北天氣 → `check_weather`、`1+1` → 沒命中直接答)。對齊 Claude Code 的三層漸進式揭露:L1 metadata 常駐 system prompt、L2 `SKILL.md` body 按需載入、L3 bundled scripts 只讀不進 context
- **⑥ MCP** — 純文章、不跟 model 互動。講「工具不固定時 AI 怎麼自己選/操作工具」,以操控網頁為例

Tab 1-3 點 token 看當下 top-10 機率(bar chart 跳階);Tab ④ token 不 clickable,改展開「收到 / 再送出」details 看 chat template text 跟 conversation 怎麼累積。

每個 tab 上方都有小 `(?)` explainer 下拉(System prompt / chat template / thinking mode / Agent / tool_call / turn 等)— 點開就看到 inline 解釋,邊試邊讀。

---

## Quick start(Mac)

不用自己手動裝、不用先開 terminal。打開 **Claude(桌面 app)**,左側選單切到 **Code** 分頁、開一個新 session,貼上:

```
請下載:https://github.com/NatChung/llm-no-magic,並開始這個教學
```

AI 會自己抓 repo、讀 [AGENTS.md](./AGENTS.md)、問你是老師還是學員,然後:

- 跑 `python3 init.py` 幫你檢查環境(llama.cpp、模型),缺什麼帶你裝 — 教學只需要一個能發
  HTTP 請求的 AI,加上你自己開一次的瀏覽器,不需要 Node、不需要 MCP
- 照 [teaching/](./teaching/) 課綱帶課:AI **透過 HTTP 打 `POST /drive` 驅動頁面**,頁面
  透過 SSE(`/events`)即時反映每個動作,邊做邊解說,demo 完留著讓你接手試
- 你自己開一次網址(http://localhost:9000/)後留著就好,之後只要看那個畫面、聽解說、偶爾自己動手 — 其餘由 AI 透過 HTTP 驅動

用 terminal 版 AI coding agent(Claude Code / Codex)也一樣,先 `git clone` 這個 repo 再開:

```bash
git clone https://github.com/NatChung/llm-no-magic.git
cd llm-no-magic
```

打開 Claude Code / Codex,打聲「hi」就會開始。

**Dependencies**(AI 會幫你檢查/補裝,這裡列出來給想知道底層裝了什麼的人參考):
`llama.cpp`(brew)、`huggingface_hub`(`pip install -U "huggingface_hub[cli]"`)、
Python 3.10+、`requests`。沒 npm / build step。

---

## Code tour

- `frontend/index.html` + `index.zh-TW.html` + `app.js` + `styles.css` — Tailwind Play CDN(零 build),6 tab UI(①接龍/②問答/③推理/④代理/⑤Skill/⑥MCP)
- `agent/server.py` — 單 port stdlib http.server(no FastAPI):同時 serve 靜態 frontend + API endpoints(`/drive` `/inspect` `/stop` `/agent` `/skill-agent` `/preview` `/events` `/health`)、swap orchestrator(`handle_swap`,由 `/drive` 呼叫)
- `agent/agent.py` — CLI fallback REPL + 4 tools(`get_time` / `read_file` / `write_file` / `exec_bash`)+ `dispatch_tool_call` + `AgentLoop`
- `agent/skill_agent.py` — Tab ⑤ 三層漸進式揭露 simulator(lazy 載 `SKILL.md` body + bundled scripts/)
- `agent/skills/` — Tab ⑤ demo 用的 2 個 skill(`check_weather`、`organize_files`)
- `agent/tests/` — pytest suite(mocked subprocess + requests + socket;`pytest agent/tests -q`)
- `agent/SETUP.md` — port / Fri AM check / fallback 操作備忘
- `agent/smoke.py` — creator 用的 playwright 迴歸驗證腳本(`--smoke`)
- `prompts.md` — 教學用 prompt 素材(token-level demo 的 input)

---

## About

本 repo 是 LLM 教學內容開源版本。教材設計 [Nat Chung](https://github.com/NatChung)、實作協作 Claude Code(Anthropic),MIT license — 自由 fork / 商業使用 / re-mix / 教學分享。

歡迎 issue / PR / fork,Nat 不積極 maintain 但會收 PR 看。
