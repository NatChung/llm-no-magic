# Lesson-bridging carry-over + Tab 3 probs removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lessons ①→②→③→④ feel like one continuous line — each lesson opens with the previous lesson's closing prompt (UI auto-carries it across the tab boundary) — and strip the token-candidates panel from Tab 3.

**Architecture:** Frontend-only behavior + content. A module-level `lastPrompt` in `app.js` is updated on any interactive prompt edit / drive reflection, and copied into a tab's `.prompt` field when the user clicks that tab. Tab 3's `.probs-area` is deleted and the panel reflows single-column. Lesson docs gain closing/opening bridge beats. No backend change.

**Tech Stack:** Zero-build vanilla JS + Tailwind Play CDN, stdlib Python server (untouched here), markdown lesson playbooks.

## Global Constraints

- **Bilingual:** every user-facing change lands in BOTH the EN file and the zh-TW file (`index.html`/`index.zh-TW.html`, `lesson-*-*.md`/`lesson-*-*.zh-TW.md`).
- **Cache-bust:** bump the `app.js?v=NN` query in BOTH HTML files whenever `app.js` changes. Current value: `v=65` → next change uses `v=66`.
- **Backend untouched:** `pytest agent/tests -q` must stay at 93 passed.
- **Server + browser for live checks:** server runs at `http://localhost:9000/`; a driven browser tab must be subscribed (`GET /health` → `subscribers >= 1`). Drive via `POST /drive`.
- **Follow existing patterns:** OKLCH colors, Tailwind utility classes, the `.tok` / `.tok-static` token conventions already in `styles.css`.
- **Verified bridge prompts (0.6B, do not change without re-verifying):** ①→② `一年有幾個月?`; ②→③ `爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?`; ③→④ `現在幾點?`.

---

### Task 1: Remove the token-candidates panel from Tab 3 (推理)

Self-contained frontend change: delete Tab 3's probs panel, reflow it single-column, and make its tokens non-interactive. Independently reviewable and testable before any carry-over work.

**Files:**
- Modify: `frontend/index.zh-TW.html` (reasoning panel `133-166`)
- Modify: `frontend/index.html` (reasoning panel, English mirror)
- Modify: `frontend/styles.css:13-27` (desktop 2-col grid rule)
- Modify: `frontend/app.js` (`setupPanel`: `probsEl` guards + reasoning token static)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a reasoning panel with no `.probs`/`.probs-area`; `setupPanel` must tolerate `probsEl === null`. Task 2 will add carry-over that dispatches synthetic `input` events on `.prompt` fields including reasoning's — this task leaves `.prompt` and its preview listener intact.

- [ ] **Step 1: Remove `.probs-area` + fix grid utility classes in `index.zh-TW.html`**

In the reasoning panel (`data-panel="reasoning"`): delete the entire `.probs-area` `<section>` (the `Token 候選 · top 10` block, currently lines 162-165). Then on the two remaining children fix the grid-only classes:
- `.prompt-area`: change `class="prompt-area lg:col-span-2 space-y-3"` → `class="prompt-area space-y-3"` (drop `lg:col-span-2`).
- middle wrapper: change `class="mt-8 lg:mt-0 space-y-6"` → `class="mt-8 space-y-6"` (drop `lg:mt-0` so the desktop top margin survives single-column).

- [ ] **Step 2: Mirror the same three edits in `index.html`** (English reasoning panel — same classes, English `Token candidates · top 10` section is the one to delete).

- [ ] **Step 3: Remove `reasoning` from the 2-col grid rule in `styles.css`**

Change the selector block at `styles.css:13-27` from:

```css
  .tab-panel.active[data-panel="basic"],
  .tab-panel.active[data-panel="advanced"],
  .tab-panel.active[data-panel="reasoning"] {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.75rem;
    row-gap: 2rem;
  }
  .tab-panel.active[data-panel="basic"] > .prompt-area,
  .tab-panel.active[data-panel="advanced"] > .prompt-area,
  .tab-panel.active[data-panel="reasoning"] > .prompt-area {
    grid-column: 1 / -1;
  }
```

to (drop both `reasoning` lines):

```css
  .tab-panel.active[data-panel="basic"],
  .tab-panel.active[data-panel="advanced"] {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.75rem;
    row-gap: 2rem;
  }
  .tab-panel.active[data-panel="basic"] > .prompt-area,
  .tab-panel.active[data-panel="advanced"] > .prompt-area {
    grid-column: 1 / -1;
  }
```

- [ ] **Step 4: Guard `probsEl` and make reasoning tokens static in `app.js`**

