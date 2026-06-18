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

import sys

BASE = "http://localhost:9000/"
SWAP_TIMEOUT_MS = 120_000   # 第一次 swap 含 model 載入,放寬
GEN_TIMEOUT_MS = 300_000    # 4B agent 多 turn 可能慢


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


def switch_tab(page, state, tab_id: str):
    """點 tab、等 swap 完成 + panel active;swap 失敗就 die。"""
    state["dialog"] = None
    page.click(f'.tab[data-tab="{tab_id}"]')
    try:
        page.wait_for_selector(f'main.tab-panel.active[data-panel="{tab_id}"]',
                               timeout=SWAP_TIMEOUT_MS)
    except Exception:
        if state["dialog"]:
            die(f"model swap 失敗: {state['dialog']} — 看 AGENTS.md Troubleshooting(port 8080)")
        die(f"切到 tab {tab_id} 逾時 — server / llama-server 狀態請用 init.py 檢查")
    page.wait_for_selector("body:not(.swapping)", timeout=SWAP_TIMEOUT_MS)
    return page.locator(f'main[data-panel="{tab_id}"]')


def pick_preset(panel, value: str):
    panel.locator(".preset-select").select_option(value)


def run_and_wait(panel):
    """按送出、等生成結束(.run 回到 enabled)。

    生成「啟動」用 MutationObserver latch 抓,不直接 wait 那個瞬態 .run[disabled]:
    短生成(如 chat 模式條列答)的 disabled 視窗只有 ~300ms,可能比 click 後、wait 前
    的 slow_mo 延遲還短 → 直接 wait 會間歇性錯過瞬態而逾時。latch 是單調旗標,設了就不會
    被錯過。空 prompt → app.js guard 不送 → 旗標永不為真 → wait_for_function 逾時(預期)。
    """
    page = panel.page
    page.evaluate(
        """() => {
            const el = document.querySelector('main.tab-panel.active .run');
            window.__genStarted = el.disabled;
            window.__genObs = new MutationObserver(
                () => { if (el.disabled) window.__genStarted = true; });
            window.__genObs.observe(el, {attributes: true, attributeFilter: ['disabled']});
        }"""
    )
    panel.locator(".run").click()
    page.wait_for_function("() => window.__genStarted === true", timeout=10_000)  # 生成已啟動
    panel.locator(".run:not([disabled])").wait_for(timeout=GEN_TIMEOUT_MS)        # 生成結束
    page.evaluate("() => { if (window.__genObs) window.__genObs.disconnect(); }")


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
