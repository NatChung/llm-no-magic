/* hooks.js — Before/After hook state. Self-contained, no app.js dependency. */
(function () {
  "use strict";

  var STORAGE_KEY = "llm-no-magic-hooks";

  function nowISO() {
    return new Date().toISOString();
  }

  function readAll() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 1 };
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return { version: 1 };
      if (!obj.version) obj.version = 1;
      return obj;
    } catch (e) {
      return { version: 1 };
    }
  }

  function writeAll(obj) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false; // private mode / quota — fail silently, hooks still work in-session
    }
  }

  // hookKey is "hookA" or "hookB"
  function getHook(hookKey) {
    var all = readAll();
    return all[hookKey] || null;
  }

  function setBefore(hookKey, data) {
    var all = readAll();
    var h = all[hookKey] || {};
    h.before = Object.assign({}, data, { timestamp: nowISO() });
    all[hookKey] = h;
    writeAll(all);
    return h;
  }

  function setAfter(hookKey, data) {
    var all = readAll();
    var h = all[hookKey] || {};
    h.after = Object.assign({}, data, { timestamp: nowISO() });
    all[hookKey] = h;
    writeAll(all);
    return h;
  }

  function clearHook(hookKey) {
    var all = readAll();
    delete all[hookKey];
    writeAll(all);
  }

  function hasBefore(hookKey) {
    var h = getHook(hookKey);
    return !!(h && h.before);
  }

  window.Hooks = {
    STORAGE_KEY: STORAGE_KEY,
    readAll: readAll,
    getHook: getHook,
    setBefore: setBefore,
    setAfter: setAfter,
    clearHook: clearHook,
    hasBefore: hasBefore,
  };
})();

