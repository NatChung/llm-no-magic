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
- Preview: "The model has no clock. Guess how it knows the current time? Watch the 'Agent trace': blue bubbles on the left are the model, purple bubbles on the right are the tools — it reads like a chat log."
- **AI shows the prompt** (there is no preview box on the page — this beat is performed
  by the AI): before driving, call `POST /preview {"user":"現在幾點?"}`, paste the
  returned prompt into the chat and explain its three layers: `<|im_start|>` role
  markers = the chat-template convention (Lesson 2), the English `# Tools` scaffold =
  a convention baked in at training time (cannot be changed), and the Chinese tool
  descriptions inside the `<tools>` JSON = the part we (the product layer) wrote and
  can change. (Coloring: use a ```diff code block — `+` green = ours/editable, `-` red = training-time convention/immutable, unprefixed gray = template markers. Always inline in the chat — never a separate HTML/artifact)
- Drive: `POST /drive {"tab":"4","user":"現在幾點?"}` → the page auto-switches to Tab ④ and renders; **the first drive triggers a 0.6B→4B swap — the loading banner runs 3-5 s** (the swap happens inside `/drive`; the page shows the banner on `swap_start`)
- Read: the bubble trace — round 1's blue model bubble `⟨tool_call⟩ get_time()` → the purple tool bubble on the right `returns "HH:MM:SS"` (↩ result fed back to the model) → the full-width green bubble "no tool_call → goes to you" (the current time); the summary on top reads "Model ⇄ tools: 1 round-trip, 2 rounds in total — only then your turn" → Debrief: round 1 — model outputs `<tool_call>{"name":"get_time"…}` → client actually runs Python to get the time → feeds result back into the conversation → round 2 can now answer. **The XML tag is just a convention; the client is what executes.** Contrast with last lesson: the same line, `現在幾點?` — thinking could only make one up, here it really got it — the difference is simply having a tool.
- The stream starts with your own question — a grey bubble on the right. Right side = things
  coming in; left side = the model thinking.
- **You (the AI) can click the expanders remotely**: `POST /inspect {"action":"expand","tab":"4","role":"sent","turn":1}`
  (collapse with `"action":"collapse"`; roles: `sent` = prompt sent to the AI, `raw` = the model's
  raw message, `final` = the raw message to the user; `turn` optional — omitted picks the last
  match). The page auto-switches to that tab and scrolls the expander into view. **Pacing: one at
  a time** — expand → explain → wait for the learner → collapse → next; never all at once
- For details: first name what's inside the fold — each ▸ expander opens a coloured, foldable
  "wire view" of the raw text; greys are the `<|im_start|>`/`<|im_end|>` template markers, and
  the arrows are what fold and unfold each block. Every bubble has exactly one ▸ expander, and
  it always shows *that bubble's own message*: right-side bubbles show what got sent to the
  model because of them; the left-side blue/green bubbles show what the model itself emitted.
  Walk the learner through all four: the grey user bubble ▸ "the prompt sent to the AI (turn 1)"
  — the templated prompt; expand it and the messages sit as a folded list, with your question
  (the highlighted "new this turn" one) already open. Click open the `<|im_start|> system`
  message and its `<tools>` block is right there — `get_time` sitting inside, **no tool result
  yet**; the blue
  bubble ▸ "the raw message the model emitted" — the `<tool_call>` tag itself; the purple tool
  bubble ▸ "the prompt sent to the AI (turn 2)" — the *same* prompt as the user bubble, now with
  the tool's result appended (noticeably longer); the green bubble ▸ "the raw message sent to
  you" — the model's final `<|im_start|>assistant` reply. Put the user bubble's prompt and the
  purple bubble's prompt side by side: same conversation, one tool result longer — that growth
  *is* the accumulation lesson. In each of those prompts, the last block (amber-tinted, tagged
  `← new this turn — being sent`) is the fresh input just appended this turn — the question on
  turn 1, the fed-back tool result after.

## Hands-On
Have participants type **a question that needs no tool** (e.g. `1+1 等於幾?`) into the input box themselves and submit it.
Watch the bubble trace: this time there's **no** blue-purple back-and-forth — just one green "goes to you" bubble, and the summary on top reads "No tool needed — the model answered you directly in 1 round".
Contrast with `現在幾點?` — same model, same prompt: **whether to use a tool is the model's own round-1 decision.** This is exactly why watching for a blue tool_call bubble tells you what it did this round.

## Reveal and Wrap-Up (whole-course close)

1. **The 50-transcripts task:** if you have 50 customer meeting transcripts on your machine and want AI to read all of them and extract what customers complain about most — how does it "actually" read your files? Just like `get_time`: a real, client-defined Python function reads the file; `<tool_call>` is just a convention tag, no magic. Ask participants: **"Now, how would you approach this task?"** Just note the answer — no need to compare against an "earlier" one.
2. **Skeleton solution for that task:** Agent (a file-reading tool reads files for real — a genuine client-defined function, just like today's get_time) → apply a summary template → spot-check a sample → if you need to reuse it, wrap it as a tool.
3. **Speaking tools vs. doing tools (walk participants through this table):**
   - Speaking tools (①②③): ChatGPT / Gemini — feed the right context (SOP/rules) into the chat box, set red lines, check the key claims. Line: context you can paste in full.
   - Doing tools (④⑤⑥): Claude Code / Codex — read your files, run commands, multi-step. Line: context too big / must auto-read files.
4. **The 60→90 framework:** Ask participants once: "Now that you've been through the whole chain (tokens → chat template → reasoning → agent), how would you handle Lesson 1's customer complaint reply with 'the same GPT'?" (Common extremes: still just paste & ask / paste the refund SOP + rules into the chat box, then check the promise lines.) Point out the difference: treating GPT like a wishing well and gambling it's right is the 60-point way; feeding the material, setting the rules, knowing which sentence to check is the 90-point way — same tool, and the difference isn't a pile of jargon learned, it's knowing which type of tool to hand a task to, how to use it properly, and what it's doing underneath.
5. **Post-course reading** (self-study, not covered in class): Tab ⑤ Skill, Tab ⑥ MCP article — covering "how to package today's things into reusable tools."

## Common Participant Questions
- "Won't it run rogue commands?" — Tools are defined by a client-side allowlist; this is exactly why you watch the blue tool_call bubble to confirm what it's calling.
- "Why can't ChatGPT do this?" — The web app hasn't given it tools that reach your computer. It's not that the model is different — the client is different.
- "What's the difference between 4B and 0.6B?" — Function calling requires following the format convention precisely; small models often lose track of it. 4B is stable enough.
