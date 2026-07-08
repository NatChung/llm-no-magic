# Tab ⑤ Skill + Tab ⑥ MCP — interactive demo design

Date: 2026-07-08 · Branch: `feat/tab5-tab6-finish` · Status: reviewed (rev 2)

## 1. Goal & teaching arc

Finish tabs ⑤/⑥ as interactive, relay-driven demos that extend the ①→④ chain:

- **Foundation (no new UI):** context changes the distribution. Lesson 5 opens by
  driving Tab ① three times (verified live on 0.6B, 2026-07-08):
  1. `1+1=` → top-1 `2` at 86%
  2. `1+1=3。那麼 1+1=` → top-1 still `2` (60%) but `3` rises 0% → 28%
  3. `1+1=3。1+1=3。1+1=` → top-1 **flips to `3` at 87.5%**
  Context is not "extra info" — it *reweights the whole distribution*, and
  enough of it flips the answer.
- **Tab ⑤ Skill:** a skill is *context loaded on demand* + bundled tools.
  Students watch the model see only L1 metadata, decide to `load_skill`, get the
  L2 body injected (context size visibly jumps), follow it to run an L3 script
  (code never enters context, only stdout), and answer in the SKILL.md-mandated
  format.
- **Tab ⑥ MCP:** tools don't have to be baked into the client. A separate
  process advertises them over a protocol; the client discovers them at runtime
  (`initialize` → `tools/list`) and the model uses them like any other tool
  (`tools/call`). Students see the actual JSON-RPC frames.

Contrast sentences the lessons hang on (mirrors Tab ④'s "差別是有沒有工具"):
- Tab ⑤: same question, no skill index → the model improvises/hallucinates.
  差別是有沒有 skill。
- Tab ⑥: same *kind* of tool call as Tab ④, but the tool comes from an external
  process discovered via protocol, not client code. 差別是工具從哪來。

## 2. What exists already (reuse, don't rebuild)

- `agent/skill_agent.py` — working 3-layer progressive-disclosure loop
  (verified live: load_skill → run_skill_script → formatted answer on 4B).
  Yields events: `index`, `tools_exposed`, `sent`, `received`, `turn`,
  `skill_loaded`, `l3_loaded`, `tool_result` (error paths), `final`, `error`.
  Modes: `proper`, `no_skills`, (`naive` kept for token-cost estimates only —
  `index` already carries `proper_tokens_est` / `naive_tokens_est`).
- `agent/skills/check_weather/` + `agent/skills/organize_files/` — demo skills.
  `check_weather` script returns fixed `{"city":..., "temp_c":28, "condition":"晴"}`.
- Tab ④ chat-bubble UI in `frontend/app.js` (model=blue left, tool=purple
  right, user-facing=green full-width, trace-summary banner, ▸ expanders).
- `/drive` relay in `agent/server.py`: GEN_LOCK serialize → swap model →
  publish frames to `/events` → return aggregate. `MODEL_FOR_TAB` routes tabs.
  Note: the legacy `/skill-agent` endpoint bypasses GEN_LOCK *and* the model
  swap (latent race + wrong-model bug) — replacing it with `/drive` routing is
  a correctness fix, not just consistency.

## 3. Architecture

### 3.1 New backend components

```
agent/mcp_server.py    standalone stdio MCP server (~100 lines, stdlib only)
agent/mcp_agent.py     agent loop for Tab ⑥ (spawns/uses the MCP client)
```

`agent/mcp_server.py` — a real, minimal MCP server:
- JSON-RPC 2.0 over stdin/stdout, one JSON object per line (matches real MCP
  stdio framing).
- Methods: `initialize` (returns serverInfo + capabilities), the
  `notifications/initialized` notification from the client is accepted (and
  shown as a protocol frame — the handshake is the teaching artifact, keep it
  faithful), `tools/list` (returns 2 tools), `tools/call` (executes).
- Tools: `get_time` (no args → `"HH:MM:SS"`) and `get_weather` (`{city}` →
  mock `{"temp": 16, "cond": "有雨"}`). **Deliberately different values from
  Tab ⑤'s check_weather (28°C 晴)** — lesson 6's wrap-up names this: two
  different tool sources, two different implementations, two different
  answers. That IS the point: 工具從哪來,答案就從哪來。
- Zero dependencies, runnable standalone:
  `echo '{"jsonrpc":...}' | python3 -m agent.mcp_server`.

`agent/mcp_agent.py` — Tab ⑥ loop:
- Spawns `mcp_server.py` as a child process (fresh per run; killed in
  `finally` — including on CANCEL/stop — no state leak between runs).
- Pipe reads use a reader thread + `queue.Queue` with 10 s timeout (stdlib
  `readline()` has no timeout; `select` is the alternative — reader thread is
  simpler and portable).
- Handshake: `initialize` → `notifications/initialized` → `tools/list`;
  convert MCP tool schemas → OpenAI `tools` array for llama-server.
- Every JSON-RPC exchange is yielded as
  `{type:"protocol", method, request, response, phase:"handshake"|"call"}`
  (for the notification, `response` is null).
- Then the standard multi-turn loop (same shape as `agent_loop` in
  `agent/agent.py`): model tool_call → `tools/call` over the pipe → result into
  messages → repeat until no tool_call. Yields Tab ④-shaped `turn_complete`
  frames `{turn, content, tool_calls, tool_results, received_chunk,
  next_prompt}` — **no `message_tokens`** (no logprobs requested) — plus
  `final {content}`.
- MAX_TURNS = 8 (higher than Tab ④'s 6 on purpose: discovery chains are
  longer).

### 3.2 server.py changes

- `MODEL_FOR_TAB` += `{"5": "4B", "6": "4B"}`.
- `drive()` routing — both new branches replicate the tab-4 contract exactly
  (this is the **stop/terminal-final contract**, C2):
  - check `CANCEL.is_set()` after publishing each event; on cancel, break and
    publish an empty `final` (`saw_final` tracking identical to tab 4),
  - an `error` event from the loop → `_fail(...)` → 5xx (frame already
    published),
  - `tab == "5"` → `skill_agent_loop(user, mode or "proper")`; aggregate:
    `{subscribers, tab, skills, turns, final}` where `skills` is the `index`
    frame's skill list and `turns` is the list of `turn` frames (each carries
    `usage`). Lesson-facing API — lessons read this instead of polling.
  - `tab == "6"` → `mcp_agent_loop(user)`; aggregate:
    `{subscribers, tab, protocol_frames, turns, final}` (`protocol_frames` =
    the `protocol` events in order; `turns` = `turn_complete` frames).
  - On cancel for tab 6, the mcp child process is killed (loop's `finally`
    handles it since the generator is closed when drive() breaks out).
