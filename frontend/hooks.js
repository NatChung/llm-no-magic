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
