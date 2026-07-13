"""mcp_agent_loop — real mcp_server child + mocked llama."""
import json


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


def _route_iter(responses, prompt="TPL"):
    def route(url, **kw):
        if "apply-template" in str(url):
            return _template_resp(prompt)
        return next(responses)
    return route


def test_handshake_frames_come_first(monkeypatch):
    import agent.mcp_agent as m
    monkeypatch.setattr(m.requests, "post", _route(_llama_resp(content="hi")))
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
    monkeypatch.setattr(m.requests, "post", _route(_llama_resp(content="answer")))
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
    monkeypatch.setattr(m.requests, "post", _route_iter(calls))
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
    monkeypatch.setattr(m.requests, "post", _route(_llama_resp(content="x")))
    gen = m.mcp_agent_loop("q")
    first = next(gen)               # handshake started → child alive
    assert first["type"] == "protocol"
    client = m._LAST_CLIENT         # test hook set by the loop
    assert client.proc.poll() is None
    gen.close()                     # cancel path: drive() breaks out
    client.proc.wait(timeout=5)
    assert client.proc.poll() is not None


def test_turn_complete_carries_templated_sent_prompt(monkeypatch):
    """turn_complete 帶 templated sent_prompt 與 received_chunk(模型自己那則
    原始訊息,JSON 化);不再有 next_prompt。/apply-template POST 不能吃掉
    chat-completions 的 iterator entry(_route 依 url 分流已經處理)。
    template 呼叫要帶握手問來的 tools 與 add_generation_prompt。"""
    import agent.mcp_agent as m

    captured = {}
    def route(url, **kw):
        if "apply-template" in str(url):
            captured["json"] = kw["json"]
            return _template_resp("TPL-6")
        captured["gen"] = kw["json"]        # generation POST 的 body
        return _llama_resp(content="answer")

    monkeypatch.setattr(m.requests, "post", route)
    events = list(m.mcp_agent_loop("hello"))
    turns = [e for e in events if e["type"] == "turn_complete"]

    assert turns[0]["sent_prompt"] == "TPL-6"
    assert "next_prompt" not in turns[0]
    rc = turns[0]["received_chunk"]
    assert rc.startswith("<|im_start|>assistant")
    assert "answer" in rc            # 驗 token 內容
    assert captured["json"]["add_generation_prompt"] is True
    # ⚠️ enable_thinking Critical 的「真」守衛:直接斷言 generation body 有設 kwarg。
    # 不能靠 "<think>" not in rc —— mock 的 logprobs 是從 content 衍生的、根本不吐
    # <think> token,那條不管 kwarg 在不在都會過(空洞)。真正的行為只有瀏覽器
    # 驗收(對真實 llama)看得到,unit 層就用 body 斷言守住 code 有設 kwarg。
    assert captured["gen"]["chat_template_kwargs"] == {"enable_thinking": False}
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


def test_mcp_agent_loop_sent_prompt_templates_pre_call_messages(monkeypatch):
    """turn 1 的 template 只帶 system+user;turn 2 的 template 帶 accumulated
    assistant(tool_call)+tool 結果 —— 證明 /apply-template 是 pre-call 呼叫,
    不是 append 之後才算。mirror agent/tests/test_server.py 同名測試。"""
    import agent.mcp_agent as m

    captured = []
    calls = iter([
        _llama_resp(tool_calls=[{"id": "c1", "type": "function",
                                 "function": {"name": "get_weather",
                                              "arguments": '{"city": "台北"}'}}]),
        _llama_resp(content="台北 16°C 有雨"),
    ])

    def route(url, **kw):
        if "apply-template" in str(url):
            # snapshot: mcp_agent_loop keeps appending to the same messages
            # list across turns, so without copying here every captured
            # entry would alias the final accumulated state.
            captured.append({**kw["json"], "messages": list(kw["json"]["messages"])})
            return _template_resp("TPL")
        return next(calls)

    monkeypatch.setattr(m.requests, "post", route)
    events = list(m.mcp_agent_loop("台北天氣?"))

    # turn 1:只有 system + user
    assert [msg["role"] for msg in captured[0]["messages"]] == ["system", "user"]
    # turn 2:accumulated — assistant(tool_call) + tool result 都進來了
    assert [msg["role"] for msg in captured[1]["messages"]] == [
        "system", "user", "assistant", "tool"]
    # add_generation_prompt 必須帶,否則算出來的不是「要送出的」prompt
    assert captured[0]["add_generation_prompt"] is True
    assert captured[1]["add_generation_prompt"] is True
    assert [t["function"]["name"] for t in captured[0]["tools"]] == [
        "get_time", "get_weather"]

    assert events[-1]["type"] == "final"
