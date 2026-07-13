# tab⑤/⑥「模型吐的原始訊息」改 `<|im_start|>` 視圖 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 tab⑤/⑥ 的「模型吐的原始訊息」展開器跟 tab④ 一樣顯示 `<|im_start|>assistant\n<tool_call>…` 累積視圖(現況是 JSON 樹)。

**Architecture:** tab⑤/⑥ 的 llama 生成請求加 `logprobs: True`,從 `logprobs.content` token 流重建 `received_chunk = "<|im_start|>assistant\n" + tokens`(照 tab④ `server.py:305`);frame 改帶這個字串。wire.js 的 `detect()` 看到 `<|im_start|>` 開頭自動走 chat 渲染 —— 前端幾乎不用改。

**Tech Stack:** stdlib Python + `requests`(打 llama `/v1/chat/completions`)、zero-build 前端(wire.js 已能渲染)、pytest。

Spec: `docs/superpowers/specs/2026-07-13-tab5-6-received-imstart-view.md`

## Global Constraints

- **⚠️ tab⑥ 的生成 `body` 一定要加 `"chat_template_kwargs": {"enable_thinking": False}`。** 它現況只靠 `/no_think` system message(**軟開關**),token 流仍含 `<think>\n\n</think>\n\n`;tab④/⑤ 用硬的 kwarg 才乾淨。少了它,tab⑥ 重建會比 ④⑤ 多一行 `<think></think>`,違反「三端看起來一致」。(實測:tab⑥ 現況 = `<think>\n\n</think>\n\n<tool_call>…`,④⑤ = `<tool_call>…`。)
- 重建一律照 tab④ 的**空回應護欄**:`received_chunk = f"<|im_start|>assistant\n{received_text}" if received_text else ""`(空回應不掛空泡)。
- 用 `.get` 護欄避免 mock/無 logprobs 炸:`lp = resp["choices"][0].get("logprobs", {}) or {}`;`lp.get("content", [])`。
- 測試 mock 的 `logprobs` 必須 **nest 在 `choices[0]` 裡**(重建讀的是 `resp["choices"][0]`);斷言要驗 **token 內容**,不能只驗永遠都在的前綴 `<|im_start|>assistant`。
- `frontend/wire.js`、`frontend/styles.css`、tab④ 後端(`server.py`)、Tabs ①②③ **不動**。
- Cache-bust:只有 `app.js` 改 → `app.js?v=94 → 95`;`wire.js?v=2`、`styles.css?v=66` 不動;兩個 HTML 同號。
- 測試:plain pytest function + `monkeypatch`,維持既有風格。
- 伺服器:`nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`

## File Structure

| 檔案 | 本次責任 |
|---|---|
| `agent/skill_agent.py` | req_body 加 logprobs;重建 received_chunk;received frame 改帶字串、丟 response/usage |
| `agent/tests/test_skill_agent.py` | `_resp` mock 加 logprobs;received 斷言改成驗 `<|im_start|>` 字串 |
| `agent/mcp_agent.py` | body 加 logprobs **+ enable_thinking:false**;重建 received_chunk;改檔頭註解 |
| `agent/tests/test_mcp_agent.py` | `_llama_resp` mock 加 logprobs;received_chunk 斷言改字串;擷取 generation body 斷言 `enable_thinking:False`(真守 Critical) |
| `frontend/app.js` | tab⑤ onReceived 改吃 received_chunk;2 個 render site 去掉 JSON.stringify |
| `frontend/index.html`、`index.zh-TW.html` | `app.js?v=95` |

教材:**不用改**(已查證 lesson-5/6 只描述內容、不描述 JSON 格式)。實作最後 grep 確認一次即可。

---

### Task 1: 後端 tab⑤ —— received 改帶 templated received_chunk

**Files:**
- Modify: `agent/skill_agent.py`(req_body、msg 之後重建、received frame)
- Modify: `agent/tests/test_skill_agent.py`（`_resp` mock、`test_received_frame_is_emitted_per_turn`)

**Interfaces:**
- Produces:`received` frame 改帶 `received_chunk`(str,`<|im_start|>assistant\n…` 或空字串);**移除 `response` 欄位**。`usage` 仍在 `turn` frame(不動)。

- [ ] **Step 1: 改測試斷言(先讓它反映新行為 → 會失敗)**

`agent/tests/test_skill_agent.py` 的 `_resp` helper(`:4-13`),在 mock 回應的
`choices[0]` 裡加 logprobs(從 content 衍生,才不會寫死):

```python
def _resp(content=None, tool_calls=None, prompt_tokens=500):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    class R:
        def json(self):
            return {"choices": [{"message": msg,
                                 "logprobs": {"content": [{"token": content}] if content else []}}],
                    "usage": {"prompt_tokens": prompt_tokens,
                              "completion_tokens": 7}}
    return R()
```

