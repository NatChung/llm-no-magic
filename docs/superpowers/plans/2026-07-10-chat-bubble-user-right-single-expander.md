# Chat bubble:user 泡靠右 + 每泡最多一個收合按鈕 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 tabs ④⑤⑥ 的對話流以「靠右的 user 泡」起頭,並把每個泡泡的收合按鈕收斂成最多一個。

**Architecture:** 後端把 `turn_complete` 的 `next_prompt`(下一發)換成 `sent_prompt`(這一發,呼叫 model 前算 template),並刪掉沒人再用的 `received_chunk` / `received` frame;前端新增 `BUBBLE.user()` builder,由既有的 `drive_start.user` 欄位渲染,並刪除多餘的 `<details>` 展開器、補上 ④⑥ 藍/綠泡的 `sent_prompt` 展開器。

**Tech Stack:** Python 3.10+ stdlib `http.server`(`agent/server.py`)、`requests` 打 llama-server(`/v1/chat/completions` 與 `/apply-template`)、zero-build 前端(`frontend/app.js` + Tailwind Play CDN)、pytest。

Spec: `docs/superpowers/specs/2026-07-10-chat-bubble-user-right-single-expander-design.md`

## Global Constraints

- **雙語**:任何 user-facing 的改動必須同時落在 EN 與 zh-TW 兩個檔(`frontend/index.html` / `frontend/index.zh-TW.html`,`teaching/lesson-N-*.md` / `.zh-TW.md`)。`frontend/app.js` 的 `I18N` dict 每個 key 都要有 `'en'` 與 `'zh-TW'` 兩個值。
- **Cache-bust**:`frontend/app.js` 一改,兩個 HTML 檔的 `app.js?v=NN` 都要 +1 且同號。目前 `?v=86` →本次改為 `?v=87`。`styles.css?v=66` **本次不動**。
- **`frontend/styles.css` 本次完全不修改。** `.tok.tok-static`(`styles.css:79-80`)是 tab③ 的活依賴(`app.js:566`),刪掉會讓推理分頁 token 看起來可點卻沒有 handler。
- **測試風格**:`agent/tests/` 一律 plain pytest function + `monkeypatch` mock,不引入 class / fixture 新花樣。
- **前端無 build step、無 JS 測試框架。** 前端驗證靠實跑 server + `POST /drive` + Playwright 讀 console/DOM。
- **不得改動 tabs ①–③ 的行為。** 它們的迴歸驗證在 Task 5。
- 伺服器啟動指令:`nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`

## File Structure

| 檔案 | 本次責任 |
|---|---|
| `agent/server.py` | `agent_loop`:改發 `sent_prompt`,刪 `received_chunk` / `next_prompt` |
| `agent/mcp_agent.py` | 新增 `LLAMA_TEMPLATE_URL`;`mcp_agent_loop` 改發 `sent_prompt`,刪 `received_chunk` / `next_prompt` |
| `agent/skill_agent.py` | 刪 `received` frame 的 yield |
| `agent/tests/test_server.py` | `agent_loop` 新 frame shape;`drive()` 的假 frame |
| `agent/tests/test_mcp_agent.py` | 新增 `/apply-template` routing mock;`turn_complete` 新 shape |
| `agent/tests/test_skill_agent.py` | 移除 `received` frame 的斷言 |
| `frontend/app.js` | `BUBBLE.user()` builder、三個 panel 的 user 泡渲染、單一展開器規則、i18n 增刪、修掉 `refreshPreview()` 壞呼叫 |
| `frontend/index.html`, `frontend/index.zh-TW.html` | `app.js?v=87` |
| `teaching/lesson-{4,5,6}-*.md`(6 檔) | 教材同步 user 泡與新展開器 |

---

### Task 1: `agent_loop` 改發 `sent_prompt`(tab ④)

把 `/apply-template` 呼叫從迴圈尾搬到 model 呼叫之前,欄位從 `next_prompt`(下一發)變成 `sent_prompt`(這一發)。順帶刪掉沒人再用的 `received_chunk`。

**Files:**
- Modify: `agent/server.py:251-316`
- Test: `agent/tests/test_server.py`

**Interfaces:**
- Consumes: 既有的 `LLAMA_TEMPLATE_URL`(`agent/server.py:216`)、`TAB4_TOOL_SCHEMAS`
- Produces: `turn_complete` frame 的新 shape:
  `{"type": "turn_complete", "turn": int, "message_tokens": list, "tool_calls": list, "tool_results": list, "sent_prompt": str}`
  —— 不再有 `received_chunk`、`next_prompt`。每個 turn(含 final 的 content-only turn)都帶非空 `sent_prompt`。

- [ ] **Step 1: 寫失敗的測試**

加到 `agent/tests/test_server.py` 檔尾:

