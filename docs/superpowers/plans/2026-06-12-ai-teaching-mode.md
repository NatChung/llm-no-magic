# AI 帶課模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓學員用 Claude Code / Codex 打開 repo 時，AI 能自我介紹、判定角色（creator vs 學員）、用 init.py 檢查環境，並照 teaching/ 劇本跑 Playwright demo 帶完 Tab ①–④ 互動教學；同時把網頁上的 Hook 問答拆掉、內容遷移進教材。

**Architecture:** 純 markdown 慣例（方案 A）：AGENTS.md 進場 + 角色閘門 → teaching/ 雙語 lesson 劇本 + Playwright(Python) demo scripts（`--segment` 自包含 invocation，「預告→跑→debrief」三拍）。網頁退回純儀器（hook gate / flip-table 移除，`(?)` explainer 保留）。

**Tech Stack:** Python 3.10+ stdlib（init.py）、playwright（pip，僅教學 demo 用）、現有 stdlib http.server + llama.cpp 不動。

**Spec:** `docs/superpowers/specs/2026-06-12-ai-teaching-mode-design.md`

---

## File Structure

```
AGENTS.md                  新增 — 進場點（英文，agent 自動讀這份）
AGENTS.zh-TW.md            新增 — 中文對照（人讀）
CLAUDE.md                  新增 — 一行 @AGENTS.md
init.py                    新增 — stdlib-only 環境檢查（repo root）
agent/tests/test_init.py   新增 — init.py 單元測試
teaching/
  README.md / README.zh-TW.md          新增 — 帶課總綱
  lesson-1-basics(.zh-TW).md           新增 — Tab ①
  lesson-2-product(.zh-TW).md          新增 — Tab ②
  lesson-3-reasoning(.zh-TW).md        新增 — Tab ③
  lesson-4-agent(.zh-TW).md            新增 — Tab ④
  demos/
    _common.py                         新增 — Playwright 共用 helpers
    demo_tab1.py … demo_tab4.py        新增 — 各 tab demo（--segment/--lang/--smoke）
frontend/index.html        修改 — 拆 hook、Tab ⓪ 文案、stale comment、v=56
frontend/index.zh-TW.html  修改 — 同上
frontend/styles.css        修改 — 刪 hook 規則（114-135 行）
frontend/hooks.js          刪除
README.md / README.zh-TW.md 修改 — 加「AI 帶課模式」一節
```

關鍵既有事實（執行者不用再查）：

- Hook 標記位置兩份 HTML **行號相同**：Hook A gate `98-137`、`.hook-content` 開 `138` / revisit-bar `139` / 關 `164`；Hook B gate `340-372`、content 開 `373` / revisit bar `374` / 關 `443`；Tab ⑧ recap mount `679`；hooks.js script tag `857`（zh-TW）/ `858`（EN）；Tab ⓪ 承諾段落 `92`；stale `:8082` comment `337`
- styles.css hook 區塊 = `114-135` 行（`/* Before/After hooks */` 起到檔尾）
- cache-bust 現值 `?v=55`（styles.css / app.js / hooks.js 三處，兩份 HTML 都有）→ 改完 bump `v=56`
- Playwright 操作契約：tab 鈕 `.tab[data-tab="basic|advanced|reasoning|agent"]`；切 tab 成功的訊號 = `main.tab-panel.active[data-panel="<id>"]` 出現（swap 失敗會 `alert()` 且 tab 不切）；swap 期間 `body.swapping`；每 panel 內 `.preset-select` / `.prompt` / `.run` / `.stop` / `.generated-text` / `.probs` / `.system-prompt`(②④) / `.final-prompt-preview`(②③④) / `input[name="mode-advanced"]`(raw|chat) / `input[name="mode-reasoning"]`(direct|thinking) / `.thinking-area`+`.thinking-content`(③) / `.turns`+`.turn-block`+`.final-content`(④)；生成中 `.run[disabled]`，生成完 `.run:not([disabled])`；token = `.generated-text .tok`（①②③ 可點，點了 `.probs` 填 `.bar-row`）
- preset 填法：`select_option` 後 app.js 的 change handler 會把值填進 `.prompt` 並把 select 跳回 index 0
- GET `http://localhost:9000/` 的 body 識別 marker 是 **`LLM, no magic`**（title 文字；body 沒有 "llm-no-magic" 字串）
- 既有 43 tests 跑法：`pytest agent/tests -q`；test 風格 = plain pytest functions + monkeypatch/mock（見 test_server.py）；repo root 在 sys.path（tests 直接 `from agent.server import …`），所以 `import init` 可用

---

### Task 1: 拆 hook — index.zh-TW.html

**Files:**
- Modify: `frontend/index.zh-TW.html`

- [ ] **Step 1: 改 Tab ⓪ 承諾段落（line 92）**

整行 `<p>課程中有兩個時刻…</p>` 換成：

```html
      <p>用 Claude Code / Codex 打開這個 repo,AI 會自己讀說明、帶你跑這堂課:開場跟中場會先問你真實工作場景的問題,等你懂了原理,再讓你看自己的判斷怎麼變。<strong>沒有魔法 — 只有 token、約定,跟你能驗證的工具呼叫。</strong></p>
```

- [ ] **Step 2: 移除 Hook A gate + unwrap content（lines 98-164 區域）**

刪掉整個 `<div class="hook-gate max-w-3xl mx-auto" data-hook="A">…</div>`（98-137 行，含 `.hook-before`、`.hook-revisit`）。
刪掉 `<div class="hook-content">`（138）、revisit-bar 整行（139：`<div class="hook-revisit-bar text-right max-w-2xl">…</div>`）、`</div><!-- /.hook-content -->`（164）。
**保留** `.prompt-area` / `.output-area` / `.probs-area` 三個 `<section>` 原樣，unwrap 後它們成為 `main[data-panel="basic"]` 的直接子元素（desktop grid 依賴這點）。

- [ ] **Step 3: 修 stale comment（line 337）**

```html
  <!-- ─────────────────────────────────────────────────────────────────
       Tab 4: Agent — 真執行 tools(server :9000 /agent)
       ───────────────────────────────────────────────────────────────── -->
```

- [ ] **Step 4: 移除 Hook B gate + unwrap content（lines 340-443 區域）**

刪 `<div class="hook-gate max-w-3xl mx-auto" data-hook="B">…</div>`（340-372）。
刪 `<div class="hook-content">`（373）、revisit 按鈕整行（374：`<div class="text-right max-w-2xl"><button class="hook-revisit-btn …`）、`</div><!-- /.hook-content -->`（443）。保留內部三個 `<section>`（prompt-area / turns-area / final-area）。

- [ ] **Step 5: 移除 Tab ⑧ recap mount（line 679）**

