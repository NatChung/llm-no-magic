# Lesson 4 — Tab ④ Agent: `<tool_call>` convention and real execution (+ course wrap-up)

> 中文版: [lesson-4-agent.zh-TW.md](./lesson-4-agent.zh-TW.md)

## Learning Objectives
1. Understand that Agent = model outputs a `<tool_call>` convention tag → client parses it → **actually executes** → result is fed back into the conversation
2. Read a multi-turn loop: each turn's output accumulates into the messages array until no more `<tool_call>` tags appear
3. Wrap-up: choosing between speaking tools vs. doing tools + the 60→90 framework

## Opening (no Q&A — go straight into the demo)

One line of framing: last lesson (Lesson 3), the same line `現在幾點?` — thinking could only
invent a time out of thin air. This lesson uses the same line, but this time the model
**actually** calls a tool and gets the real time — this is the payoff the whole ①→②→③→④ chain
has been building toward.

## Demo Segments (the first time you drive Tab ④ it loads the 4B model — banner waits 3-5 s — warn participants in advance)

### Segment 1 — What time is it? (get_time)
- **Picks up from last lesson (the payoff of the whole chain)**: the input box already holds `現在幾點?` — the exact line Lesson 3 closed on, auto-carried when you switched tabs. Last lesson even thinking could only invent a time out of thin air; this lesson, the same line and the same model **actually calls `get_time` and returns the real time** — this is the line the whole ①→②→③→④ chain has been building toward
- Preview: "The model has no clock. Guess how it knows the current time? Watch the purple '↑ Tool call' and green '↓ Tool result' blocks."
- Drive: `POST /drive {"tab":"4","user":"現在幾點?"}` → the page auto-switches to Tab ④ and renders; **the first drive triggers a 0.6B→4B swap — the loading banner runs 3-5 s** (the swap happens inside `/drive`; the page shows the banner on `swap_start`)
- Read: the turn trace — Turn 1 purple "↑ Tool call get_time" → green "↓ Tool result" → Turn 2's final answer (the current time, HH:MM:SS) → Debrief: Turn 1 — model outputs `<tool_call>{"name":"get_time"…}` → client actually runs Python to get the time → feeds result back into the conversation → Turn 2 can now answer. **The XML tag is just a convention; the client is what executes.** Contrast with last lesson: the same line, `現在幾點?` — thinking could only make one up, here it really got it — the difference is simply having a tool.

## Hands-On
Have participants type **a question that needs no tool** (e.g. `1+1 等於幾?`) into the input box themselves and submit it.
Watch the turn trace: this time there is **no** purple "↑ Tool call" — Turn 1 goes straight to the final answer.
Contrast with `現在幾點?` — same model, same prompt: **whether to use a tool is the model's own Turn-1 decision.** This is exactly why watching the "↑ Tool call" block tells you what it did this round.

## Reveal and Wrap-Up (whole-course close)

1. **The 50-transcripts task:** if you have 50 customer meeting transcripts on your machine and want AI to read all of them and extract what customers complain about most — how does it "actually" read your files? Just like `get_time`: a real, client-defined Python function reads the file; `<tool_call>` is just a convention tag, no magic. Ask participants: **"Now, how would you approach this task?"** Just note the answer — no need to compare against an "earlier" one.
2. **Skeleton solution for that task:** Agent (a file-reading tool reads files for real — a genuine client-defined function, just like today's get_time) → apply a summary template → spot-check a sample → if you need to reuse it, wrap it as a tool.
3. **Speaking tools vs. doing tools (walk participants through this table):**
   - Speaking tools (①②③): ChatGPT / Gemini — feed the right context (SOP/rules) into the chat box, set red lines, check the key claims. Line: context you can paste in full.
   - Doing tools (④⑤⑥): Claude Code / Codex — read your files, run commands, multi-step. Line: context too big / must auto-read files.
4. **The 60→90 framework:** Ask participants once: "Now that you've been through the whole chain (tokens → chat template → reasoning → agent), how would you handle Lesson 1's customer complaint reply with 'the same GPT'?" (Common extremes: still just paste & ask / paste the refund SOP + rules into the chat box, then check the promise lines.) Point out the difference: treating GPT like a wishing well and gambling it's right is the 60-point way; feeding the material, setting the rules, knowing which sentence to check is the 90-point way — same tool, and the difference isn't a pile of jargon learned, it's knowing which type of tool to hand a task to, how to use it properly, and what it's doing underneath.
5. **Post-course reading** (self-study, not covered in class): Tab ⑤ Skill, Tab ⑥ MCP article — covering "how to package today's things into reusable tools."

## Common Participant Questions
- "Won't it run rogue commands?" — Tools are defined by a client-side allowlist; this is exactly why you watch the "↑ Tool call" to confirm before it runs.
- "Why can't ChatGPT do this?" — The web app hasn't given it tools that reach your computer. It's not that the model is different — the client is different.
- "What's the difference between 4B and 0.6B?" — Function calling requires following the format convention precisely; small models often lose track of it. 4B is stable enough.
