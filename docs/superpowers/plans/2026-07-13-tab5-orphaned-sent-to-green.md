# tab⑤ 孤兒 sent prompt 掛到綠泡 Implementation Plan

> ⚠️ **SUPERSEDED 2026-07-14** — 這個「掛綠泡」設計有實作+出貨,但 live 看過後改成掛到
> **紫色腳本泡**(見 spec 的 REVISED note + commit `aab528b`)。以下內容是原始綠泡設計,
> 已被反轉,勿照此重做。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tab⑤ 腳本泡後被靜默丟棄的 `sent(final turn)` prompt 改成掛到綠泡當第二個展開器,讓學生看得到「工具結果餵回模型、產生最終答案」的那份 prompt。

**Architecture:** 純 tab⑤ 前端改動,後端零改。`frontend/app.js` 的 `setupSkillTab` 裡:`onSent` 在沒有右側泡泡可掛時,不再丟棄,改緩衝到新變數 `orphanedSent`;`onFinal` 建綠泡時,在既有的「送給使用者的原始訊息」展開器之後,多掛一個「送給 AI 的 prompt(turn N)」展開器。教材(雙語)同步描述綠泡的兩個展開器與展開器總數變化。

**Tech Stack:** Zero-build 前端(Tailwind Play CDN,無 bundler);`frontend/app.js` classic script;`frontend/wire.js` 提供全域 `WIRE`(不改);Node 內建 test runner 只測 wire.js 的純解析層;app.js 的 DOM 行為照 repo 慣例在瀏覽器裡驗證。

## Global Constraints

- **雙語鎖步:** 每個 user-facing 改動要同時落在 EN 與 zh-TW 檔(`teaching/lesson-5-skill.md` / `lesson-5-skill.zh-TW.md`)。
- **Cache-bust:** frontend 檔一改就要同步 bump 兩個 HTML 的 `?v=NN`。本次只改 `app.js` → `app.js?v=95 → 96`(`frontend/index.html:343` 與 `frontend/index.zh-TW.html:343` 同號);`wire.js?v=2`、`styles.css?v=66` **不動**。
- **≤1 展開器規則的限定例外:** 這次是對 `2026-07-10-expander-belongs-to-its-own-bubble.md`「每泡 `<details>` ≤ 1」規則的**限定破例 —— 只破 tab⑤ 綠泡**。腳本紫泡仍維持只有「腳本原始碼」一個展開器;tab④/⑥ 與其餘所有泡泡仍 ≤ 1。
- **後端零改動:** `agent/skill_agent.py` 及所有 agent 不動 —— `sent(final turn)` frame 本來就送,只是前端丟掉了。
- **markSent 語意:** 綠泡第二個展開器用 `BUBBLE.wire(prompt, { markSent: true })`,不帶 `{ align: "right" }`(綠泡是全寬,跟綠泡既有的「送給使用者的原始訊息」展開器一樣走預設左對齊)。

---

## File Structure

| 檔案 | 改什麼 |
|---|---|
| `frontend/app.js` | `setupSkillTab`:新增 `orphanedSent` 變數宣告 + `clearAll` 重置;`onSent` 的 drop-silently `else` 改成緩衝;`onFinal` 綠泡加第二個展開器;更新 `lastRightBubble` 註解與 `onSent` 的 else 註解。 |
| `frontend/index.html` | `app.js?v=95 → 96`(line 343)。 |
| `frontend/index.zh-TW.html` | `app.js?v=95 → 96`(line 343)。 |
| `teaching/lesson-5-skill.zh-TW.md` | line 53(六→七個展開器 + 綠泡例外);line 63(綠泡加第二個展開器描述)。 |
| `teaching/lesson-5-skill.md` | line 63(six→seven expanders + 綠泡例外);line 76(綠泡加第二個展開器描述)。 |

