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

選 **Playwright MCP**（`npx -y @playwright/mcp@latest`，Microsoft 官方）：

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
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
```
開 repo 時 Claude Code 偵測到、顯示 `⏸ Pending approval`，學生核准一次即可。

### 2.2 Codex — `.codex/config.toml`（repo 根，新增）
```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest"]
```
Codex 只對「trusted project」載入 `.codex/`，學生需一次 `codex trust .`（或開 repo 時的信任 prompt 答應）。

### 2.3 無法消除的一次性關卡（誠實揭露）
- **核准 / 信任點擊擋不掉** — 這是 agent 的安全機制（防止 repo 偷塞 MCP）。AGENTS.md 教 AI 引導學生過這關（Claude Code 核准、Codex `codex trust .`）
- **Node/npx 新依賴** — 與 repo 原「零 npm」哲學有張力，但只是 `npx` 執行、非 build step

## 3. 既有 Playwright script 重定位

`teaching/demos/_common.py` + `demo_tab1..4.py` **保留，但角色從「學生 demo」改為「creator 跑的 `--smoke` 回歸 harness」**：

- 學生教學步驟改用 §5 的 lesson playbook，由 AI 用 MCP 執行
- script 的 `--smoke` 模式（headless、跑全段、印 step log）留作**回歸驗證**：確認頁面 preset / selector 沒漂移（此趟已證實能抓校準 bug、selector 變動、race）
- MCP playbook 與 smoke script **用同一組 selector / preset** → smoke 綠即代表 MCP 路徑也能跑
- `pip playwright` 從「教學必裝」降為「creator 驗證用」

不改 script 程式碼（它們本來就有 `--smoke`），只在文件上重新定位。

## 4. 內容分工：網頁=儀器、CLI=旁白

### 4.1 原則（寫進 AGENTS.md + teaching/README）
- **網頁是儀器**：學生看它「數字怎麼動」（token 蹦、機率圖、turn 軌跡、結果），不是讀它的文字
- **CLI/AI 是旁白**：所有解說由 AI 講；AI **不複述**網頁已有的文字
- 帶課時 AI 明確跟學生說：「**看螢幕看數字怎麼動，聽我講**」

### 4.2 內容調整
- `(?)` explainer **留著**（`<details>` 收合、零干擾；AI 不唸，但可說「想看文字版點那個 (?)」，standalone / 自學者仍可展開）
- **trim** 兩份 HTML 的 always-on 重複散文：
  - Tab ⓪ 起步面板的長段（AI 現在自己做 orientation）→ 砍短成一兩句「這是儀器，跟著 AI 看」
  - 各互動 tab 裡最長的 always-visible 描述段（例 Tab ④「每個 turn 結束都會累積進 messages…」那段）→ 砍短，細節交給 AI / `(?)`
- 改動雙份 HTML 同步、bump cache-bust version

## 5. AGENTS.md + lesson playbook 改動

### 5.1 AGENTS.md（雙語）學員模式改寫
- **拿掉**「叫學生自己開 `http://localhost:9000/`」這步
- **改成**：AI 用 browser MCP 開頁面並驅動；demo 後**不關**瀏覽器、交給學生試
- **補**：MCP 核准 / 信任引導（Claude Code 核准、Codex trust）；§4.1 分工原則；「demo 一律走 MCP playbook，不要改用預寫 script 當學生路徑」
- Troubleshooting 補：MCP 沒上線 / 沒核准時怎麼引導

### 5.2 lesson 的「Demo 段落」→ MCP playbook
每課把「跑 `demo_tabN.py --segment K`」改寫成 **AI 用 MCP 執行的精確步驟**，步驟內容（選哪個 preset、點哪、看什麼、預期結果）**不變**，只換執行者。範例（lesson-1 段落 1）：