`test_received_frame_is_emitted_per_turn`(`:42-55`)的斷言改成:

```python
    received = [e for e in events if e["type"] == "received"]
    assert len(received) == 1
    assert received[0]["turn"] == 1
    # received 現在帶 templated 字串(跟 tab④ 一致),不再是 {message, usage}
    assert "response" not in received[0]
    rc = received[0]["received_chunk"]
    assert rc.startswith("<|im_start|>assistant")
    assert "hi" in rc            # 驗 token 內容,不能只驗永遠都在的前綴
```

(docstring 那句「只有 response = {message, usage} 兩個 key」也順手改成描述 received_chunk。)

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest agent/tests/test_skill_agent.py::test_received_frame_is_emitted_per_turn -q`
Expected: FAIL — `KeyError: 'received_chunk'`(frame 還沒改)

- [ ] **Step 3: 改 `agent/skill_agent.py`**

req_body(`:350-359`)**只插入兩行 logprobs**(既有的 `chat_template_kwargs` 那行與它
上面的 `# 同 tab4 agent_loop…` 註解都保留、不動)。在 `"chat_template_kwargs": …,` 那行
**之後**插:

```python
            "logprobs": True,
            "top_logprobs": 1,
```
插完長這樣(上半保留原樣):
```python
        req_body = {
            "model": "any",
            "messages": messages,
            "temperature": 0.3,
            # 同 tab4 agent_loop:壓掉 Qwen3 thinking — 中文輸入特別容易觸發
            # <think>,token 全花在思考、content 變空(空 final 偶發的主因)
            "chat_template_kwargs": {"enable_thinking": False},
            "logprobs": True,
            "top_logprobs": 1,
        }
```

`msg = resp["choices"][0]["message"]` 之後、`received` frame 之前,加重建
(`usage_raw`/`usage` 的計算保留 —— `turn` frame 還要用):

```python
        # 模型吐的原始訊息 —— 從 logprobs token 流重建 <|im_start|>assistant\n…
        # (同 tab④ server.py:304-305,讓三個 tab 的 received 視圖一致)
        lp = resp["choices"][0].get("logprobs", {}) or {}
        received_text = "".join(t.get("token", "") for t in lp.get("content", []))
        received_chunk = (f"<|im_start|>assistant\n{received_text}"
                          if received_text else "")
```

`received` frame(`:400-404`)改成:

```python
        yield {
            "type": "received",
            "turn": turn,
            "received_chunk": received_chunk,
        }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest agent/tests -q`
Expected: PASS,`135 passed`(沒新增測試函式,只改斷言)

- [ ] **Step 5: Commit**

```bash
git add agent/skill_agent.py agent/tests/test_skill_agent.py
git commit -m "feat(tab5): received frame 改帶 templated received_chunk

skill_agent 生成請求加 logprobs,從 token 流重建 <|im_start|>assistant\\n…
(照 tab④ server.py:305,含空回應護欄),received frame 改帶字串、丟掉
{message, usage}(usage 多餘 —— chip 走 turn frame)。三端 received 視圖一致的
第一步。"
```

---

### Task 2: 後端 tab⑥ —— received_chunk 改 templated + enable_thinking Critical

**Files:**
- Modify: `agent/mcp_agent.py`(body、msg 之後重建、received_chunk、檔頭註解)
- Modify: `agent/tests/test_mcp_agent.py`（`_llama_resp` mock、received_chunk 斷言)

**Interfaces:**
- Produces:`turn_complete` frame 的 `received_chunk` 改成 `<|im_start|>assistant\n…` 字串(原為 `json.dumps(msg)`)。

- [ ] **Step 1: 改測試斷言(先失敗)**

`agent/tests/test_mcp_agent.py` 的 `_llama_resp` helper(`:5-14`),`choices[0]` 加 logprobs:

```python
def _llama_resp(content=None, tool_calls=None):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    class R:
        def json(self):
            return {"choices": [{"message": msg,
                                 "logprobs": {"content": [{"token": content}] if content else []}}],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 10}}
    return R()
```

`test_turn_complete_carries_templated_sent_prompt`(`:113-131`)——
它的 `route` 目前只擷取 apply-template 的 body(`captured["json"]`)。**generation POST
的 body 也要擷取**,才能真正守 enable_thinking Critical:

```python
    def route(url, **kw):
        if "apply-template" in str(url):
            captured["json"] = kw["json"]
            return _template_resp("TPL-6")
        captured["gen"] = kw["json"]        # generation POST 的 body
        return _llama_resp(content="answer")
```

received 斷言(原本 `json.loads(received_chunk)`)改成:

