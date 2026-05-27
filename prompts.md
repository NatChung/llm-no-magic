# LLM Course Prompt Material

> 繁體中文版: [prompts.zh-TW.md](./prompts.zh-TW.md)

## S1 (a) Shape

### Peaked (Chinese)
- `床前明月光` → continues with `,疑是地上霜` (a Tang dynasty poem the LLM has memorized; top-1 dominates, very high confidence on familiar text)
- `祖樹星上最高的山叫做` → the model confidently invents a fake place name (still peaked for a fictional entity → demonstrates "**peaked ≠ truth / confidence ≠ correctness**", the core punchline)

### Flat (Chinese)
- `他打開冰箱,拿出` → a low bush of options (water / eggs / leftovers / beer...) — many plausibilities, top-K spreads out

### English equivalents (optional)
- Peaked: `A year has twelve ` → `months`
- Flat: `He opened the fridge and took out ` → a low bush of options
- Fake place: `The tallest mountain on the continent of Zypler is called ` (Chinese version: see `祖樹星` above)

## S1 (b) Watermelon — four stages (English, with Chinese as reference)

> Note: these prompts are used for the streaming bar-chart demo (token distribution).
> The trend line chart (tracking watermelon probability across stages) uses chat-format wrapper, tracking the `melon` token.

Stage 1: `I'm thinking of a fruit. It is a `
Stage 2: `I'm thinking of a fruit that is very popular in summer. It is a `
Stage 3: `I'm thinking of a fruit that is very popular in summer, very large, with a green rind. It is a `
Stage 4: `I'm thinking of a fruit that is very popular in summer, very large, with a green rind, red flesh, and black seeds. It is a `

Tracked token: `melon` (Qwen3-0.6B splits watermelon into `water` + `melon` sub-tokens;
in chat format with "What fruit?", the model outputs `melon` directly or `Water` + `melon`.
Tracking `melon` shows Stage1 ≈ 0.2% → Stage2 ≈ 46% → Stage3 ≈ 23% → Stage4 ≈ 26%.)

### Counter-example (optional, after Stage 3)
`I'm thinking of a fruit that is very popular in summer, very large, with a green rind, but it is quite small and fits in your hand. It is a `
Expected: `melon` probability drops, replaced by small-fruit options

## S1 (c) Zypler fake entity (English)

`The tallest mountain on the continent of Zypler is called `
Expected: peaked distribution, confidently picks a fake place name

---

## Tokenizer notes (Qwen3-0.6B)

| Word | Token IDs | Sub-tokens |
|---|---|---|
| `water` | 12987 | `water` (no leading space) |
| ` water` | 3015 | ` water` (with leading space) |
| `melon` | 71118 | `melon` |
| `watermelon` | 12987 + 71118 | `water` + `melon` |
| ` watermelon` | 3015 + 71118 | ` water` + `melon` |

Base-completion mode (raw continuation) on watermelon four-stage prompts: top tokens are all numbers (1, 2, 3...), not fruit names — this is 0.6B model behavior. The trend chart uses chat format to work around it.
