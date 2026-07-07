# Lesson 1 — Tab ① Basics: Tokens & Probability Distributions

> 中文版: [lesson-1-basics.zh-TW.md](./lesson-1-basics.zh-TW.md)

## Learning Objectives
1. Understand that the model generates text one token at a time, sampling each step from a probability distribution
2. Be able to read a top-10 bar chart: peaked (high confidence) vs flat (uncertain what comes next)
3. Grasp that **peaked ≠ true**: confidence ≠ correctness

## Opening (no Q&A — go straight into the demo)

One line of framing: the model generates text "one token at a time," sampling each step from a
probability distribution; we'll use a top-10 bar chart to read how confident it is — peaked vs
flat — and the key point: **peaked ≠ true**.

## Demo Segments

### Segment 1 — Text the model has memorized (peaked)
- Set-up: "I'm going to drive the browser automatically: send `床前明月光,疑是地上` (the first lines of a classical poem the model has memorized) to a 0.6B model and watch the next token. Watch the probability chart on the right." (Collect a prediction first: what's the next character?)
- Drive: `POST /drive {"tab":"1","user":"床前明月光,疑是地上"}` → the page auto-switches to Tab ① and renders token by token
- Read: first token `霜`, top-1 94%+, peaked distribution → Narrate: the model has "memorized" the whole poem → peaked
- Inspect: `POST /inspect {"tokenIndex":0}` → the page pops up that token's probability chart
- **Always say this**: every token the model produces on screen is clickable, not just this one — click any of them to pop up its own probability chart (no need to repeat this in later segments, but make sure the learner knows it here first)

### Segment 2 — The made-up planet (peaked ≠ true)
- Set-up: "This time we send `祖樹星上最高的山叫做` — `祖樹星` is a planet I made up. Guess: will the model say 'I don't know', or will it invent a mountain name?" (Collect learner predictions first!)
- Drive: `POST /drive {"tab":"1","user":"祖樹星上最高的山叫做"}` → the page auto-switches to Tab ① and renders token by token
- Read: first token is still high-confidence, inventing a mountain name → Narrate: high confidence output anyway → peaked ≠ true
- Inspect: `POST /inspect {"tokenIndex":0}` → the page pops up that token's probability chart

### Segment 3 — No clear next token (flat)
- Set-up: "`他打開冰箱,拿出一包` ('He opened the fridge and took out a pack of') — what do you think the top-10 chart looks like?"
- Drive: `POST /drive {"tab":"1","user":"他打開冰箱,拿出一包"}` → the page auto-switches to Tab ① and renders token by token
- Read: top-10 spread across many candidates (candy / chips / chocolate / milk …), top-1 barely above 10% → Narrate: the shape of the distribution reflects the model's uncertainty
  (stopping at just `拿出` still leaves top-1 at 27% — not convincing enough; the added measure word `一包` forces a concrete-item guess and flattens it properly)
- Inspect: `POST /inspect {"tokenIndex":0}` → the page pops up that token's probability chart

## Learner Practice
Ask learners to try it themselves: type a different prompt and re-run, then click different tokens to see how the distribution shifts. Advanced: type the opening of a fact only their company would know, and watch the model confidently hallucinate (their own made-up planet).

## Reveal & Recap
- Connect back to Segment 2's made-up planet: if you used this to reply to a customer complaint, it wouldn't over-promise a refund because it's "bad" — it's because **it doesn't have your company's refund policy**. It can only do probability chaining, and it does so with full confidence. Hallucination isn't "ChatGPT can't be trusted" — it's "ChatGPT is missing that piece of knowledge."
- **Closing chain (sets up the next lesson):** drive Tab ① once more — `POST /drive {"tab":"1","user":"一年有幾個月?"}` ("How many months in a year?"). It's a normal question, but in pure chaining mode the model doesn't *answer* it — it just keeps continuing the text and gets stuck in a loop, never producing "12".
- **Right after the loop demo, ask the learner (collect a prediction — no answer yet):** "Same chaining engine — how do you think it gets turned into the ChatGPT you know, the one that properly answers a client's question?" Let them guess freely (common guesses: a bigger model, added search, a module that detects questions…). Record their guess — next lesson's demos will confirm or break it. This lands harder than just previewing "there's a hidden layer in between."
- Tell the learner: **remember this line, `一年有幾個月?` — next lesson the very same line auto-carries with you to the next tab** (it auto-fills the input box when you switch). We'll start from it to see "how chaining becomes Q&A" — and check their guess → Lesson 2

## Common Learner Questions
- "Isn't it looking things up in a database?" — No, pure token chaining. You just watched every candidate at every step.
- "0.6B is tiny — ChatGPT is smarter, right?" — Larger models produce better-calibrated distributions, but the mechanism is identical. They'll still hallucinate confidently.
- "Why does the same prompt give different answers each time?" — Sampling. The top-1 token isn't the only one that can get picked.
