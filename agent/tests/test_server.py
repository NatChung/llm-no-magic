"""Unit tests for V2 Agent web backend (server.py)."""
import json


def test_sse_encodes_event_as_bytes():
    from agent.server import sse
    out = sse({"type": "final", "content": "hi"})
    assert isinstance(out, bytes)
    assert out.endswith(b"\n\n")
    assert out.startswith(b"data: ")
    payload = json.loads(out[len(b"data: "): -len(b"\n\n")])
    assert payload == {"type": "final", "content": "hi"}


import threading
import urllib.request


def _start_server_in_thread():
    """Spin up server on OS-assigned port(避免測試 port collision)。Returns (srv, port)。"""
    from http.server import ThreadingHTTPServer
    from agent.server import AgentHandler
    srv = ThreadingHTTPServer(("127.0.0.1", 0), AgentHandler)  # port 0 = OS picks
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    # ThreadingHTTPServer is ready to accept immediately after bind+listen — no sleep needed
    return srv, port


def test_options_returns_204_with_cors_headers():
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/agent", method="OPTIONS"
        )
        resp = urllib.request.urlopen(req, timeout=2)
        assert resp.status == 204
        assert resp.getheader("Access-Control-Allow-Origin") == "*"
        assert "POST" in resp.getheader("Access-Control-Allow-Methods")
        assert "Content-Type" in resp.getheader("Access-Control-Allow-Headers")
    finally:
        srv.shutdown()


def test_post_wrong_path_returns_404():
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/nope",
            data=b'{"user":"x"}',
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=2)
            assert False, "should have raised HTTPError 404"
        except urllib.error.HTTPError as e:
            assert e.code == 404
            assert e.headers["Access-Control-Allow-Origin"] == "*"
    finally:
        srv.shutdown()


from unittest.mock import MagicMock


def _mock_llama_resp(content="ok", tool_calls=None, logprobs_content=None):
    m = MagicMock()
    m.json.return_value = {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": content,
                "tool_calls": tool_calls,
            },
            "logprobs": {"content": logprobs_content or []},
        }]
    }
    m.raise_for_status = MagicMock()
    return m


def _mock_template_resp(prompt=""):
    """For llama /apply-template — different shape than chat completions."""
    m = MagicMock()
    m.json.return_value = {"prompt": prompt}
    m.raise_for_status = MagicMock()
    return m


def _route_iter(responses):
    """Build a mock requests.post that returns next iter response for chat
    completions, but returns a stub template response for /apply-template
    (so iter isn't consumed by the per-turn template call added in next_prompt)."""
    def route(url, **kw):
        if "apply-template" in str(url):
            return _mock_template_resp(prompt="(stub template)")
        return next(responses)
    return route


def test_agent_loop_no_tools_yields_turn_then_final(monkeypatch):
    """Model 直接回 content,no tool_calls → 1 turn_complete + 1 final。"""
    import agent.server as server

    fake_logprobs = [
        {"token": "Hello", "logprob": -0.1,
         "top_logprobs": [{"token": "Hello", "logprob": -0.1},
                          {"token": "Hi",    "logprob": -2.3}]},
    ]
    monkeypatch.setattr(
        server.requests, "post",
        lambda *a, **kw: _mock_llama_resp(content="Hello!",
                                          logprobs_content=fake_logprobs)
    )

    events = list(server.agent_loop("sys prompt", "say hi"))
    assert len(events) == 2
    assert events[0]["type"] == "turn_complete"
    assert events[0]["turn"] == 1
    assert events[0]["message_tokens"] == fake_logprobs
    assert events[0]["tool_calls"] == []
    assert events[0]["tool_results"] == []
    assert events[1] == {"type": "final", "content": "Hello!"}


