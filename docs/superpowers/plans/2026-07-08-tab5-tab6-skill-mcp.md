# Tab ⑤ Skill + Tab ⑥ MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive Tab ⑤ (Skill, 3-layer progressive disclosure) and Tab ⑥ (real stdio JSON-RPC MCP mini-server) demos, driven through the `/drive` relay with the Tab ④ chat-bubble visual language, plus bilingual lessons 5/6.

**Architecture:** Two new stdlib-only backend modules (`mcp_server.py` child process speaking newline-delimited JSON-RPC 2.0; `mcp_agent.py` loop that spawns it, converts discovered tools to OpenAI format, and yields relay frames). `drive()` in `server.py` gains tab-5/6 branches replicating the tab-4 cancel/terminal-final contract; the legacy `/skill-agent` endpoint is removed. Frontend extracts Tab ④'s bubble builders into module-level helpers reused by `setupSkillTab`/`setupMcpTab`; the `/events` dispatcher learns the new frame types.

**Tech Stack:** Python 3.10+ stdlib + `requests` (no new deps), pytest (plain functions + monkeypatch mocks), zero-build Tailwind Play CDN frontend, llama.cpp on :8080.

**Spec:** `docs/superpowers/specs/2026-07-08-tab5-tab6-skill-mcp-design.md` (rev 2 — read it first).

## Global Constraints

- Branch: `feat/tab5-tab6-finish`. Never commit to main.
- No new dependencies. `mcp_server.py` must run with stdlib only.
- Bilingual: every user-facing string lands in BOTH `index.html` and `index.zh-TW.html` (via `I18N` in app.js where JS-rendered); lessons land as `.md` + `.zh-TW.md` pairs.
- Bump `app.js?v=79` → `?v=80` in both HTML files when frontend JS changes (Task 8 does the single bump).
- Tests: plain pytest functions + `monkeypatch`, style of `agent/tests/test_server.py`. Run `pytest agent/tests -q` — all green before every commit.
- `node --check frontend/app.js` before every frontend commit.
- MCP weather mock is **deliberately** `{"temp": 16, "cond": "有雨"}` — different from skill's 28°C 晴. Do not "fix" this; lesson 6 teaches it.
- The dev server may be running (`lsof -nP -iTCP:9000`); server.py changes need a restart to test live: `pkill -f agent.server; nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`

---

### Task 1: `agent/mcp_server.py` — stdio JSON-RPC MCP server

**Files:**
- Create: `agent/mcp_server.py`
- Test: `agent/tests/test_mcp_server.py`

**Interfaces:**
- Produces: a subprocess-runnable module. Protocol (consumed by Task 2):
  - request `{"jsonrpc":"2.0","id":N,"method":"initialize","params":{...}}` → result `{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"llm-no-magic-mcp-demo","version":"0.1"}}`
  - notification `{"jsonrpc":"2.0","method":"notifications/initialized"}` → **no response line**
  - `tools/list` → result `{"tools":[{name,description,inputSchema},...]}` with exactly `get_time` and `get_weather`
  - `tools/call` params `{"name":str,"arguments":{}}` → result `{"content":[{"type":"text","text":str}],"isError":false}`
  - unknown method → error `{"code":-32601,...}`; malformed JSON line → error `{"code":-32700,...}` with `"id":null`

- [ ] **Step 1: Write the failing test**

```python
# agent/tests/test_mcp_server.py
"""agent/mcp_server.py — stdio JSON-RPC 2.0 framing tests (real subprocess)."""
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _run_lines(lines: list[str]) -> list[dict]:
    """Feed newline-delimited JSON-RPC lines to a real mcp_server child,
    return the parsed response lines."""
    proc = subprocess.run(
        [sys.executable, "-m", "agent.mcp_server"],
        input="\n".join(lines) + "\n",
        capture_output=True, text=True, timeout=15, cwd=REPO_ROOT,
    )
    return [json.loads(l) for l in proc.stdout.splitlines() if l.strip()]


def test_initialize_returns_serverinfo():
    out = _run_lines(['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'])
    assert len(out) == 1
    r = out[0]
    assert r["id"] == 1
    assert r["result"]["serverInfo"]["name"] == "llm-no-magic-mcp-demo"
    assert r["result"]["protocolVersion"] == "2025-03-26"
    assert "tools" in r["result"]["capabilities"]


def test_initialized_notification_gets_no_response():
    out = _run_lines([
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
        '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
    ])
    assert [r["id"] for r in out] == [1, 2]   # notification produced nothing


def test_tools_list_has_get_time_and_get_weather():
    out = _run_lines(['{"jsonrpc":"2.0","id":1,"method":"tools/list"}'])
    tools = out[0]["result"]["tools"]
    names = [t["name"] for t in tools]
    assert names == ["get_time", "get_weather"]
    weather = tools[1]
    assert weather["inputSchema"]["required"] == ["city"]


def test_tools_call_get_time_returns_hhmmss():
    out = _run_lines(['{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_time","arguments":{}}}'])
    text = out[0]["result"]["content"][0]["text"]
    import re
    assert re.fullmatch(r"\d{2}:\d{2}:\d{2}", text)


def test_tools_call_get_weather_mock_values():
    out = _run_lines(['{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_weather","arguments":{"city":"台北"}}}'])
    payload = json.loads(out[0]["result"]["content"][0]["text"])
    assert payload == {"city": "台北", "temp": 16, "cond": "有雨"}


def test_unknown_method_returns_32601():
    out = _run_lines(['{"jsonrpc":"2.0","id":1,"method":"nope"}'])
    assert out[0]["error"]["code"] == -32601


def test_malformed_json_returns_32700_not_crash():
    out = _run_lines([
        'this is not json',
        '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
    ])
    assert out[0]["error"]["code"] == -32700
    assert out[0]["id"] is None
    assert out[1]["id"] == 2   # server kept running


def test_unknown_tool_returns_error():
    out = _run_lines(['{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"nope","arguments":{}}}'])
    assert "error" in out[0]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest agent/tests/test_mcp_server.py -q`
Expected: FAIL — `No module named agent.mcp_server`

- [ ] **Step 3: Write the implementation**

```python
# agent/mcp_server.py
"""Minimal MCP server — Tab ⑥ demo. Real JSON-RPC 2.0 over stdio, one JSON
object per line (the same newline-delimited framing real MCP stdio uses).

Methods implemented: initialize, tools/list, tools/call. Notifications
(no "id") are accepted and never answered — per JSON-RPC 2.0.

Tools are mocks on purpose: get_weather returns fixed 16°C 有雨,
DELIBERATELY different from Tab ⑤'s check_weather skill (28°C 晴) — lesson 6
uses the difference to teach 「工具從哪來,答案就從哪來」.

Zero dependencies. Run standalone:
    echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -m agent.mcp_server
"""
import json
import sys
import time

TOOLS = [
    {
        "name": "get_time",
        "description": "Get current time in HH:MM:SS format.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_weather",
        "description": "Get current weather (temperature + condition) for a city.",
        "inputSchema": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "City name"}},
            "required": ["city"],
        },
    },
]


def call_tool(name: str, args: dict) -> str:
    if name == "get_time":
        return time.strftime("%H:%M:%S")
    if name == "get_weather":
        return json.dumps(
            {"city": args.get("city", "?"), "temp": 16, "cond": "有雨"},
            ensure_ascii=False,
        )
    raise ValueError(f"unknown tool: {name}")


def handle(req: dict) -> dict:
    method = req.get("method", "")
    if method == "initialize":
        return {
            "protocolVersion": "2025-03-26",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "llm-no-magic-mcp-demo", "version": "0.1"},
        }
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        params = req.get("params", {}) or {}
        text = call_tool(params.get("name", ""), params.get("arguments", {}) or {})
        return {"content": [{"type": "text", "text": text}], "isError": False}
    raise KeyError(method)


def _reply(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            _reply({"jsonrpc": "2.0", "id": None,
                    "error": {"code": -32700, "message": "parse error"}})
            continue
        if "id" not in req:      # notification — never answered
            continue
        try:
            _reply({"jsonrpc": "2.0", "id": req["id"], "result": handle(req)})
        except KeyError:
            _reply({"jsonrpc": "2.0", "id": req["id"],
                    "error": {"code": -32601,
                              "message": f"method not found: {req.get('method')}"}})
        except Exception as exc:
            _reply({"jsonrpc": "2.0", "id": req["id"],
                    "error": {"code": -32603, "message": str(exc)}})


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest agent/tests/test_mcp_server.py -q`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add agent/mcp_server.py agent/tests/test_mcp_server.py
git commit -m "feat(mcp): minimal stdio JSON-RPC MCP server for tab6 demo"
```

---

### Task 2: `agent/mcp_agent.py` — Tab ⑥ agent loop

**Files:**
- Create: `agent/mcp_agent.py`
- Test: `agent/tests/test_mcp_agent.py`

**Interfaces:**
- Consumes: `agent.mcp_server` subprocess protocol (Task 1).
- Produces: `mcp_agent_loop(user_query: str) -> generator` yielding dicts, consumed by Task 4's drive() branch and Task 8's UI:
  - `{"type":"protocol","phase":"handshake"|"call","method":str,"request":dict,"response":dict|None}` — 3 handshake frames (initialize, notifications/initialized with response None, tools/list), then one per tools/call
  - `{"type":"turn_complete","turn":int,"content":str,"tool_calls":[{"name","args"}],"tool_results":[{"name","result_text"}],"received_chunk":str,"next_prompt":str,"usage":{"prompt_tokens","completion_tokens"}}` — NO `message_tokens` key
  - `{"type":"final","content":str}` on the no-tool-call turn
  - `{"type":"error","message":str}` on MAX_TURNS/llama failure
- Child process is killed in `finally` (generator close / cancel included).

- [ ] **Step 1: Write the failing test**

```python
# agent/tests/test_mcp_agent.py
"""mcp_agent_loop — real mcp_server child + mocked llama."""
import json


def _llama_resp(content=None, tool_calls=None):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    class R:
        def json(self):
            return {"choices": [{"message": msg}],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 10}}
    return R()


