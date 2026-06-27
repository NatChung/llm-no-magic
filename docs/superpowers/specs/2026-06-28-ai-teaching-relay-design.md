# AI 帶課互動模型 v3 — API relay(純儀器 + AI 旁白)Design

日期：2026-06-28
狀態：待 review
前一版：[2026-06-17-ai-teaching-mcp-design.md](./2026-06-17-ai-teaching-mcp-design.md)(Playwright MCP 驅動版,已實作並 merge)

> 本 spec 已過一輪 subagent design review(對照實際 code 驗證),review 的 3 個 Critical + 4 個 Important 已折入本文,對應處標 `[R#]`。

## 背景與動機

v2(Playwright MCP 驅動唯一瀏覽器 + AI 旁白)已實作完成。但實際定位後,目標情境與機制都要調整:

1. **情境改為「自學者單機」** — 一個人 clone repo、開 Claude Code/Codex 就能上課,**沒有老師在場救援**。→ 可靠度 + 低 setup 成為最高權重。
2. **MCP 的代價對自學者太高** — Node/npx 依賴、一次性核准/信任、a11y snapshot 會變舊出錯、token 貴。對「沒人救場」的情境是風險。
3. **網頁要變「純儀器」** — 所有「教什麼、為何這樣、輸入什麼」的智能回到 AI(CLI)。preset(寫死的課程設計)與頁面散文(含 `(?)` explainer)都該移除,讓網頁只剩「輸入框 + 視覺化」。

## 目標

把教學從「AI 用 browser MCP 操作瀏覽器」改成「**AI 用 HTTP API(`/drive`)遙控、頁面透過 SSE(`/events`)即時反映**」:

- 網頁 = **純儀器**(只渲染 token/機率/turn 軌跡,無 preset、無說明文字)
- AI = **旁白 + 動態出題**(不被固定 preset 綁死;依學生反應即興輸入)
- 一次生成、餵兩邊:**AI 拿到數字去講、頁面拿到事件去動,數字必然一致**
- 教學法對齊 cognitive apprenticeship / I-do→you-do:**modeling**(AI `drive`+`inspect` 邊做邊講)→ **fading**(換人自己在同頁面練)

## 已鎖定的決策(不再 relitigate)

| # | 決策 |
|---|---|
| D1 | 網頁變純儀器;智能全在 AI;AI 動態出題不綁 preset |
| D2 | 主情境:自學者單機(可靠度 + 低 setup 優先) |
| D3 | 機制:AI 走 app 的 HTTP API(**不用** MCP、**不用**預寫 script) |
| D4 | v2 的 MCP 層(`.mcp.json` / `.codex/config.toml` / init.py MCP 檢查 / lesson MCP playbook)**全部移除**,由 relay 取代 |
| D5 | Sub-decision A:**server 成為所有 tab(①②③④)的生成引擎**;接受其真實成本(見 §2) |
| D6 | Sub-decision B:移除所有 `(?)` explainer 與 always-on 散文(見 §5;可逆,spec review 可翻案) |

## 範圍

- 教學涵蓋 **Tab ①②③④**(不變);Tab ⑤⑦ 純文章不動
- 教材**雙語**(zh-TW + English,不變)
- 改動橫跨**前後端**(這是與 v2 最大差異:v2 不動後端,v3 後端是重點)

### 不做(YAGNI)

- **不用 WebSocket**:SSE 單向 server→頁面正合「頁面反映」,且 stdlib `http.server` 已會串(`/agent` 現成),WS 在 stdlib 很醜、破壞零依賴哲學
- **不做 MCP fallback**(D4 已決定全拆;不維護兩套路徑)
- **不做 `reveal` 指令**(展開 chat-template 細節面板留給人類 practice 手動;見 §3)
- **不動模型 swap 底層邏輯**(`handle_swap` / `SWAP_LOCK` / `_detect_model` 沿用)

## 1. 架構:queue-based pub/sub relay

### 1.1 三個端點

```
人開的頁面 ──GET /events(常駐 SSE 訂閱)──► server :9000
                                              │  註冊一個 queue.Queue 進 SUBSCRIBERS
AI(curl)/ 人按送出 ──POST /drive {tab,user,system?,mode?}──► server
                                              │  swap(如需)→ 生成 → 把事件 put() 進每個訂閱者的 queue
                                              │  ├─► /events thread get() 出來、寫自己的 socket → 畫面動
                                              │  └─► /drive 回應回傳 tokens+機率 JSON → AI 旁白
AI / 人 ──POST /inspect {tokenIndex}──► server ──► push {type:"inspect",...} → 頁面彈機率圖
init.py ──GET /health──► server ──► 立即回 {status, model, subscribers}
```