def test_do_post_agent_streams_events_via_sse(monkeypatch):
    """End-to-end: POST /agent → SSE body 含 turn_complete + final 兩 frame。"""
    import agent.server as server

    # Mock agent_loop to deterministic 2 events
    monkeypatch.setattr(server, "agent_loop", lambda s, u: iter([
        {"type": "turn_complete", "turn": 1, "message_tokens": [],
         "tool_calls": [], "tool_results": []},
        {"type": "final", "content": "done"},
    ]))

    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/agent",
            data=json.dumps({"system": "", "user": "go"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=5)
        assert resp.status == 200
        assert resp.getheader("Content-Type") == "text/event-stream"
        body = resp.read().decode("utf-8")
        frames = [ln for ln in body.split("\n\n") if ln.startswith("data: ")]
        assert len(frames) == 2
        first  = json.loads(frames[0].removeprefix("data: "))
        second = json.loads(frames[1].removeprefix("data: "))
        assert first["type"]  == "turn_complete"
        assert second["type"] == "final"
        assert second["content"] == "done"
    finally:
        srv.shutdown()


def test_agent_loop_calls_tool_then_returns_final(monkeypatch):
    """Turn 1: model emits tool_call read_file. Turn 2: model returns final."""
    import agent.server as server

    # Sequential mock: first call returns tool_call, second returns content
    responses = iter([
        _mock_llama_resp(
            content=None,
            tool_calls=[{
                "id": "call_1",
                "type": "function",
                "function": {"name": "read_file",
                             "arguments": '{"path": "/tmp/fake.txt"}'},
            }],
            logprobs_content=[
                {"token": "<tool_call>", "logprob": -0.001,
                 "top_logprobs": [{"token": "<tool_call>", "logprob": -0.001}]}
            ],
        ),
        _mock_llama_resp(content="檔案內容是 X。", logprobs_content=[
            {"token": "檔案", "logprob": -0.5,
             "top_logprobs": [{"token": "檔案", "logprob": -0.5}]}
        ]),
    ])
    monkeypatch.setattr(server.requests, "post", _route_iter(responses))
    monkeypatch.setitem(server.TOOLS, "read_file", lambda path: "STUB_CONTENT")

    events = list(server.agent_loop("", "讀檔"))
    assert len(events) == 3
    # Turn 1: tool_call + tool_result populated
    assert events[0]["type"] == "turn_complete"
    assert events[0]["turn"] == 1
    assert events[0]["tool_calls"] == [
        {"name": "read_file", "args": '{"path": "/tmp/fake.txt"}'},
    ]
    assert events[0]["tool_results"] == [
        {"name": "read_file", "result_text": "STUB_CONTENT"},
    ]
    # Turn 2: no tool_calls, final
    assert events[1]["type"] == "turn_complete"
    assert events[1]["turn"] == 2
    assert events[1]["tool_calls"]   == []
    assert events[1]["tool_results"] == []
    assert events[2] == {"type": "final", "content": "檔案內容是 X。"}


def test_agent_loop_max_turns_yields_error(monkeypatch):
    """Model 一直 tool_call 不停 → MAX_TURNS 到了 emit error event。"""
    import agent.server as server

    def infinite_tool(*a, **kw):
        return _mock_llama_resp(
            content=None,
            tool_calls=[{
                "id": "x", "type": "function",
                "function": {"name": "get_time", "arguments": "{}"},
            }],
            logprobs_content=[{"token": "x", "logprob": 0.0, "top_logprobs": []}],
        )

    monkeypatch.setattr(server.requests, "post", infinite_tool)
    monkeypatch.setitem(server.TOOLS, "get_time", lambda: "00:00:00")

    # Force smaller MAX_TURNS for fast test
    monkeypatch.setattr(server, "MAX_TURNS", 2)
    events = list(server.agent_loop("", "loop forever"))
    assert events[-1]["type"] == "error"
    assert "max_turns" in events[-1]["message"]


def test_do_post_handles_requests_exception(monkeypatch):
    """llama-server 不在 → requests.ConnectionError → error event."""
    import agent.server as server

    def boom(*a, **kw):
        raise server.requests.ConnectionError("connection refused")
    monkeypatch.setattr(server.requests, "post", boom)

    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/agent",
            data=b'{"user":"hi"}',
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=2)
        body = resp.read().decode("utf-8")
        frames = [ln for ln in body.split("\n\n") if ln.startswith("data: ")]
        last = json.loads(frames[-1].removeprefix("data: "))
        assert last["type"] == "error"
        assert "connection refused" in last["message"].lower() or \
               "connectionerror" in last["message"].lower()
    finally:
        srv.shutdown()


def test_agent_loop_handles_bad_tool_args_json(monkeypatch):
    """Model 吐錯 tool_call arguments(不是 JSON)→ dispatch_tool_call 用 {} 跑、不 crash。"""
    import agent.server as server

    responses = iter([
        _mock_llama_resp(
            content=None,
            tool_calls=[{
                "id": "x", "type": "function",
                "function": {"name": "get_time", "arguments": "not json {"},
            }],
            logprobs_content=[{"token": "<tool_call>", "logprob": 0.0,
                               "top_logprobs": []}],
        ),
        _mock_llama_resp(content="done", logprobs_content=[]),
    ])
    monkeypatch.setattr(server.requests, "post", _route_iter(responses))
    monkeypatch.setitem(server.TOOLS, "get_time", lambda: "ok")

    events = list(server.agent_loop("", "x"))
    # Should NOT raise — graceful fallback
    assert events[0]["type"] == "turn_complete"
    assert events[0]["tool_results"][0]["result_text"] == "ok"  # called get_time()
    assert events[-1]["type"] == "final"


