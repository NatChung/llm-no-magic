"""Agent web backend — single-port server (HTML + API + SSE).

Architecture: stdlib http.server only (no FastAPI). One process on :9000
serves both:
  - GET /, /index.html, /app.js, /styles.css ... → static files from frontend/
  - POST /agent, /skill-agent, /swap, /preview → API handlers (SSE for /agent
    and /skill-agent, JSON for /swap, plain proxy for /preview)

This collapses what used to be two separate ports (frontend :9000 via
http.server, backend :8082 via this file) into one. Reduces ports the
classroom LAN demo has to expose from 3 → 2 (this + llama-server :8080).
"""
import json
import os
import queue
import socket
import subprocess
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import requests
from typing import Iterable

# Static files served from frontend/ (relative to this file's parent dir).
STATIC_ROOT = Path(__file__).resolve().parent.parent / "frontend"
from agent.agent import (
    TOOLS,                 # used by Task 4 (tool dispatch)
    dispatch_tool_call,    # used by Task 4
    TOOL_SCHEMAS,
    SYSTEM_PROMPT,
    MODEL_NAME,
    LLAMA_URL,
)
from agent.skill_agent import skill_agent_loop


def sse(event: dict) -> bytes:
    """Encode a dict as one SSE data: ...\\n\\n frame (UTF-8 bytes)."""
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8")


CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

MAX_TURNS = 6

# ── relay pub/sub (spec §1.2) ───────────────────────────────────────────
# Each /events connection owns one queue.Queue; publish() fans a frame into
# every queue. publish() NEVER writes a socket — cross-thread comms is queues
# only (the /events thread is the sole writer of its own wfile).
SUBSCRIBERS: list[queue.Queue] = []
SUBS_LOCK = threading.Lock()


def subscribe() -> queue.Queue:
    q: queue.Queue = queue.Queue()
    with SUBS_LOCK:
        SUBSCRIBERS.append(q)
    return q


def unsubscribe(q: queue.Queue) -> None:
    with SUBS_LOCK:
        if q in SUBSCRIBERS:
            SUBSCRIBERS.remove(q)


def publish(frame: dict) -> None:
    with SUBS_LOCK:
        for q in SUBSCRIBERS:
            q.put(frame)


def subscriber_count() -> int:
    with SUBS_LOCK:
        return len(SUBSCRIBERS)


# ── /swap orchestrator state (spec §4) ──────────────────────────────────

# Model identifier convention (I2): one substring used by both detect and poll
MODEL_TAG = {
    "0.6B": "Qwen3-0.6B-Q4_K_M",
    "4B":   "Qwen3-4B-Q4_K_M",
}

SWAP_LOCK = threading.Lock()              # C1: prevent concurrent /swap race
GLOBAL_STATE = {"model": None, "log_fh": None}   # log_fh: closed on next swap


