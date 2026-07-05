# Tab-④ cancel-emits-final Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `drive()`'s tab-④ (agent) branch publish a terminal `final` frame when a `POST /stop` cancels a run mid-agent-loop, so the teaching page re-enables its Send button instead of wedging until reload.

**Architecture:** `drive()` fans backend events to `/events` subscribers. For token tabs (①②③) `completion_generate` ends with an **unconditional** trailing `yield {"type":"final",…}` (`agent/server.py:389`, outside the try/finally), so even a CANCEL-break emits a `final`. The tab-④ branch instead iterates `agent_loop` and `break`s on `CANCEL` — if the break lands before `agent_loop` naturally yields its own `final`, **no `final` frame is ever published**. Fix: track whether a `final` was seen inside the loop, and if not, publish `{"type":"final","content":""}` after the loop. This makes the terminal-`final` invariant (already established for the error paths in commit `a930f23`, spec §3.6) total for tab-④, and brings tab-④ into conformance with spec §3.3 which already specifies stop should "`publish(final)` 收尾".

**Tech Stack:** Python 3 stdlib (`http.server`, `threading`, `queue`); `pytest` with plain functions + `monkeypatch` (no async, no fixtures beyond monkeypatch) — match the existing `agent/tests/test_server.py` style.

## Global Constraints

- **This is a backend-only change.** Touch `agent/server.py` (the `drive()` tab-④ branch) and `agent/tests/test_server.py`. No frontend files. The empty-content `final` is safe for the (not-yet-written) frontend: spec §3.6 already states "前端不可假設 `final` 一定帶非空結果," and the existing error paths (swap failure, mid-generation crash — `a930f23`) already publish empty `final` frames, so the cancel `final` reuses an established, already-tested contract rather than introducing a new page state.
- **Do not regress the terminal-`final` invariant from `a930f23`** (spec §3.6): every error path already emits `error` + `final` via the `_fail()` helper. This plan adds the *cancel* path (a normal, non-error stop) — it must NOT route through `_fail()` (cancel is a 200, not a 500) and must NOT double-publish a `final` when `agent_loop` already yielded one.
- **Cancel is not an error.** A cancelled tab-④ run still returns the normal success-shaped aggregate `{"subscribers", "tab", "turns", "final"}` (→ HTTP 200), exactly as it does today. Only the missing `final` *frame* is added.
- **Keep the existing pytest style:** plain `def test_*(monkeypatch)` functions, `monkeypatch.setattr(server, "SUBSCRIBERS", [])` to isolate the subscriber list, drive `server.drive(...)` directly and inspect frames drained from a `server.subscribe()` queue. No new test dependencies.
- **Full suite must stay green:** `pytest agent/tests -q` is 98 passing as of `a930f23`; this adds 1 test → 99.

---

### Task 1: Publish a terminal `final` when a tab-④ run is cancelled

**Files:**
- Modify: `agent/server.py` — the `if tab == "4":` block inside `drive()` (currently at `agent/server.py:416-431`)
- Test: `agent/tests/test_server.py` (add one test after `test_drive_tab4_agent_error_returns_error`, which ends at line 888)

**Interfaces:**
- Consumes (unchanged, already in the module): `agent_loop(system, user)` — a generator yielding frames `{"type":"turn_complete", turn, message_tokens, tool_calls, tool_results, received_chunk, next_prompt}`, `{"type":"final", "content"}`, or `{"type":"error", "message"}`; `publish(frame)`; `CANCEL` (a `threading.Event`, cleared at the top of `drive()`); `subscriber_count()`; the `_fail(msg, error_already_published=False)` closure defined at the top of `drive()`.
- Produces: no new module-level names. Behavioral change only: the tab-④ branch guarantees exactly one terminal `final` frame per non-error run (cancelled or not).

- [ ] **Step 1: Write the failing test**

Add to `agent/tests/test_server.py`, immediately after `test_drive_tab4_agent_error_returns_error` (ends at line 888, before `test_post_drive_returns_200_with_aggregate`):

