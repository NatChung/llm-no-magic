# Chat bubble:user 泡靠右 + 每泡最多一個收合按鈕(tabs ④⑤⑥)

Date: 2026-07-10
Status: approved, reviewed (brainstorming → ready for plan)
Review: subagent doc-review 2026-07-10 — 5 findings, all confirmed against code, all folded in below.

## 問題

Tabs ④⑤⑥ 的 turns 流直接從模型的藍泡開始 —— 學生送出的問題只活在輸入框裡,
不在對話流中,看不出「這串來回是誰起頭的」。

同時,泡泡底下的 `▸` 展開器數量不一致:模型藍泡掛 2 個、工具紫泡 0–1 個、
綠泡 1–2 個。學生要記「哪個泡有幾個按鈕、各展開什麼」,認知負擔跟教學焦點無關。

## 目標

1. user 從輸入框送出的問題,以自己的泡泡出現在 turns 流最前面,靠右。
2. 每個泡泡**最多一個**收合按鈕。有按鈕時,展開的是**這一發的原始 wire 內容**:
   - 藍泡 / 綠泡 → 此 turn 送出的 prompt
   - ⑤ 琥珀泡 → 注入的 SKILL.md 全文
   - ⑤ 紫泡 → 腳本原始碼
   本體已經印出原文的泡泡(user 泡、④⑥ 工具紫泡)**不給按鈕**。
3. ④⑤⑥ 三個 tab 行為一致。

## 對齊語彙(不變的部分 + 新增)

```
左   = 模型在想                (藍  · text-final)
右   = 東西進來:
         user 問題             (灰  · surface-2 / edge)   ← 新增
         L2 注入               (琥珀 · text-inject)
         工具回傳              (紫  · text-tool)
全寬 = 給使用者                (綠  · text-result)
```

「右 = 東西進來」跟 lesson-5 既有的乒乓旁白(「左=model 在想、右=東西進來」)
一致,user 的問題正是最先「進來」的東西 —— 教材的讀法不用改寫,只需補一句
user 泡。

## 設計

### 1. `BUBBLE.user({ text })` — 新 builder

放在 `frontend/app.js` 的 `BUBBLE` 物件裡(`app.js:294`),跟 `model` / `tool` /
`finalBlock` 同層。

- row:`ml-auto max-w-[88%] md:max-w-[75%] flex flex-col items-end`(沿用 `tw.tRow`)
- label:`t('user_bubble_label')` → en `You` / zh-TW `你`,新增 `tw.uLabel`
  = `text-xs font-semibold text-ink-soft mb-1`
- bubble:`tw.uBubble` = `rounded-2xl rounded-tr-sm bg-surface-2 border border-edge
  px-4 py-3 font-mono text-sm break-all leading-relaxed text-ink text-left`
- **無 caption、無 `<details>`**
- 回傳 `{ row, bubble }`,跟其他 builder 同形

不新增任何 CSS 顏色 token —— `surface-2` / `edge` / `ink-soft` / `ink` 都已存在。

### 2. 三個 tab 的 `onDriveStart` 渲染 user 泡

`drive_start` frame 已經帶 `f.user`(`server.py:435-436`),不需要新 frame。
三個 panel 的 `onDriveStart` 在該處都看得到 `turnsEl` 與 `f.user`
(`setupAgent` turnsEl 在 `app.js:690`、`setupSkillTab` 在 `app.js:855`、
`setupMcpTab` 在 `app.js:1065`)。

插入點:各 panel 清空 turns 之後,**且必須在 `app.js:813` 之前**(見下)。

```js
if (f.user) turnsEl.appendChild(BUBBLE.user({ text: f.user }).row);
```

- Tab ④ `setupAgent.beginRun`(`app.js:807`):`clearAll()` 之後
- Tab ⑤ `PANELS["5"].onDriveStart`:`clearAll()` 之後
- Tab ⑥ `PANELS["6"].onDriveStart`:`turnsEl.innerHTML = ""` 之後

**順手修掉一個既有 bug:** `app.js:813` 的 `refreshPreview()` 呼叫是壞的 ——
`refreshPreview` 定義在 `setupPanel` 內(`app.js:536`),`setupAgent` 從
`app.js:687` 才開始,兩者不同 scope。實測 tab④ 每次 drive 都拋
`ReferenceError: refreshPreview is not defined at beginRun (app.js:813)`。
目前無害只因為它是 `beginRun` 的最後一行。**刪掉這一行**(tab④ 頁面上
根本沒有 preview 框,`app.js:694` 註解已說明 preview 改由 AI 用 `/preview` 演)。

