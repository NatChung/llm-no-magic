# Wire view:語法上色 + 結構折疊 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 tabs ④⑤⑥ 每顆泡泡 `▸` 展開器裡的原始 prompt 有語法上色,並能依結構(chat template 訊息 / `<tools>` / `<tool_call>` / JSON 節點)逐層折疊。

**Architecture:** 新增 `frontend/wire.js`,匯出全域 `WIRE.render(text)`。它自己偵測內容是 JSON 還是 chat template,建 DOM 回傳。純解析函式(切段、逐行 parse)與 DOM 建構分離,前者用 node 內建 test runner 做 TDD,後者靠瀏覽器驗證。`app.js` 只多一個 `BUBBLE.wire()` 包裝,換掉 10 個 `BUBBLE.pre()` 呼叫點。

**Tech Stack:** zero-build 前端(Tailwind Play CDN,無 bundler)、node v24 內建 `node --test`(零依賴)、pytest(後端,本次不動)。

Spec: `docs/superpowers/specs/2026-07-10-wire-view-syntax-highlight-fold.md`

## Global Constraints

- **`frontend/styles.css` 一個位元組都不能改。** `.tok.tok-static`(`styles.css:79-80`)是 tab③ 的活依賴(`frontend/app.js` 該行有警告註解)。全部樣式用 Tailwind utility class。
- **絕不使用 `innerHTML`。** 內容裡有字面的 `<tools>`、`<tool_call>`、`<|im_start|>`;丟進 `innerHTML` 會被當標籤解析,畫面缺字。一律 `createElement` + `textContent`。
- **`wire.js` 在載入期間不得呼叫 `t()`,也不得碰 `document`。** 它排在 `app.js` **之前**載入。`t()` 是 `app.js:161` 的 module-scope 函式(classic script → 全域可見),只有在 `WIRE.render()` 被呼叫時(使用者驅動之後)才取用得到。
- **雙語同步:** 每個 `I18N` key 都要有 `'en'` 與 `'zh-TW'`。`frontend/index.html` 與 `frontend/index.zh-TW.html` 的 `tailwind.config` 顏色區塊、`<script>` 標籤、`?v=` 版號必須完全一致。
- **Cache-bust:** 新增 `wire.js?v=1`;`app.js?v=91` → `?v=92`;`styles.css?v=66` **不動**。兩個 HTML 同號。
- 後端零改動。Tabs ①②③ 零改動。
- 既有 `BUBBLE.pre` **保留**,給 2 個純碼呼叫點(`app.js:990` 腳本原始碼、`app.js:1091` 解剖卡)用。
- 伺服器:`nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`

## File Structure

| 檔案 | 責任 |
|---|---|
| `frontend/wire.js`(新) | wire 內容 → DOM。純解析 + DOM 建構。全域 `WIRE`。 |
| `frontend/wire.test.js`(新) | `node --test` 跑的純解析單元測試。零依賴。 |
| `frontend/app.js` | 加 `BUBBLE.wire()`;10 個 `BUBBLE.pre()` → `BUBBLE.wire()`;5 個新 i18n key。 |
| `frontend/index.html`、`frontend/index.zh-TW.html` | 6 個 `syn-*` 顏色 token;`<script src="wire.js?v=1">`;`app.js?v=92`。 |

## 三個真實資料陷阱(每個 task 都要記得)

1. prompt 結尾是 `…<|im_start|>assistant\n`,**沒有配對的 `<|im_end|>`**。
2. `<tool_call>` 也出現在 **system** 訊息裡當格式範例,內容是 `{"name": <function-name>, "arguments": <args-json-object>}` —— **不是合法 JSON**,`JSON.parse` 會拋。
3. `<tools>` 裡是**每行一個 JSON 物件**,不是一個 JSON 陣列。tab④ 只有 1 行(`get_time`),tab⑥ 有 2 行(`get_time`、`get_weather`)。

---

### Task 1: `frontend/wire.js` 的純解析核心 + node 單元測試

這個 repo 的前端目前**沒有任何自動化測試**。這個 task 引進 node 內建 test runner(零依賴、node v24 已裝),只測純函式 —— DOM 部分留給瀏覽器驗證。

**Files:**
- Create: `frontend/wire.js`
- Create: `frontend/wire.test.js`

**Interfaces:**
- Produces:
  - `WIRE.render(text: string) -> HTMLElement`(本 task 只放 stub,Task 3 實作)
  - `WIRE._detect(text: string) -> "json" | "chat"`
  - `WIRE._splitMessages(text: string) -> Array<{role: string, body: string, hadEnd: boolean}>`
  - `WIRE._splitBlocks(body: string) -> Array<{type: "text"|"tools"|"tool_call", text: string}>`
  - `WIRE._parseToolsLines(text: string) -> Array<{ok: boolean, value: any, raw: string}>`
  - `WIRE._tryParse(text: string) -> {ok: boolean, value: any}`
  - `WIRE._shouldCollapse(node: any) -> boolean`(`JSON.stringify(node).length > 200`)
  - `module.exports = WIRE`(僅 node;瀏覽器走全域)

- [ ] **Step 1: 寫失敗的測試**