刪整行 `<section class="hook-recap space-y-4" data-hook-recap></section>`。

- [ ] **Step 6: 刪 hooks.js script tag + bump cache bust**

刪 `<script src="hooks.js?v=55"></script>` 整行；檔內所有 `?v=55` → `?v=56`（styles.css、app.js 兩處）。

- [ ] **Step 7: 驗證**

Run: `grep -c "hook" frontend/index.zh-TW.html`
Expected: `0`
Run: `grep -c "v=56" frontend/index.zh-TW.html`
Expected: `2`

- [ ] **Step 8: Commit**

```bash
git add frontend/index.zh-TW.html
git commit -m "refactor(web): remove hook gates from zh-TW page (migrating to AI-led teaching)"
```

---

### Task 2: 拆 hook — index.html（英文鏡像）

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: 改 Tab ⓪ 承諾段落（line 92）**

整行 `<p>Two moments in the course (before Tab ① and Tab ④) will ask you a real-wor…</p>` 換成：

```html
      <p>Open this repo with Claude Code / Codex and the AI will read the docs and run this course with you: at the start and at half-time it asks you a real-work-scenario question first, and once you understand the mechanics it shows you how your own judgement has shifted. <strong>No magic — just tokens, conventions, and tool calls you can verify.</strong></p>
```

- [ ] **Step 2: 同 Task 1 Steps 2-6 鏡像操作**

行號與 zh-TW 版相同（Hook A 98-137 / content 138-139 + 164；Hook B 340-372 / content 373-374 + 443；recap 679；script tag 858）。stale `:8082` comment 同樣修成 `(server :9000 /agent)` 英文版註解。所有 `?v=55` → `?v=56`。

- [ ] **Step 3: 驗證**

Run: `grep -c "hook" frontend/index.html && grep -c "8082" frontend/index.html frontend/index.zh-TW.html`
Expected: 全部 `0`

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html
git commit -m "refactor(web): remove hook gates from EN page (mirror of zh-TW)"
```

---

### Task 3: 刪 hooks.js + styles.css 清理 + 全頁驗證

**Files:**
- Delete: `frontend/hooks.js`
- Modify: `frontend/styles.css`（lines 114-135）

- [ ] **Step 1: 刪 styles.css hook 區塊**

刪掉 line 114 `/* Before/After hooks */` 起到檔尾（135）的整段（`.hook-gate[hidden]…`、`.hook-content { display: contents; }`、`.hook-gate { padding…}`、`.hook-before fieldset`、`.hook-revisit-btn`、`.hook-revisit-bar` media query）。

- [ ] **Step 2: git rm hooks.js**

```bash
git rm frontend/hooks.js
```

- [ ] **Step 3: 跑既有測試**

Run: `pytest agent/tests -q`
Expected: `43 passed`

- [ ] **Step 4: 手動驗證（server 需在跑；沒跑先 `nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`）**

開 `http://localhost:9000/index.zh-TW.html`：
- Tab ① 直接顯示 prompt/輸出/機率三區（無問卷）；desktop 寬度下 grid 正常（prompt 全寬、輸出左機率右）
- Tab ④ 直接顯示 agent 介面；Tab ⑧ 無空白 recap 殘留；console 無 404（hooks.js）
- 英文版 `http://localhost:9000/` 同樣檢查

- [ ] **Step 5: Commit**

```bash
git add frontend/styles.css
git commit -m "refactor(web): drop hooks.js + hook CSS, bump cache-bust to v56"
```

---

### Task 4: init.py（TDD）

**Files:**
- Create: `init.py`
- Test: `agent/tests/test_init.py`

- [ ] **Step 1: 寫測試**

`agent/tests/test_init.py`：

```python
"""Unit tests for init.py environment checker (stdlib-only, repo root)."""
import sys

import init


def test_python_check_passes_on_current_interpreter():
    c = init.check_python()
    assert c.ok  # 我們本來就要求 3.10+ 才跑得了 tests


def test_llama_missing(monkeypatch):
    monkeypatch.setattr(init.shutil, "which", lambda _: None)
    c = init.check_llama()
    assert not c.ok
    assert "brew install llama.cpp" in c.fix


def test_model_missing(tmp_path):
    c = init.check_model("0.6B", models_dir=tmp_path)
    assert not c.ok
    assert "hf download Qwen/Qwen3-0.6B-GGUF" in c.fix


def test_model_present(tmp_path):
    (tmp_path / "Qwen3-0.6B-Q4_K_M.gguf").touch()
    assert init.check_model("0.6B", models_dir=tmp_path).ok


def test_port_9000_free(monkeypatch):
    monkeypatch.setattr(init, "_http_get", lambda url, timeout=1.0: (None, b""))
    assert init.check_port_9000().ok


def test_port_9000_own_server(monkeypatch):
    monkeypatch.setattr(init, "_http_get",
                        lambda url, timeout=1.0: (200, b"<title>LLM, no magic</title>"))
    assert init.check_port_9000().ok


def test_port_9000_foreign_process(monkeypatch):
    monkeypatch.setattr(init, "_http_get", lambda url, timeout=1.0: (200, b"<html>vite</html>"))
    monkeypatch.setattr(init, "_lsof", lambda port: "node 123 …")
    c = init.check_port_9000()
    assert not c.ok
    assert "node 123" in c.fix


def test_port_8080_llama_running(monkeypatch):
    monkeypatch.setattr(init, "_http_get", lambda url, timeout=1.0: (200, b"{}"))
    assert init.check_port_8080().ok


def test_summarize_missing_core_is_exit_1():
    checks = [init.Check("llama.cpp", False, fix="brew install llama.cpp")]
    line, code = init.summarize(checks)
    assert code == 1
    assert line.startswith("MISSING:") and "llama.cpp" in line


def test_summarize_playwright_warn_only_is_exit_0():
    checks = [
        init.Check("Python ≥ 3.10", True),
        init.Check("playwright(教學用)", False, warn_only=True),
    ]
    line, code = init.summarize(checks)
    assert code == 0
    assert "WARN teaching" in line


def test_summarize_all_ok():
    line, code = init.summarize([init.Check("x", True)])
    assert (line, code) == ("READY", 0)


def test_main_prints_one_line_per_check_and_summary(monkeypatch, capsys):
    fake = [init.Check("a", True, detail="ok"),
            init.Check("b", False, fix="install b")]
    monkeypatch.setattr(init, "run_checks", lambda: fake)
    code = init.main([])
    out = capsys.readouterr().out
    assert code == 1
    assert "✓ a" in out and "✗ b" in out and "fix: install b" in out
    assert out.strip().endswith("MISSING: b")
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `pytest agent/tests/test_init.py -q`
Expected: collection error `ModuleNotFoundError: No module named 'init'`

- [ ] **Step 3: 寫 init.py**

```python
#!/usr/bin/env python3
"""init.py — clone 後環境檢查(stdlib-only;它的工作是檢查依賴,自己不能有依賴)。

Usage:
    python3 init.py          # 只檢查,一項一行 + 最後一行 summary
    python3 init.py --fix    # pip 類自動補裝;brew / 模型下載印指令請人跑

Exit: 0 = 核心項全過(playwright 缺只 WARN,因為只有教學 demo 需要)、1 = 有核心項缺。
"""
from __future__ import annotations

