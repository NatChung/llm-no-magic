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