建立 `frontend/wire.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const WIRE = require("./wire.js");

// ── _detect ─────────────────────────────────────────────────────
test("_detect: JSON 物件 / 陣列 → json,其餘 → chat", () => {
  assert.strictEqual(WIRE._detect('{"a":1}'), "json");
  assert.strictEqual(WIRE._detect("  [1, 2]  "), "json");
  assert.strictEqual(WIRE._detect("<|im_start|>system\nhi"), "chat");
  assert.strictEqual(WIRE._detect(""), "chat");
});

// ── _splitMessages ──────────────────────────────────────────────
// 陷阱 1:結尾的 assistant 沒有配對的 <|im_end|>,不能被吃掉。
test("_splitMessages: 三則訊息,最後一則無 im_end 且 body 為空", () => {
  const text =
    "<|im_start|>system\n/no_think<|im_end|>\n" +
    "<|im_start|>user\n現在幾點?<|im_end|>\n" +
    "<|im_start|>assistant\n";
  const msgs = WIRE._splitMessages(text);
  assert.strictEqual(msgs.length, 3);
  assert.deepStrictEqual(msgs[0], { role: "system", body: "/no_think", hadEnd: true });
  assert.deepStrictEqual(msgs[1], { role: "user", body: "現在幾點?", hadEnd: true });
  assert.deepStrictEqual(msgs[2], { role: "assistant", body: "", hadEnd: false });
});

test("_splitMessages: 沒有任何 marker → 空陣列", () => {
  assert.deepStrictEqual(WIRE._splitMessages("just some text"), []);
});

test("_splitMessages: body 裡有多行與空行,原樣保留", () => {
  const msgs = WIRE._splitMessages("<|im_start|>system\na\n\nb<|im_end|>");
  assert.strictEqual(msgs[0].body, "a\n\nb");
});

// ── _splitBlocks ────────────────────────────────────────────────
test("_splitBlocks: text / tools / text / tool_call / text 交錯", () => {
  const body =
    "before\n<tools>\n{\"a\":1}\n</tools>\nmid\n<tool_call>\n{\"b\":2}\n</tool_call>\nafter";
  const segs = WIRE._splitBlocks(body);
  assert.deepStrictEqual(segs.map((s) => s.type),
    ["text", "tools", "text", "tool_call", "text"]);
  assert.strictEqual(segs[1].text, '{"a":1}');
  assert.strictEqual(segs[3].text, '{"b":2}');
  assert.strictEqual(segs[0].text, "before\n");
});

test("_splitBlocks: 沒有區塊 → 單一 text 段", () => {
  assert.deepStrictEqual(WIRE._splitBlocks("plain"), [{ type: "text", text: "plain" }]);
});

test("_splitBlocks: 空 body → 空陣列", () => {
  assert.deepStrictEqual(WIRE._splitBlocks(""), []);
});

// ── _parseToolsLines ────────────────────────────────────────────
// 陷阱 3:每行一個 JSON 物件;空白行要跳過。
test("_parseToolsLines: 逐行 parse,跳過空白行", () => {
  const rows = WIRE._parseToolsLines('{"a":1}\n\n{"b":2}\n');
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((r) => r.ok));
  assert.deepStrictEqual(rows[0].value, { a: 1 });
  assert.deepStrictEqual(rows[1].value, { b: 2 });
});

test("_parseToolsLines: 壞行不拋,回 ok:false 並保留原文", () => {
  const rows = WIRE._parseToolsLines('{"a":1}\nnot json');
  assert.strictEqual(rows[0].ok, true);
  assert.strictEqual(rows[1].ok, false);
  assert.strictEqual(rows[1].value, null);
  assert.strictEqual(rows[1].raw, "not json");
});

// ── _tryParse ───────────────────────────────────────────────────
// 陷阱 2:system 裡的 <tool_call> 範例不是合法 JSON。
test("_tryParse: 佔位符範例不是合法 JSON,回 ok:false 且不拋", () => {
  const placeholder = '{"name": <function-name>, "arguments": <args-json-object>}';
  assert.deepStrictEqual(WIRE._tryParse(placeholder), { ok: false, value: null });
});

test("_tryParse: 合法 JSON", () => {
  assert.deepStrictEqual(WIRE._tryParse('{"name": "get_time", "arguments": {}}'),
    { ok: true, value: { name: "get_time", arguments: {} } });
});

// ── _shouldCollapse ─────────────────────────────────────────────
test("_shouldCollapse: 序列化(不帶 indent)超過 200 字元才收起", () => {
  assert.strictEqual(WIRE._shouldCollapse({ a: 1 }), false);
  assert.strictEqual(WIRE._shouldCollapse({ a: "x".repeat(250) }), true);
  assert.strictEqual(WIRE._shouldCollapse([]), false);
});
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `node --test frontend/wire.test.js`
Expected: FAIL — `Cannot find module './wire.js'`

- [ ] **Step 3: 寫最小實作**

建立 `frontend/wire.js`:

```js
// wire.js — 展開器內容的 viewer:語法上色 + 結構折疊。
//
// 載入順序:必須排在 app.js **之前**(它只提供全域 WIRE,不依賴 app.js)。
// 硬性規則:
//   1. 載入期間不得碰 `document`,也不得呼叫 `t()`(app.js 還沒跑)。
//   2. 絕不使用 innerHTML —— 內容裡有字面的 <tools> / <tool_call> / <|im_start|>。
const WIRE = (function () {
  "use strict";

  // ── 純解析(可在 node 裡單獨測試,不碰 DOM)────────────────────

  function detect(text) {
    const s = String(text || "").trim();
    return s.startsWith("{") || s.startsWith("[") ? "json" : "chat";
  }

  // 陷阱 1:結尾的 <|im_start|>assistant 沒有配對的 <|im_end|>。
  // 用 lookahead,讓 body 停在 <|im_end|> 或字串結尾,兩者都不消耗。
  const MSG_RE = /<\|im_start\|>(\w+)\n([\s\S]*?)(?=<\|im_end\|>|$)/g;

  function splitMessages(text) {
    const out = [];
    MSG_RE.lastIndex = 0;
    let m;
    while ((m = MSG_RE.exec(text)) !== null) {
      const after = text.slice(m.index + m[0].length);
      out.push({ role: m[1], body: m[2], hadEnd: after.startsWith("<|im_end|>") });
    }
    return out;
  }

  const BLOCK_RE = /<(tools|tool_call)>\n?([\s\S]*?)\n?<\/\1>/g;

  function splitBlocks(body) {
    const out = [];
    let last = 0;
    let m;
    BLOCK_RE.lastIndex = 0;
    while ((m = BLOCK_RE.exec(body)) !== null) {
      if (m.index > last) out.push({ type: "text", text: body.slice(last, m.index) });
      out.push({ type: m[1], text: m[2] });
      last = m.index + m[0].length;
    }
    if (last < body.length) out.push({ type: "text", text: body.slice(last) });
    return out;
  }

  // 陷阱 3:<tools> 內是每行一個 JSON 物件,不是一個陣列。空白行跳過。
  function parseToolsLines(text) {
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        try {
          return { ok: true, value: JSON.parse(line), raw: line };
        } catch {
          return { ok: false, value: null, raw: line };
        }
      });
  }

  // 陷阱 2:system 裡的 <tool_call> 範例是佔位符,parse 一定失敗 —— 不能拋。
  function tryParse(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false, value: null };
    }
  }

  const COLLAPSE_OVER = 200;   // JSON.stringify(node)(不帶 indent)的字元數
  function shouldCollapse(node) {
    try {
      return JSON.stringify(node).length > COLLAPSE_OVER;
    } catch {
      return false;
    }
  }

  function render(_text) {
    throw new Error("WIRE.render not implemented yet");
  }

  return {
    render,
    _detect: detect,
    _splitMessages: splitMessages,
    _splitBlocks: splitBlocks,
    _parseToolsLines: parseToolsLines,
    _tryParse: tryParse,
    _shouldCollapse: shouldCollapse,
  };
})();

