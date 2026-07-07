# Lesson 3 — Tab ③ Reasoning: thinking is just writing thoughts as tokens

> 中文版: [lesson-3-reasoning.zh-TW.md](./lesson-3-reasoning.zh-TW.md)

## Learning objectives
1. Understand that thinking mode = the model first emits `<think>…</think>` reasoning tokens, then emits the answer
2. Experience how the same model's answer accuracy changes depending on whether it "has room to think"
3. Know which tasks benefit from enabling thinking (judgment calls / multi-step reasoning) and which don't (lookup-style short answers)

## Hook questions (ask first, don't reveal answers)
- "Dad has 3 apples, his son has 2 more than him — how many does the son have? Do you think a 0.6 B small model will get this right if it answers directly?"
- "Have you ever used ChatGPT's 'thinking…' mode? What do you think it's doing?"

## Demo segments

### Segment 1 — Direct answer (often wrong)
- **Picks up from last lesson**: the input box already holds `爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?` — the exact question Lesson 2 closed on, auto-carried when you switched tabs. Last lesson it *answered* but got it wrong (computing son = 1); this lesson we'll see how to make it answer correctly
- Preview: "Direct-answer mode = we force-inject an empty `<think></think>`, leaving the model no room to think — it just blurts out an answer. Guess what number it gives?"
- Drive: `POST /drive {"tab":"3","user":"爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?","mode":"direct"}` → the page auto-switches to Tab ③ and renders (the prompt reads: "Dad has 3 apples, son has 2 more than him — how many does the son have?")
- Read: small models answering directly often get it wrong (saying 3 apples, or some random number) → Narrate: they're just completing "the most plausible next number"

### Segment 2 — With thinking (usually correct)
- Preview: "Same question, but this time we let it write out its reasoning. Notice the screen gains a 'full reply (including `<think>`)' section."
- Drive: `POST /drive {"tab":"3","user":"爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?","mode":"thinking"}` → the page renders the thinking section + final answer
- Read: the thinking-content fills with `<think>…</think>`; the generated-text after `</think>` is the final answer (often correctly 5) → Narrate: Look at the thinking section — the reasoning is genuinely written out one token at a time, not invisible magic — only after `</think>` does the final answer appear, and it's usually correct

## Learner practice
Have learners change the numbers (dad has 7 apples, son has 3 fewer…) and run both modes; experience how thinking is slower but more reliable.

## Reveal & recap
- Compare against the Hook prediction: did you guess right? The difference isn't that the model became smarter — it's that **it was given room to write its reasoning as tokens**
- Connect back to Hook A: for judgment-heavy tasks like legal or liability questions, enabling thinking is more reliable; hard legal constraints should be written explicitly (e.g. "must not violate Article XX") — but the necessary knowledge (SOPs) still needs to be provided; thinking cannot fill a knowledge gap
- **Closing chain (sets up the next lesson):** with thinking still on, hand it a different question — `POST /drive {"tab":"3","user":"現在幾點?","mode":"thinking"}` ("What time is it now?"). Watch the thinking section: the model reasons carefully, but partway through it literally says to itself "I don't have a physical clock here… how would I know the current time?" and ends up **assuming / inventing a time out of thin air**. Tell the learner: **even thinking can't get the real time — it needs a tool.** Remember this line, `現在幾點?` — next lesson the same one auto-carries to the next tab, where it will really go and fetch the time → Lesson 4

## Common questions
- "Can we trust what's in the thinking section?" — It genuinely influences the answer token by token, but it can still reason incorrectly; important conclusions should still be verified
- "Why not always enable it?" — Slower and more expensive; no benefit for lookup-style short answers
