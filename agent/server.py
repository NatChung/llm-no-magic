"""Agent web backend — HTTP relay between Tab ④ frontend and llama-server.

Architecture: stdlib http.server only (no FastAPI). POST /agent with body
{system, user} → runs agent loop → streams per-turn SSE events back.


"""
import json
import os
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests
from typing import Iterable
from agent.agent import (
    TOOLS,                 # used by Task 4(tool dispatch)
    dispatch_tool_call,    # used by Task 4
    TOOL_SCHEMAS,
    SYSTEM_PROMPT,
    MODEL_NAME,
    LLAMA_URL,
)


def sse(event: dict) -> bytes:
    """Encode a dict as one SSE data: ...\\n\\n frame (UTF-8 bytes)."""
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8")


CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

MAX_TURNS = 6

# ── /swap orchestrator state(spec §4)──────────────────────────────────

# Model identifier convention(I2):統一 substring,detect / poll 都用這個
MODEL_TAG = {
    "0.6B": "Qwen3-0.6B-Q4_K_M",
    "4B":   "Qwen3-4B-Q4_K_M",
}

SWAP_LOCK = threading.Lock()              # C1: 防 concurrent /swap race
GLOBAL_STATE = {"model": None, "log_fh": None}   # log_fh 下次 swap 時 close


