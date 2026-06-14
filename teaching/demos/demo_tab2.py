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


def seg1(page, panel, args):
    c.log("[1.1] 裸 prompt 模式(raw):只把問題原樣丟給 model")
    panel.locator('input[name="mode-advanced"][value="raw"]').check()
    c.pick_preset(panel, PROMPT)
    c.pause(page, args, 800)
    c.log("[1.2] 送出")
    c.run_and_wait(panel)
    c.log(f"[1.3] raw 輸出:「{panel.locator('.generated-text').inner_text()[:80]}…」(預期:散開、可能像接龍)")


def seg2(page, panel, args):
    c.log(f"[2.1] 填 system prompt:「{SYSTEM}」+ 切到產品加工(chat)模式")
    panel.locator(".system-prompt").fill(SYSTEM)
    panel.locator('input[name="mode-advanced"][value="chat"]').check()
    c.pick_preset(panel, PROMPT)
    c.log("[2.2] 展開「實際送進 model 的 final prompt」preview — 看 <|im_start|> marker 怎麼包")
    panel.locator(".preview-details summary").click()
    c.pause(page, args, 2500)
    c.log("[2.3] 送出")
    c.run_and_wait(panel)
    c.log(f"[2.4] 加工後輸出:「{panel.locator('.generated-text').inner_text()[:80]}…」(預期:整齊條列)")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    c.add_args(ap)
    args = ap.parse_args()
    with sync_playwright() as p:
        browser, page, state = c.launch(p, args)
        panel = c.switch_tab(page, state, "advanced")
        c.run_segments(page, panel, args, 2,
                       lambda pg, pn, a, k: {1: seg1, 2: seg2}[k](pg, pn, a))
        c.pause(page, args, 2000)
        browser.close()
    c.log("DONE")


if __name__ == "__main__":
    main()