```python
def test_agent_loop_every_turn_carries_sent_prompt(monkeypatch):
    """每個 turn_complete(含 final content-only turn)都帶 sent_prompt;
    不再有 received_chunk / next_prompt。"""
    import agent.server as server

    tool_call = [{"id": "c1", "type": "function",
                  "function": {"name": "get_time", "arguments": "{}"}}]
    responses = iter([
        _mock_llama_resp(content=None, tool_calls=tool_call),
        _mock_llama_resp(content="現在是 09:00。"),
    ])
    prompts = iter(["TPL-turn1", "TPL-turn2"])

    def route(url, **kw):
        if "apply-template" in str(url):
            return _mock_template_resp(prompt=next(prompts))
        return next(responses)

    monkeypatch.setattr(server.requests, "post", route)
    monkeypatch.setattr(server, "dispatch_tool_call", lambda *a, **kw: "09:00")

    events = list(server.agent_loop("sys", "現在幾點?"))
    turns = [e for e in events if e["type"] == "turn_complete"]

    assert len(turns) == 2
    assert turns[0]["sent_prompt"] == "TPL-turn1"
    assert turns[1]["sent_prompt"] == "TPL-turn2"
    for tn in turns:
        assert "received_chunk" not in tn
        assert "next_prompt" not in tn


def test_agent_loop_sent_prompt_templates_pre_call_messages(monkeypatch):
    """turn 1 的 sent_prompt 是「還沒 append assistant/tool」的 messages 算出來的。"""
    import agent.server as server

    captured = []
    tool_call = [{"id": "c1", "type": "function",
                  "function": {"name": "get_time", "arguments": "{}"}}]
    responses = iter([
        _mock_llama_resp(content=None, tool_calls=tool_call),
        _mock_llama_resp(content="done"),
    ])

    def route(url, **kw):
        if "apply-template" in str(url):
            captured.append(kw["json"])
            return _mock_template_resp(prompt="TPL")
        return next(responses)

    monkeypatch.setattr(server.requests, "post", route)
    monkeypatch.setattr(server, "dispatch_tool_call", lambda *a, **kw: "09:00")

    list(server.agent_loop("sys", "現在幾點?"))

    # turn 1:只有 system + user
    assert [m["role"] for m in captured[0]["messages"]] == ["system", "user"]
    # turn 2:accumulated — assistant(tool_call) + tool result 都進來了
    assert [m["role"] for m in captured[1]["messages"]] == [
        "system", "user", "assistant", "tool"]
    # add_generation_prompt 必須帶,否則算出來的不是「要送出的」prompt
    assert captured[0]["add_generation_prompt"] is True
    assert [t["function"]["name"] for t in captured[0]["tools"]] == ["get_time"]


def test_agent_loop_sent_prompt_degrades_on_template_error(monkeypatch):
    """/apply-template 掛掉時 sent_prompt 降級為 [template error] …,不中斷 loop。"""
    import agent.server as server

    def route(url, **kw):
        if "apply-template" in str(url):
            raise RuntimeError("boom")
        return _mock_llama_resp(content="hi")

    monkeypatch.setattr(server.requests, "post", route)

    events = list(server.agent_loop("sys", "hi"))
    turns = [e for e in events if e["type"] == "turn_complete"]
    assert len(turns) == 1
    assert turns[0]["sent_prompt"].startswith("[template error] RuntimeError")
    assert events[-1] == {"type": "final", "content": "hi"}
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `pytest agent/tests/test_server.py -k sent_prompt -q`
Expected: FAIL — `KeyError: 'sent_prompt'`(前兩個測試),第三個測試會因為 `next_prompt` 的 except 吞掉例外而以不同方式失敗。

- [ ] **Step 3: 改 `agent/server.py`**

把 `agent/server.py:251-316` 的迴圈本體改成下面這樣。三個變動:(a) 迴圈一開頭、`requests.post(LLAMA_URL, …)` 之前插入 template 呼叫;(b) 刪掉 `received_text` / `received_chunk`(原 `:287-290`)與 `next_prompt` 區塊(原 `:292-306`);(c) `yield` 的欄位換掉。

```python
    for turn in range(1, MAX_TURNS + 1):
        # "sent" — the exact prompt going into THIS turn's model call (chat
        # template applied). Computed BEFORE the call so every turn — including
        # the final, content-only one — carries its own. (turn N's sent_prompt
        # is what the old next_prompt of turn N-1 used to show.)
        try:
            tpl_resp = requests.post(LLAMA_TEMPLATE_URL, json={
                "messages": messages,
                "tools":    TAB4_TOOL_SCHEMAS,
                "add_generation_prompt": True,
            }, timeout=5)
            tpl_resp.raise_for_status()
            sent_prompt = tpl_resp.json().get("prompt", "")
        except Exception as exc:
            sent_prompt = f"[template error] {type(exc).__name__}: {exc}"

        resp = requests.post(LLAMA_URL, json={
            "model":       MODEL_NAME,
            "messages":    messages,
            "tools":       TAB4_TOOL_SCHEMAS,
            "stream":      False,
            "logprobs":    True,
            "top_logprobs": 10,
            "chat_template_kwargs": {"enable_thinking": False},
            "temperature": 0.3,
        }, timeout=60)
        resp.raise_for_status()
        d = resp.json()
        msg = d["choices"][0]["message"]
        lp  = d["choices"][0].get("logprobs", {}).get("content", [])
        messages.append(msg)

        tool_calls = msg.get("tool_calls") or []
        tool_calls_pub  = []
        tool_results_pub = []
        for tc in tool_calls:
            name = tc["function"]["name"]
            args_str = tc["function"]["arguments"] or "{}"
            tool_calls_pub.append({"name": name, "args": args_str})
            try:
                args = json.loads(args_str)
            except json.JSONDecodeError:
                args = {}
            result = dispatch_tool_call(name, args, TOOLS)
            tool_results_pub.append({"name": name, "result_text": result})
            messages.append({
                "role":          "tool",
                "tool_call_id":  tc.get("id", ""),  # guard: model may omit id (avoid KeyError)
                "content":       result,
            })

        yield {
            "type":           "turn_complete",
            "turn":           turn,
            "message_tokens": lp,
            "tool_calls":     tool_calls_pub,
            "tool_results":   tool_results_pub,
            "sent_prompt":    sent_prompt,
        }

        if not tool_calls:
            yield {"type": "final", "content": msg.get("content") or ""}
            return

    yield {"type": "error", "message": f"max_turns ({MAX_TURNS}) reached"}
```

- [ ] **Step 4: 修既有測試裡的假 frame**

`agent/tests/test_server.py:95` 的 docstring 提到舊欄位,改成:

```python
def _route_iter(responses):
    """Build a mock requests.post that returns next iter response for chat
    completions, but returns a stub template response for /apply-template
    (so iter isn't consumed by the per-turn template call added in sent_prompt)."""
