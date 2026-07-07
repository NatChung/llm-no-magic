# Lesson-bridging via prompt carry-over + Tab 3 probs removal — design

> Date: 2026-07-07 · Status: approved, ready for implementation plan

## Problem

The four interactive lessons (① 接龍 / ② 問答 / ③ 推理 / ④ 代理) currently read as
four disconnected demos. A learner finishes one tab and starts the next with no thread
tying them together. We want each lesson to **open where the previous one closed** — the
same prompt carried across the tab boundary — so the learner sees "same input, same
failure" on the new tab, then watches the new tab's feature fix it. This makes each lesson
feel like it exists to patch the hole the previous one exposed.

Separately, Tab ③ 推理 no longer needs the token-candidates (probability) panel: its focus
is "thinking is reasoning written as tokens," not per-token probability. The panel is a
distraction there.

## Scope

Two independent changes shipped together:

- **A. Lesson bridges** — teaching-playbook rewrites (lesson docs) + a UI prompt carry-over
  behavior (app.js).
- **B. Tab 3 probs removal** — frontend (HTML + app.js + styles.css) + demo script check.

Non-goals: no change to lessons 5 (Skill) / 6 (MCP); no change to the generation backend;
no new backend endpoints.

## A. Lesson bridges

### The three bridge prompts

Each bridge is the previous lesson's closing prompt, carried into the next lesson's opening
tab. The pattern is always: **new tab first shows the same text and the same failure, then
this lesson's feature resolves it.**

**The failure beats are live-verified (0.6B, 2026-07-07):**
- ①→② `一年有幾個月?` raw → chaining loop (verified earlier this session).
- ②→③ apple problem on Tab 2 chat mode → muddled *wrong* algebra (lets 兒子=x, 爸爸=x+2=3,
  heading to 兒子=1; correct is 5), runs out at the 80-token cap. Consistent with the existing
  Lesson 3 "直答常錯" behavior — the bridge holds ("answers, but wrong").
- ③→④ `現在幾點?` on Tab 3 thinking → the model visibly reasons *"I don't have a physical
  clock here… how do I know the current time?"* and invents/assumes one. Strongest of the
  three; directly motivates Lesson 4's `get_time` tool.

| Transition | Bridge prompt | Previous lesson closes with | Next lesson opens with |
|---|---|---|---|
| ①→② | `一年有幾個月?` | Tab 1: drive → chaining loop, never answers | Tab 2 raw → same loop; flip to 產品加工 → answers |
| ②→③ | `爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?` | Tab 2 產品加工 → answers, but **wrong** | Tab 3 direct → same wrong; thinking → correct |
| ③→④ | `現在幾點?` | Tab 3 thinking → reasons but **invents a time** (no clock) | Tab 4 → really calls `get_time` → real time |

### Lesson-doc changes

- **lesson-1** (`teaching/lesson-1-basics{,.zh-TW}.md`): add a closing beat — after the three
  segments, drive Tab 1 with `一年有幾個月?` to show chaining never answers, and tee up the
  next-lesson question ("why does ChatGPT answer?"). The existing next-lesson teaser stays,
  reframed around this carried prompt.
- **lesson-2** (`teaching/lesson-2-product{,.zh-TW}.md`): opening narration references the
  carried `一年有幾個月?` from Lesson 1's close ("same question you just saw loop, now on this
  tab"). Add a closing beat — drive Tab 2 (chat mode) with the apple problem → it answers but
  gets it wrong → tee up Lesson 3 ("it answers now, but is it right?").
- **lesson-3** (`teaching/lesson-3-reasoning{,.zh-TW}.md`): opening references the carried
  apple problem from Lesson 2's close. Add a closing beat — drive Tab 3 (thinking) with
  `現在幾點?` → it invents a time → tee up Lesson 4 ("even thinking can't know the real time;
  it needs a tool").
- **lesson-4** (`teaching/lesson-4-agent{,.zh-TW}.md`): opening references the carried
  `現在幾點?` from Lesson 3's close; Tab 4 actually calls `get_time`. (Lesson 4 is the last
  interactive lesson; no further bridge.)

These are narration/driving-recipe changes only — no new demo mechanics. The AI drives each
closing/opening prompt via the existing `POST /drive`.

### UI prompt carry-over (app.js)

Behavior: when the user **clicks a tab button** to switch to an interactive tab (1–4), the
new tab's prompt field is overwritten with the last-used prompt.