import argparse
import importlib.util
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

MODELS_DIR = Path.home() / "models"
MODEL_FILES = {"0.6B": "Qwen3-0.6B-Q4_K_M.gguf", "4B": "Qwen3-4B-Q4_K_M.gguf"}
SERVER_MARKER = b"LLM, no magic"  # GET :9000/ 的 <title> 識別字串


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""
    fix: str = ""                                  # 修復指令(印給 user / AI)
    auto_fix: list = field(default_factory=list)   # --fix 可跑的 cmd list(每項一個 argv list)
    warn_only: bool = False                        # 缺了不影響 exit code


def check_python() -> Check:
    v = sys.version_info
    return Check("Python ≥ 3.10", v >= (3, 10), f"{v.major}.{v.minor}.{v.micro}",
                 "裝 Python 3.10+(brew install python@3.12 或 python.org)")


def check_llama() -> Check:
    p = shutil.which("llama-server")
    return Check("llama.cpp", p is not None, p or "", "brew install llama.cpp")


def check_hf() -> Check:
    p = shutil.which("hf")
    return Check("hf CLI", p is not None, p or "",
                 'pip install -U "huggingface_hub[cli]"',
                 auto_fix=[[sys.executable, "-m", "pip", "install", "-U", "huggingface_hub[cli]"]])


def check_model(size: str, models_dir: Path = MODELS_DIR) -> Check:
    fname = MODEL_FILES[size]
    path = models_dir / fname
    return Check(f"Model {size}", path.exists(), str(path),
                 f"hf download Qwen/Qwen3-{size}-GGUF {fname} --local-dir ~/models")


def check_requests() -> Check:
    ok = importlib.util.find_spec("requests") is not None
    return Check("requests", ok, "", "pip install requests",
                 auto_fix=[[sys.executable, "-m", "pip", "install", "requests"]])


def _chromium_installed() -> bool:
    for base in (Path.home() / "Library/Caches/ms-playwright",   # macOS
                 Path.home() / ".cache/ms-playwright"):          # Linux
        if base.is_dir() and any(base.glob("chromium-*")):
            return True
    return False


def check_playwright() -> Check:
    has_pkg = importlib.util.find_spec("playwright") is not None
    ok = has_pkg and _chromium_installed()
    detail = "" if ok else ("chromium browser 未安裝" if has_pkg else "套件未安裝")
    return Check("playwright(教學用)", ok, detail,
                 "pip install playwright && playwright install chromium",
                 auto_fix=[[sys.executable, "-m", "pip", "install", "playwright"],
                           [sys.executable, "-m", "playwright", "install", "chromium"]],
                 warn_only=True)


def _http_get(url: str, timeout: float = 1.0):
    """回 (status, body[:4096]);連不上(= port 空著)回 (None, b'')。"""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read(4096)
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        return None, b""


def _lsof(port: int) -> str:
    try:
        out = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"],
                             capture_output=True, text=True, timeout=5).stdout.strip()
        return out or "(lsof 看不到 — 可能剛釋放)"
    except Exception as e:  # lsof 不在 / timeout
        return f"(lsof failed: {e})"


def check_port_9000() -> Check:
    status, body = _http_get("http://localhost:9000/")
    if status is None:
        return Check("Port 9000", True, "空著(server 之後再起)")
    if SERVER_MARKER in body:
        return Check("Port 9000", True, "本專案 server 已在跑")
    return Check("Port 9000", False, "被其他 process 佔用",
                 "停掉佔用者再重試:\n   " + _lsof(9000))


def check_port_8080() -> Check:
    status, _ = _http_get("http://localhost:8080/v1/models")
    if status is None:
        return Check("Port 8080", True, "空著(llama-server 之後自動起)")
    if status == 200:
        return Check("Port 8080", True, "llama-server 已在跑")
    return Check("Port 8080", False, "被其他 process 佔用(非 llama-server)",
                 "停掉佔用者再重試:\n   " + _lsof(8080))


def run_checks() -> list[Check]:
    return [check_python(), check_llama(), check_hf(),
            check_model("0.6B"), check_model("4B"),
            check_requests(), check_playwright(),
            check_port_9000(), check_port_8080()]


def apply_fixes(checks: list[Check]) -> None:
    for c in checks:
        if c.ok or not c.auto_fix:
            continue
        for cmd in c.auto_fix:
            print(f"→ {' '.join(cmd)}")
            r = subprocess.run(cmd)
            if r.returncode != 0:
                print("   pip 失敗?若訊息是 externally-managed(PEP 668),先建 venv:\n"
                      "   python3 -m venv .venv && source .venv/bin/activate,然後重跑 init.py --fix")
                break


def summarize(checks: list[Check]) -> tuple[str, int]:
    missing = [c.name for c in checks if not c.ok and not c.warn_only]
    warns = [c.name for c in checks if not c.ok and c.warn_only]
    if missing:
        return "MISSING: " + ", ".join(missing), 1
    if warns:
        return "READY + WARN teaching: " + ", ".join(warns) + " missing", 0
    return "READY", 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fix", action="store_true", help="pip 類缺項自動補裝")
    args = ap.parse_args(argv)

    checks = run_checks()
    if args.fix:
        apply_fixes(checks)
        checks = run_checks()  # 補裝後重查

    for c in checks:
        mark = "✓" if c.ok else ("⚠" if c.warn_only else "✗")
        print(f"{mark} {c.name}" + (f" — {c.detail}" if c.detail else ""))
        if not c.ok:
            print(f"   fix: {c.fix}")
    line, code = summarize(checks)
    print(line)
    return code


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `pytest agent/tests -q`
Expected: `55 passed`（43 既有 + 12 新）

- [ ] **Step 5: 真機 smoke**

Run: `python3 init.py; echo "exit=$?"`
Expected: 每項一行、最後 `READY`（或在 Nat 機器上 playwright 沒裝時 `READY + WARN teaching: …`），exit 與 summary 一致

- [ ] **Step 6: Commit**

```bash
git add init.py agent/tests/test_init.py
git commit -m "feat(init): stdlib-only environment checker with --fix"
```

---

### Task 5: AGENTS.md ×2 + CLAUDE.md

**Files:**
- Create: `AGENTS.md`、`AGENTS.zh-TW.md`、`CLAUDE.md`

