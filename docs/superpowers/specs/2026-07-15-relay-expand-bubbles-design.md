# Relay 遠端展開泡泡 (`/inspect` action) + Tab ⑥ 暫時隱藏 — design

## 動機

帶課時教材(lesson-4)設計是「一顆泡泡一顆泡泡帶:點開 → 講解 → 關起來 → 等學員消化
→ 下一顆」。但 `▸` 展開器是純前端 `<details>`,relay 沒有任何動作能代按 — AI 只能貼文字
請學員自己點,節奏斷掉。本 feature 讓 AI 透過 relay 直接展開/收合指定泡泡的展開器。

另外:Tab ⑥ MCP 教法未定,先從 nav 下拉隱藏(code 全留,教材不動)。

## 範圍

- **做**:Tab ④(代理)、Tab ⑤(Skill)的泡泡層級展開器(每顆泡泡下方的 `▸`),
  含 Tab ⑤ 常駐的 anatomy 解剖卡。
- **不做**:wire view 內層的訊息折疊(展開器打開後裡面那排可收合的訊息清單)—
  之後有需要再加。Tab ⑥ MCP 不納入(隱藏中)。

## API — 重用 `/inspect`(慣例:endpoint 清單不長)

```
POST /inspect {"action":"expand"|"collapse", "tab":"4"|"5", "role":"sent", "turn":1}
```

- `action` 出現 → 走新分支(先於既有 tab-5 anatomy / tokenIndex 分支判斷)。
- `role` 必填;`turn` 選填(省略 = 該 role 的最後一顆,方便 final)。
- server 驗證後 `publish({"type":"expand","tab":…,"role":…,"turn":…,"open":action=="expand"})`
  → 回 `{"ok":true,"subscribers":N}`。缺 `action` 時完全走舊行為(向後相容)。
- `role`/`tab` 缺 → 400 `{"ok":false,"error":…}`。

## 前端

1. `BUBBLE.details()` 加選填 `expandKey: {role, turn}` → 刻在 `<details>` 的
   `data-x-role` / `data-x-turn` 上。各 call site 傳入。
2. `/events` dispatcher 加 `case "expand"` → 全域 `handleExpand(f)`(不走 active
   panel:anatomy 卡不需要 drive 就存在,且 reload 後 active 為 null)。
3. `handleExpand`:以 `TAB_TO_PANEL[f.tab]` 找 panel → `details[data-x-role=…]`
   (有 turn 再過濾 `data-x-turn`),多顆取最後 → `.open = f.open` →
   `activateTabUI` 切到該分頁 + `scrollIntoView({block:"center"})`。找不到就靜默
   (degraded, not broken)。

## role 座標表

| tab | role | 對應展開器 |
|-----|------|-----------|
| 4/5 | `sent` | 「送給 AI 的 prompt(turn N)」(右側泡泡) |
| 4/5 | `raw` | 「模型吐的原始訊息」(藍泡) |
| 4/5 | `final` | 「送給使用者的原始訊息」(綠泡;通常省 turn) |
| 5 | `script` | 腳本原始碼(紫泡,省 turn) |
| 5 | `anatomy_l1/l2/l3` | 解剖卡三層(靜態,無 turn) |

AI 端從 `/drive` 回傳的 turns 結構即可算出 (turn, role),兩邊各自推導、無需傳 ID。

## Tab ⑥ 隱藏

兩份 HTML 的 `<option value="mcp">` 註解掉(附「教法未定,暫隱藏」註記)。
panel/程式碼/教材全留;直接 `/drive {"tab":"6"}` 仍可用(不影響 smoke 回歸)。

## 測試

- pytest(`agent/tests/test_server.py` 既有風格):
  - `action:expand` → publish expand frame(open=true)+ 200 ok
  - `action:collapse` → open=false
  - 缺 role → 400;無 action 的舊三種行為不變(既有測試守著)
- 前端 DOM 依慣例瀏覽器驗證(playwright):drive tab-4 → expand sent(1) →
  斷言 `details[open]`;collapse → 斷言關閉。
- 兩份 HTML `?v=` cache-bust 同步 bump(app.js 變更)。
