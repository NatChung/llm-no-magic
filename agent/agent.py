"""Agent CLI Client — single-file Python agent for LLM tool-use demo.

Architecture: input() loop → POST llama-server /v1/chat/completions with tools →
parse tool_calls → execute Python tool → push result → loop until model done.

Tools (4): get_time, read_file, write_file, exec_bash
Server:    llama-server running Qwen3-4B Q4_K_M GGUF on localhost:8080
"""
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Callable

import requests

LLAMA_URL = "http://localhost:8080/v1/chat/completions"
MODEL_NAME = "qwen3-4b"
MAX_TURNS = 6  # safety: limit agent loop iterations

SYSTEM_PROMPT = (
    "You are a helpful assistant with access to tools (get_time, read_file, "
    "write_file, exec_bash). Use them when relevant — call get_time for time "
    "questions, read_file to read files, write_file to create or modify files, "
    "exec_bash to run shell commands. Always call tools first, don't guess. "
    "Answer in 繁體中文 when the user writes Chinese."
)

# Tool schemas (OpenAI function calling format) — sent to llama-server in each request
TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_time",
            "description": "Get current time in HH:MM:SS format.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read contents of a file. Truncates if too long.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path to read"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write content to a file. Overwrites if exists.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path to write"},
                    "content": {"type": "string", "description": "File content"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "exec_bash",
            "description": "Run a shell command. Returns stdout + stderr.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to run"},
                },
                "required": ["command"],
            },
        },
    },
]


# ─── Tools ─────────────────────────────────────────────────────────────────

def get_time() -> str:
    """Get current time in HH:MM:SS format."""
    return datetime.now().strftime("%H:%M:%S")


def read_file(path: str, max_chars: int = 4000) -> str:
    """Read file content, truncate to max_chars."""
    try:
        resolved = Path(path).expanduser()
        with open(resolved, "r", encoding="utf-8") as f:
            return f.read(max_chars)
    except FileNotFoundError:
        return f"error: file not found: {path}"
    except Exception as exc:
        return f"error: read failed: {type(exc).__name__}: {exc}"


def write_file(path: str, content: str) -> str:
    """Write content to file. Overwrites if exists. Returns confirmation string."""
    try:
        resolved = Path(path).expanduser()
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(content, encoding="utf-8")
        return f"Wrote {path} ({len(content)} chars)"
    except Exception as exc:
        return f"error: write failed: {type(exc).__name__}: {exc}"


def exec_bash(command: str, timeout: int = 10) -> str:
    """Run a shell command. Returns formatted exit/stdout/stderr.

    WARNING: no sandbox. Model can run any command including destructive ones.
    Use only in controlled course/demo environment.
    """
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        stdout = result.stdout[:2000]
        stderr = result.stderr[:500]
        return (
            f"exit={result.returncode}\n"
            f"--- stdout ---\n{stdout}\n"
            f"--- stderr ---\n{stderr}"
        )
    except subprocess.TimeoutExpired:
        return f"error: command timed out after {timeout}s"
    except Exception as exc:
        return f"error: exec failed: {type(exc).__name__}: {exc}"


# ─── Tool registry + dispatch ──────────────────────────────────────────────

TOOLS: dict[str, Callable] = {
    "get_time": get_time,
    "read_file": read_file,
    "write_file": write_file,
    "exec_bash": exec_bash,
}


def dispatch_tool_call(name: str, args: dict, tools: dict[str, Callable]) -> str:
    """Look up tool by name and call it with args. Return result as string.

    Unknown tool -> error string (not exception, so model sees it).
    Tool raised exception -> error string with type + msg.
    """
    if name not in tools:
        return f"error: unknown tool '{name}'. Available: {list(tools.keys())}"
    try:
        result = tools[name](**args)
        return str(result)
    except Exception as exc:
        return f"error: tool '{name}' raised {type(exc).__name__}: {exc}"


# ─── Agent loop ────────────────────────────────────────────────────────────