**Banner 順序(已確認接受):** trace summary banner 用 `turnsEl.prepend()`,
所以 final 之後順序是 `banner → user 泡 → 藍泡 → …`。banner 是整段的標題,
蓋在 user 泡上方是可接受的。不改 prepend。

### 3. 每泡最多一個按鈕

| tab | 泡泡 | 展開內容 | 目前 |
|---|---|---|---|
| ④⑤⑥ | user 灰 | —(本體即原文) | 不存在 |
| ④⑥ | 模型藍 | 此 turn 送出的 prompt(templated 字串) | ④ 原始 token + 收到的 chunk;⑥ 收到的 chunk |
| ④⑥ | 工具紫 | —(本體即原文) | 下一發 prompt |
| ④⑥ | 綠 | 此 turn 送出的 prompt(templated 字串) | ④ 原始 token;⑥ 無 |
| ⑤ | 模型藍 | 此 turn 送出的 prompt(`messages[]` JSON) | sent + received |
| ⑤ | 注入琥珀 | SKILL.md 全文 | 不變 |
| ⑤ | 腳本紫 | 腳本原始碼 | 不變 |
| ⑤ | 綠 | 此 turn 送出的 prompt(`messages[]` JSON) | sent + received |

規則的精確敘述:

> **每個泡泡最多一個收合按鈕。本體已經印出原文的泡泡(user 泡、④⑥ 工具紫泡)
> 不給按鈕。⑤ 腳本紫泡的按鈕展開的是腳本原始碼 —— 那不是回傳值的重複,
> 而是「你看得到、model 從頭到尾沒看過」的教學證物。**

為什麼 ④⑥ 用 templated 字串、⑤ 用 `messages[]`:
- ④⑥ 的教學重點是「送進 model 的到底是什麼 bytes」(`<|im_start|>`、`<tools>` 區塊),
  templated 字串直接就是答案 —— 也是這個 repo「只有 token 跟約定」的主旨
- ⑤ 的教學重點是「SKILL.md 躺在 messages 裡」(lesson-5「注入的現場」),
  `messages[]` 視角才看得到那一則 tool message
- 兩者共用 `sent_prompt_summary` 這個 i18n key

⑤ 注入琥珀泡底下那行提示(`l2_see_sent_hint`:「→ 展開下一個 turn 的 sent,
看它躺在 messages 裡」)保留 —— 它是文字提示不是按鈕,而且 sent 展開器仍在。

### 4. Server:`sent_prompt` 取代 `next_prompt`

現況(已驗證):

| | 函式 | `next_prompt` 怎麼算 |
|---|---|---|
| ④ | `agent_loop`(`server.py:240`) | `/apply-template` POST(`LLAMA_TEMPLATE_URL`,`server.py:216,298-304`)→ templated 字串 |
| ⑥ | `mcp_agent.py` | `json.dumps(messages, indent=2)`(`mcp_agent.py:172`)→ JSON 字串,**沒有 template 基礎設施** |

兩者都只在 `tool_calls` 非空時才算,而且是「下一發要送的」,不是「這一發送出的」。

改法:**在呼叫 model 之前**對當下的 `messages` 算一次 template
(`add_generation_prompt=True`),當作本 turn 的 `sent_prompt` 放進 `turn_complete`;
刪除 `next_prompt`。

**④ `agent_loop`(`server.py`)**
- 把現有的 `/apply-template` 呼叫從迴圈尾(`server.py:295-306`)搬到 model 呼叫之前
- `tools` 參數維持 `TAB4_TOOL_SCHEMAS`
- 保留現有的 `except Exception` → `f"[template error] …"` 降級行為

**⑥ `mcp_agent.py`(新增基礎設施)**
- 新增 `LLAMA_TEMPLATE_URL = LLAMA_URL.replace("/v1/chat/completions", "/apply-template")`
  (照 `server.py:216` 的寫法)
- 在 `requests.post(LLAMA_URL, …)`(`mcp_agent.py:133`)**之前**,對當下 `messages`
  發一次 `/apply-template`,`tools` 帶握手拿到的 `openai_tools`(`mcp_agent.py:131`
  用的同一個變數),`add_generation_prompt=True`
