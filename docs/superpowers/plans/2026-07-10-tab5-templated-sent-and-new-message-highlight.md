# Tab 5 templated sent + 「這次新增要送出的」highlight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab ⑤ 的 sent-prompt 展開器改用 tab ④ 的 `<|im_start|>` templated 累積視圖,並在 tab ④⑤⑥ 的 sent 視圖裡把「結尾空 assistant 之前的最後一則非空訊息」(= 這一發剛加進來、要送出的新輸入)標成琥珀底 + 尾巴註釋。

**Architecture:** 後端 `skill_agent.py` 加打一次 `/apply-template`(照 tab④),`sent` frame 多帶 templated `sent_prompt`。前端 tab⑤ 改用它 → 三個 tab 同走 wire.js 的 chat 渲染路徑。wire.js 加一個純函式 `_lastContentfulIndex` 找目標訊息,DOM 層在該訊息的 `<summary>` 加琥珀底 + 註釋;只有 sent 視圖傳 `{markSent:true}`,received/JSON 視圖不傳。

**Tech Stack:** stdlib Python server + `requests`(打 llama `/v1/chat/completions` 與 `/apply-template`)、zero-build 前端(Tailwind Play CDN)、node v24 內建 `node --test`、pytest。

Spec: `docs/superpowers/specs/2026-07-10-tab5-templated-sent-and-new-message-highlight.md`

## Global Constraints

- **`frontend/styles.css` 一個位元組不改。** `.tok.tok-static`(`styles.css:79-80`)是 tab③ 活依賴。全部用 Tailwind utility。
- **wire.js 絕不用 `.innerHTML`**;`document` 只在函式體內碰(載入期間不得碰,否則 node `require` 死、15 個測試全紅)。
- **wire.js 在載入期間不得呼叫 `t()`**;`label()` 用 `typeof t === "function"` 延遲取用。
- **opts 一定要有預設值**:`render(text, opts = {})`、`renderChat(text, opts = {})`、`BUBBLE.wire(text, opts = {})`。少了 `= {}`,received_chunk 走 `renderChat(text, undefined)` → `opts.markSent` 對 undefined 取值 `TypeError`,炸掉 tab④「模型吐的原始訊息」+ console error。
- **apply-template 不傳 `chat_template_kwargs`**:傳了 `enable_thinking:false` 會把 `<think></think>` 塞進結尾 assistant → 結尾非空 → highlight 落錯訊息。這是 highlight 正確性的不變式。
- **雙語同步:** 每個 `I18N` key 都有 `'en'` + `'zh-TW'`;`teaching/lesson-N-*.md` 與 `.zh-TW.md` 講同樣的事;兩個 HTML 的 `?v=` 同號。
- **Cache-bust:** `wire.js?v=1 → 2`、`app.js?v=93 → 94`;`styles.css?v=66` 不動;兩個 HTML 同號。
- 後端 tab④(`server.py`)、tab⑥(`mcp_agent.py`)的 sent_prompt 產生方式**不動**(本來就送 templated)。Tabs ①②③ 不動。
- 測試:pytest 用 plain function + `monkeypatch`;wire 用 node 內建 runner。
- 伺服器:`nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`

## File Structure

| 檔案 | 本次責任 |
|---|---|
| `agent/skill_agent.py` | 加 `LLAMA_TEMPLATE_URL`;sent frame 前算 templated `sent_prompt`;frame 多帶它 |
| `agent/tests/test_skill_agent.py` | mock 依 URL 分流(apply-template → stub);新增 sent_prompt 斷言 |
| `frontend/wire.js` | `_lastContentfulIndex` 純函式;opts 透傳(含 `= {}` 預設);fold 加 summaryClass;messageBlock 加 isTarget → 琥珀 highlight |
| `frontend/wire.test.js` | `_lastContentfulIndex` 的 node 測試 + mutation |
| `frontend/app.js` | i18n `wire_sent_now`(雙語);`BUBBLE.wire(text, opts={})`;tab⑤ onSent 改 sent_prompt+markSent;tab④⑥ sent 加 markSent |
| `frontend/index.html`、`index.zh-TW.html` | `wire.js?v=2`、`app.js?v=94` |
| `teaching/lesson-{4,5,6}-*.md`(6 檔) | lesson-5 的 role:"tool"/兩次點擊 四處全改;lesson-4/6 補一句 highlight |