def test_is_port_free_true_when_no_listener(monkeypatch):
    """Port 沒人 listen → connect_ex 回非 0 → port free。"""
    import agent.server as server
    fake_sock = MagicMock()
    fake_sock.connect_ex.return_value = 111  # ECONNREFUSED
    monkeypatch.setattr(server.socket, "socket", lambda *a, **kw: fake_sock)
    assert server._is_port_free(8080) is True
    fake_sock.close.assert_called_once()


def test_is_port_free_false_when_listener(monkeypatch):
    """Port 有人 listen → connect_ex 回 0 → port busy。"""
    import agent.server as server
    fake_sock = MagicMock()
    fake_sock.connect_ex.return_value = 0  # connection OK = port busy
    monkeypatch.setattr(server.socket, "socket", lambda *a, **kw: fake_sock)
    assert server._is_port_free(8080) is False


def test_detect_model_returns_4B_when_response_contains_tag(monkeypatch):
    """response.text 含 'Qwen3-4B-Q4_K_M' → return '4B'。"""
    import agent.server as server
    m = MagicMock()
    m.ok = True
    m.text = '{"data":[{"id":"Qwen3-4B-Q4_K_M.gguf"}]}'
    monkeypatch.setattr(server.requests, "get", lambda *a, **kw: m)
    assert server._detect_model() == "4B"


def test_detect_model_returns_0_6B_when_response_contains_tag(monkeypatch):
    import agent.server as server
    m = MagicMock()
    m.ok = True
    m.text = '{"data":[{"id":"Qwen3-0.6B-Q4_K_M.gguf"}]}'
    monkeypatch.setattr(server.requests, "get", lambda *a, **kw: m)
    assert server._detect_model() == "0.6B"


def test_detect_model_returns_None_on_connection_error(monkeypatch):
    """llama-server 不在 → 回 None。"""
    import agent.server as server
    def raise_(*a, **kw):
        raise server.requests.ConnectionError("connection refused")
    monkeypatch.setattr(server.requests, "get", raise_)
    assert server._detect_model() is None


def test_detect_model_returns_None_when_response_unknown(monkeypatch):
    """response 不含已知 tag → 回 None。"""
    import agent.server as server
    m = MagicMock()
    m.ok = True
    m.text = '{"data":[{"id":"some-other-model.gguf"}]}'
    monkeypatch.setattr(server.requests, "get", lambda *a, **kw: m)
    assert server._detect_model() is None


def test_handle_swap_unknown_model_returns_error():
    """spec §4:wanted not in MODEL_TAG → error。"""
    import agent.server as server
    result = server.handle_swap("13B")
    assert result["status"] == "error"
    assert "unknown model" in result["message"]
    assert "13B" in result["message"]


def test_handle_swap_concurrent_returns_409():
    """SWAP_LOCK already held → return 409 immediately。"""
    import agent.server as server
    server.SWAP_LOCK.acquire()
    try:
        result = server.handle_swap("4B")
        assert result["status"] == "error"
        assert result.get("code") == 409
        assert "another swap" in result["message"]
    finally:
        server.SWAP_LOCK.release()


def test_handle_swap_noop_when_same_model(monkeypatch):
    """GLOBAL_STATE 已是 wanted → 立刻 return ready+skipped。"""
    import agent.server as server
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "4B")
    result = server.handle_swap("4B")
    assert result == {"status": "ready", "model": "4B", "took_ms": 0, "skipped": True}


def test_handle_swap_happy_path(monkeypatch):
    """Mock subprocess + requests + port check + sleep,跑完 ready。"""
    import agent.server as server

    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")   # 不同於 wanted
    monkeypatch.setitem(server.GLOBAL_STATE, "log_fh", None)
    monkeypatch.setattr(server.subprocess, "run", MagicMock())
    monkeypatch.setattr(server.subprocess, "Popen", MagicMock())
    monkeypatch.setattr(server, "_is_port_free", lambda port: True)
    monkeypatch.setattr(server.time, "sleep", lambda x: None)

    m = MagicMock()
    m.ok = True
    m.text = '{"data":[{"id":"Qwen3-4B-Q4_K_M.gguf"}]}'
    monkeypatch.setattr(server.requests, "get", lambda *a, **kw: m)

    # 避免真的 open file
    fake_fh = MagicMock()
    monkeypatch.setattr("builtins.open", lambda *a, **kw: fake_fh)

    result = server.handle_swap("4B")
    assert result["status"] == "ready"
    assert result["model"] == "4B"
    assert result["skipped"] is False
    assert server.GLOBAL_STATE["model"] == "4B"


