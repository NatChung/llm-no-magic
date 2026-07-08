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
