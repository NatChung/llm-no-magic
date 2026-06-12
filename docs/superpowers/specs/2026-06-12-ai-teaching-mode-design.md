# AI 帶課模式 Design（AGENTS.md + teaching/ + Playwright demos + init）

日期：2026-06-12
狀態：已過 doc review（rev 2）

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
- 網頁瘦身：Hook 問答（Hook A / Hook B gate、Tab ⑧ flip-table recap）從網頁拿掉、內容改寫遷移進教材；`(?)` explainer 不動；Tab ⓪ start-here panel 保留，但其中「課程中有兩個時刻會問你問題」段落改寫成指向 AI 帶課流程（兩份 HTML 同步改）

### 不做（YAGNI）

- Tab ⑤⑥⑦⑧ 教學劇本（之後照 lesson 格式擴充）
- 自動角色偵測（開場直接問）
- Claude Code skill 包裝（之後可薄薄疊上，指向同一批 lesson 檔）
- **不用 Playwright MCP 即時操控** — demo 一律走預寫 script，實作者不要「順手」改用 MCP
- 不動 server / agent 後端邏輯

## 1. 進場與角色判定

新增檔案：

- `AGENTS.md`（root，英文）+ `AGENTS.zh-TW.md`（AGENTS.md 開頭互相 cross-link；zh-TW 版給人讀與中文對照用 — agent 自動載入的是 AGENTS.md）
- `CLAUDE.md`：只有一行 `@AGENTS.md`，內容不重複

AGENTS.md 結構：

1. **專案一句話** — 教學工具 + 本 repo 支援 AI 帶課
2. **開場 protocol** — AI 對用戶說的第一件事：問「你是這堂課的作者/老師（creator），還是來學 LLM 的學員？」
   - **Creator** → 開發模式：架構地圖（`agent/server.py` / `frontend/app.js` / `agent/tests/`）、test 指令（`pytest agent/tests -q`）、雙語維護慣例（每個 change 都 both langs）、cache-bust version 慣例
   - **學員** → 教學模式：先跑 `python3 init.py` 環境檢查（學員模式 playwright 必裝，AI 引導補裝），通過後照 `teaching/README.md` 帶課
3. **環境前置** — 指示 AI 用 `init.py` 檢查；常見錯誤的修復方式（server 沒起、port 被佔、model 沒下載、model swap 失敗）

另外：`README.md` / `README.zh-TW.md` 各加一小節「AI 帶課模式 / AI-guided mode」——說明用 Claude Code / Codex 開 repo 會發生什麼（AI 問角色 → init 檢查 → 帶課），指向 AGENTS.md 與 `teaching/`。

## 2. init.py — clone 後環境檢查

`init.py` 放 repo root，**stdlib-only**（它的工作就是檢查依賴，自己不能有依賴）。

檢查項目（每項一行 ✓/✗ + 修復指令）：

| 檢查 | 通過條件 | 修復提示 |
|---|---|---|
| Python 版本 | ≥ 3.10 | 升級指引 |
| llama.cpp | `which llama-server` 找得到 | `brew install llama.cpp` |
| hf CLI | `which hf` 找得到 | `pip install -U "huggingface_hub[cli]"` |
| Model 0.6B | `~/models/Qwen3-0.6B-Q4_K_M.gguf` 存在 | `hf download Qwen/Qwen3-0.6B-GGUF Qwen3-0.6B-Q4_K_M.gguf --local-dir ~/models` |
| Model 4B | `~/models/Qwen3-4B-Q4_K_M.gguf` 存在 | `hf download Qwen/Qwen3-4B-GGUF Qwen3-4B-Q4_K_M.gguf --local-dir ~/models` |
| requests | import 得到 | `pip install requests` |
| playwright（教學用） | import 得到 + chromium 裝了 | `pip install playwright && playwright install chromium` |
| Port 9000 | 空著，或 `GET http://localhost:9000/` 回應且 body 含 `llm-no-magic`（= 本專案 server 已在跑） | 其他 process 佔用時用 `lsof -nP -iTCP:9000 -sTCP:LISTEN` 顯示佔用者，提示處理 |
| Port 8080 | 空著，或 `GET http://localhost:8080/v1/models` 回 200（= llama-server） | 同上以 lsof 顯示佔用 process（例：別的 dev server），提示處理 |