- Module-level `let lastPrompt = "";`
- `lastPrompt` updates whenever any interactive `.prompt` field receives input (a global
  `input` listener over `[data-panel] .prompt`), and whenever a drive reflects `frame.user`
  into a prompt field (basic/advanced/reasoning `onDriveStart` and agent `beginRun`).
- New `carryPromptInto(panelName)`: if `PANEL_TO_TAB[panelName]` exists and `lastPrompt` is
  non-empty, set that panel's `.prompt` value to `lastPrompt` and dispatch a synthetic
  `input` event (so the advanced/reasoning final-prompt preview refreshes).
- Wire it into the **tab-button click handler only**:
  `btn.addEventListener("click", () => { activateTabUI(t); carryPromptInto(t); })`.
  The `drive_start` path (which shares `activateTabUI`) is left untouched — `onDriveStart`
  fills `frame.user` there, which for a bridge equals `lastPrompt` anyway; not carrying on
  that path avoids a double-set race.
- **Overwrite always** (approved): switching in clobbers whatever the destination held, to
  guarantee the "same prompt follows you" continuity. The hardcoded Tab 3 default (apple
  problem) still serves as the fallback when `lastPrompt` is empty (fresh page).
- Scope: only `.prompt` fields (tabs 1–4). Tab 5 Skill uses `.skill-prompt` and Tab 6 MCP has
  no prompt, so both are naturally excluded.
- Bump the `app.js?v=NN` cache-bust in both HTML files.

## B. Tab 3 probs removal

- **HTML** (`frontend/index{,.zh-TW}.html`): delete the reasoning panel's `.probs-area`
  `<section>` (the "TOKEN 候選 · top 10" chart). **Also fix the grid-specific utility classes
  left behind on the remaining two children** — the panel currently relies on the desktop
  2-column grid: `.prompt-area` carries `lg:col-span-2` and the middle thinking/answer
  wrapper `<div>` carries `mt-8 lg:mt-0`. In single-column layout `lg:col-span-2` is
  meaningless (drop it) and `lg:mt-0` collapses the wrapper's top margin on desktop so
  thinking/answer would sit flush against the prompt (change to a plain `mt-8` so the spacing
  survives). Verified reasoning panel structure: `frontend/index.zh-TW.html:133-166` — three
  children: `.prompt-area` (134), middle `<div class="mt-8 lg:mt-0 space-y-6">` (152),
  `.probs-area` (162).
- **styles.css**: remove `[data-panel="reasoning"]` from the desktop 2-column grid rule
  (`styles.css:13-27`) so the reasoning panel flows single-column — prompt on top, thinking +
  answer below at full width. Must be paired with the HTML class fixes above.
- **app.js `setupPanel`**: guard every `probsEl` use (`probsEl = panel.querySelector(".probs")`
  at `app.js:202`) with a null check (the reasoning panel no longer has one), so
  `renderProbs`/`onInspect`/step-0 rendering no-op there. Render Tab 3 tokens as
  non-interactive (no probability chart to pop), consistent with the tab's focus; reuse the
  existing `.tok-static` treatment. Note: `appendClickableToken` is currently used for the
  reasoning panel too, so this needs an explicit branch.
- **demo_tab3.py**: no change needed — verified it only reads `.thinking-content` and
  `.generated-text` (`demo_tab3.py:22,33-37`); it never clicks tokens or asserts on `.probs`.

## Testing / verification

- `pytest agent/tests -q` stays green (no backend change).
- Live checks via the running server + a driven browser tab:
  - Click through tabs 1→2→3→4 by hand: the prompt carries and overwrites each time.
  - Tab 3 has no probs panel, flows single-column, tokens are non-clickable, no console error.
  - Drive each bridge prompt on its closing tab and confirm the expected failure (loop /
    wrong / invented time), and the opening tab's feature resolving it.
- Confirm `現在幾點?` on Tab 3 thinking actually invents a time (0.6B) and on Tab 4 triggers a
  real `get_time` call (4B) — includes the 0.6B→4B swap.

## Files touched

- `frontend/app.js` (carry-over + probs guards + Tab 3 static tokens + cache-bust)
- `frontend/index.html`, `frontend/index.zh-TW.html` (remove Tab 3 probs-area + cache-bust)
- `frontend/styles.css` (reasoning out of 2-col grid)
- `teaching/lesson-1-basics{,.zh-TW}.md`, `lesson-2-product{,.zh-TW}.md`,
  `lesson-3-reasoning{,.zh-TW}.md`, `lesson-4-agent{,.zh-TW}.md` (bridge narration)
- `teaching/demos/demo_tab3.py` (drop probs/token-click steps if present)
