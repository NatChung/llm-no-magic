# 展開器內容:語法上色 + 結構折疊(wire view)

Date: 2026-07-10
Status: approved (brainstorming → ready for plan)

## 問題

Tabs ④⑤⑥ 每顆泡泡的 `▸` 展開器都吐出一整塊未上色的純文字 `<pre>`。
最長的一塊(⑤ 注入 SKILL.md 後的 `messages[]`)超過 1300 字元,學生只能一直捲。
`<tools>` 區塊佔 412 字元,而且多數時候不需要逐字看。

## 目標

1. **語法上色**:JSON 的 key / 字串 / 數字、XML 標籤、chat-template 標記各自有顏色
2. **結構折疊**:templated prompt 依 `<|im_start|>…<|im_end|>` 折成每則訊息一塊;
   `<tools>` / `<tool_call>` 再折一層;JSON 逐物件/陣列節點折
3. 離線可用、零新外部依賴

## 展開器內容的三種型態(已清點)

`frontend/app.js` 目前有 12 個 `BUBBLE.pre(...)` 呼叫點:

| 型態 | 呼叫點 | 內容 |
|---|---|---|
| **chat template 字串** | `app.js:739`(④ sent_prompt)、`:755` `:780`(④ received_chunk)、`:1162`(⑥ sent_prompt) | `<\|im_start\|>` 標記 + 散文 + `<tools>` JSON + `<tool_call>` XML |
| **JSON** | `:927`(⑤ messages[])、`:958` `:1018`(⑤ received)、`:1137`(⑥ protocol card)、`:1178` `:1202`(⑥ received_chunk) | `JSON.stringify(…, null, 2)` 或 `json.dumps(…, indent=2)` |
| **純碼(不在範圍)** | `:990`(⑤ 腳本原始碼 Python)、`:1091`(⑤ 解剖卡 YAML/Markdown/Python) | 保留現有 `BUBBLE.pre` |

→ renderer 可以**自己偵測型態**,呼叫點不需要分類。

## 真實資料的三個陷阱(已用 `POST /preview` 實測)

1. **prompt 結尾的 assistant 區塊沒有 `<|im_end|>`。**
   實測 tab④ 的 sent_prompt(612 字元)結尾是 `…<|im_start|>assistant\n`。
   切段的正則若要求成對的 `<|im_end|>`,最後一塊會被吃掉。

2. **`<tool_call>` 也出現在 system 訊息裡當格式範例,而且不是合法 JSON:**
   ```
   <tool_call>
   {"name": <function-name>, "arguments": <args-json-object>}
   </tool_call>
   ```
   `<function-name>` 是佔位符。`JSON.parse` 會拋。折疊層必須容忍 → 退回純文字。

3. **`<tools>` 區塊裡是「每行一個 JSON 物件」,不是一個 JSON 陣列。**
   要逐行 parse,不能整塊 parse。

## 設計

### 1. 新檔 `frontend/wire.js`

`app.js` 已經 1263 行。這塊是自成一格的「wire 內容 → DOM」轉換,獨立成檔。
無 module system(zero-build),用全域物件,`<script>` 排在 `app.js` 之前。

```js
// 唯一對外介面
WIRE.render(text) -> HTMLElement
```

自動偵測:`text.trim()` 開頭是 `{` 或 `[` → JSON renderer;否則 → chat-template renderer。

**安全性(硬性要求):** 全程 `createElement` + `textContent`,**絕不使用 `innerHTML`**。
內容裡有 `<tool_call>`、`<tools>`、`<|im_start|>` —— 丟進 `innerHTML` 會被當標籤解析,
畫面會缺字。

### 2. `BUBBLE.wire(text)`

外層是一個 **`<div>`,不是 `<pre>`** —— `<details>` 不能合法巢狀在 `<pre>` 裡,
而且 `npPre` 的 `whitespace-pre-wrap break-all` 會把上色後的 token 從中間折斷。

`BUBBLE.wire` 的框樣式(從 `npPre` 挑,逐一列出,不用刪節號):

```
mt-1.5 rounded-md bg-surface border border-edge-soft p-3
text-xs font-mono max-h-64 overflow-auto text-ink-soft
```

(丟掉 `whitespace-pre-wrap` 與 `break-all`;換行由 renderer 自己用區塊元素處理。)

內容 = `WIRE.render(text)`。取代上表 **10 個**呼叫點。
`BUBBLE.pre` **保留**,給那 2 個純碼呼叫點用。

**`:1137`(⑥ protocol card)的歸屬不變** —— 它仍然是那張卡自己的展開器
(前一份 spec `2026-07-10-expander-belongs-to-its-own-bubble.md` 把「protocol card
展開器」列為不在範圍,指的是**歸屬**);這裡只是把框內的 `pre` 換成 `wire`。
注意它的 `response` 可能是 `null`(`agent/mcp_agent.py:120`,`notifications/initialized`
那個 frame),頂層是物件、`null` 是葉節點,走 §4 的 `syn-num`。

### 3. Chat-template renderer

切段規則(必須處理陷阱 1):