- `/skill-agent` endpoint: **removed** (no tests reference it — verified).
  Tab ⑤'s run button goes through `/drive {tab:"5"}`.
- `skill_agent_loop` changes (in `skill_agent.py`):
  - add `usage: {prompt_tokens, completion_tokens}` (from llama-server's
    response `usage`) to each `turn` event,
  - trim the `received` event's `response` down to the assistant message +
    usage before yielding (frame-bloat fix),
  - honor `CANCEL` is *not* needed inside the loop — drive() breaks between
    events (same as tab 4; generation granularity is one llama call).
- The legacy `/agent` SSE endpoint stays (out of scope; frontend no longer
  calls it — removal is a separate cleanup).
- **Docs updated in the same change** (I4): `AGENTS.md` + `AGENTS.zh-TW.md`
  (tab ⑤⑥ descriptions + endpoint inventory drop `/skill-agent`), and
  `server.py`'s module docstring endpoint list.

### 3.3 Frontend (`frontend/app.js` + both HTML files)

**Relay plumbing (C1 — the contract that connects §3.2 to the renderers):**
- `PANEL_TO_TAB` += `{skill: "5", mcp: "6"}`; `TAB_TO_PANEL` inverse — so
  `drive_start` auto-switches the page to the driven tab and
  `active = PANELS[f.tab]` resolves.
- `connectEvents` dispatcher gains cases routing to the active panel:
  `index → onIndex`, `tools_exposed → onToolsExposed`, `sent → onSent`,
  `received → onReceived`, `turn → onTurn`, `skill_loaded → onSkillLoaded`,
  `l3_loaded → onL3Loaded`, `tool_result → onToolResult`,
  `protocol → onProtocol`, plus existing `turn_complete/final/error`.
  Panels that don't implement a callback are skipped (same
  `active && active.onX && active.onX(f)` pattern).
- `PLACEHOLDER_PANELS` shrinks back to `∅`; `setupSkillTab` / `setupMcpTab`
  registered for panels skill/mcp.