---

### Task 1: 後端 —— skill_agent sent frame 多帶 templated `sent_prompt`

**Files:**
- Modify: `agent/skill_agent.py`(`:35` 常數、sent yield 之前、sent frame)
- Modify: `agent/tests/test_skill_agent.py`(mock 分流 + 新斷言)

**Interfaces:**
- Produces:`skill_agent_loop` 的 `sent` frame 新增 `sent_prompt`(str,templated `<|im_start|>…` 字串;template 失敗時 `[template error] …`)。`messages` / `tools` 欄位保留。

- [ ] **Step 1: 先改測試 mock(否則新 code 一落地就整串紅)**

`agent/tests/test_skill_agent.py` 頂部(`_resp` 定義之後)加一個分流 helper:

```python
class _Tpl:
    """apply-template 的 stub 回應:有 raise_for_status、有 prompt key。"""
    def raise_for_status(self):
        pass
    def json(self):
        return {"prompt": "<|im_start|>system\nSTUB<|im_end|>\n<|im_start|>assistant\n"}


def _route(gen_post):
    """把 /apply-template 的 POST 導到 stub,不從 generation 迭代器取值。"""
    def post(url, *a, **kw):
        if "apply-template" in str(url):
            return _Tpl()
        return gen_post(url, *a, **kw)
    return post
```

然後把**每一個** `monkeypatch.setattr(sa.requests, "post", <X>)` 改成
`monkeypatch.setattr(sa.requests, "post", _route(<X>))`。用
`grep -n 'setattr(sa.requests, "post"' agent/tests/test_skill_agent.py` 找出全部
(lambda、`next(calls)`、`fake_post` 各種形式都要包)。

在既有的 `sent` 測試(`test_skill_agent.py:39` 那個)加一條斷言:

```python
    assert "<|im_start|>" in sent["sent_prompt"]
```

- [ ] **Step 2: 跑測試,確認它現在失敗(sent_prompt 還不存在)**

Run: `python3 -m pytest agent/tests/test_skill_agent.py -q`
Expected: FAIL — `KeyError: 'sent_prompt'`(其餘測試因為 `_route` 已包好、不會因 mock 錯位而爆)

- [ ] **Step 3: `agent/skill_agent.py` 加常數**

`agent/skill_agent.py:35` 的 `LLAMA_URL = ...` 下面加:

```python
LLAMA_TEMPLATE_URL = LLAMA_URL.replace("/v1/chat/completions", "/apply-template")
```

- [ ] **Step 4: sent frame 之前算 sent_prompt,frame 帶上它**

找到 `sent` frame 的 yield(`agent/skill_agent.py` 約 `:363`,`yield { "type": "sent", "turn": turn, "messages": messages, "tools": [...] }`)。在**它之前**插入:

```python
        # 顯示用的 templated prompt —— 跟 tab④ 一致,讓三個 tab 同格式。
        # ⚠️ 不傳 chat_template_kwargs:傳 enable_thinking:false 會讓 Qwen3 把
        # <think></think> 塞進結尾生成提示 assistant,結尾就不再是空 body,前端
        # 的 highlight(_lastContentfulIndex)會落到錯的訊息上。
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

在 `sent` frame 的 dict 裡加 `"sent_prompt": sent_prompt,`(`messages` / `tools` 保留不動)。

- [ ] **Step 5: 跑測試,確認通過**

Run: `python3 -m pytest agent/tests -q`
Expected: PASS,`135 passed`(數字可能因新斷言不變 —— 沒新增測試函式,只加了一條 assert)

- [ ] **Step 6: Commit**

```bash
git add agent/skill_agent.py agent/tests/test_skill_agent.py
git commit -m "feat(tab5): sent frame 多帶 templated sent_prompt