```

`agent/tests/test_server.py:991-993` 的假 frame,把 `received_chunk` / `next_prompt` 換成 `sent_prompt`:

```python
        yield {"type": "turn_complete", "turn": 1, "message_tokens": [],
               "tool_calls": [], "tool_results": [], "sent_prompt": ""}
```

`agent/tests/test_server.py:1172` 的假 frame(這是 tab⑥ 的,Task 2 才會真的改 mcp_agent,但假 frame 現在就要跟新 shape 一致):

```python
        {"type": "turn_complete", "turn": 1, "content": "ans", "tool_calls": [],
         "tool_results": [], "sent_prompt": "",
         "usage": {"prompt_tokens": 9, "completion_tokens": 2}},
```

`agent/tests/test_server.py:247` 的假 frame 本來就沒帶這些欄位,**不用改**。

- [ ] **Step 5: 跑全部測試確認通過**

Run: `pytest agent/tests -q`
Expected: PASS,0 failed。

- [ ] **Step 6: Commit**

```bash
git add agent/server.py agent/tests/test_server.py
git commit -m "feat(tab4): turn_complete 改發 sent_prompt,刪 received_chunk/next_prompt

next_prompt(turn N) ≡ sent_prompt(turn N+1),視角錯一格。改成呼叫 model
前算 template,每個 turn(含 final)都有自己的 sent_prompt,turn 1 的
system prompt + <tools> 也第一次看得到。received_chunk 前端不再使用。"
```

---

### Task 2: `mcp_agent_loop` 改發 `sent_prompt`(tab ⑥)

`mcp_agent.py` 目前沒有 template 基礎設施(`next_prompt` 只是 `json.dumps(messages)`)。補上 `LLAMA_TEMPLATE_URL` 與每 turn 一次的 `/apply-template` 呼叫,`tools` 帶握手拿到的 `openai_tools` —— 這樣 lesson-6 的「`<tools>` 是問來的」在藍泡展開後看得到物證。

**Files:**
- Modify: `agent/mcp_agent.py:19`(常數)、`agent/mcp_agent.py:129-176`(迴圈)
- Test: `agent/tests/test_mcp_agent.py`

**Interfaces:**
- Consumes: `openai_tools`(`mcp_agent.py:131` 已在用的變數,握手後的 OpenAI-format tools)
- Produces: `turn_complete` frame 的新 shape:
  `{"type": "turn_complete", "turn": int, "content": str, "tool_calls": list, "tool_results": list, "sent_prompt": str, "usage": dict}`
  —— 不再有 `received_chunk`、`next_prompt`。`sent_prompt` 是 templated 字串(跟 tab④ 同型)。

- [ ] **Step 1: 寫失敗的測試**

先在 `agent/tests/test_mcp_agent.py` 的 `_llama_resp` 底下加兩個 helper(既有的 mock 是「所有 `requests.post` 回同一個東西」,加了 template 呼叫就必須分流):

```python
def _template_resp(prompt="TPL"):
    class R:
        def json(self):
            return {"prompt": prompt}
    return R()


def _route(llama_resp, prompt="TPL"):
    """分流:/apply-template → template shape;其餘 → chat-completions shape。"""
    def route(url, **kw):
        if "apply-template" in str(url):
            return _template_resp(prompt)
        return llama_resp
    return route
```

既有的 `monkeypatch.setattr(m.requests, "post", …)` 共 **4 處**(`test_mcp_agent.py:18`
`test_handshake_frames_come_first`、`:32` `test_no_toolcall_yields_turn_then_final`、
`:52` `test_toolcall_round_trip`、`:76` `test_child_killed_on_generator_close`),
全部要換成 routing 版本 —— 不然新加的 template 呼叫會被餵到 chat-completions 的 mock,
`test_toolcall_round_trip` 的 iterator 更會被多消耗一顆。

三處用固定回應的(`:18`、`:32`、`:76`)改成:

```python
    monkeypatch.setattr(m.requests, "post", _route(_llama_resp(content="hi")))
```

`test_toolcall_round_trip`(`:52`)用的是逐次不同的回應,需要 iterator 版本的 helper:

```python
def _route_iter(responses, prompt="TPL"):
    def route(url, **kw):
        if "apply-template" in str(url):
            return _template_resp(prompt)
        return next(responses)
    return route
```

`:52` 改成:

```python
    monkeypatch.setattr(m.requests, "post", _route_iter(calls))
```

然後新增兩個測試:

```python
def test_turn_complete_carries_templated_sent_prompt(monkeypatch):
    """turn_complete 帶 templated sent_prompt;不再有 received_chunk / next_prompt。
    template 呼叫要帶握手問來的 tools 與 add_generation_prompt。"""
    import agent.mcp_agent as m

    captured = {}
    def route(url, **kw):
        if "apply-template" in str(url):
            captured["json"] = kw["json"]
            return _template_resp("TPL-6")
        return _llama_resp(content="answer")

    monkeypatch.setattr(m.requests, "post", route)
    events = list(m.mcp_agent_loop("hello"))
    turns = [e for e in events if e["type"] == "turn_complete"]

    assert turns[0]["sent_prompt"] == "TPL-6"
    assert "received_chunk" not in turns[0]
    assert "next_prompt" not in turns[0]
    assert captured["json"]["add_generation_prompt"] is True
    assert [t["function"]["name"] for t in captured["json"]["tools"]] == [
        "get_time", "get_weather"]


