# LLM 課 prompt 素材

## S1 (a) 形狀

### Peaked(英文)
`A year has twelve ` → 預期 `months` 一根獨大

### Flat(英文)
`He opened the fridge and took out ` → 一片矮樹叢

## S1 (b) Watermelon 四階(英文,中文當對照)

> 注意:這些 prompt 用在串流 bar chart demo(顯示 token 分布)。
> 趨勢折線圖(追 watermelon 機率 vs 階段)使用 chat-format wrapper,追蹤 `melon` token。

Stage 1: `I'm thinking of a fruit. It is a `
Stage 2: `I'm thinking of a fruit that is very popular in summer. It is a `
Stage 3: `I'm thinking of a fruit that is very popular in summer, very large, with a green rind. It is a `
Stage 4: `I'm thinking of a fruit that is very popular in summer, very large, with a green rind, red flesh, and black seeds. It is a `

追蹤目標 token:`melon`(Qwen3-0.6B 把 watermelon 分成 `water`+`melon` 兩個 sub-token;
用 chat format 問「What fruit?」時,模型會直接輸出 `melon` 或 `Water`+`melon`。
追蹤 `melon` 呈現 Stage1≈0.2% → Stage2≈46% → Stage3≈23% → Stage4≈26% 的躍升。)

### 反例(可選,Stage 3 後)
`I'm thinking of a fruit that is very popular in summer, very large, with a green rind, but it is quite small and fits in your hand. It is a `
預期:`melon` 機率掉下來,改成 small 水果

## S1 (c) Zypler 假實體(英文)

`The tallest mountain on the continent of Zypler is called `
預期:peaked 分布、自信抽一個假地名

---

## Tokenizer 備忘(Qwen3-0.6B)

| 詞 | Token IDs | Sub-tokens |
|---|---|---|
| `water` | 12987 | `water` (no space) |
| ` water` | 3015 | ` water` (leading space) |
| `melon` | 71118 | `melon` |
| `watermelon` | 12987 + 71118 | `water` + `melon` |
| ` watermelon` | 3015 + 71118 | ` water` + `melon` |

Base-completion mode(純接龍)在 watermelon 四階 prompt 下頂部 token 全是數字(1,2,3...),
不是水果名 — 這是 0.6B 模型行為。趨勢圖用 chat format 繞過。