skill_agent 在 sent frame 前打一次 /apply-template(帶 active_tools,空的時候
省略 tools key)。不傳 chat_template_kwargs —— 傳了 enable_thinking:false 會把
<think></think> 塞進結尾 assistant、破壞前端 highlight 的『結尾空 assistant』前提。

test_skill_agent 的 mock 改成依 URL 分流:apply-template 回 stub、不吃 generation
迭代器,否則每 turn 多消耗一顆回應會 StopIteration。"
```

---

### Task 2: wire.js —— `_lastContentfulIndex` + markSent highlight

**Files:**
- Modify: `frontend/wire.js`(`fold` 加 param、`render`/`renderChat`/`messageBlock` 加 opts、新純函式)
- Modify: `frontend/wire.test.js`(`_lastContentfulIndex` 測試 + mutation)

**Interfaces:**
- Consumes:無(自足)。`label('wire_sent_now')` 引用的 i18n key 在 Task 3 才加進 `app.js`;wire.js 的 node 測試裡 `label()` 會 fallback 回 key 字串,不影響測試。
- Produces:
  - `WIRE._lastContentfulIndex(msgs) -> number`(最後一個 `body.trim() !== ""` 的 index,全空回 `-1`)
  - `WIRE.render(text, opts = {})` / `renderChat(text, opts = {})`:`opts.markSent === true` 時 highlight 目標訊息

- [ ] **Step 1: 寫 `_lastContentfulIndex` 的失敗測試**

`frontend/wire.test.js` 檔尾加:

```js
// ── _lastContentfulIndex ────────────────────────────────────────
// sent-prompt 結尾一定是空 body 的 <|im_start|>assistant 生成提示;
// 「最後一個非空 body」就是這一 turn 剛加進來、要送出的新輸入。
test("_lastContentfulIndex: 跳過結尾空 body,回最後一個非空", () => {
  const msgs = [
    { role: "system", body: "x" },
    { role: "user", body: "現在幾點?" },
    { role: "assistant", body: "<tool_call>…" },
    { role: "user", body: "16:31:40" },   // ← 目標:最後一個非空
    { role: "assistant", body: "" },        // 結尾生成提示,空 body
  ];
  assert.strictEqual(WIRE._lastContentfulIndex(msgs), 3);
});

test("_lastContentfulIndex: 全部空 → -1", () => {
  assert.strictEqual(WIRE._lastContentfulIndex([{ body: "" }, { body: "  " }]), -1);
});

test("_lastContentfulIndex: 單一非空 → 0", () => {
  assert.strictEqual(WIRE._lastContentfulIndex([{ body: "hi" }]), 0);
});

test("_lastContentfulIndex: 空陣列 → -1", () => {
  assert.strictEqual(WIRE._lastContentfulIndex([]), -1);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test frontend/wire.test.js`
Expected: FAIL — `WIRE._lastContentfulIndex is not a function`

- [ ] **Step 3: wire.js 加純函式並 export**

在 `frontend/wire.js` 的 `shouldCollapse` 函式附近(純解析區)加:

```js
  // sent-prompt 一律以 add_generation_prompt 產生,結尾是空 body 的
  // <|im_start|>assistant 生成提示 —— 所以「最後一個非空 body」就是這一 turn
  // 剛 append 的新輸入。前提:apply-template 不傳 enable_thinking:false
  // (見 skill_agent.py / server.py 的 apply-template 呼叫);若傳了,<think></think>
  // 會塞進結尾 assistant,這個函式會回錯的 index。
  function lastContentfulIndex(msgs) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].body.trim() !== "") return i;
    }
    return -1;
  }
```

在檔尾 `return { … }` 裡加 `_lastContentfulIndex: lastContentfulIndex,`。

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test frontend/wire.test.js`
Expected: PASS,`# pass 19`(原 15 + 新 4)