**沒有新增自動化測試。** `onSent`/`onFinal` 是 `setupSkillTab` 內的 closure、依賴 DOM(`BUBBLE.details`、`turnsEl`),repo 沒有 app.js 的 DOM 測試框架(AGENTS.md:「DOM is verified in the browser」)。驗證靠 `node --check`(語法)、`node --test frontend/wire.test.js`(wire.js 未動的防呆迴歸)、`pytest`(後端未動的防呆迴歸),以及瀏覽器實地驅動一次。

---

## Task 1: app.js — 孤兒 sent 緩衝 + 綠泡第二展開器 + cache-bust

**Files:**
- Modify: `frontend/app.js:920-930`(`lastRightBubble` 註解 + 宣告)、`:932-936`(`clearAll`)、`:958-973`(`onSent`)、`:1044-1066`(`onFinal`)
- Modify: `frontend/index.html:343`、`frontend/index.zh-TW.html:343`(cache-bust)

**Interfaces:**
- Consumes(既有,不改):
  - `BUBBLE.details(summaryText, bodyNode, opts?)` — 建 `<details>`;`opts.align === "right"` 是右側泡泡用的對齊。
  - `BUBBLE.wire(text, opts?)` — 走 `WIRE.render`;`opts.markSent === true` 讓最後一則非空訊息帶琥珀 highlight。
  - `t('sent_prompt_summary', { turn })` — 已存在的翻譯 key(`app.js:85`),回「送給 AI 的 prompt(turn N)」/「the prompt sent to the AI (turn N)」。
  - `t('to_user_raw_summary')` — 已存在的翻譯 key(`app.js:93`),綠泡既有展開器用。
  - `f.sent_prompt`、`f.turn`(`sent` frame);`f.content`(`final` frame);`pendingReceived`(module-scope buffer)。
- Produces:此 task 不對外導出新符號;新增的 `orphanedSent` 是 `setupSkillTab` 內部 module-scope 變數。

**背景(給 implementer):** tab⑤ 一次 check_weather(read_file → run_script → 最終答案)有三發 `sent` prompt。前端用 `lastRightBubble` 把每發 `sent` 掛到「引發它的右側泡泡」。腳本紫泡是**刻意的例外**(`onL3Loaded` 在 `isScript` 時設 `lastRightBubble = null`,因為腳本碼永不進 prompt),所以它後面那發 `sent(3)` —— 正是「工具結果 `<tool_response>` 包起來餵回模型」的那份 prompt —— 目前落到 `onSent` 的 `else` 被靜默丟棄。這個 task 把它緩衝起來,`onFinal` 掛到綠泡。tab④/⑥ 沒有這個例外,不受影響。

- [ ] **Step 1: `node --check` 建立 baseline(改之前先確認可 parse)**

Run: `node --check frontend/app.js`
Expected:無輸出、exit 0(檔案本來就 parse 得過)。

- [ ] **Step 2: 更新 `lastRightBubble` 註解並宣告 `orphanedSent`**

把 `frontend/app.js:920-930` 這段(`lastRightBubble` 的區塊註解 + 宣告 + `pendingReceived` 宣告)改成:

```js
  // lastRightBubble: the most recently rendered right-side bubble (user row,
  // amber L2-injection row, or a non-script purple row) that hasn't yet
  // received its "prompt actually sent because of it" expander. A `sent(N)`
  // frame attaches there and clears it. A script-output purple row is the one
  // deliberate exception: it sets lastRightBubble = null (script source never
  // appears in any prompt), so the NEXT `sent` has no right-side home — it is
  // buffered as `orphanedSent` and attached to the green final bubble as a
  // second expander (spec 2026-07-13-tab5-orphaned-sent-to-green.md, which
  // supersedes the ≤1-expander rule of 2026-07-10 for tab⑤ green only).
  let lastRightBubble = null;
  // `received` arrives BEFORE its `turn` frame (loop yield order) — buffer it
  // here and attach to the model/final bubble once it's built.
  let pendingReceived = null;
  // The `sent` that follows the exempt script bubble has no right-side bubble
  // to hang on — buffer it here so onFinal can hang it on the green bubble.
  // { prompt, turn }; latest wins (see clearAll / onSent / onFinal).
  let orphanedSent = null;
```

