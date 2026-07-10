# Tab 5 sent prompt 改用 `<|im_start|>` 格式 + 標記「這次新增要送出的」訊息

Date: 2026-07-10
Status: approved (brainstorming → ready for plan)

## 問題

1. **Tab 5 的 sent-prompt 展開器跟 tab 4/6 不一致。** tab 4/6 顯示 llama 的 templated
   `<|im_start|>…` 累積字串;tab 5 顯示 `messages[]` JSON 樹(當初刻意這樣,為了讓
   學生看到 SKILL.md 以 `role:"tool"` 躺在陣列裡)。使用者要三個 tab 一致。
2. **累積視圖看不出「這一發新加了什麼」。** 每 turn prompt 都在長,但哪一則是這次
   才進來的、驅動這次生成的「新輸入」,沒有標記。

## 目標

1. Tab 5 的 sent-prompt 改用 tab 4 的 `<|im_start|>` templated 格式(反轉先前的
   JSON-tree 決定,已與使用者確認)。
2. 在 **tab 4 + tab 5 + tab 6** 的 sent-prompt 展開器裡,標記「結尾空 assistant
   生成提示之前的最後一則非空訊息」——那在結構上永遠是**這一發剛加進來、要送出的
   新輸入**(turn 1 是原始問題;之後是餵回的工具結果;tab 5 turn 2 正好是 SKILL.md
   注入)。標記樣式:琥珀淡底 + 尾巴註釋。

## 為什麼「最後一則非空訊息」就是「這次新增要送出的」

sent-prompt 一律以 `add_generation_prompt: True` 產生,所以結尾一定是一個
**空 body 的 `<|im_start|>assistant`**(生成提示,wire.js 已特判成不可折的 marker 行)。
它前面那則非空訊息,就是這一 turn 最後 append 進 `messages` 的東西:
- turn 1 → 原始 user 問題
- turn N(N≥2)→ 餵回的工具結果(Qwen template 把 tool role render 成 `<|im_start|>user`)
- tab 5 turn 2 → read_file 讀到的 SKILL.md(注入現場)

所以規則是純結構的:**message 區塊裡,body 非空的最後一個**。不需要後端多給資料。

## 設計

### 1. 後端 `agent/skill_agent.py`:sent frame 多帶 templated `sent_prompt`

現況:`sent` frame 帶 `messages`(原始陣列)+ `tools`(名字)。前端 JSON.stringify 後
畫成 JSON 樹。

改法(照抄 tab 4 `agent/server.py:257-265` 的 `/apply-template` 呼叫):

- `agent/skill_agent.py:35` 的 `LLAMA_URL` 下面加:
  ```python
  LLAMA_TEMPLATE_URL = LLAMA_URL.replace("/v1/chat/completions", "/apply-template")
  ```
- 在 `sent` frame yield **之前**,對當下 `messages` + `active_tools` 算一次 template。
  `tools` key 的處理要**對齊同一迴圈裡生成 `req_body` 的既有寫法**
  (`skill_agent.py:357` 的 `if active_tools: req_body["tools"] = active_tools`)——
  空的時候**省略 tools key**,不要傳 `[]`:
  ```python
  tpl_payload = {"messages": messages, "add_generation_prompt": True}
  if active_tools:
      tpl_payload["tools"] = active_tools
  try:
      tpl = requests.post(LLAMA_TEMPLATE_URL, json=tpl_payload, timeout=5)
      tpl.raise_for_status()
      sent_prompt = tpl.json().get("prompt", "")
  except Exception as exc:
      sent_prompt = f"[template error] {type(exc).__name__}: {exc}"
  ```
  - `active_tools` 是完整的 OpenAI-format schema 陣列(不是名字)。no_skills 模式
    `active_tools` 為空 → 不帶 tools key,template 仍算得出來(就是沒有 `<tools>` 區塊)。
  - **不傳 `chat_template_kwargs`**:跟 tab 4 的 apply-template 呼叫一致(tab 4 也沒傳)。
    生成呼叫本身有 `enable_thinking: False`,但顯示用的 sent_prompt 與 tab 4 對齊即可。
