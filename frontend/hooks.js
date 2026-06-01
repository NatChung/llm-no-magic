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
