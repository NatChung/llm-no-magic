# AI 帶課互動模型 v3 — API relay(純儀器 + AI 旁白)Design

日期：2026-06-28
狀態：待 review
前一版：[2026-06-17-ai-teaching-mcp-design.md](./2026-06-17-ai-teaching-mcp-design.md)(Playwright MCP 驅動版,已實作並 merge)

> 本 spec 已過**兩輪** subagent design review(對照實際 code 驗證)。第一輪(對提案)3 Critical + 4 Important 標 `[R#]`;第二輪(對本文)再修 3 Critical + 7 Important,標 `[R2-#]`。citation 行號以第二輪 review 校正為準。

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
| D5 | Sub-decision A:**server 成為 Tab ①②③④ 的生成引擎**;接受其真實成本(見 §2) |
| D6 | Sub-decision B:移除互動 tab 上的 `(?)` explainer 與 always-on 散文(見 §5;可逆,spec review 可翻案) |

## 範圍與 tab 盤點(`[R2-3]` 編號校正)

tab 實際結構(`index.html` 校正):**互動(經模型)= ① basic / ② advanced / ③ reasoning / ④ agent / ⑥ skill;純文章 = ⓪ intro / ⑤ commands / ⑦ mcp / ⑧ recap**。

- **v3 只涵蓋 ①②③④**(lessons 1–4 對應的就是這四個)
- **`[R2-3]` Tab ⑥ skill 整個不在 v3 範圍** — 保留它現有的 `.skill-preset` 下拉與 `/skill-agent`(`app.js:743` 的 preset handler)**原封不動**。理由:⑥ 不在任何 lesson playbook;若只刪它的 preset 卻不把它接上 relay,會變成「半轉換孤兒」、違反 §2.3 的單一路徑原則。要嘛全留要嘛全轉,v3 選**全留**
- 教材**雙語**(zh-TW + English)
- 改動橫跨**前後端**(與 v2 最大差異:v2 不動後端,v3 後端是重點)

### 不做(YAGNI)

- **不用 WebSocket**:SSE 單向 server→頁面正合「頁面反映」,stdlib `http.server` 已會串(`/agent` 現成);WS 在 stdlib 很醜、破壞零依賴哲學
- **不做 MCP fallback**(D4 已決定全拆)
- **不做 `reveal` 指令**(展開 chat-template 細節面板留給人類 practice 手動)
- **不轉換 Tab ⑥ skill**(見上;留原樣)
- **不動模型 swap 底層**(`handle_swap` / `SWAP_LOCK` / `_detect_model` 沿用)

## 1. 架構:queue-based pub/sub relay

### 1.1 端點總覽

```
人開的頁面 ──GET /events(常駐 SSE 訂閱)──► server :9000
                                              │  註冊一個 queue.Queue 進 SUBSCRIBERS
AI(curl)/ 人按送出 ──POST /drive {tab,user,system?,mode?}──► server
                                              │  GEN_LOCK 序列化 → swap(如需)→ 生成
                                              │  → publish() 事件到每個訂閱者的 queue
                                              │  ├─► /events thread get() 寫自己的 socket → 畫面動
                                              │  └─► /drive 回應回傳 tokens(含 logprob)→ AI 旁白
AI / 人 ──POST /inspect {tokenIndex}──► server ──► publish {type:"inspect",...} → 頁面彈機率圖
AI / 人 ──POST /stop──► server ──► 設 cancel flag,中止進行中的生成
init.py / AI ──GET /health──► server ──► 立即回 {status, model, subscribers}
```

### 1.2 `[R1]` fan-out:per-subscriber queue,禁止跨 thread 寫同一個 `wfile`

`ThreadingHTTPServer` 每 request 一條 thread(`daemon_threads=True`,parked 的 `/events` 不擋他人、不擋 shutdown — 已驗)。**兩條 thread 寫同一個 `wfile` 會交錯損毀 frame**。所以:

- module-level `SUBSCRIBERS: list[queue.Queue]`,用 `threading.Lock`(`SUBS_LOCK`,照 `SWAP_LOCK` `server.py:60` 模式)保護增刪
- **`[R2-9]` 發布抽成純函式 `publish(frame: dict) -> None`**:在 `SUBS_LOCK` 下對每個 queue `put(frame)`。**不碰任何 socket** → 可在 pytest 用假 queue 斷言,無需 socket(見 §9)
- `GET /events` handler:建自己的 `queue.Queue` → 註冊 → 迴圈 `frame = q.get(timeout=15); self.wfile.write(sse(frame)); self.wfile.flush()`;`Empty` → 寫心跳 `: ping\n\n` 偵測斷線;`BrokenPipeError`/`ConnectionResetError` → 反註冊、結束
- `POST /drive`/`/inspect`/`/stop`:**只呼叫 `publish()`**,絕不碰 `/events` 的 socket

### 1.3 `[R2-1]` 生成序列化(GEN_LOCK)— AI 與人類共用同一台儀器

§2.3 讓 AI 與人類**都**能發 `POST /drive`,§10 又允許多訂閱者。兩個重疊的 `/drive`(人按送出時 AI 正生成中,或兩個 AI 呼叫)會把 `token` frame **交錯**進同一批 queue → 唯一那台儀器渲染爛掉。所以:

- module-level `GEN_LOCK = threading.Lock()`
- `/drive` 進來先 `acquire(blocking=False)`:**拿不到 → 回 409 `{busy:true}`**(reject-while-busy,不排隊;呼叫者重試)。拿到 → swap+生成,`finally: release()`
- 一次只有一條生成在 fan-out,儀器永遠單一連貫

### 1.4 一次生成、兩個消費者(數字一致)

①②③ 走 llama greedy(`temperature:0` `app.js:289`)→ 生成確定性;點到的 top-1 就是 argmax。server 生成一次、同時 fan-out + 回傳 → **AI 講的數字 == 畫面數字**,by construction。

## 2. `[R2]` Sub-decision A:server 成為生成引擎(承重牆,誠實標重)

> 這**不是 refactor,是一條全新生成路徑**(`agent_loop` `server.py:197` 是 `stream:False`+`.json()`,**零** llama-SSE 消費先例 — 已驗)。是整個 v3 的承重牆。

現況(已驗):①②③ 瀏覽器直打 llama(`LLAMA_URL=http://${_HOST}:8080/completion` `app.js:65`,用在 `runCompletion` `app.js:254-366`);④ 走 `/agent`;⑥ 走 `/skill-agent`(留原樣)。

### 2.1 ①②③ 收進 server,且**必須打 `/completion`**(不是 chat-completions)
關鍵約束:**② raw mode 完全不套 chat template**(`app.js:206 return user` — 已驗)。chat-completions 一定套模板 → 無法表達 raw。所以 server **必須**打 llama **`/completion`**(raw string in),且**移植 `buildFinalPrompt`(`app.js:197-216`)全部分支與生成參數**:
- system block 包裹(`app.js:201-202`)
- ③ thinking-mode 的 `<think>\n\n</think>` 注入(direct 注入跳過、thinking 保留;`app.js:211-214`)
- **CJK 單字守衛**(`app.js:270-275`)
- `temperature:0`、`n_probs:10`、`stream:true`(`app.js:285-290`)
- **`[R2-8]` `n_predict` per-tab**:`reasoning → 1500、其餘 → 80`(`app.js:222`)。**漏掉 ③ 會在 80 token 截斷、永遠不閉合 `</think>`**(`app.js:219-221` comment 記載的原 bug)
- **`[R2-Minor]` ③ 的 `/completion` 路徑不可繼承 `/agent` 的 `/no_think`/`enable_thinking:false`**(那是 ④ 專用 `server.py:189,200`)
- **`[R2-10]` llama 呼叫改 streamed 讀**(`stream:true`),逐 chunk 解析 `completion_probabilities`,per-chunk read timeout(非既有 `server.py:202` 那個 blocking `.json()` 的 60s 總時限)→ 1500-token ③ 生成不會誤觸 timeout
- 逐 token `publish({type:"token", token, top_logprobs})`,同時累積給 `/drive` 回應

### 2.2 `[R7]` Tab ④ 也要改進 drive/events
現在頁面自己打 `/agent` 並渲染 `turn_complete`(`app.js:632-675`),頁面是唯一消費者。v3:`/drive{tab:"4"}` 由 server 跑 `agent_loop`,把 `turn_complete`/`final` `publish()` 到 `/events`,同時累積給 AI。頁面 `runAgent` 換成「從 `/events` 收 turn 事件渲染」。