- `sent` frame 加 `sent_prompt` 欄位;**`messages` 與 `tools` 保留**
  (`test_skill_agent.py:41` 斷言 `messages` 是 list;保留不動它)。

### 2. 前端 `frontend/app.js`:tab 5 onSent 改用 sent_prompt

`onSent`(`app.js:954-961`)把
```js
BUBBLE.wire(JSON.stringify(f.messages, null, 2)), { align: "right" }
```
改成
```js
BUBBLE.wire(f.sent_prompt, { markSent: true }), { align: "right" }
```
tab 5 就走跟 tab 4 完全相同的 wire.js chat-template 渲染路徑。

> `f.messages` 前端不再用,但 frame 仍帶著(後端測試在用)。這是刻意的低風險取捨。

### 3. `BUBBLE.wire` 傳遞 render 選項

`frontend/app.js` 的 `BUBBLE.wire`(`:364`)簽名從 `wire(text)` 改成
`wire(text, opts)`,把 `opts` 透傳給 `WIRE.render(text, opts)`。其餘 box 樣式不變。

### 4. wire.js:`markSent` highlight

**純函式(可 node 測試):** 新增
```js
function lastContentfulIndex(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].body.trim() !== "") return i;
  }
  return -1;
}
```
掛進 `return { … }` 的 `_lastContentfulIndex`。

**DOM 層:**
- `render(text, opts)` 收 `opts`,`renderChat(text, opts)` 也收。`render` 的 JSON 分支
  忽略 opts(JSON 視圖不 highlight)。
- `renderChat`:算 `const target = opts.markSent ? lastContentfulIndex(msgs) : -1;`,
  逐則 render 時把 `i === target` 當 `isTarget` 傳給 `messageBlock`。
- `messageBlock(msg, isTarget)`:當 `isTarget` 為真(它一定是非空 body,走 fold 分支):
  - fold 的 summary 加琥珀淡底 class:`bg-inject-tint rounded px-1`
  - summary 尾端 append 一個註釋 span:
    `el("span", "text-inject ml-2", label("wire_sent_now"))`
  - 空 body 的 marker 行分支永遠不會是 target(target 依定義非空),不用改。

`fold(summary, body, open)` 目前對 summary children 陣列直接 append;琥珀底要加在
`<summary>` 元素本身的 className 上,所以 `messageBlock` 需要拿到 fold 回傳的
`<details>` 再改它的 `summary` class —— 或讓 `fold` 收一個可選的 `summaryClass`。
**採後者**:`fold(summaryChildren, bodyNode, open, summaryClass)`,預設 `summaryClass=""`,
target 傳 `"bg-inject-tint rounded px-1"`。只有一個呼叫點(messageBlock)會傳它,
其餘(toolsBlock/toolCallBlock/jsonNode)維持不傳。

### 5. 套用 `markSent: true` 的三個點

只有 sent-prompt 展開器:
- tab 4:`app.js:771-772`(`BUBBLE.wire(sent_prompt)` → 加 `{ markSent: true }`)
- tab 5:§2 的 onSent
- tab 6:`app.js:1199-1200`(`BUBBLE.wire(f.sent_prompt)` → 加 `{ markSent: true }`)

**不加**的(維持 `BUBBLE.wire(text)`,無 highlight):
- 「模型吐的原始訊息」received_chunk(tab4 `:788`、tab6 `:1216`)
- 「送給使用者的原始訊息」(tab4 `:813`、tab6 `:1240`)
- tab 5 的 received(`app.js:991`、`:1051`)、tab 6 protocol card(`:1175`)、⑤ 腳本/解剖(`BUBBLE.pre`)

### 6. i18n(雙語)

