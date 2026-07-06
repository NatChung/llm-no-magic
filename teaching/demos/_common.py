"""Shared Playwright helpers — CREATOR regression harness (NOT the student demo).

v2 帶課由 AI 用 browser MCP 即時驅動(見 AGENTS.md / lesson playbook);這些 Python script
降為 creator 跑 `--smoke` 的頁面回歸驗證(確認 preset/selector/生成流程沒漂移)。學生不用 pip playwright。

Shared Playwright helpers for the demo smoke harness.

契約(對應 frontend/app.js):
- 切 tab 成功 = `main.tab-panel.active[data-panel=…]` 出現(swap 失敗會 alert 且不切)
- model swap 中 body.swapping;swap 失敗 → alert() → 我們的 dialog handler 接住
- 生成中 .run[disabled],生成完 .run:not([disabled])
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
import urllib.error   # for HTTPError in _post (explicit; don't rely on urllib.request re-export)

BASE = "http://localhost:9000/"
SWAP_TIMEOUT_MS = 120_000   # 第一次 swap 含 model 載入,放寬
GEN_TIMEOUT_MS = 300_000    # 4B agent 多 turn 可能慢

TAB_TO_PANEL = {"1": "basic", "2": "advanced", "3": "reasoning", "4": "agent"}


def log(msg: str) -> None:
    print(msg, flush=True)


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr, flush=True)
    sys.exit(1)


def add_args(ap) -> None:
    ap.add_argument("--segment", type=int, default=0, help="跑第幾段(0 = 全部)")
    ap.add_argument("--lang", choices=["zh-TW", "en"], default="zh-TW")
    ap.add_argument("--smoke", action="store_true", help="headless 快跑全部段落(自驗用)")


def launch(p, args):
    """回 (browser, page, state)。state['dialog'] 非 None = 有 alert(swap 失敗)。"""
    # spec §4:headed 模式 slow_mo 放慢「焦點動作」讓學員看清;smoke 全速
    browser = p.chromium.launch(headless=args.smoke, slow_mo=0 if args.smoke else 300)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.set_default_timeout(15_000)
    state = {"dialog": None}

    def on_dialog(d):
        state["dialog"] = d.message
        d.dismiss()

    page.on("dialog", on_dialog)
    url = BASE + ("index.zh-TW.html" if args.lang == "zh-TW" else "")
    try:
        page.goto(url)
    except Exception:
        die("server 沒起 — 先跑: nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &")
    return browser, page, state


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


def pause(page, args, ms: int):
    """課堂節奏停頓;--smoke 不停。"""
    if not args.smoke:
        page.wait_for_timeout(ms)


def click_token(page, panel, args, nth: int = 0):
    """點第 nth 個 token(0-indexed,對齊 Playwright .nth());等機率 bar chart 出現,回傳 top-1 機率字串。"""
    toks = panel.locator(".generated-text .tok")
    n = toks.count()
    if n == 0:
        die("沒有生成任何 token — prompt 是否為空?")
    toks.nth(min(nth, n - 1)).click()
    panel.locator(".probs .bar-row").first.wait_for(timeout=5_000)
    pause(page, args, 1500)
    return panel.locator(".probs .bar-pct").first.inner_text()


def segments_to_run(args, n_segments: int) -> list[int]:
    if args.smoke or args.segment == 0:
        return list(range(1, n_segments + 1))
    if not 1 <= args.segment <= n_segments:
        die(f"--segment 必須是 1..{n_segments}")
    return [args.segment]


def run_segments(page, panel, args, n_segments: int, fn):
    """跑選定段落;段落內任何 selector/逾時錯誤轉成一行人話再退出(AGENTS.md 的 fail-fast 契約)。"""
    for k in segments_to_run(args, n_segments):
        try:
            fn(page, panel, args, k)
        except SystemExit:
            raise
        except Exception as e:
            first = str(e).splitlines()[0] if str(e) else ""
            die(f"段落 {k} 失敗 — {type(e).__name__}: {first} "
                f"(selector 沒找到或逾時;先 python3 init.py 檢查,再重跑同段落)")
