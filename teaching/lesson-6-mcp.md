# Lesson 6 — Tab ⑥ MCP: tools don't have to be hard-coded in the client

> 中文版: [lesson-6-mcp.zh-TW.md](./lesson-6-mcp.zh-TW.md)

## Learning Objectives
1. Know that MCP = a tool protocol (JSON-RPC) between the client and an external process
2. Read the handshake: initialize → initialized → tools/list — tools are *asked* for
3. Tell the three sources apart: Tab ④ built into the client / Tab ⑤ skill script /
   Tab ⑥ external process

## Opening (no Q&A — go straight into the demo)

One line of framing: up to now, every tool has lived on your machine and been defined by
this client. The problem: how do you plug in tools someone else already wrote? That's what
MCP solves.

## Demo Segments

### Segment 1 — the handshake: the client doesn't know the tools in advance
- Drive: `POST /drive {"tab":"6","user":"現在幾點?台北天氣如何?"}`
- Point first at the three protocol cards in the "handshake" area: `initialize` (hello,
  I'm a client) → `notifications/initialized` (I'm ready) → `tools/list` (what tools do
  you have?) → the response lists get_time and get_weather — **the client asked for them;
  nothing was hard-coded**
- Narration: these three cards are the heart of MCP; each `tools/call` card below is the
  client making a cross-process phone call on the model's behalf whenever the model
  decides to use a tool
