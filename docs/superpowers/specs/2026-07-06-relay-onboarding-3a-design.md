# AI 帶課 relay v3 — 子專案 3a:進場拆除 + init.py + demos smoke Design

日期:2026-07-06
狀態:待 review
母 spec:[2026-06-28-ai-teaching-relay-design.md](./2026-06-28-ai-teaching-relay-design.md)(§6 進場、§9 smoke harness、§11 依賴、檔案異動表)
前置:relay 後端(`d5c3162..6800259` + `a930f23` + `e0ef59b`)、前端純儀器化(`ca84733..677f352`)皆已 ship + review + 實機驗證。

## 背景

母 spec 的落地拆成三個 follow-on:**後端(done)→ 前端(done)→ 進場 + 教材(this)**。第三塊在 brainstorm 時再拆成兩個各自 spec→plan→execute 的子專案:

- **3a(本文)**:進場拆除 + `init.py` + `test_init.py` + demos smoke 重接 + 進場文件 + 兩個小後端 harden。**純機械/可自動驗證**,適合 subagent-driven 連續執行。
- **3b(另開)**:lesson ①–④ ×2 語言改寫(~15 段 × 2),需 Nat 逐段先校中文,節奏不同,獨立 spec。

## 目標

讓「fresh clone → 開 Claude Code/Codex → `python3 init.py` → 起 server → AI 帶課」這條**進場路徑**在 v3(relay)下成立且可靠:拆掉 v2 的 browser-MCP 依賴、把環境檢查改成驗 relay(`/health`)、把 creator 的頁面回歸 smoke 從「MCP/preset 驅動」retarget 成「`POST /drive` 驅動 + Playwright 觀察」。

## 範圍

**做(3a)**:`init.py` 改寫、刪 v2 MCP 設定檔、`test_init.py` 改寫、`teaching/demos/*` 重接第二層 smoke、進場文件(AGENTS/README/teaching-README 的**進場段**)、兩個後端 harden(swap-state reset、legacy `/swap` route)。