### 1.2 `[R1]` fan-out 必須 per-subscriber queue,**禁止跨 thread 寫同一個 `wfile`**

`ThreadingHTTPServer` 每個 request 一條 thread(`daemon_threads=True`,parked 的 `/events` 不擋 `/drive`、不擋 shutdown — review 已驗)。但**兩條 thread 寫同一個 `wfile` 會交錯損毀 frame**。所以:

- module-level `SUBSCRIBERS: list[queue.Queue]`,用 `threading.Lock`(`SUBS_LOCK`,照抄既有 `SWAP_LOCK` 模式 `server.py:60`)保護增刪
- `GET /events` handler:建一個自己的 `queue.Queue` → 註冊 → 迴圈 `frame = q.get(); self.wfile.write(sse(frame)); self.wfile.flush()`;捕捉 `BrokenPipeError`/`ConnectionResetError` → 反註冊、結束
- `POST /drive` / `/inspect`:**只** `put()` 進每個 queue,**絕不**碰 `/events` 的 socket
- 心跳:`/events` 迴圈用 `q.get(timeout=15)`,timeout 時寫一個 SSE comment(`: ping\n\n`)偵測斷線

### 1.3 一次生成、兩個消費者(數字一致的保證)

①②③ 走 llama greedy(`temperature:0`,`app.js:287`)→ 生成**確定性**;點到的 top-1 token **就是** argmax。server 生成一次,同時 fan-out + 回傳 JSON → **AI 講的數字 == 畫面顯示的數字**,by construction。

## 2. `[R2]` Sub-decision A:server 成為生成引擎(承重牆,誠實標重)

> review 結論:這**不是 refactor,是一條全新生成路徑**。是整個 v3 的承重牆,工作量比初版估計重。

現況(review 已驗):
- **Tab ①②③ 由瀏覽器直接打 llama**(`LLAMA_URL = http://${_HOST}:8080/completion`,`app.js:65`,用在 `runCompletion` `app.js:279`)
- **Tab ④/⑦ 已走 server**(`/agent` `app.js:632`、`/skill-agent` `app.js:860`)
- server **目前完全沒有「從 llama 串流」的 code**(`agent_loop` 是 `stream:False` `server.py:196`)

v3 要做:

