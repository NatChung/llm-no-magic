# Chat bubble:user 泡靠右 + 每泡最多一個收合按鈕(tabs ④⑤⑥)

Date: 2026-07-10
Status: approved (brainstorming → ready for plan)

## 問題

Tabs ④⑤⑥ 的 turns 流直接從模型的藍泡開始 —— 學生送出的問題只活在輸入框裡,
不在對話流中,看不出「這串來回是誰起頭的」。

同時,泡泡底下的 `▸` 展開器數量不一致:模型藍泡掛 2 個、工具紫泡 0–1 個、
綠泡 1–2 個。學生要記「哪個泡有幾個按鈕、各展開什麼」,認知負擔跟教學焦點無關。

## 目標

1. user 從輸入框送出的問題,以自己的泡泡出現在 turns 流最前面,靠右。
2. 每個泡泡**最多一個**收合按鈕,展開的是**該泡泡自己的原始內容**;
   本體已經是原文的泡泡不給按鈕。
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

放在 `frontend/app.js` 的 `BUBBLE` 物件裡,跟 `model` / `tool` / `finalBlock` 同層。

- row:`ml-auto max-w-[88%] md:max-w-[75%] flex flex-col items-end`(沿用 `tw.tRow`)
- label:`t('user_bubble_label')` → en `You` / zh-TW `你`,樣式沿用 `tw.tLabel`
  的字級但用中性色 `text-ink-soft`(新增 `tw.uLabel`)
- bubble:`tw.uBubble` = `rounded-2xl rounded-tr-sm bg-surface-2 border border-edge
  px-4 py-3 font-mono text-sm break-all leading-relaxed text-ink text-left`
- **無 caption、無 `<details>`**
- 回傳 `{ row, bubble }`,跟其他 builder 同形

不新增任何 CSS 顏色 token —— `surface-2` / `edge` / `ink-soft` / `ink` 都已存在。

### 2. 三個 tab 的 `onDriveStart` 渲染 user 泡

`drive_start` frame 已經帶 `f.user`(`server.py:435`),不需要新 frame。

- Tab ④ `setupAgent`:`beginRun` 內 `clearAll()` 之後
- Tab ⑤ `setupSkillTab`:`PANELS["5"].onDriveStart` 內 `clearAll()` 之後
- Tab ⑥ `setupMcpTab`:`PANELS["6"].onDriveStart` 內清空 `turnsEl` 之後

```js
if (f.user) turnsEl.appendChild(BUBBLE.user({ text: f.user }).row);
```

**Banner 順序(已確認接受):** trace summary banner 用 `turnsEl.prepend()`,
所以 final 之後順序是 `banner → user 泡 → 藍泡 → …`。banner 是整段的標題,
蓋在 user 泡上方是可接受的。不改 prepend。

### 3. 每泡最多一個按鈕

| tab | 泡泡 | 展開內容 | 目前 |
|---|---|---|---|
| ④⑤⑥ | user 灰 | —(本體即原文) | 不存在 |
| ④⑥ | 模型藍 | 此 turn 送出的 prompt | 原始 token + 收到的 chunk |
| ④⑥ | 工具紫 | —(本體即原文) | 下一發 prompt |
| ④⑥ | 綠 | 此 turn 送出的 prompt | 原始 token(④)/ 無(⑥) |
| ⑤ | 模型藍 | 此 turn 送出的 prompt(`messages[]`) | sent + received |
| ⑤ | 注入琥珀 | SKILL.md 全文 | 不變 |
| ⑤ | 腳本紫 | 腳本原始碼 | 不變 |
| ⑤ | 綠 | 此 turn 送出的 prompt(`messages[]`) | sent + received |

規則的精確敘述:

> **每個泡泡最多一個收合按鈕。本體已經印出原文的泡泡(user 泡、④⑥ 工具紫泡)
> 不給按鈕。⑤ 腳本紫泡的按鈕展開的是腳本原始碼 —— 那不是回傳值的重複,
> 而是「你看得到、model 從頭到尾沒看過」的教學證物。**

⑤ 注入琥珀泡底下那行提示(`l2_see_sent_hint`:「→ 展開下一個 turn 的 sent,
看它躺在 messages 裡」)保留 —— 它是文字提示不是按鈕,而且 sent 展開器仍在。

### 4. Server:`sent_prompt` 取代 `next_prompt`

現況:`run_agent_stream`(tab④, `server.py`)與 `mcp_agent.py` 的 `turn_complete`
只給 `next_prompt` = 「下一發要送的 prompt」,而且只在有 `tool_calls` 時計算。
沒有「此 turn 送出的 prompt」。

改法:**在呼叫 model 之前**對當下的 `messages` 算一次 template
(`add_generation_prompt=True`),當作本 turn 的 `sent_prompt` 放進 `turn_complete`。

- `next_prompt(turn N)` ≡ `sent_prompt(turn N+1)` —— 只是視角錯一格,無資訊損失
- 額外賺到 **turn 1 的 sent_prompt**:system prompt + `<tools>` 清單第一次現形,
  教學價值高於 next_prompt
- Template 呼叫次數:原本「有 tool_call 才算」→ 現在「每 turn 都算」,
  只多 final turn 那一次
- 每個 turn(含 content-only 的 final turn)都有 `sent_prompt`,所以綠泡也有得展