```
AI 用 browser MCP:
1. navigate http://localhost:9000/index.zh-TW.html(英文用 /)
2. 點 Tab ①(data-tab="basic");等 swap banner(body.swapping)消失
3. 選 preset「床前明月光,疑是地上」
4. 點「送出」;等生成結束(.run 回到 enabled)
5. 點第一個 token;截圖給學生看 top-10 機率圖(預期接「霜」、top-1 94%+)
6. 旁白解說,然後留著畫面讓學生自己換 preset 試
```
playbook 用的 selector / preset 與 §3 的 smoke script 一致。

## 6. init.py 改動

新增 / 調整檢查項：

| 檢查 | 通過條件 | 修復 |
|---|---|---|
| Node / npx（教學用） | `which npx` 找得到 | 裝 Node.js 18+（`brew install node` 或 nodejs.org） |
| browser MCP 設定就位 | repo 根的 `.mcp.json` /（偵測到 Codex 時）`.codex/config.toml` 存在且含 playwright entry | `--fix` 還原（見下） |
| playwright（creator 驗證用，降級） | import 得到 + chromium 裝了 | `pip install playwright && playwright install chromium`（標 `WARN creator:`，學生缺不算 fail） |

- **設定檔隨 repo 附帶（committed）**：`git clone` 後 `.mcp.json` 就在、`.codex/config.toml` 也在。所以這項檢查正常情況**直接通過** — init.py 是 sanity check,不是主要產生者
- **agent 偵測**（決定提示哪種核准）：看 `~/.claude.json`（Claude Code）/ `~/.codex/`（Codex）存在與否
- **`--fix` 還原**：設定檔被刪 / 缺 playwright entry 時重寫成 §2 內容;正確則跳過
- **核准 / 信任狀態 init.py 不驗證**（在 agent 自己的 config、跨 agent 不可靠）→ 由 AGENTS.md 在帶課流程引導學生點核准 / `codex trust .`
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

- creator 回歸：`python3 teaching/demos/demo_tab*.py --smoke` 全綠 + `pytest agent/tests -q`（含新 test_init）
- init.py 真機：偵測 agent、`--fix` 寫對設定、summary 與 exit code 一致
- 端到端（Claude Code）：fresh session 開 repo → 核准 Playwright MCP → 說「hi」→ AI 問角色 → 學員 → AI 用 MCP 開瀏覽器帶 lesson 1（一個瀏覽器、AI 操作）→ demo 後瀏覽器留著、學生自己換 preset 試
- 端到端（Codex）：`codex trust .` → 同流程驗證設定檔被撿起、MCP 可用

## 檔案異動總覽

| 動作 | 檔案 |
|---|---|
| 新增 | `.mcp.json`、`.codex/config.toml` |
| 修改 | `AGENTS.md`、`AGENTS.zh-TW.md`（學員模式改 MCP + 分工原則）、`teaching/README.md`/`.zh-TW.md`（分工原則 + demo 改 MCP）、`teaching/lesson-1..4`（×2 langs，Demo 段落 → MCP playbook）、`init.py`（Node/npx + MCP 設定 + agent 偵測 + playwright 降級）、`agent/tests/test_init.py`、`frontend/index.html` / `index.zh-TW.html`（trim always-on 散文 + bump cache-bust）、`README.md`/`.zh-TW.md`（AI 帶課段落更新成 MCP） |
| 不動（保留） | `teaching/demos/_common.py`、`demo_tab1..4.py`（角色改 smoke harness，程式不改）、`agent/` 後端、`frontend/styles.css`/`app.js`（除非 trim 牽動）、`(?)` explainer |

## 實作順序建議（單一 plan、四段）

1. **MCP 配置層** — `.mcp.json` + `.codex/config.toml` + init.py 改（Node/npx/agent 偵測/--fix/playwright 降級）+ test_init
2. **進場層** — AGENTS.md ×2 改寫（MCP + 分工原則）+ README 更新
3. **教材層** — teaching/README ×2 + lesson-1..4 ×2 的 Demo 段落改 MCP playbook
4. **網頁 trim** — 兩份 HTML 砍 always-on 重複散文 + Tab ⓪ + bump cache-bust
