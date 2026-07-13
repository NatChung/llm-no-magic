# tab⑤ 腳本泡後被丟棄的 sent prompt 改掛到綠泡

Date: 2026-07-13
Status: approved (brainstorming → ready for plan)

## 問題

tab⑤ 一次 check_weather(read_file → run_script → 最終答案)有三發 sent prompt。
前端用 `lastRightBubble` 把每發 sent 掛到「引發它的右側泡泡」:

```
sent(1) → 你(user 灰泡)     「送給 AI 的 prompt(turn 1)」
sent(2) → 琥珀泡(SKILL.md 注入)「送給 AI 的 prompt(turn 2)」
sent(3) → ✗ 沒有歸宿 → 靜默丟棄
final   → 綠泡              「送給使用者的原始訊息」
```

`sent(3)` 被丟棄,是因為它前面的**腳本紫泡是刻意的例外**(`app.js:1029-1030`):
它把唯一的按鈕留給「腳本原始碼」(教學點:「你看得到、model 從頭到尾沒看過」),
並設 `lastRightBubble = null`,所以下一發 `sent(3)` 沒地方掛。

**後果:** `sent(3)` 正是**工具結果 `{"city":"台北","temp_c":28,…}` 被 `<tool_response>`
包起來餵回模型**的那份 prompt —— tab⑤ 現在**看不到**。而 tab④ 的工具泡沒有這個例外,
它的「工具結果餵回」看得到。這個不對稱是本次要修的。

## 目標

把被丟棄的 `sent(final turn)` 掛到**綠泡**當第二個展開器,學生就看得到工具結果餵回模型的
那份 prompt。綠泡因此有兩個按鈕 —— 這是對「每泡一個按鈕」規則的**限定例外**(只破綠泡;
腳本紫泡維持只有「腳本原始碼」)。

## 設計(只動 tab⑤ 前端;後端零改動)

`sent(3)` frame 本來就存在,只是被前端丟掉。全部改動在 `frontend/app.js` 的
`setupSkillTab`。

### 1. `onSent`(`app.js:958-973`)—— 丟棄改成緩衝

現況:`lastRightBubble` 為 null 時直接丟(那段 `// else: no home … drop silently`)。
改成緩衝到一個新變數 `orphanedSent`:

```js
  function onSent(f) {
    if (lastRightBubble) {
      lastRightBubble.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn: f.turn }),
        BUBBLE.wire(f.sent_prompt, { markSent: true }), { align: "right" }));
      lastRightBubble = null;
    } else {
      // 沒有右側泡泡可掛(它跟在例外的腳本泡後面)—— 緩衝起來,onFinal 掛到綠泡。
      // 這發正是「工具結果餵回模型、產生最終答案」的 prompt,綠泡就是那個答案。
      // 多個孤兒時取最後一發(最接近 final turn 的那發)。
      orphanedSent = { prompt: f.sent_prompt, turn: f.turn };
    }
  }
```

### 2. `onFinal`(`app.js:1044-1064`)—— 綠泡掛第二個展開器

在掛完 `pendingReceived`(「送給使用者的原始訊息」)之後、`turnsEl.appendChild(fb)` 之前,
加上第二個展開器:

```js
      if (pendingReceived) {
        fb.appendChild(BUBBLE.details(t('to_user_raw_summary'),
          BUBBLE.wire(pendingReceived)));
        pendingReceived = null;
      }
      // 腳本泡後被丟棄的 sent(final turn)—— 掛到綠泡當第二個展開器,學生才看得到
      // 工具結果餵回模型的那份 prompt。received 在前、sent 在後。
      if (orphanedSent) {
        fb.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn: orphanedSent.turn }),
          BUBBLE.wire(orphanedSent.prompt, { markSent: true })));
        orphanedSent = null;
      }
      turnsEl.appendChild(fb);
```

**對齊:** 綠泡是全寬置中,它的展開器不用 `{ align: "right" }`(那是右側泡泡用的)——
跟綠泡既有的「送給使用者的原始訊息」展開器一樣走預設(左)。`markSent: true` 是
`WIRE.render` 的選項(琥珀 highlight 那份 prompt 的最後一則非空 = 餵回的工具結果),
與 align 無關。

### 3. 宣告與重置

