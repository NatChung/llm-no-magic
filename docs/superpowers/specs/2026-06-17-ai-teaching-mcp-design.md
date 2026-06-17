# AI 帶課互動模型 v2 — MCP 驅動 Design

日期：2026-06-17
狀態：待 review
前一版：[2026-06-12-ai-teaching-mode-design.md](./2026-06-12-ai-teaching-mode-design.md)(預寫 script 版,已實作並 merge)

## 背景與動機

v1（預寫 Playwright script + AI 解說）實際試跑後，暴露三個 UX 問題，根因都是**學生面對「兩個瀏覽器 + 兩處文字」不知看哪**：

1. CLI 教學旁白的文字，跟網頁自己的解說文字重疊 — 學生不知道看 CLI 還是看網頁
2. AGENTS.md 叫學生自己開 `localhost:9000`（瀏覽器 A），demo script 又自己開 headed 視窗（瀏覽器 B）— 兩個瀏覽器；而學生自己開的那個，他也不知道要做什麼
3. demo script 跑完就 `browser.close()` — 學生沒機會在同個畫面接手試

## 目標

把教學從「script 驅動、開關自己的瀏覽器」改成「**AI 用 browser MCP 驅動唯一一個持久瀏覽器**」：學生只看這一個 AI 操作的瀏覽器，AI 在 CLI 旁白，demo 完瀏覽器留著讓學生接手。

使用情境不變：**課堂跟著做**（Nat 在場，AI 是學員手上的輔助教練）。目標 agent：**Codex 與 Claude Code 都是主力**，MCP 設定盡量自動化、不煩學生。

## 範圍

- 教學涵蓋 **Tab ①②③④**（不變）
- 教材**雙語**（zh-TW + English，不變）
- 改動集中在「怎麼驅動瀏覽器」與「內容分工」，不動後端

### 不做（YAGNI）

- 不做「用 MCP 收合網頁文字」的機制（多數 `(?)` 本來就收合，工程不值得）
- 不採 Chrome DevTools MCP（偏 debug，Playwright MCP 已足夠）
- 不刪 `(?)` explainer（收合、零干擾、留作選配書面版）
- 不做學生端的雙路徑 fallback（MCP 對兩種 agent 都能自動配置，不需要 script 當學生 fallback）
- 不動 `agent/server.py` / `agent/agent.py` / 模型 swap 邏輯 / Tab ⑤⑦ 純文章

## 1. 驅動機制：Playwright MCP

選 **Playwright MCP**（`@playwright/mcp`，透過 `npx` 執行，Microsoft 官方；版本釘住見 §2.3）：

- 走 accessibility tree、用 ref 操作，對 AI 驅動穩定（非像素點擊）
- 預設 headed、瀏覽器持久（不主動關）→ 天然滿足目標 3（留著給學生）
- 跟 Nat 既有 CLAUDE.md 的 Playwright MCP 用法一致
- 依賴 Node.js 18+（透過 `npx` 執行；MCP server 是 Node 套件，無 Python 等價物）

（Chrome DevTools MCP 是已知備案，本設計不採用。）

## 2. MCP 自動配置（兩種 agent）

repo 內附設定檔，兩種 agent 開 repo 時自動撿起：

### 2.1 Claude Code — `.mcp.json`（repo 根，新增）
```json
{
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@playwright/mcp@<pinned>"]
    }
  }
}
```
開 repo 時 Claude Code 偵測到、顯示 `⏸ Pending approval`，學生核准一次即可。（`@<pinned>` 見 §2.3）

### 2.2 Codex — `.codex/config.toml`（repo 根，新增）
```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@<pinned>"]
```
官方文件確認 Codex CLI 會把 project-root `.codex/config.toml` 的 `[mcp_servers.*]` merge 在 global 之上 — **但只對「trusted project」載入**。trust **不能**隨 repo 附帶（防自我授信），由以下其一建立:
- 學生**首次**用 Codex 開這個資料夾時的信任 prompt 答「trust」(最簡單) — 之後 committed 的 MCP 設定就自動載入
- 或腳本寫一條 trust entry 進學生 global config:`[projects."<repo 絕對路徑>"]` + `trust_level = "trusted"`(AGENTS.md 可提供這一行給 AI 執行)

