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
LLAMA_TEMPLATE_URL = LLAMA_URL.replace("/v1/chat/completions", "/apply-template")
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


def mcp_preview_tools() -> list[dict]:
    """Spawn the mini server, handshake, return OpenAI-format tools.

    Used by POST /preview {"tab":"6"} so the AI teacher can show the
    exact turn-1 prompt (tools included) without running a generation.
    """
    client = McpClient()
    try:
        client.request("initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "llm-no-magic-preview", "version": "0.1"},
        })
        client.notify("notifications/initialized")
        _, resp = client.request("tools/list")
        return mcp_tools_to_openai(resp["result"]["tools"])
    finally:
        client.close()


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
            # "sent" — this turn's actual prompt, chat template applied.
            # tools 是握手問來的 openai_tools:展開藍泡就看得到 <tools> 區塊,
            # 那正是 lesson-6「工具清單是問來的」的物證。
            try:
                sent_prompt = requests.post(LLAMA_TEMPLATE_URL, json={
                    "messages": messages,
                    "tools":    openai_tools,
                    "add_generation_prompt": True,
                }, timeout=5).json().get("prompt", "")
            except Exception as exc:
                sent_prompt = f"[template error] {type(exc).__name__}: {exc}"

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
                "sent_prompt": sent_prompt,
                "usage": {"prompt_tokens": usage.get("prompt_tokens"),
                          "completion_tokens": usage.get("completion_tokens")},
            }

            if not tool_calls:
                yield {"type": "final", "content": content}
                return

        yield {"type": "error", "message": f"max_turns ({MAX_TURNS}) reached"}
    finally:
        client.close()