- 同樣的 try/except 降級
- 教學價值:lesson-6 的打點是「`<tools>` 裡的 get_time + get_weather 是**問來的**」
  —— 展開藍泡看到它們真的躺在 templated prompt 裡,就是那句話的物證

**兩者共通**
- `next_prompt(turn N) ≡ sent_prompt(turn N+1)`(`next_prompt` 是在 assistant +
  tool message 都 append 完之後算的,正好等於下一 turn 開頭的 `messages`)
  —— 視角錯一格,無資訊損失
- 額外賺到 **turn 1 的 sent_prompt**:system prompt + `<tools>` 清單第一次現形
- Template 呼叫次數:原本「有 tool_call 才算」→ 現在「每 turn 都算」,
  ④ 只多 final turn 那一次;⑥ 從 0 次變每 turn 一次(新成本,已接受)
- 每個 turn(含 content-only 的 final turn)都有 `sent_prompt`。
  已確認 `turn_complete` 的 yield(`server.py:308-316`)在 `if not tool_calls`
  (`server.py:318`)**之前**,所以 final turn 一定拿得到 —— 綠泡有得展

Tab ⑤(`skill_agent.py`)已有獨立的 `sent` frame(`skill_agent.py:364`,帶原始
`messages` 陣列),**不動**。

### 5. 檔案層級的變更清單

**`frontend/app.js` — 刪**
- `makeTokensBox()`(`app.js:708`)及其 **2 個**呼叫點(`app.js:742`、`app.js:769`)
- `BUBBLE.details(t('raw_tokens_summary'), …)` **2 處**(`app.js:742`、`app.js:769`)
- `BUBBLE.details(t('received_summary'), …)` **4 處**(`app.js:745`、`922`、`985`、`1123`)
- `BUBBLE.details(t('next_prompt_summary'), …)` **2 處**(`app.js:759`、`1139`)
- tab⑤ 的 `onReceived` handler、`pendingReceived` 變數、`PANELS["5"].onReceived` 註冊
- `app.js:813` 的 `refreshPreview()` 壞呼叫(見 §2)
- i18n keys:`raw_tokens_summary`、`received_summary`、`next_prompt_summary`

**`frontend/app.js` — 加**
- `BUBBLE.user()` builder + `tw.uLabel` + `tw.uBubble`(§1)
- i18n key `user_bubble_label`(en `You` / zh-TW `你`)
- 三個 panel 的 `onDriveStart` 各一行 user 泡渲染(§2)
- **④ `renderTurnBlock`(`app.js:725`):藍泡分支與綠泡分支各加一個**
  `BUBBLE.details(t('sent_prompt_summary', { turn }), BUBBLE.pre(sent_prompt))`
- **⑥ `onTurnComplete`(`app.js:1109`):藍泡與綠泡各加一個**同上
  (綠泡分支目前完全沒有展開器,`app.js:1143`)
- ④ `renderTurnBlock` 與 ⑥ `onTurnComplete` 的簽名/frame 讀取要接上新的
  `sent_prompt` 欄位

**`frontend/styles.css` — 不動**
`.tok.tok-static`(`styles.css:79-80`)**必須留著**:它不只給 `makeTokensBox` 用,
tab③(推理,無機率面板)的 token 也走這條 —— `app.js:566`
`span.className = "tok tok-static"`。`app.js:713` 的註解就寫著「必留」。
刪掉會讓 tab③ 的 token 變回 `.tok` 的 `cursor:pointer` + hover 高亮,
看起來可點但沒有 handler。tab③ 明確不在本次範圍內。

**`agent/server.py`**
- `agent_loop`:刪 `received_chunk`(`server.py:287-290,314`)、
  刪 `next_prompt`(`server.py:292-306,315`)、加 `sent_prompt`(呼叫前算)

**`agent/mcp_agent.py`**
- 加 `LLAMA_TEMPLATE_URL` 常數
- 刪 `received_chunk`(`mcp_agent.py:171`)、刪 `next_prompt`(`mcp_agent.py:172-173`)
- 加 `sent_prompt`(呼叫前算,`tools=openai_tools`)

**`agent/skill_agent.py`**
- 刪 `received` frame 的 yield(`skill_agent.py:385`)

**保留(不要順手刪)**
- `message_tokens`(④):tab④ 綠泡的內容仍由它拼出
  (`app.js:766` `.map(s => s.token).join("")`),且 `/drive` aggregate 回傳它
