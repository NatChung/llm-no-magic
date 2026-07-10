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

Beat order (settled): **explain the skill first → fire → AI shows the prompt → walk the
round trips**.

- **1. Explain the skill first** (nothing sent yet — point at the left column's
  "Skill anatomy — one folder, three layers" card and walk the layers top-down;
  click a filename to see each layer's real content):
  - **L1** frontmatter (a few lines of yaml) — the "library catalog", the only thing
    the model permanently sees: what this pack is, when to use it, where its files
    live on disk — a few dozen tokens
  - **L2** the SKILL.md body — the full manual (how to check, what format to output),
    sitting on disk
  - **L3** the script — the code that does the real work, sitting on disk
  - Close with one line: "the manual and the script are still sitting on disk — not a
    single token has entered the context yet; all the model holds is L1's few catalog
    lines"
- **2. Fire**: `POST /drive {"tab":"5","user":"台北今天天氣怎樣?"}`
  (the first drive swaps to 4B — banner 3-5 s)
- **3. AI shows the prompt** (after the run, before walking the trace): call
  `POST /preview {"tab":"5","user":...,"mode":"proper"}`, paste the prompt into the
  chat colored as a ```diff block — the one-line takeaway: "the green parts contain not
  a single word of weather knowledge — just a catalog and two generic tools". (Coloring:
  `+` green = ours/editable, `-` red = training-time convention/immutable, unprefixed
  gray = template markers. Always inline in the chat — never a separate HTML/artifact)
- **4. Walk the round trips** (ping-pong reading: **the grey bubble at the top right is the
  student's own question** — everything on the right is "things coming in", the left is the
  model thinking): blue `read_file("skills/check_weather/SKILL.md")` → right amber
  "SKILL.md injected into context ← stuffed back into the prompt" (the context counter
  jumps a notch) → blue `run_script` → right purple returns
  `{"city":"台北","temp_c":28,...}` (the code never enters the context — only its
  output does) → green "台北:28°C, 晴" — the format is what SKILL.md dictated
- Key point to narrate: the model is using **generic tools** (read a file, run a script) —
  there is no skill-specific machinery at all. This is exactly Anthropic's official
  approach: a skill = file structure + convention, no magic
- For details: expand the amber bubble to see the full injected manual; the blue bubbles
  also each carry their own "▸ prompt actually sent this turn" expander — a `messages[]`
  JSON array snapshot right before that turn's call; expand "script source" under the
  purple bubble — you can see it, but the model never did; expand the green bubble's
  "actual prompt sent this turn" — the freshly injected L2 manual is sitting right inside
  `messages` (exactly what the amber bubble's hint line points at)

## Hands-On — no-skill contrast
Check "no-skill contrast" and send the same line again: the index is empty (the chip
above the anatomy card switches to an "index is empty" note), so the model
can only make something up (or honestly say it doesn't know). Contrast: same model, same
line — **the difference is whether there's a skill**. Meanwhile the AI uses `/preview`
to show both modes' prompts side by side: the no_skills version has no index at all —
the model doesn't even know skills exist.

## Reveal and Wrap-Up
- Back to Segment 1: a skill's L2 injection and "1+1=3" are the same thing — both stuff
  context into the prompt to change probabilities; the difference is that a skill is a
  **controlled** injection: who wrote it, whether it loads, which package loads —
  all visible
- Close the loop with the three interlocking proofs that "context changes probabilities":
  1. **Tab ① three-shot** (quantitative): the probability bars flip before your eyes —
     "2" at 86% → "3" at 87.5%
  2. **No-skill contrast** (behavioral): same model, same line; index present/absent →
     "28°C, sunny" becomes "I can't provide real-time information"
  3. **The sent expander** (physical evidence): open turn 2's actual prompt — SKILL.md
     is sitting right inside `messages`, the injection caught red-handed
  Proof 1 shows the mechanism exists, Tab ⑤ shows it engineered, 2 & 3 are the autopsy
- The token-cost chip above the anatomy card: read the two numbers as-is — progressive
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
- "How is a skill different from Tab ④'s tools?" — The difference is **how the ability
  list gets registered**. Tab ④ is a menu printed inside the restaurant: tool schemas are
  hard-coded in the client, so adding an ability = code change + redeploy. A skill is the
  kitchen consulting its own recipe shelf: the code ships only two generic tools (read a
  file, run a script) forever; adding an ability = dropping a folder into skills/, zero
  code changes. Ask the AI to show the prompt via `/preview` and check the `<tools>`
  block: **abilities grow, the tool list doesn't** — that's exactly why skills keep
  context cheap
- "How is L2 injection different from me pasting an SOP into the chat box myself?" —
  Essentially the same thing! A skill turns "you paste it by hand every time" into "the
  model fetches it on demand by itself", and it ships an executable script too
- "Why doesn't the code enter the context?" — The model doesn't need to see the code, only
  the result; putting the code in the context both burns tokens and risks it getting
  rewritten badly