- [ ] **Step 1: 寫 CLAUDE.md**

```markdown
@AGENTS.md
```

- [ ] **Step 2: 寫 AGENTS.md（英文，agent 自動載入這份）**

```markdown
# AGENTS.md — read this first

> 中文對照:[AGENTS.zh-TW.md](./AGENTS.zh-TW.md)(same content, for human readers)

This repo is **"LLM, no magic"** — a hands-on, fully-local LLM teaching tool: a web UI
(tabs ⓪–⑧) served by a stdlib Python server on :9000, driving llama.cpp + Qwen3 GGUF
models on :8080. Tabs ①–④ are interactive (tokens/probabilities, chat template,
thinking mode, function-calling agent); ⑤–⑧ are articles.

**This repo supports AI-led teaching.** You (the AI agent) can run the course.

## Your first action — ask the user's role

Before anything else, ask:

> Are you the **creator/teacher** of this course (developing or maintaining it),
> or a **student** here to learn how LLMs work?

Then follow the matching mode below. Speak the user's language (zh-TW student →
use the `.zh-TW` files and reply in 繁體中文).

## Creator → development mode

- Architecture: `agent/server.py` (single-port stdlib server :9000 — static frontend
  + `/agent` `/skill-agent` `/swap` `/preview` APIs, auto-launches llama-server :8080),
  `frontend/app.js` (zero-build Tailwind Play CDN UI), `agent/agent.py` (CLI agent loop
  + 4 tools), `teaching/` (AI-led course material), `init.py` (env checker).
- Tests: `pytest agent/tests -q` (plain pytest functions + mocks; keep that style).
- Conventions: **bilingual** — every user-facing change lands in BOTH the EN and zh-TW
  file (`index.html`/`index.zh-TW.html`, `README.md`/`README.zh-TW.md`, lessons).
  Bump the `?v=NN` cache-bust query in both HTML files whenever frontend files change.
- Start server: `nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`

## Student → teaching mode

1. Run `python3 init.py`. If the last line is not `READY*`, walk the user through the
   printed `fix:` lines (`python3 init.py --fix` handles the pip ones). Teaching ALSO
   requires playwright — if the summary has `WARN teaching: playwright missing`,
   install it before continuing (`pip install playwright && playwright install chromium`).
2. Make sure the server is up (init.py reports "本專案 server 已在跑" / start it with the
   command above), then have the student open http://localhost:9000/ (zh-TW:
   http://localhost:9000/index.zh-TW.html).
3. Open `teaching/README.md` (zh-TW: `teaching/README.zh-TW.md`) and follow it. It
   defines the course arc (lesson 1→4), the teaching rules, and how to run the demo
   scripts in `teaching/demos/`.
4. Demos are **pre-written Playwright scripts** — always run them via
   `python3 teaching/demos/demo_tabN.py --segment K [--lang zh-TW]`. Do NOT drive the
   page with a live browser-automation MCP instead; the scripts are the demo.

## Troubleshooting

- `Model swap failed: port 8080 still busy` → another process owns :8080. Find it with
  `lsof -nP -iTCP:8080 -sTCP:LISTEN`, stop it, retry (init.py also detects this).
- Server not up / page won't load → start it (command above), log at
  `/tmp/agent-server.log`.
- A demo script fails fast → it prints a one-line reason (server down / model missing /
  model swap failed / selector not found). Fix per init.py, rerun the same segment.
- First switch into a tab shows a "loading model" banner for 3–5 s — that's the
  0.6B↔4B swap, normal.
```

- [ ] **Step 3: 寫 AGENTS.zh-TW.md**

內容 = Step 2 的忠實中譯，開頭對照行改為 `> English: [AGENTS.md](./AGENTS.md)(agent 自動載入英文版;本檔給人讀)`。章節結構、指令、路徑完全相同（指令區塊不翻譯）。

- [ ] **Step 4: 驗證**

Run: `head -1 CLAUDE.md && grep -c "teaching/README" AGENTS.md AGENTS.zh-TW.md`
Expected: `@AGENTS.md`，兩檔皆 ≥1

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md AGENTS.zh-TW.md CLAUDE.md
git commit -m "feat(agents): AGENTS.md role-gate entry point + CLAUDE.md include"
```

---

### Task 6: README 加「AI 帶課模式」一節

**Files:**
- Modify: `README.md`、`README.zh-TW.md`（皆插在「Quick start」section 之後）

- [ ] **Step 1: README.zh-TW.md 插入**

```markdown
## 🤖 AI 帶課模式(Claude Code / Codex)

不想自己摸?用 AI coding agent 打開這個 repo,它會讀 [AGENTS.md](./AGENTS.md)、
問你是老師還是學員,然後:

- 跑 `python3 init.py` 幫你檢查環境(llama.cpp、模型、playwright),缺什麼帶你裝
- 照 [teaching/](./teaching/) 的課綱帶課:先問你預測 → 跑 Playwright demo 給你看畫面動 → 再揭曉
- 你只要回答問題、看畫面、偶爾自己動手

學員用法:clone 後在 repo 資料夾開 Claude Code,打聲「hi」就會開始。
```

- [ ] **Step 2: README.md 插入英文版**

```markdown
## 🤖 AI-guided mode (Claude Code / Codex)

Don't want to explore alone? Open this repo with an AI coding agent. It reads
[AGENTS.md](./AGENTS.md), asks whether you're the teacher or a student, then:

- runs `python3 init.py` to check your environment (llama.cpp, models, playwright) and guides any installs
- runs the course from [teaching/](./teaching/): asks for your prediction → plays a Playwright demo on screen → debriefs
- you just answer, watch, and occasionally drive

Student usage: clone, open Claude Code in the repo folder, say "hi".
```

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh-TW.md
git commit -m "docs(readme): add AI-guided mode section (both langs)"
```

---

### Task 7: teaching/demos/_common.py + demo_tab1.py

**Files:**
- Create: `teaching/demos/_common.py`、`teaching/demos/demo_tab1.py`

- [ ] **Step 1: 寫 _common.py**