- [ ] **Step 3: `clearAll` 重置 `orphanedSent`**

把 `frontend/app.js:932-936` 的 `clearAll` 改成(在既有的 `lastRightBubble`/`pendingReceived` 重置那行補上 `orphanedSent = null`):

```js
  function clearAll() {
    turns = []; lastPromptTokens = null; finalDone = false;
    lastRightBubble = null; pendingReceived = null; orphanedSent = null;
    turnsEl.innerHTML = "";
  }
```

- [ ] **Step 4: `onSent` 的 drop-silently `else` 改成緩衝**

把 `frontend/app.js:958-973` 的整個 `onSent` 換成:

```js
  function onSent(f) {
    // sent(N).sent_prompt is the templated prompt that produced THIS turn's
    // response — it belongs to whichever right-side bubble caused it, not the
    // model bubble that's about to render for turn N.
    if (lastRightBubble) {
      lastRightBubble.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn: f.turn }),
        BUBBLE.wire(f.sent_prompt, { markSent: true }), { align: "right" }));
      lastRightBubble = null;
    } else {
      // No right-side bubble to hang on. Buffer it — onFinal attaches it to the
      // green bubble as a second expander. This is THE prompt that fed the tool
      // result back into the model to produce the final answer (the green
      // bubble IS that answer). Two ways to reach here, latest wins:
      //   1. it follows the exempt script-output bubble (by design; that bubble
      //      keeps its script source, which no prompt can replace) — the normal
      //      check_weather path, where this orphan is exactly sent(final turn).
      //   2. skill_agent retried an empty content-only turn, which rendered no
      //      right-side bubble. Degraded, not broken; rare. Overwrite means the
      //      last orphan (closest to final) wins — correct while orphans are
      //      end-consecutive (script bubble → final), which check_weather is.
      orphanedSent = { prompt: f.sent_prompt, turn: f.turn };
    }
  }
```

- [ ] **Step 5: `onFinal` 綠泡加第二個展開器**

把 `frontend/app.js:1044-1066` 的整個 `onFinal` 換成(在既有的 `pendingReceived` 展開器之後、`turnsEl.appendChild(fb)` 之前,加 `orphanedSent` 區塊):

```js
  function onFinal(f) {
    // f.content 空字串 = cancel/stop 的 terminal-final(§3.6)— 只解鎖按鈕,
    // 不畫空的綠泡泡(同 tab4 renderFinal 的 guard)
    if (!finalDone && f.content) {
      const fb = BUBBLE.finalBlock({ caption: t('to_user_caption'), content: f.content });
      // final turn is content-only, so onTurn skipped its wire view — the
      // final turn's `received` is the model's own raw response. Label it
      // to_user_raw_summary like tabs ④⑥'s green block: same position, same
      // data, so the student must not meet two different names for it.
      if (pendingReceived) {
        fb.appendChild(BUBBLE.details(t('to_user_raw_summary'),
          BUBBLE.wire(pendingReceived)));
        pendingReceived = null;
      }
      // The sent(final turn) dropped by the exempt script bubble — hang it on
      // the green bubble as a second expander so the student can see the prompt
      // that fed the tool result back into the model. received first, sent
      // second. Full-width green → no { align: "right" }; markSent highlights
      // the fed-back tool result inside the prompt.
      if (orphanedSent) {
        fb.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn: orphanedSent.turn }),
          BUBBLE.wire(orphanedSent.prompt, { markSent: true })));
        orphanedSent = null;
      }
      turnsEl.appendChild(fb);
      const rounds = turns.length;
      const trips = turns.filter((x) => x.hadTool).length;
      if (rounds) turnsEl.prepend(BUBBLE.banner(
        trips === 0 ? t('trace_summary_notool') : t('trace_summary', { trips, rounds })));
      finalDone = true;
    }
    setRunning(false);
  }
```

- [ ] **Step 6: bump cache-bust(兩個 HTML 同號)**

`frontend/index.html:343` 與 `frontend/index.zh-TW.html:343`:

```html
  <script src="app.js?v=96"></script>
```