def test_mcp_sent_prompt_degrades_on_template_error(monkeypatch):
    """/apply-template 掛掉 → sent_prompt 降級,loop 照常跑完。"""
    import agent.mcp_agent as m

    def route(url, **kw):
        if "apply-template" in str(url):
            raise RuntimeError("boom")
        return _llama_resp(content="answer")

    monkeypatch.setattr(m.requests, "post", route)
    events = list(m.mcp_agent_loop("hello"))
    turns = [e for e in events if e["type"] == "turn_complete"]
    assert turns[0]["sent_prompt"].startswith("[template error] RuntimeError")
    assert events[-1] == {"type": "final", "content": "answer"}
```

- [ ] **Step 2: 跑測試確認它失敗**

Run: `pytest agent/tests/test_mcp_agent.py -q`
Expected: FAIL — `KeyError: 'sent_prompt'` / `AttributeError` on `captured["json"]`(template 呼叫還不存在)。

- [ ] **Step 3: 改 `agent/mcp_agent.py`**

在 `agent/mcp_agent.py:19` 的 `LLAMA_URL` 下面加一行(照 `agent/server.py:216` 的寫法):

```python
LLAMA_URL = "http://localhost:8080/v1/chat/completions"
LLAMA_TEMPLATE_URL = LLAMA_URL.replace("/v1/chat/completions", "/apply-template")
```

把 `agent/mcp_agent.py:129-133` 的迴圈開頭改成:

```python
        for turn in range(1, MAX_TURNS + 1):
            # "sent" — this turn's actual prompt, chat template applied.
            # tools 是握手問來的 openai_tools:展開藍泡就看得到 <tools> 區塊,
            # 那正是 lesson-6「工具清單是問來的」的物證。
            try:
                sent_prompt = requests.post(LLAMA_TEMPLATE_URL, json={
                    "messages": messages,
                    "tools":    openai_tools,
                    "add_generation_prompt": True,
                }, timeout=5).json().get("prompt", "")
            except Exception as exc:
                sent_prompt = f"[template error] {type(exc).__name__}: {exc}"

            body = {"model": "any", "messages": messages, "temperature": 0.3,
                    "tools": openai_tools, "tool_choice": "auto"}
            try:
                resp_llm = requests.post(LLAMA_URL, json=body, timeout=120).json()
            except Exception as exc:
                yield {"type": "error", "message": f"{type(exc).__name__}: {exc}"}
                return
```

把 `agent/mcp_agent.py:168-176` 的 yield 改成:

```python
            yield {
                "type": "turn_complete", "turn": turn, "content": content,
                "tool_calls": tcs, "tool_results": tool_results,
                "sent_prompt": sent_prompt,
                "usage": {"prompt_tokens": usage.get("prompt_tokens"),
                          "completion_tokens": usage.get("completion_tokens")},
            }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pytest agent/tests/test_mcp_agent.py agent/tests/test_server.py -q`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add agent/mcp_agent.py agent/tests/test_mcp_agent.py
git commit -m "feat(tab6): mcp_agent 每 turn 算 templated sent_prompt

新增 LLAMA_TEMPLATE_URL,呼叫 model 前對 messages + 握手問來的
openai_tools 算一次 /apply-template。取代原本的 json.dumps(messages)
next_prompt,並刪掉 received_chunk。藍泡展開後看得到 <tools> 區塊。"
```

---

### Task 3: `skill_agent` 刪掉 `received` frame(tab ⑤)

前端不再顯示「收到的 response」展開器,這個 frame 沒有任何消費者(`/drive` 的 aggregate 只收 `turn` / `index` / `final` / `error`,見 `agent/server.py:477-492`)。

**Files:**
- Modify: `agent/skill_agent.py:381-388`
- Test: `agent/tests/test_skill_agent.py:1,16-24`

**Interfaces:**
- Produces: `skill_agent_loop` 不再 yield `{"type": "received", …}`。`sent` frame(`skill_agent.py:363-368`)**保持不變**。

- [ ] **Step 1: 改測試(先讓它反映新行為 → 會失敗)**

`agent/tests/test_skill_agent.py:1` 的 module docstring:

```python
"""skill_agent_loop — mocked llama; usage propagation + sent frame."""
```

把 `test_turn_carries_usage_and_received_is_trimmed`(`:16-24`)整個換成下面兩個測試。
`usage` 的斷言本來就是從 `turn` frame 讀的,原封保留;`received` 的三行斷言換成
「不存在」+「`sent` frame 仍在」:

```python
def test_turn_carries_usage(monkeypatch):
    import agent.skill_agent as sa
    monkeypatch.setattr(sa.requests, "post", lambda *a, **kw: _resp(content="hi"))
    events = list(sa.skill_agent_loop("hello", "proper"))
    turn = next(e for e in events if e["type"] == "turn")
    assert turn["usage"] == {"prompt_tokens": 500, "completion_tokens": 7}


def test_no_received_frame_is_emitted(monkeypatch):
    """received frame 已移除 —— 前端不再顯示「收到的 response」展開器。
    sent frame 仍在:lesson-5 的「注入現場」證物靠它。"""
    import agent.skill_agent as sa
    monkeypatch.setattr(sa.requests, "post", lambda *a, **kw: _resp(content="hi"))
    events = list(sa.skill_agent_loop("hello", "proper"))

    assert not [e for e in events if e["type"] == "received"]
    sent = next(e for e in events if e["type"] == "sent")
    assert sent["turn"] == 1
    assert isinstance(sent["messages"], list)
```

跑 `grep -n received agent/tests/test_skill_agent.py` 確認整個檔案清乾淨(應無輸出)。

- [ ] **Step 2: 跑測試確認它失敗**

Run: `pytest agent/tests/test_skill_agent.py -q`
Expected: FAIL — 仍然找得到 `received` frame。

- [ ] **Step 3: 刪掉 `agent/skill_agent.py:381-388`**

刪除整段(含註解):