```python
"""Shared Playwright helpers for teaching demos.

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
    browser = p.chromium.launch(headless=args.smoke)
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
    page.click(f'.tab[data-tab="{tab_id}"]')
    try:
        page.wait_for_selector(f'main.tab-panel.active[data-panel="{tab_id}"]',
                               timeout=SWAP_TIMEOUT_MS)
    except Exception:
        if state["dialog"]:
            die(f"model swap 失敗: {state['dialog']} — 看 AGENTS.md Troubleshooting(port 8080)")
        die(f"切到 tab {tab_id} 逾時 — server / llama-server 狀態請用 init.py 檢查")
    page.wait_for_selector("body:not(.swapping)")
    return page.locator(f'main[data-panel="{tab_id}"]')


def pick_preset(panel, value: str):
    panel.locator(".preset-select").select_option(value)


def run_and_wait(page, panel):
    """按送出、等生成結束(.run 回到 enabled)。"""
    panel.locator(".run").click()
    panel.locator(".run[disabled]").wait_for(timeout=10_000)
    panel.locator(".run:not([disabled])").wait_for(timeout=GEN_TIMEOUT_MS)


def pause(page, args, ms: int):
    """課堂節奏停頓;--smoke 不停。"""
    if not args.smoke:
        page.wait_for_timeout(ms)


def click_token(page, panel, args, idx: int = 1):
    """點第 idx 個 token、等機率 bar chart 出現,回傳 top-1 機率字串。"""
    toks = panel.locator(".generated-text .tok")
    toks.nth(min(idx, toks.count() - 1)).click()
    panel.locator(".probs .bar-row").first.wait_for(timeout=5_000)
    pause(page, args, 1500)
    return panel.locator(".probs .bar-pct").first.inner_text()


def segments_to_run(args, n_segments: int) -> list[int]:
    if args.smoke or args.segment == 0:
        return list(range(1, n_segments + 1))
    if not 1 <= args.segment <= n_segments:
        die(f"--segment 必須是 1..{n_segments}")
    return [args.segment]
```

- [ ] **Step 2: 寫 demo_tab1.py**

```python
#!/usr/bin/env python3
"""Tab ① demo — token 接龍 + top-10 機率分佈(3 段,對應 3 個 preset)。

段落:1=床前明月光(peaked) 2=祖樹星(peaked但瞎掰) 3=冰箱(flat)
用法:python3 teaching/demos/demo_tab1.py --segment 1 --lang zh-TW
"""
import argparse

from playwright.sync_api import sync_playwright

import _common as c

PRESETS = {
    1: ("床前明月光", "model 記得的文本 → 預期 top-1 99%+(peaked)"),
    2: ("祖樹星上最高的山叫做", "瞎掰的星球 → 預期照樣自信編(peaked ≠ 真實)"),
    3: ("他打開冰箱,拿出", "model 不知接啥 → 預期 top-10 分散(flat)"),
}


def run_segment(page, panel, args, k: int):
    prompt, expect = PRESETS[k]
    c.log(f"[{k}.1] 選 preset:{prompt}({expect})")
    c.pick_preset(panel, prompt)
    c.pause(page, args, 800)
    c.log(f"[{k}.2] 送出,看 token 一個一個蹦")
    c.run_and_wait(page, panel)
    c.log(f"[{k}.3] 點 token 開 top-10 機率圖")
    top1 = c.click_token(page, panel, args, idx=1)
    c.log(f"[{k}.4] top-1 機率 = {top1} — 生成文字:「{panel.locator('.generated-text').inner_text()[:60]}」")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    c.add_args(ap)
    args = ap.parse_args()
    with sync_playwright() as p:
        browser, page, state = c.launch(p, args)
        panel = c.switch_tab(page, state, "basic")
        for k in c.segments_to_run(args, 3):
            run_segment(page, panel, args, k)
        c.pause(page, args, 2000)
        browser.close()
    c.log("DONE")


if __name__ == "__main__":
    main()
```

註：demos 內部以 `import _common` 相對載入 — 跑的時候 cwd 不限，但要用 `python3 teaching/demos/demo_tab1.py` 路徑執行（Python 自動把 script 所在目錄放進 sys.path）。

- [ ] **Step 3: 真機驗證（server + model 在場）**

Run: `python3 teaching/demos/demo_tab1.py --smoke`
Expected: 依序印 `[1.1]…[3.4]` 與 `DONE`，exit 0。
再跑 `python3 teaching/demos/demo_tab1.py --segment 1`：有頭瀏覽器開起來、畫面看得到 preset 填入 → token 蹦 → bar chart。

- [ ] **Step 4: Commit**

```bash
git add teaching/demos/_common.py teaching/demos/demo_tab1.py
git commit -m "feat(demos): playwright common helpers + Tab 1 demo (3 segments)"
```

---

### Task 8: demo_tab2.py / demo_tab3.py / demo_tab4.py

**Files:**
- Create: `teaching/demos/demo_tab2.py`、`demo_tab3.py`、`demo_tab4.py`

- [ ] **Step 1: 寫 demo_tab2.py**

```python
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
    c.run_and_wait(page, panel)
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
    c.run_and_wait(page, panel)
    c.log(f"[2.4] 加工後輸出:「{panel.locator('.generated-text').inner_text()[:80]}…」(預期:整齊條列)")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    c.add_args(ap)
    args = ap.parse_args()
    with sync_playwright() as p:
        browser, page, state = c.launch(p, args)
        panel = c.switch_tab(page, state, "advanced")
        segs = {1: seg1, 2: seg2}
        for k in c.segments_to_run(args, 2):
            segs[k](page, panel, args)
        c.pause(page, args, 2000)
        browser.close()
    c.log("DONE")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 寫 demo_tab3.py**

```python
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
    c.run_and_wait(page, panel)
    c.log(f"[1.3] 直答結果:「{panel.locator('.generated-text').inner_text()[:60]}」(對照組;小 model 直答常錯)")


def seg2(page, panel, args):
    c.log("[2.1] thinking 模式(留空間讓 model 把推理寫成 token)")
    panel.locator('input[name="mode-reasoning"][value="thinking"]').check()
    c.pause(page, args, 800)
    c.log("[2.2] 送出同一題 — 注意上方會多出「完整回覆(含 <think>)」區")
    c.run_and_wait(page, panel)
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
        segs = {1: seg1, 2: seg2}
        for k in c.segments_to_run(args, 2):
            segs[k](page, panel, args)
        c.pause(page, args, 2000)
        browser.close()
    c.log("DONE")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 寫 demo_tab4.py**

```python
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
    c.run_and_wait(page, panel)
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
        for k in c.segments_to_run(args, 2):
            run_segment(page, panel, args, k)
        browser.close()
    c.log("DONE")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 真機驗證**

Run: `python3 teaching/demos/demo_tab2.py --smoke && python3 teaching/demos/demo_tab3.py --smoke && python3 teaching/demos/demo_tab4.py --smoke`
Expected: 各自印完段落 log + `DONE`，exit 0（tab4 第一次會多等 model swap）

- [ ] **Step 5: Commit**

```bash
git add teaching/demos/demo_tab2.py teaching/demos/demo_tab3.py teaching/demos/demo_tab4.py
git commit -m "feat(demos): Tab 2/3/4 playwright demos"
```

---

### Task 9: teaching/README ×2（帶課總綱）

**Files:**
- Create: `teaching/README.md`、`teaching/README.zh-TW.md`

- [ ] **Step 1: 寫 teaching/README.zh-TW.md**

```markdown
# 帶課總綱(AI 教練用)