- [ ] **Step 5: mutation —— 證明「跳過結尾空」那條有牙齒**

暫時把 `lastContentfulIndex` 的 `if (msgs[i].body.trim() !== "")` 改成 `if (true)`
(即不跳過空 body),`node --test frontend/wire.test.js`。確認
`_lastContentfulIndex: 跳過結尾空 body…` 那條 **FAIL** —— mutation 下它回
`msgs.length - 1 = 4`(結尾那個空 assistant),而正解是 3,所以斷言 red。
(「全部空 → -1」那條也會一起 red,正常。)改回原樣,再跑一次確認 19/19 全綠。
報告兩次結果。

- [ ] **Step 6: fold 加 summaryClass;render/renderChat/messageBlock 加 opts + highlight**

`frontend/wire.js` 的 `fold`(`:110`)簽名加第 4 參數,套到 `<summary>`:

```js
  function fold(summaryChildren, bodyNode, open, summaryClass) {
    const d = el("details", "wire-fold");
    d.open = !!open;
    const s = el("summary", SUMMARY_CLS + (summaryClass ? " " + summaryClass : ""));
```
(函式其餘不動;既有三個呼叫點 toolsBlock/toolCallBlock/jsonNode 傳 3 個參數,第 4 個 `undefined` → 不加 class,行為不變。)

`messageBlock`(`:199`)簽名加 `isTarget`,非空分支的 summary 加註釋、fold 傳琥珀 class:

```js
  function messageBlock(msg, isTarget) {
    const marker = () => el("span", "text-syn-marker", "<|im_start|>");
    const role = () => el("span", "text-syn-tag ml-1", msg.role);

    // 陷阱 1:結尾的 assistant body 是空的 —— 只印一行 marker,不給 toggle。
    // (target 依定義非空,永遠不會落在這條,不用改。)
    if (msg.body.trim() === "") {
      const line = el("div");
      line.append(marker(), role());
      return line;
    }

    const body = el("div");
    for (const seg of splitBlocks(msg.body)) {
      if (seg.type === "tools") body.appendChild(toolsBlock(seg.text));
      else if (seg.type === "tool_call") body.appendChild(toolCallBlock(seg.text));
      else body.appendChild(textLine(seg.text));
    }
    if (msg.hadEnd) body.appendChild(el("div", "text-syn-marker", "<|im_end|>"));

    const summary = [
      marker(),
      role(),
      el("span", "text-muted ml-2", label("wire_chars_summary", { chars: msg.body.length })),
    ];
    if (isTarget) summary.push(el("span", "text-inject ml-2", label("wire_sent_now")));
    return fold(summary, body, true, isTarget ? "bg-inject-tint rounded px-1" : "");
  }
```

`renderChat`(`:227`)算 target 並傳給每則:

整個 `renderChat` 函式替換掉(原本開頭是 `function renderChat(text) {`):

```js
  function renderChat(text, opts) {
    const msgs = splitMessages(text);
    if (msgs.length === 0) return textLine(text);   // 認不出來就原樣顯示
    const target = opts.markSent ? lastContentfulIndex(msgs) : -1;
    const root = el("div", "space-y-1");
    for (let i = 0; i < msgs.length; i++) {
      root.appendChild(messageBlock(msgs[i], i === target));
    }
    return root;
  }
```

`render`(`:235`)加 `opts = {}` 預設並透傳:

```js
  function render(text, opts = {}) {
    const src = String(text == null ? "" : text);
    if (detect(src) === "json") {
      const parsed = tryParse(src);
      return parsed.ok ? jsonNode(parsed.value, true) : textLine(src);
    }
    return renderChat(src, opts);
  }
```
(`render` 的 JSON 分支不理 opts —— JSON 視圖不 highlight。)

- [ ] **Step 7: 純解析測試仍全綠(證明 opts 預設值沒破壞載入 + DOM 沒滲進頂層)**

Run: `node --test frontend/wire.test.js`
Expected: PASS,`# pass 19`

Run: `node --check frontend/wire.js`
Expected: 無輸出