### 2.3 統一:AI 與人類對稱
人類在 freeform 框按送出也走 `POST /drive`(不再走瀏覽器直打 llama)。→ **全系統一條生成路徑(`/drive`)+ 一條渲染路徑(`/events`)**(Tab ⑥ skill 除外,§範圍)。**`[R2-Minor]` 頁面只從 `/events` 渲染、忽略自己 `/drive` 的回應 body**;AI 觸發與人觸發送來的是**相同 frame**,頁面無需區分(天然乾淨)。

## 3. relay 指令集與資料合約

### 3.1 `POST /drive {tab, user, system?, mode?}`
- `tab`:`"1"|"2"|"3"|"4"`;`mode`:②(`name="mode-advanced"`)=`"raw"|"chat"`、③(`name="mode-reasoning"`)=`"direct"|"thinking"`(①④ 無)
- 行為:`GEN_LOCK`(§1.3)→ 需要才 swap(§7)→ `publish(swap_start)`(若 swap)→ `publish(drive_start)` → 逐 token `publish(token)` → `publish(final)`
- **`[R2-2]` 回應(回給 AI 旁白)**— logprob 為 llama 原生,另附算好的 `prob` 方便 AI:
  ```json
  { "subscribers": 1, "tab": "1",
    "tokens": [ { "token": "霜",
                  "top_logprobs": [ {"token":"霜","logprob":-0.06}, ... ],
                  "prob": 0.94 }, ... ],
    "final": "...", "turns": [ ... ]    // turns 僅 tab 4
  }
  ```
- busy → 409 `{busy:true}`;swap 失敗 → 5xx + `publish(error)`

### 3.2 `POST /inspect {tokenIndex}`
- `publish({type:"inspect", tokenIndex})` → 頁面用**既有** token-click handler(`appendClickableToken`/`highlightStep` `app.js:228-252`)+ `renderProbs`(`app.js:130-154`)從**已串流到頁面的** `logprob` 資料渲染(無需額外資料 — 已驗)
- 回應 `{ "ok":true, "subscribers":N }`

### 3.3 `POST /stop`(`[R2-7]`)
- 設進行中生成的 cancel flag(生成迴圈每 token 檢查)→ 中止 fan-out、`publish(final)` 收尾
- 取代前端原本 `abortCtl.abort()`(`app.js:373,695`):relay 下中止 client fetch **不會**停 server 生成,故必須 server 端 stop。尤其 ③ 1500-token thinking 要可中止
- 回應 `{ "ok":true }`

### 3.4 `GET /health`(`[R6]`)
- **立即回應**(不可 hang):`{ "status":"ok", "model":<current>, "subscribers":N }`
- init.py / AI 檢這個。**不要**探 `/events`(SSE 不結束 → `init.py:_http_get` 的 `r.read` 會 block 到 timeout 誤判 down `init.py:131`)或 `/drive`(POST 會觸發生成)

### 3.5 `[R5]` 對空螢幕防呆
`/drive`/`/inspect`/`/health` 回應都帶 `subscribers`。AI 開課前先看 `subscribers`,若 0 → 用人話請學生先開 `http://localhost:9000/`,**不對空螢幕旁白**。

### 3.6 `/events` frame 型別(`[R8]`+`[R2-6]` 帶 context)
| type | 欄位 | 頁面動作 |
|---|---|---|
| `swap_start` | `tab, model` | **`[R2-6]`** 顯示「載入 X 中…」banner(取代原 `showSwapBanner` `app.js:81-118`);swap 期間不再空白 |
| `drive_start` | `tab, mode, user, system` | 切到該 tab UI(**不重觸發 swap**,§7);顯示輸入;清空輸出區;**`[R2-Minor]` disable 送出鈕** |
| `token` | `token, top_logprobs`(`{token,logprob}`) | append token;存 logprob 供點擊/inspect;③ 跑 think 階段機 |
| `turn_complete` | (鏡像 agent_loop) | tab④ 渲染該 turn |
| `final` | `content` | 收尾;**re-enable 送出鈕** |
| `inspect` | `tokenIndex` | 程式化彈該 token 機率圖 |
| `error` | `message` | 顯示錯誤 |

