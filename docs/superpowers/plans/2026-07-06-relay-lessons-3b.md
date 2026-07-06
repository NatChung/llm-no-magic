# Relay v3 — 3b Lesson Driving-Recipe → Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the stale v2 "browser-MCP" driving recipe inside `teaching/lesson-1..4` (×2 lang, 8 files) for the shipped v3 HTTP-relay recipe (`POST /drive` payload + read-response expected value + `POST /inspect`), preserving all pedagogical prose — closing the 3a §8 transitional window.

**Architecture:** Four independent tasks, one per lesson (both language files together). Each task deletes the MCP driving lines that are present in each Demo segment and replaces them with relay lines using that lesson's exact payloads, sweeps preset/click narration, and converts `<details>`-expand interactions to human-expand narration. No code, no tests — verification is a live relay run (controller-run) + grep gates.

**Tech Stack:** Markdown only. Verification: `curl POST /drive`/`/inspect` against the live server + Playwright observation (controller), plus grep.

**Spec:** `docs/superpowers/specs/2026-07-06-relay-lessons-3b-design.md` (read it; this plan implements it).

## Global Constraints

- **Only swap the driving recipe + sweep preset/click prose.** Preserve verbatim: 學習目標/Learning Objectives, Hook 問答/Hook Questions, 旁白/narration text, 揭曉回顧/Reveal, 常見問題/Common Questions. Do NOT rewrite pedagogy, examples, or structure.
- **Bilingual lockstep:** every structural edit lands identically in BOTH the `.md` (EN) and `.zh-TW.md` file of a lesson — same segments transformed, same payloads, same expected values; only prose language differs. **(review M2) The EN replacement lines must ALSO avoid the gate terms** — write "→ the page auto-switches to Tab N" NOT "click Tab N", and "student, click to expand the preview" (the student clicks, not the AI). Do not re-introduce `click Tab`/`select preset`/`snapshot` in the English prose.
- **Relay recipe format** (per Demo segment, replacing the MCP lines that are present):
  ```
  - 驅動/Drive: `POST /drive {<payload>}` → 學員頁面自動切到 Tab N 並渲染 (drive_start auto-switches; do NOT tell the AI to click a tab)
  - 讀回應/Read: <expected value> → 旁白/narration (kept from the original)
  - (lesson-1 per-token segments only) 點深看/Inspect: `POST /inspect {"tokenIndex":N}` → 學員頁面彈該 token 機率圖
  ```
