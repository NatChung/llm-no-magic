#!/usr/bin/env python3
"""Tab ② demo — 裸 prompt vs 產品加工(chat template + system prompt)。

段落:1=裸 prompt 直丟(散開答) 2=加 system + chat 模式(條列) — 同一個問題對比
用法:python3 teaching/demos/demo_tab2.py --segment 1 --lang zh-TW
"""
import argparse

from playwright.sync_api import sync_playwright

import _common as c

PROMPT = "一年有幾個月?"
SYSTEM = "你是行銷顧問,用條列式回答,只給 3 點。"


def seg1(page, panel_unused, args):
    c.log("[1.1] AI drive tab2 raw:只把問題原樣丟給 model(不經 chat template)")
    c.drive("2", PROMPT, mode="raw")
    panel = c.activate_and_assert(page, "2")
    text = panel.locator(".generated-text").inner_text()
    if not text.strip():
        c.die("tab2 raw drive 後 .generated-text 是空的")
    c.log(f"[1.2] raw 輸出:「{text[:80]}…」(預期:散開、可能像接龍)")
    c.pause(page, args, 1500)


def seg2(page, panel_unused, args):
    c.log(f"[2.1] AI drive tab2 chat:system=「{SYSTEM}」+ 產品加工(chat)模式")
    c.drive("2", PROMPT, system=SYSTEM, mode="chat")
    panel = c.activate_and_assert(page, "2")
    text = panel.locator(".generated-text").inner_text()
    if not text.strip():
        c.die("tab2 chat drive 後 .generated-text 是空的")
    c.log(f"[2.2] 加工後輸出:「{text[:80]}…」(預期:整齊條列)")
    c.pause(page, args, 1500)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    c.add_args(ap)
    args = ap.parse_args()
    with sync_playwright() as p:
        browser, page, state = c.launch(p, args)
        c.wait_subscribed()
        c.run_segments(page, None, args, 2,
                       lambda pg, pn, a, k: {1: seg1, 2: seg2}[k](pg, pn, a))
        c.pause(page, args, 2000)
        browser.close()
    c.log("DONE")


if __name__ == "__main__":
    main()
