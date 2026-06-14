# Lesson 1 — Tab ① Basics: Tokens & Probability Distributions

> 中文版: [lesson-1-basics.zh-TW.md](./lesson-1-basics.zh-TW.md)

## Learning Objectives
1. Understand that the model generates text one token at a time, sampling each step from a probability distribution
2. Be able to read a top-10 bar chart: peaked (high confidence) vs flat (uncertain what comes next)
3. Grasp that **peaked ≠ true**: confidence ≠ correctness

## Hook Questions (ask first — no answers yet; record learner responses to revisit in Lesson 4)

Read the scenario to the learner (or show it on screen):

> A customer emails in to complain: the product is defective, they want a refund, and they're clearly annoyed.
> Your plan: paste the complaint into ChatGPT, ask it to write a sincere apology that doesn't over-promise
> compensation, glance at it, and send it.

Ask each question in order:
- **Q1.** Would you send the reply ChatGPT writes directly to the customer? (`Yes, handy / Yes, but I'd re-read it / No / Not sure`)
- **Q2.** Do you trust it won't spontaneously promise a refund or extra compensation on its own? (`Trust it / Half-trust / Don't trust`)
- **Q3.** What would you type in the chat box first to get a better reply? (Multiple choice: `Nothing — just paste & ask / Paste in refund policy / SOP / Spell out tone & rules / Never thought about it`)
- **Q4.** (Optional) How do you actually prompt it today?

## Demo Segments

### Segment 1 — Text the model has memorized (peaked)
- Set-up: "I'm going to drive the browser automatically: send `床前明月光,疑是地上` (the first lines of a classical poem the model has memorized) to a 0.6B model and watch the next token. Watch the probability chart on the right." (Collect a prediction first: what's the next character?)
- Run: `python3 teaching/demos/demo_tab1.py --segment 1 --lang en`
- On screen: select preset → submit → tokens appear one by one → click the first token → top-10 bar chart
- Debrief: it completes with `霜`, top-1 94%+ (next-best only 3%) — the model has "memorized" the whole poem; completion is not a database lookup, it's probability. This is what **peaked** looks like: high confidence

### Segment 2 — The made-up planet (peaked ≠ true)
- Set-up: "This time we send `祖樹星上最高的山叫做` — `祖樹星` is a planet I made up. Guess: will the model say 'I don't know', or will it invent a mountain name?" (Collect learner predictions first!)
- Run: `python3 teaching/demos/demo_tab1.py --segment 2 --lang en`
- Debrief: high confidence output anyway → peaked only means "it finds this continuation natural" — not that it's true

### Segment 3 — No clear next token (flat)
- Set-up: "`他打開冰箱,拿出` ('He opened the fridge and took out') — what do you think the top-10 chart looks like?"
- Run: `python3 teaching/demos/demo_tab1.py --segment 3 --lang en`
- Debrief: water / eggs / beer … spread across many candidates → the shape of the distribution reflects the model's uncertainty

## Learner Practice
Ask learners to try it themselves: switch to a different preset and re-run, then click different tokens to see how the distribution shifts. Advanced: type the opening of a fact only their company would know, and watch the model confidently hallucinate (their own made-up planet).

## Reveal & Recap (cross-reference Hook answers)
- Pull up each learner's Q2 answer, and connect it to Segment 2: the model doesn't over-promise because it's "bad" — it's because **it doesn't have your company's refund policy**. It can only do probability chaining, and it does so with full confidence. Hallucination isn't "ChatGPT can't be trusted" — it's "ChatGPT is missing that piece of knowledge."
- Preview next lesson: the fix is to inject that knowledge (system prompt / paste in the SOP) → Lesson 2

## Common Learner Questions
- "Isn't it looking things up in a database?" — No, pure token chaining. You just watched every candidate at every step.
- "0.6B is tiny — ChatGPT is smarter, right?" — Larger models produce better-calibrated distributions, but the mechanism is identical. They'll still hallucinate confidently.
- "Why does the same prompt give different answers each time?" — Sampling. The top-1 token isn't the only one that can get picked.
