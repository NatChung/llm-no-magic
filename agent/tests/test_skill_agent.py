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