- **AI shows the prompt** (no preview box on the page — the AI performs it):
  `POST /preview {"tab":"6","user":"現在幾點?台北天氣如何?"}` — the server really
  spawns a mini MCP server, handshakes for the tool list, then expands the prompt.
  Contrast with the last two lessons: the get_time + get_weather inside `<tools>`
  were **asked for** — not hard-coded (④), not files on disk (⑤); when you open the bubble in a
  moment, that `<tools>` block arrives folded shut because it's long — clicking it open is part
  of the story, not a snag. (Coloring: use a ```diff code block — `+` green = ours/editable, `-` red = training-time convention/immutable, unprefixed gray = template markers. Always inline in the chat — never a separate HTML/artifact)

### Segment 2 — reading bubbles and protocol cards interleaved
- The stream starts with your question (grey bubble, right) — and it's this bubble, not the
  model's, that holds the punchline: expand its "prompt sent to the AI (turn 1)" and the messages
  sit as a folded list; open the `<|im_start|> system` message and inside is a
  `▸ <tools> 2 個工具,423 字元` fold — click it open and get_time + get_weather are sitting
  right there, asked for over the handshake, not hardcoded. (The blue bubble's own expander shows something different: the raw `<tool_call>`
  the model emitted.)
- Read: blue bubble (model emits a tool_call) → protocol card (tools/call
  request/response — the line that crosses processes) → purple bubble (result fed back to
  the model, and its own expander carries the next turn's prompt) → repeat → green final
  fuses both results. In every sent prompt, the last block (amber-tinted, tagged
  `← new this turn — being sent`) is the fresh input just appended this turn — the question
  on turn 1, the fed-back tool result after.
- Contrast with Tab ④: the model side is **exactly the same** (it emits the tool_call
  convention tag); what changes is where the client goes to execute once it gets a
  tool_call — a built-in function vs asking an external process

## Hands-On
Have the learner type a question that needs only one of the tools (e.g. `現在幾點?`) and
watch the model pick only get_time — just one tools/call card. Whether to use a tool, and
which one, is still the model's decision.

## Reveal and Wrap-Up

### 1. Different source, different answer
Some learners will notice: Taipei's weather here is 16°C 有雨, but last lesson's skill
said 28°C 晴! Deliberate — two "tools" with different implementations and different
sources give different answers. **Where the tool comes from is where the answer comes
from** — and that's exactly why plugging in third-party tools means knowing who's
behind them.

### 2. Not just the answer differs — so does the *phrasing* ← the point of this lesson
Have the learner type the same `台北天氣如何?` in both ⑤ and ⑥ (measured 2026-07-29):

| | Tab ⑤ Skill | Tab ⑥ MCP |
|---|---|---|
| Model's answer | `台北:28°C, 晴` | `台北的天氣是16度,有雨。` |
| Turns | 3 | 2 |
| turn 1 prompt_tokens | 506 | 218 |
| Final turn prompt_tokens | 912 | 270 |

Same model, same question. ⑤ holds the line on `°C`, the colon, no trailing period —
because SKILL.md carries a "response format + cautions" section. ⑥ improvises a
sentence — because all it got was a JSON schema.

**`tools/list` gives you name + description + inputSchema. There is nowhere to put
"always °C, no emoji, one city at a time".** That's the difference between
**"can do it" and "does it right"**.

**The honest counter-example (say it, don't skip it)**: the slogan says MCP should be
more expensive because tool definitions ride along every turn. But the screen says ⑥ is
270 and ⑤ is 912 — the other way round. Because ⑤, in order to "load only when needed",
must spend a whole turn reading SKILL.md into context. This toy scale is too small; the
flip needs seven or eight tools (codegraph ships 8 tools but exposes only 1 by default —
its source comment reads `long instructions burn tokens`). **This repo's stance is that
the number on screen wins — including against slogans.**

### 3. Tying the three lessons together — where the ability list comes from
(use this table when explaining to clients)

| | Tab ④ hard-coded | Tab ⑤ Skill | Tab ⑥ MCP |
|---|---|---|---|
| Where the ability list lives | in the client code | folders on disk (code ships only 2 generic tools) | external process, asked via handshake |
| Adding an ability | code change + redeploy | drop in a folder | the other side updates their server |
| Who maintains it | you | you (docs + scripts) | someone else |
| **Where the rules go** (format/order/limits) | in the code | **SKILL.md** | **nowhere to put them** |

Analogy: ④ a menu printed inside the restaurant (adding a dish = reprint), ⑤ the
kitchen consulting its own recipe shelf (add a recipe book and it just works), ⑥
ordering delivery (the menu is another restaurant's; they update, you get it for free).
**But ordering delivery doesn't mean you skip plating** — delivery brings the dish (MCP
supplies the ability); whether to change the plate, what to do about a customer who
can't take spice, is your kitchen's job (Skill supplies the rules). In the real world
it's usually: **order in, plate it yourself.**

### 4. "So when I package a service, do I ship a Skill or an MCP server?"

Learners always ask. **The answer takes two cuts, not one.**

**Cut 1 — shipped or hosted?**
> Does a copy go onto their machine, or does it run on yours and they connect to it?

- **shipped → Skill / Plugin.** They hold a copy; your logic and data are on their machine
- **hosted → MCP or your own API.** You run a machine, but you can revoke it and see usage

**Cut 2 — if hosted, how do they connect? This cut is decided by *their* client, not by you.**

Can a skill's bundled script make outbound HTTP calls (verified 2026-07 — this changes,
re-check before teaching):

| Environment | Outbound HTTP? |
|---|---|
| Claude Code | ✅ unrestricted |
| claude.ai / Cowork | ⚠️ **allowlist of 16 domains by default** (package managers + github.com); an admin can widen it to all domains |
| Claude API | ❌ explicitly "no network access" |

So:
- They use **Claude Code** → **Skill + your API is enough**; MCP is optional
- They use **Cowork / claude.ai (default)** → the script can't reach your API → **MCP connector only**
- They use **some other client** → **MCP**

> **Half of "do I need MCP" isn't your choice — your users' environment decides it for you.**

This is also why the community argument never resolves: the "skills + CLI locally is
plenty" camp and the "ChatGPT can't run CLIs, so any CLI-based skill is dead on arrival"
camp **have different users — and both are right**.

### 5. These are NOT criteria (each has a counter-example; learners misjudge here most)

| ❌ Not a criterion | Counter-example |
|---|---|
| How well-specified the task is | codegraph's `add-lang` is a rigid Step 1→10 flow yet it's a Skill; `codegraph_explore` takes natural language yet it's MCP |
| Whether it reaches outside | A skill's script can curl just fine |
| Whether auth is needed | A script can check for a token and open a browser to log in (the `gh auth login` shape) |
| Whether state must persist | A script can write local jsonl / SQLite |
| Whether it can be revoked | **A hosted skill can be deleted via API** — the real axis is hosted vs shipped |
| Metering / rate limiting | Vendors sell API-gateway access through a skill, tiered limits included |
| Context cost | See the measurement above — it often points the other way |

### 6. Never forget the other half
**"How to do it right" can only be a Skill** — order, format, limits, when *not* to use it.
The MCP protocol has no field for it (server `instructions` is one blob per server,
present every session — it can't be layered or switched per task). So the most common
real-world answer is **ship both**: **MCP for the ability, Skill for the rules.**

## Common Participant Questions
- "Can an MCP server be written by someone else?" — Yes, that's precisely the point;
  today's mini server ships with this lesson, but swap in anyone's server and the
  handshake flow is exactly the same
- "How is this different from an API?" — Every API has its own format; MCP is one unified
  "tool description + call" protocol — a client integrates once and can use every server
  that supports it
- "Is it safe?" — You saw everything the client sent out and got back on the protocol
  cards; the trust boundary is who wrote the server — the same judgment call as installing
  a browser extension