// node 測試用;瀏覽器裡 `module` 不存在,這行會被跳過。
if (typeof module !== "undefined" && module.exports) module.exports = WIRE;
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test frontend/wire.test.js`
Expected: PASS,`# pass 12`、`# fail 0`

- [ ] **Step 5: 語法檢查**

Run: `node --check frontend/wire.js && node --check frontend/wire.test.js`
Expected: 無輸出(通過)

- [ ] **Step 6: Commit**

```bash
git add frontend/wire.js frontend/wire.test.js
git commit -m "feat(wire): 純解析核心 + node 單元測試

新增 frontend/wire.js 的解析層(切訊息、切區塊、逐行 parse tools、
tryParse、collapse 判定),render 先留 stub。

三個真實資料陷阱各有一個測試:結尾的 <|im_start|>assistant 沒有配對
<|im_end|>;system 裡的 <tool_call> 範例是佔位符不是合法 JSON;<tools>
內是逐行 JSON 物件而非陣列。

前端首次引進自動化測試,用 node 內建 test runner,零依賴:
node --test frontend/wire.test.js"
```

---

### Task 2: 顏色 token 與 i18n key

純設定。做完之後畫面還沒變化,但 Task 3 的 renderer 會用到它們。

**Files:**
- Modify: `frontend/index.html`(`tailwind.config` colours 區塊,約 `:12-30`)
- Modify: `frontend/index.zh-TW.html`(同一區塊,與 EN 版逐字相同)
- Modify: `frontend/app.js`(`I18N` 物件)

**Interfaces:**
- Produces:給 Task 3 用的
  - Tailwind class:`text-syn-key`、`text-syn-str`、`text-syn-num`、`text-syn-tag`、`text-syn-marker`、`text-syn-punct`
  - i18n key:`wire_tools_summary`、`wire_toolcall_summary`、`wire_chars_summary`、`wire_obj_summary`、`wire_arr_summary`

- [ ] **Step 1: 兩個 HTML 加 6 個顏色 token**

在 **兩個檔案** 的 `tailwind.config.theme.extend.colors` 裡,`'inject-tint'` 那行後面加:

```js
            // syntax colours for the wire view(展開器內容)——
            // 刻意與泡泡的教學語意色(tool/result/final/inject)分開命名,
            // 學生才不會把「這裡是紫色」誤讀成「這裡是工具」。
            'syn-key':    'oklch(45% 0.16 255)',   // 藍 — JSON key
            'syn-str':    'oklch(48% 0.14 55)',    // 橘 — 字串值
            'syn-num':    'oklch(48% 0.12 190)',   // 青綠 — 數字 / true / false / null
            'syn-tag':    'oklch(48% 0.18 320)',   // 紫 — <tools> <tool_call> 標籤、im_start 的 role
            'syn-marker': 'oklch(62% 0.020 280)',  // 灰 — <|im_start|> <|im_end|>
            'syn-punct':  'oklch(68% 0.010 280)',  // 淺灰 — { } [ ] , :
```

