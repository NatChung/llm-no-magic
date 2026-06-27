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


def test_publish_fans_frame_to_all_subscribers(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    q1 = server.subscribe()
    q2 = server.subscribe()
    assert server.subscriber_count() == 2
    server.publish({"type": "token", "token": "霜"})
    assert q1.get_nowait() == {"type": "token", "token": "霜"}
    assert q2.get_nowait() == {"type": "token", "token": "霜"}


def test_unsubscribe_removes_queue_and_is_idempotent(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    q = server.subscribe()
    assert server.subscriber_count() == 1
    server.unsubscribe(q)
    assert server.subscriber_count() == 0
    server.unsubscribe(q)  # second time must not raise
    assert server.subscriber_count() == 0


def test_publish_with_no_subscribers_is_noop(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    server.publish({"type": "final", "content": "x"})  # must not raise
    assert server.subscriber_count() == 0


def test_health_returns_status_immediately(monkeypatch):
    import agent.server as server
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    srv, port = _start_server_in_thread()
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2)
        assert resp.status == 200
        body = json.loads(resp.read().decode("utf-8"))
        assert body["status"] == "ok"
        assert body["model"] == "0.6B"
        assert body["subscribers"] == 0
    finally:
        srv.shutdown()


def test_events_streams_a_published_frame(monkeypatch):
    import agent.server as server
    import time as _time
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    srv, port = _start_server_in_thread()
    got = {}

    def reader():
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/events", timeout=5)
        got["ctype"] = resp.getheader("Content-Type")
        got["line"] = resp.readline()  # blocks until first frame

    try:
        th = threading.Thread(target=reader, daemon=True)
        th.start()
        # wait until the /events handler registered its queue
        for _ in range(50):
            if server.subscriber_count() == 1:
                break
            _time.sleep(0.05)
        assert server.subscriber_count() == 1
        server.publish({"type": "token", "token": "霜"})
        th.join(timeout=3)
        assert got["ctype"] == "text/event-stream"
        payload = json.loads(got["line"].decode("utf-8").removeprefix("data: "))
        assert payload == {"type": "token", "token": "霜"}
    finally:
        srv.shutdown()


def test_build_prompt_basic_returns_user_verbatim():
    from agent.server import build_completion_prompt
    assert build_completion_prompt("1", "床前明月光,疑是地上") == "床前明月光,疑是地上"


def test_build_prompt_advanced_raw_returns_user_verbatim():
    from agent.server import build_completion_prompt
    assert build_completion_prompt("2", "一年有幾個月?", system="你是行銷顧問", mode="raw") \
        == "一年有幾個月?"


def test_build_prompt_advanced_chat_wraps_system_and_suppresses_think():
    from agent.server import build_completion_prompt
    out = build_completion_prompt("2", "一年有幾個月?", system="你是行銷顧問", mode="chat")
    assert out == (
        "<|im_start|>system\n你是行銷顧問<|im_end|>\n"
        "<|im_start|>user\n一年有幾個月?<|im_end|>\n<|im_start|>assistant\n"
        "<think>\n\n</think>\n\n"
    )


def test_build_prompt_chat_without_system_omits_system_block():
    from agent.server import build_completion_prompt
    out = build_completion_prompt("2", "hi", system="", mode="chat")
    assert out.startswith("<|im_start|>user\nhi<|im_end|>")
    assert "system" not in out


def test_build_prompt_reasoning_direct_suppresses_think():
    from agent.server import build_completion_prompt
    out = build_completion_prompt("3", "蘋果問題", system="", mode="direct")
    assert out.endswith("<|im_start|>assistant\n<think>\n\n</think>\n\n")


def test_build_prompt_reasoning_thinking_leaves_think_open():
    from agent.server import build_completion_prompt
    out = build_completion_prompt("3", "蘋果問題", system="", mode="thinking")
    assert out.endswith("<|im_start|>assistant\n")
    assert "</think>" not in out


class _FakeStreamResp:
    """Mimics requests stream response: .iter_lines() + raise_for_status() + close().

    Faithful to real requests: iter_lines() yields BYTES (the server must decode
    UTF-8 itself; relying on decode_unicode=True mangles CJK on charset-less SSE)."""
    def __init__(self, lines):
        self._lines = lines
        self.closed = False
    def raise_for_status(self):
        pass
    def iter_lines(self):
        for ln in self._lines:
            yield ln
    def close(self):
        self.closed = True


def _llama_stream_lines(steps, stop_text=""):
    """Build llama /completion SSE-style 'data: {...}' lines as UTF-8 BYTES
    (matching real requests.iter_lines())."""
    lines = []
    for tok, lp in steps:
        lines.append(("data: " + json.dumps({
            "completion_probabilities": [
                {"token": tok, "top_logprobs": [{"token": tok, "logprob": lp}]}
            ]
        })).encode("utf-8"))
    lines.append(("data: " + json.dumps({"content": stop_text, "stop": True})).encode("utf-8"))
    return lines


def test_completion_generate_yields_tokens_then_final(monkeypatch):
    import agent.server as server
    server.CANCEL.clear()
    lines = _llama_stream_lines([("霜", -0.06), ("。", -1.2)])
    monkeypatch.setattr(server.requests, "post",
                        lambda *a, **kw: _FakeStreamResp(lines))
    events = list(server.completion_generate("1", "床前明月光,疑是地上"))
    assert events[0] == {"type": "token", "token": "霜",
                         "top_logprobs": [{"token": "霜", "logprob": -0.06}]}
    assert events[1]["type"] == "token" and events[1]["token"] == "。"
    assert events[-1] == {"type": "final", "content": "霜。"}


def test_completion_generate_sets_n_predict_1500_for_reasoning(monkeypatch):
    import agent.server as server
    server.CANCEL.clear()
    captured = {}
    def fake_post(url, json=None, **kw):
        captured["json"] = json
        return _FakeStreamResp(_llama_stream_lines([("x", -0.1)]))
    monkeypatch.setattr(server.requests, "post", fake_post)
    list(server.completion_generate("3", "蘋果問題", mode="thinking"))
    assert captured["json"]["n_predict"] == 1500
    assert captured["json"]["temperature"] == 0
    assert captured["json"]["n_probs"] == 10
    assert captured["json"]["stream"] is True


def test_completion_generate_default_n_predict_80(monkeypatch):
    import agent.server as server
    server.CANCEL.clear()
    captured = {}
    def fake_post(url, json=None, **kw):
        captured["json"] = json
        return _FakeStreamResp(_llama_stream_lines([("x", -0.1)]))
    monkeypatch.setattr(server.requests, "post", fake_post)
    list(server.completion_generate("1", "hi"))
    assert captured["json"]["n_predict"] == 80


def test_completion_generate_cjk_single_char_gets_trailing_space(monkeypatch):
    import agent.server as server
    server.CANCEL.clear()
    captured = {}
    def fake_post(url, json=None, **kw):
        captured["json"] = json
        return _FakeStreamResp(_llama_stream_lines([("x", -0.1)]))
    monkeypatch.setattr(server.requests, "post", fake_post)
    list(server.completion_generate("1", "霜"))
    assert captured["json"]["prompt"] == "霜 "


def test_completion_generate_stops_on_cancel(monkeypatch):
    import agent.server as server
    server.CANCEL.set()  # cancel before any token
    monkeypatch.setattr(server.requests, "post",
                        lambda *a, **kw: _FakeStreamResp(
                            _llama_stream_lines([("a", -0.1), ("b", -0.2)])))
    events = list(server.completion_generate("1", "hi"))
    server.CANCEL.clear()
    # no token events emitted, but a final still closes the stream
    assert [e for e in events if e["type"] == "token"] == []
    assert events[-1]["type"] == "final"


def test_completion_generate_closes_llama_response_on_cancel(monkeypatch):
    """POST /stop -> CANCEL -> completion_generate must close the llama HTTP
    connection (that is what actually aborts llama's in-flight generation)."""
    import agent.server as server
    server.CANCEL.set()
    resp = _FakeStreamResp(_llama_stream_lines([("a", -0.1), ("b", -0.2)]))
    monkeypatch.setattr(server.requests, "post", lambda *a, **kw: resp)
    list(server.completion_generate("1", "hi"))
    server.CANCEL.clear()
    assert resp.closed is True


def test_drive_busy_returns_busy_flag(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    server.GEN_LOCK.acquire()
    try:
        assert server.drive("1", "hi") == {"busy": True}
    finally:
        server.GEN_LOCK.release()


def test_drive_basic_publishes_and_aggregates(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")  # no swap needed
    monkeypatch.setattr(server, "completion_generate",
        lambda tab, user, system="", mode="": iter([
            {"type": "token", "token": "霜",
             "top_logprobs": [{"token": "霜", "logprob": -0.06}]},
            {"type": "final", "content": "霜"},
        ]))
    q = server.subscribe()
    result = server.drive("1", "床前明月光,疑是地上")
    # aggregate for the AI
    assert result["tab"] == "1"
    assert result["final"] == "霜"
    assert result["tokens"][0]["token"] == "霜"
    assert abs(result["tokens"][0]["prob"] - 0.9418) < 0.01  # exp(-0.06)
    assert result["subscribers"] == 1
    # fanned-out frames for the page
    frames = []
    while not q.empty():
        frames.append(q.get_nowait())
    assert frames[0] == {"type": "drive_start", "tab": "1", "mode": "",
                         "user": "床前明月光,疑是地上", "system": ""}
    assert {"type": "token", "token": "霜",
            "top_logprobs": [{"token": "霜", "logprob": -0.06}]} in frames
    assert frames[-1] == {"type": "final", "content": "霜"}


def test_drive_swaps_and_publishes_swap_start(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")  # current
    calls = {}
    def fake_swap(wanted):
        calls["wanted"] = wanted
        server.GLOBAL_STATE["model"] = wanted
        return {"status": "ready", "model": wanted}
    monkeypatch.setattr(server, "handle_swap", fake_swap)
    monkeypatch.setattr(server, "agent_loop",
        lambda s, u: iter([{"type": "final", "content": "現在是 12:00:00"}]))
    q = server.subscribe()
    result = server.drive("4", "現在幾點?")
    assert calls["wanted"] == "4B"  # tab 4 needs 4B
    assert result["final"] == "現在是 12:00:00"
    frames = []
    while not q.empty():
        frames.append(q.get_nowait())
    assert frames[0] == {"type": "swap_start", "tab": "4", "model": "4B"}
    assert {"type": "drive_start", "tab": "4", "mode": "",
            "user": "現在幾點?", "system": ""} in frames


def test_drive_swap_failure_publishes_error(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")
    monkeypatch.setattr(server, "handle_swap",
        lambda wanted: {"status": "error", "message": "port 8080 still busy"})
    q = server.subscribe()
    result = server.drive("4", "現在幾點?")
    assert "port 8080 still busy" in result["error"]
    frames = [q.get_nowait() for _ in range(q.qsize())]
    assert {"type": "error", "message": "port 8080 still busy"} in frames


def test_drive_tab4_agent_error_returns_error(monkeypatch):
    """agent_loop yields an error event (e.g. MAX_TURNS) → drive returns
    {error:...} so the handler maps it to 5xx, not a silent 200."""
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "4B")  # no swap needed
    monkeypatch.setattr(server, "agent_loop",
        lambda s, u: iter([{"type": "error", "message": "max_turns (6) reached"}]))
    result = server.drive("4", "loop forever")
    assert "max_turns" in result["error"]
    assert result.get("final", "") == ""


def test_post_drive_returns_200_with_aggregate(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "drive",
        lambda tab, user, system="", mode="": {
            "subscribers": 1, "tab": tab, "tokens": [], "final": "霜"})
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/drive",
            data=json.dumps({"tab": "1", "user": "床前明月光,疑是地上"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        resp = urllib.request.urlopen(req, timeout=2)
        assert resp.status == 200
        body = json.loads(resp.read().decode("utf-8"))
        assert body["tab"] == "1"
        assert body["final"] == "霜"
    finally:
        srv.shutdown()


def test_post_drive_returns_409_when_busy(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "drive", lambda *a, **kw: {"busy": True})
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/drive",
            data=json.dumps({"tab": "1", "user": "x"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            urllib.request.urlopen(req, timeout=2)
            assert False, "expected 409"
        except urllib.error.HTTPError as e:
            assert e.code == 409
    finally:
        srv.shutdown()


def test_post_drive_returns_500_on_error(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "drive",
        lambda *a, **kw: {"error": "port 8080 still busy", "subscribers": 0})
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/drive",
            data=json.dumps({"tab": "4", "user": "x"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            urllib.request.urlopen(req, timeout=2)
            assert False, "expected 500"
        except urllib.error.HTTPError as e:
            assert e.code == 500
            body = json.loads(e.read().decode("utf-8"))
            assert "port 8080" in body["error"]
    finally:
        srv.shutdown()


def test_post_inspect_publishes_inspect_frame(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    q = server.subscribe()
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/inspect",
            data=json.dumps({"tokenIndex": 3}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        resp = urllib.request.urlopen(req, timeout=2)
        assert resp.status == 200
        body = json.loads(resp.read().decode("utf-8"))
        assert body["ok"] is True
        assert body["subscribers"] == 1
        assert q.get_nowait() == {"type": "inspect", "tokenIndex": 3}
    finally:
        srv.shutdown()


def test_drive_publishes_error_when_generation_raises(monkeypatch):
    """llama down mid-generation: drive must publish an error frame AND return
    {error:...} (→ 500), not propagate a traceback / hang the page."""
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")  # no swap
    def boom(*a, **kw):
        raise server.requests.ConnectionError("llama down")
    monkeypatch.setattr(server, "completion_generate", boom)
    q = server.subscribe()
    result = server.drive("1", "床前明月光,疑是地上")
    assert "llama down" in result["error"]
    frames = [q.get_nowait() for _ in range(q.qsize())]
    assert any(f.get("type") == "error" and "llama down" in f["message"] for f in frames)
    # GEN_LOCK must have been released despite the exception
    assert server.GEN_LOCK.acquire(blocking=False)
    server.GEN_LOCK.release()


def test_post_stop_sets_cancel(monkeypatch):
    import agent.server as server
    server.CANCEL.clear()
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/stop", data=b"{}",
            headers={"Content-Type": "application/json"}, method="POST")
        resp = urllib.request.urlopen(req, timeout=2)
        assert resp.status == 200
        assert json.loads(resp.read().decode("utf-8"))["ok"] is True
        assert server.CANCEL.is_set()
    finally:
        server.CANCEL.clear()
        srv.shutdown()
