# Lesson 3 — Tab ③ Reasoning: thinking is just writing thoughts as tokens

> 中文版: [lesson-3-reasoning.zh-TW.md](./lesson-3-reasoning.zh-TW.md)

## Learning objectives
1. Understand that thinking mode = the model first emits `<think>…</think>` reasoning tokens, then emits the answer
2. Experience how the same model's answer accuracy changes depending on whether it "has room to think"
3. Know which tasks benefit from enabling thinking (judgment calls / multi-step reasoning) and which don't (lookup-style short answers)

## Hook questions (ask first, don't reveal answers)
- "Dad has 3 apples, his son has 2 more than him — how many does the son have? Do you think a 0.6 B small model will get this right if it answers directly?"
- "Have you ever used ChatGPT's 'thinking…' mode? What do you think it's doing?"

## ⚠️ Prompt punctuation trap (read before teaching)

The apple problem is **extremely sensitive to punctuation** — send the wrong variant and the
whole contrast collapses. `agent/server.py`'s `/completion` call hardcodes `temperature: 0`
→ **fully deterministic, no sampling**: the same prompt always yields the same output. So
"just hit send a few more times and it'll eventually be wrong" does not work — you have to
send the right characters.

| What you send | Direct-mode answer |
|---|---|
| `爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?` (**halfwidth** `,` `?`, no spaces around digits) | **1** ❌ use this one |
| `爸爸有 3 顆蘋果，兒子多他 2 顆。請問兒子幾顆？` (fullwidth `，` `？`, or added spaces) | **5** ✅ contrast broken |

Halfwidth: the model sets up `x`, writes `x + 2 = 3` → solves to 1 (it read "the son has 2
more" backwards). Fullwidth: the model writes out "1. 2." steps → `3 + 2 = 5` — it performed
**chain-of-thought inside the visible answer**, getting it right with no `<think>` at all.

**Rule**: always send the text via `POST /drive`, or tell learners **not to edit the input
box** (`frontend/index.html:145` is pre-filled with the halfwidth version). Learners typing
it by hand easily produce the fullwidth form.

Backups (for a more robust wrong answer — all of these answer `2`, grabbing the last number
in the question because there's no room to write steps):
- Append `只回答一個數字。` ("Answer with a single number only.") to the question ← **recommended**, closest to a real production prompt
- Add a system prompt: `直接給答案,不要解釋、不要列步驟。` ("Answer directly, no explanation, no steps.")
- Prefill the assistant turn with `兒子有` ("The son has")

Tried and **did not work** (0.6B still gets these right — don't waste time): reversing the
problem (dad has 2 more than son), or adding a third step (a mother).

## Demo segments

### Segment 1 — Direct answer (wrong)
- **Picks up from last lesson**: the input box already holds `爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?` — the exact question Lesson 2 closed on, auto-carried when you switched tabs. Last lesson it *answered* but got it wrong (computing son = 1); this lesson we'll see how to make it answer correctly
- Preview: "Direct-answer mode = we force-inject an empty `<think></think>`, leaving the model no room to think — it just blurts out an answer. Guess what number it gives?"
- Drive: `POST /drive {"tab":"3","user":"爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?","mode":"direct"}` → the page auto-switches to Tab ③ and renders (the prompt reads: "Dad has 3 apples, son has 2 more than him — how many does the son have?")
- Read: it sets up `x`, writes `x + 2 = 3`, and solves to **son = 1** — it read "the son has 2 more than him" backwards → Narrate: it set up the wrong equation on step one and everything after follows that error; it's just completing "the most plausible next equation"

### Segment 2 — With thinking (usually correct)
- Preview: "Same question, but this time we let it write out its reasoning. Notice the screen gains a 'full reply (including `<think>`)' section."
- Drive: `POST /drive {"tab":"3","user":"爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?","mode":"thinking"}` → the page renders the thinking section + final answer
- Read: the thinking-content fills with `<think>…</think>`; the generated-text after `</think>` is the final answer (correctly 5) → Narrate: Look at the thinking section — the reasoning is genuinely written out one token at a time, not invisible magic — only after `</think>` does the final answer appear, and it's correct
- **Worth pointing out**: inside `<think>` the model **raises the "wait, did I read it backwards?" possibility itself and then rules it out** ("could '2 more than him' mean something else? … but the question clearly says the son has 2 more than dad"). Direct mode has no room to do that, so a wrong equation on step one is unrecoverable. The difference isn't intelligence — it's **having somewhere to double-check itself**
- Small heads-up: 0.6B often emits Simplified Chinese inside the thinking section (儿子, 苹果) — mention it so nobody asks

## Learner practice
Have learners change the numbers (dad has 7 apples, son has 3 fewer…) and run both modes; experience how thinking is slower but more reliable.

## Reveal & recap
- Compare against the Hook prediction: did you guess right? The difference isn't that the model became smarter — it's that **it was given room to write its reasoning as tokens**
- Connect back to Hook A: for judgment-heavy tasks like legal or liability questions, enabling thinking is more reliable; hard legal constraints should be written explicitly (e.g. "must not violate Article XX") — but the necessary knowledge (SOPs) still needs to be provided; thinking cannot fill a knowledge gap
- **Closing chain (sets up the next lesson):** hand it a different question — `現在幾點?` ("What time is it now?") — and **run both modes** (collect a prediction first: which mode can answer this?):
  - Direct first: `POST /drive {"tab":"3","user":"現在幾點?","mode":"direct"}` — no room to think; it usually just invents a time or instantly says it doesn't know
  - Then thinking: `POST /drive {"tab":"3","user":"現在幾點?","mode":"thinking"}` — watch the thinking section: the model reasons carefully, literally telling itself "I don't have a physical clock here… how would I know the current time?", and ends up **assuming / inventing a time / admitting it can't know**
  - Narrate the contrast with the apple problem: there, everything the answer needed was in the question text, so thinking helped; here the answer **simply doesn't exist** in the weights or the context — direct mode invents, thinking gets nowhere no matter how long it runs → **both roads are dead ends; it needs a tool.** Remember this line, `現在幾點?` — next lesson the same one auto-carries to the next tab, where it will really go and fetch the time → Lesson 4
  - **No spoilers**: tease only the outcome ("it will really get the time") — do **not** explain the mechanism (`<tool_call>`, the client actually executing, the result fed back). That reveal is the climax of Lesson 4 Segment 1; giving it away kills the "how could the model possibly get the real time?!" suspense (hold the blank even if this particular learner has already seen Tab ④)

## Common questions
- "Can we trust what's in the thinking section?" — It genuinely influences the answer token by token, but it can still reason incorrectly; important conclusions should still be verified
- "Why not always enable it?" — Slower and more expensive; no benefit for lookup-style short answers
