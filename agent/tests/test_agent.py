"""Unit tests for V2 Agent CLI client."""
import re

import pytest

from agent.agent import get_time, read_file, write_file


def test_get_time_returns_hhmmss_string():
    result = get_time()
    # Format HH:MM:SS, all digits
    assert re.match(r"^\d{2}:\d{2}:\d{2}$", result), f"unexpected format: {result!r}"


def test_read_file_returns_content(tmp_path):
    f = tmp_path / "hello.txt"
    f.write_text("Hello, world!\n第二行中文\n", encoding="utf-8")
    assert read_file(str(f)) == "Hello, world!\n第二行中文\n"


def test_read_file_truncates_to_max_chars(tmp_path):
    f = tmp_path / "big.txt"
    f.write_text("x" * 5000, encoding="utf-8")
    assert read_file(str(f), max_chars=100) == "x" * 100


def test_read_file_returns_error_string_for_missing(tmp_path):
    f = tmp_path / "missing.txt"
    result = read_file(str(f))
    assert "error" in result.lower()


def test_write_file_creates_file_with_content(tmp_path):
    f = tmp_path / "out.txt"
    result = write_file(str(f), "hello\n中文內容")
    assert f.read_text(encoding="utf-8") == "hello\n中文內容"
    assert "已寫入" in result or "wrote" in result.lower()
    assert str(f) in result


def test_write_file_overwrites_existing(tmp_path):
    f = tmp_path / "out.txt"
    f.write_text("old", encoding="utf-8")
    write_file(str(f), "new")
    assert f.read_text(encoding="utf-8") == "new"


from agent.agent import exec_bash


def test_exec_bash_returns_stdout():
    result = exec_bash("echo hello")
    assert "hello" in result
    assert "exit=0" in result


def test_exec_bash_captures_stderr_and_nonzero_exit():
    result = exec_bash("ls /nonexistent_path_xyz")
    assert "exit=" in result
    # ls 失敗 exit 非 0
    assert "exit=0" not in result


def test_exec_bash_fast_command_succeeds():
    # Sanity check 一秒內結束的 command(快速成功路徑)
    result = exec_bash("sleep 0.1 && echo done", timeout=5)
    assert "done" in result
    assert "exit=0" in result


def test_exec_bash_returns_error_on_timeout(monkeypatch):
    """真正打到 TimeoutExpired branch — monkeypatch subprocess.run 強制 raise。"""
    import subprocess as sp

    import agent.agent as agent_module

    def fake_run(*a, **kw):
        raise sp.TimeoutExpired(cmd=a[0] if a else "?", timeout=kw.get("timeout", 0))

    monkeypatch.setattr(agent_module.subprocess, "run", fake_run)
    result = exec_bash("sleep 999", timeout=1)
    assert "timed out" in result.lower()
    assert "1s" in result


from agent.agent import dispatch_tool_call


def test_dispatch_calls_known_tool():
    tools = {"get_time": lambda: "12:00:00"}
    result = dispatch_tool_call("get_time", {}, tools)
    assert result == "12:00:00"


def test_dispatch_unknown_tool_returns_error_not_raise():
    tools = {"get_time": lambda: "12:00:00"}
    result = dispatch_tool_call("nonexistent_tool", {}, tools)
    assert "error" in result.lower()
    assert "nonexistent_tool" in result


def test_dispatch_passes_args_correctly():
    captured = {}
    def fake_tool(**kw):
        captured.update(kw)
        return "ok"
    tools = {"fake": fake_tool}
    dispatch_tool_call("fake", {"path": "/tmp/x", "content": "abc"}, tools)
    assert captured == {"path": "/tmp/x", "content": "abc"}


def test_dispatch_catches_tool_exception_returns_error_string():
    def bad_tool(**kw):
        raise ValueError("boom")
    tools = {"bad": bad_tool}
    result = dispatch_tool_call("bad", {}, tools)
    assert "error" in result.lower()
    assert "boom" in result or "ValueError" in result


