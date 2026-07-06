# Relay v3 — 3a Onboarding Teardown + init.py + demos smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tear down the v2 browser-MCP onboarding and retarget it to the shipped v3 HTTP relay: rewrite `init.py` (drop Node/MCP checks, add a `/health` check), delete the MCP config, retarget the creator demo-smoke harness to `POST /drive` + Playwright-observe, update the onboarding docs, and fold in two small backend hardens.

**Architecture:** Four independent tasks, each ending in a testable deliverable. Task 1 (backend hardens) and Task 2 (init.py) are pytest-verified. Task 3 (demos) is verified by running the `--smoke` harness against a live server (Playwright). Task 4 (docs) is verified by grep gates for MCP-residue + bilingual lockstep. Lesson-content rewrite is OUT of scope (separate sub-project 3b).

**Tech Stack:** Python 3 stdlib (`http.server`, `urllib`, `subprocess`), `pytest` + `monkeypatch` (plain functions, no fixtures beyond monkeypatch/tmp_path — match existing style), Playwright sync API (creator-only, for demos).

**Spec:** `docs/superpowers/specs/2026-07-06-relay-onboarding-3a-design.md` (read it; this plan implements §1–§6).

## Global Constraints

- **Backend/config/docs only.** Do NOT touch `frontend/*`, Tab ⑥ skill (`setupSkill`/`.skill-preset`/`/skill-agent`), article tabs, `handle_swap`'s launch/poll logic (except the one reset line in Task 1), or lesson ①–④ **content** (`teaching/lesson-*.md` — that's 3b; only their onboarding-adjacent docs move here, and even those are limited to `teaching/README*`).
- **Bilingual lockstep (docs):** every onboarding-doc change lands identically in BOTH language files — `AGENTS.md` + `AGENTS.zh-TW.md`, `README.md` + `README.en.md`, `teaching/README.md` + `teaching/README.zh-TW.md`. Same structural edit; only prose language differs.
- **`pytest agent/tests -q` must stay green** at the end of every task that touches Python. It is 99 passing at the start of this plan; Task 1 adds tests, Task 2 removes MCP tests and adds `/health` tests.
- **`check_health` semantics (spec §1, review C1):** gate on a server-up signal. If `GET :9000/` returns the `SERVER_MARKER` (`b"LLM, no magic"`) → server is up → `GET /health` MUST return 200 with `"status": "ok"` else FAIL. If `GET :9000/` is `(None, …)` (port empty / not our server) → PASS with a "server 之後再起" note. Never probe `/events` or `/drive`.
- **Reset placement (spec §6.1, review I1):** the `GLOBAL_STATE["model"] = None` reset goes on the line immediately AFTER the `pkill` in `handle_swap` — NOT on every `status != "ready"` return (the pre-pkill `unknown model` and 409 guards must not reset).
- **`/swap` route:** REMOVE it (delete `_handle_swap_route` + its `do_POST` branch). Frontend and retargeted demos never call it (verified).
- **`n_predict`/generation params, `GEN_LOCK`, `publish`, terminal-`final` invariant:** unchanged.
- **Commit trailers (every commit):**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GeRBynD5cg5ry8ricH3xu8
  ```

---

### Task 1: Backend hardens — reset model on swap failure + remove legacy `/swap` route

**Files:**
- Modify: `agent/server.py` (`handle_swap` reset line; delete `_handle_swap_route` + its `do_POST` branch)
- Test: `agent/tests/test_server.py`

**Interfaces:**
- Consumes (existing): `handle_swap(wanted) -> dict`, `GLOBAL_STATE` (dict with `"model"` key), `SWAP_LOCK`, `_is_port_free`, `MODEL_TAG`.
- Produces: no new names. Behavioral: (a) after a post-pkill swap failure, `GLOBAL_STATE["model"] is None`; (b) `POST /swap` returns 404.

- [ ] **Step 1: Write the failing test for the swap-fail reset**

Add to `agent/tests/test_server.py` (near the other `handle_swap` tests, ~line 340):

```python
def test_handle_swap_resets_model_on_post_kill_failure(monkeypatch):
    """After pkill, if the port never frees (or the new llama never loads),
    GLOBAL_STATE['model'] must be reset to None — a stale tag would make the
    next same-model drive skip the swap and hit a dead llama (→ 500)."""
    import agent.server as server
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")   # stale-ish current
    monkeypatch.setattr(server.subprocess, "run", lambda *a, **k: None)  # pkill no-op
    monkeypatch.setattr(server, "_is_port_free", lambda port: False)     # port never frees
    result = server.handle_swap("4B")   # wants 4B, ≠ current → real swap attempt
    assert result["status"] == "error"
    assert "port 8080 still busy" in result["message"]
    assert server.GLOBAL_STATE["model"] is None   # reset happened