> English: [README.md](./README.md)

你(AI agent)是學員手上的輔助教練。情境是**課堂跟著做**:老師(Nat)在場主講,
你帶著眼前這位學員操作、回答他的問題、控制節奏。

## 課程弧(約 60-90 分鐘)

| 課 | Tab | 核心概念 | 檔案 |
|---|-----|---------|------|
| 1 | ① 基礎 | token 接龍 + 機率分佈;peaked ≠ 真實 | lesson-1-basics.zh-TW.md |
| 2 | ② 產品層 | system prompt / chat template = 拼進 token 的文字 | lesson-2-product.zh-TW.md |
| 3 | ③ 推理 | thinking = 把推理寫成 token | lesson-3-reasoning.zh-TW.md |
| 4 | ④ Agent | tool_call 約定 + 真執行;收尾 60→90 分框架 | lesson-4-agent.zh-TW.md |

順序固定 1→4(lesson 1 的 Hook 答案會在 lesson 4 收尾對照,中間不要跳過)。

## 帶課守則

1. **一次只做一步**,等學員回應再往下;學員提問優先處理
2. **先問預測再 demo** — 每課的 Hook 問答永遠在 demo 之前;把學員的回答記住(lesson 4 收尾要對照)
3. **學員答錯不直接糾正** — 用 demo 讓他自己看到
4. **對話語言跟學員**;教材雙語,取對應語言的 lesson 檔
5. **Demo 三拍**:預告(說等下會看到什麼)→ 跑 script(blocking)→ 讀 stdout step log 來 debrief。不要嘗試邊跑邊解說
6. Demo 一律用預寫 script,**不要**改用 browser MCP 即時操控

## 跑 demo

```bash
python3 teaching/demos/demo_tab1.py --segment 1 --lang zh-TW   # 段落式,有頭、放慢
python3 teaching/demos/demo_tab1.py --smoke                     # 自驗:headless 跑全部
```

前置:`python3 init.py` 全綠(含 playwright)、server 在跑、學員 browser 開著
http://localhost:9000/index.zh-TW.html(讓學員看同一個畫面;demo script 會自己另開視窗)。

失敗時 script 會印一行原因(server 沒起/swap 失敗/逾時) — 照 AGENTS.md Troubleshooting 修,重跑同段落。
```

- [ ] **Step 2: 寫 teaching/README.md**

Step 1 的忠實英譯（開頭對照行 `> 中文版: [README.zh-TW.md](./README.zh-TW.md)`；表格 / 指令區塊不翻）。

- [ ] **Step 3: Commit**

```bash
git add teaching/README.md teaching/README.zh-TW.md
git commit -m "feat(teaching): course-arc README for AI coach (both langs)"
```

---

### Task 10: lesson-1（Tab ① 基礎，含 Hook A 遷移）

> Hook A **revisit** 內容（spec 遷移表指到 lesson-1 §5）在本 plan 按概念**分散**到四課的揭曉段，
> 比單點塞進 lesson-1 更合教學弧、內容無遺漏：缺知識/祖樹星 → L1、「貼 SOP = 拼 token 文字」原理 → L2、
> 拿捏題開 thinking → L3、60→90 分框架 + after 選擇題 → L4 收尾。Hook A **before** 題目原文進本課 §Hook 問答。

**Files:**
- Create: `teaching/lesson-1-basics.zh-TW.md`、`teaching/lesson-1-basics.md`

- [ ] **Step 1: 寫 lesson-1-basics.zh-TW.md**

```markdown
# Lesson 1 — Tab ① 基礎:token 與機率分佈

## 學習目標
1. 知道 model 是「一個 token 一個 token 接龍」,每步從機率分佈抽樣
2. 會讀 top-10 bar chart:peaked(很有把握)vs flat(不知道接啥)
3. 體會 **peaked ≠ 真實**:confidence ≠ correctness

## Hook 問答(先問,不給答案,記下學員的回答 — lesson 4 收尾要對照)

把情境唸給學員(或貼給他看):

> 客戶寄 email 來抱怨:產品有瑕疵、要求退款,語氣有點火。你想:把客戶來信貼給
> ChatGPT、叫它寫一封誠懇道歉但不亂承諾賠償的回信,我看一下就寄出。

逐題問:
- **Q1.** 你會直接把它寫的回信寄給客戶嗎?(會,很方便 / 會但會再看過 / 不會 / 不確定)
- **Q2.** 你信它寫的內容(不會自己亂承諾退款/賠償)嗎?(信 / 半信 / 不信)
- **Q3.** 你會在聊天框裡「先打什麼」來讓它回得準?可複選(什麼都不打,直接貼客訴信叫它回 /
  連我們的退款政策、客服 SOP 一起貼進去 / 交代語氣、不准承諾金額等規則 / 沒想過要先打什麼)
- **Q4.**(可選)你目前實際上會怎麼叫它寫?

## Demo 段落

### 段落 1 — model 記得的文本(peaked)
- 預告:「我讓瀏覽器自己動:送『床前明月光』給一個 0.6B 小 model,看它一個字一個字接。注意右邊機率圖。」
- 跑:`python3 teaching/demos/demo_tab1.py --segment 1 --lang zh-TW`
- 畫面:選 preset → 送出 → token 蹦出 → 點 token → top-10 bar chart
- debrief:top-1 99%+ — model「背過」這句;接龍不是查資料,是機率

### 段落 2 — 瞎掰的星球(peaked ≠ 真實)
- 預告:「祖樹星是瞎掰的星球。你猜:model 會說『不知道』,還是編一個山名?」(先收學員預測!)
- 跑:`--segment 2`
- debrief:照樣高 confidence 編出來 → peaked 只代表「它覺得順」,不代表真

### 段落 3 — 不知道接啥(flat)
- 預告:「『他打開冰箱,拿出』— 你猜 top-10 會長怎樣?」
- 跑:`--segment 3`
- debrief:水/雞蛋/啤酒…分散 → 分佈形狀 = model 把握度

## 學員動手
請學員自己:換一個 preset 重跑、點不同 token 看分佈跳動;進階 — 打一句只有他們公司
才知道的事實開頭,看 model 怎麼自信亂編(自製祖樹星)。

## 揭曉與回顧(對照 Hook 答案)
- 回放學員 Q2 的回答,連到段落 2:它會亂承諾不是「壞」,是**它缺你公司的退款政策**,
  只能機率接龍、還接得很篤定 — 亂回不是「GPT 不能信」,是「它缺那塊知識」
- 預告下一課:解法 = 把知識打進去(system prompt / 貼 SOP)→ Lesson 2