```python
    rc = turns[0]["received_chunk"]
    assert rc.startswith("<|im_start|>assistant")
    assert "answer" in rc            # 驗 token 內容
    assert captured["json"]["add_generation_prompt"] is True
    # ⚠️ enable_thinking Critical 的「真」守衛:直接斷言 generation body 有設 kwarg。
    # 不能靠 "<think>" not in rc —— mock 的 logprobs 是從 content 衍生的、根本不吐
    # <think> token,那條不管 kwarg 在不在都會過(空洞)。真正的行為只有瀏覽器
    # 驗收(對真實 llama)看得到,unit 層就用 body 斷言守住 code 有設 kwarg。
    assert captured["gen"]["chat_template_kwargs"] == {"enable_thinking": False}
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `python3 -m pytest agent/tests/test_mcp_agent.py -q`
Expected: FAIL — `json.loads` 已移除但 `received_chunk` 還是 `json.dumps(msg)`,
`rc.startswith("<|im_start|>assistant")` red。

- [ ] **Step 3: 改 `agent/mcp_agent.py`**

body(`:143`)加 logprobs **與 enable_thinking**(⚠️ Critical):

```python
            body = {"model": "any", "messages": messages, "temperature": 0.3,
                    "tools": openai_tools, "tool_choice": "auto",
                    "chat_template_kwargs": {"enable_thinking": False},
                    "logprobs": True, "top_logprobs": 1}
```

> `body` 目前是多行 dict(`mcp_agent.py:143` 起),照它現有的鍵順序併進去即可;
> `tools`/`tool_choice` 本來就在。

`msg = resp_llm["choices"][0]["message"]`(`:151`)之後,加重建;
`received_chunk`(`:185`)從 `json.dumps(msg, …)` 改成:

```python
                # 模型吐的原始訊息 —— 從 logprobs token 流重建(同 tab④/⑤,三端一致)
                "received_chunk": _received_chunk(resp_llm),
```

並在檔案裡加一個小 helper(放在模組層,靠近其他 helper):

```python
def _received_chunk(resp):
    lp = resp["choices"][0].get("logprobs", {}) or {}
    text = "".join(t.get("token", "") for t in lp.get("content", []))
    return f"<|im_start|>assistant\n{text}" if text else ""
```

> 用 helper 是因為 `received_chunk` 在 dict literal 裡,inline 重建不好塞;
> skill_agent 那邊在 yield 前有獨立語句空間所以 inline 即可,這裡包成函式較乾淨。

檔頭是**模組 docstring**(`:1-9` 的 `"""…"""`),不是 `#` 註解 —— 替換文字**不要帶 `#`**。
只改「the loop requests no logprobs」半句(「no message_tokens」保留),`:8-9` 那兩行
docstring 內文改成:

```text
teaching artifact. Turn frames are Tab ④-shaped (no message_tokens; received
is reconstructed from logprobs into a <|im_start|> view like tab④/⑤).
```

- [ ] **Step 4: 跑測試確認通過**

Run: `python3 -m pytest agent/tests -q`
Expected: PASS,`135 passed`

- [ ] **Step 5: Commit**

```bash
git add agent/mcp_agent.py agent/tests/test_mcp_agent.py
git commit -m "feat(tab6): received_chunk 改 templated <|im_start|> + enable_thinking

mcp_agent 生成 body 加 logprobs,received_chunk 從 json.dumps(msg) 改成
從 token 流重建 <|im_start|>assistant\\n…(_received_chunk helper)。

⚠️ 同時加 chat_template_kwargs enable_thinking:False —— tab⑥ 原本只靠
/no_think 軟開關,token 流仍含 <think></think>;tab④/⑤ 用硬 kwarg 才乾淨。
少了它 tab⑥ 的 received 會比 ④⑤ 多一行 <think>,違反三端一致。unit 測試擷取
generation body 斷言 chat_template_kwargs（'<think>' not in rc 是空洞的——mock
不吐 think token；真行為靠瀏覽器驗收）。"
```

---

### Task 3: 前端 tab⑤ —— onReceived 改吃 received_chunk + cache-bust

**Files:**
- Modify: `frontend/app.js`（`onReceived`、2 個 render site）
- Modify: `frontend/index.html`、`frontend/index.zh-TW.html`（`app.js?v=95`)

**Interfaces:**
- Consumes:Task 1 的 `received.received_chunk`(str)

- [ ] **Step 1: 改 onReceived + 2 個 render site**

`frontend/app.js` 的 `onReceived`(`:975`):

```js
  function onReceived(f) { pendingReceived = f.received_chunk; }
```

第一個 render site(`:993-996` 附近,`onTurn` 裡):