```

- [ ] **Step 2: Write the failing test for the pre-kill guards NOT resetting**

Add immediately after:

```python
def test_handle_swap_409_does_not_reset_model(monkeypatch):
    """The 409 'another swap in progress' guard fires BEFORE pkill and this
    thread never held SWAP_LOCK — another swap is setting the real model, so
    resetting here would clobber valid state. Must NOT reset."""
    import agent.server as server
    monkeypatch.setitem(server.GLOBAL_STATE, "model", "0.6B")
    server.SWAP_LOCK.acquire()   # simulate another swap holding the lock
    try:
        result = server.handle_swap("4B")
    finally:
        server.SWAP_LOCK.release()
    assert result.get("code") == 409
    assert server.GLOBAL_STATE["model"] == "0.6B"   # untouched
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `python3 -m pytest agent/tests/test_server.py -q -k "resets_model_on_post_kill or 409_does_not_reset"`
Expected: **2 failed** — the reset line doesn't exist yet, so `test_handle_swap_resets_model_on_post_kill_failure` sees `GLOBAL_STATE["model"] == "0.6B"` (assert None fails). (The 409 test may already pass — that's fine; it's a guard test to prove Step 4 doesn't over-reach.)

- [ ] **Step 4: Add the reset line right after `pkill`**

In `agent/server.py` `handle_swap`, the current block is:

```python
        # 1. Kill the existing llama-server on :8080
        subprocess.run(["pkill", "-f", "llama-server.*--port 8080"], check=False)

        # C2: close the previous log file handle to avoid fd leak
```

Change to:

```python
        # 1. Kill the existing llama-server on :8080
        subprocess.run(["pkill", "-f", "llama-server.*--port 8080"], check=False)
        # Old llama is now dead; :8080 state is unknown until the ready-poll
        # below sets it. Clear the model tag so that if this swap FAILS
        # (port-busy / binary-missing / load-timeout), the next drive won't
        # skip the swap on a stale tag and hit a dead llama (→ 500). The
        # ready-poll re-sets it on success. (spec §6.1)
        GLOBAL_STATE["model"] = None

        # C2: close the previous log file handle to avoid fd leak
```

- [ ] **Step 5: Run the two tests to verify they pass**

Run: `python3 -m pytest agent/tests/test_server.py -q -k "resets_model_on_post_kill or 409_does_not_reset"`
Expected: **2 passed**.

- [ ] **Step 6: Write the failing test for `/swap` route removal**

Find the existing `/swap`-route test(s) in `agent/tests/test_server.py` (search for `"/swap"` — there is a success/409 test around line 463 that POSTs `/swap` and asserts `handle_swap` was routed). Replace the whole set of `/swap`-route HTTP tests with a single removal test:

```python
def test_post_swap_route_removed_returns_404():
    """v3 removed the legacy POST /swap route — the page/demos never call it,
    swaps happen inside /drive."""
    import agent.server as server
    import urllib.request, urllib.error, json
    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/swap",
            data=json.dumps({"model": "4B"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            urllib.request.urlopen(req, timeout=2)
            assert False, "expected 404"
        except urllib.error.HTTPError as e:
            assert e.code == 404
    finally:
        srv.shutdown()
```

(Use whatever `_start_server_in_thread()` / import style the neighboring HTTP tests use — match the file.)

- [ ] **Step 7: Run it to verify it fails**

Run: `python3 -m pytest agent/tests/test_server.py -q -k "post_swap_route_removed"`
Expected: **FAIL** — `/swap` still routes to `_handle_swap_route`, returning 200/500 not 404.

- [ ] **Step 8: Remove the `/swap` route**

In `agent/server.py` `do_POST`, delete the branch:

```python
        elif self.path == "/swap":
            self._handle_swap_route()
```

And delete the entire `_handle_swap_route` method (the `def _handle_swap_route(self) -> None:` block, currently ~lines 638-658). Leave `handle_swap` itself (still used internally by `drive`).

- [ ] **Step 9: Run the full server suite**

Run: `python3 -m pytest agent/tests/test_server.py -q`
Expected: **all pass** (the removed `/swap` success/409 tests are gone; the new 404 + reset + guard tests pass). If any leftover test still references `_handle_swap_route` or POSTs `/swap` expecting 200/409, delete/convert it — grep `grep -n "swap" agent/tests/test_server.py` to be sure none remain expecting the old behavior.

- [ ] **Step 10: Commit**

```bash
git add agent/server.py agent/tests/test_server.py
git commit -m "fix(server): reset model on swap failure + remove legacy /swap route (3a)"
```

---

### Task 2: `init.py` rewrite — drop Node/MCP checks, add `check_health`, delete config

**Files:**
- Modify: `init.py` (remove `check_node`/`check_mcp_config`/`_detect_agents`/`_read_safe`/`MCP_JSON`/`CODEX_TOML`/`restore_mcp_config`; add `check_health`; update `run_checks`/`main`/docstring; flip `Check.warn_label` default)
- Modify: `agent/tests/test_init.py` (remove MCP/Node tests; add `check_health` tests; fix `test_fix_mode_reruns_checks_twice` + the two `warn_label`-default tests)
- Delete: `.mcp.json`, `.codex/config.toml`

**Interfaces:**
- Consumes (existing): `Check` dataclass, `_http_get(url, timeout) -> (status|None, bytes)`, `SERVER_MARKER` (`b"LLM, no magic"`), `check_port_9000`, `summarize`, `main`.
- Produces: `check_health() -> Check` (core, non-warn-only).

- [ ] **Step 1: Write the failing `check_health` tests**

Add to `agent/tests/test_init.py`:

```python
def test_health_server_not_up_passes(monkeypatch):
    # GET / returns (None, b"") → server not up → pass with note
    monkeypatch.setattr(init, "_http_get", lambda url, timeout=1.0: (None, b""))
    c = init.check_health()
    assert c.ok
    assert not c.warn_only

def test_health_server_up_and_healthy_passes(monkeypatch):
    def fake_get(url, timeout=1.0):
        if url.rstrip("/").endswith(":9000") or url.endswith(":9000/"):
            return (200, b"<title>LLM, no magic</title>")
        return (200, b'{"status": "ok", "model": null, "subscribers": 0}')
    monkeypatch.setattr(init, "_http_get", fake_get)
    assert init.check_health().ok

def test_health_server_up_but_health_broken_fails(monkeypatch):
    def fake_get(url, timeout=1.0):
        if "/health" in url:
            return (None, b"")          # /health hangs/refused while server IS up
        return (200, b"<title>LLM, no magic</title>")
    monkeypatch.setattr(init, "_http_get", fake_get)
    c = init.check_health()
    assert not c.ok
    assert not c.warn_only            # core failure
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m pytest agent/tests/test_init.py -q -k "health"`
Expected: **FAIL** — `AttributeError: module 'init' has no attribute 'check_health'`.

- [ ] **Step 3: Implement `check_health`**

In `init.py`, add (place near `check_port_9000`, and reference the same `SERVER_MARKER`):

```python
def check_health() -> Check:
    """server 若在跑,GET /health 必須立即回 200 + status:ok。
    server-up 用 GET / 的 SERVER_MARKER 判定(與 check_port_9000 同訊號),
    以區分「port 空」(pass) vs「server 起了但 /health 壞/hang」(fail)——
    _http_get 把 refused 與 timeout 都收斂成 (None,b'')、無法只靠 /health 分辨。
    不可探 /events(SSE 不結束會 hang)或 /drive(POST 觸發生成)。"""
    _, root_body = _http_get("http://localhost:9000/")
    if SERVER_MARKER not in root_body:
        return Check("Health /health", True, "server 之後再起(/health 屆時檢查)")
    status, body = _http_get("http://localhost:9000/health")
    ok = status == 200 and b'"status": "ok"' in body
    return Check("Health /health", ok,
                 "server 在跑、/health 立即回 200" if ok else "server 在跑但 /health 沒立即回 200",
                 "server 起了但 /health 壞了 — 看 /tmp/agent-server.log")
```

