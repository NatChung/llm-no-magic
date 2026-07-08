# Tab ⑤ Skill + Tab ⑥ MCP — interactive demo design

Date: 2026-07-08 · Branch: `feat/tab5-tab6-finish` · Status: draft for review

## 1. Goal & teaching arc

Finish tabs ⑤/⑥ as interactive, relay-driven demos that extend the ①→④ chain:

- **Foundation (no new UI):** context changes the distribution. Lesson 5 opens by
  driving Tab ① twice — `1+1=` vs `1+1=3。那麼 1+1=` — the top-1 flips to `3`.
  Context is not "extra info", it *reweights the whole distribution*.
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
  Yields SSE events: `index`, `tools_exposed`, `sent`, `received`, `turn`,
  `skill_loaded`, `l3_loaded`, `final`, `error`. Modes: `proper`, `no_skills`,
  (`naive` kept for token-cost estimates only).
- `agent/skills/check_weather/` + `agent/skills/organize_files/` — demo skills.
- Tab ④ chat-bubble UI in `frontend/app.js` (model=blue left, tool=purple
  right, user-facing=green full-width, trace-summary banner, ▸ expanders).
- `/drive` relay in `agent/server.py`: serialize → swap model → publish frames
  to `/events` → return aggregate. `MODEL_FOR_TAB` routes tabs to 0.6B/4B.

## 3. Architecture

### 3.1 New backend components

```
agent/mcp_server.py    standalone stdio MCP server (~100 lines, stdlib only)
agent/mcp_agent.py     agent loop for Tab ⑥ (spawns/uses the MCP client)
```

`agent/mcp_server.py` — a real, minimal MCP server:
- JSON-RPC 2.0 over stdin/stdout, one JSON object per line (newline-delimited;
  note: real MCP stdio framing is also line-delimited JSON-RPC — we implement
  the same subset faithfully).
- Methods: `initialize` (returns serverInfo + capabilities), `tools/list`
  (returns 2 tools), `tools/call` (executes, returns content).
- Tools: `get_time` (no args → `"HH:MM:SS"`) and `get_weather` (`{city}` →
  mock `{"temp": 16, "cond": "有雨"}` — values match the Tab ④ mockup so the
  lesson's example numbers line up).
- Zero dependencies, runnable standalone: `echo '{"jsonrpc":...}' | python3 -m agent.mcp_server`.

`agent/mcp_agent.py` — Tab ⑥ loop:
- Spawns `mcp_server.py` as a child process (fresh per run; killed at end —
  simplest lifecycle, no state leak between runs).
- Handshake: send `initialize`, then `tools/list`; convert MCP tool schemas →
  OpenAI `tools` array for llama-server.
- Every JSON-RPC exchange is captured and yielded as a `protocol` event
  `{type:"protocol", method, request, response, phase:"handshake"|"call"}`.
- Then the standard multi-turn loop (same shape as `agent_loop` in
  `agent/agent.py`): model tool_call → `tools/call` over the pipe → result into
  messages → repeat until no tool_call. Yields `turn_complete` events shaped
  like Tab ④'s (message_tokens omitted; content + tool_calls + tool_results +
  received_chunk + next_prompt equivalents where available) plus `final`.
- MAX_TURNS = 8, timeout per JSON-RPC call 10 s.

### 3.2 server.py changes

- `MODEL_FOR_TAB` += `{"5": "4B", "6": "4B"}`.
- `drive()` routing:
  - `tab == "5"` → `skill_agent_loop(user, mode or "proper")`, publish each
    event to the relay, aggregate: `{skills, turns, final}`.
  - `tab == "6"` → `mcp_agent_loop(user)`, publish each event, aggregate:
    `{protocol_frames, turns, final}`.
- `/skill-agent` endpoint: **removed**. Tab ⑤'s run button goes through
  `/drive {tab:"5"}` like every other tab (one driving path, lessons and
  humans share it). Tests updated accordingly.
- `skill_agent_loop` event stream is adapted (in `skill_agent.py`) to the
  relay's frame conventions: keep `index`/`skill_loaded`/`l3_loaded`, rename
  nothing else, add `usage` (prompt_tokens from llama-server response) onto
  each `turn` event so the UI can render the context-size counter.

### 3.3 Frontend (`frontend/app.js` + both HTML files)

- Extract Tab ④'s bubble builders (`makeDetails`, model/tool/final bubble
  constructors, trace-summary banner) into shared helpers parameterized by
  target container, so tabs ④⑤⑥ render identically.
- `setupSkillTab(panel)` (replaces old `setupSkill`):
  - Layout: left column = skill index panel (L1 cards: name/description/L3
    file list, from the `index` event) + query box; right column = bubble flow.
  - Bubble flow per run:
    - model bubble `⟨tool_call⟩ load_skill("check_weather")`
    - **L2-injection highlight block** (distinct amber tint, new color slot):
      "SKILL.md body 注入 context(+N tokens)" with ▸ expander showing the
      body — THE skill moment, visually louder than a normal tool result
    - model bubble `⟨tool_call⟩ run_skill_script(...)` → purple tool bubble
      (stdout only; badge: 💻 在你電腦執行 · code 不進 context, with ▸
      expander showing the script source for the human)
    - green final bubble
  - **Context counter**: small chip on every model bubble label —
    `context: N tokens (+M)` from `usage.prompt_tokens` delta.
  - **Token-cost contrast chip** above the flow (from `index` event):
    `漸進式載入 ~N tokens vs 全部塞進 system prompt ~M tokens`.
  - Mode: `proper` default; a small「無 skill 對照」toggle re-runs the same
    query with `mode:"no_skills"` for the contrast segment.