def test_handshake_frames_come_first(monkeypatch):
    import agent.mcp_agent as m
    monkeypatch.setattr(m.requests, "post",
                        lambda *a, **kw: _llama_resp(content="hi"))
    events = list(m.mcp_agent_loop("hello"))
    protos = [e for e in events if e["type"] == "protocol"]
    assert [p["method"] for p in protos[:3]] == [
        "initialize", "notifications/initialized", "tools/list"]
    assert protos[0]["phase"] == "handshake"
    assert protos[1]["response"] is None
    tools = protos[2]["response"]["result"]["tools"]
    assert [t["name"] for t in tools] == ["get_time", "get_weather"]


def test_no_toolcall_yields_turn_then_final(monkeypatch):
    import agent.mcp_agent as m
    monkeypatch.setattr(m.requests, "post",
                        lambda *a, **kw: _llama_resp(content="answer"))
    events = list(m.mcp_agent_loop("hello"))
    turns = [e for e in events if e["type"] == "turn_complete"]
    assert len(turns) == 1
    assert turns[0]["content"] == "answer"
    assert turns[0]["tool_calls"] == []
    assert "message_tokens" not in turns[0]
    assert turns[0]["usage"]["prompt_tokens"] == 100
    assert events[-1] == {"type": "final", "content": "answer"}


def test_toolcall_round_trip(monkeypatch):
    import agent.mcp_agent as m
    calls = iter([
        _llama_resp(tool_calls=[{"id": "c1", "type": "function",
                                 "function": {"name": "get_weather",
                                              "arguments": '{"city": "台北"}'}}]),
        _llama_resp(content="台北 16°C 有雨"),
    ])
    monkeypatch.setattr(m.requests, "post", lambda *a, **kw: next(calls))
    events = list(m.mcp_agent_loop("台北天氣?"))
    call_protos = [e for e in events if e["type"] == "protocol" and e["phase"] == "call"]
    assert len(call_protos) == 1
    assert call_protos[0]["request"]["params"]["name"] == "get_weather"
    turns = [e for e in events if e["type"] == "turn_complete"]
    assert turns[0]["tool_results"][0]["name"] == "get_weather"
    payload = json.loads(turns[0]["tool_results"][0]["result_text"])
    assert payload["temp"] == 16
    assert events[-1]["type"] == "final"


def test_openai_tools_conversion():
    import agent.mcp_agent as m
    tools = [{"name": "t", "description": "d",
              "inputSchema": {"type": "object", "properties": {}}}]
    out = m.mcp_tools_to_openai(tools)
    assert out[0]["type"] == "function"
    assert out[0]["function"]["name"] == "t"
    assert out[0]["function"]["parameters"] == {"type": "object", "properties": {}}


def test_child_killed_on_generator_close(monkeypatch):
    import agent.mcp_agent as m
    monkeypatch.setattr(m.requests, "post",
                        lambda *a, **kw: _llama_resp(content="x"))
    gen = m.mcp_agent_loop("q")
    first = next(gen)               # handshake started → child alive
    assert first["type"] == "protocol"
    client = m._LAST_CLIENT         # test hook set by the loop
    assert client.proc.poll() is None
    gen.close()                     # cancel path: drive() breaks out
    client.proc.wait(timeout=5)
    assert client.proc.poll() is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest agent/tests/test_mcp_agent.py -q`
Expected: FAIL — `No module named agent.mcp_agent`

- [ ] **Step 3: Write the implementation**

```python
# agent/mcp_agent.py
"""Tab ⑥ MCP agent loop — spawns agent/mcp_server.py as a child process,
discovers its tools over real JSON-RPC (initialize → notifications/initialized
→ tools/list), exposes them to llama-server in OpenAI format, and executes
model tool_calls via tools/call.

Every JSON-RPC exchange is yielded as a `protocol` event — the wire IS the
teaching artifact. Turn frames are Tab ④-shaped (no message_tokens; the loop
requests no logprobs).
"""
import json
import queue
import subprocess
import sys
import threading
from pathlib import Path

import requests

LLAMA_URL = "http://localhost:8080/v1/chat/completions"
MAX_TURNS = 8          # > tab4's 6 on purpose: discovery chains run longer
RPC_TIMEOUT = 10       # seconds per JSON-RPC round-trip
REPO_ROOT = Path(__file__).resolve().parent.parent

_LAST_CLIENT = None    # test hook: last spawned client (kill-on-close test)


class McpClient:
    """One child mcp_server + a reader thread (stdlib readline has no
    timeout; a daemon thread feeding a Queue gives us one)."""

    def __init__(self):
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "agent.mcp_server"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            text=True, bufsize=1, cwd=REPO_ROOT,
        )
        self._q: queue.Queue[str] = queue.Queue()
        self._next_id = 0
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        for line in self.proc.stdout:
            self._q.put(line)

    def request(self, method: str, params: dict | None = None) -> tuple[dict, dict]:
        self._next_id += 1
        req = {"jsonrpc": "2.0", "id": self._next_id, "method": method}
        if params is not None:
            req["params"] = params
        self.proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        line = self._q.get(timeout=RPC_TIMEOUT)
        return req, json.loads(line)

    def notify(self, method: str) -> dict:
        note = {"jsonrpc": "2.0", "method": method}
        self.proc.stdin.write(json.dumps(note) + "\n")
        self.proc.stdin.flush()
        return note

    def close(self):
        try:
            self.proc.kill()
        except Exception:
            pass


def mcp_tools_to_openai(tools: list[dict]) -> list[dict]:
    """MCP tool schema → OpenAI chat-completions `tools` array."""
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("inputSchema", {"type": "object", "properties": {}}),
            },
        }
        for t in tools
    ]


def mcp_agent_loop(user_query: str):
    """Yield protocol / turn_complete / final / error frames (see module doc)."""
    global _LAST_CLIENT
    client = McpClient()
    _LAST_CLIENT = client
    try:
        req, resp = client.request("initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "llm-no-magic", "version": "0.1"},
        })
        yield {"type": "protocol", "phase": "handshake",
               "method": "initialize", "request": req, "response": resp}

        note = client.notify("notifications/initialized")
        yield {"type": "protocol", "phase": "handshake",
               "method": "notifications/initialized", "request": note, "response": None}

        req, resp = client.request("tools/list")
        yield {"type": "protocol", "phase": "handshake",
               "method": "tools/list", "request": req, "response": resp}
        openai_tools = mcp_tools_to_openai(resp["result"]["tools"])

        messages = [{"role": "system", "content": "/no_think"},
                    {"role": "user", "content": user_query}]

        for turn in range(1, MAX_TURNS + 1):
            body = {"model": "any", "messages": messages, "temperature": 0.3,
                    "tools": openai_tools, "tool_choice": "auto"}
            try:
                resp_llm = requests.post(LLAMA_URL, json=body, timeout=120).json()
            except Exception as exc:
                yield {"type": "error", "message": f"{type(exc).__name__}: {exc}"}
                return

            msg = resp_llm["choices"][0]["message"]
            content = msg.get("content") or ""
            tool_calls = msg.get("tool_calls") or []
            usage = resp_llm.get("usage") or {}

            tcs = [{"name": tc["function"]["name"], "args": tc["function"]["arguments"]}
                   for tc in tool_calls]
            tool_results = []
            if tool_calls:
                messages.append(msg)
                for tc in tool_calls:
                    try:
                        args = json.loads(tc["function"]["arguments"])
                    except Exception:
                        args = {}
                    req_c, resp_c = client.request(
                        "tools/call",
                        {"name": tc["function"]["name"], "arguments": args})
                    yield {"type": "protocol", "phase": "call",
                           "method": "tools/call", "request": req_c, "response": resp_c}
                    if "result" in resp_c:
                        text = "".join(p.get("text", "")
                                       for p in resp_c["result"].get("content", []))
                    else:
                        text = f"[error] {resp_c.get('error', {}).get('message', 'unknown')}"
                    tool_results.append({"name": tc["function"]["name"],
                                         "result_text": text})
                    messages.append({"role": "tool", "tool_call_id": tc["id"],
                                     "content": text})

            yield {
                "type": "turn_complete", "turn": turn, "content": content,
                "tool_calls": tcs, "tool_results": tool_results,
                "received_chunk": json.dumps(msg, ensure_ascii=False, indent=2),
                "next_prompt": (json.dumps(messages, ensure_ascii=False, indent=2)
                                if tool_calls else ""),
                "usage": {"prompt_tokens": usage.get("prompt_tokens"),
                          "completion_tokens": usage.get("completion_tokens")},
            }

            if not tool_calls:
                yield {"type": "final", "content": content}
                return

        yield {"type": "error", "message": f"max_turns ({MAX_TURNS}) reached"}
    finally:
        client.close()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest agent/tests/test_mcp_agent.py agent/tests/test_mcp_server.py -q`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add agent/mcp_agent.py agent/tests/test_mcp_agent.py
git commit -m "feat(mcp): tab6 agent loop — handshake + tools/call over real pipe"
```

---

### Task 3: `skill_agent.py` — usage on `turn`, trimmed `received`, tests

**Files:**
- Modify: `agent/skill_agent.py` (the loop body, around lines 359–384)
- Test: `agent/tests/test_skill_agent.py` (new — module has zero coverage today)

**Interfaces:**
- Produces (consumed by Task 4 drive branch + Task 7 UI):
  - `turn` events gain `"usage": {"prompt_tokens": int|None, "completion_tokens": int|None}`
  - `received` events change from `{"type":"received","turn":N,"response":<full llama json>}` to `{"type":"received","turn":N,"response":{"message":<assistant msg>,"usage":<usage>}}`
  - everything else byte-identical.

- [ ] **Step 1: Write the failing test**

