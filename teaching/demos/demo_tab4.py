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


def run_segment(page, panel, args, k: int):
    prompt, tool = PRESETS[k]
    c.log(f"[{k}.1] 選 preset:{prompt}(預期 model 吐 <tool_call> 呼叫 {tool})")
    c.pick_preset(panel, prompt)
    c.pause(page, args, 800)
    c.log(f"[{k}.2] 送出 — 看 turn 軌跡:紫色「↑ 工具呼叫」→ 綠色「↓ 工具結果」→ 下一 turn")
    c.run_and_wait(panel)
    turns = panel.locator(".turns .turn-block").count()
    final = panel.locator(".final-content").inner_text()
    c.log(f"[{k}.3] 共 {turns} 個 turn;final answer:「{final[:80]}」")
    c.pause(page, args, 2000)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    c.add_args(ap)
    args = ap.parse_args()
    with sync_playwright() as p:
        browser, page, state = c.launch(p, args)
        panel = c.switch_tab(page, state, "agent")   # 觸發 0.6B→4B swap
        c.run_segments(page, panel, args, 2, run_segment)
        browser.close()
    c.log("DONE")


if __name__ == "__main__":
    main()
