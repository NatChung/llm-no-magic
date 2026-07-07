#!/usr/bin/env python3
"""Tab ② demo — 接龍怎麼變問答(3 段)。

段落:1=裸 prompt(接龍/loop) 2=raw + 手打「問:答:」(pattern 生效但無停止邊界)
     3=真 chat template(乾淨作答、有停止邊界)
用法:python3 teaching/demos/demo_tab2.py --segment 1 --lang zh-TW
"""
import argparse

from playwright.sync_api import sync_playwright

import _common as c

PROMPT = "一年有幾個月?"
QA_RAW = "問:一年有幾個月?\n答:"


def _run(page, args, tab, user, expect, *, mode=None, label):
    kwargs = {}
    if mode is not None:
        kwargs["mode"] = mode
    c.log(f"[{label}.1] AI drive tab{tab}:{user!r} ({expect})")
    c.drive(tab, user, **kwargs)
    panel = c.activate_and_assert(page, tab)
    text = panel.locator(".generated-text").inner_text()
    if not text.strip():
        c.die(f"tab{tab} drive 後 .generated-text 是空的")
    c.log(f"[{label}.2] 輸出:「{text[:80]}…」")
    c.pause(page, args, 1500)


def seg1(page, panel_unused, args):
    _run(page, args, "2", PROMPT, "裸 prompt → 預期像 Lesson 1 一樣接龍/loop,不回答",
         mode="raw", label="1")


def seg2(page, panel_unused, args):
    _run(page, args, "2", QA_RAW,
         "raw + 手打「問:答:」→ 預期答對但接著自己循環下一輪(無停止邊界)",
         mode="raw", label="2")


def seg3(page, panel_unused, args):
    _run(page, args, "2", PROMPT,
         "真 chat template → 預期乾淨作答,無循環",
         mode="chat", label="3")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    c.add_args(ap)
    args = ap.parse_args()
    with sync_playwright() as p:
        browser, page, state = c.launch(p, args)
        c.wait_subscribed()
        c.run_segments(page, None, args, 3,
                       lambda pg, pn, a, k: {1: seg1, 2: seg2, 3: seg3}[k](pg, pn, a))
        c.pause(page, args, 2000)
        browser.close()
    c.log("DONE")


if __name__ == "__main__":
    main()
