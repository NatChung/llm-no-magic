# AI 帶課 relay — Frontend 純儀器化(spec §4–5)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewire `frontend/app.js` + the two HTML files so the teaching page becomes a pure instrument: it subscribes to the backend SSE relay (`GET /events`) and renders whatever a driver (`POST /drive`, fired by the AI OR by the page's own Send button) generates — instead of calling llama directly and owning model swaps.

**Architecture:** One module-level `EventSource("/events")` dispatches each frame to the **currently-driven panel**, looked up in a `PANELS` registry keyed by tab id ("1".."4"). Because the backend `GEN_LOCK` serializes generation, only one panel is ever active at a time, so a single "active target" pointer (set on `drive_start`) is sufficient. Each interactive panel keeps ALL its existing render code (`renderProbs`, `appendClickableToken`, the thinking phase machine, `renderTurnBlock`) — we only relocate the per-token/per-turn bodies into registered callbacks and change the Send button to `POST /drive`. The page no longer fetches llama, no longer calls `/swap`, and no longer owns generation.

**Tech Stack:** Vanilla ES (zero-build, Tailwind Play CDN), `EventSource` (native SSE), `fetch`. Backend endpoints from the completed backend plan: `GET /events`, `POST /drive`, `POST /inspect`, `POST /stop`, `GET /health`.

## Global Constraints

- **Bilingual, always in lockstep:** every change lands in BOTH `frontend/index.html` AND `frontend/index.zh-TW.html`. Bump the `?v=NN` cache-bust query in BOTH HTML files when app.js changes (final task).
- **Page renders SOLELY from `/events`.** The `/drive` response body is ignored by the page (the AI consumes it; the page does not). Do NOT read `res.json()` to render.
- **Token frame shape is llama-native:** `{type:"token", token, top_logprobs:[{token, logprob}]}`. `renderProbs` already does `Math.exp(logprob)` — pass `top_logprobs` through unchanged.
- **`drive_start` disables Send; `final` (and `error`) re-enables it.** Also disable on click to avoid a double-fire 409 race.
- **Tab switch is UI-only** — it must NOT call `/swap`. The server swaps the model inside `/drive`; the page reacts to the `swap_start` frame by showing the existing banner.
- **`POST /drive` payload per tab:** ① `{tab:"1", user}` · ② `{tab:"2", user, system, mode}` (mode = `"raw"|"chat"`) · ③ `{tab:"3", user, mode}` (mode = `"direct"|"thinking"`) · ④ `{tab:"4", user, system}`. `mode` is always sent for ②③.
- **Tab ⑥ skill is OUT of scope** — do NOT touch `setupSkill`, `.skill-preset`, `/skill-agent`, or the skill panel markup. It keeps working exactly as today.
- **Static tabs ⓪⑤⑦⑧ are articles** — the `(?)`/prose removal in §5 applies ONLY to interactive tabs ①②③④, never to the article tabs.
- **No unit-test harness for the frontend.** Verification is Playwright-MCP-driven against the running server (start it: `nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`). Each task ends with a concrete Playwright verification recipe.

## File Structure

- **Modify `frontend/app.js`** — the single frontend script. Changes: add module-level relay plumbing (`PANELS` registry, `connectEvents`, `postDrive`, `postStop`, `PANEL_TO_TAB`); convert tab-switch to UI-only; convert `setupPanel` (basic/advanced/reasoning) and `setupAgent` to register render callbacks + drive via `/drive`; delete the now-dead `LLAMA_URL`/`runCompletion` fetch path, `AGENT_BACKEND_URL` fetch path, `ensureModel`/`/swap` call, preset handlers, and the `DOMContentLoaded` swap.
- **Modify `frontend/index.html` + `frontend/index.zh-TW.html`** — remove `.preset-select` dropdowns (①②③), the `(?)` `<details>` explainers and always-on prose on interactive tabs ①②③④, and bump `?v=NN`. Leave Tab ⑥ skill markup and article tabs untouched.

No files created or deleted.

---

