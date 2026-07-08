# Tab ⑤ Skill demo redesign — design spec

Date: 2026-07-08
Status: draft (pending Nat review)
Origin: Nat's feedback after first student-mode run of Lesson 5.

## Context

Four feedback items from Nat:

1. Tab ⑤ lacks the always-visible「實際送進 model 的 prompt」preview that Tab ④ has;
   it should show the difference between having a skill and not having one.
2. One skill in the repo is enough.
3. The skill's on-disk structure (yaml / md / scripts) should be visible in the UI.
4. Where to teach the general lesson "context overrides priors → RAG / prompt
   engineering / context management / skills are the same mechanism"?

Decisions made in brainstorming (all approved by Nat):

- Item 1 → **Option B**: live pre-send preview AND per-turn actual-prompt views.
- Item 2 → keep only `check_weather`.
- Item 3 → anatomy card matching the official Agent Skills three levels
  (L1 = SKILL.md **frontmatter**, not a separate yaml file; L2 = SKILL.md body;
  L3 = `scripts/` — executed, never read into context).
- Item 4 → no new lesson; one "same mechanism, four packagings" map in Lesson 5's
  揭曉 section.

## Current state (verified in code)

- `agent/skills/<name>/{SKILL.md, scripts/*.py}` already matches the Agent Skills
  standard; the L1 index is derived by scanning frontmatter at load
  (`skill_agent.py: load_index()`); no separate yaml index file exists or is needed.
- `skill_agent_loop` **already yields** a `sent` frame per turn carrying the full
  accumulated `messages` + active tool names, and a `received` frame with the
  assistant message + usage. The frontend already buffers these and attaches them
  to each turn's ▸ wire-view expander. → Per-turn actual-prompt view exists;
  it only needs labeling/visibility polish, no new backend.
- Tab ④ has the `.final-prompt-preview` box (client-side `renderPromptPreview` +
  server `/preview` which calls llama.cpp `/apply-template`). Tab ⑤ has none.
- Two skills exist: `check_weather`, `organize_files` (the latter also has
  REFERENCE.md).

## Changes

### 1. Single skill

- Delete `agent/skills/organize_files/` (SKILL.md, REFERENCE.md, scripts/organize.py).
- `load_index()` and the loop stay generic (no hardcoding of one skill).
- No existing test references `organize_files` (verified: agent/tests are mocked
  and index-size agnostic). New tests to ADD: single-skill index assertion, and a
  fixture-based multi-skill parse test (fixture under `agent/tests/`,
  monkeypatching `SKILLS_DIR`) so the generic path stays covered.
- `skill_agent.py` RUN_SKILL_SCRIPT_TOOL parameter description says
  "e.g. organize.py" — change to "e.g. weather.py" (this text is sent to the
  model every proper-mode turn and visible in the sent expanders).
- Known trade-off (accepted): deleting organize_files shrinks the naive-vs-proper
  token contrast chip from roughly ~5x to ~2x. Direction still teaches the point;
  Lesson 5 揭曉 copy must stop promising a big multiplier and just narrate the
  two numbers.
- The three tools (`load_skill`, `read_skill_file`, `run_skill_script`) all stay
  exposed in proper mode. `check_weather` has no extra files, so `read_skill_file`
  is simply unused at runtime — acceptable; it keeps the loop generic and the
  tool list honest to the standard.
- The「無 skill 對照」toggle is unchanged: proper mode = index has one entry;
  no-skill mode = empty index. "Decision" teaching beat becomes load vs not-load
  (weather question → loads; e.g. "1+1=" → answers without loading).

### 2. Skill anatomy card (new UI)

A static card in the Tab ⑤ panel, rendered at panel init, showing the real
on-disk tree:

```
skills/check_weather/
├── SKILL.md
│   ├─ frontmatter (yaml)   [L1] always in context (~tens of tokens)
│   └─ body (markdown)      [L2] injected on load_skill
└── scripts/weather.py      [L3] executed only — code never enters context
```

- L1/L2/L3 badges reuse the existing flow colors (L2 badge = amber like the
  injection block; L3 = purple like the script-result bubble) so the card and the
  run trace visually cross-reference.
- Each node is clickable → expands the actual file content (frontmatter and body
  shown as two nodes of the same SKILL.md file).
- Data source: extend existing `POST /inspect` with `{"tab":"5"}` to return
  `{files: [{path, layer, content}]}` read live from `agent/skills/` (no caching,
  so edits to the skill show up on reload). No model call involved.
- Discriminator is explicit: body contains `"tab":"5"` → data response only, do
  NOT publish anything to the relay; body without it → legacy behavior exactly as
  today (publish `{"type":"inspect","tokenIndex":...}`). Rationale for reusing
  /inspect instead of a new endpoint: keeps the endpoint list in AGENTS.md and
  the stdlib router unchanged.
