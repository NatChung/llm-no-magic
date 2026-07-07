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
    3: ("他打開冰箱,拿出一包", "model 不知接啥 → 預期 top-10 分散(flat,top-1 只一成多)", 1),
}


def run_segment(page, panel_unused, args, k: int):
    prompt, expect, nth = PRESETS[k]
    c.log(f"[{k}.1] AI drive tab1:{prompt}({expect})")
    result = c.drive("1", prompt)
    panel = c.activate_and_assert(page, "1")
    toks = result.get("tokens") or []
    if not toks:
        c.die(f"tab1 drive 沒回 tokens:{result}")
    c.log(f"[{k}.2] 首 token「{toks[0]['token']}」prob={toks[0]['prob']:.3f}")
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


if __name__ == "__main__":
    main()