**Shared bubble helpers (C3):** extract from Tab ④ into module-level
functions parameterized by container + i18n keys: model bubble, tool bubble,
**final bubble takes a `content` string argument** (not message_tokens; the
raw-token ▸ expander renders only when tokens exist — Tab ④ passes them,
⑤⑥ don't), trace-summary banner, `makeDetails`. Tab ④'s `renderTurnBlock`
refactors onto these helpers with zero visual change.

**`setupSkillTab(panel)`** (replaces old `setupSkill`):
- Layout: left column = skill index panel + query box; right = bubble flow.
- L1 cards render from the per-run `index` frame — **intentionally empty
  before the first run** ("模型還沒看到任何 skill" placeholder text), no
  pre-fetch.
- Frame → UI mapping (I3, exhaustive):
  | frame | UI |
  |---|---|
  | `index` | left L1 cards + token-cost chip「漸進式 ~N tokens vs 全塞 ~M tokens」+ stash `script_sources` for expanders |
  | `turn` | model bubble (label 模型 · 第 N 回合 + context chip `context: usage.prompt_tokens (+Δ)`); body = ⟨tool_call⟩ lines, or nothing if content-only |
  | `skill_loaded` | **amber L2-injection block**, full-width-ish, distinct from tool purple:「SKILL.md body 注入 context」+ ▸ expander with body text |
  | `l3_loaded` kind=script_output | purple tool bubble (stdout), badge 💻 在你電腦執行 · code 不進 context, ▸ expander = script source (from `script_sources`) |
  | `l3_loaded` kind=reference | purple tool bubble (file content preview), label 工具 · read_skill_file |
  | `tool_result` (error) | purple bubble with `[error]` prefix (same errorBox tone as Tab ④) |
  | `sent` / `received` | feed the model bubble's ▸ expanders (再送出 / 收到 equivalents) |
  | `tools_exposed` | ignored by UI (aggregate/debug only) |
  | `final` | green 給使用者 bubble (content param) + trace-summary banner prepend |
- Mode:`proper` default. A「無 skill 對照」toggle (checkbox beside Send)
  re-runs with `mode:"no_skills"`; `drive_start.mode` reflects into the
  toggle (Tab ①-③ pattern) so lesson-driven runs show the right state.
- No-skills runs render: model bubble(s) + green final only (no index cards —
  `index` frame arrives with empty skills list; left panel shows the
  placeholder).

**`setupMcpTab(panel)`** (replaces the static article):
- Top:「握手 — client 啟動時才發現工具」section; protocol cards render from
  `phase:"handshake"` frames: compact `method` title + request→response
  two-line preview + ▸ expander with full JSON. Neutral/mono styling —
  visually "wire", not "actor".
- Bubble flow below; `phase:"call"` protocol cards interleave between the
  blue tool_call bubble and the purple result bubble (rendered on `protocol`,
  which arrives between `turn_complete`s — order is producer-guaranteed).
- Legend gains third entry: 協定幀(JSON-RPC).
- Old ⑥ article: trimmed to a short "why MCP" intro above the demo + ▸
  expander with the full original text (not deleted).
- Query box + Send/stop same as Tab ④.

**Both tabs:** excluded from `carryPromptInto` (cross-lesson carry-over stays
①→②→③→④ — lesson 5 opens on Tab ①, carrying `1+1=3…` into the skill query
box would be nonsense). Nav labels unchanged. Cache-bust `?v` bumped. All
strings via `I18N`, both HTML files in sync.

### 3.4 Events over /events — exhaustive for tabs ⑤⑥ (I5)

| frame | producer | tab | new/changed | purpose / UI |
|---|---|---|---|---|
| `swap_start` | drive() | 5,6 | unchanged | loading banner |
| `drive_start` | drive() | 5,6 | **carries `mode` for tab 5** | auto tab-switch, reflect mode toggle, clear panel |
| `index` | skill loop | 5 | + published to relay | L1 cards, token chips, script sources |
| `tools_exposed` | skill loop | 5 | published, UI ignores | debug/aggregate |
| `sent` | skill loop | 5 | published | model bubble ▸ 再送出 expander |
| `received` | skill loop | 5 | **trimmed** to asst msg + usage | model bubble ▸ 收到 expander |
| `turn` | skill loop | 5 | **+ `usage`** | model bubble + context chip |
| `skill_loaded` | skill loop | 5 | unchanged | amber L2 block |
| `l3_loaded` | skill loop | 5 | unchanged | purple tool bubble |
| `tool_result` | skill loop | 5 | unchanged (error paths) | purple error bubble |
| `protocol` | mcp loop | 6 | **new** | handshake / call cards |
| `turn_complete` | mcp loop | 6 | Tab④ shape, no message_tokens | bubbles via shared helpers |
| `final` | both loops | 5,6 | unchanged contract | green bubble + banner; re-enables Send |
| `error` | both loops | 5,6 | unchanged contract | error box; drive returns 5xx |

## 4. Lessons (teaching/)

- `lesson-5-skill.zh-TW.md` + `lesson-5-skill.md`:
  1. 開場(不問答,一句話):Lesson 1 看過分佈;現在看 context 怎麼「改」分佈。
  2. 段落 1 — context 翻轉答案(三段驅動 Tab ①,數字已實測):
     `1+1=`(top-1「2」86%)→ `1+1=3。那麼 1+1=`(「3」從 0% 升到 28%,
     top-1 還是 2)→ `1+1=3。1+1=3。1+1=`(top-1 翻成「3」87%)。
     旁白:context 不是參考資料,是直接改機率;餵夠了連答案都翻。
  3. 段落 2 — skill = 按需注入的 context:drive Tab ⑤ `台北今天天氣怎樣?`,
     走 load_skill → L2 注入(amber 塊 + context 計數跳)→ run script(code
     不進 context)→ 照 SKILL.md 格式回答(台北:28°C, 晴)。
  4. 學員動手 — 無 skill 對照:勾「無 skill 對照」同一句再送,model 只能編。
     差別是有沒有 skill。
  5. 收尾:token 成本 chip — 為什麼不整包塞 system prompt(對照段落 1:
     context 塞越多影響越大,但 token 也越貴 — 所以按需載入)。
- `lesson-6-mcp.zh-TW.md` + `lesson-6-mcp.md`:
  1. 開場:Tab ④ 的工具寫死在 client 裡;工具能不能來自別人?
  2. 段落 1 — 握手:指著協定卡(initialize / initialized / tools/list):
     client 事先根本不知道有什麼工具,是「問」出來的。
  3. 段落 2 — drive `現在幾點?台北天氣如何?` → 兩趟 tools/call,泡泡 +
     協定卡交錯;綠色 final 融合兩個結果。
  4. 學員動手:問一句只需要其中一個工具的問題,看 model 只挑一個 call。
  5. 收尾(含 mock 數字差異的正面利用):Tab ⑤ 的天氣是 28°C 晴、這裡是
     16°C 有雨 — 兩個「工具」實作不同、來源不同,答案就不同。skill(本機
     能力包)vs MCP(外部 process 的工具),都是把 context/工具送到 model
     面前的手段;來源決定答案。
- `teaching/README.md` + `README.zh-TW.md`: add lessons 5/6 to the index.

## 5. Testing

- `agent/tests/test_mcp_server.py`: real subprocess over pipes — initialize /
  initialized / tools/list / tools/call happy paths, unknown method → JSON-RPC
  error, malformed JSON line → error response (not crash).
- `agent/tests/test_mcp_agent.py`: loop with mocked llama responses + real
  mcp_server child; asserts protocol frames captured (handshake 3 + per-call),
  tool results fed back into messages, final produced, child reaped on
  generator close (cancel path).
- `agent/tests/test_skill_agent.py` (**new — module has zero coverage
  today**): mocked llama; asserts `usage` present on `turn`, `received` is
  trimmed, `no_skills` mode yields empty index, `tool_result` error path.
- `agent/tests/test_server.py`: drive routing tab 5/6 (dispatch + aggregate
  shapes + MODEL_FOR_TAB), cancel → empty final, loop error → 5xx.
- Style: plain pytest functions + mocks (repo norm).
- Manual/e2e: playwright pass on both tabs at mobile + desktop widths, console
  error check, both languages; lesson dry-run via curl /drive (all five
  lesson-5 / lesson-6 drives).

## 6. Out of scope

- Multiple / external MCP servers, server picker UI (Inspector-level).
- Students editing SKILL.md live.
- English course activation (ENABLE_ENGLISH stays false).
- naive-mode live runs (estimates only).
- Streaming per-token rendering for tabs ⑤⑥ (turn-level like Tab ④).
- Removing the legacy `/agent` endpoint (separate cleanup).

## 7. Risks & mitigations

- **4B flakiness on multi-step chains** (temperature 0.3): lesson queries stay
  close to skill descriptions; if a run goes sideways the lesson says re-drive
  once (narrate: sampling — same lesson as Tab ①). MAX_TURNS cap surfaces as
  error frame → drive 5xx → page recovers (Tab ④ contract).
- **Two tool_calls in one turn** (model batches get_time+get_weather): loops
  already handle lists; UI renders one protocol card / bubble per call.
- **stdio deadlock**: line-buffered writes; reads via reader thread + Queue
  with 10 s timeout; child killed in `finally` (incl. cancel).
- **Mid-run stop**: drive() breaks between published events, publishes empty
  `final` (send button recovers); mcp child killed via generator close.