```python
# agent/tests/test_skill_agent.py
"""skill_agent_loop — mocked llama; usage propagation + trimmed received."""


def _resp(content=None, tool_calls=None, prompt_tokens=500):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    class R:
        def json(self):
            return {"choices": [{"message": msg}],
                    "usage": {"prompt_tokens": prompt_tokens,
                              "completion_tokens": 7}}
    return R()


def test_turn_carries_usage_and_received_is_trimmed(monkeypatch):
    import agent.skill_agent as sa
    monkeypatch.setattr(sa.requests, "post", lambda *a, **kw: _resp(content="hi"))
    events = list(sa.skill_agent_loop("hello", "proper"))
    turn = next(e for e in events if e["type"] == "turn")
    assert turn["usage"] == {"prompt_tokens": 500, "completion_tokens": 7}
    received = next(e for e in events if e["type"] == "received")
    assert set(received["response"].keys()) == {"message", "usage"}
    assert received["response"]["message"]["content"] == "hi"


def test_no_skills_mode_empty_index(monkeypatch):
    import agent.skill_agent as sa
    monkeypatch.setattr(sa.requests, "post", lambda *a, **kw: _resp(content="guess"))
    events = list(sa.skill_agent_loop("台北天氣?", "no_skills"))
    index = next(e for e in events if e["type"] == "index")
    assert index["skills"] == []
    tools = next(e for e in events if e["type"] == "tools_exposed")
    assert tools["tools"] == []
    assert events[-1] == {"type": "final", "content": "guess"}


def test_load_skill_error_yields_tool_result(monkeypatch):
    import agent.skill_agent as sa
    calls = iter([
        _resp(tool_calls=[{"id": "c1", "type": "function",
                           "function": {"name": "load_skill",
                                        "arguments": '{"name": "nope"}'}}]),
        _resp(content="sorry"),
    ])
    monkeypatch.setattr(sa.requests, "post", lambda *a, **kw: next(calls))
    events = list(sa.skill_agent_loop("x", "proper"))
    tr = next(e for e in events if e["type"] == "tool_result")
    assert tr["error"] is True
    assert "not found" in tr["result"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest agent/tests/test_skill_agent.py -q`
Expected: FAIL — `turn` has no `usage` key / `received["response"]` has llama's full keys

- [ ] **Step 3: Modify `skill_agent.py`**

In `skill_agent_loop`, replace the block from `resp = requests.post(...)` through the `turn` yield (currently lines ~359–384) with:

```python
        try:
            resp = requests.post(LLAMA_URL, json=req_body, timeout=60).json()
        except Exception as exc:
            yield {"type": "error", "message": f"{type(exc).__name__}: {exc}"}
            return

        msg = resp["choices"][0]["message"]
        usage_raw = resp.get("usage") or {}
        usage = {"prompt_tokens": usage_raw.get("prompt_tokens"),
                 "completion_tokens": usage_raw.get("completion_tokens")}

        # surface the model response — trimmed to the assistant message +
        # usage (the full llama json bloats every relay frame; the UI's
        # ▸ expander only needs these two)
        yield {
            "type": "received",
            "turn": turn,
            "response": {"message": msg, "usage": usage},
        }

        content = msg.get("content") or ""
        tool_calls = msg.get("tool_calls", []) or []

        yield {
            "type": "turn",
            "turn": turn,
            "content": content,
            "usage": usage,
            "tool_calls": [
                {"id": tc["id"], "name": tc["function"]["name"], "args": tc["function"]["arguments"]}
                for tc in tool_calls
            ],
        }
```

