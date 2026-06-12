# AI 帶課模式 Design（AGENTS.md + teaching/ + Playwright demos + init）

日期：2026-06-12
狀態：待 review

## 目標

讓學員 clone repo 後用 AI coding agent（Claude Code / Codex）打開，AI 讀完 CLAUDE.md / AGENTS.md 就能：

1. 說明這個專案是什麼
2. 分辨用戶是 **creator**（Nat，開發維護）還是**學員**（來學 LLM）
3. 學員模式下帶互動教學：跑預寫好的 Playwright scripts 操控網頁 demo、主持「預測→揭曉」hook 問答
4. 用 `init.py` 檢查並引導安裝 clone 後需要的環境

使用情境：**課堂跟著做**（Nat 在場，AI 是學員手上的輔助教練）。

## 範圍

- 教學劇本只涵蓋 **Tab ①②③④**（有互動操作的 tabs）
- 教材**雙語**（zh-TW + English，跟 repo 慣例一致），AI 對話語言跟隨學員
- 網頁瘦身：Hook 問答（Hook A / Hook B gate、Tab ⑧ flip-table recap）從網頁拿掉、內容搬進教材；`(?)` explainer 與 Tab ⓪ start-here panel 不動

### 不做（YAGNI）

- Tab ⑤⑥⑦⑧ 教學劇本（之後照 lesson 格式擴充）
- 自動角色偵測（開場直接問）
- Claude Code skill 包裝（之後可薄薄疊上，指向同一批 lesson 檔）
- 不動 server / agent 後端邏輯

## 1. 進場與角色判定

新增檔案：

- `AGENTS.md`（root，英文）+ `AGENTS.zh-TW.md`
- `CLAUDE.md`：只有一行 `@AGENTS.md`，內容不重複

AGENTS.md 結構：

1. **專案一句話** — 教學工具 + 本 repo 支援 AI 帶課
2. **開場 protocol** — AI 對用戶說的第一件事：問「你是這堂課的作者/老師（creator），還是來學 LLM 的學員？」
   - **Creator** → 開發模式：架構地圖（`agent/server.py` / `frontend/app.js` / `agent/tests/`）、test 指令（`pytest agent/tests -q`）、雙語維護慣例（每個 change 都 both langs）、cache-bust version 慣例
   - **學員** → 教學模式：先跑 `python3 init.py` 環境檢查，通過後照 `teaching/README.md` 帶課
3. **環境前置** — 指示 AI 用 `init.py` 檢查；常見錯誤的修復方式（server 沒起、port 被佔、model 沒下載）

## 2. init.py — clone 後環境檢查

`init.py` 放 repo root，**stdlib-only**（它的工作就是檢查依賴，自己不能有依賴）。

檢查項目（每項一行 ✓/✗ + 修復指令）：

| 檢查 | 通過條件 | 修復提示 |
|---|---|---|
| Python 版本 | ≥ 3.10 | 升級指引 |
| llama.cpp | `which llama-server` 找得到 | `brew install llama.cpp` |
| Model 0.6B | `~/models/Qwen3-0.6B-Q4_K_M.gguf` 存在 | `hf download Qwen/Qwen3-0.6B-GGUF Qwen3-0.6B-Q4_K_M.gguf --local-dir ~/models` |
| Model 4B | `~/models/Qwen3-4B-Q4_K_M.gguf` 存在 | `hf download Qwen/Qwen3-4B-GGUF Qwen3-4B-Q4_K_M.gguf --local-dir ~/models` |
| requests | import 得到 | `pip install requests` |
| playwright（教學用，選配） | import 得到 + chromium 裝了 | `pip install playwright && playwright install chromium` |
| Port 9000 | 空著或就是本專案 server | 顯示佔用 process，提示處理方式 |
| Port 8080 | 空著或是 llama-server | 顯示佔用 process（例：別的 dev server），提示處理方式 |

行為：

- `python3 init.py` — 只檢查、列結果、exit 0（全過）/ 1（有缺）
- `python3 init.py --fix` — 能自動裝的自動裝（pip 類），要人工的（brew、hf download ~2GB）印指令讓 AI / 用戶執行
- Playwright 標「教學用，選配」：creator 模式沒裝不算 fail
- 輸出對 AI 友善：一項一行、最後一行 summary（`READY` / `MISSING: x, y`），AI 看 stdout 就知道下一步