```python
        # surface the model response — trimmed to the assistant message +
        # usage (the full llama json bloats every relay frame; the UI's
        # ▸ expander only needs these two)
        yield {
            "type": "received",
            "turn": turn,
            "response": {"message": msg, "usage": usage},
        }
```

`usage` 變數在下方的 `turn` frame 仍會用到,**不要一起刪**。

- [ ] **Step 4: 跑測試確認通過**

Run: `pytest agent/tests -q`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add agent/skill_agent.py agent/tests/test_skill_agent.py
git commit -m "refactor(tab5): 刪掉 received frame

前端改成每泡最多一個展開器後沒有消費者;/drive aggregate 也不收它。
sent frame 保留 — lesson-5 的「注入現場」證物靠它。"
```

---

### Task 4: `BUBBLE.user()` builder + 三個 tab 渲染 user 泡

**Files:**
- Modify: `frontend/app.js`(I18N、`BUBBLE`、`setupAgent.beginRun`、`PANELS["5"].onDriveStart`、`PANELS["6"].onDriveStart`)
- Modify: `frontend/index.html:334`、`frontend/index.zh-TW.html:334`

**Interfaces:**
- Consumes: `drive_start` frame 的 `f.user`(`agent/server.py:435-436`,已存在)
- Produces: `BUBBLE.user({ text })` → `{ row, bubble }`,`row` 是可直接 `appendChild` 的 `<div>`。i18n key `user_bubble_label`。

- [ ] **Step 1: 加 i18n key**

在 `frontend/app.js` 的 `tool_bubble_label` 區塊(`app.js:97` 附近)後面插入:

```js
  user_bubble_label: {
    'en':    'You',
    'zh-TW': '你',
  },
```

- [ ] **Step 2: 加 `tw` class 與 `BUBBLE.user()` builder**

在 `frontend/app.js` 的 `BUBBLE.tw` 裡,`tCaption`(`app.js:306`)後面加兩行:

```js
    // user 泡:靠右(右側 = 東西進來),中性色 — 跟工具紫、注入琥珀區隔
    uLabel:     "text-xs font-semibold text-ink-soft mb-1",
    uBubble:    "rounded-2xl rounded-tr-sm bg-surface-2 border border-edge px-4 py-3 font-mono text-sm break-all leading-relaxed text-ink text-left",
```

在 `BUBBLE.model(...)`(`app.js:336`)之前插入 builder:

```js
  user({ text }) {
    const row = document.createElement("div");
    row.className = BUBBLE.tw.tRow;
    const labelEl = document.createElement("div");
    labelEl.className = BUBBLE.tw.uLabel;
    labelEl.textContent = t('user_bubble_label');
    const bubble = document.createElement("div");
    bubble.className = BUBBLE.tw.uBubble;
    bubble.textContent = text;
    row.append(labelEl, bubble);
    return { row, bubble };
  },
```

- [ ] **Step 3: Tab ④ — 渲染 user 泡並刪掉壞掉的 `refreshPreview()`**

`frontend/app.js:807-814` 的 `beginRun` 整段換成:

```js
  function beginRun(frame) {
    clearAll();
    setRunning(true);
    // §3.6 顯示輸入 — reflect the driven user into the panel's own
    // input fields so the student sees the question that was actually asked.
    if (frame && frame.user != null) { promptEl.value = frame.user; lastPrompt = frame.user; }
    // user 泡領頭:右側 = 東西進來,你的問題是最先進來的那個
    if (frame && frame.user) turnsEl.appendChild(BUBBLE.user({ text: frame.user }).row);
  }
```

> 被刪掉的 `refreshPreview()` 是壞呼叫:它定義在 `setupPanel` 內(`app.js:536`),
> `setupAgent` 從 `app.js:687` 才開始,scope 不通。tab④ 頁面上也沒有 preview 框
> (`app.js:694` 註解:preview 改由 AI 用 `POST /preview` 演)。

- [ ] **Step 4: Tab ⑤ — 渲染 user 泡**

`frontend/app.js` 的 `PANELS["5"].onDriveStart`(`app.js:1002-1006`)改成:

```js
    onDriveStart: (f) => {
      clearAll(); setRunning(true);
      if (f.user != null) promptEl.value = f.user;
      if (f.user) turnsEl.appendChild(BUBBLE.user({ text: f.user }).row);
      noSkillsToggle.checked = f.mode === "no_skills";
    },
```

- [ ] **Step 5: Tab ⑥ — 渲染 user 泡**

`frontend/app.js` 的 `PANELS["6"].onDriveStart`(`app.js:1165-1174`)改成:

```js
    onDriveStart: (f) => {
      turns = []; finalDone = false; pendingCallCards = [];
      turnsEl.innerHTML = "";
      handshakeEl.innerHTML = "";
      handshakeEl.dataset.filled = "0";
      handshakeEl.textContent = t('handshake_empty');
      setRunning(true);
      if (f.user != null) promptEl.value = f.user;
      if (f.user) turnsEl.appendChild(BUBBLE.user({ text: f.user }).row);
    },
```

- [ ] **Step 6: Cache-bust**

`frontend/index.html:334` 與 `frontend/index.zh-TW.html:334` 兩個檔都改:

```html
  <script src="app.js?v=87"></script>
```

`styles.css?v=66`(兩檔的 `:47`)**不動**。

- [ ] **Step 7: 驗證 — 起 server、驅動 tab④,確認 user 泡出現且 console 乾淨**

```bash
pkill -f "agent.server"; sleep 1
nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
sleep 3 && curl -s localhost:9000/health
```

用瀏覽器(或 Playwright)開 `http://localhost:9000/`,確認 `/health` 的 `subscribers >= 1`,然後:

```bash
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' \
  -d '{"tab":"4","user":"現在幾點?"}' --max-time 300 \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('subs',d['subscribers'],'final',d.get('final'))"
```