(The old `msg = resp["choices"][0]["message"]` line that sat after the received-yield is subsumed above — don't leave a duplicate.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest agent/tests/test_skill_agent.py agent/tests -q`
Expected: all passed (including untouched suites)

- [ ] **Step 5: Commit**

```bash
git add agent/skill_agent.py agent/tests/test_skill_agent.py
git commit -m "feat(skill): usage on turn frames, trim received to msg+usage"
```

---

### Task 4: `server.py` — drive routing for tabs 5/6, remove `/skill-agent`

**Files:**
- Modify: `agent/server.py` — `MODEL_FOR_TAB` (line ~222), `drive()` (tab-4 branch area, lines ~430–465), `do_POST` route table (~578), delete `_handle_skill_agent` (~593), module docstring endpoint list (lines 5–7), import block (add `mcp_agent_loop`)
- Test: `agent/tests/test_server.py` (append)

**Interfaces:**
- Consumes: `skill_agent_loop(user, mode)` (Task 3), `mcp_agent_loop(user)` (Task 2).
- Produces (lesson-facing API):
  - `drive("5", user, mode=...)` → `{"subscribers":int,"tab":"5","skills":[...],"turns":[<turn frames with usage>],"final":str}`
  - `drive("6", user)` → `{"subscribers":int,"tab":"6","protocol_frames":[...],"turns":[<turn_complete frames>],"final":str}`
  - `MODEL_FOR_TAB` includes `"5": "4B", "6": "4B"`.
  - POST `/skill-agent` → 404.

- [ ] **Step 1: Write the failing tests** (append to `agent/tests/test_server.py`)

```python
def test_model_for_tab_5_and_6_are_4b():
    import agent.server as server
    assert server.MODEL_FOR_TAB["5"] == "4B"
    assert server.MODEL_FOR_TAB["6"] == "4B"


def _drive_ready(monkeypatch, server):
    """Neutralize swap + relay so drive() runs the loop synchronously."""
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "4B")
    monkeypatch.setattr(server, "publish", lambda ev: None)


def test_drive_tab5_aggregates_skills_turns_final(monkeypatch):
    import agent.server as server
    _drive_ready(monkeypatch, server)
    fake_events = [
        {"type": "index", "skills": [{"name": "check_weather"}], "mode": "proper"},
        {"type": "turn", "turn": 1, "content": "hi", "tool_calls": [],
         "usage": {"prompt_tokens": 5, "completion_tokens": 1}},
        {"type": "final", "content": "hi"},
    ]
    monkeypatch.setattr(server, "skill_agent_loop",
                        lambda user, mode: iter(fake_events))
    out = server.drive("5", "hello")
    assert out["tab"] == "5"
    assert out["skills"] == [{"name": "check_weather"}]
    assert out["turns"][0]["usage"]["prompt_tokens"] == 5
    assert out["final"] == "hi"


def test_drive_tab6_aggregates_protocol_and_turns(monkeypatch):
    import agent.server as server
    _drive_ready(monkeypatch, server)
    fake_events = [
        {"type": "protocol", "phase": "handshake", "method": "initialize",
         "request": {}, "response": {}},
        {"type": "turn_complete", "turn": 1, "content": "ans", "tool_calls": [],
         "tool_results": [], "received_chunk": "", "next_prompt": "",
         "usage": {"prompt_tokens": 9, "completion_tokens": 2}},
        {"type": "final", "content": "ans"},
    ]
    monkeypatch.setattr(server, "mcp_agent_loop", lambda user: iter(fake_events))
    out = server.drive("6", "q")
    assert out["protocol_frames"][0]["method"] == "initialize"
    assert out["turns"][0]["turn"] == 1
    assert out["final"] == "ans"


def test_drive_tab5_loop_error_returns_error(monkeypatch):
    import agent.server as server
    _drive_ready(monkeypatch, server)
    monkeypatch.setattr(server, "skill_agent_loop",
                        lambda user, mode: iter([{"type": "error", "message": "boom"}]))
    out = server.drive("5", "x")
    assert out["error"] == "boom"


def test_drive_tab5_cancel_publishes_empty_final(monkeypatch):
    import agent.server as server
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "4B")
    published = []
    monkeypatch.setattr(server, "publish", lambda ev: published.append(ev))

    def loop(user, mode):
        yield {"type": "turn", "turn": 1, "content": "", "tool_calls": [],
               "usage": {}}
        server.CANCEL.set()
        yield {"type": "turn", "turn": 2, "content": "", "tool_calls": [],
               "usage": {}}
        yield {"type": "final", "content": "never"}
    monkeypatch.setattr(server, "skill_agent_loop", loop)
    out = server.drive("5", "x")
    assert out["final"] == ""
    assert published[-1] == {"type": "final", "content": ""}


def test_skill_agent_endpoint_removed():
    import agent.server as server
    assert not hasattr(server.Handler, "_handle_skill_agent")
```

Note: check the actual handler class name at the top of `test_server.py` (existing tests reference it) — use the same symbol; if the class is named differently (e.g. `AgentHandler`), adjust `test_skill_agent_endpoint_removed` to match.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest agent/tests/test_server.py -q -k "tab5 or tab6 or model_for_tab or skill_agent_endpoint"`
Expected: FAIL — KeyError "5" on MODEL_FOR_TAB etc.

- [ ] **Step 3: Implement server.py changes**

3a. Import (next to the existing `from agent.skill_agent import skill_agent_loop`-style imports — check actual import style at top of file and match it):

```python
from agent.mcp_agent import mcp_agent_loop
```

3b. `MODEL_FOR_TAB`:

```python
MODEL_FOR_TAB = {"1": "0.6B", "2": "0.6B", "3": "0.6B", "4": "4B",
                 "5": "4B", "6": "4B"}
```

3c. In `drive()`, immediately after the `if tab == "4":` block's `return`, add tab-5/6 branches (identical cancel/terminal-final contract to tab 4):

```python
            if tab in ("5", "6"):
                turns = []
                extra_key = "skills" if tab == "5" else "protocol_frames"
                extra = []
                saw_final = False
                if tab == "5":
                    loop = skill_agent_loop(user, mode or "proper")
                else:
                    loop = mcp_agent_loop(user)
                for ev in loop:
                    publish(ev)
                    et = ev["type"]
                    if et in ("turn", "turn_complete"):
                        turns.append(ev)
                    elif et == "index" and tab == "5":
                        extra = ev["skills"]
                    elif et == "protocol" and tab == "6":
                        extra.append(ev)
                    elif et == "final":
                        final = ev["content"]
                        saw_final = True
                    elif et == "error":
                        return _fail(ev["message"], error_already_published=True)
                    if CANCEL.is_set():
                        break
                if not saw_final:
                    # terminal-final invariant (§3.6): cancel broke the loop
                    # before its own final — emit one so Send re-enables.
                    publish({"type": "final", "content": ""})
                return {"subscribers": subscriber_count(), "tab": tab,
                        extra_key: extra, "turns": turns, "final": final}
```

(`final` is already initialized to `""` above the tab-4 branch. Breaking out of the `for ev in loop` closes the generator → `mcp_agent_loop`'s `finally` kills the child — the cancel path needs no extra code here.)

3d. `do_POST`: delete the two lines

```python
        elif self.path == "/skill-agent":
            self._handle_skill_agent()
```

3e. Delete the whole `_handle_skill_agent` method.

3f. Module docstring (lines ~5–7): change the endpoint inventory to

```
  - POST /agent, /preview → API handlers (SSE for /agent, plain proxy for /preview)
  - POST /drive /inspect /stop → relay teaching commands (tabs 1-6)
```

Also update the class docstring at line ~482 (`- POST → /agent / /skill-agent / ...`) to drop `/skill-agent`.

- [ ] **Step 4: Run the whole suite**

Run: `python3 -m pytest agent/tests -q`
Expected: all passed (old `/skill-agent`-free suites unaffected)

- [ ] **Step 5: Live smoke (server restart required)**

```bash
pkill -f agent.server; sleep 1
nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
sleep 2
curl -s -X POST http://localhost:9000/drive -H "Content-Type: application/json" \
  -d '{"tab":"6","user":"現在幾點?"}' | python3 -m json.tool | head -30
```

Expected: JSON with `protocol_frames` (3 handshake + ≥1 call), `turns`, non-empty `final`. (First run swaps to 4B — allow ~10 s.)

- [ ] **Step 6: Commit**

```bash
git add agent/server.py agent/tests/test_server.py
git commit -m "feat(server): /drive routes tabs 5+6, drop /skill-agent endpoint"
```

---

### Task 5: Frontend — extract shared bubble helpers (zero visual change to Tab ④)

**Files:**
- Modify: `frontend/app.js` — move `TW`, `makeDetails`, bubble builders out of `setupAgent` to module level (place them right after `renderPromptPreview`)

**Interfaces:**
- Produces module-level functions (consumed by Tasks 7/8 and by `setupAgent` itself):

```js
const BUBBLE = {
  tw: {...},                                    // the class strings (former TW)
  details(summaryText, contentEl) → <details>,
  pre(text) → <pre class=npPre>,
  model({label, lines, caption, chip}) → {row, bubble},  // blue, left; lines: string[]; chip: string|null appended to label muted
  tool({label, badge, body, caption}) → {row, bubble},   // purple, right
  finalBlock({caption, content}) → block,                 // green, full-width; content is a STRING
  banner(text) → el,                                      // ⟳ summary banner
};
```

- [ ] **Step 1: Add the module-level `BUBBLE` namespace**

After `renderPromptPreview` (around line 190), insert — this is the former `TW` + builders, generalized:

```js
// ── Shared chat-bubble builders (tabs ④⑤⑥) ──────────────────────────
// 視覺語彙:模型=藍(左)、工具=紫(右)、給使用者=綠(全寬)。
const BUBBLE = {
  tw: {
    block:      "turn-block space-y-1",
    mRow:       "max-w-[88%] md:max-w-[75%]",
    mLabel:     "text-xs font-semibold text-final mb-1",
    mChip:      "ml-1.5 font-normal text-muted",
    mBubble:    "w-fit rounded-2xl rounded-tl-sm bg-final-tint border border-final/15 px-4 py-3 font-mono text-sm break-all leading-relaxed text-ink",
    mCaption:   "text-xs text-muted mt-1 ml-1",
    tRow:       "ml-auto max-w-[88%] md:max-w-[75%] flex flex-col items-end",
    tLabel:     "text-xs font-semibold text-tool mb-1",
    tBadge:     "ml-1.5 font-normal text-muted",
    tBubble:    "rounded-2xl rounded-tr-sm bg-tool-tint border border-tool/15 px-4 py-3 font-mono text-sm break-all leading-relaxed text-ink text-left",
    tCaption:   "text-xs text-tool mt-1 mr-1",
    fCaption:   "text-center text-xs font-semibold text-result pt-2 mb-2",
    fBubble:    "rounded-xl bg-result-tint border border-result/15 px-4 py-3.5 text-center text-base md:text-lg leading-relaxed text-ink",
    banner:     "rounded-lg bg-surface-2 border border-edge-soft px-4 py-3 flex items-center gap-3 text-sm text-ink-soft",
    bannerIcon: "w-7 h-7 rounded-full bg-final-tint text-final flex items-center justify-center flex-shrink-0",
    tokensBox:  "mt-1.5 rounded-md bg-surface border border-edge-soft p-3 font-mono text-xs break-all leading-relaxed max-h-48 overflow-auto",
    npDetails:  "mt-1.5 w-full text-left",
    npSummary:  "cursor-pointer text-xs text-muted hover:text-ink-soft py-1 list-none [&::-webkit-details-marker]:hidden before:content-['▸_'] [&[open]]:before:content-['▾_']",
    npPre:      "mt-1.5 rounded-md bg-surface border border-edge-soft p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto text-ink-soft",
    errorBox:   "mt-3 rounded-md bg-surface-2 border border-edge p-3 text-sm font-mono text-ink-soft",
  },
  details(summaryText, contentEl) {
    const details = document.createElement("details");
    details.className = BUBBLE.tw.npDetails;
    const summary = document.createElement("summary");
    summary.className = BUBBLE.tw.npSummary;
    summary.textContent = summaryText;
    details.append(summary, contentEl);
    return details;
  },
  pre(text) {
    const pre = document.createElement("pre");
    pre.className = BUBBLE.tw.npPre;
    pre.textContent = text;
    return pre;
  },
  model({ label, lines, caption, chip }) {
    const row = document.createElement("div");
    row.className = BUBBLE.tw.mRow;
    const labelEl = document.createElement("div");
    labelEl.className = BUBBLE.tw.mLabel;
    labelEl.textContent = label;
    if (chip) {
      const chipEl = document.createElement("span");
      chipEl.className = BUBBLE.tw.mChip;
      chipEl.textContent = chip;
      labelEl.appendChild(chipEl);
    }
    const bubble = document.createElement("div");
    bubble.className = BUBBLE.tw.mBubble;
    for (const line of lines) {
      const div = document.createElement("div");
      div.textContent = line;
      bubble.appendChild(div);
    }
    row.append(labelEl, bubble);
    if (caption) {
      const cap = document.createElement("div");
      cap.className = BUBBLE.tw.mCaption;
      cap.textContent = caption;
      row.appendChild(cap);
    }
    return { row, bubble };
  },
  tool({ label, badge, body, caption }) {
    const row = document.createElement("div");
    row.className = BUBBLE.tw.tRow;
    const labelEl = document.createElement("div");
    labelEl.className = BUBBLE.tw.tLabel;
    labelEl.textContent = label;
    if (badge) {
      const badgeEl = document.createElement("span");
      badgeEl.className = BUBBLE.tw.tBadge;
      badgeEl.textContent = badge;
      labelEl.appendChild(badgeEl);
    }
    const bubble = document.createElement("div");
    bubble.className = BUBBLE.tw.tBubble;
    bubble.textContent = body;
    row.append(labelEl, bubble);
    if (caption) {
      const cap = document.createElement("div");
      cap.className = BUBBLE.tw.tCaption;
      cap.textContent = caption;
      row.appendChild(cap);
    }
    return { row, bubble };
  },
  finalBlock({ caption, content }) {
    const block = document.createElement("div");
    block.className = BUBBLE.tw.block;
    const capEl = document.createElement("div");
    capEl.className = BUBBLE.tw.fCaption;
    capEl.textContent = caption;
    const bubble = document.createElement("div");
    bubble.className = BUBBLE.tw.fBubble;
    bubble.textContent = content || "(no final content)";
    block.append(capEl, bubble);
    return block;
  },
  banner(text) {
    const el = document.createElement("div");
    el.className = BUBBLE.tw.banner;
    const icon = document.createElement("span");
    icon.className = BUBBLE.tw.bannerIcon;
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⟳";
    const span = document.createElement("span");
    span.textContent = text;
    el.append(icon, span);
    return el;
  },
};
```

- [ ] **Step 2: Rewrite `setupAgent`'s render functions on the helpers**

Inside `setupAgent`: delete the closure `TW` object, `makeDetails`, and rewrite `renderTurnBlock` / `renderTraceSummary` / `renderFinal` / `renderError` as below. `makeTokensBox` stays (tab-4-only; change its two class references to `BUBBLE.tw.tokensBox` and keep `.tok tok-static` spans):

```js
  function renderTurnBlock(turn, message_tokens, tool_calls, tool_results, received_chunk, next_prompt) {
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
      if (message_tokens && message_tokens.length) {
        mRow.appendChild(BUBBLE.details(t('raw_tokens_summary'), makeTokensBox(turn, message_tokens)));
      }
      if (received_chunk) {
        mRow.appendChild(BUBBLE.details(t('received_summary'), BUBBLE.pre(received_chunk)));
      }
      block.appendChild(mRow);

      (tool_results || []).forEach((tr, i) => {
        const raw = (tr.result_text || "").trim();
        const looksJson = raw.startsWith("{") || raw.startsWith("[");
        const { row: tRow } = BUBBLE.tool({
          label: t('tool_bubble_label', { name: tr.name }),
          badge: t('local_exec_badge'),
          body: `${t('tool_returns')} ${looksJson ? raw : JSON.stringify(raw)}`,
          caption: t('feeds_back_caption'),
        });
        if (next_prompt && i === tool_results.length - 1) {
          tRow.appendChild(BUBBLE.details(t('next_prompt_summary', { turn }), BUBBLE.pre(next_prompt)));
        }
        block.appendChild(tRow);
      });
    } else {
      finalRendered = true;
      const content = (message_tokens || []).map((s) => s.token).join("");
      block.appendChild(BUBBLE.finalBlock({ caption: t('to_user_caption'), content }));
      if (message_tokens && message_tokens.length) {
        block.appendChild(BUBBLE.details(t('raw_tokens_summary'), makeTokensBox(turn, message_tokens)));
      }
    }

    turnsEl.appendChild(block);
    turns.push({ tokenSteps: message_tokens || [], el: block, hadTool: hasToolCalls });
  }

  function renderTraceSummary() {
    const rounds = turns.length;
    if (!rounds) return;
    const trips = turns.filter((tn) => tn.hadTool).length;
    turnsEl.prepend(BUBBLE.banner(
      trips === 0 ? t('trace_summary_notool') : t('trace_summary', { trips, rounds })));
  }

  function renderFinal(content) {
    if (finalRendered || !content) return;
    turnsEl.appendChild(BUBBLE.finalBlock({ caption: t('to_user_caption'), content }));
  }

  function renderError(msg) {
    const errBox = document.createElement("div");
    errBox.className = BUBBLE.tw.errorBox;
    errBox.textContent = `[error] ${msg}`;
    turnsEl.appendChild(errBox);
  }