```python
def test_drive_tab4_cancel_emits_final(monkeypatch):
    """A /stop mid-agent-run breaks drive()'s tab-4 loop; it must STILL emit a
    terminal final so the page re-enables Send (spec §3.3 'publish(final) 收尾';
    terminal-final invariant §3.6). Tabs ①②③ get this free from
    completion_generate's unconditional trailing final — tab-4 did not.
    Cancel is a normal stop, so the aggregate is 200-shaped (no 'error' key)."""
    import agent.server as server
    monkeypatch.setattr(server, "SUBSCRIBERS", [])
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "4B")  # no swap needed

    def fake_loop(system, user):
        # simulate /stop landing during turn 1: set CANCEL, then yield a
        # turn_complete. drive() publishes it, sees CANCEL, and breaks — WITHOUT
        # agent_loop ever yielding its own final.
        server.CANCEL.set()
        yield {"type": "turn_complete", "turn": 1, "message_tokens": [],
               "tool_calls": [], "tool_results": [], "received_chunk": "",
               "next_prompt": ""}

    monkeypatch.setattr(server, "agent_loop", fake_loop)
    q = server.subscribe()
    try:
        result = server.drive("4", "現在幾點?")
    finally:
        server.CANCEL.clear()  # never leak a set CANCEL into later tests

    frames = [q.get_nowait() for _ in range(q.qsize())]
    # the cancelled run terminates the stream with a final (re-enables Send)
    assert {"type": "final", "content": ""} in frames
    # cancel is NOT an error → normal 200-shaped aggregate, GEN_LOCK released
    assert "error" not in result
    assert result["tab"] == "4"
    assert server.GEN_LOCK.acquire(blocking=False)
    server.GEN_LOCK.release()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest agent/tests/test_server.py::test_drive_tab4_cancel_emits_final -q`
Expected: **FAIL** on `assert {"type": "final", "content": ""} in frames` — today the tab-④ branch breaks on CANCEL and returns without publishing any `final` frame (the drained `frames` contain only the `drive_start` and the `turn_complete`).

- [ ] **Step 3: Implement — track `saw_final`, publish an empty `final` if none was seen**

In `agent/server.py`, replace the tab-④ block inside `drive()` (currently):

```python
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
                        # not a silent 200 with empty final. The error frame is
                        # already published above via publish(ev).
                        return _fail(ev["message"], error_already_published=True)
                    if CANCEL.is_set():
                        break
                return {"subscribers": subscriber_count(), "tab": tab,
                        "turns": turns, "final": final}
```

with:

```python
            if tab == "4":
                turns = []
                saw_final = False
                for ev in agent_loop(system, user):
                    publish(ev)
                    if ev["type"] == "turn_complete":
                        turns.append(ev)
                    elif ev["type"] == "final":
                        final = ev["content"]
                        saw_final = True
                    elif ev["type"] == "error":
                        # agent_loop hit MAX_TURNS etc. — surface as 5xx (spec §3.1),
                        # not a silent 200 with empty final. The error frame is
                        # already published above via publish(ev).
                        return _fail(ev["message"], error_already_published=True)
                    if CANCEL.is_set():
                        break
                if not saw_final:
                    # CANCEL broke the loop before agent_loop emitted its final
                    # (spec §3.3 'publish(final) 收尾'; terminal-final invariant
                    # §3.6). Tabs ①②③ get this free from completion_generate's
                    # unconditional trailing final; tab-4 must emit it here.
                    publish({"type": "final", "content": ""})
                return {"subscribers": subscriber_count(), "tab": tab,
                        "turns": turns, "final": final}
```

The change is three lines: `saw_final = False`, `saw_final = True` in the `final` branch, and the `if not saw_final: publish(...)` block after the loop. Nothing else in `drive()` changes; the error path still returns early via `_fail()` (so it never reaches the post-loop publish → no double `final`), and the natural-completion path yields a `final` from `agent_loop` (→ `saw_final = True` → no extra frame).

- [ ] **Step 4: Run the new test to verify it passes**

Run: `python3 -m pytest agent/tests/test_server.py::test_drive_tab4_cancel_emits_final -q`
Expected: **PASS**.

- [ ] **Step 5: Run the tab-④ + error-path tests to verify no double-`final` / no regression**

Run: `python3 -m pytest agent/tests/test_server.py -q -k "tab4 or swap_failure or generation_raises or swaps_and_publishes"`
Expected: **all PASS**. In particular `test_drive_swaps_and_publishes_swap_start` (natural tab-④ completion — `agent_loop` yields a `final`) still passes with exactly one `final` frame, and `test_drive_tab4_agent_error_returns_error` (early `_fail` return) still passes — proving the new post-loop publish does not fire on the natural or error paths.

- [ ] **Step 6: Run the full suite**

Run: `python3 -m pytest agent/tests -q`
Expected: **99 passed** (98 before + this test).

- [ ] **Step 7: Update the two doc notes that describe this gap**

(a) In `docs/superpowers/specs/2026-06-28-ai-teaching-relay-design.md` §3.3, the known-limitation bullet added in `a930f23` describes tab-④ stop being *turn-granular*. That latency limitation is still true and stays, but append one sentence noting the missing-`final` half is now fixed. Find:

```
單機單人可接受(agent turn 通常短);要 token 粒度須把 `agent_loop` 的 turn call 改成 streamed + CANCEL-aware(未排程)
```

and append after it (same bullet):

```
。另:cancel 中止 tab④ 後,`drive()` 會補發 `{type:final,content:""}` 收尾(spec §3.3「`publish(final)` 收尾」、§3.6 terminal-final 不變量),故送出鈕會 re-enable——turn 粒度的只是**中止延遲**,不是「卡死」
```

(b) In `docs/superpowers/plans/2026-06-28-ai-teaching-relay-frontend.md`, Task 3 has a "Backend note (out of scope for this plan, log as a follow-up)" (~line 349) saying an AI-triggered `/stop` during a Tab ④ run leaves Send disabled because tab-4 breaks on CANCEL without publishing a `final`. That follow-up is now done. Find the sentence starting `> **Backend note (out of scope for this plan, log as a follow-up):**` and replace the whole blockquote with:

```
> **Backend note (RESOLVED 2026-07-05, commit pending):** an AI-triggered `/stop` during a Tab ④ run previously left Send disabled because `drive()`'s tab-4 branch broke on `CANCEL` without publishing a `final`/`error`. Fixed in `docs/superpowers/plans/2026-07-05-drive-tab4-cancel-final.md`: `drive()` now publishes a terminal `{type:"final",content:""}` on cancel, so the page's `onFinal` re-enables Send even for an AI-side stop. The optimistic client-side re-enable below is now belt-and-suspenders, not load-bearing.
```

- [ ] **Step 8: Commit**

```bash
git add agent/server.py agent/tests/test_server.py \
        docs/superpowers/specs/2026-06-28-ai-teaching-relay-design.md \
        docs/superpowers/plans/2026-06-28-ai-teaching-relay-frontend.md
git commit -m "fix(server): tab-4 cancel publishes terminal final (spec §3.3/§3.6)"
```

---

## Self-Review

**1. Spec coverage:**
- Spec §3.3 (`/stop` → "中止 fan-out、`publish(final)` 收尾") — the fix makes tab-④ conform; ①②③ already conformed via `completion_generate:389`. ✓
- Spec §3.6 terminal-`final` invariant (established `a930f23` for error paths) — extended to the tab-④ cancel path, which is the last non-error exit that could end a run without a `final` frame. ✓
- Frontend plan Task 3 line-349 follow-up — resolved and the note updated (Step 7b). ✓
- No other spec section is affected (swap, health, inspect, ①②③ generation all unchanged). ✓

**2. Placeholder scan:** every step shows the exact test code, the exact old→new code block to replace, and exact `pytest` commands with expected PASS/FAIL. The two doc edits quote the exact strings to find and the exact replacement text. No TBD/TODO. ✓

**3. Type/name consistency:** `saw_final` is a local bool in the tab-④ branch only; the published frame `{"type":"final","content":""}` matches the shape asserted in the test and the shape used by `_fail()` and `completion_generate`. `agent_loop`/`publish`/`CANCEL`/`subscriber_count`/`_fail` are all pre-existing names used with their current signatures. The test drives `server.drive("4", …)` and drains `server.subscribe()` — identical to the neighboring `test_drive_tab4_*` tests. ✓

---

## Notes for the implementer

- **Why `saw_final` and not `if CANCEL.is_set()`:** using a `saw_final` flag also covers the (defensive) case where `agent_loop` exhausts without ever yielding a `final` for any reason, and — more importantly — it is the correct guard against **double-publishing**: if `agent_loop` yielded a `final` and THEN the next `CANCEL` check breaks, `saw_final` is already `True` so we don't emit a second one. Keying off `CANCEL` alone would risk a double `final`.
- **Why the error path is safe:** the `elif ev["type"] == "error"` branch `return`s via `_fail()` *before* the post-loop code, and `_fail()` itself publishes the terminal `final`. So an errored run gets exactly one `final` (from `_fail`), and a cancelled run gets exactly one `final` (from the new post-loop publish), and a natural run gets exactly one `final` (from `agent_loop`). Three exits, one `final` each — verify this mentally against Step 5's test set.
- **CANCEL hygiene in the test:** `drive()` calls `CANCEL.clear()` at its top, so pre-setting `CANCEL` before `drive()` would be wiped — that's why the fake generator sets it *during* iteration. The `finally: server.CANCEL.clear()` guarantees a set flag never leaks into a later test in the same process.
