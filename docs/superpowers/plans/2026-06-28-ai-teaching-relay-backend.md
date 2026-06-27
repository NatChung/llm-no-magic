# AI 帶課 relay — Backend(spec §1–2)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `agent/server.py` into the single generation engine for Tabs ①②③④ and add a queue-based SSE relay (`/events` + `/drive` + `/inspect` + `/stop` + `/health`) so an AI can drive teaching over HTTP while the page reflects live.

**Architecture:** A module-level list of per-subscriber `queue.Queue`s (guarded by `SUBS_LOCK`) is the pub/sub bus; a pure `publish(frame)` fans a dict into every queue. Each `GET /events` request owns one queue and blocks on `get()`, never touching another request's socket. `POST /drive` serializes on a `GEN_LOCK` (reject-while-busy → 409), swaps the model if needed, runs generation server-side (Tab ④ via the existing `agent_loop`; Tabs ①②③ via a new streamed llama `/completion` path that ports the frontend's `buildFinalPrompt`), `publish()`es every event to the page, and returns the aggregated tokens+probabilities as JSON for the AI to narrate.

**Tech Stack:** Python 3.10+ stdlib only (`http.server.ThreadingHTTPServer`, `threading`, `queue`, `json`, `math`) + `requests` (already a dep). Tests: plain pytest functions + `monkeypatch`/`MagicMock`, matching `agent/tests/test_server.py`.

## Global Constraints

- **stdlib-only on the server** — no new pip deps beyond `requests` (already used). No FastAPI, no WebSocket library.
- **Never write one request's `wfile` from another thread.** Cross-thread communication is only via `queue.Queue`. `publish()` touches no sockets.
- **One generation at a time.** `GEN_LOCK.acquire(blocking=False)`; on failure return `{"busy": True}` → HTTP 409. Do not queue.
- **Tab ①②③ MUST hit llama `/completion`** (raw-string endpoint), NOT `/v1/chat/completions` — Tab ② raw mode emits the user text with no chat template (`return user`), impossible via chat-completions.
- **Generation params copied verbatim from the frontend:** `temperature: 0`, `n_probs: 10`, `stream: true`, and `n_predict = 1500` for Tab ③ (reasoning) else `80`. Dropping the 1500 truncates Tab ③ thinking at 80 tokens and never closes `</think>`.
- **`/events` token frame carries llama-native `{token, logprob}`** in `top_logprobs` (the frontend `renderProbs` does `Math.exp(logprob)`); the `/drive` JSON additionally exposes a computed linear `prob` per token for the AI.
- **Tab ⑥ skill is OUT of scope** — do not touch `/skill-agent`, `_handle_skill_agent`, or `skill_agent_loop`.
- **Keep the existing test style:** plain `def test_*` functions, `monkeypatch`, `_start_server_in_thread()` helper for HTTP-level tests.
- **`/drive` payloads for tabs ②③ always include `mode`** (the lessons pass it). `build_completion_prompt` treats a missing tab-② `mode` as chat (templated) — which diverges from the frontend's `"raw"` default — so callers must send `mode` explicitly for tab ②.

## File Structure

- **Modify `agent/server.py`** — the whole backend lives in one file by existing convention; add to it rather than splitting:
  - new module-level: `import queue`, `import math`, `LLAMA_COMPLETION_URL`, `MODEL_FOR_TAB`, `SUBSCRIBERS`, `SUBS_LOCK`, `GEN_LOCK`, `CANCEL`
  - new pure functions: `subscribe`, `unsubscribe`, `publish`, `subscriber_count`, `build_completion_prompt`, `completion_generate`, `drive`
  - new handler methods on `AgentHandler`: `_handle_events`, `_handle_health`, `_handle_drive`, `_handle_inspect`, `_handle_stop`, `_send_json`; wire into `do_GET`/`do_POST`
- **Modify `agent/tests/test_server.py`** — append tests for every new function + endpoint.

No files are created. No frontend, init.py, or teaching files in THIS plan (separate plans depend on the endpoints landing first).

---

### Task 1: Pub/sub primitives (`publish` / `subscribe` / `unsubscribe` / `subscriber_count`)

**Files:**
- Modify: `agent/server.py` (add after `MAX_TURNS = 6`, near the other module state ~line 50)
- Test: `agent/tests/test_server.py`

**Interfaces:**
- Produces:
  - `SUBSCRIBERS: list[queue.Queue]`
  - `SUBS_LOCK: threading.Lock`
  - `subscribe() -> queue.Queue` — create a queue, register it, return it
  - `unsubscribe(q: queue.Queue) -> None` — remove if present (idempotent)
  - `publish(frame: dict) -> None` — `put(frame)` into every registered queue; touches no sockets
  - `subscriber_count() -> int`

- [ ] **Step 1: Write the failing test**

Append to `agent/tests/test_server.py`:

```python
def test_publish_fans_frame_to_all_subscribers(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    q1 = server.subscribe()
    q2 = server.subscribe()
    assert server.subscriber_count() == 2
    server.publish({"type": "token", "token": "霜"})
    assert q1.get_nowait() == {"type": "token", "token": "霜"}
    assert q2.get_nowait() == {"type": "token", "token": "霜"}


def test_unsubscribe_removes_queue_and_is_idempotent(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    q = server.subscribe()
    assert server.subscriber_count() == 1
    server.unsubscribe(q)
    assert server.subscriber_count() == 0
    server.unsubscribe(q)  # second time must not raise
    assert server.subscriber_count() == 0


def test_publish_with_no_subscribers_is_noop(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    server.publish({"type": "final", "content": "x"})  # must not raise
    assert server.subscriber_count() == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest agent/tests/test_server.py::test_publish_fans_frame_to_all_subscribers -v`
Expected: FAIL with `AttributeError: module 'agent.server' has no attribute 'subscribe'`

- [ ] **Step 3: Write minimal implementation**

In `agent/server.py`, add `import queue` to the stdlib imports block (after `import os`), and add this block right after `MAX_TURNS = 6` (~line 50):

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest agent/tests/test_server.py -k "publish or unsubscribe or subscriber" -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/server.py agent/tests/test_server.py
git commit -m "feat(server): queue-based pub/sub primitives for relay"
```

---

### Task 2: `GET /events` (SSE subscription) + `GET /health`

**Files:**
- Modify: `agent/server.py` (`do_GET`, new `_handle_events`, `_handle_health`, `_send_json`)
- Test: `agent/tests/test_server.py`

**Interfaces:**
- Consumes: `subscribe`, `unsubscribe`, `publish`, `subscriber_count`, `GLOBAL_STATE`, `sse` (Task 1 + existing)
- Produces:
  - `GET /events` → `text/event-stream`, long-lived; emits each published frame; writes `: ping\n\n` every 15s idle; deregisters on disconnect
  - `GET /health` → 200 JSON `{"status":"ok","model":<str|null>,"subscribers":<int>}`, returns immediately
  - `AgentHandler._send_json(self, obj: dict, code: int = 200) -> None`

- [ ] **Step 1: Write the failing test**

Append to `agent/tests/test_server.py`:

```python
def test_health_returns_status_immediately(monkeypatch):
    import agent.server as server
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    srv, port = _start_server_in_thread()
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2)
        assert resp.status == 200
        body = json.loads(resp.read().decode("utf-8"))
        assert body["status"] == "ok"
        assert body["model"] == "0.6B"
        assert body["subscribers"] == 0
    finally:
        srv.shutdown()


def test_events_streams_a_published_frame(monkeypatch):
    import agent.server as server
    import time as _time
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    srv, port = _start_server_in_thread()
    got = {}

    def reader():
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/events", timeout=5)
        got["ctype"] = resp.getheader("Content-Type")
        got["line"] = resp.readline()  # blocks until first frame

    try:
        th = threading.Thread(target=reader, daemon=True)
        th.start()
        # wait until the /events handler registered its queue
        for _ in range(50):
            if server.subscriber_count() == 1:
                break
            _time.sleep(0.05)
        assert server.subscriber_count() == 1
        server.publish({"type": "token", "token": "霜"})
        th.join(timeout=3)
        assert got["ctype"] == "text/event-stream"
        payload = json.loads(got["line"].decode("utf-8").removeprefix("data: "))
        assert payload == {"type": "token", "token": "霜"}
    finally:
        srv.shutdown()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest agent/tests/test_server.py::test_health_returns_status_immediately -v`
Expected: FAIL — `urllib.error.HTTPError: HTTP Error 404` (no `/health` route yet)

- [ ] **Step 3: Write minimal implementation**

In `agent/server.py`, replace `do_GET` (currently ~line 293) with:

```python
    def do_GET(self) -> None:
        if self._redirect_legacy_frontend_prefix():
            return
        if self.path == "/events":
            return self._handle_events()
        if self.path == "/health":
            return self._handle_health()
        super().do_GET()
```

Add these methods to `AgentHandler` (place after `_send_cors`):

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest agent/tests/test_server.py -k "health or events" -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/server.py agent/tests/test_server.py
git commit -m "feat(server): GET /events SSE subscription + GET /health"
```

---

### Task 3: `build_completion_prompt` (port of frontend `buildFinalPrompt`)

**Files:**
- Modify: `agent/server.py` (new pure function, place after `agent_loop`)
- Test: `agent/tests/test_server.py`

**Interfaces:**
- Produces: `build_completion_prompt(tab: str, user: str, system: str = "", mode: str = "") -> str`
  - `tab="1"` → `user` verbatim
  - `tab="2"`, `mode="raw"` → `user` verbatim; `mode="chat"` → system+user chat template with `<think>\n\n</think>` suppression
  - `tab="3"`, `mode="direct"` → chat template + `<think>\n\n</think>` suppression; `mode="thinking"` → chat template, no suppression
  - chat template format mirrors `app.js:201-202`: `<|im_start|>system\n{sys}<|im_end|>\n` (only if sys non-empty) + `<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n`