```
/<\|im_start\|>(\w+)\n([\s\S]*?)(?:<\|im_end\|>|$)/g
```

每則訊息 → 一個可折區塊:
- summary:`<|im_start|>`(`syn-marker` 灰)+ role 名稱(`syn-tag` 紫)+ 字元數(`muted`)
- **body 為空的區塊不給折疊 toggle**,只印那一行 marker。
  結尾的 `<|im_start|>assistant\n` 就是這種(陷阱 1)—— 它是「輪到模型講話了」的
  提示符,沒有內文
- body:訊息內文,內部再掃兩種巢狀區塊:
  - `<tools>\n…\n</tools>` → 折一層。內文**逐行** `JSON.parse`;成功的行走 JSON renderer,
    失敗的行原樣輸出。summary 帶「N 個工具、M 字元」
  - `<tool_call>\n…\n</tool_call>` → 折一層。內文試 `JSON.parse`;失敗(陷阱 2)
    就原樣輸出純文字,**不得拋例外**

其餘文字原樣輸出(`text-ink-soft`)。

**只有 `matchAll` 命中的區段會被渲染。** 第一個 `<|im_start|>` 之前的文字、以及
`<|im_end|>` 與下一個 `<|im_start|>` 之間的空白,一律丟棄(實測 ④⑥ 的資料那裡
只有一個 `\n`)。

**但 `<|im_end|>` 本身要印出來。** 它是 template 標記,是這堂課的教材之一;
原本的純 `<pre>` 看得到它,wire view 不能把它弄丟。每個「原文有配對 `<|im_end|>`」
的訊息區塊,body 結尾補一行 `<|im_end|>`(`syn-marker` 灰)。
結尾那個沒有 `<|im_end|>` 的 assistant 區塊自然就沒有。

**`<tools>` 逐行 parse 時跳過空白行**(`line.trim() === ""` → 略過,不當成解析失敗)。

### 4. JSON renderer

`JSON.parse` 成功才走樹狀。**失敗就整塊退回純 `<pre>`** —— 絕不出現空白框。

每個物件 / 陣列節點:
- 可折,summary 為 `{…} N keys` 或 `[…] N items`
- 葉節點依型別上色:key → `syn-key`;字串 → `syn-str`;數字 / `true` / `false` /
  `null` → `syn-num`;`{ } [ ] , :` → `syn-punct`
- **空物件 `{}` / 空陣列 `[]` 不給折疊 toggle**,直接印

「> 200 字元」指的是該節點 `JSON.stringify(node)`(**不帶 indent**)的長度。

### 5. 預設折疊狀態

- `<tools>` 區塊:**收起**
- `<tool_call>` 區塊:展開(通常很短,而且是重點)
- 每則 `<|im_start|>` 訊息:展開
- JSON 節點:`JSON.stringify(node)` 長度 **> 200 字元**者收起,其餘展開

→ 一打開展開器就看到骨架,長的東西自己收好。

### 6. i18n(新 summary 字串必須雙語)

`wire.js` 會產生 user-facing 的 summary 文字。AGENTS.md 規定每個 user-facing
改動都要落在 EN 與 zh-TW 兩邊,所以這些字串**必須走既有的 `t()`**,不可硬寫。

**可行性已驗證:** `t()` 定義在 `frontend/app.js:161` 的 module scope
(`function t(key, vars = {})`),classic script 會把它掛上 `window`。`wire.js`
雖然排在 `app.js` **之前**載入,但 `WIRE.render()` 只在使用者驅動之後才被呼叫
—— 那時 `app.js` 早已執行完畢,`t` 取得到。**`wire.js` 在載入期間不得呼叫 `t()`。**

新增 i18n key(EN + zh-TW 都要,放進 `app.js` 的 `I18N`):

| key | en | zh-TW |
|---|---|---|
| `wire_tools_summary` | `{n} tool(s), {chars} chars` | `{n} 個工具,{chars} 字元` |
| `wire_toolcall_summary` | `tool call` | `工具呼叫` |
| `wire_chars_summary` | `{chars} chars` | `{chars} 字元` |
| `wire_obj_summary` | `{n} keys, {chars} chars` | `{n} 個欄位,{chars} 字元` |
| `wire_arr_summary` | `{n} items, {chars} chars` | `{n} 個項目,{chars} 字元` |

`{…}` / `[…]` 這種括號符號不是文字,直接印,不進 i18n。

### 7. 顏色(6 個新 Tailwind token)

加進 **兩個 HTML 的 `tailwind.config.theme.extend.colors`**
(`frontend/index.html:12-30` 與 `frontend/index.zh-TW.html` 同區塊)。
沿用現有 oklch 寫法。

```js
'syn-key':    'oklch(45% 0.16 255)',   // 藍 — JSON key
'syn-str':    'oklch(48% 0.14 55)',    // 橘 — 字串值
'syn-num':    'oklch(48% 0.12 190)',   // 青綠 — 數字 / true / false / null
'syn-tag':    'oklch(48% 0.18 320)',   // 紫 — <tools> <tool_call> 標籤,以及 im_start 的 role 名
'syn-marker': 'oklch(62% 0.020 280)',  // 灰 — <|im_start|> <|im_end|>
'syn-punct':  'oklch(68% 0.010 280)',  // 淺灰 — { } [ ] , :
```