## 4. 前端改動(`[R4]` app.js 必進改動清單)

### 4.1 `[R2-4]` 全域 `/events` 訂閱 → 分派到「當前 active panel」的 render state
今天每個 panel 把 render state 鎖在 closure(`setupPanel`:`tokenSteps`/`phase`/`probsEl`/`textEl`/`thinkingContentEl` `app.js:179-406`)。新設計是**一個** page-global `/events` 訂閱者,必須把 `token`/`turn_complete`/`inspect`/think-phase frame 路由進**當前 active panel** 的 state 與 DOM。`renderProbs` 是 module-level(OK),但 `appendClickableToken`/`highlightStep`/`tokenSteps` 在 `setupPanel` closure 內。**這段「全域事件 → per-panel state」的接線是前端主要工作量**:
- 作法:每個互動 panel 註冊一個 `{tab, render handlers, elements}` 到 module-level registry(key=tab),global `/events` handler 依 frame 的 `tab` 取對應 handler 分派。把 closure 內的 render 函式提成可被 registry 引用
- 設計 plan 階段要把這個 registry 介面定清楚

### 4.2 `[R2-5]` `runCompletion` 是**搬移**不是「改送出鈕」
`runCompletion`(`app.js:254-366`,~110 行):`LLAMA_URL` 直打、`getReader` SSE 迴圈、`completion_probabilities` 解析、`<think>/</think>` 階段機(`app.js:339-347`)、token 路由到 `textEl` vs `thinkingContentEl` —— **整段邏輯搬進 §4.1 的 `/events` handler,並刪除 `LLAMA_URL` 直打路徑**。送出鈕改成 `POST /drive`。`runAgent`(④)同理搬移。

### 4.3 其它
- 切 tab:swap 由 server 在 `/drive` 處理;頁面切 tab UI **不可**再呼叫 `/swap`(否則重複 swap)
- **移除 preset 下拉**:`index.html`/`index.zh-TW.html` 的 `.preset-select` ×3(① basic、② advanced、③ reasoning)。**Tab ⑥ `.skill-preset` 留著**(§範圍)
- **`[R4]` preset handler**:刪 ①②③ 對應的;`setupPanel` 的 `if (presetEl)`(`app.js:385`)本就 guard。**`app.js:743`(skill)留著**(⑥ 不動)
- Stop 鈕改呼叫 `POST /stop`(§3.3)
- 雙份 HTML 同步、bump cache-bust

## 5. `[R2-Minor]` 純儀器化:範圍限互動 tab,preset 字串遷移

- **移除互動 tab(①②③④)的 `(?)` explainer `<details>` 與 always-on 散文**(D6)。**不動純文章 tab ⓪⑤⑦⑧**(它們本來就是文章,§5 不適用)。此顆可逆,spec review 可改保留收合版
- **`[R10]` preset 字串原樣遷進 lesson playbook**(不是消失):`床前明月光,疑是地上`/`祖樹星上最高的山叫做`/`他打開冰箱,拿出`(`index.html:102-104`,與 `lesson-1-basics.md` 27/29/33/34/38/39 逐字一致 — 已驗)→ 成 `drive{user:...}` payload。fading 由 AI 告訴人類「換你打 XXX」

## 6. 移除 v2 MCP 層 + init.py 改動

- **刪**:`.mcp.json`、`.codex/config.toml`、init.py 的 Node/npx + MCP 設定 + agent 偵測 + `--fix` 寫 MCP
- **init.py 新檢查**:server 起得來 + `GET /health` 立即回 200(§3.4);llama:8080、兩 model、port 9000/8080 等既有不變
- `agent/tests/test_init.py` 對應改寫(移 MCP/Node mock,加 `/health` 探測 mock)

## 7. tab swap 與 `/drive` 協調