> **注意:沒有 `codex trust .` 子指令**(文件查無);trust 來自上述 prompt 或 global config entry。Codex **Desktop** 與舊版 CLI 曾有「不讀 project MCP 設定」的 bug(issue #13025,已修向) — 實作時要在**目標 Codex CLI 版本**實測「committed `.codex/config.toml` + 信任後,Playwright tools 真的出現」。

### 2.3 版本釘住（reproducibility）
兩個設定檔的 `@playwright/mcp@<pinned>` **實作時釘成一個測過的固定版本**,不用 `@latest`:`@latest` 的 a11y tree / tool 名稱漂移會**無聲弄壞 playbook**(C2 的發散風險也靠這緩解)。要升版時刻意改、重跑 §8 的 MCP dry-run。

### 2.4 無法消除的一次性關卡（誠實揭露）
- **核准 / 信任點擊擋不掉** — agent 安全機制(防 repo 偷塞 MCP)。AGENTS.md 教 AI 引導學生過這關:Claude Code 點核准(`⏸ Pending approval`)、Codex 答首次信任 prompt(或執行上述 global trust entry)
- **Node/npx 新依賴** — 與 repo 原「零 npm」哲學有張力,但只是 `npx` 執行、非 build step

## 3. 既有 Playwright script 重定位

`teaching/demos/_common.py` + `demo_tab1..4.py` **保留，但角色從「學生 demo」改為「creator 跑的 `--smoke` 回歸 harness」**：

- 學生教學步驟改用 §5 的 lesson playbook，由 AI 用 MCP 執行
- script 的 `--smoke` 模式（headless、跑全段、印 step log）留作**回歸驗證**：確認頁面 preset / 結構 / CSS selector 沒漂移、生成流程沒壞（此趟已證實能抓校準 bug、selector 變動、race）
- **smoke 是「必要非充分」**:它走 Python Playwright + **CSS selector**;MCP 走 **a11y tree ref + AI 判斷**,是不同的 stack。smoke 綠**只代表**頁面底層沒回歸(MCP 也需要這個前提),**不代表** MCP/AI 路徑能跑(a11y label/role 可能漂移、AI 可能誤判等待)。實際教學路徑的驗證 = §8 的 **MCP dry-run**(creator 用 MCP 實走每個 tab 一遍),不能只靠 smoke
- `pip playwright` 從「教學必裝」降為「creator 驗證用」

不改 script 程式碼（它們本來就有 `--smoke`），只在文件上重新定位。

## 4. 內容分工：網頁=儀器、CLI=旁白

### 4.1 原則（寫進 AGENTS.md + teaching/README）
- **網頁是儀器**：學生看它「數字怎麼動」（token 蹦、機率圖、turn 軌跡、結果），不是讀它的文字
- **CLI/AI 是旁白**：所有解說由 AI 講；AI **不複述**網頁已有的文字
- 帶課時 AI 明確跟學生說：「**看螢幕看數字怎麼動，聽我講**」

### 4.2 內容調整
- `(?)` explainer **留著**（`<details>` 收合、零干擾；AI 不唸，但可說「想看文字版點那個 (?)」，standalone / 自學者仍可展開）
- **trim** 兩份 HTML 的 always-on 重複散文（指明位置，雙份同步）：
  - Tab ⓪ 起步面板（`index.zh-TW.html` ~L87-93，4 段）：**保留**「這是什麼 / 這堂課要回答的問題」框架（前 1-2 段）；**砍掉**結尾手動導覽 CTA「準備好了?點上面的 ① 基礎開始」(v2 由 AI 用 MCP 導覽,這句已過時) 與任何 always-on 重複句，收斂成「這是一個儀器,跟著 AI 看數字怎麼動」
  - 各互動 tab 最長的 always-visible 描述段（已確認 Tab ④ `index.zh-TW.html` ~L333「每個 turn 結束都會累積進 messages…」那段）→ 砍短，細節交給 AI / `(?)`；其餘 tab 由實作者掃出「最長且與 AI 旁白重複」的段落同樣處理
- 改動雙份 HTML 同步、bump cache-bust version

## 5. AGENTS.md + lesson playbook 改動

### 5.1 AGENTS.md（雙語）學員模式改寫
- **改成**：AI 用 browser MCP 開頁面並驅動；demo 後**不關**瀏覽器、交給學生試
- **補**：MCP 核准 / 信任引導（Claude Code 核准、Codex 信任）；§4.1 分工原則；「demo 一律走 MCP playbook，不要改用預寫 script 當學生路徑」
- Troubleshooting 補：MCP 沒上線 / 沒核准時怎麼引導

**必須移除 / 反轉的 v1 確切字串**（這些與 v2 直接衝突，實作要逐一處理，不能漏）：
- `AGENTS.md` ~L46-48 + `AGENTS.zh-TW.md` 對應：v1 的硬禁令「**Do NOT drive the page with a live browser-automation MCP**; the scripts are the demo」→ **反轉**成「demo 走 browser MCP」
- `AGENTS.md` L38-39 / `AGENTS.zh-TW.md` L39-40：「Teaching ALSO requires playwright… install it before continuing」→ **改**成「教學需要 browser MCP（Node/npx），pip playwright 只有 creator 跑 smoke 才需要」
- `AGENTS.md` L42：「have the student open http://localhost:9000/」→ **刪**（改由 AI 用 MCP 開）
- `teaching/README.md` L43-44 / `.zh-TW.md` L35-36：「init.py 全綠（**含 playwright**）」+「學生 browser 開著 localhost:9000（demo script 會自己另開視窗）」→ **改寫**（這正是「兩個瀏覽器」病灶，必須消除，不是只把 demo 換 MCP）

### 5.2 lesson 的「Demo 段落」→ MCP playbook
每課把「跑 `demo_tabN.py --segment K`」改寫成 **AI 用 MCP 執行的精確步驟**，步驟內容（選哪個 preset、點哪、看什麼、預期結果）**不變**，只換執行者。範例（lesson-1 段落 1）：

```
AI 用 browser MCP:
1. navigate http://localhost:9000/index.zh-TW.html(英文用 /)
2. 點 Tab ①;等 model swap 完成(見 §5.3 怎麼判斷)
3. 選 preset「床前明月光,疑是地上」
4. 點「送出」;等生成結束(見 §5.3)
5. 點第一個 token → top-10 機率圖出現(預期接「霜」、top-1 94%+);旁白解說
6. 留著畫面讓學生自己換 preset 試
```
playbook 鎖定的元素 / preset 與 §3 的 smoke script **概念一致**(但 MCP 走 a11y、smoke 走 CSS — 見 C2)。
（瀏覽器本來就 headed、學生直接看得到,所以 playbook **不需要**「截圖給學生看」這一步;AI 若要截圖那是給**自己**感知用,非學生步驟。）

### 5.3 AI 用 MCP 怎麼觀察「等待」與「失敗」（v2 最大的確定性損失，必須明寫）

script 版靠 DOM 精準訊號(`body:not(.swapping)`、MutationObserver latch 抓 `.run` re-enable、`page.on("dialog")` 接 swap-fail `alert()`)。這些**不會自動轉成 a11y snapshot**,playbook 要明定 AI 怎麼用「重複快照 + 可見訊號」替代:

- **等 model swap 完成**:切 tab 後頁面顯示可見的「載入 X 中…」banner(可見文字、在 a11y tree 裡)。AI **重複 snapshot 直到 banner 文字消失**再往下。第一次 swap 約 3-5 秒(0.6B)、切 4B 更久 — 預告學生稍等
- **等生成結束**:`.run`「送出」鈕在生成中是 disabled。AI snapshot 看該鈕**回到 enabled**(a11y 的 disabled state),或看輸出區**文字停止增長**。注意短生成的 disabled 視窗可能很短(~300ms,見 race fix),所以以「輸出出現且穩定 / run 鈕可按」為準,不要去抓那個瞬態
- **swap 失敗**:server 端 10s timeout → 前端 `alert()`「Model swap failed…」。Playwright MCP 有 dialog 處理能力;AI 看到 dialog 要**讀訊息 + 關閉 + 用人話跟學生說「模型載入失敗」**並照 Troubleshooting(port 8080)處理,**不要**卡在後續找不到的元素上
- **接受度**:MCP 路徑比 script 不確定(a11y 漂移、AI 等待判斷)。緩解 = §2.3 釘版本 + §8 dry-run + 此節明確訊號。playbook 寫精確(鎖哪個可見文字/角色)、不要含糊「等一下」

## 6. init.py 改動

新增 / 調整檢查項：

| 檢查 | 通過條件 | 修復 |
|---|---|---|
| Node / npx（教學用） | `which npx` 找得到 | 裝 Node.js 18+（`brew install node` 或 nodejs.org） |
| browser MCP 設定就位 | repo 根的 `.mcp.json` /（偵測到 Codex 時）`.codex/config.toml` 存在且含 playwright entry | `--fix` 還原（見下） |
| playwright（creator 驗證用，降級） | import 得到 + chromium 裝了 | `pip install playwright && playwright install chromium`（標 `WARN creator:`，學生缺不算 fail） |

- **設定檔隨 repo 附帶（committed）**：`git clone` 後 `.mcp.json` 就在、`.codex/config.toml` 也在。所以這項檢查正常情況**直接通過** — init.py 是 sanity check,不是主要產生者
- **檢查方式必須 stdlib-only**:`.mcp.json` 用 stdlib `json` parse 沒問題;**但 `.codex/config.toml` 不能用 `tomllib`**(那是 Python 3.11+,init.py 自己的門檻是 ≥3.10)→ 改用**字串掃描**(檢查檔案含子字串 `[mcp_servers.playwright]` 即視為就位)。`--fix` **寫**設定檔時也不需 toml 函式庫,直接寫 §2 的固定字串內容
- **agent 偵測**（決定檢哪些設定 + 提示哪種核准）：看 `~/.claude.json`（Claude Code）/ `~/.codex/`（Codex）存在與否。**兩者都在(如 Nat 的機器未來裝 Codex)就兩個設定檔都檢查、AGENTS.md 兩種核准都引導**;都不在則只提醒「用支援 browser MCP 的 agent 開」
- **`--fix` 還原**：對偵測到的 agent,設定檔被刪 / 缺 playwright entry 時重寫成 §2 內容;正確則跳過
- **核准 / 信任狀態 init.py 不驗證**（在 agent 自己的 global config、跨 agent 不可靠）→ 由 AGENTS.md 在帶課流程引導(Claude Code 點核准、Codex 首次信任 prompt)
- 既有檢查（Python / llama.cpp / hf / 兩個 model / requests / port 9000 / 8080）不變
- summary 行語意調整：教學關鍵改成「Node + MCP 設定就位」;`playwright(creator 驗證用)` 缺只出 `WARN creator:`，不影響 exit code
- `agent/tests/test_init.py` 補對應測試（mock `which("npx")`、mock agent 偵測、`--fix` 寫設定檔到 tmp_path）

## 7. 依賴總覽（學生 vs creator）

| | 學生（帶課） | creator（維護/驗證） |
|---|---|---|
| llama.cpp + 2 models + requests + Python server | ✓ | ✓ |
| Node/npx + browser MCP（Playwright MCP via npx） | ✓ | ✓ |
| MCP 設定檔（repo 內附）+ 一次核准/信任 | ✓ | ✓ |
| pip playwright + chromium | ✗（不需要） | ✓（跑 `--smoke`） |

## 8. 測試與驗證

兩層,缺一不可(C2:smoke 不能代表 MCP 路徑):
- **頁面底層回歸(自動)**：`python3 teaching/demos/demo_tab*.py --smoke` 全綠 + `pytest agent/tests -q`（含新 test_init）— 必要前提,非充分
- **MCP 教學路徑(半手動,真正的 net)**：creator 用 browser MCP **實走每個 tab 的 playbook 一遍**(切 tab→等 swap→選 preset→送出→等生成→點 token / 看結果),確認 a11y ref / 等待訊號 / dialog 處理在當前釘住的 MCP 版本下都 work。釘版本時(§2.3)或頁面結構動到時必跑
- init.py 真機：偵測 agent、`--fix` 寫對設定、`.codex/config.toml` 字串掃描 work、summary 與 exit code 一致
- 端到端（Claude Code）：fresh session 開 repo → 核准 Playwright MCP → 說「hi」→ AI 問角色 → 學員 → AI 用 MCP 開**一個**瀏覽器帶 lesson 1 → demo 後瀏覽器留著、學生自己換 preset 試
- 端到端（Codex）：首次開 repo 答信任 prompt（或 global trust entry）→ 在**目標 Codex CLI 版本**確認 committed `.codex/config.toml` 的 Playwright tools 真的出現（§2.2 的版本/Desktop caveat）→ 同流程

## 9. 已知風險（規劃時納入）

- **MCP 不如 script 確定**：a11y tree 漂移、AI 等待判斷 — 靠 §2.3 釘版本 + §5.3 明確訊號 + §8 dry-run 緩解
- **MCP token / 延遲成本**：每次 a11y snapshot 很大,一堂課用 MCP 反覆快照在課堂上可能慢、貴。playbook 盡量少快照（只在切 tab/送出/看結果的關鍵點），可接受度待課堂實測
- **兩套瀏覽器 stack**（Python smoke + Node MCP）有發散風險（C2）— 已用「smoke 必要非充分 + MCP dry-run」明確分工,不假裝等價

## 檔案異動總覽

| 動作 | 檔案 |
|---|---|
| 新增 | `.mcp.json`、`.codex/config.toml` |
| 修改 | `AGENTS.md`、`AGENTS.zh-TW.md`（學員模式改 MCP + 分工原則）、`teaching/README.md`/`.zh-TW.md`（分工原則 + demo 改 MCP）、`teaching/lesson-1..4`（×2 langs，Demo 段落 → MCP playbook）、`init.py`（Node/npx + MCP 設定 + agent 偵測 + playwright 降級）、`agent/tests/test_init.py`、`frontend/index.html` / `index.zh-TW.html`（trim always-on 散文 + bump cache-bust）、`README.md`/`.zh-TW.md`（AI 帶課段落更新成 MCP） |
| 不動（保留） | `teaching/demos/_common.py`、`demo_tab1..4.py`（角色改 smoke harness，程式不改）、`agent/` 後端、`frontend/styles.css`/`app.js`（除非 trim 牽動）、`(?)` explainer |

## 實作順序建議（單一 plan、四段）

1. **MCP 配置層** — `.mcp.json` + `.codex/config.toml` + init.py 改（Node/npx/agent 偵測/--fix/playwright 降級）+ test_init
2. **進場層** — AGENTS.md ×2 改寫（MCP + 分工原則）+ README 更新
3. **教材層** — teaching/README ×2 + lesson-1..4 ×2 的 Demo 段落改 MCP playbook。**注意這是真實衍生工作**:約 15 個 demo 段落 × 2 語言,每段從對應 `demo_tabN.py` 的步驟轉成 §5.2 格式 + 套 §5.3 的等待/失敗訊號,不是機械 find-replace（script 是 selector/preset 的事實來源,但等待訊號要重寫）
4. **網頁 trim** — 兩份 HTML 砍 always-on 重複散文 + Tab ⓪ CTA + bump cache-bust