> Tailwind Play CDN 的 runtime MutationObserver 會處理動態插入的 class,
> **不需要 safelist**。現況已有先例:`text-tool` / `text-inject` 也只出現在
> `app.js` 的字串裡,頁面上照樣有顏色。未來維護者請勿為此加設定。

- [ ] **Step 2: 確認兩個 HTML 的 head 仍然逐字相同**

Run:
```bash
diff <(sed -n '1,46p' frontend/index.html) <(sed -n '1,46p' frontend/index.zh-TW.html) && echo "IDENTICAL"
```
Expected: `IDENTICAL`(head 區塊在兩檔本來就一致,加色後仍須一致)

- [ ] **Step 3: `app.js` 加 5 個 i18n key**

在 `frontend/app.js` 的 `I18N` 物件裡,`protocol_expand`(`app.js:151`,單行寫法)後面加
(用多行寫法,跟檔案裡多數 key 一致):

```js
  wire_tools_summary: {
    'en':    '{n} tool(s), {chars} chars',
    'zh-TW': '{n} 個工具,{chars} 字元',
  },
  wire_toolcall_summary: {
    'en':    'tool call',
    'zh-TW': '工具呼叫',
  },
  wire_chars_summary: {
    'en':    '{chars} chars',
    'zh-TW': '{chars} 字元',
  },
  wire_obj_summary: {
    'en':    '{n} keys, {chars} chars',
    'zh-TW': '{n} 個欄位,{chars} 字元',
  },
  wire_arr_summary: {
    'en':    '{n} items, {chars} chars',
    'zh-TW': '{n} 個項目,{chars} 字元',
  },
```

- [ ] **Step 4: 驗證雙語完整性與語法**

Run(這支檢查器同時認**多行**與**單行**兩種 key 寫法。`app.js:151` 的
`protocol_expand` 是單行寫法 —— 只認多行的正則會靜默漏掉它):

```bash
node --check frontend/app.js
python3 - <<'EOF'
import re, pathlib
s = pathlib.Path('frontend/app.js').read_text()
b = s[s.index('const I18N = {'):s.index('\nfunction t(')]
multi  = re.findall(r"^  ([a-z0-9_]+): \{\n((?:.*\n)*?)  \},", b, re.M)
single = re.findall(r"^  ([a-z0-9_]+):\s*\{(.*)\},\s*$", b, re.M)
ks = multi + single
bad = [k for k, v in ks if "'en'" not in v or "'zh-TW'" not in v]
new = sorted(k for k, _ in ks if k.startswith('wire_'))
print(f'{len(ks)} keys ({len(multi)} multi + {len(single)} single)')
print(f'missing lang: {bad or "none"}')
print(f'new wire keys: {new}')
EOF
```
Expected:`missing lang: none`,且 `new wire keys` 恰為
`['wire_arr_summary', 'wire_chars_summary', 'wire_obj_summary', 'wire_toolcall_summary', 'wire_tools_summary']`

Run:
```bash
grep -c "syn-key" frontend/index.html frontend/index.zh-TW.html
```
Expected: 兩個檔各 `1`

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/index.zh-TW.html frontend/app.js
git commit -m "feat(wire): 6 個 syn-* 顏色 token 與 5 個 i18n key

syn-* 刻意與泡泡的教學語意色(tool/result/final/inject)分開命名。
Play CDN 的 runtime MutationObserver 會處理動態 class,不需 safelist
(text-tool / text-inject 同樣只存在 JS 字串裡卻有顏色)。"
```

---

### Task 3: `WIRE.render` 的 DOM 層

**Files:**
- Modify: `frontend/wire.js`(把 Task 1 的 `render` stub 換成實作)

**Interfaces:**
- Consumes:Task 1 的 `_detect` / `_splitMessages` / `_splitBlocks` / `_parseToolsLines` / `_tryParse` / `_shouldCollapse`;Task 2 的 `text-syn-*` class 與 5 個 i18n key
- Produces:`WIRE.render(text: string) -> HTMLElement`(一個 `<div>`,呼叫端負責外框)

- [ ] **Step 1: 實作 DOM 層**

把 `frontend/wire.js` 裡的

```js
  function render(_text) {
    throw new Error("WIRE.render not implemented yet");
  }