```

Note the `finalBlock({content})` — a string, fixing spec C3 for tabs ⑤⑥ reuse.

- [ ] **Step 3: Verify no behavior change**

```bash
node --check frontend/app.js
curl -s -X POST http://localhost:9000/drive -H "Content-Type: application/json" -d '{"tab":"4","user":"現在幾點?"}' > /dev/null
```

Then screenshot Tab ④ via playwright MCP (localhost:9000, fullPage) and compare against the pre-refactor look: banner + blue bubble + purple bubble + green final all identical.

- [ ] **Step 4: Commit**

```bash
git add frontend/app.js
git commit -m "refactor(frontend): extract shared BUBBLE helpers from tab4 renderer"
```

---

### Task 6: Frontend — relay plumbing for tabs 5/6

**Files:**
- Modify: `frontend/app.js` — `PANEL_TO_TAB`/`TAB_TO_PANEL` (~line 144), `connectEvents` dispatcher switch (~line 200), panel init block (`PLACEHOLDER_PANELS`, ~line 751)

**Interfaces:**
- Produces: dispatcher cases routing to optional panel callbacks — `onIndex`, `onToolsExposed`, `onSent`, `onReceived`, `onTurn`, `onSkillLoaded`, `onL3Loaded`, `onToolResult`, `onProtocol` (Tasks 7/8 implement them in `PANELS["5"]`/`PANELS["6"]`).

- [ ] **Step 1: Maps**

```js
const PANEL_TO_TAB = { basic: "1", advanced: "2", reasoning: "3", agent: "4", skill: "5", mcp: "6" };
const TAB_TO_PANEL = { "1": "basic", "2": "advanced", "3": "reasoning", "4": "agent", "5": "skill", "6": "mcp" };
```

(Match the actual current declaration shape — if they're built by inversion, just add the skill/mcp entries to the source map.)

- [ ] **Step 2: Dispatcher cases** — in `connectEvents`' switch, after the `turn_complete` case add:

```js
      case "index":          active && active.onIndex && active.onIndex(f); break;
      case "tools_exposed":  active && active.onToolsExposed && active.onToolsExposed(f); break;
      case "sent":           active && active.onSent && active.onSent(f); break;
      case "received":       active && active.onReceived && active.onReceived(f); break;
      case "turn":           active && active.onTurn && active.onTurn(f); break;
      case "skill_loaded":   active && active.onSkillLoaded && active.onSkillLoaded(f); break;
      case "l3_loaded":      active && active.onL3Loaded && active.onL3Loaded(f); break;
      case "tool_result":    active && active.onToolResult && active.onToolResult(f); break;
      case "protocol":       active && active.onProtocol && active.onProtocol(f); break;
```

- [ ] **Step 3: Panel init** — replace the placeholder wiring:

```js
const PLACEHOLDER_PANELS = new Set();
document.querySelectorAll(".tab-panel").forEach((panel) => {
  const id = panel.dataset.panel;
  if (PLACEHOLDER_PANELS.has(id)) return;
  if (id === "agent") setupAgent(panel);
  else if (id === "skill") setupSkillTab(panel);
  else if (id === "mcp") setupMcpTab(panel);
  else setupPanel(panel);
});
```

Add temporary stubs so this parses until Tasks 7/8 land (they replace them):

```js
function setupSkillTab(panel) { /* Task 7 */ }
function setupMcpTab(panel) { /* Task 8 */ }
```

Delete the old `setupSkill` function and the `SKILL_BACKEND_URL` constant in the same task (it referenced the removed `/skill-agent` endpoint).

- [ ] **Step 4: Check + commit**

```bash
node --check frontend/app.js
git add frontend/app.js
git commit -m "feat(frontend): relay plumbing for tabs 5/6 (maps, dispatcher, init)"
```

(The page is transiently degraded — tab ⑤ shows nothing on drive — acceptable mid-branch; Tasks 7/8 complete it.)

---

### Task 7: Tab ⑤ — HTML panels (both langs), I18N, `setupSkillTab`

**Files:**
- Modify: `frontend/index.zh-TW.html` — replace the `<main ... data-panel="skill">…</main>` inner content
- Modify: `frontend/index.html` — same, English strings
- Modify: `frontend/app.js` — `I18N` additions + real `setupSkillTab`
- Modify: both HTML `tailwind.config` `colors`: add `inject: 'oklch(60% 0.14 75)'`, `'inject-tint': 'oklch(96% 0.045 85)'` (amber L2 slot)

**Interfaces:**
- Consumes: BUBBLE helpers (Task 5), dispatcher callbacks (Task 6), frames from Task 3/4.
- Produces: `PANELS["5"]` registration.

- [ ] **Step 1: HTML panel** (zh-TW; EN mirrors with translated static strings). Replace skill panel content with:

```html
    <div class="panel-header mb-6">
      <h2 class="text-xl font-semibold text-ink">⑤ Skill — 按需載入的能力包</h2>
      <p class="text-sm text-muted mt-1">L1 索引常駐 → 需要才載入 L2 說明書 → L3 腳本只回結果、code 不進 context</p>
    </div>
    <div class="lg:grid lg:grid-cols-[1fr_2fr] lg:gap-6 space-y-6 lg:space-y-0">
      <section class="space-y-4">
        <div>
          <label for="prompt-skill" class="block text-sm font-medium text-ink-soft mb-1.5">問題</label>
          <div class="relative">
            <textarea class="prompt w-full rounded-lg shadow-[0_1px_3px_oklch(20%_0.012_280_/_0.06)] border border-edge bg-surface px-3 py-2 pr-12 text-sm font-mono resize-none focus:outline-none focus:border-final focus:ring-1 focus:ring-final" id="prompt-skill" rows="3" placeholder="例:台北今天天氣怎樣?"></textarea>
            <button class="run absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full bg-ink text-surface flex items-center justify-center hover:bg-ink-soft disabled:bg-faint transition-colors" aria-label="送出 / 停止"><svg class="icon-send" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3M4 7l4-4 4 4"/></svg><svg class="icon-stop" width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="10" rx="2"/></svg></button>
          </div>
          <label class="mt-2 flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
            <input type="checkbox" class="no-skills-toggle rounded border-edge">
            無 skill 對照(拿掉索引再跑同一句)
          </label>
        </div>
        <div>
          <h3 class="text-xs uppercase tracking-wider text-muted font-medium mb-2">Skill 索引(L1 — model 看到的全部)</h3>
          <div class="skill-token-chip hidden rounded-md bg-surface-2 border border-edge-soft px-3 py-2 text-xs text-ink-soft mb-2"></div>
          <div class="skill-index text-sm text-muted">(還沒跑 — model 目前什麼 skill 都沒看到)</div>
        </div>
      </section>
      <section class="turns-area space-y-3">
        <h2 class="text-xs uppercase tracking-wider text-muted font-medium">代理跑的軌跡</h2>
        <div class="flex justify-between text-xs text-ink-soft">
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-final" aria-hidden="true"></span>模型</span>
          <span class="flex items-center gap-1.5">工具(你的電腦)<span class="w-2.5 h-2.5 rounded-full bg-tool" aria-hidden="true"></span></span>
        </div>
        <div class="turns space-y-3"></div>
      </section>
    </div>
```

English static strings for `index.html`: title "⑤ Skill — capability packs loaded on demand", subtitle "L1 index always present → L2 manual loaded when needed → L3 scripts return output only, code never enters context", placeholder "e.g. What's the weather in Taipei?", toggle "No-skill contrast (re-run without the index)", index heading "Skill index (L1 — everything the model sees)", empty text "(not run yet — the model has seen no skills)", trace heading "Agent trace", legend "Model" / "Tools (your PC)".

- [ ] **Step 2: I18N additions** (app.js — add keys):

```js
  l2_injected_label: {
    'en':    'SKILL.md body injected into context',
    'zh-TW': 'SKILL.md body 注入 context',
  },
  l2_injected_sub: {
    'en':    'the L2 manual now reweights everything that follows',
    'zh-TW': 'L2 說明書進來了,接下來每一步都被它改寫機率',
  },
  l2_body_summary: {
    'en':    'The injected SKILL.md body',
    'zh-TW': '注入的 SKILL.md body 內容',
  },
  context_chip: {
    'en':    'context: {n} tokens ({delta})',
    'zh-TW': 'context: {n} tokens({delta})',
  },
  token_cost_chip: {
    'en':    'Progressive loading: ~{proper} tokens now vs ~{naive} if everything were stuffed into the system prompt',
    'zh-TW': '漸進式載入 ~{proper} tokens;全塞進 system prompt 要 ~{naive} tokens',
  },
  script_source_summary: {
    'en':    'The script source (you can read it — the model never does)',
    'zh-TW': '腳本原始碼(你看得到,model 從頭到尾沒看過)',
  },
  skill_read_file_label: {
    'en':    'Tool · read_skill_file',
    'zh-TW': '工具 · read_skill_file',
  },
  no_l3_badge: {
    'en':    '💻 runs on your PC · code never enters context',
    'zh-TW': '💻 在你電腦執行 · code 不進 context',
  },
  skill_index_empty: {
    'en':    '(not run yet — the model has seen no skills)',
    'zh-TW': '(還沒跑 — model 目前什麼 skill 都沒看到)',
  },
  no_skills_run_note: {
    'en':    'no-skill run: the index is empty, the model is on its own',
    'zh-TW': '無 skill 對照:索引是空的,model 只能靠自己',
  },