- [ ] **Step 1: Write the failing test**

Append to `agent/tests/test_server.py`:

```python
def test_build_prompt_basic_returns_user_verbatim():
    from agent.server import build_completion_prompt
    assert build_completion_prompt("1", "床前明月光,疑是地上") == "床前明月光,疑是地上"


def test_build_prompt_advanced_raw_returns_user_verbatim():
    from agent.server import build_completion_prompt
    assert build_completion_prompt("2", "一年有幾個月?", system="你是行銷顧問", mode="raw") \
        == "一年有幾個月?"


def test_build_prompt_advanced_chat_wraps_system_and_suppresses_think():
    from agent.server import build_completion_prompt
    out = build_completion_prompt("2", "一年有幾個月?", system="你是行銷顧問", mode="chat")
    assert out == (
        "<|im_start|>system\n你是行銷顧問<|im_end|>\n"
        "<|im_start|>user\n一年有幾個月?<|im_end|>\n<|im_start|>assistant\n"
        "<think>\n\n</think>\n\n"
    )


def test_build_prompt_chat_without_system_omits_system_block():
    from agent.server import build_completion_prompt
    out = build_completion_prompt("2", "hi", system="", mode="chat")
    assert out.startswith("<|im_start|>user\nhi<|im_end|>")
    assert "system" not in out


def test_build_prompt_reasoning_direct_suppresses_think():
    from agent.server import build_completion_prompt
    out = build_completion_prompt("3", "蘋果問題", system="", mode="direct")
    assert out.endswith("<|im_start|>assistant\n<think>\n\n</think>\n\n")


def test_build_prompt_reasoning_thinking_leaves_think_open():
    from agent.server import build_completion_prompt
    out = build_completion_prompt("3", "蘋果問題", system="", mode="thinking")
    assert out.endswith("<|im_start|>assistant\n")
    assert "</think>" not in out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest agent/tests/test_server.py::test_build_prompt_basic_returns_user_verbatim -v`
Expected: FAIL — `ImportError: cannot import name 'build_completion_prompt'`

- [ ] **Step 3: Write minimal implementation**

In `agent/server.py`, add after `agent_loop` (before `class AgentHandler`):

```python
# ── Tab ①②③ generation: ported from frontend buildFinalPrompt (app.js:197) ──

def build_completion_prompt(tab: str, user: str, system: str = "", mode: str = "") -> str:
    """Build the raw /completion prompt string for Tabs ①②③.

    Mirrors frontend buildFinalPrompt exactly:
      - tab "1" (basic): user verbatim (no template)
      - tab "2" (advanced): raw → user verbatim; chat → templated + think-suppressed
      - tab "3" (reasoning): direct → templated + think-suppressed; thinking → templated
    """
    if tab == "1":
        return user
    sys_block = f"<|im_start|>system\n{system.strip()}<|im_end|>\n" if system.strip() else ""
    chat_base = (
        sys_block
        + f"<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n"
    )
    if tab == "2":
        if mode == "raw":
            return user
        return chat_base + "<think>\n\n</think>\n\n"  # chat mode: skip thinking
    if tab == "3":
        if mode == "thinking":
            return chat_base                          # leave <think> open for the model
        return chat_base + "<think>\n\n</think>\n\n"  # direct: suppress thinking
    return user
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest agent/tests/test_server.py -k build_prompt -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/server.py agent/tests/test_server.py
git commit -m "feat(server): port buildFinalPrompt -> build_completion_prompt"
```

---

### Task 4: `completion_generate` (streamed llama `/completion`, CANCEL-aware)

**Files:**
- Modify: `agent/server.py` (new constants `LLAMA_COMPLETION_URL`, `CANCEL`; new generator `completion_generate`)
- Test: `agent/tests/test_server.py`

**Interfaces:**
- Consumes: `build_completion_prompt` (Task 3), `LLAMA_URL` (existing import)
- Produces:
  - `CANCEL: threading.Event` (module-level)
  - `LLAMA_COMPLETION_URL: str` = `LLAMA_URL.replace("/v1/chat/completions", "/completion")`
  - `completion_generate(tab, user, system="", mode="") -> Iterable[dict]` — yields `{"type":"token","token":str,"top_logprobs":list}` per token then `{"type":"final","content":str}`. CJK single-char guard applied. `n_predict = 1500 if tab=="3" else 80`. Honors `CANCEL` (stops early, still yields final). Calls `requests.post(..., stream=True)` and parses llama SSE `data: ` lines for `completion_probabilities[0]`.

- [ ] **Step 1: Write the failing test**

Append to `agent/tests/test_server.py`:

```python
class _FakeStreamResp:
    """Mimics requests stream response: .iter_lines() + raise_for_status() + close()."""
    def __init__(self, lines):
        self._lines = lines
        self.closed = False
    def raise_for_status(self):
        pass
    def iter_lines(self, decode_unicode=False):
        for ln in self._lines:
            yield ln
    def close(self):
        self.closed = True


def _llama_stream_lines(steps, stop_text=""):
    """Build llama /completion SSE-style 'data: {...}' lines."""
    lines = []
    for tok, lp in steps:
        lines.append("data: " + json.dumps({
            "completion_probabilities": [
                {"token": tok, "top_logprobs": [{"token": tok, "logprob": lp}]}
            ]
        }))
    lines.append("data: " + json.dumps({"content": stop_text, "stop": True}))
    return lines


def test_completion_generate_yields_tokens_then_final(monkeypatch):
    import agent.server as server
    server.CANCEL.clear()
    lines = _llama_stream_lines([("霜", -0.06), ("。", -1.2)])
    monkeypatch.setattr(server.requests, "post",
                        lambda *a, **kw: _FakeStreamResp(lines))
    events = list(server.completion_generate("1", "床前明月光,疑是地上"))
    assert events[0] == {"type": "token", "token": "霜",
                         "top_logprobs": [{"token": "霜", "logprob": -0.06}]}
    assert events[1]["type"] == "token" and events[1]["token"] == "。"
    assert events[-1] == {"type": "final", "content": "霜。"}


def test_completion_generate_sets_n_predict_1500_for_reasoning(monkeypatch):
    import agent.server as server
    server.CANCEL.clear()
    captured = {}
    def fake_post(url, json=None, **kw):
        captured["json"] = json
        return _FakeStreamResp(_llama_stream_lines([("x", -0.1)]))
    monkeypatch.setattr(server.requests, "post", fake_post)
    list(server.completion_generate("3", "蘋果問題", mode="thinking"))
    assert captured["json"]["n_predict"] == 1500
    assert captured["json"]["temperature"] == 0
    assert captured["json"]["n_probs"] == 10
    assert captured["json"]["stream"] is True


def test_completion_generate_default_n_predict_80(monkeypatch):
    import agent.server as server
    server.CANCEL.clear()
    captured = {}
    def fake_post(url, json=None, **kw):
        captured["json"] = json
        return _FakeStreamResp(_llama_stream_lines([("x", -0.1)]))
    monkeypatch.setattr(server.requests, "post", fake_post)
    list(server.completion_generate("1", "hi"))
    assert captured["json"]["n_predict"] == 80


def test_completion_generate_cjk_single_char_gets_trailing_space(monkeypatch):
    import agent.server as server
    server.CANCEL.clear()
    captured = {}
    def fake_post(url, json=None, **kw):
        captured["json"] = json
        return _FakeStreamResp(_llama_stream_lines([("x", -0.1)]))
    monkeypatch.setattr(server.requests, "post", fake_post)
    list(server.completion_generate("1", "霜"))
    assert captured["json"]["prompt"] == "霜 "


def test_completion_generate_stops_on_cancel(monkeypatch):
    import agent.server as server
    server.CANCEL.set()  # cancel before any token
    monkeypatch.setattr(server.requests, "post",
                        lambda *a, **kw: _FakeStreamResp(
                            _llama_stream_lines([("a", -0.1), ("b", -0.2)])))
    events = list(server.completion_generate("1", "hi"))
    server.CANCEL.clear()
    # no token events emitted, but a final still closes the stream
    assert [e for e in events if e["type"] == "token"] == []
    assert events[-1]["type"] == "final"


def test_completion_generate_closes_llama_response_on_cancel(monkeypatch):
    """POST /stop -> CANCEL -> completion_generate must close the llama HTTP
    connection (that is what actually aborts llama's in-flight generation)."""
    import agent.server as server
    server.CANCEL.set()
    resp = _FakeStreamResp(_llama_stream_lines([("a", -0.1), ("b", -0.2)]))
    monkeypatch.setattr(server.requests, "post", lambda *a, **kw: resp)
    list(server.completion_generate("1", "hi"))
    server.CANCEL.clear()
    assert resp.closed is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest agent/tests/test_server.py::test_completion_generate_yields_tokens_then_final -v`
Expected: FAIL — `AttributeError: module 'agent.server' has no attribute 'completion_generate'`

- [ ] **Step 3: Write minimal implementation**

In `agent/server.py`: add `import math` to the stdlib imports; add after the `LLAMA_TEMPLATE_URL` line (~174):

```python
# Tab ①②③ use llama's raw /completion (NOT /v1/chat/completions) — Tab ② raw
# mode emits the user text with no chat template, impossible via chat-completions.
LLAMA_COMPLETION_URL = LLAMA_URL.replace("/v1/chat/completions", "/completion")

CANCEL = threading.Event()   # set by POST /stop; checked each token by generators
```

Add after `build_completion_prompt` (Task 3):