```

換成下面整段(放在 `shouldCollapse` 之後、`return {` 之前):

```js
  // ── DOM 建構(只在 render 被呼叫時執行 —— 此時 app.js 已載入)──────

  // t() 定義在 app.js 的 module scope(classic script → 全域可見)。
  // wire.js 先載入,所以只能在這裡「延遲」取用,不能在載入期間呼叫。
  function label(key, vars) {
    return typeof t === "function" ? t(key, vars) : key;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // 絕不用 innerHTML
    return n;
  }

  const SUMMARY_CLS =
    "cursor-pointer list-none [&::-webkit-details-marker]:hidden " +
    "hover:text-ink py-0.5";

  // 折疊容器。marker 用 JS 在 toggle 時翻面 —— 不依賴 CSS 的 [open] 變體。
  function fold(summaryChildren, bodyNode, open) {
    const d = el("details", "wire-fold");
    d.open = !!open;
    const s = el("summary", SUMMARY_CLS);
    const marker = el("span", "text-syn-punct", d.open ? "▾ " : "▸ ");
    s.appendChild(marker);
    for (const c of summaryChildren) s.appendChild(c);
    d.addEventListener("toggle", () => { marker.textContent = d.open ? "▾ " : "▸ "; });
    const body = el("div", "pl-4 border-l border-edge-soft ml-1");
    body.appendChild(bodyNode);
    d.append(s, body);
    return d;
  }

  function textLine(text) {
    return el("div", "whitespace-pre-wrap text-ink-soft", text);
  }

  // ── JSON 樹 ────────────────────────────────────────────────────

  function primitive(value) {
    if (typeof value === "string") return el("span", "text-syn-str", JSON.stringify(value));
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      return el("span", "text-syn-num", String(value));
    }
    return el("span", "text-ink-soft", String(value));
  }

  function jsonNode(value) {
    const isArr = Array.isArray(value);
    const isObj = value !== null && typeof value === "object";
    if (!isObj) return primitive(value);

    const entries = isArr
      ? value.map((v, i) => [String(i), v])
      : Object.entries(value);

    if (entries.length === 0) {
      return el("span", "text-syn-punct", isArr ? "[]" : "{}");
    }

    const chars = JSON.stringify(value).length;
    const summary = [
      el("span", "text-syn-punct", isArr ? "[…]" : "{…}"),
      el("span", "text-muted ml-1",
        label(isArr ? "wire_arr_summary" : "wire_obj_summary",
              { n: entries.length, chars })),
    ];

    const body = el("div");
    for (const [k, v] of entries) {
      const row = el("div");
      if (!isArr) {
        row.appendChild(el("span", "text-syn-key", JSON.stringify(k)));
        row.appendChild(el("span", "text-syn-punct", ": "));
      }
      row.appendChild(jsonNode(v));
      body.appendChild(row);
    }
    return fold(summary, body, !shouldCollapse(value));
  }

  // ── chat template ──────────────────────────────────────────────

  function toolsBlock(text) {
    const rows = parseToolsLines(text);
    const body = el("div");
    for (const r of rows) body.appendChild(r.ok ? jsonNode(r.value) : textLine(r.raw));
    const summary = [
      el("span", "text-syn-tag", "<tools>"),
      el("span", "text-muted ml-1",
        label("wire_tools_summary", { n: rows.length, chars: text.length })),
    ];
    return fold(summary, body, false);          // 預設收起
  }

  function toolCallBlock(text) {
    const parsed = tryParse(text);              // 陷阱 2:可能失敗,不能拋
    const body = el("div");
    body.appendChild(parsed.ok ? jsonNode(parsed.value) : textLine(text));
    const summary = [
      el("span", "text-syn-tag", "<tool_call>"),
      el("span", "text-muted ml-1", label("wire_toolcall_summary", {})),
    ];
    return fold(summary, body, true);           // 預設展開
  }

  function messageBlock(msg) {
    const marker = () => el("span", "text-syn-marker", "<|im_start|>");
    const role = () => el("span", "text-syn-tag", msg.role);

    // 陷阱 1:結尾的 assistant body 是空的 —— 只印一行 marker,不給 toggle。
    if (msg.body.trim() === "") {
      const line = el("div");
      line.append(marker(), el("span", "text-syn-tag ml-1", msg.role));
      return line;
    }

    const body = el("div");
    for (const seg of splitBlocks(msg.body)) {
      if (seg.type === "tools") body.appendChild(toolsBlock(seg.text));
      else if (seg.type === "tool_call") body.appendChild(toolCallBlock(seg.text));
      else body.appendChild(textLine(seg.text));
    }
    // <|im_end|> 是 template 標記,是教材的一部分 —— 不能弄丟。
    if (msg.hadEnd) body.appendChild(el("div", "text-syn-marker", "<|im_end|>"));

    const summary = [
      marker(),
      el("span", "text-syn-tag ml-1", msg.role),
      el("span", "text-muted ml-2", label("wire_chars_summary", { chars: msg.body.length })),
    ];
    return fold(summary, body, true);
  }

  function renderChat(text) {
    const msgs = splitMessages(text);
    if (msgs.length === 0) return textLine(text);   // 認不出來就原樣顯示
    const root = el("div", "space-y-1");
    for (const m of msgs) root.appendChild(messageBlock(m));
    return root;
  }

  function render(text) {
    const src = String(text == null ? "" : text);
    if (detect(src) === "json") {
      const parsed = tryParse(src);
      // parse 失敗就整塊退回純文字 —— 絕不出現空白框。
      return parsed.ok ? jsonNode(parsed.value) : textLine(src);
    }
    return renderChat(src);
  }
```

- [ ] **Step 2: 確認純解析測試仍然全綠(DOM 層不得污染它們)**

Run: `node --test frontend/wire.test.js`
Expected: PASS,`# pass 12`、`# fail 0`

> 這一步是真的在測東西:`render` 現在會呼叫 `document`,但只在**被呼叫時**。
> 若有人把 `document.createElement` 提到 IIFE 的頂層,`require("./wire.js")`
> 會立刻炸 `ReferenceError: document is not defined`,這 11 個測試會全紅。