## 常見學員問題
- 「它是不是查了資料庫?」— 沒有,純接龍;你剛看到每一步的候選了
- 「0.6B 太笨吧?ChatGPT 也這樣?」— 大 model 分佈更準,但機制一模一樣,也一樣會自信亂編
- 「為什麼同 prompt 每次答的不同?」— 抽樣;top-1 不是唯一會被選的
```

- [ ] **Step 2: 寫 lesson-1-basics.md（英譯）**

忠實翻譯 Step 1。Hook 問答選項用 hooks.js 原有英文措辭:Q1 `Yes, handy / Yes, but I'd re-read it / No / Not sure`;Q2 `Trust it / Half-trust / Don't trust`;Q3 `Nothing — just paste & ask / Paste in refund policy / SOP / Spell out tone & rules / Never thought about it`。指令區塊不翻（`--lang zh-TW` 改 `--lang en`）。

- [ ] **Step 3: Commit**

```bash
git add teaching/lesson-1-basics.zh-TW.md teaching/lesson-1-basics.md
git commit -m "feat(teaching): lesson 1 — tokens & probability (Hook A migrated)"
```

---

### Task 11: lesson-2 + lesson-3

**Files:**
- Create: `teaching/lesson-2-product.zh-TW.md`、`teaching/lesson-2-product.md`、`teaching/lesson-3-reasoning.zh-TW.md`、`teaching/lesson-3-reasoning.md`

- [ ] **Step 1: 寫 lesson-2-product.zh-TW.md**

```markdown
# Lesson 2 — Tab ② 產品層加工:system prompt 與 chat template

## 學習目標
1. 知道「產品層加工」= 在你的字前後**拼上更多文字**再丟給 model(沒有別的魔法)
2. 看懂 `<|im_start|>system / user / assistant` 角色邊界 marker
3. 連回 Hook A:聊天框貼 SOP 之所以有效,就是因為「都只是拼進 token 的文字」

## Hook 問答(先問,不給答案)
- 「同一個問題『一年有幾個月?』,如果前面多一句『你是行銷顧問,用條列式回答,只給 3 點。』,
  你猜輸出會差多少?差在哪?」
- 「你覺得 ChatGPT 收到你訊息時,model 看到的就是你打的那串字嗎?」

## Demo 段落

### 段落 1 — 裸 prompt(對照組)
- 預告:「先看不加工:問題原樣丟進去,model 當接龍題做。」
- 跑:`python3 teaching/demos/demo_tab2.py --segment 1 --lang zh-TW`
- debrief:輸出散開、像接續不像回答 — model 根本不知道「誰在問誰」

### 段落 2 — 加 system + chat template
- 預告:「同一題,加 system prompt + 用 Qwen3 chat template 包好。會先展開『實際送進 model 的
  final prompt』給你看 marker。」
- 跑:`--segment 2`
- debrief:輸出變整齊條列。重點看 preview:`<|im_start|>system…<|im_end|>` 怎麼把你的字包進去;
  marker 看起來 12 個字元,model 眼裡是 1 個 token(vocab id 151644)

## 學員動手
preset 2「夏季冰飲文案」:讓學員自己 raw 跑一次、再加 system 跑一次,對比結構化程度;
鼓勵他改 system prompt 內容(例:「用台語腔」「只回 1 句」)看輸出跟著變。

## 揭曉與回顧
- 回到 Hook A Q3:現在你知道為什麼「貼 SOP + 交代規則」有效 — ChatGPT 網頁版雖然沒有
  system prompt 欄位,但**那只是拼進 token 的文字**,你打進聊天框效果一樣
- 一句話總結:產品層沒有魔法,是「替你打字」

## 常見學員問題
- 「system prompt 是不是比較『強制』?」— 訓練讓 model 更聽 system 段,但本質同樣是 token
- 「我可以叫它忽略 system prompt 嗎?」— 這就是 prompt injection 的由來;約定不是強制
```

- [ ] **Step 2: 寫 lesson-3-reasoning.zh-TW.md**

```markdown
# Lesson 3 — Tab ③ 推理:thinking 就是把思考寫成 token

## 學習目標
1. 知道 thinking mode = model 先吐 `<think>…</think>` 思考 token、再吐答案
2. 體會同一個 model,「有沒有空間想」對答案正確率的影響
3. 知道什麼任務值得開 thinking(拿捏題/多步推理),什麼不用(查表式短答)

## Hook 問答(先問,不給答案)
- 「爸爸有 3 顆蘋果,兒子多他 2 顆。請問兒子幾顆?— 這題你覺得 0.6B 小 model 直接答,會對嗎?」
- 「你用過 ChatGPT 的『思考中…』模式嗎?你覺得它在做什麼?」

## Demo 段落

### 段落 1 — 直答(常錯)
- 預告:「直答模式 = 我們強塞一個空的 <think></think>,model 沒空間想、直接吐答案。猜它答幾顆?」
- 跑:`python3 teaching/demos/demo_tab3.py --segment 1 --lang zh-TW`
- debrief:小 model 直答常錯(說 3 顆或亂答);它只是在接龍「最順的數字」

### 段落 2 — 用 thinking(通常對)
- 預告:「同一題,這次讓它把推理寫出來。注意畫面會多一個『完整回覆(含 <think>)』區。」
- 跑:`--segment 2`
- debrief:看 thinking 區 — 推理真的是一個一個 token 寫出來的,不是隱形魔法;
  寫完 `</think>` 後才出最終答案,而且通常對了

## 學員動手
讓學員改數字(爸爸 7 顆、兒子少他 3 顆…)兩種模式各跑一次;體會 thinking 慢但穩。

## 揭曉與回顧
- 對照 Hook 預測:你猜對了嗎?差別不是 model 變聰明,是**給了它把推理寫成 token 的空間**
- 連回 Hook A:法律、賠償這類拿捏題,開 thinking 更穩 — 但該給的知識(SOP)還是要給,
  thinking 不能補知識缺口

## 常見學員問題
- 「thinking 的內容可信嗎?」— 它是真實影響答案的 token,但也可能想錯;重要結論仍要核
- 「為什麼不每題都開?」— 慢、貴;查表式短答沒收益
```

- [ ] **Step 3: 英譯兩份**（`lesson-2-product.md`、`lesson-3-reasoning.md`，忠實翻譯，指令區塊 `--lang` 改 `en`）

- [ ] **Step 4: Commit**

```bash
git add teaching/lesson-2-product.zh-TW.md teaching/lesson-2-product.md teaching/lesson-3-reasoning.zh-TW.md teaching/lesson-3-reasoning.md
git commit -m "feat(teaching): lessons 2-3 — chat template & thinking mode"
```

---

### Task 12: lesson-4（Tab ④ Agent，含 Hook B + flip-table 遷移）

**Files:**
- Create: `teaching/lesson-4-agent.zh-TW.md`、`teaching/lesson-4-agent.md`

- [ ] **Step 1: 寫 lesson-4-agent.zh-TW.md**

```markdown
# Lesson 4 — Tab ④ Agent:tool_call 約定與真執行(+ 整課收尾)