class AgentLoop:
    """Drive the LLM <-> tool loop. Persistent messages across REPL turns.

    Per spec §8: messages is owner-of-state — accumulates across turns so the model sees history.
    Tools and schemas come from module-level TOOLS / TOOL_SCHEMAS, not parameterized.
    """

    def __init__(self, system_prompt: str = "", max_turns: int = MAX_TURNS):
        self.system_prompt = system_prompt
        self.max_turns = max_turns
        self.messages: list[dict] = []
        if system_prompt:
            self.messages.append({"role": "system", "content": system_prompt})

    def run(self, user_input: str) -> list[dict]:
        """Append user input, run turn loop. Returns full self.messages.

        Subsequent calls see prior history (cross-turn memory).
        """
        self.messages.append({"role": "user", "content": user_input})

        for _turn in range(self.max_turns):
            resp = requests.post(
                LLAMA_URL,
                json={
                    "model": MODEL_NAME,
                    "messages": self.messages,
                    "tools": TOOL_SCHEMAS,
                    "temperature": 0.3,
                },
                timeout=60,
            )
            resp.raise_for_status()
            msg = resp.json()["choices"][0]["message"]
            self.messages.append(msg)

            tool_calls = msg.get("tool_calls")
            if not tool_calls:
                return self.messages  # model done

            for tc in tool_calls:
                name = tc["function"]["name"]
                args_str = tc["function"]["arguments"] or "{}"
                try:
                    args = json.loads(args_str)
                except json.JSONDecodeError:
                    args = {}
                result = dispatch_tool_call(name, args, TOOLS)
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

        return self.messages  # max_turns reached


# ─── Display ───────────────────────────────────────────────────────────────

ANSI = {
    "USER":         "\033[36m",   # cyan
    "MODEL":        "\033[33m",   # yellow
    "TOOL_CALL":    "\033[35m",   # magenta
    "TOOL_RESULT":  "\033[32m",   # green
    "SYSTEM":       "\033[90m",   # gray
    "RESET":        "\033[0m",
}

ROLE_BANNER = {
    "system":    ("SYSTEM",      "═════ SYSTEM ═════════════════════════════════"),
    "user":      ("USER",        "═════ USER ═══════════════════════════════════"),
    "assistant": ("MODEL",       "═════ MODEL ══════════════════════════════════"),
    "tool":      ("TOOL_RESULT", "═════ TOOL RESULT ════════════════════════════"),
}


def log_message(msg: dict) -> None:
    """Print one message with colored banner."""
    role = msg.get("role", "?")
    label, banner = ROLE_BANNER.get(role, (role.upper(), f"═════ {role.upper()} ═══"))
    color = ANSI.get(label, "")
    reset = ANSI["RESET"]

    print(f"{color}{banner}{reset}")
    if msg.get("tool_calls"):
        for tc in msg["tool_calls"]:
            name = tc["function"]["name"]
            args = tc["function"]["arguments"]
            print(f"  {ANSI['TOOL_CALL']}▸ TOOL_CALL{reset}: {name}({args})")
    if msg.get("content"):
        print(msg["content"])
    print()


# ─── REPL ──────────────────────────────────────────────────────────────────

def main() -> None:
    """Interactive REPL — type prompt, see agent loop output.

    AgentLoop holds self.messages across turns, so consecutive prompts share cross-turn memory.
    """
    print(f"{ANSI['SYSTEM']}Agent CLI · Qwen3-4B @ localhost:8080{ANSI['RESET']}")
    print(f"{ANSI['SYSTEM']}Type a prompt. Ctrl-D or 'exit' to quit.{ANSI['RESET']}")
    print()

    loop = AgentLoop(system_prompt=SYSTEM_PROMPT)

    while True:
        try:
            user_input = input(f"{ANSI['USER']}>>> {ANSI['RESET']}")
        except EOFError:
            print()
            break
        if not user_input.strip():
            continue
        if user_input.strip().lower() in {"exit", "quit", "/q"}:
            break

        # Log user message (loop.run will also append it to self.messages, but we display it first)
        log_message({"role": "user", "content": user_input})

        prev_len = len(loop.messages)  # before run() appends user msg
        try:
            history = loop.run(user_input)
        except requests.RequestException as exc:
            print(f"{ANSI['SYSTEM']}[network error] {exc}{ANSI['RESET']}\n")
            # Roll back user msg from self.messages so retry not on stale state
            loop.messages = loop.messages[:prev_len]
            continue
        except Exception as exc:
            print(f"{ANSI['SYSTEM']}[error] {type(exc).__name__}: {exc}{ANSI['RESET']}\n")
            loop.messages = loop.messages[:prev_len]
            continue

        # Log only NEW messages from this turn (skip the user msg we just displayed).
        # history accumulates: turn 1 = [system, user, ...]; turn N = [..., user, ...].
        # prev_len + 1 skips over the user msg that run() just appended.
        for msg in history[prev_len + 1:]:
            log_message(msg)


if __name__ == "__main__":
    main()
