# AGENTS.zh-TW.md — 請先讀這裡

> English: [AGENTS.md](./AGENTS.md)(agent 自動載入英文版;本檔給人讀)

這個 repo 是 **「LLM, no magic」** — 一個動手實作、完全本地端的 LLM 教學工具:一個網頁 UI
(分頁 ⓪–⑧),由執行在 :9000 的純標準庫 Python 伺服器提供服務,驅動執行在 :8080 的
llama.cpp + Qwen3 GGUF 模型。分頁 ①–④ 是互動式的(tokens/機率、聊天模板、思考模式、函式呼叫代理);
⑤–⑧ 是文章。

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
  + `/agent` `/skill-agent` `/swap` `/preview` API,自動啟動 llama-server :8080)、
  `frontend/app.js`(零建置 Tailwind Play CDN UI)、`agent/agent.py`(CLI agent 迴圈
  + 4 個工具)、`teaching/`(AI 帶領教學素材)、`init.py`(環境檢查工具)。
- 測試:`pytest agent/tests -q`(純 pytest 函式 + mocks;維持這個風格)。
- 慣例:**雙語** — 每個面向使用者的變更都必須同時落地於英文和 zh-TW 檔案
  (`index.html`/`index.zh-TW.html`、`README.md`/`README.zh-TW.md`、課程素材)。
  每當前端檔案有變動,務必同時在兩個 HTML 檔案中更新 `?v=NN` 快取破除查詢字串。
- 啟動伺服器:`nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`

## 學生 → 教學模式

1. 執行 `python3 init.py`。如果最後一行不是 `READY*`,請引導使用者逐一處理
   印出的 `fix:` 行(`python3 init.py --fix` 可自動處理 pip 相關的部分)。教學
   **也需要** playwright — 如果摘要出現 `WARN teaching: playwright missing`,
   請在繼續之前先安裝(`pip install playwright && playwright install chromium`)。
2. 確認伺服器已啟動(init.py 的 Port 9000 行會回報是否在執行中 — 或以上方指令啟動),
   然後讓學生開啟 http://localhost:9000/(zh-TW:http://localhost:9000/index.zh-TW.html)。
3. 開啟 `teaching/README.md`(zh-TW:`teaching/README.zh-TW.md`)並依照其內容進行。
   該檔案定義了課程架構(第 1→4 課)、教學規則,以及如何執行 `teaching/demos/` 中的
   示範腳本。
4. 示範腳本是**預先撰寫的 Playwright 腳本** — 請一律透過以下方式執行:
   `python3 teaching/demos/demo_tabN.py --segment K [--lang zh-TW]`。
   請勿改用即時的瀏覽器自動化 MCP 來驅動頁面;腳本才是示範的正確方式。

## 疑難排解

- `Model swap failed: port 8080 still busy` → 另一個行程佔用了 :8080。用
  `lsof -nP -iTCP:8080 -sTCP:LISTEN` 找出它,停止後重試(init.py 也會偵測到這個問題)。
- 伺服器未啟動 / 頁面無法載入 → 用上方指令啟動,日誌位於 `/tmp/agent-server.log`。
- 示範腳本快速失敗 → 它會印出單行原因(伺服器未啟動 / 模型缺失 /
  模型切換失敗 / 選擇器找不到)。依照 init.py 修正後,重新執行同一段。
- 第一次切換到某個分頁時會出現「載入模型」橫幅,持續 3–5 秒 — 那是
  0.6B↔4B 的模型切換,屬於正常現象。