**不做(明確排除)**:
- **lesson ①–④ 內容改寫**(→ 3b);本輪只動 lesson 的**進場引導**不動**播放腳本**。
- **前端 mid-generation 斷線 wedge**(母 spec 前端 final-review Important #3):需設計思考(heartbeat watchdog vs 直覺 `es.onerror` re-enable 會誤放行→雙擊 409),單人低機率,另開 follow-up。
- **Tab ⑥ skill、純文章 tab ⓪⑤⑦⑧**:不動(全程貫穿的界線)。
- 模型 swap 底層 `handle_swap`/`SWAP_LOCK`/`_detect_model`:除 §6 的 state-reset 外不動。

## §1 `init.py` 改寫

現況(`init.py` 逐項):Python / llama.cpp / hf CLI / Model 0.6B / Model 4B / requests / **Node/npx(教學用)** / **browser MCP 設定(教學用)** / Port 9000 / Port 8080 / playwright(creator)。

**移除**(v2 MCP 殘留):
- `check_node()`(`Node/npx(教學用)`)—— v3 學生不需 Node。
- `check_mcp_config()` + `_detect_agents()` + `_read_safe()`(僅 MCP 檢查在用)。
- `MCP_JSON` / `CODEX_TOML` 常數、`restore_mcp_config()`、以及 `main()` 中 `--fix` 分支對 `restore_mcp_config()` 的呼叫。
- `run_checks()` 移除 `check_node()`、`check_mcp_config()` 兩項。

**新增** `check_health()`:
- 語意:**server 若在跑(port 9000 是本專案),`GET http://localhost:9000/health` 必須立即回 200 且 body 含 `"status": "ok"`**。
- **關鍵**:timeout 設短(如 1–2s)。不可探 `/events`(SSE 不結束 → `_http_get` 的 `r.read` 會 block 到 timeout 誤判)或 `/drive`(POST 會觸發生成)。用既有 `_http_get()`(GET + 短 timeout,已符合)。
- server 未起時(port 9000 空)→ 此項 `ok=True`、detail 註「server 之後再起」(與 `check_port_9000` 的空-port 行為一致),**不當失敗**。避免「還沒起 server 就被 init.py 判 down」。
- 定位:核心項(非 warn-only);但只有在「server 在跑卻 `/health` 不回 200/hang」時才失敗。
- 放進 `run_checks()`(建議排在 `check_port_9000` 之後,語意相鄰)。

**保留不動**:`check_python` / `check_llama` / `check_hf` / `check_model` ×2 / `check_requests` / `check_port_9000` / `check_port_8080` / `check_playwright`(creator warn-only)/ `apply_fixes` / `summarize` 的 warn 分組機制(`teaching`/`creator` label 仍有意義——`creator` 給 playwright)。

**docstring / `--fix` help 文字**:更新頂部 docstring 與 `--fix` 說明,移除「MCP 設定」字樣;`--fix` 現在只做 pip 類補裝(hf/requests/playwright),不再寫任何設定檔。`summarize` 的 `WARN teaching:` 分組在 Node/MCP 移除後只剩……實際上 `teaching` label 將無成員(playwright 是 `creator`),可保留機制(未來可能再用)或註明;plan 階段確認 summary 文案不誤導。

## §2 刪 v2 MCP 設定檔

刪除 `.mcp.json`、`.codex/config.toml`。同步從 `.gitignore` / 文件移除相關引用(若有)。刪除後 Codex 首次啟動不再要求信任 MCP、Claude Code 不再顯示 playwright pending approval。

## §3 `agent/tests/test_init.py` 改寫

- **移除**:測 `check_node` / `check_mcp_config` / `restore_mcp_config` / `_detect_agents` 的 case 與其 mock。
- **新增**:`check_health()` 的 case ——
  - server 未起(`_http_get` 回 `(None, b"")`)→ `ok=True`。
  - server 在跑且 `/health` 回 `(200, b'{"status":"ok",...}')`→ `ok=True`。
  - server 在跑但 `/health` 非 200 或 body 無 `status:ok` → `ok=False`。
  - mock `_http_get`(或 `urllib.request.urlopen`)不打真 socket,延續現有 test 風格(plain function + monkeypatch)。
- **保留**:model/port/binary/python/requests 檢查的既有 case。
- `run_checks()` 項目數的斷言(若有)同步更新。

## §4 `teaching/demos/*` 重接第二層 smoke(母 spec §9)

**現況壞在哪**:`_common.py` 的 `pick_preset()`(`.preset-select`)已被前端 Task 4 拔掉 → demos 連根爆;`switch_tab()` 等 `body:not(.swapping)` 的邏輯也過時(v3 切 tab 是 UI-only、不再 swap-on-click,swap 改在 `/drive` 內)。

**retarget 方向(母 spec §9 第 2 層)**:demos 不再「用 UI 點 preset/送出」驅動,改成**模擬 AI 帶課**——`POST /drive` over HTTP 驅動、Playwright 只當**觀察者**斷言「頁面真的從 fanned `/events` frame 渲染」。這正是 v3 的教學機制(AI drives → page reflects),smoke 測的就是這條。

**`_common.py` 新契約**:
- 保留:`launch()`(browser + goto + dialog handler)、`log`/`die`/`add_args`/`pause`/`segments_to_run`/`run_segments`。
- **新增** `wait_subscribed(base, timeout)`:poll `GET /health` 直到 `subscribers ≥ 1`(頁面 `connectEvents` 於 `DOMContentLoaded` 訂閱 `/events`;drive 前必須確認已訂閱,否則 frame 沒人收)。
- **新增** `drive(base, tab, user, system="", mode="")`:`POST /drive`(用 stdlib `urllib` 或 creator 已有的 `requests`;plan 選一),回應 JSON 回傳供斷言(tokens/final/turns)。
- **新增** `assert_reflected(page, tab, ...)`:等 `main.tab-panel.active[data-panel=<panelName>]` 出現(drive_start 會 `activateTabUI` 自動切)+ 該 panel 的輸出區(`.generated-text` / `.turns` / `.thinking-content`)有內容;回傳可斷言的文字。
- **新增** `inspect(base, tab, tokenIndex)` + 斷言 `.probs .bar-row` 更新到該 token 分布(對應 §3.2 `/inspect`)。
- **移除**:`pick_preset`;`switch_tab`/`run_and_wait` 的「UI 點送出 + 等 `.run` toggle」模型改為上面的 drive+observe(page 的送出鈕不再是 demo 的驅動點——除非另立一段測「頁面自己的 Send 也走同路徑」的對稱性)。`click_token`(頁面自身 token-click → 機率圖)可保留為一段「頁面互動」smoke,或併入 `inspect` 測同一渲染路徑;plan 決定。
- tab↔panelName 對照沿用前端 `TAB_TO_PANEL`(`"1":"basic"` 等)。

**`demo_tab1..4.py`**:每支改為 `wait_subscribed → drive(tab, payload) → assert_reflected + 檢查預期 token/機率`(tab1 首 token「霜」~0.95;tab2 chat vs raw 差異;tab3 thinking 有 `<think>` 相位切分 + `</think>` 後 final;tab4 swap 0.6B→4B + `get_time` turn 軌跡),tab1/tab3 另加一段 `inspect` 斷言。定位不變:creator `--smoke`(pip playwright;學生不需)。

**smoke 的 swap-失敗處理**:`launch` 已有 `on_dialog` 接 alert;前端修 `28ae0c8`/`677f352` 後 swap 失敗會 `alert` + 頁面自恢復(不凍結),demo 的 dialog handler 契約仍成立(可保留為一段負向 smoke,YAGNI 下非必須)。

## §5 進場文件更新(只動進場、不動 lesson 播放腳本)

- **`AGENTS.md` / `AGENTS.zh-TW.md`**「Student → teaching mode」:步驟改為 (1) `python3 init.py`(READY 判讀改用新 `/health` 語意)、(2) **刪掉「approve browser MCP / `/mcp` approve playwright / Codex trust folder」整步**、(3) 起 server、(4) 開 `teaching/README`。移除「browser MCP(Playwright MCP,shipped as `.mcp.json`/`.codex/config.toml`)」「approve the browser MCP once」等敘述與 Troubleshooting 裡的 MCP 相關項。保留 port 8080 / server-not-up 的 Troubleshooting。
- **`README.md`(zh)/ `README.en.md`**:setup 段移除 Node/MCP 前置,改述「HTTP-capable AI(Claude Code/Codex 用 Bash curl)+ 開一次頁面」。
- **`teaching/README.md` / `.zh-TW.md`**:只改**進場/分工**敘述(「你(AI)用 browser MCP 驅動頁面」→「你用 `POST /drive` 驅動、頁面靠 `/events` 反映」);**lesson 逐段播放腳本留給 3b**。
- **母 spec 依賴表(§11)**已寫明 v3 移除 Node/MCP,本輪讓文件與之一致。

## §6 後端 harden(折進 3a)

1. **swap 失敗後 reset 模型狀態**:在 `handle_swap()` 的**失敗 return 路徑**(`status != "ready"`,涵蓋 port-busy / load-timeout 等)把 `GLOBAL_STATE["model"] = None`(放 `handle_swap` 內最靠近失敗處、涵蓋所有呼叫者;非放各 caller)。理由:swap 失敗代表舊 llama 已被 `pkill`、新的沒起來 → `:8080` 現狀未知;若保留 stale `"0.6B"`,下次同-model drive 會**跳過 swap 直接打死掉的 llama → 500**(實測於「llama 被外部殺掉」情境重現)。reset 成 `None` 讓下次任何 drive 都強制重新 swap(`_detect_model` 亦可重新探測)。補一個 pytest:模擬 swap 失敗 → 斷言 `GLOBAL_STATE["model"] is None`。
2. **legacy `POST /swap` route**(母 spec §7 已知限制):v3 頁面不再呼叫。**gate 或移除** `_handle_swap_route`(`do_POST` 的 `/swap` 分支)。plan 決定「移除」還是「保留但回 410/註明 legacy」;若移除,確認無其他呼叫者(前端已驗證不呼叫;demos retarget 後也不呼叫)。補/改對應 pytest。

## §7 測試與驗證

- **自動(pytest)**:`pytest agent/tests -q` 全綠,含改寫後的 `test_init.py`(新 `/health` case、移除 MCP case)+ §6 兩個 harden 的 test。回歸風險主要在這層。
- **半自動(demos smoke)**:`python3 teaching/demos/demo_tab1.py --smoke`(及 2/3/4)對**在跑的 server** 綠——頁面確實從 `/drive`→`/events` 反映(token/機率/turn/inspect)。需 creator 的 pip playwright。
- **真機進場**:fresh 狀態 `python3 init.py`:server 未起時 `/health` 項不誤判、summary 與 exit code 一致、輸出無殘留 MCP/Node 字樣;起 server 後重跑 → `check_health` 綠。
- **文件**:AGENTS/README/teaching-README 進場段無 MCP-approval 殘留;雙語同步。

## §8 過渡期注意(明寫,非 bug)

3a ship 後、3b 未做前,**lesson ①–④(×2)內文仍是 MCP/preset 風格**(過時但無害——它們是內容不是進場)。3a 的進場文件(AGENTS/teaching-README 進場段)會**先一步**改成 relay 版,造成「進場說 relay、lesson 內文說 MCP」的短暫不一致。**可接受**:進場路徑先正確(學生一開始就走對),lesson 內文由 3b 補齊。teaching-README 可加一行過渡註記(「lesson 內文改寫中,以 AI 實際帶課為準」),plan 決定要否。

## §9 檔案異動總覽

| 動作 | 檔案 |
|---|---|
| 修改 | `init.py`(移除 Node/MCP 檢查 + `restore_mcp_config`,新增 `check_health`,更新 docstring/`--fix`) |
| 修改 | `agent/tests/test_init.py`(移 MCP/Node case,加 `/health` case) |
| 修改 | `agent/server.py`(§6:swap-fail reset `GLOBAL_STATE["model"]`;gate/移除 `_handle_swap_route`)、`agent/tests/test_server.py`(對應 test) |
| 修改 | `teaching/demos/_common.py`(移 `pick_preset`,新增 `wait_subscribed`/`drive`/`assert_reflected`/`inspect`,改 `switch_tab`/`run_and_wait` 模型)、`teaching/demos/demo_tab1..4.py`(改 `/drive` 驅動 + Playwright 觀察) |
| 修改 | `AGENTS.md` / `AGENTS.zh-TW.md`、`README.md` / `README.en.md`、`teaching/README.md` / `teaching/README.zh-TW.md`(僅進場段) |
| 刪除 | `.mcp.json`、`.codex/config.toml` |
| 不動 | `handle_swap`/`SWAP_LOCK`/`_detect_model`(除 state-reset)、模型、Tab ⑥ skill、文章 tab、`frontend/*`、lesson ①–④ 內文(→ 3b) |

## §10 實作順序建議(單一 plan、建議 4 段)

1. **後端 harden + test**(§6):swap-fail reset `GLOBAL_STATE["model"]`、gate/移除 `/swap` route;`pytest agent/tests` 綠。最小、獨立、先鎖底層。
2. **`init.py` + `test_init.py` 改寫**(§1/§3)+ **刪 config**(§2):移 Node/MCP、加 `check_health`;`pytest`(含 test_init)綠;真機 `python3 init.py` 手驗(server 起/未起兩狀態)。
3. **demos smoke 重接**(§4):`_common.py` 新契約 + `demo_tab1..4` retarget;`--smoke` 對 live server 綠(controller 跑 Playwright 驗)。
4. **進場文件**(§5)+ 過渡註記(§8):雙語同步;grep 驗無 MCP-approval 殘留。

## 不做(YAGNI 重申)

前端 #3 斷線 wedge、lesson 內容改寫(3b)、`reveal` 指令、WebSocket、MCP fallback、多 client 支援(單人假設)。
