#!/usr/bin/env python3
"""Tab ③ demo — thinking 開關對照(經典蘋果題)。

段落:1=直答(跳過 thinking,常算錯) 2=用 thinking(把推理寫成 token,通常對)
用法:python3 teaching/demos/demo_tab3.py --segment 1 --lang zh-TW
(prompt 用頁面預填的蘋果題:爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?)
"""
import argparse

from playwright.sync_api import sync_playwright

import _common as c


def seg1(page, panel, args):
    c.log("[1.1] 直答模式(client 強塞空 <think></think>,model 沒空間想)")
    panel.locator('input[name="mode-reasoning"][value="direct"]').check()
    c.pause(page, args, 800)
    c.log("[1.2] 送出蘋果題")
    c.run_and_wait(panel)
    c.log(f"[1.3] 直答結果:「{panel.locator('.generated-text').inner_text()[:60]}」(對照組;小 model 直答常錯)")


def seg2(page, panel, args):
    c.log("[2.1] thinking 模式(留空間讓 model 把推理寫成 token)")
    panel.locator('input[name="mode-reasoning"][value="thinking"]').check()
    c.pause(page, args, 800)
    c.log("[2.2] 送出同一題 — 注意上方會多出「完整回覆(含 <think>)」區")
    c.run_and_wait(panel)
    think = panel.locator(".thinking-content").inner_text()
    c.log(f"[2.3] thinking 內容(節錄):「{think[:80]}…」")
    c.log(f"[2.4] 最終回答:「{panel.locator('.generated-text').inner_text()[:60]}」")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    c.add_args(ap)
    args = ap.parse_args()
    with sync_playwright() as p:
        browser, page, state = c.launch(p, args)
        panel = c.switch_tab(page, state, "reasoning")
        c.run_segments(page, panel, args, 2,
                       lambda pg, pn, a, k: {1: seg1, 2: seg2}[k](pg, pn, a))
        c.pause(page, args, 2000)
        browser.close()
    c.log("DONE")


if __name__ == "__main__":
    main()