Expected:
- 頁面 turns 流最上面出現靠右的灰色泡泡,標籤「你」,內容 `現在幾點?`,底下沒有 `▸`
- Browser console **沒有** `ReferenceError: refreshPreview is not defined`(改動前每次 drive 都會噴)

對 tab⑤ 與 tab⑥ 重複同一驗證:

```bash
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' \
  -d '{"tab":"5","user":"台北今天天氣怎樣?"}' --max-time 300 > /dev/null
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' \
  -d '{"tab":"6","user":"現在幾點?"}' --max-time 300 > /dev/null
```

Expected:兩個 tab 的 turns 流最上面都有靠右灰泡。

- [ ] **Step 8: Commit**

```bash
git add frontend/app.js frontend/index.html frontend/index.zh-TW.html
git commit -m "feat(tabs 4-6): user 泡靠右領頭;修掉 tab4 的 refreshPreview ReferenceError

右側 = 東西進來(user 灰 / 注入琥珀 / 工具紫),左側 = 模型在想。
user 泡無展開器 — 本體就是原文。

順修:setupAgent.beginRun 呼叫的 refreshPreview 定義在 setupPanel 內,
scope 不通,tab④ 每次 drive 都拋 ReferenceError。tab④ 沒有 preview 框,
直接刪掉該行。"
```

---

### Task 5: 單一展開器規則

每個泡泡最多一個 `<details>`。本體已是原文的泡泡(user 泡、④⑥ 工具紫泡)不給按鈕。

**Files:**
- Modify: `frontend/app.js`(I18N 刪 3 key、`makeTokensBox` 刪除、`renderTurnBlock`、tab⑤ 的 `onTurn`/`onFinal`/`onReceived`、tab⑥ 的 `onTurnComplete`)

**Interfaces:**
- Consumes: Task 1 的 `turn_complete.sent_prompt`(tab④)、Task 2 的 `turn_complete.sent_prompt`(tab⑥)、既有的 `sent` frame(tab⑤)
- Produces: 無新 export。`renderTurnBlock` 簽名變為
  `renderTurnBlock(turn, message_tokens, tool_calls, tool_results, sent_prompt)`

- [ ] **Step 1: 刪掉三個 i18n key**

從 `frontend/app.js` 的 `I18N` 刪除整塊 `raw_tokens_summary`(`app.js:81`)、
`received_summary`(`:85`)、`next_prompt_summary`(`:89`)。
`sent_prompt_summary`(`:93`)**保留**。

- [ ] **Step 2: 刪掉 `makeTokensBox`**

刪除 `frontend/app.js:708-723` 整個函式。

> ⚠️ **不要碰 `frontend/styles.css`。** `.tok.tok-static` 是 tab③ 的活依賴
> (`app.js:566` 的 else 分支),不是只有 `makeTokensBox` 在用。

- [ ] **Step 3: 改 tab④ 的 `renderTurnBlock`**

`frontend/app.js:725-779` 整段換成:

```js
  function renderTurnBlock(turn, message_tokens, tool_calls, tool_results, sent_prompt) {
    const block = document.createElement("div");
    block.className = BUBBLE.tw.block;
    block.dataset.turn = String(turn);
    const hasToolCalls = (tool_calls || []).length > 0;

    if (hasToolCalls) {
      const lines = tool_calls.map((tc) => {
        const argsStr = (tc.args || "").trim();
        return `⟨tool_call⟩ ${tc.name}(${argsStr === "{}" ? "" : argsStr})`;
      });
      const { row: mRow } = BUBBLE.model({
        label: t('model_round_label', { n: turn }),
        lines,
        caption: t('calls_tool_caption'),
      });
      if (sent_prompt) {
        mRow.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn }),
                                        BUBBLE.pre(sent_prompt)));
      }
      block.appendChild(mRow);

      // 紫泡不給展開器:本體印的就是原始回傳值
      (tool_results || []).forEach((tr) => {
        const raw = (tr.result_text || "").trim();
        const looksJson = raw.startsWith("{") || raw.startsWith("[");
        const { row: tRow } = BUBBLE.tool({
          label: t('tool_bubble_label', { name: tr.name }),
          badge: t('local_exec_badge'),
          body: `${t('tool_returns')} ${looksJson ? raw : JSON.stringify(raw)}`,
          caption: t('feeds_back_caption'),
        });
        block.appendChild(tRow);
      });
    } else {
      // ── final 回合:沒有 tool_call → 綠色全寬「給使用者」 ──
      finalRendered = true;
      const content = (message_tokens || []).map((s) => s.token).join("");
      block.appendChild(BUBBLE.finalBlock({ caption: t('to_user_caption'), content }));
      if (sent_prompt) {
        block.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn }),
                                         BUBBLE.pre(sent_prompt)));
      }
    }

    turnsEl.appendChild(block);
    turns.push({
      tokenSteps: message_tokens || [],
      el:         block,
      hadTool:    hasToolCalls,
    });
  }
```

`frontend/app.js:818-819` 的呼叫點跟著改:

```js
    onTurnComplete: (f) =>
      renderTurnBlock(f.turn, f.message_tokens, f.tool_calls, f.tool_results, f.sent_prompt),
```

> `renderFinal`(`app.js:790`)是 max-turns 截停時的 fallback,拿不到 `sent_prompt`,
> 維持原樣(綠泡無展開器)。

- [ ] **Step 4: 改 tab⑤ — 刪掉 received 展開器**

`pendingReceived` 一共散在 **6 處**,全部要清:

1. `frontend/app.js:869` — 刪掉宣告 `let pendingReceived = null;`
2. `frontend/app.js:873` — `clearAll()` 裡的重置,從
   `pendingSent = null; pendingReceived = null;` 改成 `pendingSent = null;`