```python
def completion_generate(tab: str, user: str, system: str = "", mode: str = "") -> Iterable[dict]:
    """Tabs ①②③: stream llama /completion, yield one token frame per step then final.

    Honors CANCEL (POST /stop). n_predict mirrors the frontend: 1500 for the
    reasoning tab (Qwen3 thinking can run 600-1500 tokens before </think>),
    else 80.
    """
    prompt = build_completion_prompt(tab, user, system, mode)
    # llama.cpp Qwen3-0.6B tokenizer 500s on a single CJK char prompt — pad it.
    if len(prompt) == 1 and ord(prompt[0]) > 127:
        prompt = prompt + " "
    n_predict = 1500 if tab == "3" else 80

    resp = requests.post(LLAMA_COMPLETION_URL, json={
        "prompt":      prompt,
        "n_predict":   n_predict,
        "n_probs":     10,
        "stream":      True,
        "temperature": 0,
    }, stream=True, timeout=(5, 60))   # (connect, per-read) — long gens stream fine
    resp.raise_for_status()

    pieces: list[str] = []
    try:
        for line in resp.iter_lines(decode_unicode=True):
            if CANCEL.is_set():
                break
            if not line or not line.startswith("data: "):
                continue
            try:
                data = json.loads(line[len("data: "):])
            except json.JSONDecodeError:
                continue
            cps = data.get("completion_probabilities")
            if cps:
                step = cps[0]
                yield {"type": "token", "token": step["token"],
                       "top_logprobs": step["top_logprobs"]}
                pieces.append(step["token"])
            if data.get("stop"):
                break
    finally:
        # Closing the HTTP connection is what aborts llama's in-flight
        # generation — without this, POST /stop only stops the page updating
        # while the model runs on to full n_predict (spec §3.3).
        resp.close()
    yield {"type": "final", "content": "".join(pieces)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest agent/tests/test_server.py -k completion_generate -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/server.py agent/tests/test_server.py
git commit -m "feat(server): streamed llama /completion generator (CANCEL-aware)"
```

---

### Task 5: `drive` orchestrator (GEN_LOCK, swap dispatch, fan-out + aggregate)

**Files:**
- Modify: `agent/server.py` (new constant `MODEL_FOR_TAB`; new `drive` function; new `GEN_LOCK`)
- Test: `agent/tests/test_server.py`

**Interfaces:**
- Consumes: `completion_generate` (Task 4), `agent_loop` (existing), `handle_swap` (existing), `publish`/`subscriber_count` (Task 1), `GLOBAL_STATE` (existing)
- Produces:
  - `GEN_LOCK: threading.Lock` (module-level)
  - `MODEL_FOR_TAB: dict` = `{"1":"0.6B","2":"0.6B","3":"0.6B","4":"4B"}`
  - `drive(tab, user, system="", mode="") -> dict`:
    - busy (lock held) → `{"busy": True}`
    - swap fails → `{"error": <msg>, "subscribers": <int>}`
    - Tab ④ → `{"subscribers":int,"tab":tab,"turns":[...],"final":str}`
    - Tabs ①②③ → `{"subscribers":int,"tab":tab,"tokens":[{"token","top_logprobs","prob"}],"final":str}` (`prob = exp(top_logprobs[0].logprob)`)
    - Side effects: `CANCEL.clear()` at start; `publish(swap_start)` (only if a swap runs); `publish(drive_start)`; `publish()` each generation event

- [ ] **Step 1: Write the failing test**

Append to `agent/tests/test_server.py`:

```python
def test_drive_busy_returns_busy_flag(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    server.GEN_LOCK.acquire()
    try:
        assert server.drive("1", "hi") == {"busy": True}
    finally:
        server.GEN_LOCK.release()


def test_drive_basic_publishes_and_aggregates(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")  # no swap needed
    monkeypatch.setattr(server, "completion_generate",
        lambda tab, user, system="", mode="": iter([
            {"type": "token", "token": "霜",
             "top_logprobs": [{"token": "霜", "logprob": -0.06}]},
            {"type": "final", "content": "霜"},
        ]))
    q = server.subscribe()
    result = server.drive("1", "床前明月光,疑是地上")
    # aggregate for the AI
    assert result["tab"] == "1"
    assert result["final"] == "霜"
    assert result["tokens"][0]["token"] == "霜"
    assert abs(result["tokens"][0]["prob"] - 0.9418) < 0.01  # exp(-0.06)
    assert result["subscribers"] == 1
    # fanned-out frames for the page
    frames = []
    while not q.empty():
        frames.append(q.get_nowait())
    assert frames[0] == {"type": "drive_start", "tab": "1", "mode": "",
                         "user": "床前明月光,疑是地上", "system": ""}
    assert {"type": "token", "token": "霜",
            "top_logprobs": [{"token": "霜", "logprob": -0.06}]} in frames
    assert frames[-1] == {"type": "final", "content": "霜"}


def test_drive_swaps_and_publishes_swap_start(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")  # current
    calls = {}
    def fake_swap(wanted):
        calls["wanted"] = wanted
        server.GLOBAL_STATE["model"] = wanted
        return {"status": "ready", "model": wanted}
    monkeypatch.setattr(server, "handle_swap", fake_swap)
    monkeypatch.setattr(server, "agent_loop",
        lambda s, u: iter([{"type": "final", "content": "現在是 12:00:00"}]))
    q = server.subscribe()
    result = server.drive("4", "現在幾點?")
    assert calls["wanted"] == "4B"  # tab 4 needs 4B
    assert result["final"] == "現在是 12:00:00"
    frames = []
    while not q.empty():
        frames.append(q.get_nowait())
    assert frames[0] == {"type": "swap_start", "tab": "4", "model": "4B"}
    assert {"type": "drive_start", "tab": "4", "mode": "",
            "user": "現在幾點?", "system": ""} in frames


def test_drive_swap_failure_publishes_error(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")
    monkeypatch.setattr(server, "handle_swap",
        lambda wanted: {"status": "error", "message": "port 8080 still busy"})
    q = server.subscribe()
    result = server.drive("4", "現在幾點?")
    assert "port 8080 still busy" in result["error"]
    frames = [q.get_nowait() for _ in range(q.qsize())]
    assert {"type": "error", "message": "port 8080 still busy"} in frames


def test_drive_tab4_agent_error_returns_error(monkeypatch):
    """agent_loop yields an error event (e.g. MAX_TURNS) → drive returns
    {error:...} so the handler maps it to 5xx, not a silent 200."""
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "4B")  # no swap needed
    monkeypatch.setattr(server, "agent_loop",
        lambda s, u: iter([{"type": "error", "message": "max_turns (6) reached"}]))
    result = server.drive("4", "loop forever")
    assert "max_turns" in result["error"]
    assert result.get("final", "") == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest agent/tests/test_server.py::test_drive_busy_returns_busy_flag -v`
Expected: FAIL — `AttributeError: module 'agent.server' has no attribute 'GEN_LOCK'`

- [ ] **Step 3: Write minimal implementation**

In `agent/server.py`, add next to the other relay state (after `CANCEL = threading.Event()`):

```python
GEN_LOCK = threading.Lock()   # serialize /drive: one generation fans out at a time
MODEL_FOR_TAB = {"1": "0.6B", "2": "0.6B", "3": "0.6B", "4": "4B"}
```

Add after `completion_generate`:

```python
def drive(tab: str, user: str, system: str = "", mode: str = "") -> dict:
    """Orchestrate one teaching action: serialize, swap if needed, generate,
    fan out to /events subscribers, and return the aggregate for the AI.

    spec §1.3/§1.4/§3.1. Reject-while-busy (409) — does not queue.
    """
    if not GEN_LOCK.acquire(blocking=False):
        return {"busy": True}
    try:
        CANCEL.clear()
        wanted = MODEL_FOR_TAB.get(tab, "0.6B")
        if GLOBAL_STATE["model"] != wanted:
            publish({"type": "swap_start", "tab": tab, "model": wanted})
            sr = handle_swap(wanted)
            if sr.get("status") != "ready":
                msg = sr.get("message", "swap failed")
                publish({"type": "error", "message": msg})
                return {"error": msg, "subscribers": subscriber_count()}

        publish({"type": "drive_start", "tab": tab, "mode": mode,
                 "user": user, "system": system})

        final = ""
        if tab == "4":
            turns = []
            for ev in agent_loop(system, user):
                publish(ev)
                if ev["type"] == "turn_complete":
                    turns.append(ev)
                elif ev["type"] == "final":
                    final = ev["content"]
                elif ev["type"] == "error":
                    # agent_loop hit MAX_TURNS etc. — surface as 5xx (spec §3.1),
                    # not a silent 200 with empty final.
                    return {"error": ev["message"], "subscribers": subscriber_count()}
                if CANCEL.is_set():
                    break
            return {"subscribers": subscriber_count(), "tab": tab,
                    "turns": turns, "final": final}

        tokens = []
        for ev in completion_generate(tab, user, system, mode):
            publish(ev)
            if ev["type"] == "token":
                tlp = ev["top_logprobs"]
                prob = math.exp(tlp[0]["logprob"]) if tlp else None
                tokens.append({"token": ev["token"], "top_logprobs": tlp, "prob": prob})
            elif ev["type"] == "final":
                final = ev["content"]
        return {"subscribers": subscriber_count(), "tab": tab,
                "tokens": tokens, "final": final}
    finally:
        GEN_LOCK.release()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest agent/tests/test_server.py -k drive -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/server.py agent/tests/test_server.py
git commit -m "feat(server): drive() orchestrator — GEN_LOCK, swap, fan-out, aggregate"
```

---

### Task 6: HTTP handlers `POST /drive` / `/inspect` / `/stop` + routing

**Files:**
- Modify: `agent/server.py` (`do_POST`, new `_handle_drive`, `_handle_inspect`, `_handle_stop`)
- Test: `agent/tests/test_server.py`