Tab ⑤(`skill_agent.py`)已有獨立的 `sent` frame(帶原始 `messages` 陣列),
**不動**。⑤ 的展開器顯示 `JSON.stringify(messages, null, 2)` —— lesson-5 要的正是
「SKILL.md 躺在 messages 裡」這個 messages[] 視角,不是 templated 字串。
④⑥ 顯示 templated 字串。兩者共用 `sent_prompt_summary` 這個 i18n key。

### 5. 刪除清單

前端(`frontend/app.js`):
- `makeTokensBox()`(tab④ 的可點 token box)及其唯一呼叫點
- `BUBBLE.details(t('raw_tokens_summary'), …)` 三處
- `BUBBLE.details(t('received_summary'), …)` 四處(④ ×1、⑤ ×2、⑥ ×1)
- `BUBBLE.details(t('next_prompt_summary'), …)` 兩處(④ ×1、⑥ ×1)
- tab⑤ 的 `onReceived` handler、`pendingReceived` 變數、`PANELS["5"].onReceived` 註冊
- i18n keys:`raw_tokens_summary`、`received_summary`、`next_prompt_summary`

前端(`frontend/styles.css`):
- `.tok-static` 規則(唯一使用者是 `makeTokensBox`;`.tok` 本身 tabs ①–③ 仍在用,保留)

後端:
- `agent/server.py`:`received_chunk` 的計算與欄位、`next_prompt` 的計算與欄位
- `agent/mcp_agent.py`:`received_chunk` 欄位、`next_prompt` 欄位
- `agent/skill_agent.py`:`received` frame 的 yield

新增:
- i18n key `user_bubble_label`(en `You` / zh-TW `你`)
- `BUBBLE.tw.uLabel`、`BUBBLE.tw.uBubble`
- `sent_prompt` 欄位(`server.py` `run_agent_stream`、`mcp_agent.py`)

保留(不要順手刪):
- `message_tokens`:tab④ 綠泡的內容仍由它拼出(`.map(s => s.token).join("")`),
  且 `/drive` aggregate 回傳它
- tab④ llama 請求的 `logprobs: True, top_logprobs: 10`:雖然 token box 沒了,
  但 `message_tokens` 還靠它。是否可省是另一個議題,不在本次範圍

### 6. 測試

`agent/tests/test_server.py` 需更新的斷言:
- L991–993、L1172 的 `turn_complete` 假 frame:去掉 `received_chunk` / `next_prompt`,
  加 `sent_prompt`
- L95 的註解提到 next_prompt 的 per-turn template call,改寫成 sent_prompt
- 新增測試:每個 `turn_complete`(含 final turn)都帶非空 `sent_prompt`

`agent/tests/test_mcp_agent.py`:確認 `turn_complete` 新 shape。

風格:維持既有的 plain pytest function + mock,不引入 class/fixture 新花樣。

### 7. 教材(bilingual,4 個檔)

- `teaching/lesson-4-agent.md` L31 與 `lesson-4-agent.zh-TW.md` L35:
  明講「原始 token 流 / 收到的原文 / 再送出的累積 prompt」三個展開器 —— 改成
  「每個藍泡與綠泡下面有一個 `▸ 此 turn 送出的 prompt`,展開看對話怎麼累積成下一發輸入」
- `teaching/lesson-5-skill.md` 與 `.zh-TW.md`:乒乓讀法補一句 user 泡
  (「最上面靠右的灰泡是你送出的問題 —— 右邊都是『進來的東西』」)。
  L52 的「展開紫泡泡下的『腳本原始碼』」與綠泡 sent 展開器都仍成立,不動。
- `teaching/lesson-6-mcp.md` / `.zh-TW.md`:**不用改**。已查:zh-TW L26 的「展開 prompt」
  指的是 `/preview`、L55 的「展開頁尾『完整文章』」指的是頁尾 expander,
  兩者都不是泡泡的收合按鈕;EN 版無相關字串。

### 8. Cache-bust

`frontend/index.html` 與 `frontend/index.zh-TW.html` 兩個檔都要改(必須同號):
- `app.js?v=86` → `?v=87`(app.js 有改)
- `styles.css?v=66` → `?v=67`(`.tok-static` 被刪)

## 驗收

1. `pytest agent/tests -q` 全綠
2. 開 http://localhost:9000/,對 ④⑤⑥ 各送一句話:
   - 最上面出現靠右的灰色 user 泡,內容 = 送出的原文,底下沒有 `▸`
   - 藍泡底下恰好一個 `▸ 此 turn 送出的 prompt`,展開有內容(turn 1 看得到
     system prompt 與 `<tools>` 清單)
   - ④⑥ 紫泡底下沒有 `▸`
   - ⑤ 琥珀泡一個 `▸ SKILL.md 全文` + 一行提示;⑤ 腳本紫泡一個 `▸ 腳本原始碼`
   - 綠泡底下恰好一個 `▸ 此 turn 送出的 prompt`
3. 頁面上找不到「原始 token」/「收到的原文」/「下一發 prompt」任何一個展開器

## 不在範圍

- Tabs ①–③(沒有 chat bubble)
- tab④ 是否可以省掉 `logprobs` 請求
- RAG / 其他教學內容