- [ ] **Step 4: Run the `check_health` tests to verify they pass**

Run: `python3 -m pytest agent/tests/test_init.py -q -k "health"`
Expected: **3 passed**.

- [ ] **Step 5: Remove the Node/MCP functions + wire `check_health` into `run_checks`**

In `init.py`:
- Delete functions: `check_node`, `check_mcp_config`, `_detect_agents`, `_read_safe`.
- Delete constants + writer: `MCP_JSON`, `CODEX_TOML`, `restore_mcp_config`.
- In `main`, delete the `if args.fix:` call to `restore_mcp_config()` (keep `apply_fixes` + the re-run). The block becomes:
  ```python
      if args.fix:
          apply_fixes(checks)
          checks = run_checks()  # 補裝後重查
  ```
- In `run_checks`, remove `check_node()` and `check_mcp_config()`, add `check_health()` after `check_port_9000()`:
  ```python
  def run_checks() -> list[Check]:
      return [check_python(), check_llama(), check_hf(),
              *[check_model(size) for size in MODEL_FILES],
              check_requests(),
              check_port_9000(), check_health(), check_port_8080(),
              check_playwright()]
  ```
- Flip the `Check.warn_label` default from `"teaching"` to `"creator"` (review M1 — the `teaching` group is now empty; a forgotten label should land in the real remaining group):
  ```python
      warn_label: str = "creator"
  ```
- Update the top docstring + `--fix` help: remove "MCP 設定" wording; `--fix` now only pip-installs (hf/requests/playwright), writes no config. Update the `Exit:` line (remove "MCP 設定" from the warn-only list; Node is gone too).

- [ ] **Step 6: Delete the MCP config files**

```bash
git rm .mcp.json .codex/config.toml
```

- [ ] **Step 7: Remove the now-orphaned Node/MCP tests + fix the touched tests**

In `agent/tests/test_init.py`:
- Delete these test functions (they test removed code): `test_fix_mode_reruns_checks_twice`'s `restore_mcp_config` line (see below), `test_check_node_missing`, `test_check_node_present`, `test_detect_agents_claude_only`, `test_detect_agents_both`, `test_mcp_config_ok_for_claude`, `test_mcp_config_missing_codex_toml`, `test_mcp_config_codex_string_scan`, `test_mcp_config_no_agents`, `test_restore_mcp_config_writes_when_missing`.
- In `test_fix_mode_reruns_checks_twice`, DELETE only the line `monkeypatch.setattr(init, "restore_mcp_config", lambda: None)` (review I2 — `restore_mcp_config` no longer exists; `raising=True` would `AttributeError`). Keep the rest of that test.
- `test_summarize_playwright_warn_only_is_exit_0` (line 59-66): it builds `init.Check("playwright(教學用)", False, warn_only=True)` with the default label and asserts `"WARN teaching" in line`. Now the default is `"creator"` — update the assertion to `"WARN creator" in line` (review M2), and optionally rename the check to `"playwright(creator 驗證用)"` for accuracy.
- `test_summarize_groups_warn_by_label` (line 164): keep as-is — it sets labels explicitly (`teaching`/`creator`) and validates the grouping mechanism, which still works with self-constructed Checks. No change needed.

- [ ] **Step 8: Run the full init suite**

Run: `python3 -m pytest agent/tests/test_init.py -q`
Expected: **all pass**. Then `grep -n "check_node\|check_mcp_config\|restore_mcp_config\|_detect_agents\|_read_safe\|MCP_JSON\|CODEX_TOML" init.py agent/tests/test_init.py` → **nothing** (all removed).

- [ ] **Step 9: Real-run sanity (both server states)**

Run: `python3 init.py` (server not up) → `Health /health` line shows `✓ … server 之後再起`, no `Node/npx`/`browser MCP` lines, `READY` at the end. Then start the server (`nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`), wait ~3s, `python3 init.py` again → `✓ Health /health — server 在跑、/health 立即回 200`. Confirm the whole run prints no `MCP`/`Node` text.

- [ ] **Step 10: Commit**

