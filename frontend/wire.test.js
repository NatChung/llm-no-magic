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

// 使用者可以直接打出「<|im_start|>」這串字。它必須原樣留在 user 的 body 裡,
// 不能被截斷 —— 這是 MSG_RE 不把 <|im_start|> 加進 lookahead 的理由。
test("_splitMessages: user 打出 <|im_start|> 字面值,body 不得被截斷", () => {
  const text =
    "<|im_start|>user\nhello <|im_start|>injected<|im_end|>\n" +
    "<|im_start|>assistant\n";
  const msgs = WIRE._splitMessages(text);
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].role, "user");
  assert.strictEqual(msgs[0].body, "hello <|im_start|>injected");
  assert.strictEqual(msgs[0].hadEnd, true);
});

// 已知限制(目前無 producer 會產生):中間某則訊息若缺 <|im_end|>,
// 它的 body 會吞掉後面的訊息。這個測試鎖住現行行為,免得有人在不知道
// 上面那個取捨的情況下「修好」它。
test("_splitMessages: 已知限制 —— 中間缺 im_end 會吞掉下一則", () => {
  const text =
    "<|im_start|>system\nfoo\n" +
    "<|im_start|>user\nbar<|im_end|>";
  const msgs = WIRE._splitMessages(text);
  assert.strictEqual(msgs.length, 1);
  assert.ok(msgs[0].body.includes("<|im_start|>user"));
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

// 陷阱 4:真實 system 散文裡的「空標籤對」是句子的一部分,不是區塊。
// 這段 fixture 逐字抄自 tab④ 的 /preview 輸出。
test("_splitBlocks: 散文裡的空標籤對不得被當成區塊", () => {
  const realSystemBody =
    "You are provided with function signatures within <tools></tools> XML tags:\n" +
    '<tools>\n{"type": "function", "function": {"name": "get_time"}}\n</tools>\n\n' +
    "For each function call, return a json object within <tool_call></tool_call> XML tags:\n" +
    '<tool_call>\n{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>';
  const segs = WIRE._splitBlocks(realSystemBody);

  // 只能有一個 tools 段、一個 tool_call 段,而且都不是空的
  const tools = segs.filter((s) => s.type === "tools");
  const calls = segs.filter((s) => s.type === "tool_call");
  assert.strictEqual(tools.length, 1, "空的 <tools></tools> 被誤判成區塊了");
  assert.strictEqual(calls.length, 1, "空的 <tool_call></tool_call> 被誤判成區塊了");
  assert.ok(tools[0].text.includes("get_time"));
  assert.ok(calls[0].text.includes("<function-name>"));

  // 散文裡的空標籤對必須原樣留在 text 段裡(否則教材那兩句話會被吃掉)
  const proseText = segs.filter((s) => s.type === "text").map((s) => s.text).join("");
  assert.ok(proseText.includes("<tools></tools>"));
  assert.ok(proseText.includes("<tool_call></tool_call>"));
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
