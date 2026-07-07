# AGENTS.zh-TW.md — 請先讀這裡

> English: [AGENTS.md](./AGENTS.md)(agent 自動載入英文版;本檔給人讀)

這個 repo 是 **「LLM, no magic」** — 一個動手實作、完全本地端的 LLM 教學工具:一個網頁 UI
(分頁 ①–⑥),由執行在 :9000 的純標準庫 Python 伺服器提供服務,驅動執行在 :8080 的
llama.cpp + Qwen3 GGUF 模型。分頁 ①–④ 是互動式的(tokens/機率、聊天模板、思考模式、函式呼叫代理);
⑤ 是互動式的 Skill 預覽;⑥ 是文章。

**這個 repo 支援 AI 帶領教學。** 你(AI agent)可以主導整個課程。

## 你的第一個動作 — 詢問使用者的身分

在做任何事之前,先問:

> 你是這門課的**創作者/教師**(正在開發或維護),
> 還是來學習 LLM 如何運作的**學生**?

然後依照下方對應的模式進行。請使用使用者的語言(zh-TW 學生 →
使用 `.zh-TW` 檔案並以繁體中文回覆)。

## 創作者 → 開發模式

- 架構:
  `agent/server.py`(單埠標準庫伺服器 :9000 — 靜態前端
  + `/agent` `/skill-agent` `/preview` `/drive` `/inspect` `/stop` API,自動啟動 llama-server :8080)、
  `frontend/app.js`(零建置 Tailwind Play CDN UI)、`agent/agent.py`(CLI agent 迴圈
  + 4 個工具)、`teaching/`(AI 帶領教學素材)、`init.py`(環境檢查工具)。
- 測試:`pytest agent/tests -q`(純 pytest 函式 + mocks;維持這個風格)。
- 慣例:**雙語** — 每個面向使用者的變更都必須同時落地於英文和 zh-TW 檔案
  (`index.html`/`index.zh-TW.html`、`README.md`(zh-TW)/`README.en.md`、課程素材)。
  每當前端檔案有變動,務必同時在兩個 HTML 檔案中更新 `?v=NN` 快取破除查詢字串。
- 啟動伺服器:`nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`

## 學生 → 教學模式

1. 執行 `python3 init.py`。如果最後一行不是 `READY*`,請引導使用者逐一處理
   印出的 `fix:` 行。教學只需要一個能發 HTTP 請求的 AI(Claude Code / Codex,
   透過 Bash `curl` 驅動)加上學生自己開一次的瀏覽器 — 不需要 Node,不需要 MCP。
   `python3 init.py --fix` 會安裝 pip 相關依賴(不寫任何設定檔)。(pip `playwright`
   僅供創作者的 `--smoke` 回歸測試使用 — 身為學生,看到 `WARN creator:` 可以忽略。)
2. 確認伺服器已啟動(init.py 的 Port 9000 行 — 或自行啟動:
   `nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`)。
3. 開啟 `teaching/README.zh-TW.md` 並依照其內容進行。**你(AI)透過 relay 驅動頁面**:
   打 `POST /drive` 執行每個動作,頁面會透過它的 `/events` 訂閱即時反映。先打
   `GET /health` 確認 `subscribers >= 1`(否則請學生開啟 http://localhost:9000/)。
   課後**讓瀏覽器保持開啟**供學生親自操作。不要退回去執行 Python 示範腳本作為
   學生端示範(那些腳本現在是創作者的回歸測試工具)。

### 分工(跟學生講)

**網頁是示範的舞台** — 學生盯著它看數字變化(tokens、機率條、對話追蹤、結果)。
**你負責旁白** — 所有解說都由你口述;不要照念頁面上已有的文字。直接說:
「看螢幕,聽我說。」只有在學生想看書面版時,才指引他們展開 `(?)` 下拉選單。

### 用 relay 驅動頁面 — 怎麼等 / 怎麼處理失敗

- **模型切換:**驅動分頁 4 的動作(或任何會換 model 的分頁)會觸發 `/drive` 內部的
  0.6B↔4B 切換;頁面會顯示「載入模型」橫幅(來自 `swap_start` frame)。`/drive`
  呼叫要等生成完成才會回傳 — 不需要輪詢快照。若呼叫較慢,請告訴學生稍等
  (第一次切換約 3–5 秒,4B 更久)。
- **生成完成:**`/drive` 完成時會回傳整體結果(tokens/turns/final);頁面的 Send 按鈕
  會在收到最終的 `final` 時重新啟用 — 直接讀取回傳結果即可,不必再看頁面。
- **切換失敗:**切換失敗時 `/drive` 會回傳 5xx `{error}`,頁面會顯示錯誤並自行復原
  (不會卡住)。用白話告訴學生失敗了,然後依疑難排解(8080 埠)處理。

## 疑難排解

- `Model swap failed: port 8080 still busy` → 另一個行程佔用了 :8080。用
  `lsof -nP -iTCP:8080 -sTCP:LISTEN` 找出它,停止後重試(init.py 也會偵測到這個問題)。
- 伺服器未啟動 / 頁面無法載入 → 用上方指令啟動,日誌位於 `/tmp/agent-server.log`。
- 某個課程步驟無法繼續 → 打 `GET /health` 查看目前狀態。如果切換橫幅卡住超過 15 秒,
  模型切換可能已失敗(見上方 8080 埠說明);請向學生旁白說明失敗情形,而非盲目重試。
- 第一次切換到某個分頁時會出現「載入模型」橫幅,持續 3–5 秒 — 那是
  0.6B↔4B 的模型切換,屬於正常現象。
