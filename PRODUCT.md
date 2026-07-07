# Product

## Register

product

## Users

Two related audiences using the same UI:
- **The creator/maintainer (Nat)**, working solo at his desk, no audience — the primary lens for this design brief.
- **Students following a live-taught lesson**, where an AI narrates while the student watches the page reflect each action. The student isn't scrutinizing pixels — they're watching numbers/text change while being talked through it — so the design should stay legible and calm under that use too, but it is not the primary optimization target (no projector/big-screen requirement was called out).

Job to be done: watch a local LLM's literal token-by-token behavior (probabilities, chat template assembly, reasoning, tool calls) closely enough to build accurate intuition about how it works — replacing vague "AI is magic" mental models with mechanical ones.

## Product Purpose

A hands-on, fully-local LLM teaching tool: a 6-tab web UI (①–⑥; ①–④ interactive, ⑤ an interactive Skill preview, ⑥ a static article) served by a stdlib Python server, driving llama.cpp + Qwen3 GGUF models. Each tab makes one layer of "how LLMs actually work" visible and pokeable — tokens/probabilities, chat templates, thinking mode, function-calling agents — so a learner sees the mechanism directly instead of reading about it. Success = confidence ≠ correctness, system prompts, thinking, and tool-calling all become viscerally obvious after a few minutes of watching real model output.

## Brand Personality

- Reference anchor: Notion / Stripe docs — light, clean, document/editorial feel.
- Three words: **plain, transparent, precise** — a direct match for the "no magic" premise: nothing about the interface itself should feel hidden or decorative.
- Voice: matter-of-fact and technical without being cold. The interface should read like well-organized documentation, not like a marketed product.

## Anti-references

- Generic SaaS marketing feel: gradient hero sections, big rounded icon+heading+text cards.
- Flowery/gamified: colorful badges, progress-bar animations, celebratory micro-interactions.
- Enterprise dashboard cliché: navy+cream palettes, dense identical card grids.
- Anything decorative that isn't carrying real information — this app's entire pitch is "no magic," so the chrome must not contradict that with visual sleight of hand.

## Design Principles

1. **Show, don't decorate** — the model's actual output and probability numbers are the content; UI chrome recedes behind them.
2. **Document-reading calm** — generous whitespace, restrained color, quiet type hierarchy, closer to reading clear docs than "using an app."
3. **Color and motion only when they carry information** — e.g. a probability bar's height/color communicates confidence; nothing is colored or animated purely for polish.
4. **One visual language across all 6 tabs** — a learner moves through ①→⑥ in one sitting, so typography, spacing, and component patterns must stay consistent tab to tab.

## Accessibility & Inclusion

No specific requirement stated by the user. Default to solid contrast (WCAG AA) and never rely on color alone to convey state (e.g. peaked vs. flat probability distributions should also be readable from bar length/labels, not color alone).