def test_handle_swap_port_stays_busy(monkeypatch):
    """pkill 完但 port 還在被佔 → error。"""
    import agent.server as server
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")
    monkeypatch.setitem(server.GLOBAL_STATE, "log_fh", None)
    monkeypatch.setattr(server.subprocess, "run", MagicMock())
    monkeypatch.setattr(server, "_is_port_free", lambda port: False)
    monkeypatch.setattr(server.time, "sleep", lambda x: None)

    result = server.handle_swap("4B")
    assert result["status"] == "error"
    assert "port 8080 still busy" in result["message"]


def test_handle_swap_binary_not_found(monkeypatch):
    """subprocess.Popen 抛 FileNotFoundError → error with 'binary not found'。"""
    import agent.server as server
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")
    monkeypatch.setitem(server.GLOBAL_STATE, "log_fh", None)
    monkeypatch.setattr(server.subprocess, "run", MagicMock())
    monkeypatch.setattr(server, "_is_port_free", lambda port: True)
    monkeypatch.setattr(server.time, "sleep", lambda x: None)

    def raise_fnf(*a, **kw):
        raise FileNotFoundError("[Errno 2] No such file or directory: 'llama-server'")
    monkeypatch.setattr(server.subprocess, "Popen", raise_fnf)

    fake_fh = MagicMock()
    monkeypatch.setattr("builtins.open", lambda *a, **kw: fake_fh)

    result = server.handle_swap("4B")
    assert result["status"] == "error"
    assert "binary not found" in result["message"]
    fake_fh.close.assert_called_once()  # 確認 log file 也 close 了


def test_handle_swap_poll_timeout(monkeypatch):
    """Popen 成功但 model 一直沒 ready → 10s timeout error。"""
    import agent.server as server
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")
    monkeypatch.setitem(server.GLOBAL_STATE, "log_fh", None)
    monkeypatch.setattr(server.subprocess, "run", MagicMock())
    monkeypatch.setattr(server.subprocess, "Popen", MagicMock())
    monkeypatch.setattr(server, "_is_port_free", lambda port: True)
    monkeypatch.setattr(server.time, "sleep", lambda x: None)

    # /v1/models 一直 raise(model loading 中,沒 ready)
    def always_raise(*a, **kw):
        raise server.requests.ConnectionError("loading")
    monkeypatch.setattr(server.requests, "get", always_raise)

    fake_fh = MagicMock()
    monkeypatch.setattr("builtins.open", lambda *a, **kw: fake_fh)

    result = server.handle_swap("4B")
    assert result["status"] == "error"
    assert "timeout" in result["message"]
    assert "4B" in result["message"]


import urllib.error


def test_post_swap_returns_200_on_ready(monkeypatch):
    """End-to-end:POST /swap → handle_swap ready → 200 + JSON body。"""
    import agent.server as server
    monkeypatch.setattr(server, "handle_swap", lambda wanted: {
        "status": "ready", "model": wanted, "took_ms": 1234, "skipped": False,
    })

    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/swap",
            data=json.dumps({"model": "4B"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=2)
        assert resp.status == 200
        body = json.loads(resp.read().decode("utf-8"))
        assert body["status"] == "ready"
        assert body["model"] == "4B"
        assert body["took_ms"] == 1234
        assert resp.getheader("Access-Control-Allow-Origin") == "*"
    finally:
        srv.shutdown()


def test_post_swap_returns_409_on_concurrent(monkeypatch):
    """concurrent swap → 409。"""
    import agent.server as server
    monkeypatch.setattr(server, "handle_swap", lambda wanted: {
        "status": "error", "code": 409, "message": "another swap in progress",
    })

    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/swap",
            data=json.dumps({"model": "4B"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=2)
            assert False, "should have raised HTTPError 409"
        except urllib.error.HTTPError as e:
            assert e.code == 409
            body = json.loads(e.read().decode("utf-8"))
            assert "another swap" in body["message"]
    finally:
        srv.shutdown()


def test_post_swap_returns_500_on_other_error(monkeypatch):
    """timeout / port busy / binary missing → 500。"""
    import agent.server as server
    monkeypatch.setattr(server, "handle_swap", lambda wanted: {
        "status": "error", "message": "llama-server binary not found",
    })

    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/swap",
            data=json.dumps({"model": "4B"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=2)
            assert False, "should have raised HTTPError 500"
        except urllib.error.HTTPError as e:
            assert e.code == 500
            body = json.loads(e.read().decode("utf-8"))
            assert "binary not found" in body["message"]
    finally:
        srv.shutdown()