Run: `node -e "require('./frontend/wire.js')"`
Expected: 無錯(證明 `document` 沒被提到 IIFE 頂層)

- [ ] **Step 8: Commit**

```bash
git add frontend/wire.js frontend/wire.test.js
git commit -m "feat(wire): markSent highlight —— 標記最後一則非空訊息

新增純函式 _lastContentfulIndex(結尾空 assistant 生成提示前的最後一則非空 =
這一 turn 的新輸入),node 測試 + mutation 驗證有牙齒。render/renderChat/
fold/messageBlock 加 opts 與 isTarget:markSent 時給目標訊息的 <summary> 加
bg-inject-tint 琥珀底 + wire_sent_now 尾巴註釋。

opts 一律有 = {} 預設 —— received_chunk 走 renderChat(text, undefined) 時
opts.markSent 對 undefined 取值會 TypeError。"
```

---

### Task 3: app.js 整合 —— tab⑤ 改 sent_prompt、三個 sent 點加 markSent、i18n、cache-bust

**Files:**
- Modify: `frontend/app.js`(`I18N`、`BUBBLE.wire`、tab⑤ onSent、tab④⑥ sent 點)
- Modify: `frontend/index.html`、`frontend/index.zh-TW.html`(`?v=`)

**Interfaces:**
- Consumes:Task 1 的 `sent.sent_prompt`(tab⑤);Task 2 的 `WIRE.render(text, {markSent})`
- Produces:`BUBBLE.wire(text, opts = {})`

- [ ] **Step 1: 加 i18n key `wire_sent_now`(雙語)**

`frontend/app.js` 的 `I18N` 裡,`wire_chars_summary` 之後加:

```js
  wire_sent_now: {
    'en':    '← new this turn — being sent',
    'zh-TW': '← 這次新增、要送出的',
  },
```

- [ ] **Step 2: `BUBBLE.wire` 收 opts 並透傳(含預設值)**

`frontend/app.js:364` 的 `wire(text) {` 改成:

```js
  wire(text, opts = {}) {
    const box = document.createElement("div");
    box.className = BUBBLE.tw.npWire;
    box.appendChild(WIRE.render(text, opts));
    return box;
  },
```

- [ ] **Step 3: tab⑤ onSent 改用 sent_prompt + markSent**

`frontend/app.js` 的 `onSent`(約 `:958-961`),把
```js
        BUBBLE.wire(JSON.stringify(f.messages, null, 2)), { align: "right" }));
```
改成
```js
        BUBBLE.wire(f.sent_prompt, { markSent: true }), { align: "right" }));
```
(第二個 `{ align: "right" }` 是 `BUBBLE.details` 的參數,不動它。)

- [ ] **Step 4: tab④ / tab⑥ 的 sent 點加 markSent**

tab④(約 `:772`):
```js
                                                  BUBBLE.wire(sent_prompt, { markSent: true }),
```
tab⑥(約 `:1200`):
```js
                                                  BUBBLE.wire(f.sent_prompt, { markSent: true }),
```
**received / JSON / protocol 那些 `BUBBLE.wire(...)` 不加** —— 維持單參數。

- [ ] **Step 5: cache-bust**

兩個 HTML(`index.html` + `index.zh-TW.html`):`wire.js?v=1 → wire.js?v=2`、`app.js?v=93 → app.js?v=94`。`styles.css?v=66` 不動。

```bash
python3 - <<'EOF'
import re, pathlib
for f in ["frontend/index.html", "frontend/index.zh-TW.html"]:
    p = pathlib.Path(f); s = p.read_text()
    s = s.replace("wire.js?v=1", "wire.js?v=2").replace("app.js?v=93", "app.js?v=94")
    p.write_text(s)
    print(f, re.findall(r'(?:wire\.js|app\.js|styles\.css)\?v=\d+', s))
EOF
```
Expected 兩檔皆 `['styles.css?v=66', 'wire.js?v=2', 'app.js?v=94']`

- [ ] **Step 6: 靜態關卡**