行為：

- `python3 init.py` — 只檢查、列結果。Exit code：核心項全過 = 0、有核心項缺 = 1。playwright 缺**不影響 exit code**，但 summary 會標 `WARN teaching: playwright missing`（AGENTS.md 規定學員模式看到此 WARN 必須先補裝）
- `python3 init.py --fix` — 能自動裝的自動裝（pip 類，用 `python3 -m pip install`；遇 PEP 668 externally-managed 錯誤時印 venv 建立指引），要人工的（brew、hf download ~2GB）印指令讓 AI / 用戶執行
- 輸出對 AI 友善：一項一行、最後一行 summary（`READY` / `READY + WARN …` / `MISSING: x, y`），AI 看 stdout 就知道下一步

## 3. 教材結構（teaching/）

```
teaching/
  README.md / README.zh-TW.md     ← 帶課總綱：課程弧、節奏、AI 教學守則
  lesson-1-basics.md (+ zh-TW)    ← Tab ① token / 機率分佈
  lesson-2-product.md (+ zh-TW)   ← Tab ② system prompt / chat template
  lesson-3-reasoning.md (+ zh-TW) ← Tab ③ thinking 開關
  lesson-4-agent.md (+ zh-TW)     ← Tab ④ function calling agent loop
  demos/
    demo_tab1.py … demo_tab4.py   ← Playwright(Python) headed scripts（支援 --segment）
```

每份 lesson 固定格式：

1. **學習目標**（1-3 條）
2. **Hook 問答** — 從網頁搬來的預測題；AI 先問學員、收集預測、不給答案
3. **Demo 段落**（多段）— 每段對應一次 script invocation（`demo_tabN.py --segment K`）：預告詞（跑之前 AI 跟學員說會看到什麼）、畫面上會發生什麼、debrief 解說重點
4. **學員動手** — 讓學員自己操作一次的任務（例：換 preset 重跑、點不同 token）
5. **揭曉與回顧** — 對照學員開頭的預測，講透概念
6. **常見學員問題** — Q&A 素材

### Hook 內容遷移地圖（網頁 → 教材，改寫不是照搬）

| 來源（現網頁） | 去處 |
|---|---|
| Hook A before 題目（`data-hook="A"` 問卷） | lesson-1 §2 Hook 問答 |
| Hook A revisit 內容（①②③ recap + after 題，hooks.js 渲染） | lesson-1 §5 揭曉與回顧 |
| Hook B before 題目（`data-hook="B"` 問卷） | lesson-4 §2 Hook 問答 |
| Hook B revisit 內容（④⑤⑥⑦ recap + after 自由作答） | lesson-4 §5 揭曉與回顧；提及 Tab ⑤⑥⑦ 的部分改寫成「課後導讀」指引（這些 tab 不在帶課範圍） |
| Tab ⑧ flip-table recap（`data-hook-recap`） | lesson-4 §5 揭曉與回顧（同上，⑤〜⑧ 內容收斂成課後導讀） |

AI 教學守則（寫在 teaching/README.md）：

- 一次只做一步，等學員回應再往下
- 先問預測再 demo（hook 問答永遠在 demo 之前）
- 學員答錯不直接糾正，用 demo 讓他自己看到
- 對話語言跟學員（教材雙語，照學員語言取用對應檔）
- Demo 節奏固定三拍：**預告 →（blocking）跑 script → 讀 step log debrief** — 不嘗試「邊跑邊解說」（Bash blocking 拿不到即時 stdout）

## 4. Demo scripts（Playwright Python）

- **Segment 模型**：每個 tab 一個 script 檔，`--segment K` 跑第 K 段。每次 invocation 自包含：開新 chromium **headed** → 連 `http://localhost:9000/`（`--lang zh-TW` 連 `/index.zh-TW.html`）→ 快速做完該段的前置動作（正常速）→ 焦點動作用 slow_mo 放慢讓學員看清 → 結束關 browser、exit。下一段重開（課堂上可接受，換來 stateless 簡單）
- 操作序列涵蓋：切 tab、等 model swap、選 preset、送出、等 token 串完、點 token 開機率 bar chart
- **Timing contracts**（防 flaky，實作必須遵守）：
  - 切 tab 後等 `body:not(.swapping)`（swap 進行中 `body.swapping` 會對 `.tab`/`.run`/`.stop` 設 `pointer-events:none`）
  - 註冊 `page.on("dialog")` handler：swap 失敗會 `alert()`（server 端 10s timeout），捕捉後印人話錯誤（「model swap 失敗：…」）退出，不要讓 script 死在後續 selector 找不到
  - 「token 串完」的訊號 = `.run` 重新 enabled（或 `.stop` disabled）