- tab④ llama 請求的 `logprobs: True, top_logprobs: 10`:`message_tokens` 靠它。
  是否可省是另一個議題,不在本次範圍
- ⑥ 的 `content` 欄位:tab⑥ 綠泡用 `f.content`(`app.js:1143`),不是 `message_tokens`

### 6. 測試

`agent/tests/test_server.py`:
- `agent_loop` 的假 frame **共 3 處**:`test_server.py:247`(目前就沒帶
  `received_chunk` / `next_prompt`,不用改但要確認新 shape 不會讓斷言失效)、
  `test_server.py:991-993`、`test_server.py:1172` — 後兩處去掉
  `received_chunk` / `next_prompt`,加 `sent_prompt`
- `test_server.py:95` 的註解提到「per-turn template call added in next_prompt」,
  改寫成 sent_prompt
- 新增:每個 `turn_complete`(含 final turn)都帶非空 `sent_prompt`

`agent/tests/test_mcp_agent.py`:
- `test_mcp_agent.py:39` 目前斷言 `"message_tokens" not in turns[0]` —— 保留
- 新增:`turn_complete` 帶 `sent_prompt`、不帶 `received_chunk` / `next_prompt`
- mcp_agent 新增的 `/apply-template` 呼叫要在測試裡 mock 掉

風格:維持既有的 plain pytest function + mock,不引入 class/fixture 新花樣。

### 7. 教材(bilingual,6 個檔)

user 泡會出現在 ④⑤⑥ 三個 tab,三課都要提一句。

- `teaching/lesson-4-agent.md:31` 與 `lesson-4-agent.zh-TW.md:35`:
  現在明講「原始 token 流 / 收到的原文 / 再送出的累積 prompt」三個展開器 ——
  改成「每個藍泡與綠泡下面有一個 `▸ 此 turn 送出的 prompt`,展開看對話怎麼
  累積成下一發輸入」。另補一句 user 泡。
- `teaching/lesson-5-skill.md` 與 `.zh-TW.md`:乒乓讀法補一句 user 泡
  (「最上面靠右的灰泡是你送出的問題 —— 右邊都是『進來的東西』」)。
  `.zh-TW.md:52` 的「展開紫泡泡下的『腳本原始碼』」與綠泡 sent 展開器都仍成立,不動。
- `teaching/lesson-6-mcp.md` 與 `.zh-TW.md`:補一句 user 泡。
  另可加一句:藍泡展開的 templated prompt 裡看得到握手問來的 `<tools>`。
  (已查:`.zh-TW.md:26` 的「展開 prompt」指 `/preview`、`:55` 的「展開頁尾
  『完整文章』」指頁尾 expander,兩者都不是泡泡按鈕,不受影響。)

### 8. Cache-bust

只有 `app.js` 有改(`styles.css` 依 §5 不動):
- `frontend/index.html:334` 與 `frontend/index.zh-TW.html:334`:`app.js?v=86` → `?v=87`
- `styles.css?v=66`(兩檔的 `:47`)**維持不變**

## 驗收

1. `pytest agent/tests -q` 全綠
2. 開 http://localhost:9000/,對 ④⑤⑥ 各送一句話:
   - 最上面出現靠右的灰色 user 泡,內容 = 送出的原文,底下沒有 `▸`
   - 藍泡底下恰好一個 `▸ 此 turn 送出的 prompt`,展開有內容(④⑥ turn 1 看得到
     `<|im_start|>system` 與 `<tools>` 清單;⑤ 看得到 `messages[]`)
   - ④⑥ 紫泡底下沒有 `▸`
   - ⑤ 琥珀泡一個 `▸ SKILL.md 全文` + 一行提示;⑤ 腳本紫泡一個 `▸ 腳本原始碼`
   - 綠泡底下恰好一個 `▸ 此 turn 送出的 prompt`
3. 頁面上找不到「原始 token」/「收到的原文」/「下一發 prompt」任何一個展開器
4. **迴歸**:tab③ 送一句話,token 仍然是不可點的(`cursor: default`、hover 不變色)
5. **迴歸**:tab④ drive 時 browser console 沒有 `ReferenceError`

## 不在範圍

- Tabs ①–③ 的行為(§驗收 4 只是迴歸確認,不改它們)
- tab④ 是否可以省掉 `logprobs` 請求
- RAG / 其他教學內容