- `/drive` 比對 `GLOBAL_STATE["model"]`,需要才 `handle_swap`(`SWAP_LOCK` 序列化);3-5s 來源
- **`[R2-6]` swap 前先 `publish(swap_start)`** → 頁面顯示 banner,3-5s 不空白;swap 完才 `publish(drive_start)` 開始生成
- **頁面收 `drive_start`/`swap_start` 只更新 UI,不可呼叫 `/swap`**
- swap 失敗 → `publish(error)` + `/drive` 5xx;AI 用人話告知 + 照 Troubleshooting(port 8080)

## 8. lesson ①–④ ×2 語言改寫

每段「選 preset → MCP 點」改成 relay 流程。約 15 段 × 2 語言,**真實衍生工作**。範例(lesson-1 段落 1):
```
AI:
1. GET /health → subscribers ≥ 1?(否則請學生先開 http://localhost:9000/)
2. POST /drive {tab:"1", user:"床前明月光,疑是地上"}
3. 讀回應 tokens(預期首 token「霜」、prob 0.94+)→ 旁白:背過整首詩 → peaked
4. POST /inspect {tokenIndex:0} → 畫面彈機率圖,對著螢幕講
5. fading:「換你 — 在輸入框打你公司才知道的一句開頭,看它怎麼自信幻覺」
```
- lesson 4「展開 resend 細節」因 `reveal` YAGNI → 改寫成人類 practice 手動展開

## 9. `[R3]`+`[R2-9]` smoke harness 怎麼換(判斷:拆兩層)

preset 一刪,現有 harness 連根爆(`_common.py:74` 靠 `.preset-select`,每段從 `pick_preset` 進入)。**判斷:拆兩層,互補不重疊**:

1. **pytest(主網,無瀏覽器)** — 測 server 合約:`publish()` 純函式對每個 registered queue `put` 了正確 frame(用假 queue 斷言、**無 socket**,§1.2)、`GEN_LOCK` busy 回 409、`/health` 立即回、`subscribers` 計數、server 端 `buildFinalPrompt`(②raw 無模板、③ think 注入、CJK 守衛、`n_predict` 1500/80)、`temperature:0`/`n_probs:10` 帶對。新 code 回歸風險絕大多數在這層
2. **Playwright smoke(端到端,retarget)** — 開頁面(訂閱 `/events`)→ `POST /drive` over HTTP → 斷言頁面**真的反映**(token 渲染、`inspect` 後機率圖出現)。pytest 看不到的、Playwright 獨有:「頁面真的從 fanned frame 渲染了嗎」
- `teaching/demos/*.py` 改寫成第 2 層(驅動改 `POST /drive`,觀察用 Playwright);`pip playwright` 維持 creator 降級定位

## 10. 安全與多 client

- **`[R11]` `/drive` 只綁 localhost**:`/agent` 今天在 `0.0.0.0` 已會把 `exec_bash`/`write_file` 暴露 LAN(既有)。v3 註明 **`/drive` 不可與課堂 `0.0.0.0` 同開**。自學者單機 localhost 無虞
- **`[R9]` 多 client**:廣播給所有訂閱者。**假設單一活躍頁面**(`GEN_LOCK` 保證單一生成);舊 tab 也跟著動是已知、低害(自學者單機)→ 明寫此假設
- **CORS 不需改**(已驗):頁面與 API 同源 :9000,`/events` 同源 GET,AI 用 curl 無 CORS;`do_OPTIONS`/`CORS_HEADERS`(`server.py:44-48,307`)不動

## 11. 依賴總覽(學生 vs creator)

| | 學生(自學) | creator(維護/驗證) |
|---|---|---|
| llama.cpp + 2 models + requests + Python server | ✓ | ✓ |
| 支援 HTTP 的 AI agent(Claude Code/Codex 用 Bash curl) | ✓ | ✓ |
| ~~Node/npx + browser MCP~~(**v3 移除**) | ✗ | ✗ |
| pip playwright + chromium | ✗ | ✓(跑第 2 層 smoke) |

→ 自學者 setup 比 v2 更簡:免 Node、免 MCP 核准/信任。

## 12. 測試與驗證

- **server 合約(自動)**:`pytest agent/tests -q`(新 `publish`/`/drive`/`/events`/`/stop`/`/health`/`GEN_LOCK` test + 改寫 test_init)
- **端到端 relay+render(半自動)**:§9 第 2 層 Playwright smoke 綠
- **真機端到端**:fresh clone → 開 Claude Code → hi → AI 問角色 → 自學者 → AI 看 `subscribers` 確認頁面已開 → `drive` 開課、token 動、`inspect` 彈圖 → 放手給人在同頁面練
- init.py 真機:`/health` 不 hang、summary 與 exit code 一致、無殘留 MCP 檢查