**Interfaces:**
- Consumes: `drive` (Task 5), `publish`, `subscriber_count` (Task 1), `CANCEL` (Task 4), `_read_body`/`_send_json` (existing + Task 2)
- Produces:
  - `POST /drive` → `drive(...)`; 409 if `busy`, 500 if `error`, else 200, JSON body = drive result
  - `POST /inspect` body `{"tokenIndex":int}` → `publish({"type":"inspect","tokenIndex":N})` → 200 `{"ok":true,"subscribers":int}`
  - `POST /stop` → `CANCEL.set()` → 200 `{"ok":true}`

- [ ] **Step 1: Write the failing test**

Append to `agent/tests/test_server.py`:

```python
def test_post_drive_returns_200_with_aggregate(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "drive",
        lambda tab, user, system="", mode="": {
            "subscribers": 1, "tab": tab, "tokens": [], "final": "霜"})
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/drive",
            data=json.dumps({"tab": "1", "user": "床前明月光,疑是地上"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        resp = urllib.request.urlopen(req, timeout=2)
        assert resp.status == 200
        body = json.loads(resp.read().decode("utf-8"))
        assert body["tab"] == "1"
        assert body["final"] == "霜"
    finally:
        srv.shutdown()


def test_post_drive_returns_409_when_busy(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "drive", lambda *a, **kw: {"busy": True})
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/drive",
            data=json.dumps({"tab": "1", "user": "x"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            urllib.request.urlopen(req, timeout=2)
            assert False, "expected 409"
        except urllib.error.HTTPError as e:
            assert e.code == 409
    finally:
        srv.shutdown()


def test_post_drive_returns_500_on_error(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "drive",
        lambda *a, **kw: {"error": "port 8080 still busy", "subscribers": 0})
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/drive",
            data=json.dumps({"tab": "4", "user": "x"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            urllib.request.urlopen(req, timeout=2)
            assert False, "expected 500"
        except urllib.error.HTTPError as e:
            assert e.code == 500
            body = json.loads(e.read().decode("utf-8"))
            assert "port 8080" in body["error"]
    finally:
        srv.shutdown()


def test_post_inspect_publishes_inspect_frame(monkeypatch):
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    q = server.subscribe()
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/inspect",
            data=json.dumps({"tokenIndex": 3}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        resp = urllib.request.urlopen(req, timeout=2)
        assert resp.status == 200
        body = json.loads(resp.read().decode("utf-8"))
        assert body["ok"] is True
        assert body["subscribers"] == 1
        assert q.get_nowait() == {"type": "inspect", "tokenIndex": 3}
    finally:
        srv.shutdown()


def test_post_stop_sets_cancel(monkeypatch):
    import agent.server as server
    server.CANCEL.clear()
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/stop", data=b"{}",
            headers={"Content-Type": "application/json"}, method="POST")
        resp = urllib.request.urlopen(req, timeout=2)
        assert resp.status == 200
        assert json.loads(resp.read().decode("utf-8"))["ok"] is True
        assert server.CANCEL.is_set()
    finally:
        server.CANCEL.clear()
        srv.shutdown()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest agent/tests/test_server.py::test_post_drive_returns_200_with_aggregate -v`
Expected: FAIL — `urllib.error.HTTPError: HTTP Error 404` (`/drive` not routed)

- [ ] **Step 3: Write minimal implementation**

In `agent/server.py`, replace `do_POST` (~line 313) with:

```python
    def do_POST(self) -> None:
        if self.path == "/agent":
            self._handle_agent()
        elif self.path == "/skill-agent":
            self._handle_skill_agent()
        elif self.path == "/preview":
            self._handle_preview()
        elif self.path == "/swap":
            self._handle_swap_route()
        elif self.path == "/drive":
            self._handle_drive()
        elif self.path == "/inspect":
            self._handle_inspect()
        elif self.path == "/stop":
            self._handle_stop()
        else:
            self.send_response(404)
            self._send_cors()
            self.end_headers()
```

Add these methods to `AgentHandler` (after `_handle_swap_route`):

```python
    def _handle_drive(self) -> None:
        """spec §3.1: AI/human teaching command. Serialized in drive()."""
        body = self._read_body()
        if body is None:
            return
        result = drive(body.get("tab", ""), body.get("user", ""),
                       body.get("system", ""), body.get("mode", ""))
        if result.get("busy"):
            code = 409
        elif result.get("error"):
            code = 500
        else:
            code = 200
        self._send_json(result, code)

    def _handle_inspect(self) -> None:
        """spec §3.2: pop the probability chart for token N on the page."""
        body = self._read_body()
        if body is None:
            return
        publish({"type": "inspect", "tokenIndex": body.get("tokenIndex", 0)})
        self._send_json({"ok": True, "subscribers": subscriber_count()})

    def _handle_stop(self) -> None:
        """spec §3.3: cancel the in-flight generation."""
        CANCEL.set()
        self._send_json({"ok": True})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest agent/tests/test_server.py -k "post_drive or post_inspect or post_stop" -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/server.py agent/tests/test_server.py
git commit -m "feat(server): POST /drive /inspect /stop handlers + routing"
```

