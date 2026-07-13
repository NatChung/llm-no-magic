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
  # 對齊 tab④ server.py:305 的 `if received_text else ""` —— 空回應不掛空泡泡
  received_chunk = f"<|im_start|>assistant\n{received_text}" if received_text else ""
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
- **⚠️ 同一個 `body` 還要加 `"chat_template_kwargs": {"enable_thinking": False}`。**
  現況 tab⑥ 只靠 `/no_think` system message 壓 thinking(`mcp_agent.py:127`),但那是
  **軟開關** —— 實測 token 流仍含 `<think>\n\n</think>\n\n`。tab④/⑤ 用的是硬的
  `enable_thinking:false` kwarg,token 流才乾淨。少了這行,tab⑥ 重建出來的
  received_chunk 會比 ④⑤ 多一行 `<think></think>`,正好違反「三端看起來一致」。
  (這只影響 generation body;sent_prompt 是另一個 `/apply-template` 呼叫算的
  〔`mcp_agent.py:135-139`〕,不帶此 kwarg,所以 `/no_think` system 行仍會出現在
  藍泡的 sent 視圖裡,不受影響。)
- 檔頭 `:8-9` 的註解只改「the loop requests no logprobs」那半句(不再成立);
  「no message_tokens」仍然成立(frame 還是不帶 `message_tokens`),保留。
- `received_chunk`(`mcp_agent.py:185`)從 `json.dumps(msg, …)` 改成同 §1 的重建
  (含 §1 的 `if received_text else ""` 護欄):
  ```python
  lp = resp_llm["choices"][0].get("logprobs", {}) or {}
  received_text = "".join(t.get("token", "") for t in lp.get("content", []))
  ...
  "received_chunk": (f"<|im_start|>assistant\n{received_text}"
                     if received_text else ""),
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
  `received[0]["received_chunk"]` 是含 `<|im_start|>assistant` **且含 token 內容**的字串。
  **mock 要提供 logprobs,而且要 nest 在 `choices[0]` 裡**——重建讀的是
  `resp["choices"][0].get("logprobs")`。現有 mock 的 `R.json()`
  (`test_skill_agent.py:8-13`)回 `{"choices":[{"message":msg}]}`,要改成
  `{"choices":[{"message":msg, "logprobs":{"content":[{"token":"hi"}]}}]}`。
  **斷言要驗 token 內容(`"hi" in received_chunk`),不能只驗前綴**——前綴
  `<|im_start|>assistant` 永遠都在,只驗前綴等於沒驗到重建有沒有真的動。
- `agent/tests/test_mcp_agent.py:129-131`:現在 `json.loads(received_chunk)` +
  斷言 `role`/`content`。改成斷言 `received_chunk` 是 `<|im_start|>assistant\n` 開頭、
  **含 token 內容(`"answer" in received_chunk`)、且不含 `<think>`**(守 §2 的
  enable_thinking Critical)。**mcp mock 的 `_llama_resp` 也要在 `choices[0]` 裡加
  `logprobs`**——把 `answer` 拆成 token,例如
  `"logprobs":{"content":[{"token":"answer"}]}`,否則重建空字串、`"answer" in …` 會紅。

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
   - **tab⑥ 的 received 開頭直接是 `<tool_call>` / 內容,不能有 `<think></think>`**
     (守 §2 的 enable_thinking Critical —— 這正是 tab⑥ 跟 ④⑤ 唯一會不一致的點)
   - tab⑤/⑥ 的 content-only final turn:看得到 `<|im_start|>assistant\n{最終答案}`
3. **迴歸**:tab⑤/⑥ 的 context chip(context: N tokens)仍正常(它走 turn frame 的 usage,
   不受 received 改動影響);每泡仍 ≤1 直接子 `<details>`;console 0 errors。
4. 兩個 HTML:`app.js?v=95`、`wire.js?v=2`、`styles.css?v=66`;`styles.css` 未動。

## 不在範圍

- tab④ received 的形狀(它是基準,不動)
- 把 received 也加「這次新增」那種 highlight(那是 sent 視圖的事)
- per-token 機率(tab⑤/⑥ 沒有這個 UI;`top_logprobs:1` 只是拿 token 文字)