### Task 1: Relay plumbing + Tab ① (basic) end-to-end

Prove the whole architecture on the simplest panel, exactly as the backend plan proved the bus on Tab ④.

**Files:**
- Modify: `frontend/app.js` (add relay plumbing; convert tab-switch; convert basic-panel path in `setupPanel`)

**Interfaces:**
- Produces (module-level):
  - `PANELS` — object, key = tab id `"1".."4"`, value = `{onDriveStart(f), onToken(f), onFinal(f), onInspect(f), onError(f), onTurnComplete?(f)}`
  - `PANEL_TO_TAB` — `{basic:"1", advanced:"2", reasoning:"3", agent:"4"}`
  - `connectEvents()` — opens `EventSource("/events")`, tracks the active panel from `drive_start`, dispatches frames
  - `postDrive(payload)` → Promise; `postStop()` → Promise
- Consumes: existing `renderProbs`, `showSwapBanner`, `hideSwapBanner`

- [ ] **Step 1: Add module-level relay plumbing**

In `frontend/app.js`, after `renderProbs` (ends ~line 154), add:

```javascript
// ── Relay: page is a pure instrument driven by POST /drive, reflecting via
//    GET /events. Backend GEN_LOCK serializes generation, so exactly one
//    panel is "active" at a time — a single pointer set on drive_start. ──
const PANEL_TO_TAB = { basic: "1", advanced: "2", reasoning: "3", agent: "4" };
const TAB_TO_PANEL = { "1": "basic", "2": "advanced", "3": "reasoning", "4": "agent" };
const PANELS = {};   // tab id "1".."4" → render callbacks (registered in setup*)

// Switch the visible tab + panel by panel-name (HTML data-tab/data-panel value).
// Shared by the tab buttons AND drive_start (spec §3.6: drive_start → switch tab UI).
function activateTabUI(panelName) {
  document.querySelectorAll(".tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === panelName));
  document.querySelectorAll(".tab-panel").forEach((p) =>
    p.classList.toggle("active", p.dataset.panel === panelName));
}

// Returns the fetch Response (or null on network error) so callers can detect
// 409-busy and re-enable their Send button (no drive_start/final will arrive
// for a rejected drive). On 200 the response resolves AFTER generation, by
// which point final has already re-enabled — so the 409 branch is the only one
// that needs to act.
async function postDrive(payload) {
  try {
    const r = await fetch("/drive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.status === 409) console.warn("[drive] busy (409) — a generation is already running");
    return r;
  } catch (err) {
    console.error("[drive] failed", err);
    return null;
  }
}

async function postStop() {
  try { await fetch("/stop", { method: "POST", body: "{}" }); }
  catch (err) { console.error("[stop] failed", err); }
}

function connectEvents() {
  let active = null;   // the PANELS[tab] entry currently being driven
  const es = new EventSource("/events");
  es.onmessage = (e) => {
    let f;
    try { f = JSON.parse(e.data); } catch (_) { return; }
    switch (f.type) {
      case "swap_start":  showSwapBanner(f.model); break;
      case "drive_start":
        hideSwapBanner();
        if (TAB_TO_PANEL[f.tab]) activateTabUI(TAB_TO_PANEL[f.tab]);  // §3.6: bring the driven tab into view
        active = PANELS[f.tab] || null;
        active && active.onDriveStart && active.onDriveStart(f);
        break;
      case "token":          active && active.onToken && active.onToken(f); break;
      case "turn_complete":  active && active.onTurnComplete && active.onTurnComplete(f); break;
      case "final":          active && active.onFinal && active.onFinal(f); break;
      case "inspect":        active && active.onInspect && active.onInspect(f); break;
      case "error":          active && active.onError && active.onError(f); break;
    }
  };
  es.onerror = () => { /* EventSource auto-reconnects; banner stays as-is */ };
}
```

- [ ] **Step 2: Make tab switching UI-only (no /swap)**

Replace the whole tab-switching block (`document.querySelectorAll(".tab").forEach(...)`, ~lines 156-176) with:

