# Lesson 5 — Tab ⑤ Skill: context decides the answer, and a skill is context injected on demand

> 中文版: [lesson-5-skill.zh-TW.md](./lesson-5-skill.zh-TW.md)

## Learning Objectives
1. Feel that "context directly changes the probability distribution": what you stuff into the prompt can flip the answer
2. Know that skill = L1 index always resident + L2 manual injected on demand + L3 script that only returns its result
3. Read the context counter: how much got injected, and why you don't stuff the whole package in

## Opening (no Q&A — go straight into the demo)

One line of framing: Lesson 1 showed the "distribution"; this lesson first shows how context
*changes* the distribution, then how a skill turns "changing the distribution" into a
manageable capability package.

## Demo Segments

### Segment 1 — context flips the answer (Tab ①, three drives back to back)
- Drive: `POST /drive {"tab":"1","user":"1+1="}` → top-1 "2" at about 86%
- Drive: `POST /drive {"tab":"1","user":"1+1=3。那麼 1+1="}` → top-1 is still "2",
  but "3" climbs from 0% to about 28% — a single false sentence already skews the distribution
- Drive: `POST /drive {"tab":"1","user":"1+1=3。1+1=3。1+1="}` → top-1 flips to "3"
  (about 87%) — feed it enough and the answer flips over completely
- Narration: context is not "reference material" — it directly changes the probability at
  every step; wrong context gets you wrong answers, and the right context (your company's
  SOPs, rules) is exactly how answers get made right

### Segment 2 — skill: turning "inject context" into a capability package (Tab ⑤)
- Preview: "At the start the model can only see the index on the left (L1, ~a few dozen
  tokens). Watch it decide by itself which package to load, and watch the context counter
  jump the moment it loads."
- Drive: `POST /drive {"tab":"5","user":"台北今天天氣怎樣?"}` (the first drive swaps to 4B — banner 3-5 s)
- Read: blue bubble `⟨tool_call⟩ load_skill("check_weather")` → amber block
  "SKILL.md body injected into context" (the context counter jumps a notch) → blue bubble
  calls `run_skill_script` → purple bubble returns `{"city":"台北","temp_c":28,...}` (the
  code never enters the context — only its output does) → green "台北:28°C, 晴" — the
  format is what SKILL.md dictated
- For details: expand the amber block to see the full injected manual; expand "script
  source" under the purple bubble — you can see it, but the model never did

## Hands-On — no-skill contrast
Check "no-skill contrast" and send the same line again: the index is empty, so the model
can only make something up (or honestly say it doesn't know). Contrast: same model, same
line — **the difference is whether there's a skill**.

## Reveal and Wrap-Up
- Back to Segment 1: a skill's L2 injection and "1+1=3" are the same thing — both stuff
  context into the prompt to change probabilities; the difference is that a skill is a
  **controlled** injection: who wrote it, whether it loads, which package loads —
  all visible
- The token-cost chip at the top left: read the two numbers as-is — progressive
  loading costs ~M tokens now vs ~N if everything were stuffed into the system
  prompt. (With a single small skill the gap is modest — the POINT is the
  direction: every pack you add widens it, and stuffing scales with ALL packs
  while progressive scales with the ONE you load.)
- One map to close the loop — four packagings of the SAME mechanism (context
  injection changes the distribution, exactly like "1+1=3"):
  - prompt engineering = hand-written injection
  - RAG = retrieved injection
  - a skill = governed, on-demand injection (who wrote it, whether and what
    loads — all visible)
  - context management = deciding what to inject and what to evict
  Expand verbally only if a student asks; a real RAG demo needs
  embeddings/retrieval and is out of scope for this tool (課後延伸).
- Teaser for the next lesson: so far every tool lives on your machine (the skill's script,
  Tab ④'s get_time). Next lesson: what if the tool lives in **someone else's process**?
  → Lesson 6

## Common Participant Questions
- "How is a skill different from Tab ④'s tools?" — Tab ④'s tools are hard-coded in the
  client; a skill adds the "manual" layer: inject the how-to first, then follow it — and
  capability packages can keep being added
- "How is L2 injection different from me pasting an SOP into the chat box myself?" —
  Essentially the same thing! A skill turns "you paste it by hand every time" into "the
  model fetches it on demand by itself", and it ships an executable script too
- "Why doesn't the code enter the context?" — The model doesn't need to see the code, only
  the result; putting the code in the context both burns tokens and risks it getting
  rewritten badly
