#!/usr/bin/env python3
"""Tab ③ demo — thinking 開關對照(經典蘋果題)。

段落:1=直答(跳過 thinking,常算錯) 2=用 thinking(把推理寫成 token,通常對)
用法:python3 teaching/demos/demo_tab3.py --segment 1 --lang zh-TW
(prompt 用頁面預填的蘋果題:爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?)
"""
import argparse

from playwright.sync_api import sync_playwright

import _common as c

# 頁面預填的蘋果題(v3 /drive 需要明確文字,不再靠 UI 預填帶入)
PROMPT = "爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?"


def seg1(page, panel_unused, args):
    c.log("[1.1] AI drive tab3 direct:client 強塞空 <think></think>,model 沒空間想")
    c.drive("3", PROMPT, mode="direct")
    panel = c.activate_and_assert(page, "3")
    text = panel.locator(".generated-text").inner_text()
    if not text.strip():
        c.die("tab3 direct drive 後 .generated-text 是空的")
    c.log(f"[1.2] 直答結果:「{text[:60]}」(對照組;小 model 直答常錯)")
    c.pause(page, args, 1500)


def seg2(page, panel_unused, args):
    c.log("[2.1] AI drive tab3 thinking:留空間讓 model 把推理寫成 token")
    c.drive("3", PROMPT, mode="thinking")
    panel = c.activate_and_assert(page, "3")
    panel.locator(".thinking-content").wait_for(timeout=5_000)
    think = panel.locator(".thinking-content").inner_text()
    if not think.strip():
        c.die("tab3 thinking drive 後 .thinking-content 是空的")
    final = panel.locator(".generated-text").inner_text()
    if not final.strip():
        c.die("tab3 thinking drive 後 .generated-text 是空的(post-</think> 答案沒填)")
    c.log(f"[2.2] thinking 內容(節錄):「{think[:80]}…」")
    c.log(f"[2.3] 最終回答:「{final[:60]}」")
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