```javascript
// ── Tab switching — UI only. The server swaps the model inside /drive;
//    the page reacts to the swap_start frame (banner). No /swap from here. ──
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => activateTabUI(btn.dataset.tab));
});
```

- [ ] **Step 3: Convert the basic-panel path in `setupPanel` to register + drive**

In `setupPanel`, the basic panel currently runs `runCompletion()` which fetches llama. Replace the basic-panel rendering+wiring. Specifically:

(a) Keep `renderProbs`, `appendClickableToken`, `highlightStep`, `tokenSteps`, `phase`, `buildFinalPrompt`, `refreshPreview` as they are — they are reused (`buildFinalPrompt`/`refreshPreview` still power the ②③ `final-prompt-preview`). Note: `nPredict` (line 222) is NOT reused — its only consumer was `runCompletion`, which this task deletes; the server now owns `n_predict`. It is removed in Task 4's dead-code sweep.

(b) Add these three callbacks inside `setupPanel` (after `highlightStep`, before `runCompletion`):

```javascript
  // ── Relay render callbacks (replace the old self-fetch runCompletion) ──
  let isThinkingMode = false;
  function beginRun(frame) {
    runBtn.disabled = true; stopBtn.disabled = false;
    textEl.textContent = ""; probsEl.innerHTML = "";
    tokenSteps = [];
    isThinkingMode = panelType === "reasoning" && frame.mode === "thinking";
    phase = isThinkingMode ? "pre_think" : "in_answer";
    if (thinkingContentEl) thinkingContentEl.textContent = "";
    if (thinkingArea) thinkingArea.classList.toggle("hidden", !isThinkingMode);
  }
  function onTokenStep(step) {
    const stepIdx = tokenSteps.length;
    tokenSteps.push({ token: step.token, top_logprobs: step.top_logprobs });
    const trim = step.token.replace(/[\s\n]/g, "");
    if (isThinkingMode) appendClickableToken(stepIdx, step.token, thinkingContentEl);
    if (isThinkingMode && trim === "<think>") phase = "in_think";
    else if (isThinkingMode && trim === "</think>") phase = "in_answer";
    else if (phase === "in_answer") appendClickableToken(stepIdx, step.token, textEl);
    if (stepIdx === 0) { renderProbs(probsEl, step.top_logprobs); highlightStep(0); }
  }
  function endRun() { runBtn.disabled = false; stopBtn.disabled = true; }
  function onInspect(frame) {
    const s = tokenSteps[frame.tokenIndex];
    if (!s) return;
    renderProbs(probsEl, s.top_logprobs);
    highlightStep(frame.tokenIndex);
  }
  function onError(frame) {
    textEl.textContent += `\n[error] ${frame.message}`;
    endRun();
  }

  // Register this panel so the global /events dispatcher can drive it.
  PANELS[PANEL_TO_TAB[panelType]] = {
    onDriveStart: beginRun,
    onToken: (f) => onTokenStep(f),
    onFinal: endRun,
    onInspect: onInspect,
    onError: onError,
  };

  function driveThisPanel() {
    if (!promptEl.value.trim()) return;
    runBtn.disabled = true;   // disable immediately to avoid double-fire 409
    const payload = { tab: PANEL_TO_TAB[panelType], user: promptEl.value };
    if (panelType === "advanced") {
      payload.system = systemEl?.value || "";
      payload.mode = panel.querySelector('input[name="mode-advanced"]:checked')?.value || "raw";
    } else if (panelType === "reasoning") {
      payload.mode = panel.querySelector('input[name="mode-reasoning"]:checked')?.value || "direct";
    }
    // Re-enable Send if the drive was rejected (409 busy) or failed — no
    // drive_start/final will arrive for it. On 200 final has already re-enabled.
    postDrive(payload).then((r) => { if (!r || r.status === 409) runBtn.disabled = false; });
  }
```

(c) Delete the entire old `runCompletion` function (the `async function runCompletion() { ... }` block, ~lines 254-366).