```bash
git add init.py agent/tests/test_init.py .mcp.json .codex/config.toml
git commit -m "feat(init): drop Node/MCP checks, add /health check, delete MCP config (3a)"
```

---

### Task 3: Retarget the demo smoke harness to `/drive` + Playwright-observe

**Files:**
- Modify: `teaching/demos/_common.py` (remove `pick_preset`; rework `switch_tab`/`run_and_wait` into a drive+observe model; add `wait_subscribed`/`drive`/`assert_reflected`/`inspect`)
- Modify: `teaching/demos/demo_tab1.py`, `demo_tab2.py`, `demo_tab3.py`, `demo_tab4.py` (drive via `/drive`, observe via Playwright)

**Interfaces:**
- Produces (in `_common.py`, consumed by the four demos):
  - `wait_subscribed(timeout_s=10) -> None` — poll `GET :9000/health` until `subscribers >= 1`; `die()` on timeout.
  - `drive(tab, user, system="", mode="") -> dict` — `POST :9000/drive` via stdlib `urllib`, return parsed JSON (`{tokens|turns, final, subscribers, ...}` or `{error}`).
  - `activate_and_assert(page, tab, timeout_ms) -> Locator` — (spec §4 calls this `assert_reflected`; the code name `activate_and_assert` governs) wait for `main.tab-panel.active[data-panel=<TAB_TO_PANEL[tab]>]` (drive_start auto-switches) + return that panel locator.
  - `inspect(tab, token_index) -> None` — `POST :9000/inspect {tokenIndex}`.
  - unchanged: `log`, `die`, `add_args`, `pause`, `launch`, `segments_to_run`, `run_segments`, `click_token`.
- Consumes: page is subscribed to `/events` on load (`connectEvents` at `DOMContentLoaded`); frame contract from `frontend/app.js` (`TAB_TO_PANEL = {"1":"basic","2":"advanced","3":"reasoning","4":"agent"}`).

- [ ] **Step 1: Add the relay helpers to `_common.py`**

At the top of `teaching/demos/_common.py`, add stdlib imports and the tab map:

```python
import json
import time
import urllib.request

TAB_TO_PANEL = {"1": "basic", "2": "advanced", "3": "reasoning", "4": "agent"}
```

Add these helpers (after `launch`):

```python
def _post(path: str, payload: dict, timeout: float = 60.0):
    req = urllib.request.Request(
        BASE.rstrip("/") + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")


def wait_subscribed(timeout_s: float = 10.0) -> None:
    """Poll GET /health until the page's EventSource has subscribed (else the
    drive fans out to nobody). die() on timeout."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(BASE.rstrip("/") + "/health", timeout=2) as r:
                if json.loads(r.read().decode("utf-8")).get("subscribers", 0) >= 1:
                    return
        except Exception:
            pass
        time.sleep(0.2)
    die("頁面沒訂閱 /events(subscribers 一直是 0)— 頁面有開嗎?server 起了嗎?")


def drive(tab: str, user: str, system: str = "", mode: str = "") -> dict:
    """POST /drive; return the aggregate JSON the AI would read. die() on 5xx."""
    payload = {"tab": tab, "user": user}
    if system:
        payload["system"] = system
    if mode:
        payload["mode"] = mode
    status, body = _post("/drive", payload, timeout=GEN_TIMEOUT_MS / 1000)
    if status != 200:
        die(f"/drive 回 {status}: {body.get('error', body)}")
    return body


def activate_and_assert(page, tab: str, timeout_ms: int = SWAP_TIMEOUT_MS):
    """drive_start auto-switches the visible tab (spec §3.6); wait for the driven
    panel to be active + swap banner gone, return its locator."""
    panel_name = TAB_TO_PANEL[tab]
    page.wait_for_selector(f'main.tab-panel.active[data-panel="{panel_name}"]',
                           timeout=timeout_ms)
    page.wait_for_selector("body:not(.swapping)", timeout=timeout_ms)
    return page.locator(f'main[data-panel="{panel_name}"]')


def inspect(tab: str, token_index: int) -> None:
    _post("/inspect", {"tokenIndex": token_index}, timeout=5)
```