## 檔案異動總覽

| 動作 | 檔案 |
|---|---|
| 修改(後端) | `agent/server.py`(`/events`+`/drive`+`/inspect`+`/stop`+`/health`、`SUBSCRIBERS`/`SUBS_LOCK`/`GEN_LOCK`/`publish()`、移植 `buildFinalPrompt`+CJK 守衛+`n_predict`、`/completion` streamed 讀、④ 改 fan-out、cancel flag)、`agent/tests/test_server.py`、`agent/tests/test_init.py` |
| 修改(前端) | `frontend/app.js`(全域 `/events` 訂閱 + per-panel registry、搬移 `runCompletion`/`runAgent`、刪 `LLAMA_URL` 直打、送出/Stop 改 `/drive`/`/stop`、移除 ①②③ preset handler、保留 renderProbs + ⑥ skill)、`frontend/index.html`/`index.zh-TW.html`(刪 ①②③ `.preset-select` + 互動 tab 的 `(?)`+散文、bump cache-bust) |
| 修改(進場/教材) | `init.py`(移除 MCP/Node、加 `/health`)、`AGENTS.md`/`AGENTS.zh-TW.md`、`README.md`(zh)/`README.en.md`、`teaching/README.md`/`.zh-TW.md`、`teaching/lesson-1..4`(×2 lang)、`teaching/demos/*.py`(改 `POST /drive`) |
| 刪除 | `.mcp.json`、`.codex/config.toml` |
| 不動 | `handle_swap`/`SWAP_LOCK`/`_detect_model`、模型、**Tab ⑥ skill(含 `.skill-preset`+`/skill-agent`)**、純文章 tab ⓪⑤⑦⑧ |

## 實作順序建議(單一 plan、五段)

1. **relay 骨幹** — `server.py` 加 `/events`(queue 訂閱)+ `publish()` 純函式 + `/drive`(先只接 ④,重用 `agent_loop` fan-out)+ `/inspect` + `/stop` + `/health` + `SUBSCRIBERS`/`SUBS_LOCK`/`GEN_LOCK`;pytest 測 `publish` + `GEN_LOCK` 409。**先用 ④(已走 server)證明 pub/sub + 兩消費者 + 序列化成立**
2. **生成引擎(承重牆)** — 移植 `buildFinalPrompt`+CJK 守衛+`n_predict`、`/completion` streamed 讀,把 ①②③ 收進 `/drive`;pytest 測 ②raw 無模板、③ think 注入 + `n_predict=1500`、temperature:0/n_probs:10
3. **前端純儀器化** — app.js 全域 `/events` + per-panel registry(§4.1)、搬 `runCompletion`/`runAgent`、刪 `LLAMA_URL`、送出/Stop 改 endpoint;刪 ①②③ preset + handler + 互動 tab `(?)`/散文;bump cache-bust;§9 第 2 層 smoke 改寫
4. **進場層** — init.py(移除 MCP/Node、加 `/health`)+ test_init;刪 `.mcp.json`/`.codex/config.toml`;AGENTS ×2 + README 改寫
5. **教材層** — teaching/README ×2 + lesson-1..4 ×2 Demo → relay playbook(含 §3.5 防呆、§8 fading);preset 字串逐字遷移

## 已知風險

- **承重牆估計風險**:§2 生成引擎是最大未知;先做實作順序 1(④ 證骨幹)再做 §2,降一次性風險
- **前端 per-panel 接線**(§4.1)是第二大未知;plan 階段定清 registry 介面
- **`/drive` 同步阻塞**:curl 等到生成結束(streamed,per-chunk timeout,§2.1);若課堂體感差,可改「立即回 `{accepted}` + 全程走 `/events`」(本版同步優先簡單)
- **移除 `(?)`/散文不可逆於 standalone 訪客**:D6 標可逆,spec review 拍板
- **單頁假設**:多 tab 廣播副作用(§10),自學者單機可接受
