#!/usr/bin/env python3
"""Tab ① demo — token 接龍 + top-10 機率分佈(3 段,對應 3 個 preset)。

段落:1=床前明月光,疑是地上(peaked) 2=祖樹星(peaked但瞎掰) 3=冰箱(flat)
用法:python3 teaching/demos/demo_tab1.py --segment 1 --lang zh-TW
"""
import argparse

from playwright.sync_api import sync_playwright

import _common as c

# (prompt, 說明, 要點開看分佈的 token index — 0-indexed)
PRESETS = {
    1: ("床前明月光,疑是地上", "背過整首詩 → 預期接「霜」top-1 94%+(peaked)", 0),
    2: ("祖樹星上最高的山叫做", "瞎掰的星球 → 預期照樣自信編(peaked ≠ 真實)", 1),
    3: ("他打開冰箱,拿出", "model 不知接啥 → 預期 top-10 分散(flat)", 1),
}


def run_segment(page, panel, args, k: int):
    prompt, expect, nth = PRESETS[k]
    c.log(f"[{k}.1] 選 preset:{prompt}({expect})")
    c.pick_preset(panel, prompt)
    c.pause(page, args, 800)
    c.log(f"[{k}.2] 送出,看 token 一個一個蹦")
    c.run_and_wait(panel)
    c.log(f"[{k}.3] 點 token 開 top-10 機率圖")
    top1 = c.click_token(page, panel, args, nth=nth)
    c.log(f"[{k}.4] top-1 機率 = {top1} — 生成文字:「{panel.locator('.generated-text').inner_text()[:60]}」")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    c.add_args(ap)
    args = ap.parse_args()
    with sync_playwright() as p:
        browser, page, state = c.launch(p, args)
        panel = c.switch_tab(page, state, "basic")
        c.run_segments(page, panel, args, 3, run_segment)
        c.pause(page, args, 2000)
        browser.close()
    c.log("DONE")


if __name__ == "__main__":
    main()
