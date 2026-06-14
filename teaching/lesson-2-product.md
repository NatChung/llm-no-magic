# Lesson 2 — Tab ② Product-layer processing: system prompt & chat template

> 中文版: [lesson-2-product.zh-TW.md](./lesson-2-product.zh-TW.md)

## Learning objectives
1. Understand that "product-layer processing" = **concatenating more text** before and after your words before sending to the model (no other magic involved)
2. Read and recognise `<|im_start|>system / user / assistant` role-boundary markers
3. Connect back to Hook A: pasting an SOP into the chat box works precisely because "it's all just text concatenated into tokens"

## Hook questions (ask first, don't reveal answers)
- "Same question — `一年有幾個月?` (how many months in a year?) — but with a line prepended: `你是行銷顧問,用條列式回答,只給 3 點。` (you are a marketing consultant, reply in bullet points, 3 points only). How different do you think the output will be? What changes?"
- "When ChatGPT receives your message, do you think the model sees exactly the string you typed?"

## Demo segments

### Segment 1 — Bare prompt (control group)
- Preview: "Let's see the unprocessed version first: the question is fed in as-is, and the model treats it like a completion task."
- Run: `python3 teaching/demos/demo_tab2.py --segment 1 --lang en`
- Debrief: Output sprawls out and reads like a continuation, not an answer — the model has no idea "who is asking whom"

### Segment 2 — Add system prompt + chat template
- Preview: "Same question, now wrapped with a system prompt and the Qwen3 chat template. We'll first expand the 'final prompt actually sent to the model' so you can see the markers."
- Run: `python3 teaching/demos/demo_tab2.py --segment 2 --lang en`
- Debrief: Output becomes a clean bulleted list. Focus on the preview: how `<|im_start|>system…<|im_end|>` wraps your text; the marker looks like 12 characters but the model sees it as 1 token (vocab id `151644`)

## Learner practice
Preset 2 — `夏季冰飲文案` (summer iced-drink copy): have learners run it raw once, then with the system prompt, and compare how structured the output becomes. Encourage them to edit the system prompt content (e.g. "reply in Taiwanese accent", "reply in exactly 1 sentence") and observe the output change accordingly.

## Reveal & recap
- Back to Hook A Q3: now you know why "paste in the SOP + spell out the rules" works — ChatGPT's web interface doesn't expose a system-prompt field, but **it's all just text concatenated into tokens**; typing it into the chat box has the same effect
- One-liner summary: the product layer has no magic — it's "typing on your behalf"

## Common questions
- "Is the system prompt more 'authoritative'?" — Training makes the model follow the system turn more readily, but fundamentally it's still tokens
- "Can I tell it to ignore the system prompt?" — That's exactly where prompt injection comes from; it's a convention, not enforcement
