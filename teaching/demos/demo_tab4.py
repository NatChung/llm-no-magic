#!/usr/bin/env python3
"""Tab ④ demo — agent function calling 真執行(切 4B model,第一次 swap 等 3-5 秒)。

段落:1=現在幾點?(get_time,最快) 2=數 .md 檔(exec_bash 真跑 find)
用法:python3 teaching/demos/demo_tab4.py --segment 1 --lang zh-TW
"""
import argparse

from playwright.sync_api import sync_playwright

import _common as c

PRESETS = {
    1: ("現在幾點?", "get_time"),
    2: ("數一下這個 repo 底下有幾個 .md 檔", "exec_bash"),
}


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


if __name__ == "__main__":
    main()