In `setupPanel` (`frontend/app.js`), `probsEl` comes from `panel.querySelector(".probs")` (line ~202) and is now `null` for reasoning. Make the render paths null-safe and stop reasoning tokens from being clickable:

- In `onTokenStep`, the step-0 render `if (stepIdx === 0) { renderProbs(probsEl, step.top_logprobs); highlightStep(0); }` → guard: `if (probsEl && stepIdx === 0) { renderProbs(probsEl, step.top_logprobs); highlightStep(0); }`.
- In `onInspect`, wrap the `renderProbs(probsEl, s.top_logprobs); highlightStep(...)` calls in `if (probsEl) { ... }`.
- Rewrite `appendClickableToken` (currently `app.js:236-249`) so the class and click wiring are BOTH gated on `probsEl` — do not leave the unconditional `span.className = "tok"` at line 238. Replace the whole function body:

  ```js
  function appendClickableToken(stepIdx, token, target) {
    const span = document.createElement("span");
    span.dataset.step = String(stepIdx);
    span.textContent = token;
    if (probsEl) {
      span.className = "tok";
      span.title = t('tok_title', {n: stepIdx + 1});
      span.addEventListener("click", () => {
        const s = tokenSteps[stepIdx];
        if (!s) return;
        renderProbs(probsEl, s.top_logprobs);
        highlightStep(stepIdx);
      });
    } else {
      span.className = "tok tok-static";   // reasoning: no probs panel to pop
    }
    (target || textEl).appendChild(span);
  }
  ```
  `highlightStep` still queries `.tok` (line ~254), so `tok-static` tokens remain harmless there (they're never clicked, never highlighted).

- [ ] **Step 5: Bump the cache-bust in both HTML files**

Change `app.js?v=65` → `app.js?v=66` in `index.html` and `index.zh-TW.html`.

- [ ] **Step 6: Verify — backend tests still green**

Run: `cd /Users/natchung/projects/public-llm-no-magic && python3 -m pytest agent/tests -q`
Expected: `93 passed`

- [ ] **Step 7: Verify — Tab 3 renders single-column, no probs, tokens static, generation works**

**First hard-reload the driven browser tab** (the `?v=66` cache-bust changed `app.js`; without a reload the eval runs against stale JS and gives a false result). With the server up and a subscribed browser tab, drive Tab 3 and inspect via playwright/eval:

```bash
curl -s -X POST http://localhost:9000/drive -H 'Content-Type: application/json' \
  -d '{"tab":"3","user":"爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?","mode":"thinking"}' -o /dev/null -w "%{http_code}\n"
```
Expected: `200`. Then in the browser (playwright `browser_evaluate`):
```js
() => { const p = document.querySelector('[data-panel="reasoning"]');
  return { hasProbs: !!p.querySelector('.probs'),
           thinking: p.querySelector('.thinking-content').textContent.slice(0,40),
           finalAnswer: p.querySelector('.generated-text').textContent.slice(0,40),
           firstTokStatic: p.querySelector('.generated-text .tok')?.classList.contains('tok-static') ?? 'no-tok' }; }
```
Expected: `hasProbs:false`, `thinking` and `finalAnswer` non-empty, `firstTokStatic:true` (or `no-tok`). Also confirm no new console errors (`preview_console_logs` / playwright console: only the pre-existing favicon-404 + Tailwind-CDN warning).

- [ ] **Step 8: Commit**

```bash
git add frontend/index.html frontend/index.zh-TW.html frontend/styles.css frontend/app.js
git commit -m "feat(tab3): remove token-candidates panel, reflow single-column"
```

---

### Task 2: UI prompt carry-over across interactive tabs

Add the `lastPrompt` carry so clicking into tabs 1–4 overwrites the destination `.prompt` with the last-used prompt. Independently reviewable: it's a self-contained block plus two one-line reflection hooks.

**Files:**
- Modify: `frontend/app.js` (add `lastPrompt` + `carryPromptInto`; wire tab-button clicks; add reflection updates in `setupPanel.onDriveStart` and `setupAgent.beginRun`)
- Modify: `frontend/index.html`, `frontend/index.zh-TW.html` (cache-bust bump only)

**Interfaces:**
- Consumes: `PANEL_TO_TAB` (`app.js:109`), `activateTabUI` (`app.js:115`), the tab-button click loop (`app.js:192-194`). Task 1's reasoning panel still has a `.prompt`.
- Produces: module-level `let lastPrompt` and `function carryPromptInto(panelName)`. No later task depends on these.

- [ ] **Step 1: Add `lastPrompt` state + a global input listener + `carryPromptInto`**

In `app.js`, just after `activateTabUI` (around line 120), add:

```js
// ── Lesson bridge: carry the last-used prompt across tab switches ──
// lastPrompt tracks the most recently edited/driven interactive prompt.
// On a user tab click it is copied into the destination tab's .prompt so
// each lesson opens where the previous one closed. Only interactive tabs
// 1-4 have a .prompt; skill (.skill-prompt) and mcp (no prompt) are skipped.
let lastPrompt = "";
document.querySelectorAll('[data-panel] .prompt').forEach((el) =>
  el.addEventListener("input", () => { lastPrompt = el.value; }));

function carryPromptInto(panelName) {
  if (!PANEL_TO_TAB[panelName] || !lastPrompt) return;   // interactive tabs only
  const el = document.querySelector(`.tab-panel[data-panel="${panelName}"] .prompt`);
  if (!el) return;
  el.value = lastPrompt;
  el.dispatchEvent(new Event("input", { bubbles: true }));  // refresh preview (advanced/reasoning)
}
```

- [ ] **Step 2: Wire carry into the tab-button click handler only**

Change the tab-button loop (`app.js:192-194`) from:

```js
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => activateTabUI(btn.dataset.tab));
});
```

to:

```js
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    activateTabUI(btn.dataset.tab);
    carryPromptInto(btn.dataset.tab);
  });
});
```

Leave the `drive_start` path (`app.js:165`, which also calls `activateTabUI`) untouched — `onDriveStart` fills `frame.user` there.

- [ ] **Step 3: Keep `lastPrompt` in sync on driven prompts (basic/advanced/reasoning)**

In `setupPanel`'s drive-start reflection (currently `if (frame.user != null) promptEl.value = frame.user;`, ~line 271), append the sync:

```js
    if (frame.user != null) { promptEl.value = frame.user; lastPrompt = frame.user; }
```

- [ ] **Step 4: Keep `lastPrompt` in sync on driven prompts (agent)**

In `setupAgent`'s `beginRun` (currently `if (frame && frame.user != null) promptEl.value = frame.user;`, ~line 575), change to:

```js
    if (frame && frame.user != null) { promptEl.value = frame.user; lastPrompt = frame.user; }
```

- [ ] **Step 5: Bump the cache-bust in both HTML files**

Change `app.js?v=66` → `app.js?v=67` in `index.html` and `index.zh-TW.html`.

- [ ] **Step 6: Verify — carry-over works by hand-clicking tabs**

**First hard-reload the driven browser tab** (the `?v=67` cache-bust changed `app.js`; a stale tab would run the old JS with no carry-over and fail this check for the wrong reason). Server up + subscribed browser tab. In the browser (playwright `browser_evaluate`), simulate the bridge: type on Tab 1, click Tab 2, assert it carried:

```js
() => {
  const t1 = document.querySelector('[data-panel="basic"] .prompt');
  t1.value = '一年有幾個月?'; t1.dispatchEvent(new Event('input', {bubbles:true}));
  document.querySelector('.tab[data-tab="advanced"]').click();
  const t2 = document.querySelector('[data-panel="advanced"] .prompt').value;
  document.querySelector('.tab[data-tab="reasoning"]').click();
  const t3 = document.querySelector('[data-panel="reasoning"] .prompt').value;
  return { t2, t3 };
}
```
Expected: `t2 === '一年有幾個月?'` and `t3 === '一年有幾個月?'` (overwrites the apple default). Confirm no console errors.

- [ ] **Step 7: Verify — driving still fills its own prompt (no regression)**

```bash
curl -s -X POST http://localhost:9000/drive -H 'Content-Type: application/json' \
  -d '{"tab":"2","user":"一年有幾個月?","mode":"chat"}' -o /dev/null -w "%{http_code}\n"
```
Expected `200`; then eval that `[data-panel="advanced"] .generated-text` is non-empty and the advanced `.prompt` shows `一年有幾個月?`. Run `python3 -m pytest agent/tests -q` → `93 passed`.

- [ ] **Step 8: Commit**

```bash
git add frontend/app.js frontend/index.html frontend/index.zh-TW.html
git commit -m "feat(frontend): carry last prompt across tab switches (lesson bridges)"
```

---

### Task 3: Lesson bridge narration (playbook rewrites)

Add the closing/opening bridge beats to the four interactive lessons, both languages. Pure content; verified against the bridge table.

**Files:**
- Modify: `teaching/lesson-1-basics.md`, `teaching/lesson-1-basics.zh-TW.md`
- Modify: `teaching/lesson-2-product.md`, `teaching/lesson-2-product.zh-TW.md`
- Modify: `teaching/lesson-3-reasoning.md`, `teaching/lesson-3-reasoning.zh-TW.md`
- Modify: `teaching/lesson-4-agent.md`, `teaching/lesson-4-agent.zh-TW.md`

**Interfaces:**
- Consumes: the carry-over behavior from Task 2 (the docs tell the AI the prompt auto-carries on tab switch) and the verified failure beats from the spec.
- Produces: nothing code depends on.

- [ ] **Step 1: Lesson 1 — add a closing bridge beat (both langs)**

In `lesson-1-basics.zh-TW.md`, at the end of the "揭曉與回顧" section (before or replacing the next-lesson teaser), add a closing beat: drive Tab 1 with `一年有幾個月?` → show it never answers, just chains/loops; then say "記住這句 — 下一課同一句會跟著你到下一個分頁". Keep the existing "為什麼 ChatGPT 看起來像在回答" teaser. Mirror in `lesson-1-basics.md` (English).

- [ ] **Step 2: Lesson 2 — reference the carried prompt on open; add a closing bridge beat (both langs)**

In `lesson-2-product.zh-TW.md`: in 段落 1's set-up, note the prompt is the SAME `一年有幾個月?` carried over from Lesson 1's close (auto-filled on the tab switch) — "同一句、切過來一樣跳針". At the end (揭曉與回顧), add a closing beat: drive Tab 2 chat mode with `爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?` → it now *answers* but muddles the algebra and gets it wrong (heading to 兒子=1, correct is 5) → tee up Lesson 3 ("它會回答了,但答對了嗎?"). Mirror in English.

- [ ] **Step 3: Lesson 3 — reference the carried apple problem on open; add a closing bridge beat (both langs)**

In `lesson-3-reasoning.zh-TW.md`: in 段落 1's set-up, note the apple problem is carried from Lesson 2's close. At the end (揭曉與回顧), add a closing beat: drive Tab 3 thinking mode with `現在幾點?` → the model reasons it out but admits it has no clock and invents/assumes a time → tee up Lesson 4 ("連 thinking 都問不出真實時間 — 它需要一個工具"). Mirror in English.

- [ ] **Step 4: Lesson 4 — reference the carried `現在幾點?` on open (both langs)**

In `lesson-4-agent.zh-TW.md`: in the opening / first demo (the `get_time` preset), note that `現在幾點?` is carried from Lesson 3's close, and that on this tab it really calls `get_time` and gets the real time — the payoff of the bridge. Mirror in English. (Lesson 4 is the last interactive lesson; no further closing bridge.)

- [ ] **Step 5: Verify — bridge prompts consistent across all lessons**

```bash
cd /Users/natchung/projects/public-llm-no-magic
grep -rn "一年有幾個月\|爸爸有3顆蘋果\|現在幾點" teaching/lesson-*.md
```
Expected: `一年有幾個月?` appears in lesson-1 (close) and lesson-2 (open); the apple problem in lesson-2 (close) and lesson-3 (open); `現在幾點?` in lesson-3 (close) and lesson-4 (open) — each verbatim, both language files. Read the four zh-TW lessons end-to-end and confirm each open references the prior close and each close tees up the next.

- [ ] **Step 6: Commit**

```bash
git add teaching/lesson-1-basics.md teaching/lesson-1-basics.zh-TW.md \
  teaching/lesson-2-product.md teaching/lesson-2-product.zh-TW.md \
  teaching/lesson-3-reasoning.md teaching/lesson-3-reasoning.zh-TW.md \
  teaching/lesson-4-agent.md teaching/lesson-4-agent.zh-TW.md
git commit -m "docs(lessons): add cross-lesson bridge beats (chain ①→②→③→④)"
```

---

## Self-Review

**Spec coverage:**
- A. Lesson bridges — UI carry-over → Task 2; lesson-doc rewrites → Task 3. ✓
- B. Tab 3 probs removal — HTML/styles/app.js/demo → Task 1 (demo_tab3 confirmed no-op). ✓
- Bridge prompts + verified failure beats → carried into Task 3 steps + Global Constraints. ✓
- Cache-bust discipline → Global Constraints + explicit bump steps (v65→66 in Task 1, 66→67 in Task 2). ✓

**Placeholder scan:** No TBD/TODO; every code step shows the exact before/after. The `NN` in "Global Constraints" is immediately pinned to concrete values (66, 67) in the task steps.

**Type/name consistency:** `lastPrompt`, `carryPromptInto`, `PANEL_TO_TAB`, `activateTabUI`, `probsEl`, `.tok-static` used identically across tasks and match the code verified in the spec review.

**Ordering:** Task 1 (probs removal) and Task 2 (carry-over) both touch `app.js` but different regions (setupPanel probs guards vs. module-level carry + reflection hooks); doing 1 then 2 keeps cache-bust bumps monotonic (66 then 67). Task 3 is content-only and can follow either.