```

- [ ] **Step 3: `setupSkillTab`** (replaces Task 6's stub):

```js
function setupSkillTab(panel) {
  const promptEl = panel.querySelector(".prompt");
  const runBtn   = panel.querySelector(".run");
  const turnsEl  = panel.querySelector(".turns");
  const indexEl  = panel.querySelector(".skill-index");
  const chipEl   = panel.querySelector(".skill-token-chip");
  const noSkillsToggle = panel.querySelector(".no-skills-toggle");

  let turns = [];               // {hadTool} for the banner
  let lastPromptTokens = null;  // context-chip delta
  let scriptSources = {};
  let finalDone = false;

  function clearAll() {
    turns = []; lastPromptTokens = null; finalDone = false;
    turnsEl.innerHTML = "";
  }

  function contextChip(usage) {
    if (!usage || usage.prompt_tokens == null) return null;
    const n = usage.prompt_tokens;
    const delta = lastPromptTokens == null ? "—" : `+${n - lastPromptTokens}`;
    lastPromptTokens = n;
    return t('context_chip', { n, delta });
  }

  function onIndex(f) {
    scriptSources = f.script_sources || {};
    chipEl.classList.remove("hidden");
    chipEl.textContent = t('token_cost_chip',
      { proper: f.proper_tokens_est, naive: f.naive_tokens_est });
    indexEl.innerHTML = "";
    if (!f.skills.length) {
      indexEl.textContent = t('no_skills_run_note');
      return;
    }
    indexEl.className = "skill-index divide-y divide-edge-soft";
    for (const s of f.skills) {
      const card = document.createElement("div");
      card.className = "py-3 text-xs space-y-1";
      const name = document.createElement("div");
      name.className = "font-medium text-ink-soft text-sm";
      name.textContent = s.name;
      const desc = document.createElement("div");
      desc.className = "text-muted leading-relaxed";
      desc.textContent = s.description;
      const files = document.createElement("div");
      files.className = "text-faint text-[10px] font-mono";
      files.textContent = `${s.dir}/  ${[...(s.extras || []), ...(s.scripts || []).map((x) => "scripts/" + x)].join(" · ")}`;
      card.append(name, desc, files);
      indexEl.appendChild(card);
    }
  }

  function onTurn(f) {
    const hasCalls = (f.tool_calls || []).length > 0;
    turns.push({ hadTool: hasCalls });
    if (!hasCalls) return;   // content-only turn renders at `final`
    const lines = f.tool_calls.map((tc) => {
      const a = (tc.args || "").trim();
      return `⟨tool_call⟩ ${tc.name}(${a === "{}" ? "" : a})`;
    });
    const { row } = BUBBLE.model({
      label: t('model_round_label', { n: f.turn }),
      lines,
      caption: t('calls_tool_caption'),
      chip: contextChip(f.usage),
    });
    row.dataset.turn = String(f.turn);
    turnsEl.appendChild(row);
  }

  function onReceived(f) {
    const row = turnsEl.querySelector(`[data-turn="${f.turn}"]`);
    if (!row) return;
    row.appendChild(BUBBLE.details(t('received_summary'),
      BUBBLE.pre(JSON.stringify(f.response, null, 2))));
  }

  function onSkillLoaded(f) {
    const block = document.createElement("div");
    block.className = "rounded-lg bg-inject-tint border border-inject/25 px-4 py-3";
    const head = document.createElement("div");
    head.className = "text-sm font-semibold text-inject";
    head.textContent = `📥 ${t('l2_injected_label')} — ${f.name}`;
    const sub = document.createElement("div");
    sub.className = "text-xs text-muted mt-0.5";
    sub.textContent = t('l2_injected_sub');
    block.append(head, sub);
    block.appendChild(BUBBLE.details(t('l2_body_summary'), BUBBLE.pre(f.body)));
    turnsEl.appendChild(block);
  }

  function onL3Loaded(f) {
    const isScript = f.kind === "script_output";
    const { row } = BUBBLE.tool({
      label: isScript ? t('tool_bubble_label', { name: f.filename }) : t('skill_read_file_label'),
      badge: isScript ? t('no_l3_badge') : null,
      body: `${t('tool_returns')} ${f.content}`,
      caption: t('feeds_back_caption'),
    });
    if (isScript) {
      const key = `${f.skill}/${f.filename.replace(/^scripts\//, "")}`;
      if (scriptSources[key]) {
        row.appendChild(BUBBLE.details(t('script_source_summary'), BUBBLE.pre(scriptSources[key])));
      }
    }
    turnsEl.appendChild(row);
  }

  function onToolResult(f) {
    const errBox = document.createElement("div");
    errBox.className = BUBBLE.tw.errorBox;
    errBox.textContent = `[error] ${f.result}`;
    turnsEl.appendChild(errBox);
  }

  function onFinal(f) {
    if (!finalDone) {
      turnsEl.appendChild(BUBBLE.finalBlock({ caption: t('to_user_caption'), content: f.content }));
      const rounds = turns.length;
      const trips = turns.filter((x) => x.hadTool).length;
      if (rounds) turnsEl.prepend(BUBBLE.banner(
        trips === 0 ? t('trace_summary_notool') : t('trace_summary', { trips, rounds })));
      finalDone = true;
    }
    setRunning(false);
  }

  let running = false;
  function setRunning(on) { running = on; runBtn.classList.toggle("running", on); }

  PANELS["5"] = {
    onDriveStart: (f) => {
      clearAll(); setRunning(true);
      if (f.user != null) promptEl.value = f.user;
      noSkillsToggle.checked = f.mode === "no_skills";
    },
    onIndex, onTurn, onReceived, onSkillLoaded, onL3Loaded, onToolResult,
    onFinal,
    onError: (f) => {
      const errBox = document.createElement("div");
      errBox.className = BUBBLE.tw.errorBox;
      errBox.textContent = `[error] ${f.message}`;
      turnsEl.appendChild(errBox);
      setRunning(false);
    },
  };

  function driveSkill() {
    if (!promptEl.value.trim()) return;
    setRunning(true);
    postDrive({ tab: "5", user: promptEl.value,
                mode: noSkillsToggle.checked ? "no_skills" : "proper" })
      .then((r) => { if (!r || !r.ok) setRunning(false); });
  }
  runBtn.addEventListener("click", () => {
    if (running) { postStop(); setRunning(false); }
    else driveSkill();
  });
  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && promptEl.value.trim() && !running) driveSkill();
  });
}
```

Note `final` events with an empty green bubble double as re-enable (terminal-final invariant); `finalDone` guards double-render when a content-only `turn` preceded `final`.

- [ ] **Step 4: Tailwind color slot** — in BOTH HTML files' `tailwind.config` `colors`, after `'final-tint'`:

```js
            inject:        'oklch(60% 0.14 75)',   // amber — L2 注入時刻
            'inject-tint': 'oklch(96% 0.045 85)',
```

- [ ] **Step 5: Verify live**

```bash
node --check frontend/app.js
curl -s -X POST http://localhost:9000/drive -H "Content-Type: application/json" -d '{"tab":"5","user":"台北今天天氣怎樣?"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['final'], len(d['turns']))"
```

Then playwright: load `http://localhost:9000/`, drive tab 5, screenshot — expect: index cards populated, token chip, blue load_skill bubble with context chip, amber L2 block, purple script bubble with source expander, green final `台北:28°C, 晴`, banner. Re-run with the toggle (`mode:"no_skills"`) — empty index note + green final only.

- [ ] **Step 6: Commit**

```bash
git add frontend/app.js frontend/index.html frontend/index.zh-TW.html
git commit -m "feat(tab5): skill demo — bubble flow, L2 injection block, context chips"
```

---

### Task 8: Tab ⑥ — HTML panels, I18N, `setupMcpTab`, cache bump

**Files:**
- Modify: `frontend/index.zh-TW.html` + `frontend/index.html` — replace `<main ... data-panel="mcp">` content (keep the old article text — move it into a `<details>`); bump `app.js?v=79` → `?v=80` in both
- Modify: `frontend/app.js` — I18N + real `setupMcpTab`

**Interfaces:**
- Consumes: BUBBLE helpers, dispatcher, `protocol`/`turn_complete` frames (Task 2 shapes).
- Produces: `PANELS["6"]`.

- [ ] **Step 1: HTML panel** (zh-TW; EN mirrors). Structure — preserve the ENTIRE old `<article>` inner content by moving it verbatim inside the trailing `<details>`:

```html
    <div class="panel-header mb-6">
      <h2 class="text-xl font-semibold text-ink">⑥ MCP — 工具不必寫死在 client 裡</h2>
      <p class="text-sm text-muted mt-1">一個外部 process 用協定告訴 client 它有什麼工具;client 是「問」出來的,不是寫死的。</p>
    </div>
    <div class="space-y-6">
      <section class="prompt-area space-y-3 max-w-2xl">
        <label for="prompt-mcp" class="block text-sm font-medium text-ink-soft">問題</label>
        <div class="relative">
          <textarea class="prompt w-full rounded-lg shadow-[0_1px_3px_oklch(20%_0.012_280_/_0.06)] border border-edge bg-surface px-3 py-2 pr-12 text-sm font-mono resize-none focus:outline-none focus:border-final focus:ring-1 focus:ring-final" id="prompt-mcp" rows="3" placeholder="例:現在幾點?台北天氣如何?"></textarea>
          <button class="run absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full bg-ink text-surface flex items-center justify-center hover:bg-ink-soft disabled:bg-faint transition-colors" aria-label="送出 / 停止"><svg class="icon-send" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3M4 7l4-4 4 4"/></svg><svg class="icon-stop" width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="10" rx="2"/></svg></button>
        </div>
      </section>
      <section class="handshake-area space-y-2">
        <h3 class="text-xs uppercase tracking-wider text-muted font-medium">握手 — client 啟動時才發現工具</h3>
        <div class="handshake space-y-2 text-sm text-muted">(還沒跑 — 送出一句話,看 client 跟 MCP server 的第一次對話)</div>
      </section>
      <section class="turns-area space-y-3">
        <h2 class="text-xs uppercase tracking-wider text-muted font-medium">代理跑的軌跡</h2>
        <div class="flex justify-between text-xs text-ink-soft">
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-final" aria-hidden="true"></span>模型</span>
          <span class="flex items-center gap-1.5">協定幀(JSON-RPC)<span class="w-2.5 h-2.5 rounded-full border border-edge bg-surface-2" aria-hidden="true"></span></span>
          <span class="flex items-center gap-1.5">工具(外部 process)<span class="w-2.5 h-2.5 rounded-full bg-tool" aria-hidden="true"></span></span>
        </div>
        <div class="turns space-y-3"></div>
      </section>
      <details class="mt-8">
        <summary class="cursor-pointer text-sm text-muted hover:text-ink-soft">📖 完整文章:MCP 是什麼、為什麼需要它</summary>
        <article class="max-w-3xl space-y-10 text-ink-soft leading-relaxed mt-4">
          <!-- 舊 ⑥ article 內容原封不動搬進來 -->
        </article>
      </details>
    </div>
```