Then DELETE `pick_preset` (its `.preset-select` target is gone) and DELETE the old `switch_tab` (its swap-on-click / `body:not(.swapping)`-after-click model is stale — v3 tab-switch is UI-only, the swap happens inside `/drive`). Keep `run_and_wait` and `click_token` for now — `click_token` still works (page-side token click → probs); a demo may still use it. `run_and_wait` (UI Send-button driving) is no longer used by the retargeted demos and can be deleted; if unsure, delete it and re-add only if a demo needs page-side Send.

- [ ] **Step 2: Retarget `demo_tab1.py`**

Replace `demo_tab1.py`'s `run_segment` + `main` with the drive+observe model:

```python
def run_segment(page, panel_unused, args, k: int):
    prompt, expect, nth = PRESETS[k]
    c.log(f"[{k}.1] AI drive tab1:{prompt}({expect})")
    result = c.drive("1", prompt)
    panel = c.activate_and_assert(page, "1")
    top1 = result["tokens"][0]["prob"] if result.get("tokens") else None
    c.log(f"[{k}.2] 首 token「{result['tokens'][0]['token']}」prob={top1:.3f}")
    c.pause(page, args, 800)
    c.log(f"[{k}.3] /inspect token {nth} → 頁面彈機率圖")
    c.inspect("1", nth)
    panel.locator(".probs .bar-row").first.wait_for(timeout=5_000)
    c.log(f"[{k}.4] 頁面生成文字:「{panel.locator('.generated-text').inner_text()[:60]}」")
    c.pause(page, args, 1500)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    c.add_args(ap)
    args = ap.parse_args()
    with sync_playwright() as p:
        browser, page, state = c.launch(p, args)
        c.wait_subscribed()
        c.run_segments(page, None, args, 3, run_segment)
        c.pause(page, args, 2000)
        browser.close()
    c.log("DONE")
```

- [ ] **Step 3: Retarget `demo_tab2.py` and `demo_tab3.py`**

Same pattern. `demo_tab2.py` drives `c.drive("2", prompt, system=SYS, mode=<"raw"|"chat">)` per its presets and asserts the panel reflects (generated-text non-empty; raw vs chat visibly differ). `demo_tab3.py` drives `c.drive("3", prompt, mode=<"direct"|"thinking">)`; for `thinking`, assert the `.thinking-content` fills and the `.final-content` (post-`</think>`) populates. Read each file's existing `PRESETS`/`SYS` and keep the same prompts/segments — only swap the driving mechanism (`pick_preset`+`run_and_wait` → `drive`+`activate_and_assert`). Preserve each demo's existing `--segment`/`--lang`/`--smoke` args via `c.add_args`.

- [ ] **Step 4: Retarget `demo_tab4.py`**

```python
def run_segment(page, panel_unused, args, k: int):
    prompt, tool = PRESETS[k]
    c.log(f"[{k}.1] AI drive tab4:{prompt}(預期 <tool_call> {tool};首次含 0.6B→4B swap)")
    result = c.drive("4", prompt)   # drive() timeout covers swap + multi-turn
    panel = c.activate_and_assert(page, "4")
    turns = panel.locator(".turns .turn-block").count()
    final = panel.locator(".final-content").inner_text()
    c.log(f"[{k}.2] 共 {turns} 個 turn;final answer:「{final[:80]}」")
    c.pause(page, args, 2000)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    c.add_args(ap)
    args = ap.parse_args()
    with sync_playwright() as p:
        browser, page, state = c.launch(p, args)
        c.wait_subscribed()
        c.run_segments(page, None, args, 2, run_segment)
        browser.close()
    c.log("DONE")
```

- [ ] **Step 5: Sanity — no stale references**

Run: `grep -rn "pick_preset\|switch_tab\|preset-select" teaching/demos/` → **nothing**.
Run: `python3 -c "import ast,sys; [ast.parse(open(f).read()) for f in __import__('glob').glob('teaching/demos/*.py')]"` → no output (all parse).

- [ ] **Step 6: Run the smoke against a live server (controller runs this gate)**

Ensure the server is up and a browser page is NOT required to be pre-opened (the demo opens its own via `launch`). For each tab:
Run: `python3 teaching/demos/demo_tab1.py --smoke` → ends `DONE`, no `ERROR:`.
Then `demo_tab2.py --smoke`, `demo_tab3.py --smoke`, `demo_tab4.py --smoke` (tab4 includes a real 0.6B→4B swap; allow time). Each must print `DONE`. This is the layer-2 smoke: the demo drives via `/drive` and Playwright confirms the page reflected.