3. `frontend/app.js:898` — 刪掉整行 `function onReceived(f) { pendingReceived = f; }`
4. `frontend/app.js:921-925` — `onTurn` 裡的 received 區塊(見下)
5. `frontend/app.js:984-988` — `onFinal` 裡的 received 區塊(見下)
6. `frontend/app.js:1007` — `PANELS["5"]` 註冊清單裡的 `onReceived`,改成:

```js
    onIndex, onSent, onTurn, onSkillLoaded, onL3Loaded, onToolResult,
    onFinal,
```

`onTurn`(`app.js:915-926`)拿掉 received 區塊,只留 sent:

```js
    // attach the buffered wire view for THIS turn (sent preceded us)
    if (pendingSent) {
      row.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn: f.turn }),
        BUBBLE.pre(JSON.stringify(pendingSent.messages, null, 2))));
      pendingSent = null;
    }
    turnsEl.appendChild(row);
```

`onFinal`(`app.js:979-988`)同樣拿掉 received 區塊(保留它外層的
`if (!finalDone && f.content)` 與後面的 trace-summary banner):

```js
      if (pendingSent) {
        fb.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn: pendingSent.turn }),
          BUBBLE.pre(JSON.stringify(pendingSent.messages, null, 2))));
        pendingSent = null;
      }
```

`onSkillLoaded`(琥珀泡)與 `onL3Loaded`(紫泡)**完全不動** —— 它們本來就各只有一個展開器。

- [ ] **Step 5: 改 tab⑥ 的 `onTurnComplete`**

`frontend/app.js:1109-1146` 裡三處改動:

藍泡 —— 把 `received_chunk` 展開器換成 `sent_prompt`:

```js
      if (f.sent_prompt) {
        row.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn: f.turn }),
                                       BUBBLE.pre(f.sent_prompt)));
      }
      turnsEl.appendChild(row);
```

紫泡 —— 刪掉 `next_prompt` 展開器,forEach 不再需要 index:

```js
      (f.tool_results || []).forEach((tr) => {
        const raw = (tr.result_text || "").trim();
        const looksJson = raw.startsWith("{") || raw.startsWith("[");
        const { row: tRow } = BUBBLE.tool({
          label: t('tool_bubble_label', { name: tr.name }),
          badge: t('mcp_exec_badge'),
          body: `${t('tool_returns')} ${looksJson ? raw : JSON.stringify(raw)}`,
          caption: t('feeds_back_caption'),
        });
        turnsEl.appendChild(tRow);
      });
```

綠泡 —— 從「直接 append」改成留住 ref 再掛展開器:

```js
    } else {
      finalDone = true;
      const fb = BUBBLE.finalBlock({ caption: t('to_user_caption'), content: f.content });
      if (f.sent_prompt) {
        fb.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn: f.turn }),
                                      BUBBLE.pre(f.sent_prompt)));
      }
      turnsEl.appendChild(fb);
    }
```

- [ ] **Step 6: 驗證 — 三個 tab 的展開器數量**

重啟 server、開瀏覽器、確認 `subscribers >= 1`,然後三發:

```bash
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' \
  -d '{"tab":"4","user":"現在幾點?"}' --max-time 300 > /dev/null
```

在瀏覽器 console 跑(或用 Playwright `browser_evaluate`):

```js
[...document.querySelectorAll('.tab-panel[data-panel="agent"] .turns > *')]
  .map(el => `${el.className.split(' ')[0]} → ${el.querySelectorAll('details').length} details`)
```

Expected(tab④,一次 tool call):banner、user 泡 `0`、turn-block(藍泡 `1` + 紫泡 `0`)、turn-block(綠泡 `1`)。**沒有任何節點超過 1 個 `details`。**

tab⑤:`{"tab":"5","user":"台北今天天氣怎樣?"}` → user 泡 `0`、藍泡 `1`、琥珀泡 `1`、紫泡 `1`(腳本原始碼)、綠泡 `1`。
tab⑥:`{"tab":"6","user":"現在幾點?台北天氣如何?"}` → user 泡 `0`、藍泡 `1`、紫泡 `0`、綠泡 `1`。

展開 tab④/⑥ 的藍泡,確認內容是 templated 字串(看得到 `<|im_start|>system` 與 `<tools>`);
展開 tab⑤ 的藍泡,確認是 `messages[]` JSON。

頁面全文搜尋,確認找不到「原始 token」/「收到」/「再送出」任何一個展開器標題。

- [ ] **Step 7: 迴歸驗證 — tabs ①③ 沒被弄壞**

```bash
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' \
  -d '{"tab":"1","user":"1+1="}' --max-time 120 > /dev/null
curl -s -X POST localhost:9000/drive -H 'Content-Type: application/json' \
  -d '{"tab":"3","user":"9.11 跟 9.8 哪個大?","mode":"thinking"}' --max-time 300 > /dev/null
```

Expected:
- tab①:token 仍可點,點了機率條會換
- tab③:思考區的 token **不可點**(`cursor: default`、hover 不變色)—— 這條驗證
  `.tok.tok-static` 沒被誤刪
- Browser console 全程沒有 error

- [ ] **Step 8: 跑後端測試**

Run: `pytest agent/tests -q`
Expected: PASS(前端改動不該影響後端,這一步是防呆)。

- [ ] **Step 9: Commit**

```bash
git add frontend/app.js
git commit -m "feat(tabs 4-6): 每個泡泡最多一個收合按鈕

藍泡/綠泡 → 此 turn 送出的 prompt;⑤ 琥珀泡 → SKILL.md 全文;
⑤ 紫泡 → 腳本原始碼。本體已是原文的泡泡(user 泡、④⑥ 工具紫泡)不給按鈕。

刪:makeTokensBox 與 raw_tokens_summary / received_summary /
next_prompt_summary 三個 i18n key、tab⑤ 的 onReceived。
styles.css 的 .tok-static 保留 — tab③ 的 token 靠它(app.js:566)。"
```

