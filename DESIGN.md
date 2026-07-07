---
name: LLM, no magic
description: A hands-on, fully-local LLM teaching tool — tokens, probabilities, chat templates, and agent tool-calls made visible.
colors:
  ink: "oklch(20% 0.012 280)"
  ink-soft: "oklch(34% 0.010 280)"
  muted: "oklch(50% 0.008 280)"
  faint: "oklch(65% 0.006 280)"
  surface: "oklch(98% 0.008 280)"
  surface-2: "oklch(95% 0.011 280)"
  edge: "oklch(89% 0.012 280)"
  edge-soft: "oklch(91.5% 0.010 280)"
  final: "oklch(55% 0.20 255)"
  final-tint: "oklch(96% 0.045 255)"
  tool: "oklch(54% 0.22 320)"
  tool-tint: "oklch(96% 0.030 320)"
  result: "oklch(50% 0.15 145)"
  result-tint: "oklch(96% 0.026 145)"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, 'PingFang TC', 'Helvetica Neue', sans-serif"
    fontSize: "clamp(1.25rem, 2vw, 1.875rem)"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "ui-sans-serif, system-ui, 'PingFang TC', 'Helvetica Neue', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "ui-sans-serif, system-ui, 'PingFang TC', 'Helvetica Neue', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "ui-sans-serif, system-ui, 'PingFang TC', 'Helvetica Neue', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.05em"
  mono:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
rounded:
  sm: "2px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  xs: "0.2rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.75rem"
  xl: "2.5rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.ink-soft}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  tab-active:
    textColor: "{colors.ink}"
    padding: "12px 20px"
  probability-bar-track:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.full}"
    height: "0.7rem"
  probability-bar-fill:
    backgroundColor: "{colors.final}"
    rounded: "{rounded.full}"
---

# Design System: LLM, no magic

## 1. Overview

**Creative North Star: "The Teaching Whiteboard"**

The interface is a whiteboard, not a stage. It stays quiet by default so the model's actual behavior — the tokens, the probability bars, the tool calls — reads as the content, not the UI around it. Color and elevation are reserved for the moments something real is happening: a token is selected, a probability bar fills in, a tool call fires, a result comes back. Everything else stays in a tight, cool-neutral grayscale so those moments read as signal, not noise.

This system explicitly rejects generic SaaS marketing chrome (gradient heroes, icon+heading+text cards), gamified flourish (badges, celebratory motion, progress-bar theatrics), and enterprise-dashboard cliché (navy-and-cream, dense identical card grids). Nothing here should look decorative — a tool whose whole premise is "no magic" cannot have UI chrome that performs sophistication it doesn't need.

**Key Characteristics:**
- Cool-neutral grayscale base (all neutrals share a 280° hue tint) with three semantic accents, never a decorative one
- Flat by default; a light elevation tier is reserved for surfaces that need to visually detach (hover states, the model-swap toast)
- Monospace reserved for anything that is literally model output or a number (tokens, probabilities, prompts)
- One accent per meaning: blue = primary interaction, violet = tool call, green = tool result — never mixed

## 2. Colors

A single cool-gray family (all tinted toward the same 280° hue, so nothing ever reads as a "different" gray) carries the whole interface; three semantic accents only appear when something specific is happening.

### Primary

- **Signal Blue** (`oklch(55% 0.20 255)`): the one primary interactive accent — active tab underline, probability bar fill, selected-token ring, focus states, links. If it's blue, it means "this is the thing currently selected or happening." Now a brighter, more saturated electric blue than the earlier `oklch(50% 0.17 250)` — the goal is a more contemporary interface feel; it stays the **only** interactive accent and the Rarity Rule (combined colored area <10%) is unchanged.
- **Signal Blue Tint** (`oklch(96% 0.045 255)`): the pale wash behind Signal Blue content (e.g. the answer-to-a-question callout on the intro-style copy blocks).

### Secondary

- **Call Violet** (`oklch(54% 0.22 320)`): reserved exclusively for Tab ④'s "↑ tool call" blocks. Never used elsewhere — its rarity is what makes it legible as "the agent is calling a tool" at a glance.
- **Call Violet Tint** (`oklch(96% 0.030 320)`): background wash for tool-call blocks.