---

### Task 7: Full suite green + manual smoke against a live model

**Files:**
- Verify only: `agent/tests/test_server.py`, `agent/server.py`

**Interfaces:**
- Consumes: everything from Tasks 1–6

- [ ] **Step 1: Run the whole backend test suite**

Run: `pytest agent/tests -q`
Expected: PASS — all prior tests still green plus the ~27 new ones. This plan does not touch `init.py`, so `test_init.py` must stay green too; a failure there is a real regression, not expected.

- [ ] **Step 2: Manual smoke — relay end to end against a real model**

Start the server (it auto-launches llama-server):

```bash
nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
```

In one terminal, subscribe to the stream:

```bash
curl -N http://localhost:9000/events
```

In another, drive Tab ①:

```bash
curl -s -X POST http://localhost:9000/drive \
  -H 'Content-Type: application/json' \
  -d '{"tab":"1","user":"床前明月光,疑是地上"}' | python3 -m json.tool
```

Expected:
- the `curl -N` terminal prints `data: {"type":"drive_start",...}`, a series of `data: {"type":"token",...}` frames, then `data: {"type":"final",...}`
- the `/drive` response JSON has `tokens[0].token == "霜"`, `tokens[0].prob` ≈ 0.94, `subscribers: 1`

- [ ] **Step 3: Manual smoke — health + busy + stop**

```bash
curl -s http://localhost:9000/health | python3 -m json.tool     # status ok, model, subscribers
curl -s -X POST http://localhost:9000/stop -d '{}'              # {"ok": true}
```

Expected: `/health` returns immediately (no hang); `/stop` returns `{"ok":true}`.

- [ ] **Step 4: Commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "test(server): relay backend suite green + smoke verified"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-28-ai-teaching-relay-design.md` §1–2, §3):
- §1.2 per-subscriber queue, no cross-thread wfile → Task 1 (`publish`/`subscribe`) + Task 2 (`_handle_events` owns its queue). ✓
- §1.3 GEN_LOCK reject-while-busy 409 → Task 5 (`drive`) + Task 6 (`_handle_drive` → 409). ✓
- §1.4 one generation two consumers (temp 0) → Task 5 publishes + returns from one generation. ✓
- §2.1 `/completion`, port `buildFinalPrompt`, CJK guard, temp 0, n_probs 10, n_predict 1500/80, streamed read → Tasks 3 + 4. ✓
- §2.2 Tab ④ via `agent_loop` fanned to `/events` → Task 5 tab=="4" branch. ✓
- §3.1 `/drive` contract incl. `prob` + `subscribers`, 409/500 → Tasks 5 + 6. ✓
- §3.2 `/inspect` → Task 6. ✓ · §3.3 `/stop` + CANCEL → Tasks 4 + 6. ✓ · §3.4 `/health` immediate → Task 2. ✓
- §3.6 frame types `swap_start`/`drive_start`/`token`/`turn_complete`/`final`/`inspect`/`error` → emitted across Tasks 4–6. ✓
- §9 layer-1 pytest of `publish` fan-out (no socket) + prompt-building + GEN_LOCK 409 → Tasks 1, 3, 5. ✓
- **Out of scope here (later plans):** frontend (§4), `(?)`/preset removal (§5), init.py/MCP teardown (§6), lessons (§8), Playwright layer-2 smoke (§9 layer-2). Noted in File Structure.

**2. Placeholder scan:** no TBD/TODO; every code step has complete code; every test step has real assertions and exact commands. ✓

**3. Type consistency:** `publish(frame: dict)`, `subscribe()->Queue`, `subscriber_count()->int`, `build_completion_prompt(tab,user,system,mode)->str`, `completion_generate(...)->Iterable[dict]`, `drive(...)->dict` are used identically in their consumer tasks (Tasks 2/5/6). Token frame shape `{"type":"token","token","top_logprobs":[{"token","logprob"}]}` is consistent in Tasks 4→5→tests. `drive` return keys (`busy`/`error`/`tab`/`tokens`/`turns`/`final`/`subscribers`) match `_handle_drive`'s branching in Task 6. ✓

---

## Follow-on plans (NOT in this plan)

After this backend lands and is reviewed, the next plans (each depends on these endpoints existing):
- **Frontend pure-instrument** (spec §4–5): global `/events` subscriber + per-panel render registry, relocate `runCompletion`/`runAgent`, delete `LLAMA_URL` direct path, send/Stop → `/drive`/`/stop`, remove ①②③ presets + interactive-tab `(?)`/prose, bump cache-bust.
- **Onboarding teardown** (spec §6): init.py `/health` check + remove MCP/Node checks; delete `.mcp.json` / `.codex/config.toml`; AGENTS/README rewrite.
- **Teaching materials** (spec §8): lessons 1–4 ×2 langs → relay playbooks; Playwright layer-2 smoke retarget (§9).