from unittest.mock import MagicMock

import agent.agent as agent_module
from agent.agent import AgentLoop


def _mock_response(json_data):
    """Build a mock requests Response object with given JSON."""
    m = MagicMock()
    m.json.return_value = json_data
    m.raise_for_status = MagicMock()
    return m


def test_agent_loop_no_tool_calls_returns_final_message(monkeypatch):
    """Model returns content directly, no tool_calls — loop ends after 1 turn."""
    responses = iter([
        _mock_response({
            "choices": [{
                "message": {"role": "assistant", "content": "Hello!", "tool_calls": None}
            }]
        }),
    ])
    monkeypatch.setattr(agent_module.requests, "post", lambda *a, **kw: next(responses))

    loop = AgentLoop(system_prompt="sys")
    history = loop.run("Hi")

    assert history[-1]["role"] == "assistant"
    assert history[-1]["content"] == "Hello!"


def test_agent_loop_calls_tool_then_returns_final(monkeypatch):
    """Turn 1: model emits tool_call get_time. Turn 2: model returns final content."""
    responses = iter([
        _mock_response({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "get_time", "arguments": "{}"},
                    }],
                }
            }]
        }),
        _mock_response({
            "choices": [{
                "message": {"role": "assistant", "content": "It is 12:34:56.", "tool_calls": None}
            }]
        }),
    ])
    monkeypatch.setattr(agent_module.requests, "post", lambda *a, **kw: next(responses))
    monkeypatch.setitem(agent_module.TOOLS, "get_time", lambda: "12:34:56")

    loop = AgentLoop(system_prompt="sys")
    history = loop.run("What time is it?")

    # Expected history: system, user, assistant(tool_call), tool, assistant(final)
    roles = [m["role"] for m in history]
    assert roles == ["system", "user", "assistant", "tool", "assistant"]
    assert history[3]["content"] == "12:34:56"  # tool result
    assert "12:34:56" in history[4]["content"]


def test_agent_loop_stops_at_max_turns(monkeypatch):
    """Model keeps asking for tool calls forever — loop bails at MAX_TURNS."""
    def infinite_tool_call(*a, **kw):
        return _mock_response({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": "call_x",
                        "type": "function",
                        "function": {"name": "get_time", "arguments": "{}"},
                    }],
                }
            }]
        })

    monkeypatch.setattr(agent_module.requests, "post", infinite_tool_call)
    monkeypatch.setitem(agent_module.TOOLS, "get_time", lambda: "stub")

    loop = AgentLoop(system_prompt="sys", max_turns=3)
    history = loop.run("loop forever")

    # 確定 loop 跑完整 3 turns(model 每 turn 都 tool_call 不停)
    # history: system + user + (assistant + tool) × 3 = exactly 8 messages
    assert len(history) == 1 + 1 + 3 * 2


def test_agent_loop_persists_messages_across_runs(monkeypatch):
    """Two consecutive run() calls — second sees first's history(cross-turn memory)。"""
    responses = iter([
        _mock_response({
            "choices": [{"message": {"role": "assistant", "content": "first", "tool_calls": None}}]
        }),
        _mock_response({
            "choices": [{"message": {"role": "assistant", "content": "second", "tool_calls": None}}]
        }),
    ])
    monkeypatch.setattr(agent_module.requests, "post", lambda *a, **kw: next(responses))

    loop = AgentLoop(system_prompt="sys")
    loop.run("turn 1")
    history = loop.run("turn 2")

    # history 應該累積:system + 2 × (user, assistant)
    roles = [m["role"] for m in history]
    assert roles == ["system", "user", "assistant", "user", "assistant"]
    assert history[1]["content"] == "turn 1"
    assert history[2]["content"] == "first"
    assert history[3]["content"] == "turn 2"
    assert history[4]["content"] == "second"