- [ ] **Step 3: 語法檢查**

Run: `node --check frontend/wire.js`
Expected: 無輸出

- [ ] **Step 4: Commit**

```bash
git add frontend/wire.js
git commit -m "feat(wire): DOM 層 —— JSON 樹與 chat template renderer

摺疊 marker(▸/▾)用 JS 在 toggle 事件裡翻面,不依賴 CSS 的 [open] 變體。
<tools> 預設收起、<tool_call> 預設展開、JSON 節點序列化超過 200 字元收起。
<|im_end|> 照印(它是 template 標記,教材的一部分)。
render 認不出格式或 JSON.parse 失敗 → 退回純文字,絕不出現空白框。
document 只在 render 被呼叫時碰,所以 node 測試仍能 require 這支檔案。"
```

---

### Task 4: 接進 `app.js`,載入 `wire.js`,跑完整驗收

**Files:**
- Modify: `frontend/app.js`(新增 `BUBBLE.wire`;10 個 `BUBBLE.pre(` → `BUBBLE.wire(`)
- Modify: `frontend/index.html`、`frontend/index.zh-TW.html`(`<script src="wire.js?v=1">`;`app.js?v=92`)

**Interfaces:**
- Consumes:`WIRE.render(text) -> HTMLElement`
- Produces:`BUBBLE.wire(text) -> HTMLElement`(帶外框樣式的 `<div>`)

- [ ] **Step 1: 加 `BUBBLE.wire`**

在 `frontend/app.js` 的 `BUBBLE` 物件裡,`pre(text) { … }` 那個 method 之後加:

```js
  // wire 內容(prompt / JSON)→ 上色 + 可折。外層必須是 <div> 不是 <pre>:
  // <details> 不能合法巢狀在 <pre> 裡,而且 npPre 的 break-all 會把上色後的
  // token 從中間折斷。純碼(腳本原始碼、解剖卡)仍然走 BUBBLE.pre。
  wire(text) {
    const box = document.createElement("div");
    box.className = BUBBLE.tw.npWire;
    box.appendChild(WIRE.render(text));
    return box;
  },
```

在 `BUBBLE.tw` 裡,`npPre` 那行之後加:

```js
    npWire:     "mt-1.5 rounded-md bg-surface border border-edge-soft p-3 text-xs font-mono max-h-64 overflow-auto text-ink-soft",
```

- [ ] **Step 2: 換掉 10 個呼叫點**

`BUBBLE.pre(` → `BUBBLE.wire(`,**只換這 10 行**(用 `grep -n "BUBBLE.pre(" frontend/app.js` 對照,行號會因 Step 1 而位移,依內容認):

| 認法(該行出現的表達式) | tab / 泡泡 |
|---|---|
| `BUBBLE.pre(sent_prompt)` | ④ user/工具泡 |
| `BUBBLE.pre(received_chunk)`(兩處) | ④ 藍泡、綠泡 |
| `BUBBLE.pre(JSON.stringify(f.messages, null, 2))` | ⑤ user/琥珀泡 |
| `BUBBLE.pre(JSON.stringify(pendingReceived, null, 2))`(兩處) | ⑤ 藍泡、綠泡 |
| `BUBBLE.pre(JSON.stringify({ request: f.request, response: f.response }, null, 2))` | ⑥ protocol card |
| `BUBBLE.pre(f.sent_prompt)` | ⑥ user/工具泡 |
| `BUBBLE.pre(f.received_chunk)`(兩處) | ⑥ 藍泡、綠泡 |

**這 2 個維持 `BUBBLE.pre`,不要動:**

| `BUBBLE.pre(scriptSources[key])` | ⑤ 腳本原始碼(Python) |
| `BUBBLE.pre(f.content)` | ⑤ 解剖卡(YAML / Markdown / Python) |

驗證:
```bash
grep -c "BUBBLE.wire(" frontend/app.js   # 應為 11(1 個定義 + 10 個呼叫)
grep -c "BUBBLE.pre(" frontend/app.js    # 應為 3(1 個定義 + 2 個呼叫)
```

- [ ] **Step 3: 兩個 HTML 載入 `wire.js` 並 bump 版號**

兩個檔案的 `<script src="app.js?v=91"></script>` 那一行(約 `:334`),換成兩行:

```html
  <script src="wire.js?v=1"></script>
  <script src="app.js?v=92"></script>
```

`styles.css?v=66`(約 `:47`)**不動**。

驗證:
```bash
python3 -c "
import re, pathlib
for f in ['frontend/index.html', 'frontend/index.zh-TW.html']:
    s = pathlib.Path(f).read_text()
    print(f, re.findall(r'(?:wire\.js|app\.js|styles\.css)\?v=\d+', s))
"
```
Expected: 兩檔皆 `['styles.css?v=66', 'wire.js?v=1', 'app.js?v=92']`

- [ ] **Step 4: 靜態關卡**