## 3. 教材結構（teaching/）

```
teaching/
  README.md / README.zh-TW.md     ← 帶課總綱：課程弧、節奏、AI 教學守則
  lesson-1-basics.md (+ zh-TW)    ← Tab ① token / 機率分佈
  lesson-2-product.md (+ zh-TW)   ← Tab ② system prompt / chat template
  lesson-3-reasoning.md (+ zh-TW) ← Tab ③ thinking 開關
  lesson-4-agent.md (+ zh-TW)     ← Tab ④ function calling agent loop
  demos/
    demo_tab1.py … demo_tab4.py   ← Playwright(Python) headed scripts
```

每份 lesson 固定格式：

1. **學習目標**（1-3 條）
2. **Hook 問答** — 從網頁搬來的預測題；AI 先問學員、收集預測、不給答案
3. **Demo 段落**（多段）— 每段：跑哪個 script、畫面上會發生什麼、解說重點
4. **學員動手** — 讓學員自己操作一次的任務（例：換 preset 重跑、點不同 token）
5. **揭曉與回顧** — 對照學員開頭的預測，講透概念
6. **常見學員問題** — Q&A 素材

AI 教學守則（寫在 teaching/README.md）：

- 一次只做一步，等學員回應再往下
- 先問預測再 demo（hook 問答永遠在 demo 之前）
- 學員答錯不直接糾正，用 demo 讓他自己看到
- 對話語言跟學員（教材雙語，照學員語言取用對應檔）

## 4. Demo scripts（Playwright Python）

- 每個 script 自包含可獨立跑：開 chromium **headed** → 連 `http://localhost:9000/`（zh-TW 用 `/index.zh-TW.html`，`--lang` 參數切換）→ 該 tab 操作序列（切 tab、等 model swap banner、選 preset、送出、等 token 串完、點 token 開機率 bar chart）
- 關鍵步驟間放慢（`slow_mo` + 顯式 wait），學員看得清楚畫面在動
- stdout 印進度（`[1/4] 選 preset：床前明月光`），AI 邊看邊在 terminal 同步解說
- 失敗 exit code 非 0 + 人話錯誤訊息（server 沒起 / model 沒載 / selector 找不到），AGENTS.md 教 AI 對應修法
- `--smoke` 模式：headless、不放慢，快跑一遍當自驗（手動跑或未來 CI 用）
- 依賴 `playwright` pip 套件（init.py 檢查項）

## 5. 網頁瘦身（hook 拆除）

- `index.html` / `index.zh-TW.html`：移除 Hook A gate（Tab ⓪→① 前，`data-hook="A"`）、Hook B gate（Tab ④ 前，`data-hook="B"`）、Tab ⑧ `data-hook-recap` flip-table 區塊；原本被 gate 包住的 `.hook-content` 內容直接顯示
- 刪 `frontend/hooks.js` + 兩份 HTML 的 script tag，bump cache-bust version（`?v=NN`）
- Hook A/B 題目原文搬進 lesson-1 / lesson-4 的 Hook 問答段；flip-table 回顧內容搬進 lesson-4 揭曉段——**內容不丟，換 AI 主持**
- `(?)` explainer、Tab ⓪ start-here panel 不動

## 6. 測試與驗證

- 既有 43 個 pytest 不受影響（hook 為純前端）；改完跑 `pytest agent/tests -q` 確認
- demo scripts 用 `--smoke` 自驗（需 server + model 在場，屬手動驗證步驟）
- init.py 加 pytest（mock `which` / 檔案存在 / port 檢查，跟既有 tests 同風格放 `agent/tests/`）
- 端到端驗收：clean clone → 開 Claude Code 說「hi」→ AI 問角色 → 答「學員」→ AI 跑 init.py 並引導補裝 → 帶完 lesson-1（含跑 demo_tab1.py 畫面會動）

## 檔案異動總覽

| 動作 | 檔案 |
|---|---|
| 新增 | `AGENTS.md`、`AGENTS.zh-TW.md`、`CLAUDE.md`、`init.py`、`teaching/`（README ×2 + lesson ×8 + demos ×4）、`agent/tests/test_init.py` |
| 修改 | `frontend/index.html`、`frontend/index.zh-TW.html`（拆 hook + bump version）、`README.md`、`README.zh-TW.md`（加 AI 帶課說明一節） |
| 刪除 | `frontend/hooks.js` |