(d) Delete the entire preset-handler block in `setupPanel` (the `const presetEl = panel.querySelector(".preset-select"); if (presetEl) { ... }` block, ~lines 383-394) — wholesale, not just the declaration. The dropdown markup is removed in Task 4; leaving a half-block (declaration without body, or vice versa) is a ReferenceError.

(e) Replace the event wiring (`runBtn.addEventListener` / `stopBtn.addEventListener` / `promptEl keydown`, ~lines 369-381) with:

```javascript
  runBtn.addEventListener("click", driveThisPanel);
  stopBtn.addEventListener("click", () => {
    postStop();
    // Optimistic re-enable: clicking Stop should free Send immediately. (Tabs
    // ①②③ also get a final from the server on cancel, but Tab ④'s agent_loop
    // does not — see Task 3 note — so the client re-enables to avoid a stuck UI.)
    runBtn.disabled = false; stopBtn.disabled = true;
  });
  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      if (!promptEl.value.trim() || runBtn.disabled) return;
      driveThisPanel();
    }
  });
```

- [ ] **Step 4: Connect the relay on load; drop the load-time swap**

Replace the `window.addEventListener("DOMContentLoaded", ...)` block (~lines 698-705) with:

```javascript
// On load: subscribe to the relay. No model swap here — the server swaps
// inside the first /drive (page reacts to swap_start).
window.addEventListener("DOMContentLoaded", connectEvents);
```

- [ ] **Step 5: Verify Tab ① end-to-end via Playwright**

Start/refresh the server, then:
1. `mcp__playwright__browser_navigate` → `http://localhost:9000/index.zh-TW.html`
2. Click `① 基礎` tab.
3. Type `床前明月光,疑是地上` into the Prompt textbox, click `送出`.
4. `browser_wait_for` ~3s, then `browser_snapshot`.

Expected: "Model 吐的字" shows `霜。...`; "Token 候選 · top 10" shows `霜` at ~94.7%. (Rendered via /events, not a direct llama call.) Also drive from the AI side to prove symmetry: with the page open, run `curl -s -X POST localhost:9000/drive -d '{"tab":"1","user":"他打開冰箱,拿出"}' -H 'Content-Type: application/json'` and snapshot — the page must update to the new (flat) distribution without anyone clicking.

- [ ] **Step 6: Commit**

```bash
git add frontend/app.js
git commit -m "feat(frontend): relay plumbing + Tab 1 driven by /drive//events"
```

---

### Task 2: Tab ② (advanced) + Tab ③ (reasoning) via relay

`setupPanel` already handles all three panel types in one function; Task 1 wired the shared callbacks generically (using `panelType`). This task verifies ②③ work and removes the now-dead direct-preview/llama assumptions specific to them.

**Files:**
- Modify: `frontend/app.js` (the advanced/reasoning preview wiring already calls `refreshPreview`, which is local string-building — unaffected; verify mode + thinking phase machine over relay)

**Interfaces:**
- Consumes: Task 1's `PANELS`, `postDrive`, `connectEvents`, and the generic `driveThisPanel`/`beginRun`/`onTokenStep` (already mode-aware from Task 1)

- [ ] **Step 1: Confirm the mode + thinking plumbing is present**

Re-read `setupPanel` in `frontend/app.js`. Verify (from Task 1):
- `driveThisPanel` sends `mode` for advanced (`raw|chat`) and reasoning (`direct|thinking`).
- `beginRun` sets `isThinkingMode` from `frame.mode === "thinking"` for the reasoning panel.
- `onTokenStep` runs the `<think>`/`</think>` phase machine when `isThinkingMode`.

If any is missing, add it per Task 1 Step 3(b). (No new code expected if Task 1 was complete — this step is the gate that ②③ are actually covered.)

- [ ] **Step 2: Verify Tab ② raw vs chat via Playwright**

With the page open (`index.zh-TW.html`):
1. Click `② 產品層加工`.
2. Type system `你是行銷顧問,用條列式回答,只給 3 點`, user `一年有幾個月?`.
3. Select the `產品加工(Qwen3 chat template)` radio, click `送出`, wait ~3s, snapshot.
   Expected: "Model 吐的字" is a tidy list, e.g. `1. 一年有12个月。`.