EN static strings: "⑥ MCP — tools don't have to live in the client", subtitle "An external process tells the client what tools it has, over a protocol; the client asks — nothing is hard-coded.", handshake heading "Handshake — the client discovers tools at startup", empty text "(not run yet — send a question to watch the client's first conversation with the MCP server)", legend third entry "Protocol frames (JSON-RPC)" / "Tools (external process)", article summary "📖 Full article: what MCP is and why".

- [ ] **Step 2: I18N additions**:

```js
  protocol_card_req: { 'en': '→ request',  'zh-TW': '→ 請求' },
  protocol_card_resp:{ 'en': '← response', 'zh-TW': '← 回應' },
  protocol_expand:   { 'en': 'Full JSON-RPC frames', 'zh-TW': '完整 JSON-RPC 內容' },
  mcp_exec_badge: {
    'en':    '🔌 runs in the external process',
    'zh-TW': '🔌 在外部 process 執行',
  },
  handshake_empty: {
    'en':    '(not run yet)',
    'zh-TW': '(還沒跑)',
  },
```

- [ ] **Step 3: `setupMcpTab`** (replaces Task 6 stub):

```js
function setupMcpTab(panel) {
  const promptEl    = panel.querySelector(".prompt");
  const runBtn      = panel.querySelector(".run");
  const turnsEl     = panel.querySelector(".turns");
  const handshakeEl = panel.querySelector(".handshake");

  let turns = [];
  let finalDone = false;

  function protocolCard(f) {
    const card = document.createElement("div");
    card.className = "rounded-md bg-surface-2 border border-edge px-3 py-2 font-mono text-xs text-ink-soft";
    const title = document.createElement("div");
    title.className = "font-semibold text-ink";
    title.textContent = f.method;
    const req = document.createElement("div");
    req.className = "truncate";
    req.textContent = `${t('protocol_card_req')} ${JSON.stringify(f.request)}`;
    card.append(title, req);
    if (f.response) {
      const resp = document.createElement("div");
      resp.className = "truncate";
      resp.textContent = `${t('protocol_card_resp')} ${JSON.stringify(f.response)}`;
      card.appendChild(resp);
    }
    card.appendChild(BUBBLE.details(t('protocol_expand'),
      BUBBLE.pre(JSON.stringify({ request: f.request, response: f.response }, null, 2))));
    return card;
  }

  function onProtocol(f) {
    if (f.phase === "handshake") {
      if (handshakeEl.dataset.filled !== "1") {
        handshakeEl.innerHTML = "";
        handshakeEl.dataset.filled = "1";
      }
      handshakeEl.appendChild(protocolCard(f));
    } else {
      turnsEl.appendChild(protocolCard(f));   // interleaves after the blue bubble
    }
  }

  function onTurnComplete(f) {
    const hasCalls = (f.tool_calls || []).length > 0;
    turns.push({ hadTool: hasCalls });
    if (hasCalls) {
      const lines = f.tool_calls.map((tc) => {
        const a = (tc.args || "").trim();
        return `⟨tool_call⟩ ${tc.name}(${a === "{}" ? "" : a})`;
      });
      const { row } = BUBBLE.model({
        label: t('model_round_label', { n: f.turn }),
        lines,
        caption: t('calls_tool_caption'),
      });
      if (f.received_chunk) {
        row.appendChild(BUBBLE.details(t('received_summary'), BUBBLE.pre(f.received_chunk)));
      }
      // protocol cards for this turn already streamed in BEFORE turn_complete —
      // move them below the model bubble for reading order
      const pending = turnsEl.querySelectorAll(":scope > .rounded-md.font-mono, :scope > div[data-proto]");
      turnsEl.appendChild(row);
      // (acceptable simplification: cards arrive before the bubble; visual
      // order = cards then bubble then results. If reading order matters
      // more, buffer cards in onProtocol and flush here instead.)
      (f.tool_results || []).forEach((tr, i) => {
        const raw = (tr.result_text || "").trim();
        const looksJson = raw.startsWith("{") || raw.startsWith("[");
        const { row: tRow } = BUBBLE.tool({
          label: t('tool_bubble_label', { name: tr.name }),
          badge: t('mcp_exec_badge'),
          body: `${t('tool_returns')} ${looksJson ? raw : JSON.stringify(raw)}`,
          caption: t('feeds_back_caption'),
        });
        if (f.next_prompt && i === f.tool_results.length - 1) {
          tRow.appendChild(BUBBLE.details(t('next_prompt_summary', { turn: f.turn }), BUBBLE.pre(f.next_prompt)));
        }
        turnsEl.appendChild(tRow);
      });
    } else {
      finalDone = true;
      turnsEl.appendChild(BUBBLE.finalBlock({ caption: t('to_user_caption'), content: f.content }));
    }
  }

  function onFinal(f) {
    if (!finalDone && f.content) {
      turnsEl.appendChild(BUBBLE.finalBlock({ caption: t('to_user_caption'), content: f.content }));
      finalDone = true;
    }
    const rounds = turns.length;
    const trips = turns.filter((x) => x.hadTool).length;
    if (rounds) turnsEl.prepend(BUBBLE.banner(
      trips === 0 ? t('trace_summary_notool') : t('trace_summary', { trips, rounds })));
    setRunning(false);
  }

  let running = false;
  function setRunning(on) { running = on; runBtn.classList.toggle("running", on); }

  PANELS["6"] = {
    onDriveStart: (f) => {
      turns = []; finalDone = false;
      turnsEl.innerHTML = "";
      handshakeEl.innerHTML = "";
      handshakeEl.dataset.filled = "0";
      handshakeEl.textContent = t('handshake_empty');
      setRunning(true);
      if (f.user != null) promptEl.value = f.user;
    },
    onProtocol,
    onTurnComplete,
    onFinal,
    onError: (f) => {
      const errBox = document.createElement("div");
      errBox.className = BUBBLE.tw.errorBox;
      errBox.textContent = `[error] ${f.message}`;
      turnsEl.appendChild(errBox);
      setRunning(false);
    },
  };

  function driveMcp() {
    if (!promptEl.value.trim()) return;
    setRunning(true);
    postDrive({ tab: "6", user: promptEl.value })
      .then((r) => { if (!r || !r.ok) setRunning(false); });
  }
  runBtn.addEventListener("click", () => {
    if (running) { postStop(); setRunning(false); }
    else driveMcp();
  });
  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && promptEl.value.trim() && !running) driveMcp();
  });
}
```

- [ ] **Step 4: Cache bump** — both HTML files: `app.js?v=79` → `app.js?v=80`.

- [ ] **Step 5: Verify live** — `node --check`, then drive tab 6 via curl (`現在幾點?台北天氣如何?`), playwright screenshot: 3 handshake cards, blue bubble(s), tools/call cards, purple result bubbles (16°C 有雨), green final, banner. Check console for errors. Repeat on `/index.html` (English).

- [ ] **Step 6: Commit**

```bash
git add frontend/app.js frontend/index.html frontend/index.zh-TW.html
git commit -m "feat(tab6): mcp demo — handshake cards, protocol frames, bubble flow"
```

---

### Task 9: AGENTS.md / AGENTS.zh-TW.md sync

**Files:**
- Modify: `AGENTS.md` line ~8 (tab inventory) and line ~25 (endpoint list)
- Modify: `AGENTS.zh-TW.md` mirror lines

- [ ] **Step 1:** In `AGENTS.md`, the sentence describing tabs becomes:

```
(tokens/probabilities, chat template, thinking mode, function-calling agent); ⑤ is an
interactive Skill demo (3-layer progressive disclosure); ⑥ is an interactive MCP demo
(real stdio JSON-RPC mini-server) with the article tucked in an expander.
```

