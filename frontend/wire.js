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
  //
  // 為什麼不順便停在下一個 <|im_start|>?因為使用者可以在輸入框裡直接打出
  // 「<|im_start|>」這串字,它會原封不動進到 templated prompt 的 user 訊息裡。
  // 多加那個 alternative 會把 user 的內容從那裡截斷、還把 hadEnd 誤設成 false ——
  // 那是今天就會發生的事。反之,「中間某則訊息缺 <|im_end|>」目前無任何 producer
  // 會產生(server.py / skill_agent.py / mcp_agent.py 都無條件補上 <|im_end|>)。
  // 兩害相權:留現行版本。下面兩個測試把這個取捨釘死。
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

  // 陷阱 4:system 散文裡有「空標籤對」(`…within <tools></tools> XML tags:`),
  // 那是句子,不是區塊。兩側都強制要求換行,空標籤對就匹配不到,自然落回 text 段。
  // 真實區塊一定長成 <tools>\n…\n</tools>。
  const BLOCK_RE = /<(tools|tool_call)>\n([\s\S]*?)\n<\/\1>/g;

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

  // isRoot:根節點恆展開(spec §5 ——「一打開展開器就看到骨架」),子節點仍照
  // shouldCollapse 規則收合。只有頂層呼叫(render())傳 true;遞迴一律 false。
  function jsonNode(value, isRoot) {
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
      row.appendChild(jsonNode(v, false));
      body.appendChild(row);
    }
    return fold(summary, body, !!isRoot || !shouldCollapse(value));
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
    const role = () => el("span", "text-syn-tag ml-1", msg.role);

    // 陷阱 1:結尾的 assistant body 是空的 —— 只印一行 marker,不給 toggle。
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
    // <|im_end|> 是 template 標記,是教材的一部分 —— 不能弄丟。
    if (msg.hadEnd) body.appendChild(el("div", "text-syn-marker", "<|im_end|>"));

    const summary = [
      marker(),
      role(),
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
      return parsed.ok ? jsonNode(parsed.value, true) : textLine(src);
    }
    return renderChat(src);
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