---

### Task 6: 教材同步(雙語 6 檔)

**Files:**
- Modify: `teaching/lesson-4-agent.md:31`、`teaching/lesson-4-agent.zh-TW.md:35`
- Modify: `teaching/lesson-5-skill.md`、`teaching/lesson-5-skill.zh-TW.md`
- Modify: `teaching/lesson-6-mcp.md`、`teaching/lesson-6-mcp.zh-TW.md`

**Interfaces:** 無 code interface。內容必須跟 Task 4/5 實際渲染出來的 UI 一致。

- [ ] **Step 1: lesson-4(展開器描述已過時 + 補 user 泡)**

`teaching/lesson-4-agent.md:31` 現在寫的是三個展開器,換成:

```markdown
- The stream starts with your own question — a grey bubble on the right. Right side = things
  coming in; left side = the model thinking.
- For details: each blue and green bubble has one small ▸ expander underneath ("the prompt
  actually sent this turn") — walk the learner through expanding it to see how the conversation
  accumulates into the next input. The purple tool bubbles have none: their body already prints
  the raw return value.
```

`teaching/lesson-4-agent.zh-TW.md:35` 對應改成:

```markdown
- 對話流從你自己的問題開頭 —— 靠右的灰泡。右邊 = 進來的東西,左邊 = 模型在想。
- 想看細節:每個藍泡與綠泡下面有**一個** ▸ 展開(「此 turn 實際送出的 prompt」),
  帶學員展開看對話怎麼累積成下一發輸入。紫色工具泡沒有展開器 —— 它本體印的就是原始回傳值。
```

- [ ] **Step 2: lesson-5(乒乓讀法補 user 泡)**

`teaching/lesson-5-skill.zh-TW.md` 的「4. 講來回軌跡」那一段,把
「(乒乓讀法:左=model 在想、右=東西進來)」擴寫成:

```markdown
- **4. 講來回軌跡**(乒乓讀法:**最上面靠右的灰泡是學生自己送出的問題** —— 右邊
  都是「東西進來」,左邊是 model 在想):
```

`teaching/lesson-5-skill.md` 的對應英文段落同步改成:

```markdown
- **4. Walk the round trips** (ping-pong reading: **the grey bubble at the top right is the
  student's own question** — everything on the right is "things coming in", the left is the
  model thinking):
```

`teaching/lesson-5-skill.zh-TW.md:52` 的「展開紫泡泡下的『腳本原始碼』」與綠泡
sent 展開器**仍然成立,不要動**。

- [ ] **Step 3: lesson-6(補 user 泡 + 藍泡展開器的教學價值)**

`teaching/lesson-6-mcp.zh-TW.md` 的 demo 段落補一句:

```markdown
- 對話流從你的問題開頭(靠右灰泡)。展開藍泡的「此 turn 實際送出的 prompt」,
  `<tools>` 區塊裡的 get_time + get_weather 就躺在裡面 —— 那是剛剛跟 mini MCP
  server 握手問來的,不是寫死的。
```

`teaching/lesson-6-mcp.md` 同步:

```markdown
- The stream starts with your question (grey bubble, right). Expand the blue bubble's "prompt
  actually sent this turn" and you'll find get_time + get_weather sitting inside the `<tools>`
  block — asked for over the handshake, not hardcoded.
```

- [ ] **Step 4: 確認雙語與行為一致**

```bash
grep -n "原始 token\|收到的原文\|再送出\|raw token stream\|Received:\|Sent again" teaching/*.md
```

Expected:無輸出(舊展開器名稱已從教材清乾淨)。

```bash
grep -c "灰泡\|grey bubble" teaching/lesson-4-agent.zh-TW.md teaching/lesson-4-agent.md \
  teaching/lesson-5-skill.zh-TW.md teaching/lesson-5-skill.md \
  teaching/lesson-6-mcp.zh-TW.md teaching/lesson-6-mcp.md
```

Expected:6 個檔案每個都 `>= 1`。

- [ ] **Step 5: Commit**

```bash
git add teaching/
git commit -m "docs(teaching): 教材同步 user 泡與單一展開器

lesson-4 的三個展開器描述已過時;lesson-5 乒乓讀法補 user 泡;
lesson-6 補「<tools> 是握手問來的,展開藍泡看得到」。EN + zh-TW 同步。"
```

---

## 完成後的整體驗收

對照 spec 的「驗收」節逐條走一次:

- [ ] `pytest agent/tests -q` 全綠
- [ ] ④⑤⑥ 各送一句話:最上面是靠右灰色 user 泡,內容 = 送出的原文,底下沒有 `▸`
- [ ] 藍泡底下恰好一個 `▸ 此 turn 送出的 prompt`;④⑥ turn 1 展開看得到 `<|im_start|>system` 與 `<tools>`;⑤ 展開看得到 `messages[]`
- [ ] ④⑥ 紫泡底下沒有 `▸`
- [ ] ⑤ 琥珀泡一個 `▸ SKILL.md 全文` + 一行提示;⑤ 腳本紫泡一個 `▸ 腳本原始碼`
- [ ] 綠泡底下恰好一個 `▸ 此 turn 送出的 prompt`
- [ ] 頁面上找不到「原始 token」/「收到的原文」/「下一發 prompt」任何一個展開器
- [ ] **迴歸**:tab③ 的 token 不可點(`cursor: default`、hover 不變色)
- [ ] **迴歸**:tab④ drive 時 browser console 沒有 `ReferenceError`
- [ ] 兩個 HTML 檔的 `app.js?v=87` 同號,`styles.css?v=66` 未動