- `orphanedSent` 宣告在 `lastRightBubble` / `pendingReceived` 附近(`app.js:927-930` 一帶):
  `let orphanedSent = null;`
- `clearAll`(`app.js:932-936`)重置:`lastRightBubble = null; pendingReceived = null; orphanedSent = null;`

### 4. 註解更新

- `app.js:920-926` 的 lastRightBubble 說明:把「the NEXT sent has nowhere to attach and
  is dropped silently」改成「…is buffered as `orphanedSent` and attached to the green
  final bubble as a second expander」。
- `app.js:967-972` 原本的「drop silently … 」註解已被 §1 的新 else 分支取代。

### 5. 教材(雙語)

`teaching/lesson-5-skill.zh-TW.md:63`(與 EN `lesson-5-skill.md` 對應)現在寫
「綠泡 ▸『送給使用者的原始訊息』— 模型最終的回覆」,只描述一個展開器。改成綠泡有
**兩個**:「送給使用者的原始訊息」+「送給 AI 的 prompt(turn 3)」,並點出後者就是
**工具結果餵回模型**的現場(琥珀標記),補足「腳本泡把按鈕讓給腳本碼,那發餵回的
prompt 改在綠泡看」。lesson-5:74 / zh:62 描述腳本泡「唯一例外 = 腳本原始碼」仍然成立,
不動。雙語同步。

### 6. 不動的東西

- 後端(`skill_agent.py` 及所有 agent)零改動 —— `sent(3)` frame 本來就送。
- tab④/⑥ 零改動 —— 只有 tab⑤ 有例外的腳本泡會產生孤兒 sent;tab④/⑥ 的每個右側泡
  都接得住自己的 sent。
- `frontend/wire.js`、`frontend/styles.css` 不動。腳本紫泡維持只有「腳本原始碼」。

### 7. Cache-bust

只有 `app.js` 改:`app.js?v=95 → 96`(兩個 HTML 同號);`wire.js?v=2`、`styles.css?v=66`
不動。

## 邊界情形

- **孤兒 sent 不只一發(多工具流程):** `orphanedSent` 取**最後一發**(overwrite)。對
  check_weather 這種「一個腳本泡 → final」只有一發孤兒,取最後即取到 sent(final),正確。
- **empty-final-retry(`onSent` 註解原本的 case 2):** skill_agent 對空回應 retry 時那個
  turn 也不產生右側泡泡,其 sent 也會變孤兒;overwrite 規則下最後一發勝出,仍掛到綠泡。
  degraded 情形,可接受(比原本直接丟好)。
- **no_skills 模式 / 沒有腳本泡的流程:** 每發 sent 都有右側泡泡可掛,`orphanedSent`
  一直是 null,`onFinal` 不加第二個展開器,綠泡維持一個 —— 零迴歸。

## 驗收

1. `node --check frontend/app.js` 通過;`node --test frontend/wire.test.js` → `pass 19`
   (沒動 wire.js,防呆)。
2. `pytest agent/tests -q` → `135 passed`(後端零改動,防呆)。
3. 瀏覽器,tab⑤ 送「台北今天天氣怎樣?」:
   - **綠泡有兩個展開器**:「送給使用者的原始訊息」(前)+「送給 AI 的 prompt(turn 3)」(後)
   - 展開後者:是 `<|im_start|>` 累積視圖,**最後一則非空(工具結果 `<tool_response>`
     裡的 `temp_c`/`condition`)有琥珀底 + 「← 這次新增、要送出的」**
   - 腳本紫泡**仍只有一個**展開器「腳本原始碼」(不受影響)
4. **迴歸**:
   - tab④/⑥ 的綠泡**仍只有一個**展開器(它們沒有孤兒 sent)
   - tab⑤ no_skills 對照:綠泡只有一個展開器(沒有腳本泡 → 無孤兒)
   - 每個非綠泡仍 ≤1 展開器;tab③ token 不可點;console 0 errors
5. 兩個 HTML:`app.js?v=96`、`wire.js?v=2`、`styles.css?v=66`;`styles.css`/`wire.js` 未動。

## 不在範圍

- tab④/⑥(沒有孤兒 sent)
- 腳本紫泡的展開器(維持只有腳本原始碼)
- 後端 frame 形狀