```bash
node --check frontend/app.js && echo "SYNTAX OK"
node --test frontend/wire.test.js 2>&1 | grep -E "^. (pass|fail)"
python3 -c "
import re, pathlib
s = pathlib.Path('frontend/app.js').read_text()
b = s[s.index('const I18N = {'):s.index('\nfunction t(')]
m = re.findall(r\"^  ([a-z0-9_]+): \{\n((?:.*\n)*?)  \},\", b, re.M)
sg = re.findall(r\"^  ([a-z0-9_]+):\s*\{(.*)\},\s*\$\", b, re.M)
ks = m + sg; bad = [k for k,v in ks if \"'en'\" not in v or \"'zh-TW'\" not in v]
print('missing lang:', bad or 'none', '| wire_sent_now:', any(k=='wire_sent_now' for k,_ in ks))
"
git diff --stat frontend/styles.css; echo "(空=未動)"
```
Expected:`SYNTAX OK`;`pass 19`;`missing lang: none | wire_sent_now: True`;styles.css diff 空。

- [ ] **Step 7: 起 server,驅動三個 tab(controller 之後做瀏覽器驗收)**

```bash
pkill -f "agent.server"; sleep 1
nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
sleep 3 && curl -s localhost:9000/health
for p in '{"tab":"4","user":"現在幾點?"}' '{"tab":"5","user":"台北今天天氣怎樣?"}' '{"tab":"6","user":"現在幾點?"}'; do
  curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d "$p" --max-time 300 \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('tab', d['tab'], 'ok')"
done
```
Expected:`status: ok`;三個 tab 都 `ok`。瀏覽器 DOM 驗收由 controller 跑(見整體驗收),此步不做瀏覽器自動化。

- [ ] **Step 8: Commit**

```bash
git add frontend/app.js frontend/index.html frontend/index.zh-TW.html
git commit -m "feat(tabs 4-6): tab⑤ sent 改 templated + 三個 sent 點加 markSent highlight

tab⑤ onSent 從 JSON.stringify(messages) 改成 wire(sent_prompt, {markSent:true})
—— 三個 tab 的 sent 展開器同格式。tab④⑥ 的 sent 點也加 {markSent:true}。
received/JSON/protocol 視圖維持單參數、不 highlight。i18n wire_sent_now 雙語;
wire.js?v=2 + app.js?v=94。"
```

---

### Task 4: 教材同步(雙語 6 檔)

**Files:**
- Modify: `teaching/lesson-5-skill.md` + `.zh-TW.md`(role:"tool" / 兩次點擊 四處)
- Modify: `teaching/lesson-4-agent.md` + `.zh-TW.md`(補一句 highlight)
- Modify: `teaching/lesson-6-mcp.md` + `.zh-TW.md`(補一句 highlight)

**Interfaces:** 無 code interface。內容必須跟 Task 2/3 實際渲染出來的 UI 一致。

**Ground truth(controller 已在瀏覽器驗過,以此為準):**
- tab⑤ 的 sent 展開器現在是 `<|im_start|>` 累積視圖(**不再是 JSON 樹**)。
- SKILL.md 注入顯示成一個 `<|im_start|>user` 區塊(字元數大),**展開泡泡就直接看到**(不是「兩次點擊」)。
- 該區塊(turn 2 的最後一則非空)有**琥珀底 + 尾巴「← 這次新增、要送出的」**。

- [ ] **Step 1: lesson-5 —— 四處 role:"tool" / 兩次點擊全改(雙語)**

`grep -n 'role: "tool"\|兩次\|two clicks\|messages\[\]\|JSON 樹\|JSON tree' teaching/lesson-5-skill.md teaching/lesson-5-skill.zh-TW.md` 列出全部命中。逐處改寫:

- 「sent 展開器是 messages[] JSON 陣列」→「跟 tab④ 一樣的 `<|im_start|>` 累積視圖」
- 「SKILL.md 以 `role:"tool"` 節點折起來、要再點一層/兩次點擊」→「SKILL.md 是一個
  `<|im_start|>user` 區塊(字元數大),展開泡泡就直接看到;而且它被琥珀 highlight 標成
  『這次新增、要送出的』—— 正好是注入現場」

