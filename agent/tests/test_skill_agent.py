"""skill_agent_loop — mocked llama; usage propagation + sent frame."""


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


def test_no_skills_mode_empty_index(monkeypatch):
    import agent.skill_agent as sa
    monkeypatch.setattr(sa.requests, "post", lambda *a, **kw: _resp(content="guess"))
    events = list(sa.skill_agent_loop("台北天氣?", "no_skills"))
    index = next(e for e in events if e["type"] == "index")
    assert index["skills"] == []
    tools = next(e for e in events if e["type"] == "tools_exposed")
    assert tools["tools"] == []
    assert events[-1] == {"type": "final", "content": "guess"}


def test_read_file_error_yields_tool_result(monkeypatch):
    import agent.skill_agent as sa
    calls = iter([
        _resp(tool_calls=[{"id": "c1", "type": "function",
                           "function": {"name": "read_file",
                                        "arguments": '{"path": "skills/nope/SKILL.md"}'}}]),
        _resp(content="sorry"),
    ])
    monkeypatch.setattr(sa.requests, "post", lambda *a, **kw: next(calls))
    events = list(sa.skill_agent_loop("x", "proper"))
    tr = next(e for e in events if e["type"] == "tool_result")
    assert tr["error"] is True
    assert "不存在" in tr["result"]


def test_read_file_escapes_are_blocked(monkeypatch):
    """路徑越界(../)不能讀出 skills/ 以外的檔案。"""
    import agent.skill_agent as sa
    calls = iter([
        _resp(tool_calls=[{"id": "c1", "type": "function",
                           "function": {"name": "read_file",
                                        "arguments": '{"path": "skills/../agent.py"}'}}]),
        _resp(content="ok"),
    ])
    monkeypatch.setattr(sa.requests, "post", lambda *a, **kw: next(calls))
    events = list(sa.skill_agent_loop("x", "proper"))
    tr = next(e for e in events if e["type"] == "tool_result")
    assert tr["error"] is True


def test_read_skill_md_yields_skill_loaded(monkeypatch):
    """read_file 讀到 SKILL.md → skill_loaded frame(琥珀注入塊的來源)。"""
    import agent.skill_agent as sa
    calls = iter([
        _resp(tool_calls=[{"id": "c1", "type": "function",
                           "function": {"name": "read_file",
                                        "arguments": '{"path": "skills/check_weather/SKILL.md"}'}}]),
        _resp(content="done"),
    ])
    monkeypatch.setattr(sa.requests, "post", lambda *a, **kw: next(calls))
    events = list(sa.skill_agent_loop("台北天氣?", "proper"))
    loaded = next(e for e in events if e["type"] == "skill_loaded")
    assert loaded["name"] == "check_weather"
    assert "name: check_weather" in loaded["body"]  # 原始檔案內容,含 frontmatter


def test_repo_index_is_single_skill():
    """Repo policy (spec 2026-07-08): exactly one skill ships — check_weather."""
    import agent.skill_agent as sa
    index = sa.load_index()
    assert list(index.keys()) == ["check_weather"]
    assert index["check_weather"]["scripts"] == ["weather.py"]


def test_load_index_multi_skill_fixture(tmp_path, monkeypatch):
    """load_index() stays generic: N skill dirs → N entries (fixture, not repo)."""
    import agent.skill_agent as sa
    for name in ("alpha", "beta"):
        d = tmp_path / name
        (d / "scripts").mkdir(parents=True)
        (d / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: {name} desc\n---\nBody of {name}.\n")
        (d / "scripts" / "run.py").write_text("print('hi')\n")
    monkeypatch.setattr(sa, "SKILLS_DIR", tmp_path)
    index = sa.load_index()
    assert set(index.keys()) == {"alpha", "beta"}
    assert index["alpha"]["description"] == "alpha desc"
    assert index["beta"]["scripts"] == ["run.py"]


def test_empty_final_retried_once(monkeypatch):
    """4B 偶發空回應(無 tool call、無內容)→ 原樣重問一次,不塞空訊息進 messages。"""
    import agent.skill_agent as sa
    sent_bodies = []
    calls = iter([_resp(content=""), _resp(content="answer!")])
    def fake_post(url, **kw):
        sent_bodies.append(kw.get("json"))
        return next(calls)
    monkeypatch.setattr(sa.requests, "post", fake_post)
    events = list(sa.skill_agent_loop("hi", "proper"))
    finals = [e for e in events if e["type"] == "final"]
    assert finals == [{"type": "final", "content": "answer!"}]
    # retry 是原樣重問:兩次送出的 messages 一模一樣(空訊息沒被 append)
    assert sent_bodies[0]["messages"] == sent_bodies[1]["messages"]


def test_empty_final_gives_up_after_one_retry(monkeypatch):
    """護欄只重試一次:連兩次空回應 → 第二次照實 yield 空 final(不無限重試)。"""
    import agent.skill_agent as sa
    calls = iter([_resp(content=""), _resp(content="")])
    monkeypatch.setattr(sa.requests, "post", lambda *a, **kw: next(calls))
    events = list(sa.skill_agent_loop("hi", "proper"))
    assert events[-1] == {"type": "final", "content": ""}


def test_skill_anatomy_three_layers():
    import agent.skill_agent as sa
    files = sa.skill_anatomy()
    by_path = {f["path"]: f for f in files}
    fm = by_path["skills/check_weather/SKILL.md#frontmatter"]
    assert fm["layer"] == "L1" and fm["content"].startswith("---")
    assert "name: check_weather" in fm["content"]
    body = by_path["skills/check_weather/SKILL.md#body"]
    assert body["layer"] == "L2" and "---" not in body["content"].splitlines()[0]
    script = by_path["skills/check_weather/scripts/weather.py"]
    assert script["layer"] == "L3" and "def " in script["content"]