> Note for the controller: `demo` opens its own headless page (`launch`), which subscribes to `/events`; `wait_subscribed` then gates on `subscribers>=1` before driving. If a demo hangs on `wait_subscribed`, the page's `connectEvents` didn't run — check the server is serving the current `app.js` (`?v=61`).

- [ ] **Step 7: Commit**

```bash
git add teaching/demos/
git commit -m "feat(demos): retarget smoke to POST /drive + Playwright observe (3a)"
```

---

### Task 4: Onboarding docs — drop MCP-approval, describe the relay flow (bilingual)

**Files:**
- Modify: `AGENTS.md` + `AGENTS.zh-TW.md` ("Student → teaching mode" + "Driving the page" + Troubleshooting)
- Modify: `README.md` + `README.en.md` (setup + the "how teaching works" sentence, ~lines 66-67)
- Modify: `teaching/README.md` + `teaching/README.zh-TW.md` (onboarding/division-of-labour only — NOT lesson playbooks)

**Interfaces:** none produced; documentation + grep gates.

- [ ] **Step 1: Rewrite the AGENTS student-mode section (both files)**

In `AGENTS.md` "## Student → teaching mode", make these structural edits (mirror identically in `AGENTS.zh-TW.md`):
- **Step 1:** remove "Teaching needs **Node/npx + a browser MCP** (Playwright MCP, shipped as `.mcp.json` / `.codex/config.toml`)". Replace with: teaching needs only an HTTP-capable AI (Claude Code / Codex driving via Bash `curl`) + a browser the student opens once. `python3 init.py --fix` installs pip-class deps (no config written). Keep the `WARN creator:` playwright note.
- **Step 2 (delete entirely):** the "Approve the browser MCP once … `/mcp`, approve `playwright` … Codex trust the folder" step is gone. Renumber the remaining steps.
- **Step (open teaching/README):** change "**You (the AI) drive the page via the browser MCP**" → "**You (the AI) drive the page via the relay**: `POST /drive` to run each action, and the page reflects live via its `/events` subscription. First `GET /health` to confirm `subscribers >= 1` (else ask the student to open http://localhost:9000/). Leave the browser open for the student to try." Keep "do NOT fall back to the Python demo scripts as the student-facing demo (creator's `--smoke` harness)".
- **"### Driving the page via MCP — how to wait / handle failure":** retitle to "### Driving the page via the relay" and rewrite the bullets:
  - *Model swap:* driving a tab-4 action (or any model-changing tab) triggers a 0.6B↔4B swap inside `/drive`; the page shows a "loading model" banner (from the `swap_start` frame). The `/drive` call returns after generation completes — no snapshot-polling needed.
  - *Generation done:* `/drive` returns the aggregate (tokens/turns/final) when done; the page's Send re-enables on the terminal `final`.
  - *Swap failure:* a failed swap returns `/drive` 5xx `{error}` and the page shows the error + recovers (no freeze). Narrate the failure and follow Troubleshooting (port 8080).
- **Troubleshooting:** remove any MCP-config / `/mcp` / Node lines; keep port 8080 / server-not-up / lsof guidance.

- [ ] **Step 2: Fix the README mechanism sentence (both files)**

In `README.md` and `README.en.md` (~lines 66-67, review I3): both the prerequisites line ("checks … Node/npx + a browser MCP") AND the mechanism sentence ("the AI drives one browser itself via a browser MCP") must change. New prerequisites: HTTP-capable AI + a browser opened once (no Node/MCP). New mechanism: the AI drives the page over HTTP (`POST /drive`) and the page reflects live via SSE (`/events`); no browser automation / MCP.

- [ ] **Step 3: Update teaching/README onboarding (both files)**

In `teaching/README.md` + `.zh-TW.md`, update ONLY the onboarding + division-of-labour prose that says the AI drives via browser MCP → drives via `POST /drive` / page reflects via `/events`. Do NOT touch lesson-①–④ playbook segments (3b owns those). Optionally add the spec §8 transitional note ("lesson 內文改寫中,以 AI 實際帶課為準").

- [ ] **Step 4: Grep gates (bilingual lockstep + no MCP residue)**

