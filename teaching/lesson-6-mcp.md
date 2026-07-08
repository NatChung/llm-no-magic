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

### Segment 2 — reading bubbles and protocol cards interleaved
- Read: blue bubble (model emits a tool_call) → protocol card (tools/call
  request/response — the line that crosses processes) → purple bubble (result fed back to
  the model) → repeat → green final fuses both results
- Contrast with Tab ④: the model side is **exactly the same** (it emits the tool_call
  convention tag); what changes is where the client goes to execute once it gets a
  tool_call — a built-in function vs asking an external process

## Hands-On
Have the learner type a question that needs only one of the tools (e.g. `現在幾點?`) and
watch the model pick only get_time — just one tools/call card. Whether to use a tool, and
which one, is still the model's decision.

## Reveal and Wrap-Up
- Some learners will notice: Taipei's weather here is 16°C 有雨, but last lesson's skill
  said 28°C 晴! Deliberate — two "tools" with different implementations and different
  sources give different answers. **Where the tool comes from is where the answer comes
  from** — and that's exactly why plugging in third-party tools means knowing who's
  behind them
- Tying the three lessons together — three ways of **registering tools** (use this table
  when explaining to clients):

  | | Tab ④ hard-coded | Tab ⑤ Skill | Tab ⑥ MCP |
  |---|---|---|---|
  | Where the ability list lives | in the client code | folders on disk (code ships only 2 generic tools) | external process, asked via handshake |
  | Adding an ability | code change + redeploy | drop in a folder | the other side updates their server |
  | Who maintains it | you | you (docs + scripts) | someone else |

  Analogy: ④ a menu printed inside the restaurant (adding a dish = reprint), ⑤ the
  kitchen consulting its own recipe shelf (add a recipe book and it just works), ⑥
  ordering delivery (the menu is another restaurant's; they update, you get it for
  free). It's all the same move: getting context and tools in front of the model;
  what differs is the source and the trust boundary
- Want to go deeper: expand the "full article" at the bottom of the page

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