def _is_port_free(port: int) -> bool:
    """C3: verify the port is actually released after pkill before launching."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.2)
    try:
        result = s.connect_ex(("127.0.0.1", port))
        return result != 0   # connect failed = nothing listening on port
    finally:
        s.close()


def _detect_model() -> str | None:
    """Infer current model from :8080 /v1/models — startup sync (I2 substring)."""
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
    """spec §4: atomic swap llama-server on :8080 to wanted model.

    Returns dict with `status` ∈ {"ready", "error"}, plus model/took_ms/skipped
    on ready, message on error. HTTP layer maps to 200/409/500.
    """
    if wanted not in MODEL_TAG:
        return {"status": "error", "message": f"unknown model: {wanted}"}

    # C1: one swap at a time, non-blocking
    if not SWAP_LOCK.acquire(blocking=False):
        return {"status": "error", "message": "another swap in progress", "code": 409}
    try:
        if GLOBAL_STATE["model"] == wanted:
            return {"status": "ready", "model": wanted, "took_ms": 0, "skipped": True}

        t0 = time.time()

        # 1. Kill the existing llama-server on :8080
        subprocess.run(["pkill", "-f", "llama-server.*--port 8080"], check=False)

        # C2: close the previous log file handle to avoid fd leak
        if GLOBAL_STATE.get("log_fh"):
            try: GLOBAL_STATE["log_fh"].close()
            except Exception: pass
            GLOBAL_STATE["log_fh"] = None

        # C3: verify port is actually free
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
        # If backend is exposed on LAN (LISTEN_HOST set, e.g. 0.0.0.0 for
        # classroom demo), pass the same host to llama-server so its :8080
        # is reachable from students' browsers too.
        listen_host = os.environ.get("LISTEN_HOST", "127.0.0.1")
        launch_args = [
            "llama-server",
            "-m", os.path.expanduser(f"~/models/{model_file}"),
            "--port", "8080",
            "-ngl", "99",
        ]
        if listen_host != "127.0.0.1":
            launch_args.extend(["--host", listen_host])
        try:
            subprocess.Popen(
                launch_args,
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
# string given messages + tools. Used by /preview for teaching consistency (Tab 2/3 style).
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
                "tool_call_id":  tc.get("id", ""),  # guard: model may omit id (avoid KeyError)
                "content":       result,
            })

        # "received" — the raw text the model emitted this turn (concat from logprobs tokens),
        # wrapped with the chat-template assistant prefix to match the "sent next" perspective.
        received_text = "".join(t.get("token", "") for t in lp) if lp else ""
        received_chunk = f"<|im_start|>assistant\n{received_text}" if received_text else ""

        # "sent next" — the prompt sent into the next model call, after accumulation (chat template applied).
        # Only computed when there's a next turn (model still in tool_call): no tool_calls = final turn,
        # nothing will be sent to the model again, so showing "sent next" would mislead.
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


class AgentHandler(SimpleHTTPRequestHandler):
    """One handler:
      - GET → SimpleHTTPRequestHandler serves static files from STATIC_ROOT
      - POST → /agent / /skill-agent / /swap / /preview API endpoints (below)
      - OPTIONS → CORS preflight
    """

    def log_message(self, format, *args):
        # Override default (writes to sys.stderr) to use print() which is
        # reliably captured by nohup `2>&1` redirect and flushes line-by-line.
        print(f"[{self.log_date_time_string()}] {self.address_string()} - {format % args}", flush=True)

    def _redirect_legacy_frontend_prefix(self) -> bool:
        """Pre-2026-05-29 the URL was http://host:9000/frontend/... (when
        frontend was served by a separate http.server). After merging into
        :9000 with static root at frontend/, canonical URL is /...
        Browsers / iPhone Safari autofill from history → still hit /frontend/.
        301 redirect so client learns the new URL.
        """
        if self.path.startswith("/frontend"):
            new_path = self.path[len("/frontend"):] or "/"
            self.send_response(301)
            self.send_header("Location", new_path)
            self.end_headers()
            return True
        return False

    def do_GET(self) -> None:
        if self._redirect_legacy_frontend_prefix():
            return
        if self.path == "/events":
            return self._handle_events()
        if self.path == "/health":
            return self._handle_health()
        super().do_GET()

    def do_HEAD(self) -> None:
        if self._redirect_legacy_frontend_prefix():
            return
        super().do_HEAD()

    def _send_cors(self) -> None:
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)

    def _send_json(self, obj: dict, code: int = 200) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._send_cors()
        self.end_headers()
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _handle_health(self) -> None:
        self._send_json({
            "status": "ok",
            "model": GLOBAL_STATE["model"],
            "subscribers": subscriber_count(),
        })

    def _handle_events(self) -> None:
        """Long-lived SSE subscription. Owns one queue; sole writer of this
        wfile. publish() (other threads) only put() into the queue."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self._send_cors()
        self.end_headers()
        q = subscribe()
        try:
            while True:
                try:
                    frame = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                self.wfile.write(sse(frame))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            unsubscribe(q)

    def do_OPTIONS(self) -> None:
        # CORS preflight: frontend on :9000 → backend on :8082 is cross-origin
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_POST(self) -> None:
        if self.path == "/agent":
            self._handle_agent()
        elif self.path == "/skill-agent":
            self._handle_skill_agent()
        elif self.path == "/preview":
            self._handle_preview()
        elif self.path == "/swap":
            self._handle_swap_route()
        else:
            self.send_response(404)
            self._send_cors()
            self.end_headers()

    def _handle_skill_agent(self) -> None:
        """Tab ⑦ preview: skill simulator with naive/proper toggle."""
        body = self._read_body()
        if body is None:
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self._send_cors()
        self.end_headers()

        mode = body.get("mode", "proper")  # "naive" or "proper"
        user = body.get("user", "")

        try:
            for event in skill_agent_loop(user, mode):
                self.wfile.write(sse(event))
                self.wfile.flush()
        except Exception as exc:
            try:
                self.wfile.write(sse({"type": "error", "message": f"{type(exc).__name__}: {exc}"}))
                self.wfile.flush()
            except Exception:
                pass

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
                pass  # client may have disconnected

    def _handle_swap_route(self) -> None:
        """spec §4: handle POST /swap body {"model":...}, invoke handle_swap."""
        body = self._read_body()
        if body is None:
            return  # _read_body already sent 400

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
        """Return chat-template-expanded prompt text for teaching consistency.

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

def main() -> None:
    """Run single-port server on $LISTEN_HOST:9000 (default 127.0.0.1 — safe).

    Serves both static frontend files and API endpoints. For classroom
    LAN demo, launch with `LISTEN_HOST=0.0.0.0` so students on the same
    WiFi can hit http://<mac-lan-ip>:9000/ . The /swap orchestrator also
    propagates LISTEN_HOST to llama-server's --host flag so llama-server
    binds the same interface.
    """
    listen_host = os.environ.get("LISTEN_HOST", "127.0.0.1")
    # Startup sync: detect any model currently alive on :8080, sync GLOBAL_STATE
    GLOBAL_STATE["model"] = _detect_model()
    print(f"llm-no-magic server on http://{listen_host}:9000/")
    print(f"  serving static frontend from {STATIC_ROOT}")
    print(f"  detected current model on :8080 = {GLOBAL_STATE['model']}")
    # SimpleHTTPRequestHandler needs `directory=` via partial (its __init__
    # signature has directory as a kwarg after positional handler args).
    handler = partial(AgentHandler, directory=str(STATIC_ROOT))
    srv = ThreadingHTTPServer((listen_host, 9000), handler)
    srv.serve_forever()


if __name__ == "__main__":
    main()