```js
    if (pendingReceived) {
      row.appendChild(BUBBLE.details(t('model_raw_summary'),
        BUBBLE.wire(pendingReceived)));
      pendingReceived = null;
    }
```

第二個 render site(`:1053-1056` 附近,`onFinal` 裡):

```js
      if (pendingReceived) {
        fb.appendChild(BUBBLE.details(t('to_user_raw_summary'),
          BUBBLE.wire(pendingReceived)));
        pendingReceived = null;
      }
```

(兩處都是把 `BUBBLE.wire(JSON.stringify(pendingReceived, null, 2))` 換成
`BUBBLE.wire(pendingReceived)` —— `pendingReceived` 現在已經是字串。)

- [ ] **Step 2: cache-bust**

兩個 HTML(`index.html` + `index.zh-TW.html`):`app.js?v=94 → app.js?v=95`。
`wire.js?v=2`、`styles.css?v=66` 不動。

```bash
python3 - <<'EOF'
import re, pathlib
for f in ["frontend/index.html", "frontend/index.zh-TW.html"]:
    p = pathlib.Path(f); s = p.read_text().replace("app.js?v=94", "app.js?v=95")
    p.write_text(s)
    print(f, re.findall(r'(?:wire\.js|app\.js|styles\.css)\?v=\d+', s))
EOF
```
Expected 兩檔皆 `['styles.css?v=66', 'wire.js?v=2', 'app.js?v=95']`

- [ ] **Step 3: 靜態關卡 + 教材確認**

```bash
node --check frontend/app.js && echo "SYNTAX OK"
node --test frontend/wire.test.js 2>&1 | grep -E "^. (pass|fail)"   # 沒動 wire.js,防呆
git diff --stat frontend/styles.css frontend/wire.js; echo "(空=未動)"
python3 -m pytest agent/tests -q | tail -1
# 教材:確認沒有別處把 tab⑤/⑥ 的 received 描述成 JSON
grep -rn 'JSON.*模型吐\|模型吐.*JSON\|messages\[\].*received\|received.*JSON' teaching/ || echo "  ✓ 教材無 JSON-received 描述,不用改"
```
Expected:`SYNTAX OK`;`pass 19`;styles.css/wire.js diff 空;`135 passed`;教材 grep 無命中。

- [ ] **Step 4: 起 server,驅動三個 tab(controller 之後做瀏覽器驗收)**

```bash
pkill -f "agent.server"; sleep 1
nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
sleep 3 && curl -s localhost:9000/health
for p in '{"tab":"4","user":"現在幾點?"}' '{"tab":"5","user":"台北今天天氣怎樣?"}' '{"tab":"6","user":"現在幾點?"}'; do
  curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' -d "$p" --max-time 300 \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('tab', d['tab'], 'ok')"
done
```
Expected:`status: ok`;三個 tab 都 `ok`。瀏覽器 DOM 驗收由 controller 跑(見整體驗收),此步不做瀏覽器自動化。

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js frontend/index.html frontend/index.zh-TW.html
git commit -m "feat(tab5): 前端 received 改吃 received_chunk 字串

onReceived 從 f.response 改吃 f.received_chunk;兩個 render site 去掉
JSON.stringify —— pendingReceived 現在已是 <|im_start|> 字串,wire.js 自動
偵測成 chat 視圖。tab⑥ 前端零改動(本來就 BUBBLE.wire(f.received_chunk))。
app.js?v=95。"
```

---

## 完成後的整體驗收(controller 跑,對照 spec 驗收)

- [ ] `pytest agent/tests -q` → `135 passed`(skill/mcp received 斷言已改;mock 加 logprobs)
- [ ] `node --test frontend/wire.test.js` → `pass 19`(wire.js 沒動)
- [ ] 瀏覽器(切分頁後量,隱藏 panel rect 全 0 會假陰性),三端各驅動一次,展開藍泡「模型吐的原始訊息」:
  - **④⑤⑥ 都是 `<|im_start|>assistant` 視圖**,沒有任何一個是 JSON 樹
  - tab⑤/⑥ 的 tool-calling turn:展開看得到 `<tool_call>\n{"name":…}` 上色
  - **tab⑥ 的 received 開頭直接是 `<tool_call>`/內容,不含 `<think></think>`**(Critical 守住)
  - tab⑤/⑥ 的 content-only final turn:`<|im_start|>assistant\n{最終答案}`
  - **迴歸**:tab⑤/⑥ 的 context chip(context: N tokens)仍正常(走 turn frame usage);每泡 ≤1 直接子 `<details>`;console 0 errors
- [ ] 兩個 HTML:`app.js?v=95` + `wire.js?v=2` + `styles.css?v=66`;`git diff --stat frontend/styles.css frontend/wire.js` 空
