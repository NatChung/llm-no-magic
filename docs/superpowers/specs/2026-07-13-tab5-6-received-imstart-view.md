# tab⑤/⑥ 的「模型吐的原始訊息」改成 `<|im_start|>` 視圖(與 tab④ 一致)

Date: 2026-07-13
Status: approved (brainstorming → ready for plan)

## 問題

三個 tab 的藍泡/綠泡都有一個「模型吐的原始訊息」展開器,標籤相同,但吃到的資料形狀不同:

| tab | 後端產生 | 前端渲染成 |
|---|---|---|
| ④ agent | `<\|im_start\|>assistant\n{原始 token 流}`(`server.py:305`,有 logprobs) | **`<\|im_start\|>` 視圖** |
| ⑤ skill | `{message, usage}` JSON(`skill_agent.py:401-404`,無 logprobs) | JSON 樹 |
| ⑥ mcp | `json.dumps(msg)` JSON(`mcp_agent.py:185`,無 logprobs) | JSON 樹 |

使用者要三端**看起來一致**:tab⑤/⑥ 也顯示 `<|im_start|>assistant\n<tool_call>…`。

## 根因與唯一可行路

tab④ 能顯示 `<tool_call>…` 是因為它請求 `logprobs: True`(`server.py:272`),拿得到模型
literally 吐出的 token 流(本來就含 `<tool_call>` XML)。tab⑤/⑥ 沒開 logprobs,只有 OpenAI
API **已 parse 的結構化 message**,所以只能丟 JSON。

探路實測(在寫 spec 前跑過,砍掉兩條):
- **A. 對那則 assistant message 打 `/apply-template`** → ❌ 實測壞:單一 assistant+tool_call
  的 template 輸出是 `<|im_start|>assistant\n<think>\n\n</think>\n\n`,**tool_call 整個不見**、
  還多塞 `<think></think>`。走不通。
- **B. 手動拼 `<tool_call>\n{json}\n</tool_call>`** → ❌ 脆:得複製 Qwen 格式慣例,易漂移。
- **C. 也開 logprobs、從 token 流重建**(採用)→ ✅ 實測:skill_agent 風格請求加
  `logprobs: True` 後,tool_call 回應的 `logprobs.content` token 流含
  `<tool_call>\n{"name": "read_file", …}`。跟 tab④ `server.py:305` 完全同一招。

## 設計

### 1. 後端 tab⑤(`agent/skill_agent.py`)

- llama 請求 `req_body`(`skill_agent.py:350` 附近)加:
  ```python
  "logprobs": True,
  "top_logprobs": 1,     # 只要 token 文字,不需要分布(tab⑤ 無 per-token chart)
  ```
- 拿到 `resp` 之後(`msg = resp["choices"][0]["message"]` 那附近),照 tab④
  `server.py:304-305` 重建,**用 `.get` 護欄避免 mock/無 logprobs 時炸**:
  ```python
  lp = resp["choices"][0].get("logprobs", {}) or {}
  received_text = "".join(t.get("token", "") for t in lp.get("content", []))
  received_chunk = f"<|im_start|>assistant\n{received_text}"
  ```
- `received` frame(`skill_agent.py:400-404`)改成帶 `received_chunk`(字串),
  **移除 `response`/`usage`**:
  ```python
  yield {
      "type": "received",
      "turn": turn,
      "received_chunk": received_chunk,
  }
  ```
  `usage` 不需保留 —— context chip 走的是 `turn` frame 的 `usage`(`app.js:989`),
  received 的 usage 一直是多餘的。

### 2. 後端 tab⑥(`agent/mcp_agent.py`)

- llama 請求 `body`(`mcp_agent.py:143`)加 `"logprobs": True, "top_logprobs": 1`。
- 移除檔頭 `:8` 的「requests no logprobs」註解(不再成立)。
- `received_chunk`(`mcp_agent.py:185`)從 `json.dumps(msg, …)` 改成同 §1 的重建:
  ```python
  lp = resp_llm["choices"][0].get("logprobs", {}) or {}
  received_text = "".join(t.get("token", "") for t in lp.get("content", []))
  ...
  "received_chunk": f"<|im_start|>assistant\n{received_text}",
  ```

### 3. 前端