- `setupMcpTab(panel)` (replaces the static article):
  - Top section「握手:client 啟動時發現工具」: two protocol cards
    (`initialize`, `tools/list`) rendered from `phase:"handshake"` frames —
    compact request→response cards, mono, neutral tint, ▸ expander for full
    JSON.
  - Then the standard bubble flow; each model tool_call is followed by a
    `tools/call` protocol card (phase:"call") *between* the blue bubble and
    the purple result bubble — the visible "wire".
  - Legend gains a third entry: 協定幀(JSON-RPC).
  - Article content: the old ⑥ article is **not deleted** — trimmed to a short
    "why MCP" intro above the demo + a ▸ expander with the full original text.
- Nav dropdown labels unchanged (⑤ Skill ⑥ MCP). Placeholders (main) are
  replaced on this branch by the real panels. Cache-bust `?v` bumped.
- Bilingual: every UI string via `I18N`, both `index.html`/`index.zh-TW.html`.

### 3.4 Events summary (new/changed frames over /events)

| frame | producer | purpose |
|---|---|---|
| `index` | skill loop | L1 skill cards + token estimates + script sources |
| `skill_loaded` | skill loop | L2 body injected (drives highlight block) |
| `l3_loaded` | skill loop | L3 file read / script output |
| `turn` (+`usage`) | skill loop | per-turn content/tool_calls + context size |
| `protocol` | mcp loop | one JSON-RPC request/response pair |
| `turn_complete` | mcp loop | Tab ④-shaped turn frame |
| `drive_start`/`final`/`error`/`swap_start` | drive() | unchanged contract |

## 4. Lessons (teaching/)

- `lesson-5-skill.zh-TW.md` + `lesson-5-skill.md`:
  1. 開場(不問答,一句話):Lesson 1 看過分佈;現在看 context 怎麼「改」分佈。
  2. 段落 1 — context 翻轉答案:drive Tab ① `1+1=` → top-1 是 2;再 drive
     `1+1=3。那麼 1+1=` → top-1 變 3。旁白:context 不是參考資料,是直接改機率。
  3. 段落 2 — skill = 按需注入的 context:drive Tab ⑤ `台北今天天氣怎樣?`,
     走 load_skill → L2 注入(context 計數跳)→ run script → 格式化回答。
  4. 學員動手 — 無 skill 對照:同一句用「無 skill 對照」開關再跑,model 只能
     編。差別是有沒有 skill。
  5. 收尾:token 成本對比 chip — 為什麼不整包塞 system prompt。
- `lesson-6-mcp.zh-TW.md` + `lesson-6-mcp.md`:
  1. 開場:Tab ④ 的工具寫死在 client 裡;工具能不能來自別人?
  2. 段落 1 — 握手:指著兩張協定卡(initialize/tools/list):client 事先根本
     不知道有什麼工具,是問出來的。
  3. 段落 2 — drive `現在幾點?台北天氣如何?` → 兩趟 tools/call,泡泡 +
     協定卡交錯;綠色 final 融合兩個結果(對齊 Tab ④ mockup 的數字)。
  4. 學員動手:自己問一句只需要其中一個工具的問題,看 model 只挑一個 call。
  5. 收尾:skill(裝在本機的能力包)vs MCP(外部 process 的工具),都是
     「把 context/工具送到 model 面前」的手段。
- `teaching/README*.md`: add lessons 5/6 to the course index.

## 5. Testing

- `agent/tests/test_mcp_server.py`: JSON-RPC framing (initialize/tools/list/
  tools/call happy paths, unknown method error, malformed JSON error) — run
  the real subprocess over pipes.
- `agent/tests/test_mcp_agent.py`: loop logic with mocked llama responses +
  real (or mocked) mcp_server pipe; asserts protocol frames captured, tool
  results fed back, final produced.
- `agent/tests/test_server.py`: update drive routing tests (tab 5/6 dispatch,
  MODEL_FOR_TAB), remove /skill-agent endpoint tests.
- Existing style: plain pytest functions + mocks (no fixtures beyond repo
  norm).
- Manual/e2e: playwright pass on both tabs at mobile + desktop widths,
  console-error check, both languages; lesson dry-run via curl /drive.

## 6. Out of scope

- Multiple / external MCP servers, server picker UI (Inspector-level).
- Students editing SKILL.md live.
- English course activation (ENABLE_ENGLISH stays false).
- naive-mode live runs (estimates only).
- Streaming per-token rendering for tabs ⑤⑥ (turn-level like Tab ④ is enough).

## 7. Risks & mitigations

- **4B flakiness on multi-step chains** (temperature 0.3): lessons phrase
  queries close to skill descriptions; if a run goes sideways the lesson says
  re-drive once (narrate: sampling, same as Lesson 1). Keep MAX_TURNS=8 cap
  surfaced as error frame (drive returns 5xx, page recovers — Tab ④ contract).
- **Two tool_calls in one turn** (model batches get_time+get_weather): loop
  already handles lists; UI renders one protocol card per call.
- **stdio deadlock**: line-buffered writes + readline with 10 s timeout;
  child killed in `finally`.
- **Relay frame bloat** (`sent`/`received` full JSON per turn): keep them (they
  feed ▸ expanders) but drop `received.response` down to the assistant message
  + usage before publishing.