zh 要改的錨點:`:53-63`、`:57`、`:61-62`、`:81`。en:`:63-75`、`:67`、`:73-75`、`:96`。
兩邊講同樣的事。

- [ ] **Step 2: lesson-4 / lesson-6 —— 補一句 highlight(雙語)**

在各自描述 sent 展開器的地方補一句(zh / en 對稱):

- zh:「最後一則(琥珀底、標『← 這次新增、要送出的』)是這一發剛加進來、要送給 model 的新輸入 —— turn 1 是你的問題,之後是餵回的工具結果。」
- en:「The last block (amber-tinted, tagged "← new this turn — being sent") is the fresh input just appended this turn — the question on turn 1, the fed-back tool result after.」

- [ ] **Step 3: 驗證雙語 + 無殘留**

```bash
grep -rn 'role: "tool"\|兩次點擊\|two clicks\|messages\[\] JSON\|messages\[\] array' teaching/lesson-5-skill.md teaching/lesson-5-skill.zh-TW.md
```
Expected:無殘留描述舊 JSON 樹 sent 視圖的命中(「無 skill 對照」等無關命中可留)。

```bash
grep -c '琥珀\|amber\|這次新增\|new this turn' teaching/lesson-4-agent.md teaching/lesson-4-agent.zh-TW.md teaching/lesson-5-skill.md teaching/lesson-5-skill.zh-TW.md teaching/lesson-6-mcp.md teaching/lesson-6-mcp.zh-TW.md
```
Expected:六個檔案每個 `>= 1`。

```bash
git diff --stat   # 只有 teaching/ 6 檔
python3 -m pytest agent/tests -q | tail -1   # 防呆:純教材不影響測試
```

- [ ] **Step 4: Commit**

```bash
git add teaching/
git commit -m "docs(teaching): lesson-5 sent 視圖改 <|im_start|>;lesson-4/6 補 highlight

tab⑤ sent 從 messages[] JSON 樹改成 <|im_start|> 累積視圖後,lesson-5 四處
role:\"tool\"/兩次點擊的描述全部過時 —— 改成 SKILL.md 是個 <|im_start|>user 區塊、
展開泡泡直接看到、被琥珀 highlight 標成注入現場。lesson-4/6 補一句
『最後一則(琥珀底)是這次新增要送出的』。雙語同步。"
```

---

## 完成後的整體驗收(controller 跑,對照 spec 驗收)

- [ ] `pytest agent/tests -q` 全綠(mock 已 URL 分流;sent_prompt 斷言過)
- [ ] `node --test frontend/wire.test.js` → `pass 19`;`node --check` 兩檔過
- [ ] 瀏覽器(切分頁後量,隱藏 panel rect 全 0 會假陰性):
  - ④ turn 2 sent:`<|im_start|>` 視圖;**最後一則非空**(`<|im_start|>user`)有琥珀底 + 尾巴「← 這次新增、要送出的」;結尾空 `<|im_start|>assistant` 無 highlight;turn 1 highlight 落在原始問題
  - ⑤ sent:**變成 `<|im_start|>` 視圖(不再是 JSON 樹)**;turn 2 的 SKILL.md 那則(字元數大)被琥珀 highlight;展開看得到 SKILL.md 全文
  - ⑥ sent:最後一則非空有琥珀 highlight
  - **received 視圖不 highlight 也不 crash**:展開 tab④「模型吐的原始訊息」正常渲染、無琥珀底、**console 無 TypeError**
  - 迴歸:每泡 ≤1 直接子 `<details>`;tab③ `cursor: default`;tab① `cursor: pointer`;console 0 errors
- [ ] 兩個 HTML:`wire.js?v=2` + `app.js?v=94` + `styles.css?v=66`;`git diff --stat frontend/styles.css` 空