### Tertiary

- **Return Green** (`oklch(50% 0.15 145)`): reserved exclusively for Tab ④'s "↓ tool result" blocks — the answering half of the Call Violet pair.
- **Return Green Tint** (`oklch(96% 0.026 145)`): background wash for tool-result blocks.

### Neutral

- **Near-Black Graphite** (`oklch(20% 0.012 280)`) — primary text (`ink`).
- **Soft Graphite** (`oklch(34% 0.010 280)`) — secondary text, active-tab label (`ink-soft`).
- **Quiet Slate** (`oklch(50% 0.008 280)`) — tertiary text, section eyebrow labels, percentages (`muted`).
- **Faint Ash** (`oklch(65% 0.006 280)`) — placeholder text, disabled states (`faint`).
- **Chalk White** (`oklch(98% 0.008 280)`) — page background (`surface`).
- **Pale Fog** (`oklch(95% 0.011 280)`) — panel/output-block background, probability-bar track (`surface-2`).
- **Hairline Gray** (`oklch(89% 0.012 280)`) — default border (`edge`).
- **Whisper Gray** (`oklch(91.5% 0.010 280)`) — subtle border, output-block border (`edge-soft`).

### Base tone

All neutral surfaces share one tone. The default is **cool gray (280°)**; the whole neutral set can be swapped, as a group, for one of the alternatives below to make the tool read warmer or cooler in a given setting. **Use exactly one set at a time** — `ink` and the accents do not change with it.

| Base tone | surface | surface-2 | edge | edge-soft |
|---|---|---|---|---|
| Cool gray (default) | `oklch(98% 0.008 280)` | `oklch(95% 0.011 280)` | `oklch(89% 0.012 280)` | `oklch(91.5% 0.010 280)` |
| Pure white | `oklch(100% 0 0)` | `oklch(96.5% 0.001 280)` | `oklch(90.5% 0.002 280)` | `oklch(93% 0.002 280)` |
| Warm cream | `oklch(97.5% 0.021 80)` | `oklch(95% 0.028 78)` | `oklch(89% 0.026 78)` | `oklch(92% 0.022 80)` |
| Slate | `oklch(96.8% 0.017 250)` | `oklch(94.3% 0.022 250)` | `oklch(88% 0.024 250)` | `oklch(91% 0.019 250)` |

### Named Rules

**The One Meaning Rule.** Signal Blue, Call Violet, and Return Green each mean exactly one thing. None of the three is ever reused as a decorative accent, a "brand" color, or a fourth meaning. If a new UI moment needs color, it needs a new named accent with its own single meaning — not a reuse of these three.

**The Rarity Rule.** Across any given screen, colored surface area (Signal Blue, Call Violet, Return Green combined, tints included) stays under 10%. The whiteboard is the point; color is the exception that proves something is happening.

**The One Base Tone Rule.** The neutral set uses exactly one base tone at a time (default cool gray 280°). Swapping tone means swapping the whole `surface`/`surface-2`/`edge`/`edge-soft` group together — never mixing hues within the neutrals.

## 3. Typography

**Body/UI Font:** `ui-sans-serif, system-ui, "PingFang TC", "Helvetica Neue", sans-serif` (system font stack — no webfont load, renders natively per-OS, and covers Traditional Chinese via PingFang TC).
**Mono Font:** `ui-monospace, "SF Mono", Menlo, monospace` — reserved for anything that is literally model output or a number.

**Character:** A plain system-UI sans for everything a human writes or reads as prose, switching to monospace the instant the content is something the model produced or a number the reader needs to line up and compare (probabilities, token text, prompt previews). The font switch itself is a signal: "you are now looking at raw output," not styling.

### Hierarchy

