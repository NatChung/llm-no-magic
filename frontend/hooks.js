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

  // renderRevisit(letter, gate) — fills .hook-revisit; defined per-hook in Task 5 (A) / Task 7 (B)
  // Placeholder until those tasks land:
  function renderRevisit(letter, gate) {
    var revisit = gate.querySelector(".hook-revisit");
    revisit.innerHTML = "<p>(revisit content added in a later task)</p>";
  }
  window.Hooks._setRenderRevisit = function (fn) { renderRevisit = fn; };

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
