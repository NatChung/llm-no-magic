# Lesson 2 — Tab ② Q&A: How Chaining Becomes Q&A

> 中文版: [lesson-2-product.zh-TW.md](./lesson-2-product.zh-TW.md)

## Learning Objectives
1. Understand that a "Q: A:" structure is **just text** — the model learned "switch to answer
   mode when you see 'A:'" from the mountain of Q&A-formatted text in its training data (FAQs,
   exam papers, dictionaries), not from some special mechanism that "understands you're asking
   a question"
2. See that the real chat template (`<|im_start|>user...<|im_end|>...<|im_start|>assistant`)
   does the exact same thing, just swapping hand-typed "Q:"/"A:" for **reserved tokens whose
   boundary meaning was assigned during training** — the payoff is a clean stop signal, so it
   doesn't spiral into generating the next round of Q&A on its own like the hand-typed version

## Entry Question (picks up from Lesson 1)

In Lesson 1 you watched the model do pure chaining — confidently continuing even a planet you
made up. So here's the question:

> **It's the same chaining mechanism — so why does ChatGPT look like it's *answering a
> question*, instead of just continuing your text?**

Don't answer yet. Let the demo show it.

## Hook Questions (ask first — no answers yet)
- "Do you think what the model sees, when ChatGPT receives your message, is literally the
  string of characters you typed?"

## Demo Segments

### Segment 1 — Raw prompt (the same chaining as Lesson 1)
- Set-up: "First, zero processing: `一年有幾個月?` ('How many months in a year?') goes to the
  model exactly as-is, treated as pure chaining." (Collect a prediction: will it answer
  directly?)
- **Picks up from last lesson**: notice `一年有幾個月?` is already sitting in the input box — it's
  the exact line Lesson 1 closed on, auto-carried when you switched tabs. **The same line, and
  switching tabs it still just loops** — we'll use this very line to watch it go from "looping"
  to "answering."
- Drive: `POST /drive {"tab":"2","user":"一年有幾個月?","mode":"raw"}` → the page
  auto-switches to Tab ② and renders
- Read (measured): it loops on "有沒有其他月份的特殊性?" ("anything else special about the
  other months?") — never answers, treats your question as the opening of an FAQ article and
  keeps generating the "next question," stuck in a loop
- Narrate: the exact same mechanism as Lesson 1 — it doesn't know you're "asking," it's just
  continuing whatever the text looks like it should continue with

### Segment 2 — Hand-typed "Q: A:", still pure chaining (no special tokens)
- Set-up: "Same 'pure chaining' mode, but this time I'm adding two literal markers to the
  text myself: `問:` ('Q:') and `答:` ('A:'). Guess whether that changes anything?" (Collect a
  prediction first!)
- Drive: `POST /drive {"tab":"2","user":"問:一年有幾個月?\n答:","mode":"raw"}`
- Read (measured): it opens with "一年有12个月。" ("A year has 12 months.") — **correct!** But
  then it keeps generating another round on its own: "問:一年有幾個月?\n答:一年有12个月。"
  repeating, because this is still plain text with no formal "stop here" signal
- Narrate (the single most important beat of this lesson): **you just typed two extra
  characters — "Q:" and "A:" — with zero special functionality, and the model flipped from
  chaining mode into answering mode.** Why? Because its training data is packed with
  Q&A-formatted text; it's seen "Q: X A: Y" so many times it learned the pattern: when "A:"
  shows up, continue with something that looks like an answer. **That's the entire secret
  behind the product layer's "Q&A feel" — no magic, just a text pattern.**
  But notice the side effect: it keeps looping into the next round, because plain text has no
  explicit boundary telling it "stop now" — which sets up exactly what the real chat template
  is for

### Segment 3 — The real chat template (special tokens, still no system prompt)
- Set-up: "Now let's wrap it in Qwen3's actual chat template, still with no system prompt at
  all, and see what's different."
- Drive: `POST /drive {"tab":"2","user":"一年有幾個月?","mode":"chat"}` (system left blank)
- Read (measured): a clean "一年有**12个月**。" — no runaway loop like Segment 2
- Narrate: look at the always-visible "prompt actually sent to the model" block — see
  `<|im_start|>user\n一年有幾個月?<|im_end|>\n<|im_start|>assistant\n`. It's the same move as
  Segment 2's "Q:...A:", but this time the boundary isn't ordinary text — it's
  `<|im_start|>`/`<|im_end|>`, **reserved tokens whose structural meaning was assigned during
  training** (each is a single unique token id in the vocabulary, e.g. 151644). The model
  learned that seeing this token means "this is a hard role-switch point," and it can never be
  confused with ordinary text, so it can cleanly recognize "the answer is done, stop." Segment
  2's "Q:"/"A:" are ordinary characters the model could just as easily generate as content
  itself — they can't be trusted as a reliable boundary
- **Explain this part directly to the learner, in speech, not through the screen**:
  `<|im_start|>` written out like that is just a human-readable display convention — to the
  model it's an ordinary token id in the vocabulary, a candidate exactly like "霜" or "12," it
  just happens to have been assigned "role boundary" meaning during training. **This is what
  "convention" actually means here — meaning assigned by training, not a grammar rule.**
  While you're at it, note that this demo never turns thinking mode on (no `<think>` block) —
  that's deliberately kept out so reasoning text doesn't muddy what this lesson is showing;
  thinking is next lesson's topic

## Learner Practice
Have learners try their own question: first raw mode with a hand-typed "Q:"/"A:" to see if it
gets the same lift; then switch to chat mode with the same sentence and contrast "clean answer,
no loop" against the hand-typed version spiraling into more questions.

## Reveal & Recap
- The gap between Segment 1 → 2 comes purely from typing two extra characters, "Q:" and "A:"
  — this lesson's biggest punchline: **the product layer's "Q&A feel" isn't a new mechanism,
  it's a text pattern**
- The gap between Segment 2 → 3 is that text pattern upgrading into a special token whose
  meaning was assigned by training — gaining a clean stop boundary, which is exactly why real
  products use a chat template instead of hand-typed "Q:"/"A:"
- Back to the Hook: so what the model sees was never literally the string you typed — before
  you hit send, the product layer already wrapped it into text carrying boundary tokens
- **Closing chain (sets up the next lesson):** hand it a different question —
  `POST /drive {"tab":"2","user":"爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?","mode":"chat"}`
  ("Dad has 3 apples, son has 2 more than him — how many does the son have?"). This time it
  **actually answers** (unlike Lesson 1, which only looped) — but watch closely: it starts
  laying out algebra and sets the relationship backwards (letting son = x, dad = x+2 = 3, heading
  toward son = 1; the correct answer is 5), and runs out at the token cap before finishing. Tell
  the learner: **it answers now — but is it right?** Remember this question — next lesson the same
  one auto-carries to the next tab, and we'll see how to make it answer correctly → Lesson 3

## Common Learner Questions
- "So is typing my own 'Q:...A:' just as good as a real chat template?" — Similar effect, but
  no formal stop boundary, so it can spiral out of control like Segment 2; and if the user's
  own input happens to contain text like "Q:", roles get confused easily — this is exactly why
  reserved tokens exist
- "Where did the 'you are a ...' role setup from ChatGPT go?" — That's a different layer (the
  system segment), also just text concatenated into the same token stream; this lesson stays
  focused on 'how chaining becomes Q&A' — role setup isn't the focus of this tab