- stdout step log：每步一行（`[1/4] 選 preset：床前明月光`），跑完 AI 讀 log debrief
- 失敗 exit code 非 0 + 人話錯誤訊息（server 沒起 / model 沒載 / swap 失敗 / selector 找不到），AGENTS.md 教 AI 對應修法
- `--smoke` 模式：headless、不放慢、跑全部 segments，當自驗（手動跑或未來 CI 用）
- 依賴 `playwright` pip 套件（init.py 檢查項）

## 5. 網頁瘦身（hook 拆除）

兩份 HTML（`index.html` / `index.zh-TW.html`）同步動：

- 移除三個 hook 區塊：Hook A gate（`data-hook="A"`）、Hook B gate（`data-hook="B"`）、Tab ⑧ `data-hook-recap` section
- `.hook-gate` 與 `.hook-content` 是**兄弟節點**（content 非被 gate 包住；hidden 是 hooks.js runtime 控制、靜態 markup 沒有 `hidden`）。拆法：刪 gate 區塊後，**unwrap** `.hook-content` wrapper（children 提升為 panel 直接子元素 — Tab ① desktop grid 的 `.prompt-area`/`.output-area`/`.probs-area` 必須是 panel 直接子元素，grid 才成立）
- 一併移除 `.hook-content` 內的 `.hook-revisit-bar` 回顧按鈕（hooks.js 刪掉後它們是死按鈕）
- 刪 `frontend/hooks.js` + 兩份 HTML 的 script tag；刪 `styles.css` 中 hook 相關規則（含 `.hook-content { display: contents; }` — unwrap 後不再需要）
- Tab ⓪ start-here panel：改寫「課程中有兩個時刻（Tab ① 跟 Tab ④ 之前）會問你一個問題」段落 → 指向 AI 帶課流程（hook 拆除後該承諾不再成立）
- 順手清掉 stale comment「Tab 4: Agent — 真執行 tools via :8082 backend」（ports 已併入 9000）
- bump cache-bust version（`?v=NN`）
- `(?)` explainer 不動

## 6. 測試與驗證

- 既有 43 個 pytest 不受影響（hook 為純前端、tests 無 hook 引用——已查證）；改完跑 `pytest agent/tests -q` 確認
- demo scripts 用 `--smoke` 自驗（需 server + model 在場，屬手動驗證步驟）
- `agent/tests/test_init.py`：plain pytest functions + mock（同既有風格）。例：mock `shutil.which("llama-server") → None` 時，輸出含 `✗` 與 `brew install llama.cpp`、exit code 1
- 端到端驗收：clean clone → 開 Claude Code 說「hi」→ AI 問角色 → 答「學員」→ AI 跑 init.py 並引導補裝 → 帶完 lesson-1（含跑 demo_tab1.py 畫面會動）

## 實作順序建議（單一 plan、三段）

1. **網頁瘦身** — hook 拆除 + Tab ⓪ 文案改寫 + cache bust（獨立可驗收：頁面功能不變、hook 消失）
2. **進場層** — AGENTS.md ×2 + CLAUDE.md + init.py + test_init.py + README 加節
3. **教材層** — teaching/ lessons ×8 + README ×2 + demos ×4

## 檔案異動總覽

| 動作 | 檔案 |
|---|---|
| 新增 | `AGENTS.md`、`AGENTS.zh-TW.md`、`CLAUDE.md`、`init.py`、`teaching/`（README ×2 + lesson ×8 + demos ×4）、`agent/tests/test_init.py` |
| 修改 | `frontend/index.html`、`frontend/index.zh-TW.html`（拆 hook + Tab ⓪ 文案 + 清 stale comment + bump version）、`frontend/styles.css`（刪 hook 規則）、`README.md`、`README.zh-TW.md`（加「AI 帶課模式」一節） |
| 刪除 | `frontend/hooks.js` |