- Badge numbers: the L1 badge quotes THIS skill's frontmatter cost
  (name+description, ~chars/4), not the whole system prompt — so the card and the
  existing token chip (which measures the full system prompt) can't show
  contradicting figures for the same label.
- Bilingual card copy in both HTML files.

### 3. Prompt preview, Option B

**3a. Pre-send live preview (the Tab ④ pattern):**

- Add a `.final-prompt-preview` box to the Tab ⑤ panel (always visible, like Tab ④).
- Content = chat-template-expanded text of what WOULD be sent on turn 1:
  system prompt (with L1 index in proper mode, without it in no_skills mode) +
  current user input + the three skill tools (proper) / no tools (no_skills).
  (The `index` relay frame already carries `system_prompt`, but only after a
  drive starts — the pre-send preview must work before any drive, hence the
  `/preview` extension.)
- Source of truth is the server (the system prompt is built in
  `skill_agent.py: proper_system_prompt()` / `no_skills_system_prompt()`): extend
  `POST /preview` to accept `{"tab":"5", "user":..., "mode":"proper"|"no_skills"}`
  (mode strings as already used by `skill_agent_loop`); the handler builds the
  exact messages+tools `skill_agent_loop` would use (proper: the three skill
  tools; no_skills: none) and calls llama `/apply-template` as today.
- Frontend: debounce ~300 ms on input/toggle change, same as Tab ④ refresh wiring.
- Preview never triggers a model swap; it uses whichever llama is up (0.6B and 4B
  are both Qwen3 — identical chat template, so the preview text is correct even
  before the first Tab ⑤ drive). If llama isn't up yet, the request fails the
  same way Tab ④'s does — reuse Tab ④'s `[preview error] <ExcName>: <msg>`
  fallback text (no new placeholder).
- Response shape: same as today's `/preview` — `{"prompt": <expanded text>}`.
  Note the current handler has no tab dispatch (hardcodes tab4 system+tools);
  this change introduces the first branch. Tab ④'s existing `{user, system}`
  body without `tab` must keep working unchanged.

**3b. Per-turn actual prompt (existing + one real fix):**

- Keep the `sent`-frame wire views; rename the expander label to
  「此 turn 實際送出的 prompt」/ "actual prompt sent this turn".
- Fix: the frontend currently DROPS sent/received frames for turns without tool
  calls (app.js `if (!hasCalls) ...` early return) — so the final-answer turn,
  whose accumulated messages are the fullest and most valuable pedagogically,
  gets no expander. Change: render the wire views on the final turn too, so
  EVERY turn has one (this is what Acceptance #4 requires).
- In the turn that follows a `load_skill`, the expander is where the L2 body is
  visibly sitting inside `messages` — add a one-line hint on the amber injection
  block pointing at it:「展開下一個 turn 的 sent,看它躺在 messages 裡」.

### 4. Lesson 5 map (teaching material only)

In `teaching/lesson-5-skill.md` + `.zh-TW.md` 揭曉 section, add the four-packagings
map: prompt engineering = hand-written injection; RAG = retrieved injection;
skill = governed on-demand injection; context management = deciding what to
inject/evict. One paragraph; expand verbally only if a student asks. No new
lesson, no RAG demo (out of scope for this tool — noted as 課後延伸).

### 5. Conventions

- Bilingual: `index.html` + `index.zh-TW.html` both updated; `?v=NN` cache-bust
  bumped in both.
- Lessons bilingual (EN + zh-TW).
- `pytest agent/tests -q` green; new tests: /inspect tab5 payload shape,
  /preview tab5 proper-vs-no_skill difference (mocked llama), single-skill index.
- AGENTS.md untouched (structure/flow description still accurate).

## Non-goals

- No RAG / embeddings demo.
- No changes to Tab ⑥ or other tabs.
- No change to the skill loading mechanics (L1/L2/L3 flow is already per the
  Agent Skills standard).
- No separate yaml index file — deliberately, to match the official standard.

## Acceptance

1. Tab ⑤ shows exactly one skill card in the L1 index (proper mode).
2. Anatomy card shows the real tree; clicking SKILL.md nodes shows real file
   content split into frontmatter/body; script node shows weather.py source.
3. Typing in the input with「無 skill 對照」off/on updates the live preview and
   the L1 index block visibly appears/disappears from the system prompt text.
4. After a weather run, each turn has an「此 turn 實際送出的 prompt」expander;
   turn 2's contains the SKILL.md body inside messages.
5. Lesson 5 揭曉 section contains the four-packagings map in both languages.
6. Tests green.