### 2.1 ①②③ 收進 server,且**必須打 `/completion`(不是 chat-completions)**
關鍵約束(review #2):**Tab ② raw mode 完全不套 chat template**(`app.js:208 return user`)。chat-completions 一定會套模板 → **無法**表達 raw。所以 server **必須**:
- 打 llama **`/completion`**(raw string in),`stream:True`、`n_probs:10`、`temperature:0`
- **把 `buildFinalPrompt`(`app.js:197-216)移植到 server 端**,含:
  - system block 包裹(`app.js:201-202`)
  - thinking-mode 的 `<think>\n\n</think>` 注入(`app.js:209-213`)
  - **CJK 單字守衛**(`app.js:270-275`)也要搬到 server
- 逐 token 從 llama 串流讀出 → 解析 `completion_probabilities` → `put()` `{type:"token", token, top_logprobs}` 進每個 queue,同時累積給 `/drive` 回應

### 2.2 `[R7]` Tab ④ 也要改進 drive/events(不能只改 ①②③)
現在頁面自己打 `/agent` 並渲染 `turn_complete`(`app.js:632-675`),頁面是**唯一**消費者。v3:`/drive{tab:4}` 由 server 跑 `agent_loop`,把 `turn_complete`/`final` 事件 fan 到 `/events`,同時累積給 AI。頁面的 `runAgent` 換成「從 `/events` 收 turn 事件來渲染」。

### 2.3 統一:AI 與人類對稱
人類在 freeform 框按送出,也走 `POST /drive`(不再走舊的瀏覽器直打 llama 路徑)。→ **全系統只有一條生成路徑(`/drive`)+ 一條渲染路徑(`/events`)**,AI 與人類是對稱的 driver。純儀器頁面只做兩件事:渲染 `/events`、可發 `/drive`/`/inspect`。

## 3. relay 指令集與資料合約

### 3.1 `POST /drive {tab, user, system?, mode?}`
- `tab`: `"1"|"2"|"3"|"4"`;`mode`: ②(`name="mode-advanced"`)=`"raw"|"chat"`、③(`name="mode-reasoning"`)=`"direct"|"thinking"`(①無;④無)
- 行為:必要時 swap(§7,3-5s+)→ push `drive_start` → 生成並逐 token fan-out → push `final`
- **回應(回給 AI 旁白)**:
  ```json
  { "subscribers": 1, "tab": "1",
    "tokens": [ { "token": "霜", "top_logprobs": [ {"token":"霜","prob":0.94}, ... ] }, ... ],
    "final": "...", "turns": [ ... ]   // turns 僅 tab 4
  }
  ```
- **阻塞語意**:curl 同步等到生成結束(可能數秒;tab swap 本身 3-5s+)。自學者單機可接受。server 端設合理 timeout(沿用既有 60s 量級)

### 3.2 `POST /inspect {tokenIndex}`
- push `{type:"inspect", tokenIndex}` → 頁面用**既有** token-click handler + `renderProbs`(`app.js:228-252`,**保留不刪**)從**已串流到頁面的** token 資料渲染機率圖(無需額外資料,review #5 已確認)
- 回應 `{ "ok": true, "subscribers": N }`

### 3.3 `GET /health`(`[R6]`,init.py 用)
- **立即回應**(不可 hang):`{ "status":"ok", "model": <current>, "subscribers": N }`
- init.py 檢這個,**不要**直接探 `/events`(會 hang 到 timeout 誤判 down)或 `/drive`(POST 會觸發生成/swap)

### 3.4 `[R5]` 「對空螢幕旁白」防呆
`/drive` 與 `/inspect` 回應都帶 `subscribers`。AI 在開課前先 `GET /health` 或看 `subscribers`,若 0 → 用人話跟學生說「請先在瀏覽器打開 http://localhost:9000/」再繼續,**不對空螢幕旁白**(自學者沒人救場,此防呆必要)。

### 3.5 `/events` frame 型別(`[R8]` 要帶 tab/mode context)
| type | 欄位 | 頁面動作 |
|---|---|---|
| `drive_start` | `tab, mode, user, system` | 切到該 tab UI(**不重觸發 swap**,§7)、顯示輸入、清空輸出區、起渲染 |
| `token` | `token, top_logprobs` | append token;存 top_logprobs 供點擊/inspect;③ 跑 think 階段機(`app.js:261-347`) |
| `turn_complete` | (鏡像 agent_loop) | tab④ 渲染該 turn |
| `final` | `content` | 收尾、送出鈕回 enabled |
| `inspect` | `tokenIndex` | 程式化彈出該 token 機率圖 |
| `error` | `message` | 顯示錯誤 |

## 4. 前端改動(`[R4]` app.js 必須進改動清單)

- **新增**:載入時開 `/events` 訂閱(`EventSource` 或 `fetch`+reader),依 §3.5 渲染。新增「切 tab UI only」函式(swap 已由 server 在 `/drive` 處理,頁面切 tab **不可**再呼叫 `/swap`)
- **移除 preset 下拉**(`index.html` / `index.zh-TW.html` 的 `.preset-select` ×3 + `.skill-preset`)
- **`[R4]` 改 app.js preset handler**:`presetEl.addEventListener`(`app.js:683`、`app.js:743`)**沒 null guard**,markup 一刪會 crash panel 初始化 → 移除這些 handler(`setupPanel` 的 `app.js:385` 本來就有 `if (presetEl)` guard,可參照)
- **保留**:`renderProbs` + token-click handler(`app.js:228-252`)供 `inspect` 與人類 practice
- **改送出鈕**:從「直打 llama / 打 `/agent`」改成 `POST /drive`(§2.3)
- 雙份 HTML 同步、bump cache-bust version

## 5. `[R10]` 純儀器化:移除說明,但 preset 字串要遷移

- **移除所有 `(?)` explainer `<details>` 與 always-on 散文**(Sub-decision B / D6)。網頁 = 輸入框 + 視覺化,無可讀文字。代價:放棄「沒開 AI 的訪客也能自學」(v3 前提本就是「跟 AI 一起用」)。**此顆可逆**,spec review 可改為「保留收合版」
- **`[R10]` preset 字串是 lesson 1 的全部機制,必須原樣遷移進 lesson playbook**(不是消失):`床前明月光,疑是地上` / `祖樹星上最高的山叫做` / `他打開冰箱,拿出`(`index.html:102-104`)→ 成為 lesson 的 `drive{user:...}` payload(`lesson-1.md` 第 27/33/38 行已內嵌,確認逐字一致)。freeform 框的 practice 交接要由 AI 告訴人類「換你打打看 XXX」(preset 原本就是舊的「自己試」鷹架)

## 6. 移除 v2 MCP 層 + init.py 改動

- **刪**:`.mcp.json`、`.codex/config.toml`、init.py 的 Node/npx 檢查 + MCP 設定檢查 + agent 偵測 + `--fix` 寫 MCP 設定
- **init.py 新檢查**:server 起得來 + **`GET /health` 立即回 200**(§3.3);llama :8080、兩個 model、port 9000/8080 等既有檢查不變
- **`agent/tests/test_init.py`** 對應改寫(移除 MCP/Node 相關 mock,新增 `/health` 探測 mock)

## 7. tab swap 與 `/drive` 的協調

- `/drive` 收到目標 tab → 比對 `GLOBAL_STATE["model"]`,需要才呼叫既有 `handle_swap`(`SWAP_LOCK` 序列化),這是 3-5s+ 的來源
- swap 完成後才 push `drive_start` 並開始生成
- **頁面收 `drive_start` 只切 tab 的視覺 UI,不可再呼叫 `/swap`**(否則重複 swap / 互踢)
- swap 失敗 → push `{type:"error"}` + `/drive` 回 5xx;AI 用人話告知 + 照 Troubleshooting(port 8080)

## 8. lesson ①–④ ×2 語言改寫

每段從「選 preset → MCP 點」改成 relay 流程。約 15 段 × 2 語言,**真實衍生工作**(非機械 find-replace)。範例(lesson-1 段落 1):
```
AI:
1. GET /health → 確認 subscribers ≥ 1(否則請學生先開 http://localhost:9000/)
2. POST /drive {tab:"1", user:"床前明月光,疑是地上"}
3. 從回應讀 tokens(預期首 token「霜」、top-1 0.94+)→ 旁白:model 背過整首詩 → peaked
4. POST /inspect {tokenIndex:0} → 畫面彈出機率圖,對著螢幕講
5. fading:「換你 — 在輸入框打你公司才知道的一句開頭,看它怎麼自信幻覺」
```
- lesson 4 的「展開 resend 細節」因 `reveal` 被 YAGNI(§範圍)→ 改寫成**人類 practice 手動展開**步驟

## 9. `[R3]` smoke harness 怎麼換(判斷:**拆兩層**)

preset 一刪,現有 harness 連根爆:`_common.py:74` 靠 `.preset-select`,每段從 `pick_preset` 進入(`demo_tab1.py:23-24`、`demo_tab4.py:21-22`)。「retarget」其實是重寫。**判斷:拆兩層,職責分明、互補不重疊**(理由:v3 新 code 大多在 server,pytest 是又快又準的主網;Playwright 只補它獨有價值):

1. **pytest(主網,無瀏覽器)** — 測新 server 合約:`/drive` 跑生成、`/events` queue fan-out 真的送出 frame、`/health` 立即回、`subscribers` 計數、server 端 `buildFinalPrompt`(②raw 無模板、③ think 注入、CJK 守衛)、temperature:0/n_probs:10 帶對。新 code 的回歸風險絕大多數在這層
2. **Playwright smoke(端到端,retarget)** — 開頁面(訂閱 `/events`)→ `POST /drive` over HTTP → 斷言頁面**真的反映了**(token 渲染出來、`inspect` 後機率圖出現)。這是 pytest 看不到的、Playwright 獨有的價值:「頁面真的從 fanned `/events` frame 渲染出來了嗎」
- `teaching/demos/*.py` 改寫成上述第 2 層(驅動改 `POST /drive`,觀察仍用 Playwright);`pip playwright` 維持「creator 驗證用」降級定位

## 10. 安全與多 client

- **`[R11]` `/drive` 必須只綁 localhost**:`/agent` 今天已會在 `LISTEN_HOST=0.0.0.0` 把 `exec_bash`/`write_file` 暴露到 LAN(既有、非新增)。v3 註明:**`/drive` 不可與課堂 `0.0.0.0` 模式同時開啟**(Tab④ 工具會經 `/drive` 觸發)。自學者單機 localhost 情境無虞
- **`[R9]` 多 client**:廣播給所有訂閱者。假設**單一活躍頁面**;舊 tab 也會跟著動是已知、低害(自學者單機)→ spec 明寫此假設,不留隱性

## 11. 依賴總覽(學生 vs creator)

| | 學生(自學) | creator(維護/驗證) |
|---|---|---|
| llama.cpp + 2 models + requests + Python server | ✓ | ✓ |
| 支援 HTTP 工具的 AI agent(Claude Code/Codex 用 Bash curl) | ✓ | ✓ |
| ~~Node/npx + browser MCP~~(**v3 移除**) | ✗ | ✗ |
| pip playwright + chromium | ✗ | ✓(跑第 2 層 smoke) |

→ **自學者 setup 比 v2 更簡**:免 Node、免 MCP 核准/信任。

## 12. 測試與驗證

- **server 合約(自動)**:`pytest agent/tests -q`(含新 `/drive`/`/events`/`/health` test、改寫的 test_init)
- **端到端 relay+render(半自動)**:§9 第 2 層 Playwright smoke 綠
- **真機端到端**:fresh clone → 開 Claude Code → 說 hi → AI 問角色 → 自學者 → AI `GET /health`(確認頁面已開)→ `drive` 開課、頁面 token 動、`inspect` 彈圖 → 放手給人在同頁面練
- init.py 真機:`/health` 探測不 hang、summary 與 exit code 一致、無殘留 MCP 檢查

## 檔案異動總覽

| 動作 | 檔案 |
|---|---|
| 新增 | (無新檔;端點加在 `server.py`) |
| 修改(後端) | `agent/server.py`(`/events`+`/drive`+`/inspect`+`/health`、SUBSCRIBERS/SUBS_LOCK、移植 `buildFinalPrompt`+CJK 守衛、`/completion` 串流、Tab④ 改 fan-out)、`agent/tests/test_server.py`、`agent/tests/test_init.py` |
| 修改(前端) | `frontend/app.js`(`/events` 訂閱+渲染、切tab-UI-only、送出改 `/drive`、移除 preset handler、保留 renderProbs)、`frontend/index.html` / `index.zh-TW.html`(刪 preset 下拉 + `(?)` explainer + always-on 散文、bump cache-bust) |
| 修改(進場/教材) | `init.py`(移除 MCP/Node、加 `/health`)、`AGENTS.md`/`AGENTS.zh-TW.md`(學員模式改 relay)、`README.md`(zh)/`README.en.md`(AI 帶課段改 relay)、`teaching/README.md`/`.zh-TW.md`、`teaching/lesson-1..4`(×2 lang,Demo → relay playbook)、`teaching/demos/*.py`(改 `POST /drive` 驅動) |
| 刪除 | `.mcp.json`、`.codex/config.toml` |
| 不動 | `handle_swap`/`SWAP_LOCK`/`_detect_model`、模型、Tab ⑤⑦ 純文章 |

## 實作順序建議(單一 plan、五段)

1. **relay 骨幹** — `server.py` 加 `/events`(queue 訂閱)+ `/drive`(先只接 Tab④,重用 `agent_loop` fan-out)+ `/inspect` + `/health` + SUBSCRIBERS/SUBS_LOCK;pytest 測 fan-out。**先證明 pub/sub 與「兩消費者」在最簡 tab(④,已走 server)成立**
2. **生成引擎(承重牆)** — 移植 `buildFinalPrompt`+CJK 守衛、`/completion` 串流,把 ①②③ 收進 `/drive`;pytest 測 ②raw 無模板、③ think 注入、temperature:0/n_probs:10
3. **前端純儀器化** — app.js `/events` 訂閱+渲染、送出改 `/drive`、切tab-UI-only;刪 preset 下拉 + handler + `(?)` + 散文;bump cache-bust;§9 第 2 層 smoke 改寫
4. **進場層** — init.py(移除 MCP/Node、加 `/health`)+ test_init;刪 `.mcp.json`/`.codex/config.toml`;AGENTS ×2 + README 改寫
5. **教材層** — teaching/README ×2 + lesson-1..4 ×2 的 Demo → relay playbook(含 §3.4 防呆、§8 fading);preset 字串逐字遷移

## 已知風險

- **承重牆估計風險**:§2 生成引擎是最大未知;先做 §實作順序 1(Tab④ 證明骨幹)再做 §2,降低一次性風險
- **`/drive` 阻塞 + swap 延遲**:curl 同步等數秒;若課堂體感差,可改 `/drive` 立即回 `{accepted}` + 全程走 `/events`(本版選同步,簡單優先)
- **移除 `(?)`/散文不可逆於 standalone 訪客**:D6 標可逆,spec review 拍板
- **單頁假設**:多 tab 廣播副作用(§10),自學者單機可接受