- **tab⑥:零改動。** `app.js:1220` 本來就是 `BUBBLE.wire(f.received_chunk)`;後端一改成
  chat 字串,wire.js 的 `detect()` 自動走 `<|im_start|>` 視圖。
- **tab⑤:** `onReceived`(`app.js:975`)現在 `pendingReceived = f.response`,改成
  `pendingReceived = f.received_chunk`(字串)。兩個渲染點(`app.js:995`、`:1055`)
  從 `BUBBLE.wire(JSON.stringify(pendingReceived, null, 2))` 改成
  `BUBBLE.wire(pendingReceived)`。

結果:三端「模型吐的原始訊息」都是 `<|im_start|>assistant\n<tool_call>…`,byte 形狀與
tab④ 一致(皆無結尾 `<|im_end|>`,因為 token 流本來就不含)。

### 4. 測試

- `agent/tests/test_skill_agent.py:42-55`(`test_received_frame_is_emitted_per_turn`):
  現在斷言 `received[0]["response"].keys() == {"message","usage"}`。改成斷言
  `received_chunk` 是含 `<|im_start|>assistant` 的字串。**mock 要提供 logprobs**
  —— 現有 mock 的 `R.json()`(`test_skill_agent.py:8-13`)沒有 `logprobs` key,
  重建會得到空字串;要在 mock 回應裡加
  `"logprobs": {"content": [{"token": "hi"}]}`,測試才驗得到內容。
- `agent/tests/test_mcp_agent.py:129-131`:現在 `json.loads(received_chunk)` +
  斷言 `role`/`content`。改成 `received_chunk` 是 `<|im_start|>assistant\n` 字串、
  含預期內容。**mcp mock 的 `_llama_resp` 也要加 logprobs 欄位**(否則重建空字串)。

### 5. 教材 —— 不用改(已查證)

已檢查 `teaching/lesson-5-skill.zh-TW.md:55`、`teaching/lesson-6-mcp.zh-TW.md:35` 與
EN 對應(`lesson-5-skill.md:66`、`lesson-6-mcp.md:42`):它們只描述「模型吐的原始訊息 /
`read_file` 呼叫 / 模型吐的原始 `<tool_call>`」,**沒有一處描述格式是 JSON**。lesson-6
甚至已寫「模型吐的原始 `<tool_call>`」—— 改動後只會**更準**(真的會顯示 `<tool_call>`)。
所以本次教材零改動。(實作者仍要跑一次 grep 確認沒有別處描述舊 JSON 形狀。)

### 6. Cache-bust

只有 `app.js` 改(tab⑤ 前端);`wire.js` 不動。
- `app.js?v=94 → ?v=95`(兩個 HTML)
- `wire.js?v=2`、`styles.css?v=66` 不動。

### 7. 不動的東西

- `frontend/wire.js`、`frontend/styles.css` 不改。
- tab④ 後端(`server.py`)不改 —— 它已經是 `<|im_start|>` 視圖,是對齊的基準。
- Tabs ①②③ 不動。

## 驗收

1. `pytest agent/tests -q` 全綠(skill/mcp received 測試已改成斷言 `<|im_start|>` 字串;
   mock 已加 logprobs)。
2. 瀏覽器,三端各驅動一次,展開藍泡的「模型吐的原始訊息」:
   - ④⑤⑥ **都是 `<|im_start|>assistant` 視圖**,不再有任何一個是 JSON 樹
   - tab⑤/⑥ 的 tool-calling turn:展開看得到 `<tool_call>\n{"name":…}` 上色
   - tab⑤/⑥ 的 content-only final turn:看得到 `<|im_start|>assistant\n{最終答案}`
3. **迴歸**:tab⑤/⑥ 的 context chip(context: N tokens)仍正常(它走 turn frame 的 usage,
   不受 received 改動影響);每泡仍 ≤1 直接子 `<details>`;console 0 errors。
4. 兩個 HTML:`app.js?v=95`、`wire.js?v=2`、`styles.css?v=66`;`styles.css` 未動。

## 不在範圍

- tab④ received 的形狀(它是基準,不動)
- 把 received 也加「這次新增」那種 highlight(那是 sent 視圖的事)
- per-token 機率(tab⑤/⑥ 沒有這個 UI;`top_logprobs:1` 只是拿 token 文字)