(`wire.js?v=2`、`styles.css?v=66` 兩檔都不動。)

- [ ] **Step 7: `node --check` 確認改後仍 parse**

Run: `node --check frontend/app.js`
Expected:無輸出、exit 0。

- [ ] **Step 8: wire.js 迴歸(沒動 wire.js,防呆)**

Run: `node --test frontend/wire.test.js`
Expected:`ℹ pass 19` / `ℹ fail 0`。

- [ ] **Step 9: 確認兩個 HTML 同號、其他兩檔沒被誤動**

Run: `grep -nH "app.js?v=\|wire.js?v=\|styles.css?v=" frontend/index.html frontend/index.zh-TW.html`
Expected:兩檔都是 `styles.css?v=66`、`wire.js?v=2`、`app.js?v=96`。

- [ ] **Step 10: Commit**

```bash
git add frontend/app.js frontend/index.html frontend/index.zh-TW.html
git commit -m "feat(tab5): orphaned sent(final) hangs on green as 2nd expander"
```

---

## Task 2: 教材雙語 — 綠泡兩個展開器 + 展開器總數改七

**Files:**
- Modify: `teaching/lesson-5-skill.zh-TW.md:53`(六→七個展開器 + 綠泡例外)、`:63`(綠泡加第二個展開器)
- Modify: `teaching/lesson-5-skill.md:63`(six→seven expanders + 綠泡例外)、`:75-76`(綠泡加第二個展開器)

**Interfaces:**
- Consumes:Task 1 決定的綠泡行為 —— 綠泡有兩個展開器:「送給使用者的原始訊息」+「送給 AI 的 prompt(turn 3)」,後者的 wire 視圖裡餵回的工具結果帶琥珀 highlight。
- Produces:無程式碼;純教材文字。

**背景(給 implementer):** lesson-5 教材有兩處描述綠泡與展開器總數,Task 1 讓綠泡多一個展開器後這兩處都變不準:
1. zh:53 / en:63 寫「六顆泡泡、六個展開器,展開的都是它自己那則訊息」—— 改動後是六泡**七**展開器,而且綠泡第二個展開器展的是 turn 3 的**輸入** prompt(不是綠泡自己的輸出),「各展各自訊息」對綠泡不成立。
2. zh:63 / en:76 的綠泡描述只寫一個展開器「送給使用者的原始訊息 / the raw message sent to you」。

腳本紫泡「唯一例外 = 腳本原始碼」(zh:62 / en:74-75)仍然成立,**不動**。

- [ ] **Step 1: zh — line 53「六個展開器」改「七個」+ 綠泡例外**

`teaching/lesson-5-skill.zh-TW.md:53`,把:

```
- 點深看:六顆泡泡、六個展開器,展開的都是它自己那則訊息。灰色 user 泡
```

改成:

```
- 點深看:六顆泡泡、七個展開器 —— 除了綠泡,每個泡泡展開的都是它自己那則訊息;綠泡有兩個,同時展「自己的最終回覆」和「產生這個回覆的那份 prompt」。灰色 user 泡
```

- [ ] **Step 2: zh — line 63 綠泡加第二個展開器描述**

`teaching/lesson-5-skill.zh-TW.md:63`,把:

```
  prompt;綠泡 ▸「送給使用者的原始訊息」— 模型最終的回覆。帶學生:這是一次點擊、不是
```

改成(保留原句尾「帶學生:這是一次點擊、不是」逐字不動 —— 它接下一行的「兩次 — 展開琥珀泡…」,講的是琥珀泡那次點擊,不要動它以免和下一行重複):

```
  prompt;綠泡有兩個展開器 ▸「送給使用者的原始訊息」— 模型最終的回覆,以及 ▸「送給 AI 的 prompt(turn 3)」— 就是把工具結果 `<tool_response>` 包起來餵回模型、換出這個最終答案的那份 prompt(琥珀 highlight 標在那則餵回的工具結果上);腳本泡把它自己的按鈕讓給了「腳本原始碼」,所以這發餵回的 prompt 改在綠泡看。帶學生:這是一次點擊、不是
```

