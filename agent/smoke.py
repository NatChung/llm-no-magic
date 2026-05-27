"""V2 Agent end-to-end smoke — runs demo prompts against real llama-server.

Usage: python3 -m agent.smoke
Outputs: human-readable log to stdout; record pass/fail in SETUP.md.
"""
import re
import sys
import requests
from agent.agent import AgentLoop, SYSTEM_PROMPT, log_message

DEMOS = [
    ("demo_1_get_time",   "現在幾點?",                  3),
    ("demo_2_read_write", "讀 prompts.md,把它總結成 3 點,寫到 ~/Desktop/llm-summary.md", 3),
    ("demo_3a_exec_count","這個目錄底下有幾個 .md 檔?",  3),
    ("demo_3b_exec_find", "把 ~/Desktop 大於 10MB 的檔列出來", 3),
    ("edge_no_tool",      "你好",                        1),
]


def run_demo(name: str, prompt: str) -> dict:
    """Run one prompt through a fresh AgentLoop. Return evaluation dict."""
    print(f"\n{'=' * 60}")
    print(f"  {name}")
    print(f"{'=' * 60}")

    loop = AgentLoop(system_prompt=SYSTEM_PROMPT)
    try:
        history = loop.run(prompt)
    except requests.exceptions.Timeout as exc:
        print(f"  [TIMEOUT] llama-server timed out: {exc}")
        return {
            "name": name, "prompt": prompt, "pass": False,
            "note": f"TIMEOUT: {exc}", "has_tool_call": False,
            "tool_names": [], "tool_results": [], "final": "", "history_len": 0,
        }
    except Exception as exc:
        print(f"  [ERROR] {type(exc).__name__}: {exc}")
        return {
            "name": name, "prompt": prompt, "pass": False,
            "note": f"ERROR: {type(exc).__name__}: {exc}", "has_tool_call": False,
            "tool_names": [], "tool_results": [], "final": "", "history_len": 0,
        }

    print(f"User: {prompt}")
    print(f"--- History ({len(history)} messages) ---")
    for msg in history[1:]:   # skip system
        log_message(msg)

    has_tool_call = any(m.get("tool_calls") for m in history)
    final_content  = history[-1].get("content", "") or ""
    tool_names     = [
        tc["function"]["name"]
        for m in history if m.get("tool_calls")
        for tc in m["tool_calls"]
    ]
    tool_results   = [m.get("content", "") for m in history if m.get("role") == "tool"]

    result = {
        "name":         name,
        "prompt":       prompt,
        "has_tool_call":has_tool_call,
        "tool_names":   tool_names,
        "tool_results": tool_results,
        "final":        final_content,
        "history_len":  len(history),
    }

    # ── per-demo pass eval ──────────────────────────────────────────────────
    if name == "demo_1_get_time":
        time_re = re.compile(r"\d{1,2}:\d{2}")
        result["pass"] = (
            "get_time" in tool_names
            and any(time_re.search(r) for r in tool_results)
            and bool(time_re.search(final_content))
        )
        result["note"] = f"tool_names={tool_names}"

    elif name == "demo_2_read_write":
        wrote = any("Desktop/llm-summary.md" in r or "llm-summary" in r for r in tool_results)
        result["pass"] = (
            "read_file" in tool_names
            and "write_file" in tool_names
            and wrote
        )
        result["note"] = f"tool_names={tool_names} wrote={wrote}"

    elif name == "demo_3a_exec_count":
        # 只認 stdout section 裡的數字,避開 `exit=0` 的 trivial match
        def _stdout(r: str) -> str:
            m = re.search(r"--- stdout ---\n(.*?)\n--- stderr ---", r, re.DOTALL)
            return m.group(1) if m else ""
        has_num = any(re.search(r"\d+", _stdout(r)) for r in tool_results)
        result["pass"] = "exec_bash" in tool_names and has_num
        result["note"] = f"tool_names={tool_names} has_num={has_num}"

    elif name == "demo_3b_exec_find":
        result["pass"] = "exec_bash" in tool_names  # empty list is OK
        result["note"] = f"tool_names={tool_names}"

    elif name == "edge_no_tool":
        result["pass"] = not has_tool_call and bool(final_content)
        result["note"] = f"has_tool_call={has_tool_call}"

    else:
        result["pass"] = True
        result["note"] = ""

    status = "PASS" if result["pass"] else "FAIL"
    print(f"\n>>> [{status}] {name} | {result['note']}")
    print(f">>> final[:120]: {final_content[:120]!r}")
    return result


def main() -> None:
    all_results = []

    for name, prompt, runs in DEMOS:
        run_results = []
        for r in range(1, runs + 1):
            print(f"\n\n{'#' * 60}")
            print(f"## {name}  —  Run {r}/{runs}")
            print(f"{'#' * 60}")
            res = run_demo(name, prompt)
            res["run"] = r
            run_results.append(res)
        all_results.append((name, run_results))

    # ── summary ─────────────────────────────────────────────────────────────
    print(f"\n\n{'#' * 60}")
    print("## SMOKE SUMMARY")
    print(f"{'#' * 60}")
    for name, run_results in all_results:
        passed = sum(1 for r in run_results if r["pass"])
        total  = len(run_results)
        notes  = "; ".join(r.get("note", "") for r in run_results if not r["pass"])
        status = "PASS" if passed == total else "FAIL"
        print(f"  [{status}] {name}: {passed}/{total}  {notes}")


if __name__ == "__main__":
    main()