4. Select the `裸 prompt(completion mode)` radio, click `送出`, wait ~3s, snapshot.
   Expected: rambling/repetitive continuation (no template applied) — visibly different from step 3.

- [ ] **Step 3: Verify Tab ③ thinking via Playwright**

1. Click `③ 推理`.
2. Type user `3個蘋果吃掉1個剩幾個?`.
3. Select the `thinking` radio (`name="mode-reasoning"` value `thinking`), click `送出`, wait ~6s, snapshot.
   Expected: the thinking area becomes visible and fills with tokens; the final-answer area populates after `</think>`. (The 1500 n_predict lives server-side, so thinking completes.)
4. Also drive Tab ③ from the AI side: `curl -s -X POST localhost:9000/drive -d '{"tab":"3","user":"3個蘋果吃掉1個剩幾個?","mode":"direct"}' -H 'Content-Type: application/json'` → snapshot shows a direct answer with no thinking area.

- [ ] **Step 4: Commit**

```bash
git add frontend/app.js
git commit -m "verify(frontend): Tab 2/3 advanced+reasoning driven via relay"
```

(If Step 1 required code additions, include them in this commit; otherwise this commit may be a no-op verification — in that case skip it and note ②③ were already covered by Task 1.)

---

### Task 3: Tab ④ (agent) via relay

**Files:**
- Modify: `frontend/app.js` (`setupAgent`: register turn/final callbacks, drive via `/drive`, drop the direct `/agent` fetch)

**Interfaces:**
- Consumes: Task 1's `PANELS`, `postDrive`, `postStop`
- The server's tab-4 `/events` frames mirror `agent_loop`: `{type:"turn_complete", turn, message_tokens, tool_calls, tool_results, received_chunk, next_prompt}` and `{type:"final", content}` and `{type:"error", message}`.

- [ ] **Step 1: Register agent callbacks + drive via /drive**

In `setupAgent`, keep `renderTurnBlock`, `renderFinal`, `renderError`, `clearAll`, `refreshPreview`, and the `TW` styles (all reused). Make these changes:

(a) After `renderError` (ends ~line 623), add registration + driver:

```javascript
  // ── Relay: register so the global /events dispatcher drives this panel ──
  function beginRun() {
    clearAll();
    runBtn.disabled = true; stopBtn.disabled = false;
  }
  function endRun() { runBtn.disabled = false; stopBtn.disabled = true; }
  PANELS["4"] = {
    onDriveStart: beginRun,
    onTurnComplete: (f) =>
      renderTurnBlock(f.turn, f.message_tokens, f.tool_calls, f.tool_results, f.received_chunk, f.next_prompt),
    onFinal: (f) => { renderFinal(f.content); endRun(); },
    onError: (f) => { renderError(f.message); endRun(); },
  };

  function driveAgent() {
    if (!promptEl.value.trim()) return;
    runBtn.disabled = true;   // immediate, avoid double-fire 409
    postDrive({ tab: "4", user: promptEl.value, system: systemEl.value })
      .then((r) => { if (!r || r.status === 409) runBtn.disabled = false; });
  }
```

(b) Delete the entire old `runAgent` function (`async function runAgent() { ... }`, ~lines 625-681).

(c) Replace the preset handler + run/stop wiring (~lines 683-695) with:

```javascript
  runBtn.addEventListener("click", driveAgent);
  stopBtn.addEventListener("click", () => {
    postStop();
    // Tab ④ backend (agent_loop) breaks on CANCEL without emitting a final, so
    // no onFinal fires — re-enable Send here to avoid a stuck button.
    runBtn.disabled = false; stopBtn.disabled = true;
  });
```