`app.js` 的 `I18N` 加:
```js
wire_sent_now: {
  'en':    '← new this turn — being sent',
  'zh-TW': '← 這次新增、要送出的',
},
```

### 7. 教材(雙語 6 檔)

- **lesson-5**(`teaching/lesson-5-skill.md` + `.zh-TW.md`):現在描述 sent 展開器是
  「`messages[]` JSON 陣列、SKILL.md 以 `role:"tool"` 節點折起來」。改成:sent 展開器
  跟 tab 4 一樣是 `<|im_start|>` 累積視圖;SKILL.md 注入顯示成一個 `<|im_start|>user`
  區塊(字元數大),而且它會被琥珀 highlight 標成「這次新增要送出的」—— 正好是注入現場。
  更新「六顆泡泡、六個展開器」那段對琥珀泡 sent 內容的描述。
- **lesson-4 / lesson-6**(4 檔):sent 展開器多了一個琥珀 highlight,補一句
  「最後一則(琥珀底)是這一發剛加進來、要送給 model 的新輸入」。

### 8. 不動的東西

- `frontend/styles.css` 一個位元組不改(全用 Tailwind utility;`.tok-static` 護欄不碰)。
- 後端 tab 4(`server.py`)、tab 6(`mcp_agent.py`)的 sent_prompt 產生方式不變 ——
  它們本來就送 templated 字串,只有前端多加 `{ markSent: true }`。
- wire.js 既有 15 個 node 測試維持綠。

### 9. Cache-bust

`app.js` 與 `wire.js` 都改:
- `wire.js?v=1` → `?v=2`
- `app.js?v=93` → `?v=94`
- `styles.css?v=66` 不動
- 兩個 HTML 同號。

## 驗收

1. `pytest agent/tests -q` 全綠(skill_agent 的 sent frame 新增 sent_prompt;
   更新/新增測試斷言 `sent_prompt` 是含 `<|im_start|>` 的字串)
2. `node --test frontend/wire.test.js` 全綠,含新測試:
   - `_lastContentfulIndex`:正常回最後一個非空 index;結尾空 assistant 被跳過;
     全空回 -1;單一非空回 0
   - mutation:把判斷改成「最後一則(含空的)」會讓「跳過結尾空 assistant」那條紅
3. ④ 送「現在幾點?」,展開 turn 2 的 sent:
   - 是 `<|im_start|>` 累積視圖(本來就是)
   - **最後一則非空**(`<|im_start|>user`,餵回的工具結果)有琥珀底 + 尾巴
     「← 這次新增、要送出的」;結尾空 `<|im_start|>assistant` 沒有 highlight
   - turn 1 的 sent:highlight 落在原始 user 問題那則
4. ⑤ 送「台北今天天氣怎樣?」:
   - sent 展開器變成 `<|im_start|>` 視圖(**不再是 JSON 樹**)
   - turn 2 的 sent:SKILL.md 那則(`<|im_start|>user`,字元數大)被琥珀 highlight
     標成「這次新增要送出的」;展開看得到 SKILL.md 全文
   - user 泡 turn 1 的 sent:只有 system + user,highlight 落在 user 問題
5. ⑥ 送「現在幾點?」:sent 展開器最後一則非空有琥珀 highlight
6. **received 視圖不被 highlight**:展開任一 tab 的「模型吐的原始訊息」,裡面
   沒有琥珀底、沒有「這次新增」註釋
7. **迴歸**:每顆泡泡仍 ≤1 直接子 `<details>`;tab③ token `cursor: default`;
   tab① `cursor: pointer`;console 0 errors
8. 兩個 HTML:`wire.js?v=2` + `app.js?v=94` + `styles.css?v=66`;`styles.css` 未動

## 不在範圍

- Tabs ①②③
- 把 highlight 也套到 received / JSON 視圖
- 改變 tab 4/6 後端 sent_prompt 的產生方式
