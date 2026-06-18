# Lesson 2 — Tab ② Product-layer processing: system prompt & chat template

> 中文版: [lesson-2-product.zh-TW.md](./lesson-2-product.zh-TW.md)

## Learning objectives
1. See that the heart of the chat template is the "**Q: / A:**" structure — the markers label "this part is what the user **asked**, now it's the assistant's turn to **answer**", which is why the model *answers* instead of treating your words as a prompt to *continue*
2. Know that the system prompt is a **second knob** layered on top — it shapes **how** it answers (style/rules), not *whether* it answers
3. Connect back to Hook A: the "Q:/A:" structure and the system line are, in the model's eyes, both just tokens wrapped by `<|im_start|>…` — which is why pasting an SOP straight into the chat box works just as well

## Hook questions (ask first, don't reveal answers)
- "Same question — `一年有幾個月?` (how many months in a year?) — but with a line prepended: `你是行銷顧問,用條列式回答,只給 3 點。` (you are a marketing consultant, reply in bullet points, 3 points only). How different do you think the output will be? What changes?"
- "When ChatGPT receives your message, do you think the model sees exactly the string you typed?"

## Demo segments

### Segment 1 — Bare prompt (control group)
- Preview: "Let's see the unprocessed version first: the question is fed in as-is, with no structure at all."
- Via MCP: open http://localhost:9000/ → click Tab ② (Product-layer processing) → re-snapshot until the "Loading…" banner is gone
- Confirm the mode radio is set to "Bare prompt" → select preset `一年有幾個月?` → click Submit → wait until the Submit button is re-enabled
- Debrief: Output sprawls out and reads like a continuation, not an answer (it may even loop) — the model doesn't know you're *asking*; it treats `一年有幾個月?` as text to continue. With no "Q:/A:" structure, it can't tell who's asking and who's answering

### Segment 2 — Add chat template (Q:/A:) + system (how to answer)
- Preview: "Same question, this time wrapped into a 'Q:/A:' structure by the Qwen3 chat template, plus one system line for style. We'll first expand the 'final prompt actually sent to the model' to see what it really looks like."
- Via MCP: fill in the system field `你是行銷顧問,用條列式回答,只給 3 點。` → switch mode to "Product processing (chat)" → select preset `一年有幾個月?` → click to expand the "Final prompt actually sent to the model" preview
- Click Submit → wait until the Submit button is re-enabled → read the output (clean bulleted list)
- Debrief: Output becomes a clean bulleted list. Two things stack up:
  1. **The "Q:/A:" structure** (the main cause) — the markers tell the model "`<|im_start|>user` is the question, `<|im_start|>assistant` is your turn to answer", so it *answers* instead of continuing
  2. **The system line** (`你是行銷顧問,用條列式回答,只給 3 點。`) sits at the front and only governs **how** it answers (bullets, 3 points)
- Point to the `<|im_start|>` markers in the preview — each looks like 12 characters but the model sees it as 1 token (vocab id `151644`)

## Learner practice
Preset 2 — `夏季冰飲文案` (summer iced-drink copy): have learners run it raw once, then with the system prompt, and compare how structured the output becomes. Encourage them to edit the system prompt content (e.g. "reply in Taiwanese accent", "reply in exactly 1 sentence") and observe the output change accordingly.

## Reveal & recap
- Keep the two knobs separate: **the "Q:/A:" structure** decides *whether* it answers (vs continues), **the system line** decides *how* it answers (style/rules) — but in the model's eyes **both are just tokens wrapped by `<|im_start|>…`**
- Back to Hook A Q3: that's why "paste in the SOP + spell out the rules" works — ChatGPT's web interface doesn't expose a system-prompt field, but **it's all just text concatenated into tokens**; typing it into the chat box has the same effect
- One-liner summary: the product layer has no magic — it "types the 'Q:/A:' and the instructions on your behalf"

## Common questions
- "Is the system prompt more 'authoritative'?" — Training makes the model follow the system turn more readily, but fundamentally it's still tokens
- "Can I tell it to ignore the system prompt?" — That's exactly where prompt injection comes from; it's a convention, not enforcement