- **Headline** (600, `clamp(1.25rem, 2vw, 1.875rem)`, 1.25): the page title only ("LLM, no magic").
- **Title** (600, 1.5rem, 1.3): section/tab-level headers.
- **Body** (400, 0.875rem, 1.6): the default for labels, buttons, textareas, prose — nearly everything in the interface today.
- **Label** (500, 0.75rem, uppercase, 0.05em tracking): section eyebrows ("MODEL 吐的字", "TOKEN 候選 · TOP 10") — quiet, small-caps signage above a content block.
- **Mono** (400, 0.8rem): token text, probability percentages, prompt previews, chat-template dumps.

### Named Rules

**The Flat Scale Warning.** Today's hierarchy leans heavily on Body (0.875rem) and Label/mono sizes, with only the page Headline and a few Titles breaking above 1rem — most of the interface sits within a narrow 0.75–0.875rem band. This is legible but nearly flat; when redesigning a screen, look for a legitimate Title-level moment (e.g. a tab's primary output) before defaulting back to Body everywhere.

## 4. Elevation

Mostly flat, with a restrained modern lift: surfaces still separate with a 1px Hairline Gray or Whisper Gray border, but the **key content blocks — the prompt textarea, the model-output box, and Tab ②'s final-prompt preview — carry `ambient-low` at rest** together with an 8px (rounded-lg) corner, so they read as gently raised panels rather than flat rectangles. The toast tier still floats fully above the page. The lift is deliberately shallow: raised, never "flying."

### Shadow Vocabulary

