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