**Tailwind Play CDN 的動態 class 沒問題(已驗證,不要「修」它)。**
`text-syn-key` 這種自訂色 utility 只出現在 JS 字串裡、元素也是載入後才建立,
直覺上會擔心 CDN 掃不到而不生成樣式。但現況已有先例:`text-tool`、`text-result`、
`text-inject` 全都只寫在 `frontend/app.js` 的字串裡(兩個 HTML 的靜態內容都沒有),
而頁面上它們**確實有顏色** —— Play CDN 的 runtime MutationObserver 會處理動態插入的
class。**不需要 safelist。** 未來維護者請不要為此加設定。

**刻意與泡泡的語意色分開命名。** 泡泡的 `final`(藍=模型)、`tool`(紫=工具)、
`inject`(琥珀=注入)、`result`(綠=給使用者)是**教學語彙**;`syn-*` 是**語法語彙**。
兩者不共用 token,學生就不會把「這裡是紫色」誤讀成「這裡是工具」。

### 8. 不動的東西

- `frontend/styles.css` —— 全部用 Tailwind utility,一個位元組都不改。
  `.tok.tok-static` 護欄不碰(它是 tab③ 的活依賴,見 `app.js` 該行註解)
- 後端零改動
- Tabs ①②③ 零改動
- `BUBBLE.pre` 本身不刪(2 個純碼呼叫點還在用)

### 9. Cache-bust

- 新增 `<script src="wire.js?v=1"></script>`,排在 `app.js` **之前**(兩個 HTML,`:334` 附近)
- `app.js?v=91` → `?v=92`(兩個 HTML 同號)
- `styles.css?v=66` **不動**

## 驗收

1. `pytest agent/tests -q` 全綠(後端沒動,防呆)
2. `node --check frontend/wire.js` 與 `frontend/app.js` 皆通過
3. ④ 送「現在幾點?」,展開 user 泡:
   - 看得到 **3 個** `<|im_start|>` 區塊(system / user / assistant),其中
     **system 與 user 可折**;結尾的 assistant 只有一行 marker、**沒有折疊 toggle**
     (它的 body 是空的 —— 陷阱 1)
   - system 區塊裡的 `<tools>` **預設收起**,summary 顯示工具數與字元數
   - 展開 `<tools>` 後,裡面**只有一個** `get_time` 工具的 JSON,可折;
     key 是藍色、字串是橘色
     (兩個工具是 tab⑥ 才有 —— `agent/server.py:231` 把 tab④ 濾成只剩 `get_time`)
   - system 裡那個**非法 JSON** 的 `<tool_call>` 範例原樣顯示,console 無錯誤
4. ④ 展開藍泡(`模型吐的原始訊息`):`<tool_call>` 區塊展開,裡面的 JSON 有上色
4b. ⑥ 送「現在幾點?」,展開 user 泡:`<tools>` 裡有**兩個**工具
   (`get_time` + `get_weather`,握手問來的)。展開 protocol card:
   `notifications/initialized` 那張的 `response` 是 `null`,以 `syn-num` 顯示,不報錯
5. ⑤ 展開琥珀泡:`messages[]` 是 JSON 樹;那則 `role: "tool"` 的節點因為
   超過 200 字元而**預設收起**,summary 顯示字元數;展開後看得到 SKILL.md 全文
6. ⑤ 腳本紫泡 / 解剖卡:仍是純 `<pre>`,**沒有**被上色或折疊
7. **XSS / 標籤吞字檢查**:展開器裡看得到字面的 `<tools>`、`<tool_call>`、
   `<|im_start|>`。頁面 DOM 裡不得因此多出真的 `<tools>` 元素
8. **迴歸**:每顆泡泡仍最多一個「泡泡層級」的 `<details>`;右側展開器仍貼齊泡泡右緣;
   tab③ token 仍不可點;console 0 errors

> 驗收 8 的第一句要小心。「每顆泡泡最多一個按鈕」這條不變式,指的是**泡泡的直接子
> `<details>`**;wire view 的巢狀 `<details>` 是 `BUBBLE.wire` 那個 `<div>` 的子孫,
> 不是泡泡的直接子元素。驗證時要用 `owner.querySelectorAll(':scope > details')`
> 這種**只看直接子元素**的選擇器,不能用 `querySelectorAll('details')`,否則會誤報。
>
> 注意:repo 裡**沒有**這樣一支已存在的量測腳本(先前是在瀏覽器 console 裡 inline 跑的)。
> 實作者要自己在瀏覽器裡跑一次上述選擇器確認,或把它加進 `agent/smoke.py`。

## 不在範圍

- Python / Markdown / YAML 的語法上色(⑤ 腳本紫泡與解剖卡維持純文字)
- 深色模式(頁面目前只有淺色)
- 行號
- 搜尋 / 複製按鈕