Run:
```bash
node --check frontend/wire.js && node --check frontend/app.js && echo "SYNTAX OK"
node --test frontend/wire.test.js
# 只抓真正的用法。裸 grep "innerHTML" 會誤中 wire.js 裡「絕不使用 innerHTML」那兩行註解。
grep -nE "\.innerHTML" frontend/wire.js && echo "❌ 有 innerHTML 用法" || echo "no innerHTML ✓"
git diff --stat frontend/styles.css; echo "(空 = styles.css 未動)"
python3 -m pytest agent/tests -q | tail -1
```
Expected:`SYNTAX OK`;`# fail 0`;`no innerHTML ✓`;styles.css diff 為空;`135 passed`

- [ ] **Step 5: 起 server、驅動三個 tab**

```bash
pkill -f "agent.server"; sleep 1
nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
sleep 3 && curl -s localhost:9000/health
```
Expected: `{"status": "ok", ...}`

在瀏覽器開 `http://localhost:9000/index.zh-TW.html?nocache=wire`,確認 `/health` 的 `subscribers >= 1`,然後:

```bash
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d '{"tab":"4","user":"現在幾點?"}' --max-time 300 > /dev/null
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d '{"tab":"5","user":"台北今天天氣怎樣?"}' --max-time 300 > /dev/null
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d '{"tab":"6","user":"現在幾點?"}' --max-time 300 > /dev/null
```

- [ ] **Step 6: 瀏覽器驗收(逐條對照 spec 的驗收清單)**

在瀏覽器 console 執行(或用 Playwright `browser_evaluate`)。**必須先把分頁切到前景 ——
隱藏 panel 的 `getBoundingClientRect()` 全是 0,會造成假陰性:**

```js
(async () => {
  const sel = document.querySelector('.tab-select');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  // ── ④ user 泡 ──
  sel.value = 'agent'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(60);
  const userRow = document.querySelector('.tab-panel[data-panel="agent"] .turns > div:nth-child(2)');
  userRow.querySelector(':scope > details').open = true;
  // BUBBLE.details(summary, contentEl) → details > [summary, div.max-h-64]
  // 所以外框 div 本身就是 .max-h-64,不要再往下找一層。
  const wire = userRow.querySelector(':scope > details > div.max-h-64');
  const msgFolds = [...wire.children[0].children];                    // 每則訊息
  out.tab4_msg_blocks = msgFolds.length;                              // 期望 3
  out.tab4_foldable = msgFolds.filter((n) => n.tagName === 'DETAILS').length;  // 期望 2
  out.tab4_last_is_plain_marker = msgFolds[2].tagName === 'DIV';      // 期望 true
  const toolsFold = wire.querySelector('details details');            // system 裡的 <tools>
  out.tab4_tools_collapsed_by_default = toolsFold && !toolsFold.open; // 期望 true
  out.tab4_tools_summary = toolsFold.querySelector('summary').textContent;
  toolsFold.open = true;
  out.tab4_tools_tool_count = toolsFold.querySelectorAll(':scope > div > *').length;  // 期望 1(只有 get_time)
  out.tab4_has_key_colour = !!wire.querySelector('.text-syn-key');
  out.tab4_has_str_colour = !!wire.querySelector('.text-syn-str');
  out.tab4_im_end_rendered = [...wire.querySelectorAll('.text-syn-marker')]
    .some((n) => n.textContent === '<|im_end|>');                     // 期望 true

  // 標籤沒被 innerHTML 吃掉:字面文字看得到,DOM 裡沒有真的 <tools> 元素
  out.literal_tools_text = wire.textContent.includes('<tools>');      // 期望 true
  out.no_real_tools_element = document.getElementsByTagName('tools').length === 0;  // 期望 true

  // ── ⑤ 琥珀泡:role:"tool" 節點應因 >200 字元而預設收起 ──
  sel.value = 'skill'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(60);
  const amber = [...document.querySelectorAll('.tab-panel[data-panel="skill"] .turns .ml-auto')]
    .find((r) => r.textContent.includes('SKILL.md'));
  amber.querySelector(':scope > details').open = true;
  const amberWire = amber.querySelector(':scope > details > div.max-h-64');
  const nested = [...amberWire.querySelectorAll('details')];
  out.tab5_has_collapsed_node = nested.some((d) => !d.open);          // 期望 true

  // ── ⑤ 腳本泡 / 解剖卡仍是純 <pre> ──
  const script = [...document.querySelectorAll('.tab-panel[data-panel="skill"] .turns .ml-auto')]
    .find((r) => r.textContent.includes('腳本原始碼') || r.textContent.includes('Script source'));
  out.tab5_script_still_pre = !!script.querySelector('details pre');  // 期望 true

  // ── 迴歸:泡泡層級仍最多一個 details(只看「直接子」)──
  const perBubble = [];
  for (const p of ['agent', 'skill', 'mcp']) {
    sel.value = p; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(60);
    for (const d of document.querySelectorAll(`.tab-panel[data-panel="${p}"] .turns details`)) {
      const owner = d.parentElement;
      if (owner.classList.contains('wire-fold') || owner.closest('.max-h-64')) continue;  // wire 內部的巢狀,不算
      perBubble.push(owner.querySelectorAll(':scope > details').length);
    }
  }
  out.max_details_per_bubble = Math.max(...perBubble);                // 期望 1
  return out;
})();
```