## 學習目標
1. 知道 Agent = model 吐 `<tool_call>` 約定標籤 → client parse → **真的執行** → 結果塞回對話
2. 看懂 multi-turn loop:每個 turn 的輸出累積進 messages、直到不再 tool_call
3. 收尾:說話工具 vs 動手工具的選擇判斷 + 60→90 分框架

## Hook 問答(先問,不給答案,記下回答)

把情境唸給學員:

> 剛剛 Lesson 1 說的「依我們公司真政策回信」那種要碰你公司檔案的活,ChatGPT 碰不到。
> 現在看一個真的要動你電腦的任務:你電腦裡有 50 份客戶會議逐字稿,你想讓 AI 讀過全部、
> 摘出客戶最常抱怨什麼。你聽說 Claude Code / Codex 能直接讀你電腦的檔。

- **Q1.** 這種「要讀你本機 50 份檔」的活,你會交給 Claude Code / Codex 嗎?
  (會,我大概知道怎麼弄 / 知道方向但不會做 / 不知道怎麼開始)
- **Q2.** 你知道它「真的」怎麼讀到你的檔嗎?(知道 / 大概 / 覺得有點像魔法)
- **Q3.**(可選)如果要做,你會用什麼?

## Demo 段落(第一次切 Tab ④ 會載 4B model,banner 等 3-5 秒 — 先跟學員預告)

### 段落 1 — 現在幾點?(get_time)
- 預告:「model 沒有時鐘。猜它怎麼知道現在幾點?看紫色『↑ 工具呼叫』和綠色『↓ 工具結果』。」
- 跑:`python3 teaching/demos/demo_tab4.py --segment 1 --lang zh-TW`
- debrief:Turn 1 model 吐 `<tool_call>{"name":"get_time"…}` → client 真的跑 Python 拿時間 →
  塞回對話 → Turn 2 才答得出來。**XML 標籤只是約定,執行的是 client**

### 段落 2 — 數 .md 檔(exec_bash)
- 預告:「這次它要跑 shell 指令、真的數這個 repo 的檔案。」
- 跑:`--segment 2`
- debrief:展開 turn block 的「再送出」details:看 conversation 怎麼一輪輪累積成下次 input

## 學員動手
preset 2「讀+寫 摘要」:學員自己送出,跑完去開 `~/Desktop/llm-summary.md` — **檔案真的在**,
這就是「動手工具」跟「說話工具」的差別。

## 揭曉與回顧(整課收尾 — 對照 Lesson 1 與本課 Hook 答案)

1. **回放 Hook B**:Q2 你選「覺得像魔法」的話 — 現在你看過了:read_file 是真的 Python function,
   `<tool_call>` 是約定標籤,沒有魔法
2. **50 份逐字稿那題的正解骨架**:Agent(read_file 真讀檔)→ 套摘要範本 → 挑樣本 spot-check →
   要重複用就包成工具
3. **說話 vs 動手(帶學員把這張表講一遍)**:
   - 說話工具(ChatGPT / Gemini):聊天框餵對 context(SOP/規則)+ 交代紅線 + 核重點。
     分界:context 你貼得完
   - 動手工具(Claude Code / Codex):讀你的檔、跑指令、多步。分界:context 太大 / 要自動讀檔
4. **60→90 分框架(回放學員 Lesson 1 的 Hook 答案,讓他自己看判斷怎麼變)**:
   before 是把 GPT 當許願池、賭它對;after 是你餵料、設規則、知道核哪句 — 同一個工具,
   60 分用到 90 分。不是學了一堆術語,是知道任務該交給哪類工具、怎麼用到位、背後在做什麼
5. **課後導讀**(自學,不帶課):Tab ⑤ 指令/Script/API、Tab ⑥ Skill、Tab ⑦ MCP 三篇文章 +
   Tab ⑧ 總結 — 講「怎麼把今天的東西包成可重複使用的工具」

## 常見學員問題
- 「它會不會亂跑指令?」— 工具是 client 白名單定義的;這也是為什麼要看「↑ 工具呼叫」確認
- 「ChatGPT 為什麼不能這樣?」— 網頁版沒給它你電腦的工具;不是 model 不同,是 client 不同
- 「4B 跟 0.6B 差在哪?」— function calling 要跟對格式約定,小 model 常跟丟;4B 才穩
```

- [ ] **Step 2: 寫 lesson-4-agent.md（英譯）**

忠實翻譯。Hook B 選項用 hooks.js 英文措辭:Q1 `Yes, I roughly know how / I know the direction but can't do it / No idea where to start`;Q2 `I know / Roughly / Feels like magic`。收尾表格措辭參考 flip-table 英文版:說話工具行 `Speaking tools (①②③): ChatGPT / Gemini — feed the right context (SOP/rules) into the chat box, set red lines, check the key claims. Line: context you can paste in full.`;動手工具行 `Doing tools (④⑤⑥⑦): Claude Code / Codex — read your files, run commands, multi-step. Line: context too big / must auto-read files.`

- [ ] **Step 3: Commit**

```bash
git add teaching/lesson-4-agent.zh-TW.md teaching/lesson-4-agent.md
git commit -m "feat(teaching): lesson 4 — agent loop + course wrap-up (Hook B & flip-table migrated)"
```

---

### Task 13: 端到端驗證

**Files:** 無新檔（驗證 + 必要時修小錯）

- [ ] **Step 1: 全測試**

Run: `pytest agent/tests -q`
Expected: `55 passed`

- [ ] **Step 2: init.py 真機**

Run: `python3 init.py; echo "exit=$?"`
Expected: 全部 ✓（或 playwright WARN）、summary 與 exit code 一致

- [ ] **Step 3: demo 全 smoke（server + model 在場）**

Run: `for n in 1 2 3 4; do python3 teaching/demos/demo_tab$n.py --smoke || break; done`
Expected: 4 個 `DONE`

- [ ] **Step 4: 教學進場演練（人工）**

模擬學員:新開一個 Claude Code session 說「hi」→ 確認 AI 問角色 → 答「學員」→
確認 AI 跑 init.py、開 teaching/README.zh-TW.md、開始 lesson 1(含跑 demo_tab1 segment 1
時有頭瀏覽器畫面會動)。Creator 路徑也抽查:答「creator」→ 確認給架構圖不進教學。

- [ ] **Step 5: 收尾**

確認 `git status` clean、所有 commit 都進了。向 user 回報驗收結果,交還決策
(merge / 繼續調整教材內容)。