Run each and confirm:
- `grep -rin "browser MCP\|Playwright MCP\|/mcp\|Pending approval\|\.mcp\.json\|mcp_servers\|trust the folder" AGENTS.md AGENTS.zh-TW.md README.md README.en.md teaching/README.md teaching/README.zh-TW.md` → **nothing** (all onboarding MCP references gone).
- `grep -rin "npx\|Node/npx\|Node\.js" AGENTS.md AGENTS.zh-TW.md README.md README.en.md` → **nothing** (Node no longer a student dep).
- Spot-check lockstep: each EN file and its language sibling changed the same sections (diff the two `git diff --stat` line counts are comparable; structurally the same edits).
- `POST /drive` (or `/drive`) now appears in AGENTS.md, AGENTS.zh-TW.md, and both teaching/README files.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md AGENTS.zh-TW.md README.md README.en.md teaching/README.md teaching/README.zh-TW.md
git commit -m "docs(onboarding): drop browser-MCP flow, describe relay driving (3a)"
```

---

## Self-Review

**1. Spec coverage** (vs `2026-07-06-relay-onboarding-3a-design.md`):
- §1 init.py rewrite (remove Node/MCP, add check_health, warn_label default) → Task 2. ✓
- §2 delete `.mcp.json`/`.codex/config.toml` → Task 2 Step 6. ✓
- §3 test_init.py rewrite (incl. the I2 `test_fix_mode_reruns_checks_twice` line) → Task 2 Step 7. ✓
- §4 demos retarget (`wait_subscribed`/`drive`/`assert_reflected`(→`activate_and_assert`)/`inspect`, remove `pick_preset`) → Task 3. ✓
- §5 onboarding docs (AGENTS/README/teaching-README, I3 README lines) → Task 4. ✓
- §6.1 swap-fail reset at pkill (I1) → Task 1 Steps 1-5. ✓ · §6.2 remove `/swap` route → Task 1 Steps 6-9. ✓
- §7 testing (pytest green, demos --smoke, real init.py run) → Task 1/2 pytest + Task 2 Step 9 + Task 3 Step 6. ✓
- §8 transitional note → Task 4 Step 3 (optional). ✓  · Deferred (frontend #3, lessons) not in any task. ✓

**2. Placeholder scan:** every code step shows real code; doc steps (Task 4) give exact target strings + grep gates (verbatim bilingual prose can't be inlined, but the structural edits + gates are concrete). No TBD/TODO. The one judgment left open — delete-vs-keep `run_and_wait`/`click_token` in Task 3 Step 1 — is bounded ("delete if unused; re-add if a demo needs page-side Send") and non-blocking. ✓

**3. Type/name consistency:** `check_health` (Task 2) matches its 3 tests; `drive`/`wait_subscribed`/`activate_and_assert`/`inspect` names match between `_common.py` (Task 3 Step 1) and the demo call sites (Steps 2-4); `TAB_TO_PANEL` values (`basic/advanced/reasoning/agent`) match `frontend/app.js` and the `data-panel` selectors; `GLOBAL_STATE["model"]`/`SWAP_LOCK`/`SERVER_MARKER` match server/init code. The Interfaces block of Task 3 says `assert_reflected` but the code names it `activate_and_assert` — the code name governs; call sites use `activate_and_assert`. ✓ (fixed inline: use `activate_and_assert` everywhere.)

---

## Notes for the implementer

- **Task order matters only loosely:** Task 1 (backend) and Task 2 (init.py) are independent; Task 3 (demos) needs the server runnable but not Task 1/2's changes; Task 4 (docs) is independent. Recommended order 1→2→3→4 (lock the backend, then onboarding, then the harness that exercises it, then docs describing it). Each ends green/committable on its own.
- **Demos have no pytest** — Task 3's gate is `--smoke` printing `DONE` against a live server, run by the controller. Do not invent a pytest for the demos.
- **Bilingual is a hard gate** (Task 4): the grep for MCP residue must be clean across ALL SIX doc files, and the same structural edit must appear in each language pair. A one-file edit is an incomplete task.
- **Do not touch** lesson ①–④ content, Tab ⑥ skill, `frontend/*`, or `handle_swap`'s launch/poll logic (only the one reset line).