def _is_port_free(port: int) -> bool:
    """C3: pkill 後驗證 port 真的 release 才能 launch。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.2)
    try:
        result = s.connect_ex(("127.0.0.1", port))
        return result != 0   # connect 失敗 = port 沒人 listen
    finally:
        s.close()


def _detect_model() -> str | None:
    """從 :8080 /v1/models 推斷 current model — startup sync(I2 統一 substring)。"""
    try:
        r = requests.get("http://localhost:8080/v1/models", timeout=1)
        if r.ok:
            txt = r.text
            for name, tag in MODEL_TAG.items():
                if tag in txt:
                    return name
    except Exception:
        pass
    return None


def handle_swap(wanted: str) -> dict:
    """spec §4:atomic swap llama-server on :8080 to wanted model。

    Returns dict with `status` ∈ {"ready", "error"}, plus model/took_ms/skipped
    on ready, message on error. HTTP layer maps to 200/409/500.
    """
    if wanted not in MODEL_TAG:
        return {"status": "error", "message": f"unknown model: {wanted}"}

    # C1: 一次只一個 swap,non-blocking
    if not SWAP_LOCK.acquire(blocking=False):
        return {"status": "error", "message": "another swap in progress", "code": 409}
    try:
        if GLOBAL_STATE["model"] == wanted:
            return {"status": "ready", "model": wanted, "took_ms": 0, "skipped": True}

        t0 = time.time()

        # 1. Kill 現有 llama-server on :8080
        subprocess.run(["pkill", "-f", "llama-server.*--port 8080"], check=False)

        # C2: close 上一次的 log file handle 避免 fd leak
        if GLOBAL_STATE.get("log_fh"):
            try: GLOBAL_STATE["log_fh"].close()
            except Exception: pass
            GLOBAL_STATE["log_fh"] = None

        # C3: 驗 port 真 free
        for _ in range(10):  # ~5s timeout
            if _is_port_free(8080):
                break
            time.sleep(0.5)
        else:
            return {"status": "error", "message": "port 8080 still busy after kill"}

        # 2. Launch wanted model
        model_file = f"{MODEL_TAG[wanted]}.gguf"
        log_path = f"/tmp/llama-{wanted.lower()}.log"
        log_fh = open(log_path, "w")
        try:
            subprocess.Popen(
                ["llama-server",
                 "-m", os.path.expanduser(f"~/models/{model_file}"),
                 "--port", "8080",
                 "-ngl", "99"],
                stdout=log_fh,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except FileNotFoundError:
            log_fh.close()
            return {"status": "error",
                    "message": "llama-server binary not found on PATH; brew install llama.cpp?"}
        GLOBAL_STATE["log_fh"] = log_fh

        # 3. Poll until ready
        for _ in range(20):  # ~10s timeout
            try:
                r = requests.get("http://localhost:8080/v1/models", timeout=0.5)
                if r.ok and MODEL_TAG[wanted] in r.text:
                    GLOBAL_STATE["model"] = wanted
                    took_ms = int((time.time() - t0) * 1000)
                    return {"status": "ready", "model": wanted,
                            "took_ms": took_ms, "skipped": False}
            except Exception:
                pass
            time.sleep(0.5)

        return {"status": "error",
                "message": f"timeout: llama-server :8080 didn't load {wanted} within 10s"}
    finally:
        SWAP_LOCK.release()


# Same llama-server host but different endpoint — returns chat-template-expanded
# string given messages + tools. Used by /preview for教學一致性(Tab 2/3 風格)。
LLAMA_TEMPLATE_URL = LLAMA_URL.replace("/v1/chat/completions", "/apply-template")


def agent_loop(system: str, user: str) -> Iterable[dict]:
    """Run multi-turn agent loop against llama. Yields SSE event dicts.

    Each turn = one non-stream POST to llama with logprobs+tools. If model
    returns tool_calls, execute via dispatch_tool_call and continue. If no
    tool_calls, emit final and stop.
    """
    messages = [
        # Qwen3 documented /no_think switch — fallback because
        # enable_thinking:false does not suppress <think> on some llama.cpp
        # builds (confirmed smoke 2026-05-27, b9310-e2ef8fe42 build).
        {"role": "system",
         "content": (system or SYSTEM_PROMPT) + "\n\n/no_think"},
        {"role": "user",   "content": user},
    ]
    for turn in range(1, MAX_TURNS + 1):
        resp = requests.post(LLAMA_URL, json={
            "model":       MODEL_NAME,
            "messages":    messages,
            "tools":       TOOL_SCHEMAS,
            "stream":      False,
            "logprobs":    True,
            "top_logprobs": 10,
            "chat_template_kwargs": {"enable_thinking": False},
            "temperature": 0.3,
        }, timeout=60)
        resp.raise_for_status()
        d = resp.json()
        msg = d["choices"][0]["message"]
        lp  = d["choices"][0].get("logprobs", {}).get("content", [])
        messages.append(msg)

        tool_calls = msg.get("tool_calls") or []
        tool_calls_pub  = []
        tool_results_pub = []
        for tc in tool_calls:
            name = tc["function"]["name"]
            args_str = tc["function"]["arguments"] or "{}"
            tool_calls_pub.append({"name": name, "args": args_str})
            try:
                args = json.loads(args_str)
            except json.JSONDecodeError:
                args = {}
            result = dispatch_tool_call(name, args, TOOLS)
            tool_results_pub.append({"name": name, "result_text": result})
            messages.append({
                "role":          "tool",
                "tool_call_id":  tc.get("id", ""),  # 防 model 沒給 id 時 KeyError
                "content":       result,
            })

        # 「收到」— 這 turn model 吐的 raw text(從 logprobs token concat),
        # 加 chat-template assistant 開頭包好,跟「再送出」同視角。
        received_text = "".join(t.get("token", "") for t in lp) if lp else ""
        received_chunk = f"<|im_start|>assistant\n{received_text}" if received_text else ""

        # 「再送出」— 累積後送下次 model 的 prompt(套 chat template)。
        # 只在「有下 turn」時算(model 還在 tool_call):no tool_calls = final turn,
        # 不會送 model 了,顯示「再送出」會誤導。
        next_prompt = ""
        if tool_calls:
            try:
                tpl_resp = requests.post(LLAMA_TEMPLATE_URL, json={
                    "messages": messages,
                    "tools":    TOOL_SCHEMAS,
                    "add_generation_prompt": True,
                }, timeout=5)
                tpl_resp.raise_for_status()
                next_prompt = tpl_resp.json().get("prompt", "")
            except Exception as exc:
                next_prompt = f"[template error] {type(exc).__name__}: {exc}"

        yield {
            "type":           "turn_complete",
            "turn":           turn,
            "message_tokens": lp,
            "tool_calls":     tool_calls_pub,
            "tool_results":   tool_results_pub,
            "received_chunk": received_chunk,
            "next_prompt":    next_prompt,
        }

        if not tool_calls:
            yield {"type": "final", "content": msg.get("content") or ""}
            return

    yield {"type": "error", "message": f"max_turns ({MAX_TURNS}) reached"}


class AgentHandler(BaseHTTPRequestHandler):
    """Single endpoint: POST /agent → SSE stream of turn events."""

    def _send_cors(self) -> None:
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)

    def do_OPTIONS(self) -> None:
        # CORS preflight: frontend on :9000 → backend on :8082 is cross-origin
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_POST(self) -> None:
        if self.path == "/agent":
            self._handle_agent()
        elif self.path == "/preview":
            self._handle_preview()
        elif self.path == "/swap":
            self._handle_swap_route()
        else:
            self.send_response(404)
            self._send_cors()
            self.end_headers()

    def _read_body(self) -> dict | None:
        """Read + parse JSON body. On error, send 400 + return None."""
        try:
            length = int(self.headers.get("Content-Length", "0"))
            return json.loads(self.rfile.read(length)) if length else {}
        except Exception:
            self.send_response(400)
            self._send_cors()
            self.end_headers()
            return None

    def _handle_agent(self) -> None:
        body = self._read_body()
        if body is None:
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self._send_cors()
        self.end_headers()

        try:
            for event in agent_loop(body.get("system", ""), body.get("user", "")):
                self.wfile.write(sse(event))
                self.wfile.flush()
        except Exception as exc:
            try:
                self.wfile.write(sse({
                    "type": "error",
                    "message": f"{type(exc).__name__}: {exc}",
                }))
                self.wfile.flush()
            except Exception:
                pass  # client 可能已斷線

    def _handle_swap_route(self) -> None:
        """spec §4:接 POST /swap body {"model":...},呼叫 handle_swap。"""
        body = self._read_body()
        if body is None:
            return  # _read_body 已送 400

        wanted = body.get("model", "")
        result = handle_swap(wanted)

        if result["status"] == "ready":
            status_code = 200
        elif result.get("code") == 409:
            status_code = 409
        else:
            status_code = 500

        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self._send_cors()
        self.end_headers()
        self.wfile.write(json.dumps(result).encode("utf-8"))

    def _handle_preview(self) -> None:
        """Return chat-template-expanded prompt text for教學一致性。

        Calls llama.cpp /apply-template with same messages + tools as agent_loop
        would send, but doesn't generate — returns the formatted string model sees.
        """
        body = self._read_body()
        if body is None:
            return

        messages = [
            {"role": "system",
             "content": (body.get("system") or SYSTEM_PROMPT) + "\n\n/no_think"},
            {"role": "user",   "content": body.get("user", "")},
        ]
        try:
            resp = requests.post(LLAMA_TEMPLATE_URL, json={
                "messages": messages,
                "tools":    TOOL_SCHEMAS,
                "add_generation_prompt": True,
            }, timeout=5)
            resp.raise_for_status()
            prompt_text = resp.json().get("prompt", "")
        except Exception as exc:
            prompt_text = f"[preview error] {type(exc).__name__}: {exc}"

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self._send_cors()
        self.end_headers()
        self.wfile.write(json.dumps({"prompt": prompt_text}).encode("utf-8"))

    def log_message(self, fmt: str, *args) -> None:
        # Quieter than default (which logs every request to stderr)
        pass


def main() -> None:
    """Run backend on 127.0.0.1:8082(bind localhost only,不對 LAN 開)。"""
    # Startup sync:偵測 :8080 上 alive 的 model(若有),sync GLOBAL_STATE
    GLOBAL_STATE["model"] = _detect_model()
    print(f"Agent web backend on http://127.0.0.1:8082/agent")
    print(f"  detected current model on :8080 = {GLOBAL_STATE['model']}")
    srv = ThreadingHTTPServer(("127.0.0.1", 8082), AgentHandler)
    srv.serve_forever()


if __name__ == "__main__":
    main()
