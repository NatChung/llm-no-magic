# Lesson 4 — Tab ④ Agent: `<tool_call>` convention and real execution (+ course wrap-up)

> 中文版: [lesson-4-agent.zh-TW.md](./lesson-4-agent.zh-TW.md)

## Learning Objectives
1. Understand that Agent = model outputs a `<tool_call>` convention tag → client parses it → **actually executes** → result is fed back into the conversation
2. Read a multi-turn loop: each turn's output accumulates into the messages array until no more `<tool_call>` tags appear
3. Wrap-up: choosing between speaking tools vs. doing tools + the 60→90 framework

## Hook Questions (ask first, don't give answers, note responses)

Read this scenario aloud to participants:

> Back in Lesson 1 we talked about "reply using our company's real policy" — that kind of work that needs to touch your company files, ChatGPT can't reach.
> Now look at a task that truly needs to act on your computer: you have 50 customer meeting transcripts on your machine, and you want AI to read all of them and extract what customers complain about most. You've heard that Claude Code / Codex can directly read files on your computer.

- **Q1.** For this kind of "read 50 local files" work, would you hand it to Claude Code / Codex?
  (Yes, I roughly know how / I know the direction but can't do it / No idea where to start)
- **Q2.** Do you know how it "actually" reads your files?
  (I know / Roughly / Feels like magic)
- **Q3.** (Optional) If you were going to do this, what would you use?

## Demo Segments (the first time you switch to Tab ④ it loads the 4B model — banner waits 3-5 s — warn participants in advance)

### Segment 1 — What time is it? (get_time)
- Preview: "The model has no clock. Guess how it knows the current time? Watch the purple '↑ Tool call' and green '↓ Tool result' blocks."
- Run: `python3 teaching/demos/demo_tab4.py --segment 1 --lang en`
- Debrief: Turn 1 — model outputs `<tool_call>{"name":"get_time"…}` → client actually runs Python to get the time → feeds result back into the conversation → Turn 2 can now answer. **The XML tag is just a convention; the client is what executes.**

### Segment 2 — Count .md files (exec_bash)
- Preview: "This time it will run a shell command and actually count files in this repo."
- Run: `python3 teaching/demos/demo_tab4.py --segment 2 --lang en`
- Debrief: Expand the "resend" details in the turn block — see how the conversation accumulates round by round to become the next input.

## Hands-On
Preset 2 "Read + Write Summary": participants submit it themselves. When it finishes, open `~/Desktop/llm-summary.md` — **the file is really there.**
That is the difference between a "doing tool" and a "speaking tool."

## Reveal and Wrap-Up (whole-course close — compare against Lesson 1 and this lesson's Hook answers)

1. **Replay Hook B + re-ask (the after question):** If you chose "Feels like magic" for Q2 — now you've seen it: `read_file` is a real Python function, `<tool_call>` is a convention tag, no magic. Then ask:
   **"Now that you've seen this, how would you approach that task (50 transcripts)?"** Note the answer and compare it with their Q3 answer from before the lesson.
2. **Skeleton solution for the 50-transcripts task:** Agent (read_file reads files for real) → apply a summary template → spot-check a sample → if you need to reuse it, wrap it as a tool.
3. **Speaking tools vs. doing tools (walk participants through this table):**
   - Speaking tools (①②③): ChatGPT / Gemini — feed the right context (SOP/rules) into the chat box, set red lines, check the key claims. Line: context you can paste in full.
   - Doing tools (④⑤⑥⑦): Claude Code / Codex — read your files, run commands, multi-step. Line: context too big / must auto-read files.
4. **The 60→90 framework (replay participants' Lesson 1 Hook answers so they can see how their judgment changed):**
   First, **re-ask the Hook A after question:** "Right now, with 'the same GPT', how would you handle that customer complaint reply?"
   (Still just paste & ask / Paste the refund SOP + rules into the chat box, then check the promise lines / I get it, but I'd rather write this one myself)
   Compare with their Lesson 1 Q1–Q3: before = treat GPT like a wishing well and gamble it's right; after = you feed the material, set the rules, know which sentence to check — same tool, going from 60 to 90. Not learning a bunch of jargon, but knowing which type of tool to hand a task to, how to use it properly, and what it's doing underneath.
5. **Post-course reading** (self-study, not covered in class): Tab ⑤ Commands/Script/API, Tab ⑥ Skill, Tab ⑦ MCP articles + Tab ⑧ Summary — covering "how to package today's things into reusable tools."

## Common Participant Questions
- "Won't it run rogue commands?" — Tools are defined by a client-side allowlist; this is exactly why you watch the "↑ Tool call" to confirm before it runs.
- "Why can't ChatGPT do this?" — The web app hasn't given it tools that reach your computer. It's not that the model is different — the client is different.
- "What's the difference between 4B and 0.6B?" — Function calling requires following the format convention precisely; small models often lose track of it. 4B is stable enough.
