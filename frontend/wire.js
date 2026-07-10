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