Expected(逐項對照 spec 驗收 3–8):
```
tab4_msg_blocks: 3
tab4_foldable: 2
tab4_last_is_plain_marker: true
tab4_tools_collapsed_by_default: true
tab4_tools_tool_count: 1
tab4_has_key_colour: true
tab4_has_str_colour: true
tab4_im_end_rendered: true
literal_tools_text: true
no_real_tools_element: true
tab5_has_collapsed_node: true
tab5_script_still_pre: true
max_details_per_bubble: 1
```

再確認 console 沒有任何 error(尤其 `<tool_call>` 那個非法 JSON 不得拋)。

- [ ] **Step 7: ⑥ 的兩個工具與 null response(spec 驗收 4b)**

```bash
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d '{"tab":"6","user":"現在幾點?"}' --max-time 300 > /dev/null
```

console:
```js
(async () => {
  const sel = document.querySelector('.tab-select');
  sel.value = 'mcp'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const userRow = document.querySelector('.tab-panel[data-panel="mcp"] .turns > div:nth-child(2)');
  userRow.querySelector(':scope > details').open = true;
  const wire = userRow.querySelector(':scope > details > div.max-h-64');
  const tools = wire.querySelector('details details');
  tools.open = true;
  const toolCount = tools.querySelectorAll(':scope > div > *').length;

  // protocol card:notifications/initialized 那張的 response 是 null。
  // 必須找到一個「文字剛好是 null」的 syn-num span —— 不能只檢查
  // .text-syn-num 存在(任何數字都會讓那種弱斷言通過)。
  const turns = document.querySelector('.tab-panel[data-panel="mcp"] .turns');
  const nullSpan = [...turns.querySelectorAll('.text-syn-num')]
    .some((n) => n.textContent === 'null');

  return { tab6_tool_count: toolCount, null_rendered_as_syn_num: nullSpan };
})();
```
Expected: `tab6_tool_count: 2`(`get_time` + `get_weather`);`null_rendered_as_syn_num: true`;console 無 error。

- [ ] **Step 8: 迴歸 —— tabs ①③ 未受影響**

```bash
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d '{"tab":"3","user":"9.11 跟 9.8 哪個大?","mode":"thinking"}' --max-time 300 > /dev/null
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d '{"tab":"1","user":"1+1="}' --max-time 180 > /dev/null
```

console:
```js
(async () => {
  const sel = document.querySelector('.tab-select');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  sel.value = 'reasoning'; sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(60);
  const t3 = document.querySelector('.tab-panel[data-panel="reasoning"] .tok');
  sel.value = 'basic'; sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(60);
  const t1 = document.querySelector('.tab-panel[data-panel="basic"] .tok');
  return { tab3_cursor: getComputedStyle(t3).cursor, tab1_cursor: getComputedStyle(t1).cursor };
})();
```
Expected: `tab3_cursor: "default"`、`tab1_cursor: "pointer"`

- [ ] **Step 9: Commit**

```bash
git add frontend/app.js frontend/index.html frontend/index.zh-TW.html
git commit -m "feat(wire): 展開器內容接上 wire view

BUBBLE.wire 取代 10 個 BUBBLE.pre 呼叫點(④⑥ 的 templated prompt 與
received_chunk、⑤ 的 messages[]/received、⑥ 的 protocol card)。
⑤ 腳本原始碼與解剖卡仍走 BUBBLE.pre(純碼,不在範圍)。

外層是 <div> 不是 <pre>:<details> 不能合法巢狀在 <pre> 裡,且 npPre 的
break-all 會把上色 token 從中間折斷。

wire.js?v=1 排在 app.js?v=92 之前;styles.css?v=66 不動。"
```

---

## 完成後的整體驗收

對照 spec 的「驗收」節逐條走一次:

- [ ] `pytest agent/tests -q` → 135 passed(後端沒動)
- [ ] `node --test frontend/wire.test.js` → `# fail 0`
- [ ] `node --check frontend/wire.js` 與 `frontend/app.js` 皆通過
- [ ] ④ user 泡:3 個 `<|im_start|>` 區塊,system/user 可折、結尾 assistant 只是一行 marker
- [ ] ④ `<tools>` 預設收起,summary 顯示「1 個工具,N 字元」;展開後只有 `get_time`,key 藍、字串橘
- [ ] ④ system 裡的非法 JSON `<tool_call>` 範例原樣顯示,console 無 error
- [ ] ④ 藍泡:`<tool_call>` 預設展開,裡面 JSON 有上色
- [ ] ⑥ user 泡:`<tools>` 裡有 2 個工具;protocol card 的 `response: null` 以 `syn-num` 顯示
- [ ] ⑤ 琥珀泡:`role: "tool"` 節點因 >200 字元預設收起,展開後看得到 SKILL.md
- [ ] ⑤ 腳本紫泡 / 解剖卡:仍是純 `<pre>`,沒有上色或折疊
- [ ] 展開器裡看得到字面的 `<tools>` / `<tool_call>` / `<|im_start|>` / `<|im_end|>`;`document.getElementsByTagName('tools').length === 0`
- [ ] 每顆泡泡的**直接子** `<details>` 仍最多一個
- [ ] 右側展開器仍貼齊泡泡右緣
- [ ] tab③ token 仍不可點;tab① 仍可點;console 0 errors
- [ ] 兩個 HTML:`wire.js?v=1` + `app.js?v=92`,`styles.css?v=66` 未動
- [ ] `git diff --stat frontend/styles.css` 為空