> **Backend note (RESOLVED 2026-07-05, commit pending):** an AI-triggered `/stop` during a Tab ④ run previously left Send disabled because `drive()`'s tab-4 branch broke on `CANCEL` without publishing a `final`/`error`. Fixed in `docs/superpowers/plans/2026-07-05-drive-tab4-cancel-final.md`: `drive()` now publishes a terminal `{type:"final",content:""}` on cancel, so the page's `onFinal` re-enables Send even for an AI-side stop. The optimistic client-side re-enable below is now belt-and-suspenders, not load-bearing.

(The `presetEl` handler is removed; `presetEl` itself becomes unused — its markup is deleted in Task 4. Leave the `const presetEl = panel.querySelector(".preset-select");` line for now OR delete it; if you delete it, also delete the unused `const previewEl`-adjacent lookups only if truly unused. Safest: delete the `presetEl` declaration since nothing references it after removing the handler.)

- [ ] **Step 2: Verify Tab ④ via Playwright (swap + tool call)**

1. Click `④ Agent`. (No swap yet — swap happens on drive.)
2. Type user `現在幾點?`, click `送出`.
3. `browser_wait_for` ~10s (0.6B→4B swap + tool call), snapshot.

Expected: a `swap_start` banner appears first ("載入 4B 中…" via the existing banner), then a Turn 1 block with a purple `↑ 工具呼叫 get_time({})` and a green `↓ 工具結果`, then a final answer like `現在是 HH:MM:SS`.

- [ ] **Step 3: Commit**

```bash
git add frontend/app.js
git commit -m "feat(frontend): Tab 4 agent driven via /drive//events"
```

---

### Task 4: Pure-instrument HTML — remove presets, (?) explainers, prose; dead-code sweep; cache-bust

**Files:**
- Modify: `frontend/index.html`, `frontend/index.zh-TW.html` (remove `.preset-select` on ①②③, `(?)` `<details>` + always-on prose on interactive tabs ①②③④; bump `?v=NN`)
- Modify: `frontend/app.js` (delete now-dead `LLAMA_URL`, `AGENT_BACKEND_URL`, `SWAP_URL`/`TAB_TO_MODEL`/`ensureModel`/`currentLLMModel` if fully unused, leftover `presetEl` lookups)

**Interfaces:** none produced; this is removal + cache-bust.

- [ ] **Step 1: Remove the preset dropdowns (①②③) in both HTML files**

In `frontend/index.html` AND `frontend/index.zh-TW.html`, delete the three `.preset-row` blocks that contain `.preset-select` for the basic/advanced/reasoning panels (the `<div class="preset-row">…<select class="preset-select">…</select></div>` blocks). Leave the Tab ⑥ `.skill-preset` block ALONE. Verify after: `grep -c 'class="preset-select"' frontend/index.html` returns `0`; `grep -c 'skill-preset' frontend/index.html` returns `1`.

- [ ] **Step 2: Remove the (?) explainers + always-on prose on interactive tabs**

In both HTML files, within the `data-panel="basic"`, `data-panel="advanced"`, `data-panel="reasoning"`, and `data-panel="agent"` panels only, delete:
- every `<details class="info-tag">…</details>` block — these ARE the `(?)` explainers (6 of them in index.html, lines ~129/154/168/254/298/333; same in `.zh-TW`), and
- always-on descriptive `<p>` prose that duplicates what the AI narrates.

**Keep — do NOT delete:**
- `<details class="preview-details …">` (the `final-prompt-preview`, lines ~222/266/319) — it shows the chat-template text, which is instrument data, not narration.
- the input fields (`.prompt`, `.system-prompt`), mode radios (`name="mode-advanced"`/`name="mode-reasoning"`), output areas (`.generated-text`, `.probs`, `.thinking-area`, `.thinking-content`, `.turns`, `.final-content`), Send/Stop buttons.
- article tabs ⓪⑤⑦⑧ and Tab ⑥ skill — untouched entirely.

Verify after: `grep -c 'class="info-tag"' frontend/index.html` returns `0`; `grep -c 'preview-details' frontend/index.html` still returns `3`. Spot-check app.js's queried classes still exist: `grep -o 'thinking-area\|final-prompt-preview\|mode-reasoning' frontend/index.html` all present.

