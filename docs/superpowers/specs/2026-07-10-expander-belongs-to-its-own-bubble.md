# 修正:收合按鈕要掛在「它自己那則訊息」的泡泡下

Date: 2026-07-10
Status: approved, supersedes §3 of `2026-07-10-chat-bubble-user-right-single-expander-design.md`

## 這是什麼

上一份 spec 把使用者的原話「each chat bubble will have only one button showing
**their own original message**」誤讀成「每個泡泡掛**這一 turn 送出的 prompt**」,
結果:

- user 泡沒有按鈕
- 模型藍泡(**輸出**)底下掛著這一 turn 的 prompt(**輸入**)—— 錯位一格

這跟舊 `next_prompt` 的毛病是同一個:資料掛在錯的那顆泡泡上。後端修好了,前端重演。

## 正確規則(依方向)

```
右側 = 進入模型的東西  →  掛「因它而送出的那一發 prompt」
左側藍泡 / 綠泡 = 模型吐出來的  →  掛「模型自己那則原始訊息」
```

每顆泡泡的按鈕,展開的都是**它自己那則訊息**的 wire 原文。

## 對應表(ground truth,實作只依此表)

### Tab ④ agent

| 泡泡 | 位置 | 展開 | 資料來源 |
|---|---|---|---|
| user 灰 | 右 | 送給 AI 的 prompt(turn 1) | `turn_complete(1).sent_prompt` |
| 模型 藍(turn N) | 左 | 模型吐的原始訊息 | `turn_complete(N).received_chunk` |
| 工具 紫(turn N) | 右 | 送給 AI 的 prompt(turn N+1) | `turn_complete(N+1).sent_prompt` |
| 綠(final turn F) | 全寬 | 送給使用者的原始訊息 | `turn_complete(F).received_chunk` |

### Tab ⑥ mcp

同 ④,外加 JSON-RPC protocol card(不是 chat bubble,維持現狀:自己一個
「完整 JSON-RPC 內容」展開器)。

| 泡泡 | 位置 | 展開 | 資料來源 |
|---|---|---|---|
| user 灰 | 右 | 送給 AI 的 prompt(turn 1) | `turn_complete(1).sent_prompt` |
| 模型 藍(turn N) | 左 | 模型吐的原始訊息 | `turn_complete(N).received_chunk` |
| 工具 紫(turn N) | 右 | 送給 AI 的 prompt(turn N+1) | `turn_complete(N+1).sent_prompt` |
| 綠(final turn F) | 全寬 | 送給使用者的原始訊息 | `turn_complete(F).received_chunk` |

### Tab ⑤ skill

| 泡泡 | 位置 | 展開 | 資料來源 |
|---|---|---|---|
| user 灰 | 右 | 送給 AI 的 prompt(turn 1) | `sent(1).messages` |
| 模型 藍(turn N) | 左 | 模型吐的原始訊息 | `received(N).response` |
| 琥珀 L2 注入(turn N 之後) | 右 | 送給 AI 的 prompt(turn N+1) | `sent(N+1).messages` |
| 紫 腳本回傳 | 右 | **腳本原始碼**(唯一例外) | `scriptSources[...]` |
| 綠(final turn F) | 全寬 | 模型吐的原始訊息 | `received(F).response` |

**⑤ 紫泡是規則的唯一例外,而且是刻意的:** 腳本原始碼**永遠不會**出現在任何一份
prompt 裡 —— 那正是 lesson-5 的教學點(「你看得到,model 從頭到尾沒看過」)。
沒有任何 prompt 可以代替它。琥珀泡則相反:它的注入內容**就躺在**下一發 prompt 的
`messages` 裡,所以換成 prompt 反而比單看 SKILL.md 全文更接近「注入的現場」。

### ⑤ 的 `sent` 與 ④⑥ 的 `sent_prompt` 顯示形式不同(維持不變)

- ④⑥:chat-template 過的字串(`<|im_start|>system` … `<tools>` …)
- ⑤:`messages[]` JSON 陣列(lesson-5 要看到 SKILL.md 以 `role: tool` 躺在裡面)

## 掛載時機(前端)