- [ ] **Step 3: en — line 63 "six expanders" → "seven" + 綠泡例外**

`teaching/lesson-5-skill.md:63`,把:

```
- For details: six bubbles, six expanders — each shows that bubble's own message. The grey
```

改成:

```
- For details: six bubbles, seven expanders — each shows that bubble's own message, except the green one, which has two: its own final reply, and the prompt that produced it. The grey
```

- [ ] **Step 4: en — line 76 綠泡加第二個展開器描述**

`teaching/lesson-5-skill.md:75-76`,把:

```
  code, which never once appears in any prompt the model saw. Green ▸ "the raw message sent to
  you" — the model's final reply. Tell the student it's one click, not two: expand the amber
```

改成(保留原句尾「Tell the student it's one click, not two: expand the amber」逐字不動 —— 它接下一行的「bubble and SKILL.md … is right there」,講的是琥珀泡,不要動它以免和下一行重複):

```
  code, which never once appears in any prompt the model saw. Green has two expanders ▸ "the raw
  message sent to you" — the model's final reply, and ▸ "the prompt sent to the AI (turn 3)" —
  the prompt that wrapped the tool result in `<tool_response>` and fed it back to the model to
  produce this final answer (the amber highlight sits on that fed-back tool result); the script
  bubble gave up its own button to "script source", so that fed-back prompt shows on green
  instead. Tell the student it's one click, not two: expand the amber
```

- [ ] **Step 5: 確認雙語鎖步 —— 兩檔都改到、數字一致**

Run: `grep -n "七個展開器\|seven expanders\|送給 AI 的 prompt(turn 3)\|the prompt sent to the AI (turn 3)" teaching/lesson-5-skill.zh-TW.md teaching/lesson-5-skill.md`
Expected:zh 檔命中「七個展開器」與「送給 AI 的 prompt(turn 3)」;en 檔命中「seven expanders」與「the prompt sent to the AI (turn 3)」。

- [ ] **Step 6: 確認舊描述已無殘留**

Run: `grep -n "六個展開器\|six expanders" teaching/lesson-5-skill.zh-TW.md teaching/lesson-5-skill.md`
Expected:無輸出(舊的「六個/six expanders」都已改掉)。

- [ ] **Step 7: Commit**

```bash
git add teaching/lesson-5-skill.zh-TW.md teaching/lesson-5-skill.md
git commit -m "docs(tab5): lesson describes green's two expanders, seven total"
```

---

## 最終驗證(瀏覽器,兩個 task 都完成後)

後端未動,`pytest agent/tests -q` 應仍 `135 passed`(防呆)。DOM 行為在瀏覽器驗證:

1. 確保 server 起著(`nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`),`GET /health` 的 `subscribers >= 1`(否則請學生開 http://localhost:9000/)。
2. tab⑤ 送「台北今天天氣怎樣?」(proper 模式):
   - **綠泡有兩個展開器**:上「送給使用者的原始訊息」、下「送給 AI 的 prompt(turn 3)」。
   - 展開下面那個:是 `<|im_start|>` 累積視圖,**最後一則非空訊息(工具結果 `<tool_response>` 裡的 `temp_c`/`condition`)有琥珀底 + 「← 這次新增、要送出的」**。
   - 腳本紫泡**仍只有一個**展開器「腳本原始碼」。
3. **迴歸**:
   - no_skills 對照(勾 no_skills 再送):綠泡**只有一個**展開器(沒有腳本泡 → 無孤兒 sent)。
   - 每個非綠泡仍 ≤ 1 展開器;tab③ token 不可點;console 0 errors。
4. tab④/⑥ 各驅動一次:綠泡**仍只有一個**展開器(它們沒有孤兒 sent)。

---

## 不在範圍

- tab④/⑥(沒有孤兒 sent,不受影響)。
- 腳本紫泡的展開器(維持只有腳本原始碼)。
- 後端 frame 形狀 / `skill_agent.py`。
- `frontend/wire.js`、`frontend/styles.css`。