> Decision point (spec §5 D6, reversible): this removes ALL `(?)`/prose on interactive tabs. If the user wants the collapsed `(?)` kept, skip the `(?)` deletions and remove only always-on prose. Default per spec: remove both.

- [ ] **Step 3: Delete now-dead JS**

In `frontend/app.js`, delete these — each is unreferenced after Tasks 1–3:
- `const LLAMA_URL = ...;` (was only used by the deleted `runCompletion`)
- `const AGENT_BACKEND_URL = "/agent";` (was only used by the deleted `runAgent`)
- The swap machinery used only by the old tab-switch/load: `const SWAP_URL`, `const TAB_TO_MODEL`, `let currentLLMModel`, and `async function ensureModel(...)`. **Keep** `showSwapBanner`/`hideSwapBanner` (still used by `connectEvents`).
- `const nPredict = panelType === "reasoning" ? 1500 : 80;` in `setupPanel` (line ~222) — dead after `runCompletion` is gone (server owns `n_predict`).
- The dead `let abortCtl = null;` in `setupPanel` (line ~192) and in `setupAgent` (line ~458) — both fetch paths that used them are deleted, and Stop now calls `postStop`. **Do NOT touch** the `let abortCtl = null;` in `setupSkill` (line ~741) — Tab ⑥ is out of scope and still uses it.

(The `setupPanel` and `setupAgent` preset-handler blocks were already deleted in Tasks 1 and 3 respectively — nothing to remove here.)

Verify after: `grep -n 'LLAMA_URL\|AGENT_BACKEND_URL\|ensureModel\|TAB_TO_MODEL\|preset-select\|nPredict' frontend/app.js` returns nothing; `grep -c 'abortCtl' frontend/app.js` returns only the `setupSkill` occurrences (the `let` decl + its uses in skill `run`/stop).

- [ ] **Step 4: Bump cache-bust in both HTML files**

Find the `app.js?v=NN` reference in each HTML file and increment `NN` (same new number in both). Verify: `grep -o 'app.js?v=[0-9]*' frontend/index.html frontend/index.zh-TW.html` shows the same bumped version in both.

- [ ] **Step 5: Verify the stripped page still drives via Playwright**

1. `browser_navigate` → `http://localhost:9000/index.zh-TW.html` (hard reload picks up new cache-bust).
2. Snapshot Tab ①: confirm NO preset dropdown, NO `(?)` blocks, input + 送出 present.
3. Type `床前明月光,疑是地上`, 送出, wait, snapshot → `霜` 94.7% still renders.
4. Confirm Tab ⑥ Skill still has its preset and still works (click ⑥, snapshot shows `.skill-preset`).

- [ ] **Step 6: Commit**

```bash
git add frontend/app.js frontend/index.html frontend/index.zh-TW.html
git commit -m "feat(frontend): pure instrument — remove presets/(?)/prose, drop dead JS, bump cache-bust"
```

---

### Task 5: Full relay sweep + AI-driven parity

End-to-end verification that the page is a pure instrument driven by the AI, across all four tabs, matching the throwaway-demo behavior on the real page.

**Files:** verify only.

- [ ] **Step 1: AI drives all four tabs; page reflects with no clicks**

With `index.zh-TW.html` open in the Playwright browser and the server up, run each `curl` and snapshot the page after each (the page must update although nobody clicks):

```bash
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d '{"tab":"1","user":"床前明月光,疑是地上"}'
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d '{"tab":"2","user":"一年有幾個月?","system":"你是行銷顧問,用條列式回答,只給3點","mode":"chat"}'
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d '{"tab":"3","user":"3個蘋果吃掉1個剩幾個?","mode":"thinking"}'
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d '{"tab":"4","user":"現在幾點?"}'
```

Expected: each snapshot shows the page **switch to the driven tab** and render it (the `drive_start` handler calls `activateTabUI(TAB_TO_PANEL[f.tab])` per spec §3.6 — so driving tab 3 while viewing tab 1 brings tab 3 into view, the "AI drives → student watches" loop). For tab 4, the `swap_start` banner shows during the swap.