**關鍵事實(已驗證):** `sent(N)` / `turn_complete(N)` 抵達時,畫面上最後一顆右側
泡泡正好是 turn N-1 產生的那顆。所以不需要改任何 frame 的順序或內容 ——
前端保留一個 `lastRightBubble` reference 即可:

- turn 1 的 sent → 掛到 user 泡
- turn N(N≥2)的 sent → 掛到 `lastRightBubble`
- 一個 turn 有多顆工具泡時,掛到**最後一顆**(舊 `next_prompt` 的行為)
- max-turns 截停時,最後一顆工具泡拿不到 sent → 沒有按鈕(可接受)

## 後端:把三個欄位取回來

上一輪刪掉的欄位,正是「模型自己那則原始訊息」。從 git 原樣取回:

| 檔案 | 欄位 | 取回自 |
|---|---|---|
| `agent/server.py` `agent_loop` | `received_chunk` | `git show fd85633:agent/server.py`(原 :287-290, :314) |
| `agent/mcp_agent.py` | `received_chunk` | `git show fd85633:agent/mcp_agent.py`(原 :171) |
| `agent/skill_agent.py` | `received` frame | `git show fd85633:agent/skill_agent.py`(原 :381-388) |

`sent_prompt` **保留**(上一輪的成果沒有白費:`next_prompt(N) ≡ sent_prompt(N+1)`,
而 turn 1 的 sent_prompt 是舊 `next_prompt` 拿不到的,正好給 user 泡用)。
`next_prompt` **不要**復活。

## 每泡最多一個按鈕(不變)

user 泡現在**有**按鈕了(它的原文是整份 prompt,跟本體差很多)。
④⑥ 的紫泡也**有**按鈕了(掛下一發 prompt)。
仍然沒有任何泡泡超過一個按鈕。

## i18n

需要的 key(EN + zh-TW 都要):

- `sent_prompt_summary`(已存在)— 給 user 泡與工具泡:「送給 AI 的 prompt(turn N)」
- 新增 `model_raw_summary` — 給藍泡:「模型吐的原始訊息」/ `The raw message the model emitted`
- 新增 `to_user_raw_summary` — 給綠泡:「送給使用者的原始訊息」/ `The raw message sent to you`
- `script_source_summary`(已存在)— ⑤ 紫泡
- 刪除 `l2_body_summary`(⑤ 琥珀泡改掛 prompt,SKILL.md 全文不再單獨展開)
  — 已確認唯一使用者是 `app.js:917`
- 刪除 `l2_see_sent_hint` 與它那個 hint `<div>`(`app.js:919-921`)。原文是
  「→ 展開下一個 turn 的 sent,看它躺在 messages 裡」—— 新設計下琥珀泡**自己的**
  按鈕就是那份 sent,這行提示變成指向自己,沒有意義

## 驗收

1. `pytest agent/tests -q` 全綠
2. ④ 送「現在幾點?」:
   - user 泡 ▸ 一個按鈕,展開是 templated prompt,**裡面找得到 `現在幾點?`,而且
     `<tools>` 區塊裡有 `get_time`**
   - 藍泡 ▸ 展開看得到 `<tool_call>`(模型的原始輸出,不是 prompt)
   - 紫泡 ▸ 展開是下一發 prompt,**裡面找得到 `10:` 這個工具回傳的時間字串**
   - 綠泡 ▸ 展開是 `<|im_start|>assistant` 開頭的原始訊息
3. ⑤ 送「台北今天天氣怎樣?」:
   - user 泡 ▸ `messages[]`,只有 system + user 兩則
   - 琥珀泡 ▸ `messages[]`,**裡面找得到 `role: "tool"` 且內容含 SKILL.md 的字串**
   - 紫泡 ▸ 腳本原始碼(含 `def get_weather`)
   - 綠泡 ▸ 模型原始 response
4. ⑥ 送「現在幾點?」:user 泡的 prompt 裡 `<tools>` 含握手問來的 `get_time` + `get_weather`
5. 每顆泡泡的 `<details>` 數量 ≤ 1
6. **迴歸**:tab③ token 仍不可點(`cursor: default`);tab① 仍可點
7. **迴歸**:console 0 errors

## 不在範圍

- Tabs ①–③
- JSON-RPC protocol card 的展開器(⑥,維持現狀)