- **Per-tab payloads** (verified against `agent/server.py` `drive()`): ① `{"tab":"1","user":"…"}` · ② `{"tab":"2","user":"…","system":"…","mode":"raw"|"chat"}` · ③ `{"tab":"3","user":"…","mode":"direct"|"thinking"}` · ④ `{"tab":"4","user":"…"}`.
- **Delete-list is per-what's-present** (NOT a fixed uniform list): segment 1 usually has "open URL / click Tab N / repeat snapshot until loading gone"; later segments usually have only "select preset / submit / wait re-enabled / click token → snapshot". Delete whichever MCP lines exist in each segment.
- **`<details>` interactions → human-expand narration** (relay has no expand command): lesson-2's `final-prompt-preview` and lesson-4's per-turn "resend details" become "AI narrates: student, click to expand …".
- **preset dropdown is gone** — no lesson may tell the student to "select a preset". 學員動手/Learner Practice that said "換 preset / preset 2 …" → "type the prompt string".
- **grep gate (file-wide, both langs), per lesson — CASE-INSENSITIVE (`grep -ciE`, review I1):** `preset` (catches EN `Preset 2`) / `用 MCP` / `Via MCP` / `snapshot` / `選 preset` / `select preset` / `點 Tab` / `click Tab` → **0 matches**; `POST /drive` → present. ("expand the preview / expand resend" narration is fine — it tells the student to click, not the AI to MCP-drive.)
- **Verification is a live relay run per lesson** (controller): drive each segment's payload against the running server and confirm the recipe's expected value holds (① `霜`~0.95; ② chat=tidy list vs raw=rambling; ③ thinking has `<think>` phase + post-`</think>` answer; ④ get_time/exec_bash turn trace). The server must be up (`nohup python3 -u -m agent.server …`).
- **Commit trailers (every commit):**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GeRBynD5cg5ry8ricH3xu8
  ```

---

### Task 1: lesson-1 (basic) — 3 segments, `/drive` + `/inspect`

**Files:** Modify `teaching/lesson-1-basics.md` + `teaching/lesson-1-basics.zh-TW.md`.

**Interfaces:** none (markdown). Establishes the recipe pattern the other lessons mirror.

- [ ] **Step 1: Read both files, then transform the 3 Demo segments**

The segments drive tab 1 with these three preset strings (verbatim from the current files): 段落1 `床前明月光,疑是地上` (expect first token `霜` ~0.95, peaked); 段落2 `祖樹星上最高的山叫做` (made-up planet, still confident/peaked); 段落3 `他打開冰箱,拿出` (flat, top-10 spread). Each segment currently has `用 MCP:`/`Via MCP:` lines (open/click-tab/snapshot for segment 1; select-preset/submit/click-token for all). Replace the MCP lines in each segment with:
```
- 驅動:`POST /drive {"tab":"1","user":"<the segment's prompt string>"}` → 學員頁面自動切到 Tab ① 並逐 token 渲染
- 讀回應:<expected — seg1 首 token「霜」prob ~0.95;seg2 首 token 仍高信心編一個山名;seg3 top-10 分散> → 旁白:<kept from original>
- 點深看:`POST /inspect {"tokenIndex":0}`(或原段落點的 token index)→ 學員頁面彈該 token 機率圖
```
Keep each segment's 預告/Set-up (prediction question) and 旁白/narrate text verbatim; only the mechanical MCP lines change. Mirror identically in the EN file (English prose, same payloads/expected values).

**Note (review M1) — some lines FUSE the MCP verb with the expected value + 旁白** on one bullet, e.g. `lesson-1-basics.zh-TW.md:30`: `點生成文字第一個 token → snapshot 讀機率(預期接「霜」、top-1 94%+)。旁白:它「背過」整首詩 → peaked`. **Split it — DELETE only the MCP verb (`點 token`/`snapshot`); KEEP the expected value (`霜` 94%+) and the 旁白**, moving them into the 讀回應/Inspect lines. Do not drop the expected value or narration.

- [ ] **Step 2: Sweep the preset/click prose**

學員動手/Learner Practice currently says "換一個 preset 重跑" / "switch to a different preset and re-run" → change to "換一句 prompt 重打" / "type a different prompt and re-run". Any "點 Tab ①(`① 基礎`…)" / "click Tab ①" narration → drop (drive auto-switches). Set-up line "我讓瀏覽器自己動 / I'm going to drive the browser automatically" may stay (still true — the AI drives).

- [ ] **Step 3: Grep gate (both files)**

Run: `grep -ciE "preset|用 MCP|Via MCP|snapshot|選 preset|select preset|點 Tab|click Tab" teaching/lesson-1-basics.md teaching/lesson-1-basics.zh-TW.md`
Expected: `0` for both. Then `grep -c "POST /drive" teaching/lesson-1-basics.md teaching/lesson-1-basics.zh-TW.md` → ≥3 each.

- [ ] **Step 4: Commit**

```bash
git add teaching/lesson-1-basics.md teaching/lesson-1-basics.zh-TW.md
git commit -m "docs(lesson1): driving recipe MCP → relay (3b)"
```

- [ ] **Step 5: (Controller) live relay verification**

Server up. For each segment: `curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d '<payload>'` and confirm the recipe's expected value (seg1 first token `霜` prob ~0.95; seg2 a confident invented mountain; seg3 a flat top-10). Then `curl -s -X POST localhost:9000/inspect -d '{"tokenIndex":0}'` and confirm the page's prob chart updates (Playwright). If an expected value in the recipe doesn't match reality, correct the recipe.

---

### Task 2: lesson-2 (advanced) — raw vs chat, preview human-expand

**Files:** Modify `teaching/lesson-2-product.md` + `teaching/lesson-2-product.zh-TW.md`.

**Interfaces:** Consumes Task 1's recipe pattern.

- [ ] **Step 1: Read both files, then transform the 2 Demo segments**

段落1 (raw): user `一年有幾個月?`, `mode:"raw"`, NO system → expect rambling/repetitive continuation (model treats it as continuation, not Q&A). 段落2 (chat): user `一年有幾個月?`, system `你是行銷顧問,用條列式回答,只給 3 點。`, `mode:"chat"` → expect a tidy list (e.g. `1. 一年有12个月。`). Replace the MCP lines:
```
- 驅動:`POST /drive {"tab":"2","user":"一年有幾個月?","mode":"raw"}` → 頁面自動切到 Tab ② 並渲染
- 讀回應:輸出散開/像接龍不像回答 → 旁白:<kept>
```
and for 段落2:
```
- 驅動:`POST /drive {"tab":"2","user":"一年有幾個月?","system":"你是行銷顧問,用條列式回答,只給 3 點。","mode":"chat"}` → 頁面渲染整齊條列
- 讀回應:整齊條列(如「1. 一年有12個月…」)→ 旁白:<kept — 問:答: 結構讓它「答」而非接龍>
```

- [ ] **Step 2: Convert the two `final-prompt-preview` interactions to human-expand**

段落2 currently says "會先展開『實際送進 model 的 final prompt』給你看真面目" and "點開『實際送進 model 的 final prompt』preview", and the debrief "指 preview 的 `<|im_start|>` marker". The preview CONTENT does refresh on drive (`beginRun` calls `refreshPreview()`), but it sits in a collapsed `<details>` relay can't open. Rewrite these to human-expand narration: **"旁白:學員,點一下把『實際送進 model 的 final prompt』展開,看它被包成 `<|im_start|>…` 的樣子"** (student clicks; the AI narrates). Keep the teaching point about `<|im_start|>` = 1 token verbatim.

- [ ] **Step 3: Sweep the preset prose in 學員動手**

學員動手 says "preset 2「夏季冰飲文案」:讓學員自己 raw 跑一次、再加 system 跑一次". Since the preset dropdown is gone → "讓學員在輸入框**打**『寫一個夏季冰飲的促銷文案』(或自訂),raw 跑一次、再加 system 跑一次,對比結構化程度". (Use the actual 夏季冰飲 prompt string; if the exact string isn't in the file, use the descriptive one shown.)

- [ ] **Step 4: Grep gate + commit**

`grep -ciE "preset|用 MCP|Via MCP|snapshot|選 preset|select preset|點 Tab|click Tab" teaching/lesson-2-product.md teaching/lesson-2-product.zh-TW.md` → 0 both. `grep -c "POST /drive" …` → ≥2 each. Then:
```bash
git add teaching/lesson-2-product.md teaching/lesson-2-product.zh-TW.md
git commit -m "docs(lesson2): driving recipe MCP → relay + preview human-expand (3b)"
```

- [ ] **Step 5: (Controller) live relay verification**

Drive both payloads; confirm raw = rambling vs chat = tidy list (visibly different). Confirm (via Playwright, after driving chat) that the `final-prompt-preview` content is populated (even if collapsed) so the "expand to see it" narration is truthful.

---

### Task 3: lesson-3 (reasoning) — direct vs thinking, HTML-prefill payload

**Files:** Modify `teaching/lesson-3-reasoning.md` + `teaching/lesson-3-reasoning.zh-TW.md`.

**Interfaces:** Consumes Task 1's recipe pattern.

- [ ] **Step 1: Read both files + the HTML prefill, then transform the 2 Demo segments**

lesson-3 has **no preset string** — the prompt is the reasoning panel's HTML prefill. Use it verbatim, **Chinese-only, IDENTICAL in both language files**: `爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?` (no spaces — NOT the spaced Hook version). NOTE (review C1): in `frontend/index.html` the English gloss "(Dad has 3 apples…)" lives ONLY in the `placeholder=` attribute (shown when the box is empty); the actual **textarea content that gets submitted is Chinese-only**, same as `index.zh-TW.html:157`. So the EN payload `user` must be the Chinese-only string too (the `/drive` `user` is the model prompt, not UI chrome). If the EN reader benefits from the gloss, put "(Dad has 3 apples, son has 2 more than him…)" in the surrounding EN prose/narration — NEVER in the payload. Segments switch by **mode radio**, not preset. Replace the MCP lines:
```
段落1 (direct):
- 驅動:`POST /drive {"tab":"3","user":"爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?","mode":"direct"}` → 頁面切到 Tab ③ 渲染
- 讀回應:小 model 直答常錯(說 3 顆或亂答)→ 旁白:<kept>
段落2 (thinking):
- 驅動:`POST /drive {"tab":"3","user":"<same prompt>","mode":"thinking"}` → 頁面渲染 thinking 區 + 最終答案
- 讀回應:thinking-content 填入 `<think>…</think>`、`</think>` 後的 generated-text 是最終答案(常對出 5)→ 旁白:<kept — 給了它把推理寫成 token 的空間>
```
(`user` is identical in both segments; only `mode` differs. Mirror EN with its prefill string.)

- [ ] **Step 2: Sweep — no preset/click, mode-radio is now in the payload**

Delete "選 mode「直答」→ 送出頁面預填的蘋果題" style lines (the mode is now in the `/drive` payload's `mode` field, not a radio click). Keep the Hook + 旁白 verbatim. There is no preset in this lesson, so the only sweep is the MCP `用 MCP`/open/click-tab/snapshot lines + the "選 mode … 送出" mechanics.

- [ ] **Step 3: Grep gate + commit**

`grep -ciE "preset|用 MCP|Via MCP|snapshot|選 preset|select preset|點 Tab|click Tab" teaching/lesson-3-reasoning.md teaching/lesson-3-reasoning.zh-TW.md` → 0 both. `grep -c "POST /drive" …` → ≥2 each. Then:
```bash
git add teaching/lesson-3-reasoning.md teaching/lesson-3-reasoning.zh-TW.md
git commit -m "docs(lesson3): driving recipe MCP → relay, prefill payload (3b)"
```

- [ ] **Step 4: (Controller) live relay verification**

Drive both `mode` payloads; confirm direct = short (often wrong) answer, thinking = `<think>` phase fills + a post-`</think>` final answer (often correct, e.g. 5). (Thinking runs to `n_predict:1500` server-side.)

---

### Task 4: lesson-4 (agent) — turn trace (no `/inspect`), 4B swap, resend-details human-expand

**Files:** Modify `teaching/lesson-4-agent.md` + `teaching/lesson-4-agent.zh-TW.md`.

**Interfaces:** Consumes Task 1's recipe pattern (minus `/inspect`).

- [ ] **Step 1: Read both files, then transform the 2 Demo segments**

Tab-4 reads the **turn trace**, NOT token probabilities — so NO `/inspect`. 段落1: user `現在幾點?` → expect a `get_time` tool call turn + final answer. 段落2: user `數一下這個 repo 底下有幾個 .md 檔` → expect an `exec_bash` tool call turn + final answer. Replace the MCP lines:
```
段落1:
- 驅動:`POST /drive {"tab":"4","user":"現在幾點?"}` → 頁面切到 Tab ④;**第一次會 0.6B→4B swap,banner 等 3-5s**(swap 在 /drive 內、頁面收 swap_start 顯示 banner)
- 讀回應:turn 軌跡 — Turn 1 紫「↑ 工具呼叫 get_time」→ 綠「↓ 工具結果」→ Turn 2 final answer(現在是 HH:MM:SS)→ 旁白:<kept — XML 標籤只是約定,執行的是 client>
段落2:
- 驅動:`POST /drive {"tab":"4","user":"數一下這個 repo 底下有幾個 .md 檔"}` → 頁面渲染 turn 軌跡
- 讀回應:Turn 1 exec_bash 工具呼叫 + 結果 → final answer(N 個 .md 檔)→ 旁白:<kept>
```

- [ ] **Step 2: "展開 resend details" → human-expand (parent §8-assigned)**

段落2 debrief says "展開 turn block 的『再送出』details:看 conversation 怎麼一輪輪累積". The per-turn "再送出" is a collapsed `<details>` relay can't open → rewrite to **"旁白:學員,點一下展開那個 turn 的『再送出』,看 conversation 怎麼一輪輪累積成下次 input"** (student clicks; AI narrates).

- [ ] **Step 3: Sweep the preset prose in 學員動手**

學員動手 says "preset 2「讀+寫 摘要」:學員自己送出…". Preset dropdown is gone → "學員在輸入框**打** `讀 prompts.md,把它總結成 3 點,寫到 ~/Desktop/llm-summary.md`(review I2 — 這是該 preset 的確切字串,存活在 `agent/smoke.py:13`),送出,跑完去開 `~/Desktop/llm-summary.md` — 檔案真的在". (EN file: use the same prompt string — it's a file path + Chinese instruction the model reads; the surrounding EN prose describes it.) Keep the "檔案真的在 → 動手工具 vs 說話工具" teaching point.

- [ ] **Step 4: Grep gate + commit**

`grep -ciE "preset|用 MCP|Via MCP|snapshot|選 preset|select preset|點 Tab|click Tab" teaching/lesson-4-agent.md teaching/lesson-4-agent.zh-TW.md` → 0 both. `grep -c "POST /drive" …` → ≥2 each. (Note: `<tool_call>` and `/inspect`-absence are expected — this lesson uses turns, not inspect.) Then:
```bash
git add teaching/lesson-4-agent.md teaching/lesson-4-agent.zh-TW.md
git commit -m "docs(lesson4): driving recipe MCP → relay, turn trace + human-expand (3b)"
```

- [ ] **Step 5: (Controller) live relay verification**

Drive both payloads (first triggers 0.6B→4B swap — allow time). Confirm segment 1 = get_time tool-call turn + time final; segment 2 = exec_bash tool-call turn + a count final. Confirm the page's turn blocks + final-content render (Playwright).

---

## Self-Review

**1. Spec coverage** (vs `2026-07-06-relay-lessons-3b-design.md`):
- §驅動食譜轉換 (recipe format, per-tab payloads, per-what's-present delete-list, prefill sourcing) → Global Constraints + each task Step 1. ✓
- §各課特例 lesson-1 (inspect, practice preset→prompt) → Task 1. ✓
- §各課特例 lesson-2 (raw/chat, preview human-expand, practice preset→prompt) → Task 2. ✓
- §各課特例 lesson-3 (direct/thinking, prefill payload, mode-not-preset) → Task 3. ✓
- §各課特例 lesson-4 (turn trace no-inspect, 4B swap banner, resend-details human-expand, practice preset→prompt) → Task 4. ✓
- §驗證 (per-lesson live relay run + file-wide grep gate) → each task Step 5 (controller) + grep step. ✓
- §範圍 out-of-scope (prose/articles/demos/code untouched) → Global Constraints. ✓

**2. Placeholder scan:** payloads are exact JSON; expected values are concrete; grep commands are exact. Two spots defer a string to the implementer's file-read (lesson-2 夏季冰飲 practice prompt, lesson-4 讀+寫摘要 practice prompt) — these are bounded ("use the actual string in the file / the preset-3 string") not open TBDs, because the exact wording lives in the lesson file the implementer reads. No vague "handle X". ✓

**3. Type/name consistency:** recipe format + payload shapes identical across all 4 tasks; `mode` values `raw|chat` (tab2) / `direct|thinking` (tab3); tab-4 has no `/inspect`; grep-gate term list identical per task. Matches the spec's Global Constraints. ✓

---

## Notes for the implementer

- **Bilingual is a hard gate**: an edit to only the `.md` or only the `.zh-TW.md` of a lesson is an incomplete task. Read both, mirror the transformation.
- **The controller runs Step 5 (live relay verification)** — the implementer does NOT need the server; it does the markdown transform + grep. But the implementer must NOT invent expected values: reuse the values already in the original recipe (e.g. `霜` 94%+) — the controller confirms them live.
- **Do not touch** pedagogical prose beyond the preset/click/`<details>`-expand sweeps, Tab ⑤/⑦ articles, demos, or code.
- **Execution note:** this plan is run via a workflow that fans out the 4 lessons in parallel (disjoint files, no conflict); each lesson gets a transform agent + a review agent, then the controller does the live relay verification per lesson before the final commit stands.