- **`toast`** (`box-shadow: 0 4px 12px oklch(20% 0.012 280 / 0.15)`): the swap-banner and any future page-level floating notice. The only tier that fully detaches from the document.
- **`ambient-low`** (`box-shadow: 0 1px 3px oklch(20% 0.012 280 / 0.06)`): the rest-state lift on key content blocks (prompt textarea, `.generated-text`, `.probs`, Tab ②'s `.final-prompt-preview`) and hover/active states on turn-blocks — "lifted, not just bordered," without competing with the toast tier.

### Named Rules

**The Two-Tier Rule.** There are exactly two shadow tiers: `ambient-low` for the key content blocks at rest (and in-flow hover/active feedback), `toast` for anything that floats above the page. Everything outside those key blocks stays bordered-flat at rest — no third tier, no decorative shadows.

## 5. Components

### Buttons

- **Shape:** rounded-md (6px).
- **Primary ("送出/Send"):** Near-Black Graphite background, Chalk White text, 8px/16px padding. Hover darkens to Soft Graphite. Disabled drops to Faint Ash background.
- **Secondary ("停/Stop"):** Chalk White background, Hairline Gray border, Soft Graphite text. Disabled: Faint Ash text, no hover.
- **Feel:** plain but present — states are functional signage (disabled looks visibly inert, hover visibly responds), never decorative.

### Tabs

- **Style:** flat text buttons in a row, no pill/card wrapper. Inactive tabs sit in Quiet Slate; the active tab turns Near-Black Graphite and gains a 2px Signal Blue underline.
- **State:** during a model swap, all tabs (plus Send/Stop) drop to 50% opacity and become non-interactive — a whole-row "disabled" signal, not a spinner.

### Token chips (`.tok`)

- **Style:** inline text, no visible chip boundary at rest — this is the one place restraint is most deliberate, since every character in the generated text is technically clickable.
- **Hover:** Whisper-Gray-tinted background appears (`oklch(95% 0.012 280)`).
- **Selected:** pale Signal-Blue-tinted background plus a 1px inset Signal Blue ring — the strongest state in the whole system, reserved for "this is the token whose distribution you're currently looking at."
- **Static variant** (Tab ④): no cursor change, no hover — signals "not interactive" the same way disabled buttons do.

### Probability bars

- **Layout:** a naked list — no card, no border, no shadow around the `.probs` container; the rows sit directly on the page (the chart reads as data, not as a boxed widget).
- **Track:** Pale Fog background, full pill radius, **0.375rem (6px) thin**.
- **Fill:** Signal Blue (`oklch(55% 0.20 255)`), full pill radius, animates width over 150ms ease.
- **Label/Percent:** monospace, tabular-nums on the percentage so columns of numbers stay aligned — this is a data component first, decoration never.
- **Caption:** below the output box, a quiet muted line `└ 正在看第 N 個 token「X」的分布` tells the reader which token's distribution the chart is showing; it updates on every token click/inspect.

### Preset chips (Tab ①)

- **Style:** pill buttons (rounded-full, 1px Hairline Gray border, Chalk White bg, Soft Graphite text) under the prompt box — one per teaching preset (唐詩背誦 / 瞎掰的星球 / 打開冰箱).
- **Active:** when the prompt content equals a chip's preset text, that chip turns Signal Blue (text + border) — a live reflection of the input, not a separate selection state.
- **Behavior:** clicking fills the prompt (and syncs the carry-over `lastPrompt`).

### Output box (Tab ①)

- **Prompt echo:** each run starts by echoing the prompt in Faint Ash inside the output box; generated tokens append after it — the box itself demonstrates "chaining continues your text."
- **Token spacing:** generated tokens get a slight `0.15em` gap so each is visibly a discrete, clickable unit.

### Final-prompt preview (Tab ② / ③)

- **Marker highlighting:** in the "final prompt actually sent to the model" preview, chat-template markers (`<|im_start|>`, `<|im_end|>`, and any `<|…|>`) are rendered in Signal Blue, semibold; the rest of the text stays `ink`. This makes the product-layer processing legible at a glance — **the colored markers ARE the role convention the product layer adds.** The preview container is a key content block: rounded-lg with `ambient-low` at rest.

### Turn blocks (Tab ④ agent)

- **Tool call:** Call Violet Tint background, Call Violet accent text/icon ("↑").
- **Tool result:** Return Green Tint background, Return Green accent text/icon ("↓").
- **Collapse behavior:** `max-height` transition (200ms, `cubic-bezier(0.22, 1, 0.36, 1)`), collapsed state clips to ~2.5em — respects `prefers-reduced-motion` by disabling the transition entirely, not just shortening it.

### Inputs (textarea/prompt fields)

- **Style:** Hairline Gray border, Chalk White background, rounded-lg (8px), with `ambient-low` at rest — a key content block.
- **Focus:** border shifts to Signal Blue with a matching 1px ring — no glow, no scale change.

### Toast (model-swap banner)

- **Style:** floating pill, Signal-Blue-Tint background, Signal Blue text, `toast`-tier shadow, pulsing dot indicator.
- **Only element in the system allowed to float above content** — reserve this treatment; don't reuse it for anything that isn't a genuine "the whole page is temporarily busy" state.

## 6. Do's and Don'ts

### Do:

- **Do** keep all neutrals tinted to the same 280° hue (Near-Black Graphite through Chalk White) — never mix in a pure-gray or a different hue of neutral.
- **Do** keep Signal Blue / Call Violet / Return Green each locked to their one meaning (interaction / tool-call / tool-result).
- **Do** switch to monospace the moment content is literal model output or a number that needs to line up (tokens, percentages, prompt/template previews).
- **Do** use borders (Hairline Gray / Whisper Gray) for surface separation; the only rest-state shadow is `ambient-low` on the key content blocks (prompt, output, probs, final-prompt preview) — everything else stays bordered-flat, and `toast` is the sole floating tier.
- **Do** respect `prefers-reduced-motion` on every transition, matching the existing `.turn-block`/`.bar-fill`/`.tok` pattern.

### Don't:

- **Don't** add gradient hero sections, big rounded icon+heading+text marketing cards, or any generic SaaS landing-page chrome.
- **Don't** add gamified flourish: colorful badges, progress-bar celebration animations, confetti, or playful mascots.
- **Don't** reach for an enterprise-dashboard palette (navy + cream) or dense grids of identical cards.
- **Don't** use `border-left`/`border-right` as a colored accent stripe on any card, list item, or callout.
- **Don't** use gradient text, glassmorphism-as-default, or the SaaS hero-metric template (big number + small label + gradient accent).
- **Don't** let Signal Blue, Call Violet, or Return Green exceed roughly 10% combined surface area on any one screen — if it does, something is being decorated rather than signaled.