/* hooks.js — part 2: DOM controller */
(function () {
  "use strict";
  if (!window.Hooks) return;
  var Store = window.Hooks;

  var LANG = document.documentElement.lang || "en";
  function L(en, zh) { return LANG === "zh-TW" ? zh : en; }

  // map a hook key letter ("A"/"B") to store key ("hookA"/"hookB")
  function storeKey(letter) { return "hook" + letter; }

  // ---- collect answers from a .hook-before block ----
  function collectBefore(beforeEl, letter) {
    function radio(name) {
      var el = beforeEl.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : null;
    }
    function checks(name) {
      return Array.prototype.map.call(
        beforeEl.querySelectorAll('input[name="' + name + '"]:checked'),
        function (el) { return el.value; }
      );
    }
    var textEl = beforeEl.querySelector(".hook-text");
    var text = textEl ? textEl.value.trim() : "";
    if (letter === "A") {
      return { q1: radio("A-q1"), q2: radio("A-q2"), q3: checks("A-q3"), text: text };
    }
    return { q1: radio("B-q1"), q2: radio("B-q2"), text: text };
  }

  // ---- show/hide helpers ----
  function showContent(gate) {
    gate.setAttribute("hidden", "");
    var content = gate.parentElement.querySelector(".hook-content");
    if (content) content.removeAttribute("hidden");
  }
  function showGateBefore(gate) {
    gate.removeAttribute("hidden");
    gate.querySelector(".hook-before").removeAttribute("hidden");
    gate.querySelector(".hook-revisit").setAttribute("hidden", "");
    var content = gate.parentElement.querySelector(".hook-content");
    if (content) content.setAttribute("hidden", "");
  }
  function showGateRevisit(gate) {
    gate.removeAttribute("hidden");
    gate.querySelector(".hook-before").setAttribute("hidden", "");
    gate.querySelector(".hook-revisit").removeAttribute("hidden");
    var content = gate.parentElement.querySelector(".hook-content");
    if (content) content.setAttribute("hidden", "");
  }

  function escapeHtml(s) {
    return (s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var A_Q1_LABEL = {
    "yes-convenient": L("Yes, handy", "會，很方便"),
    "yes-but-recheck": L("Yes, but I'd re-read it", "會但會再看過"),
    "no": L("No", "不會"),
    "unsure": L("Not sure", "不確定"),
  };
  var A_Q2_LABEL = {
    "trust": L("Trust it", "信"),
    "half-trust": L("Half-trust", "半信"),
    "distrust": L("Don't trust", "不信"),
  };
  var A_Q3_LABEL = {
    "nothing-just-paste": L("Nothing — just paste & ask", "什麼都不打，直接貼客訴信叫它回"),
    "paste-sop": L("Paste in refund policy / SOP", "連退款政策 / 客服 SOP 一起貼進去"),
    "type-rules": L("Spell out tone & rules", "交代語氣、不准承諾金額等規則"),
    "never-thought": L("Never thought about it", "沒想過要先打什麼"),
  };
  function joinQ3(arr) {
    if (!arr || !arr.length) return L("(none)", "(沒選)");
    return arr.map(function (v) { return A_Q3_LABEL[v] || v; }).join("、");
  }

  function renderRevisitA(gate) {
    var before = (Store.getHook("hookA") || {}).before || {};
    var q1 = A_Q1_LABEL[before.q1] || L("(not answered)", "(未作答)");
    var q2 = A_Q2_LABEL[before.q2] || L("(not answered)", "(未作答)");
    var q3 = joinQ3(before.q3);
    var yourText = before.text ? escapeHtml(before.text) : L("(left blank)", "(未填)");

    var html = L(
      // ---- EN ----
      '<header class="space-y-2"><h2 class="text-xl font-semibold text-ink">Looking back at the opening question</h2></header>'
      + '<div class="rounded-md bg-surface-2 border border-edge-soft p-3 text-sm space-y-1">'
      +   '<div>You first picked — Q1: <strong>' + q1 + '</strong>; Q2: <strong>' + q2 + '</strong></div>'
      +   '<div>You wrote: <em>' + yourText + '</em></div>'
      + '</div>'
      + '<p>In ① ② ③ you learned how to use <strong>the same GPT</strong> better:</p>'
      + '<ul class="space-y-2 list-disc list-inside">'
      +   '<li><strong>① Why it over-promises:</strong> it does <em>not</em> have your refund policy, so it guesses — confidently (the "fictional planet" demo). Garbage output isn\'t "GPT can\'t be trusted", it\'s "it\'s missing that knowledge".</li>'
      +   '<li><strong>② The fix → feed it the knowledge:</strong> paste your refund SOP / policy into the chat box and it answers from facts, no more inventing; add a line "apologise but promise no amount, leave it to support". (Yes, web ChatGPT has no system-prompt field — but you get the principle now: that\'s just text concatenated into the tokens, so typing it into the chat box works the same!)</li>'
      +   '<li><strong>③ For judgement calls</strong> (soothe vs. don\'t admit liability) turn on thinking; for legal points spell out "must not violate clause XX".</li>'
      + '</ul>'
      + '<div class="rounded border border-final/30 bg-final-tint p-4 space-y-3">'
      +   '<p class="font-medium text-ink">Now, with the SAME GPT, how would you handle this reply?</p>'
      +   '<label class="block"><input type="radio" class="hook-after-radio" name="A-after" value="still-just-paste"> Still just paste and ask</label>'
      +   '<label class="block"><input type="radio" class="hook-after-radio" name="A-after" value="paste-sop-type-rules-check"> Paste the refund SOP + rules into the chat box, then check the promise lines</label>'
      +   '<label class="block"><input type="radio" class="hook-after-radio" name="A-after" value="rather-write-self"> I get it, but I\'d rather write this one myself</label>'
      + '</div>'
      + '<p class="text-sm text-muted">💡 The difference: before = GPT as a wishing well, betting it\'s right; after = you feed it, set rules, know which line to check — same tool, 60 → 90.</p>'
      + '<p class="text-sm text-muted">👉 One refund SOP fits in the chat box; making it auto-search your <em>whole</em> knowledge base does not — that\'s the hands-on tool (Claude Code) in the second half.</p>'
      + '<div class="flex gap-3 items-center"><button class="hook-after-done inline-flex items-center px-4 py-2 rounded-md bg-ink text-surface text-sm font-medium hover:bg-ink-soft transition-colors">Go to Tab ④, see how doing-tools work →</button><button class="hook-reset text-xs text-muted hover:text-ink-soft hover:underline">Redo from scratch</button></div>',
      // ---- zh-TW ----
      '<header class="space-y-2"><h2 class="text-xl font-semibold text-ink">回顧開場那題</h2></header>'
      + '<div class="rounded-md bg-surface-2 border border-edge-soft p-3 text-sm space-y-1">'
      +   '<div>你一開始選了 — Q1：<strong>' + q1 + '</strong>；Q2：<strong>' + q2 + '</strong></div>'
      +   '<div>你那時寫：<em>' + yourText + '</em></div>'
      + '</div>'
      + '<p>你剛剛在 ① ② ③ 學到「同一個 GPT 怎麼用得更好」：</p>'
      + '<ul class="space-y-2 list-disc list-inside">'
      +   '<li><strong>① 它為什麼會亂承諾：</strong>它<em>沒有</em>你公司的退款政策，只能用猜的、還猜得很篤定(= 祖樹星那個假地名)。亂回不是「GPT 不能信」，是「它缺那塊知識」。</li>'
      +   '<li><strong>② 解法 → 把知識打進去：</strong>聊天框裡連你的退款 SOP / 政策一起貼，它就照事實回、不再編；再打一句「道歉但不承諾金額、留客服跟進」交代紅線。(沒錯，網頁版沒 system prompt 欄——但你懂了原理：那只是拼進 token 的文字，直接打進對話框一樣!)</li>'
      +   '<li><strong>③ 拿捏題</strong>(安撫 vs 不擔責)開 thinking 更穩；法律相關明寫「不得違反 XX 條」。</li>'
      + '</ul>'
      + '<div class="rounded border border-final/30 bg-final-tint p-4 space-y-3">'
      +   '<p class="font-medium text-ink">現在「同一個 GPT」，你會怎麼用這封回信?</p>'
      +   '<label class="block"><input type="radio" class="hook-after-radio" name="A-after" value="still-just-paste"> 還是直接貼客訴信叫它回</label>'
      +   '<label class="block"><input type="radio" class="hook-after-radio" name="A-after" value="paste-sop-type-rules-check"> 會連退款 SOP + 紅線一起打進聊天框，再核承諾句</label>'
      +   '<label class="block"><input type="radio" class="hook-after-radio" name="A-after" value="rather-write-self"> 會了，但這題我寧可自己寫</label>'
      + '</div>'
      + '<p class="text-sm text-muted">💡 差別在這：before 是把 GPT 當許願池、賭它對；after 是你餵料、設規則、知道核哪句——同一個工具，60 分用到 90 分。</p>'
      + '<p class="text-sm text-muted">👉 一份 SOP 你貼得進聊天框；但要它每次自動翻你公司「整個」知識庫，就貼不完了 → 那是下半場動手工具(Claude Code)的事。</p>'
      + '<div class="flex gap-3 items-center"><button class="hook-after-done inline-flex items-center px-4 py-2 rounded-md bg-ink text-surface text-sm font-medium hover:bg-ink-soft transition-colors">進 Tab ④，看動手工具怎麼做 →</button><button class="hook-reset text-xs text-muted hover:text-ink-soft hover:underline">重新作答</button></div>'
    );
    gate.querySelector(".hook-revisit").innerHTML = html;
  }

  var REVISIT_RENDERERS = { "A": renderRevisitA };
  function renderRevisit(letter, gate) {
    var fn = REVISIT_RENDERERS[letter];
    if (fn) { fn(gate); return; }
    // No renderer registered (invariant broken — e.g. parts reordered/split). Make it visible, not silent.
    console.error("[hooks] no revisit renderer for", letter);
    gate.querySelector(".hook-revisit").innerHTML =
      '<p class="text-sm text-muted">(revisit unavailable)</p>';
  }
  window.Hooks._registerRevisit = function (letter, fn) { REVISIT_RENDERERS[letter] = fn; };

  function wireGate(gate) {
    var letter = gate.getAttribute("data-hook");      // "A" | "B"
    var key = storeKey(letter);
    var content = gate.parentElement.querySelector(".hook-content");

    // initial state
    if (Store.hasBefore(key)) {
      showContent(gate);
    } else {
      showGateBefore(gate);
    }

    // "I'm done" → save before, show content
    var doneBtn = gate.querySelector(".hook-done");
    if (doneBtn) {
      doneBtn.addEventListener("click", function () {
        Store.setBefore(key, collectBefore(gate.querySelector(".hook-before"), letter));
        showContent(gate);
      });
    }

    // "after done" → save after, show content
    gate.addEventListener("click", function (e) {
      var afterBtn = e.target.closest && e.target.closest(".hook-after-done");
      if (!afterBtn) return;
      var revisit = gate.querySelector(".hook-revisit");
      var textEl = revisit.querySelector(".hook-after-text");
      var radioEl = revisit.querySelector(".hook-after-radio:checked");
      var data = {};
      if (textEl) data.text = textEl.value.trim();
      if (radioEl) data.answer = radioEl.value;
      Store.setAfter(key, data);
      showContent(gate);
    });

    // reset
    gate.addEventListener("click", function (e) {
      var resetBtn = e.target.closest && e.target.closest(".hook-reset");
      if (!resetBtn) return;
      Store.clearHook(key);
      // clear inputs
      Array.prototype.forEach.call(gate.querySelectorAll("input"), function (i) {
        if (i.type === "radio" || i.type === "checkbox") i.checked = false;
      });
      var textEl = gate.querySelector(".hook-text");
      if (textEl) textEl.value = "";
      showGateBefore(gate);
    });

    // "revisit" button lives in .hook-content
    if (content) {
      content.addEventListener("click", function (e) {
        var rb = e.target.closest && e.target.closest(".hook-revisit-btn");
        if (!rb) return;
        renderRevisit(letter, gate);
        showGateRevisit(gate);
      });
    }
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll(".hook-gate"), wireGate);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // expose for tests
  window.Hooks._L = L;
  window.Hooks._collectBefore = collectBefore;
})();

/* hooks.js — part 3: Hook B revisit renderer */
(function () {
  "use strict";
  if (!window.Hooks || !window.Hooks._registerRevisit) { console.error("[hooks] part-3 loaded before controller — check single-file source order (Key decision 6)"); return; }
  var Store = window.Hooks;
  var L = window.Hooks._L;

  function esc(s) {
    return (s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var B_Q1 = {
    "yes-know-how": L("Yes, I roughly know how", "會,我大概知道怎麼弄"),
    "know-direction-cant-do": L("I know the direction but can't do it", "知道方向但不會做"),
    "dont-know-where-to-start": L("No idea where to start", "不知道怎麼開始"),
  };
  var B_Q2 = {
    "know": L("I know", "知道"),
    "roughly": L("Roughly", "大概"),
    "feels-like-magic": L("Feels like magic", "覺得有點像魔法"),
  };

  window.Hooks._registerRevisit("B", function (gate) {
    var before = (Store.getHook("hookB") || {}).before || {};
    var q1 = B_Q1[before.q1] || L("(not answered)", "(未作答)");
    var q2 = B_Q2[before.q2] || L("(not answered)", "(未作答)");
    var yourText = before.text ? esc(before.text) : L("(left blank)", "(未填)");

    var html = L(
      // EN
      '<header class="space-y-2"><h2 class="text-xl font-semibold text-ink">Looking back at the half-time question</h2></header>'
      + '<div class="rounded-md bg-surface-2 border border-edge-soft p-3 text-sm space-y-1">'
      +   '<div>You first picked — Q1: <strong>' + q1 + '</strong>; Q2: <strong>' + q2 + '</strong></div>'
      +   '<div>You wrote: <em>' + yourText + '</em></div>'
      + '</div>'
      + '<p>What you just saw in ④ ⑤ ⑥ ⑦ (no magic):</p>'
      + '<ul class="space-y-2 list-disc list-inside">'
      +   '<li><strong>④ Agent:</strong> the model calls a <code class="bg-surface-2 px-1 rounded text-xs">read_file</code> tool to <em>actually</em> read files — real execution, not a simulation.</li>'
      +   '<li><strong>⑤ Script / API:</strong> batching 50 files can be a bash script, repeated API calls, or a packaged local tool.</li>'
      +   '<li><strong>⑥ Skill:</strong> a "meeting-summary template" becomes a SKILL.md → AI applies it to any future summary job.</li>'
      +   '<li><strong>⑦ MCP:</strong> wrap the summary tool as an MCP server → Claude / Cursor / any client can use it.</li>'
      + '</ul>'
      + '<div class="rounded-md bg-surface-2 border border-edge-soft p-3 text-sm font-mono whitespace-pre-wrap">Agent (④) → read_file reads 50 files\n   ↓ apply the Skill (⑥) meeting-summary template\n   ↓ the verification habit from chunk A (spot-check samples)\n   ↓ wrap as an MCP server (⑦) any client can reuse</div>'
      + '<div class="space-y-1">'
      +   '<label class="font-medium text-ink block" for="B-after-text">If you had to do this task now, how would you do it?</label>'
      +   '<textarea id="B-after-text" class="hook-after-text w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm font-mono" rows="3"></textarea>'
      + '</div>'
      + '<div class="flex gap-3 items-center"><button class="hook-after-done inline-flex items-center px-4 py-2 rounded-md bg-ink text-surface text-sm font-medium hover:bg-ink-soft transition-colors">Go to Tab ⑧ →</button><button class="hook-reset text-xs text-muted hover:text-ink-soft hover:underline">Redo from scratch</button></div>',
      // zh-TW
      '<header class="space-y-2"><h2 class="text-xl font-semibold text-ink">回顧中場那題</h2></header>'
      + '<div class="rounded-md bg-surface-2 border border-edge-soft p-3 text-sm space-y-1">'
      +   '<div>你一開始選了 — Q1:<strong>' + q1 + '</strong>;Q2:<strong>' + q2 + '</strong></div>'
      +   '<div>你那時寫:<em>' + yourText + '</em></div>'
      + '</div>'
      + '<p>你剛剛在 ④ ⑤ ⑥ ⑦ 看到的(沒有魔法):</p>'
      + '<ul class="space-y-2 list-disc list-inside">'
      +   '<li><strong>④ Agent:</strong>AI 叫 <code class="bg-surface-2 px-1 rounded text-xs">read_file</code> tool「真的」去讀檔 — 不是模擬,是真執行。</li>'
      +   '<li><strong>⑤ Script / API:</strong>50 份的批次可以是 bash script、API 多次 call、或包成本地工具。</li>'
      +   '<li><strong>⑥ Skill:</strong>「會議摘要範本」變 SKILL.md → AI 之後遇到任何摘要工作都會套。</li>'
      +   '<li><strong>⑦ MCP:</strong>把摘要工具做成 MCP server → Claude / Cursor 任何 client 都能直接用。</li>'
      + '</ul>'
      + '<div class="rounded-md bg-surface-2 border border-edge-soft p-3 text-sm font-mono whitespace-pre-wrap">Agent(④) → read_file 讀 50 份檔\n   ↓ 套 Skill(⑥)的會議摘要範本\n   ↓ chunk A 教的驗證流程(挑樣本 spot-check)\n   ↓ 包成 MCP server(⑦)下次任何 client 都能用</div>'
      + '<div class="space-y-1">'
      +   '<label class="font-medium text-ink block" for="B-after-text">現在再讓你做這個任務、你會怎麼做?</label>'
      +   '<textarea id="B-after-text" class="hook-after-text w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm font-mono" rows="3"></textarea>'
      + '</div>'
      + '<div class="flex gap-3 items-center"><button class="hook-after-done inline-flex items-center px-4 py-2 rounded-md bg-ink text-surface text-sm font-medium hover:bg-ink-soft transition-colors">進 Tab ⑧,看整課收尾 →</button><button class="hook-reset text-xs text-muted hover:text-ink-soft hover:underline">重新作答</button></div>'
    );
    gate.querySelector(".hook-revisit").innerHTML = html;
  });
})();

/* hooks.js — part 4: Tab ⑧ §0 flip-table */
(function () {
  "use strict";
  if (!window.Hooks) { console.error("[hooks] part-4 loaded before HookStore — check single-file source order (Key decision 6)"); return; }
  var Store = window.Hooks;
  var L = window.Hooks._L;

  function esc(s) {
    return (s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Hook A `after` is an enum (radio) — render through a label map, not raw.
  // (Mirrors the three radios in Task 5's renderRevisitA; redeclared here because
  //  those maps live in the Task 3 controller IIFE, not on window.Hooks.)
  var A_AFTER_LABEL = {
    "still-just-paste": L("Still just paste & ask", "還是直接貼客訴信叫它回"),
    "paste-sop-type-rules-check": L("Paste SOP + rules into the chat box, then check the promise lines", "連退款 SOP + 紅線一起打進聊天框,再核承諾句"),
    "rather-write-self": L("Get it, but would rather write this one myself", "會了,但這題我寧可自己寫"),
  };

  function render() {
    var mount = document.querySelector("[data-hook-recap]");
    if (!mount) return;
    var a = Store.getHook("hookA");
    var b = Store.getHook("hookB");
    var hasAny = (a && a.before) || (b && b.before);

    if (!hasAny) {
      mount.innerHTML = L(
        '<div class="rounded border border-edge bg-surface-2 p-4 text-sm text-ink-soft">You didn\'t fill in Hook A / Hook B. Go back to <strong>Tab ①</strong> / <strong>Tab ④</strong>, fill the opening questions, then come back to see your own flip.</div>',
        '<div class="rounded border border-edge bg-surface-2 p-4 text-sm text-ink-soft">你沒填 Hook A / Hook B。回去 <strong>Tab ①</strong> / <strong>Tab ④</strong> 第一次看時的 hook 頁填一下、再回來看自己的翻轉。</div>'
      );
      return;
    }

    var dash = "—";
    // Hook A: before free-text, recommended anchor after ①②③, the learner's own after-choice
    var aText  = (a && a.before && a.before.text) ? esc(a.before.text) : dash;
    var aAfter = (a && a.after && a.after.answer) ? (A_AFTER_LABEL[a.after.answer] || esc(a.after.answer)) : dash;
    // Hook B: before free-text, the learner's own after free-text
    var bText  = (b && b.before && b.before.text) ? esc(b.before.text) : dash;
    var bAfter = (b && b.after && b.after.text) ? esc(b.after.text) : dash;
    // fixed "what good looks like" anchors (from spec §0) — same for everyone
    var aAnchor = L("feed the refund SOP into the chat box + set red lines + check the promise lines", "聊天框餵 SOP + 交代紅線 + 核承諾句");
    var bAnchor = L("Agent + read_file + Skill template to read my own files", "Agent + read_file + Skill 範本讀我的檔");

    function row(label, val) {
      return '<tr class="border-b border-edge"><td class="py-1 pr-3 text-muted whitespace-nowrap align-top">' + label + '</td><td class="py-1">' + val + '</td></tr>';
    }

    mount.innerHTML = L(
      // EN
      '<h3 class="text-lg font-semibold text-ink">§0. Speaking vs. doing — you can pick the tool now</h3>'
      + '<table class="w-full text-sm border-collapse"><tbody>'
      +   row('Speaking tools (①②③)', 'ChatGPT / Gemini — feed the right context (SOP/rules) into the chat box, set red lines, check the key claims. Line: context you can paste in full.')
      +   row('Doing tools (④⑤⑥⑦)', 'Claude Code / Codex — read your files, run commands, multi-step. Line: context too big / must auto-read files.')
      + '</tbody></table>'
      + '<p class="text-sm text-muted">You were asked "how would you do it?" at Tab ① and Tab ④ — watch your judgement move:</p>'
      + '<table class="w-full text-sm border-collapse"><tbody>'
      +   row('Before Hook A', aText)
      +   row('After ①②③ <span class="text-faint">(what good looks like)</span>', '<em>' + aAnchor + '</em>')
      +   row('Half-time Hook B', bText)
      +   row('After ④⑤⑥⑦ <span class="text-faint">(what good looks like)</span>', '<em>' + bAnchor + '</em>')
      +   row('Your own after-call (A)', aAfter)
      + '</tbody></table>'
      + '<p class="text-sm">If Hook A you went from "just paste it and bet it\'s right" to "feed the SOP + set red lines, know which line to check" — that isn\'t fear of GPT, it\'s <strong>knowing how to use it</strong>: same tool, 60 → 90. Hook B is the same arc: from "feels like magic" to "I can wire that up". Not 8 jargon terms, but knowing which tool a task wants, how to use it well, and what it does under the hood.</p>',
      // zh-TW
      '<h3 class="text-lg font-semibold text-ink">§0. 說話 vs 動手 — 你現在會選工具了</h3>'
      + '<table class="w-full text-sm border-collapse"><tbody>'
      +   row('說話工具(①②③)', 'ChatGPT / Gemini — 聊天框裡餵對 context(SOP/法規)+ 交代紅線 + 核重點。分界:context 你貼得完。')
      +   row('動手工具(④⑤⑥⑦)', 'Claude Code / Codex — 讀你的檔 / 跑指令 / 多步。分界:context 太大 / 要自動讀檔。')
      + '</tbody></table>'
      + '<p class="text-sm text-muted">你在 Tab ① 跟 Tab ④ 各被問了一次「你會怎麼做?」——看你的判斷怎麼變:</p>'
      + '<table class="w-full text-sm border-collapse"><tbody>'
      +   row('Hook A 課前', aText)
      +   row('看完 ①②③ <span class="text-faint">(該長這樣)</span>', '<em>' + aAnchor + '</em>')
      +   row('Hook B 中場', bText)
      +   row('看完 ④⑤⑥⑦ <span class="text-faint">(該長這樣)</span>', '<em>' + bAnchor + '</em>')
      +   row('你自己的課後選擇(A)', aAfter)
      + '</tbody></table>'
      + '<p class="text-sm">如果你 Hook A 課前是「直接貼上去叫它回、賭它對」、課後變成「餵公司 SOP + 交代紅線、知道核哪句」——那不是你變得不敢用 GPT,是你<strong>會用了</strong>:同一個工具 60 分到 90 分。Hook B 同理:從「覺得像魔法」到「我會搭」。不是學了 8 個術語,是知道一個任務該交給哪類工具、怎麼把它用到位、還有它背後到底做了什麼。</p>'
    );
  }

  // re-render whenever recap tab becomes active (data may have changed since load)
  function init() {
    render();
    var recapBtn = document.querySelector('.tab[data-tab="recap"]');
    if (recapBtn) recapBtn.addEventListener("click", render);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