And the architecture bullet's endpoint list drops `/skill-agent` (the `/drive` list now covers tabs 1–6). `AGENTS.zh-TW.md` gets the same two edits in Chinese: 「⑤ 是互動式 Skill demo(三層漸進式揭露);⑥ 是互動式 MCP demo(真 stdio JSON-RPC 迷你 server),文章收在展開段」.

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md AGENTS.zh-TW.md
git commit -m "docs(agents): tab 5/6 now interactive demos; drop /skill-agent"
```

---

### Task 10: Lessons 5 & 6 (bilingual) + teaching index

**Files:**
- Create: `teaching/lesson-5-skill.zh-TW.md`, `teaching/lesson-5-skill.md`
- Create: `teaching/lesson-6-mcp.zh-TW.md`, `teaching/lesson-6-mcp.md`
- Modify: `teaching/README.zh-TW.md` + `teaching/README.md` (add lessons 5/6 to the flow list)

**Interfaces:**
- Consumes: `/drive` aggregates from Task 4 (lessons read `final`/`turns` directly).

- [ ] **Step 1: Write `teaching/lesson-5-skill.zh-TW.md`** (canonical; the `.md` is a faithful English mirror with the same structure — translate, don't paraphrase):

````markdown
# Lesson 5 — Tab ⑤ Skill:context 決定答案,skill 就是按需注入的 context

> English: [lesson-5-skill.md](./lesson-5-skill.md)

## 學習目標
1. 體感「context 直接改機率分佈」:塞進 prompt 的東西會翻轉答案
2. 知道 skill = L1 索引常駐 + L2 說明書按需注入 + L3 腳本只回結果
3. 看懂 context 計數:注入了多少、為什麼不整包塞

## 開場(不問答,直接帶入 demo)

一句話帶過:第一課看過「分佈」;這課先看 context 怎麼「改」分佈,再看 skill
怎麼把「改分佈」變成可管理的能力包。

## Demo 段落

### 段落 1 — context 翻轉答案(Tab ①,三段連發)
- 驅動:`POST /drive {"tab":"1","user":"1+1="}` → top-1「2」約 86%
- 驅動:`POST /drive {"tab":"1","user":"1+1=3。那麼 1+1="}` → top-1 還是「2」,
  但「3」從 0% 升到約 28% — 一句假話就把分佈拉歪了
- 驅動:`POST /drive {"tab":"1","user":"1+1=3。1+1=3。1+1="}` → top-1 翻成「3」
  (約 87%)— 餵夠了,答案整個翻過去
- 旁白:context 不是「參考資料」,是直接改每一步的機率;錯的 context 會拿到
  錯的答案,對的 context(你公司的 SOP、規則)就是這樣讓答案變對的

### 段落 2 — skill:把「注入 context」變成能力包(Tab ⑤)
- 預告:「model 一開始只看得到左邊的索引(L1,~幾十 token)。看它自己決定
  要載入哪包、載入瞬間 context 計數怎麼跳。」
- 驅動:`POST /drive {"tab":"5","user":"台北今天天氣怎樣?"}`(第一次會 swap 4B,banner 3-5 秒)
- 讀回應:藍色泡泡 `⟨tool_call⟩ load_skill("check_weather")` → 琥珀色塊
  「SKILL.md body 注入 context」(context 計數跳一截)→ 藍色泡泡呼叫
  `run_skill_script` → 紫色泡泡回 `{"city":"台北","temp_c":28,...}`(code 沒進
  context,只有輸出)→ 綠色「台北:28°C, 晴」— 格式是 SKILL.md 規定的
- 點深看:展開琥珀塊看注入的說明書全文;展開紫色泡泡下的「腳本原始碼」—
  你看得到,model 從頭到尾沒看過

## 學員動手 — 無 skill 對照
勾選「無 skill 對照」,同一句再送一次:索引是空的,model 只能靠自己編
(或老實說不知道)。對照:同一個 model、同一句話,**差別是有沒有 skill**。

## 揭曉與回顧
- 回到段落 1:skill 的 L2 注入跟「1+1=3」是同一件事 — 都是把 context 塞進
  prompt 改機率;差別是 skill 是**受控的**注入:誰寫的、載不載、載哪包,
  都看得見
- 左上 token 成本 chip:全塞進 system prompt 要 ~N tokens、漸進式只要 ~M —
  context 影響力大,但 token 也貴,所以按需載入
- 課後預告:工具目前都住在你電腦裡(skill 的腳本、Tab ④ 的 get_time)。
  下一課:工具住在**別人的 process** 裡怎麼辦?→ Lesson 6

## 常見學員問題
- 「skill 跟 Tab ④ 的工具差在哪?」— Tab ④ 工具寫死在 client;skill 多了
  「說明書」層:先注入怎麼做,才照著做,而且能力包可以一直加
- 「L2 注入跟我自己貼 SOP 進聊天框差在哪?」— 本質一樣!skill 就是把「你每
  次手貼」變成「model 自己按需取用」,還帶了可執行的腳本
- 「為什麼 code 不進 context?」— model 不需要看 code,只需要結果;code 進
  context 既花 token 又可能被亂改寫
````

- [ ] **Step 2: Write `teaching/lesson-6-mcp.zh-TW.md`** (canonical):

````markdown
# Lesson 6 — Tab ⑥ MCP:工具不必寫死在 client 裡

> English: [lesson-6-mcp.md](./lesson-6-mcp.md)

## 學習目標
1. 知道 MCP = client 跟外部 process 之間的工具協定(JSON-RPC)
2. 看懂握手:initialize → initialized → tools/list — 工具是「問」出來的
3. 分清三個來源:Tab ④ client 內建 / Tab ⑤ skill 腳本 / Tab ⑥ 外部 process

## 開場(不問答,直接帶入 demo)

一句話帶過:到目前為止,所有工具都住在你電腦、由這個 client 定義。
問題:別人寫好的工具,怎麼接進來?這就是 MCP 要解的。

## Demo 段落

### 段落 1 — 握手:client 事先不知道有什麼工具
- 驅動:`POST /drive {"tab":"6","user":"現在幾點?台北天氣如何?"}`
- 先指「握手」區的三張協定卡:`initialize`(你好,我是 client)→
  `notifications/initialized`(準備好了)→ `tools/list`(你有什麼工具?)
  → 回應列出 get_time、get_weather — **client 是問出來的,不是寫死的**
- 旁白:這三張卡就是 MCP 的核心;下面的每張 `tools/call` 卡,是 model 決定
  用工具時,client 幫它跨 process 打電話

### 段落 2 — 泡泡 + 協定卡交錯讀
- 讀回應:藍色泡泡(model 吐 tool_call)→ 協定卡(tools/call 請求/回應,
  跨 process 的那條線)→ 紫色泡泡(結果餵回模型)→ 重複 → 綠色 final
  融合兩個結果
- 對照 Tab ④:model 端**一模一樣**(吐 tool_call 約定標籤);變的是 client
  拿到 tool_call 之後去哪執行 — 內建 function vs 問外部 process

## 學員動手
自己打一句只需要其中一個工具的問題(例:`現在幾點?`),看 model 只挑
get_time、只有一張 tools/call 卡。工具用不用、用哪個,還是 model 在決定。

## 揭曉與回顧
- 有學員會發現:這裡的台北天氣是 16°C 有雨,上一課的 skill 說 28°C 晴!
  故意的 — 兩個「工具」實作不同、來源不同,答案就不同。**工具從哪來,
  答案就從哪來** — 這也是為什麼接第三方工具要知道它背後是誰
- 三課收線:Tab ④ 工具住在 client(寫死)→ Tab ⑤ skill(本機能力包,按需
  載入說明書+腳本)→ Tab ⑥ MCP(外部 process,協定發現)。全部都是同一招:
  把 context 和工具送到 model 面前;來源不同、信任邊界不同
- 想深入:展開頁尾「完整文章」

## 常見學員問題
- 「MCP server 可以是別人寫的嗎?」— 對,這正是重點;今天的迷你 server 是
  本課自帶的,但換成任何人的 server,握手流程一模一樣
- 「跟 API 有什麼不同?」— API 各家格式各異;MCP 是統一的「工具描述+呼叫」
  協定,client 接一次就能用所有支援的 server
- 「安全嗎?」— 你在協定卡看到了 client 送出去/收回來的一切;信任邊界在
  server 是誰寫的 — 跟裝瀏覽器外掛同一種判斷
````

- [ ] **Step 3: English mirrors** — `lesson-5-skill.md` and `lesson-6-mcp.md`: same headings/structure, `> 中文版:` backlink first line, translate faithfully (keep the drive commands and the verified numbers identical).

- [ ] **Step 4: teaching README index** — add to the lesson list in both `teaching/README.zh-TW.md` and `teaching/README.md`:

```
5. lesson-5-skill — context 翻轉答案 → skill 三層漸進式揭露(Tab ①+⑤)
6. lesson-6-mcp — MCP 握手與跨 process 工具(Tab ⑥)
```

(Match the existing list format in those files — read them first.)

- [ ] **Step 5: Commit**

```bash
git add teaching/lesson-5-skill.zh-TW.md teaching/lesson-5-skill.md teaching/lesson-6-mcp.zh-TW.md teaching/lesson-6-mcp.md teaching/README.zh-TW.md teaching/README.md
git commit -m "docs(teaching): lessons 5 (skill) + 6 (mcp), bilingual"
```

---

### Task 11: End-to-end verification

**Files:** none (verification only; fix-forward anything found, then commit fixes)

- [ ] **Step 1: Full test suite** — `python3 -m pytest agent/tests -q` → all green.
- [ ] **Step 2: Server restart + lesson dry-run** — restart server, then run every drive command from lessons 5/6 in order via curl; assert each returns 200 with non-empty `final` (tab 1 drives return `tokens`).
- [ ] **Step 3: Playwright sweep** — zh page + en page, tabs ⑤ and ⑥, desktop (1280×900) and mobile (500×900): drive each tab once, screenshot, check `read_console_messages`-equivalent for errors (favicon 404 + Tailwind CDN warning are known/allowed).
- [ ] **Step 4: Tab ④ regression** — drive `現在幾點?` on tab 4, confirm bubbles unchanged post-refactor.
- [ ] **Step 5: Stop-button check** — start a tab-5 drive, `POST /stop` mid-run, confirm Send re-enables (final frame arrives) and a fresh drive works after.
- [ ] **Step 6: Commit any fixes** — `git commit -m "fix(tab5/6): e2e polish"` per fix; then push the branch: `git push origin feat/tab5-tab6-finish`.

---

## Self-review notes (done at write time)

- Spec coverage: §3.1→Tasks 1-2, §3.2→Task 4, §3.3→Tasks 5-8, §3.4→Tasks 3/6, §4→Task 10, §5→Tasks 1-4+11, AGENTS sync (I4)→Task 9. Cache bump→Task 8. carryPromptInto already excludes skill/mcp (verified line ~162) — no task needed.
- Type consistency: `BUBBLE.finalBlock({caption, content})` used identically in Tasks 5/7/8; `turn` frame `usage` key shape identical in Tasks 2/3/4/7; `protocol` frame keys identical in Tasks 2/4/8.
- Known simplification (documented in Task 8 code comment): tab-6 protocol cards for a turn stream in before the turn's bubble; visual order is cards→bubble→results. Acceptable; buffer-and-flush noted as the alternative if reading order matters.