- [ ] **Step 2: Verify `/inspect` and `/stop` from the AI side**

1. Drive tab 1, then `curl -s -X POST localhost:9000/inspect -d '{"tokenIndex":0}'` → snapshot shows the first token's probability chart highlighted.
2. Drive tab 3 thinking, then immediately `curl -s -X POST localhost:9000/stop -d '{}'` → generation halts (token stream stops growing).

- [ ] **Step 3: Confirm no regressions**

- `curl -s localhost:9000/health` returns immediately.
- Tab ⑥ Skill still works (click ⑥ in the browser, run its preset, confirm the skill trace renders) — proves the out-of-scope path is untouched.
- Browser console has no uncaught errors during the sweep (`mcp__playwright__browser_console_messages`).

- [ ] **Step 4: Commit (if any verification-driven fixes were needed)**

```bash
git add -A
git commit -m "verify(frontend): full relay sweep — AI drives all tabs, page reflects"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-28-ai-teaching-relay-design.md` §4–5):
- §4.1 global `/events` subscriber → per-panel render registry → Task 1 (`PANELS`, `connectEvents`, active-pointer on `drive_start`). ✓
- §4.2 `runCompletion`/`runAgent` relocate into `/events` handler; `LLAMA_URL` removed → Task 1 (basic), Task 2 (adv/reasoning share the path), Task 3 (agent), Task 4 (delete `LLAMA_URL`/`AGENT_BACKEND_URL`). ✓
- §4.3 tab switch UI-only (no `/swap`); remove ①②③ preset dropdowns + handlers; Send/Stop → `/drive`//stop`; keep `renderProbs` → Task 1 (tab-switch, basic), Task 3 (agent preset handler), Task 4 (HTML preset removal). ✓
- §3.6 frame handling incl. `swap_start` banner, `drive_start` disables Send, `final` re-enables, `inspect`, `error` → Task 1 (`connectEvents` + callbacks). ✓
- §5 remove `(?)`/prose on interactive tabs (reversible), keep article tabs → Task 4 Step 2. ✓
- §5 preset strings migrate to lessons → out of scope here (teaching plan); the dropdowns are removed, strings live in lessons already. Noted.
- Tab ⑥ skill untouched → enforced in Global Constraints + Task 4 Step 1/Step 5 checks. ✓
- bump cache-bust both HTML → Task 4 Step 4. ✓

**2. Placeholder scan:** every code step shows the actual code to add/replace/delete; every verification step is a concrete Playwright/curl recipe with an expected result. The one judgment call (`(?)` keep-vs-remove) is flagged with the spec default. No TBD/TODO. ✓

**3. Type/name consistency:** `PANELS` keyed by `"1".."4"`; `PANEL_TO_TAB` maps panel→same ids; callbacks named `onDriveStart`/`onToken`/`onTurnComplete`/`onFinal`/`onInspect`/`onError` are registered identically in Task 1 (basic), Task 1-generic (adv/reasoning), Task 3 (agent) and dispatched by exactly those names in `connectEvents`. `postDrive`/`postStop` signatures match call sites. `beginRun`/`onTokenStep`/`endRun` are closure-local per panel — no cross-panel name clash. ✓

---

## Notes for the implementer

- **The "biggest unknown" (spec §4.1) is Task 1.** Once `connectEvents` + `PANELS` + the basic panel work end-to-end, ②③④ are the same pattern. Do not proceed past Task 1 until Step 5 passes.
- **Symmetry check matters:** the page's own Send button and an AI `curl /drive` go through the identical path — both should render identically. Test both in Task 1.
- **Subagent verification:** an implementer subagent can drive Playwright MCP itself (navigate/click/snapshot) if granted the tools; otherwise the controller runs the Playwright verification at each task gate. Either way, the server must be running.
- **Follow-on (not this plan):** onboarding teardown (init.py `/health` + remove MCP config, spec §6) and teaching materials (lessons ×2 + Playwright layer-2 smoke, spec §8).
