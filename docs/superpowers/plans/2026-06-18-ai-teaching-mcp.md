# AI 帶課 v2（MCP 驅動）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AI 帶課從「預寫 Playwright script 自開自關瀏覽器」改成「AI 用 Playwright MCP 驅動唯一一個持久瀏覽器」，學生只看一個 AI 操作的瀏覽器、demo 後留著自己試。

**Architecture:** repo 內附 MCP 設定檔（`.mcp.json` Claude Code / `.codex/config.toml` Codex，pin `@playwright/mcp@0.0.76`）讓兩種 agent 自動撿；init.py 改檢 Node/npx + MCP 設定就位、pip playwright 降為 creator 驗證用；AGENTS.md / lesson 改成 MCP playbook（用 a11y 可見訊號等待）；既有 Python script 降為 creator `--smoke` 回歸 harness（程式不改）；網頁 trim 掉跟 AI 旁白重複的 always-on 散文。

**Tech Stack:** Playwright MCP（Node/npx）、Python stdlib（init.py）、既有 stdlib http.server + llama.cpp 不動。

**Spec:** `docs/superpowers/specs/2026-06-17-ai-teaching-mcp-design.md`（rev 2）

**Spike 已驗證（2026-06-18）：** Playwright 的 aria snapshot（== Playwright MCP 看的同一棵樹）確認可觀察到 ① swap banner 文字「載入…0.6B…中」 ② run 鈕 a11y disabled state（`button "送出" [disabled]`）③ 80 個 `.tok` + 生成文字 ④ 點 token 後機率值直接在 a11y（`霜 95.0% 月 3.0%…`）。`@playwright/mcp` 當前最新 = 0.0.76、Node v24 ✓。

---

## 既有事實（執行者不用再查）

- 目前 cache-bust = `?v=57`（兩份 HTML 各 2 處：styles.css、app.js）→ 本計畫改完 bump `v=58`
- init.py 結構：`@dataclass Check`（欄位 `name, ok, detail="", fix="", auto_fix=[], warn_only=False`）；`MODEL_FILES = {"0.6B":…, "4B":…}`；`run_checks()` 回 list[Check]；`summarize(checks)` 回 `(line, code)`；`main(argv)` 印每項 + summary。imports：`argparse, importlib.util, shutil, subprocess, sys, urllib.error, urllib.request, dataclasses, pathlib`。stdlib-only（不可引第三方）。tests 在 `agent/tests/test_init.py`（plain pytest + monkeypatch），目前 58 passed。
- init.py 門檻是 Python ≥3.10 → **不可用 `tomllib`**（3.11+）；`.codex/config.toml` 的檢查用字串掃描
- AGENTS.md 待移除/反轉的確切位置（spec §5.1）：
  - student mode 步驟 1 提到 playwright 必裝（"Teaching ALSO requires playwright…"）
  - student mode 步驟 2「have the student open http://localhost:9000/」
  - student mode 步驟 4 + Troubleshooting 的「pre-written Playwright scripts … run via demo_tabN.py」「Do NOT drive the page with a live browser-automation MCP … the scripts are the demo」
- teaching/README.zh-TW.md 病灶：守則 5「跑 script(blocking)」、守則 6「不要改用 browser MCP」、L35-36「全綠(含 playwright)…學員 browser 開著…demo script 會自己另開視窗」、L28-33「跑 demo」整段
- 頁面 a11y 等待訊號（spike 驗證，playbook 用）：swap 中頁面含可見文字「載入」；swap 完該文字消失；run 鈕生成中 a11y 為 `button "送出" [disabled]`、完成回 `button "送出"`；機率值點 token 後直接在 a11y 文字
- demo script（`teaching/demos/demo_tab1..4.py` + `_common.py`）是 preset 值 / 操作序列的**事實來源**，本計畫**不改其程式**，只在 README/header 重新定位為 creator smoke harness

---

### Task 1: MCP 設定檔（兩種 agent，pin 版本）

**Files:**
- Create: `.mcp.json`
- Create: `.codex/config.toml`

- [ ] **Step 1: 建 `.mcp.json`（repo 根）**

```json
{
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@playwright/mcp@0.0.76"]
    }
  }
}
```

- [ ] **Step 2: 建 `.codex/config.toml`（repo 根）**

```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@0.0.76"]
```

- [ ] **Step 3: 驗證**

Run: `python3 -c "import json; json.load(open('.mcp.json')); print('mcp.json ok')"; grep -q '\[mcp_servers.playwright\]' .codex/config.toml && echo 'codex toml ok'`
Expected: `mcp.json ok` 與 `codex toml ok`

- [ ] **Step 4: Commit**

```bash
git add .mcp.json .codex/config.toml
git commit -m "feat(mcp): ship Playwright MCP config for Claude Code + Codex (pin 0.0.76)"
```

---

### Task 2: init.py — Node/npx + MCP 設定檢查 + playwright 降級（TDD）

**Files:**
- Modify: `init.py`
- Test: `agent/tests/test_init.py`

新增/改動的函式介面（後續步驟會用到，先定義清楚）：
- `check_node() -> Check`：`shutil.which("npx")` 找得到則 ok；warn_only=True、warn_label="teaching"
- `_detect_agents() -> list[str]`：回 `["claude"]` / `["codex"]` / 兩者 / `[]`，依 `~/.claude.json`、`~/.codex/` 存在與否
- `check_mcp_config() -> Check`：對 `_detect_agents()` 偵測到的每個 agent，檢對應設定檔（`.mcp.json` 含字串 `"playwright"`；`.codex/config.toml` 含字串 `[mcp_servers.playwright]`）。全到位則 ok；warn_only=True、warn_label="teaching"
- `check_playwright()`：改名顯示為 `playwright(creator 驗證用)`、warn_label="creator"
- `Check` 加欄位 `warn_label: str = "teaching"`
- `summarize()`：warn 項依 `warn_label` 分組，每組一行 `READY + WARN <label>: a, b missing`

- [ ] **Step 1: 寫失敗測試（append 到 `agent/tests/test_init.py`）**

```python
def test_check_node_missing(monkeypatch):
    monkeypatch.setattr(init.shutil, "which", lambda _: None)
    c = init.check_node()
    assert not c.ok and c.warn_only and c.warn_label == "teaching"


def test_check_node_present(monkeypatch):
    monkeypatch.setattr(init.shutil, "which", lambda name: "/usr/bin/npx" if name == "npx" else None)
    assert init.check_node().ok


def test_detect_agents_claude_only(monkeypatch, tmp_path):
    monkeypatch.setattr(init.Path, "home", classmethod(lambda cls: tmp_path))
    (tmp_path / ".claude.json").write_text("{}")
    assert init._detect_agents() == ["claude"]


def test_detect_agents_both(monkeypatch, tmp_path):
    monkeypatch.setattr(init.Path, "home", classmethod(lambda cls: tmp_path))
    (tmp_path / ".claude.json").write_text("{}")
    (tmp_path / ".codex").mkdir()
    assert set(init._detect_agents()) == {"claude", "codex"}


def test_mcp_config_ok_for_claude(monkeypatch, tmp_path):
    monkeypatch.setattr(init, "_detect_agents", lambda: ["claude"])
    monkeypatch.setattr(init, "REPO_ROOT", tmp_path)
    (tmp_path / ".mcp.json").write_text('{"mcpServers":{"playwright":{}}}')
    assert init.check_mcp_config().ok


def test_mcp_config_missing_codex_toml(monkeypatch, tmp_path):
    monkeypatch.setattr(init, "_detect_agents", lambda: ["codex"])
    monkeypatch.setattr(init, "REPO_ROOT", tmp_path)
    c = init.check_mcp_config()
    assert not c.ok and c.warn_label == "teaching"


def test_mcp_config_codex_string_scan(monkeypatch, tmp_path):
    monkeypatch.setattr(init, "_detect_agents", lambda: ["codex"])
    monkeypatch.setattr(init, "REPO_ROOT", tmp_path)
    cdir = tmp_path / ".codex"; cdir.mkdir()
    (cdir / "config.toml").write_text("[mcp_servers.playwright]\ncommand='npx'\n")
    assert init.check_mcp_config().ok


def test_playwright_warn_label_is_creator():
    c = init.check_playwright()
    assert c.warn_only and c.warn_label == "creator"


def test_summarize_groups_warn_by_label():
    checks = [
        init.Check("Python", True),
        init.Check("Node/npx(教學用)", False, warn_only=True, warn_label="teaching"),
        init.Check("playwright(creator 驗證用)", False, warn_only=True, warn_label="creator"),
    ]
    line, code = init.summarize(checks)
    assert code == 0
    assert "WARN teaching: Node/npx(教學用) missing" in line
    assert "WARN creator: playwright(creator 驗證用) missing" in line
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `pytest agent/tests/test_init.py -q`
Expected: FAIL（`AttributeError: module 'init' has no attribute 'check_node'` 等）

- [ ] **Step 3: 改 init.py**

3a. `Check` dataclass 加欄位（在 `warn_only` 後）：
```python
    warn_label: str = "teaching"               # warn 分組標籤(teaching / creator)
```

3b. 在 import 區後、`MODELS_DIR` 附近加模組常數：
```python
REPO_ROOT = Path(__file__).resolve().parent
```

3c. 新增 `check_node`（放在 `check_hf` 之後）：
```python
def check_node() -> Check:
    p = shutil.which("npx")
    return Check("Node/npx(教學用)", p is not None, p or "",
                 "裝 Node.js 18+(brew install node 或 nodejs.org);npx 隨 Node 附帶",
                 warn_only=True, warn_label="teaching")
```

3d. 新增 agent 偵測 + MCP 設定檢查（放在 `check_node` 之後）：
```python
def _detect_agents() -> list[str]:
    out = []
    if (Path.home() / ".claude.json").exists():
        out.append("claude")
    if (Path.home() / ".codex").exists():
        out.append("codex")
    return out


def check_mcp_config() -> Check:
    """設定檔隨 repo 附帶;這裡是 sanity check(stdlib-only,Codex toml 用字串掃描)。"""
    agents = _detect_agents()
    missing = []
    if "claude" in agents:
        f = REPO_ROOT / ".mcp.json"
        if not (f.exists() and "playwright" in f.read_text()):
            missing.append(".mcp.json")
    if "codex" in agents:
        f = REPO_ROOT / ".codex" / "config.toml"
        if not (f.exists() and "[mcp_servers.playwright]" in f.read_text()):
            missing.append(".codex/config.toml")
    detail = ("偵測到:" + ",".join(agents)) if agents else "未偵測到 Claude Code / Codex"
    return Check("browser MCP 設定(教學用)", not missing, detail,
                 "缺 " + ",".join(missing) + " — 跑 init.py --fix 還原" if missing else "",
                 warn_only=True, warn_label="teaching")
```

3e. 改 `check_playwright` 的名稱與 warn_label（其餘不動）：
```python
def check_playwright() -> Check:
    has_pkg = importlib.util.find_spec("playwright") is not None
    ok = has_pkg and _chromium_installed()
    detail = "" if ok else ("chromium browser 未安裝" if has_pkg else "套件未安裝")
    return Check("playwright(creator 驗證用)", ok, detail,
                 "pip install playwright && playwright install chromium",
                 auto_fix=[[sys.executable, "-m", "pip", "install", "playwright"],
                           [sys.executable, "-m", "playwright", "install", "chromium"]],
                 warn_only=True, warn_label="creator")
```

3f. 改 `run_checks` 把 `check_node()` + `check_mcp_config()` 加進去（playwright 留尾端）：
```python
def run_checks() -> list[Check]:
    return [check_python(), check_llama(), check_hf(),
            *[check_model(size) for size in MODEL_FILES],
            check_requests(), check_node(), check_mcp_config(),
            check_port_9000(), check_port_8080(), check_playwright()]
```

3g. 改 `summarize` 依 warn_label 分組：
```python
def summarize(checks: list[Check]) -> tuple[str, int]:
    missing = [c.name for c in checks if not c.ok and not c.warn_only]
    if missing:
        return "MISSING: " + ", ".join(missing), 1
    warns = {}
    for c in checks:
        if not c.ok and c.warn_only:
            warns.setdefault(c.warn_label, []).append(c.name)
    if warns:
        parts = ["WARN " + lbl + ": " + ", ".join(names) + " missing"
                 for lbl, names in warns.items()]
        return "READY + " + "; ".join(parts), 0
    return "READY", 0
```

3h. `--fix` 還原 MCP 設定：在 `apply_fixes` 之後新增，並在 `main` 的 `--fix` 分支呼叫：
```python
MCP_JSON = '''{
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@playwright/mcp@0.0.76"]
    }
  }
}
'''
CODEX_TOML = '[mcp_servers.playwright]\ncommand = "npx"\nargs = ["-y", "@playwright/mcp@0.0.76"]\n'
# 注意:版本 0.0.76 出現在 3 處(.mcp.json、.codex/config.toml、這裡的 MCP_JSON/CODEX_TOML)。
# 升版時三處一起改、重跑 spec §8 MCP dry-run。


def restore_mcp_config() -> None:
    agents = _detect_agents()
    if "claude" in agents:
        f = REPO_ROOT / ".mcp.json"
        if not (f.exists() and "playwright" in f.read_text()):
            f.write_text(MCP_JSON); print("→ wrote .mcp.json")
    if "codex" in agents:
        d = REPO_ROOT / ".codex"; d.mkdir(exist_ok=True)
        f = d / "config.toml"
        if not (f.exists() and "[mcp_servers.playwright]" in f.read_text()):
            f.write_text(CODEX_TOML); print("→ wrote .codex/config.toml")
```
在 `main` 裡 `if args.fix:` 區塊內、`apply_fixes(checks)` 之前加 `restore_mcp_config()`。

3i. **保護既有測試**：`main(["--fix"])` 現在會呼叫新的 `restore_mcp_config()`，它會碰真實 repo FS（`REPO_ROOT`）。既有測試 `test_fix_mode_reruns_checks_twice` 沒 mock 它 → 在有 `~/.claude.json` 的機器會讀真實 `.mcp.json`（Task 1 已建、含 "playwright" → 跳過寫入，安全但不該碰真 FS）。在該測試的 `monkeypatch` 區塊補一行：
```python
    monkeypatch.setattr(init, "restore_mcp_config", lambda: None)
```
（與既有的 `monkeypatch.setattr(init, "apply_fixes", lambda checks: None)` 並列）。

- [ ] **Step 4: 跑測試確認 pass**

Run: `pytest agent/tests -q`
Expected: `67 passed`（58 既有 + 9 新）

- [ ] **Step 5: 真機 smoke**

Run: `python3 init.py; echo "exit=$?"`
Expected: 列出每項含 `✓ Node/npx(教學用)`、`✓ browser MCP 設定(教學用) — 偵測到:claude`；pip playwright 已裝則 `✓ playwright(creator 驗證用)` + summary `READY`，未裝則 `⚠ … ` + `READY + WARN creator: playwright(creator 驗證用) missing`；任一情況 exit 0（playwright 是 warn_only，不影響 exit）

- [ ] **Step 6: Commit**

```bash
git add init.py agent/tests/test_init.py
git commit -m "feat(init): check Node/npx + MCP config, demote pip playwright to creator WARN"
```

---

### Task 3: AGENTS.md ×2 — 學員模式改 MCP

**Files:**
- Modify: `AGENTS.md`、`AGENTS.zh-TW.md`

- [ ] **Step 1: 改 `AGENTS.md` 的 `## Student → teaching mode` 整段**

把現有 Student 區塊（4 步 + 其中的 playwright 必裝 / open URL）整段換成：
```markdown
## Student → teaching mode

1. Run `python3 init.py`. If the last line is not `READY*`, walk the user through the
   printed `fix:` lines. Teaching needs **Node/npx + a browser MCP** (Playwright MCP,
   shipped as `.mcp.json` / `.codex/config.toml`); `python3 init.py --fix` restores the
   config and installs pip-class deps. (pip `playwright` is only for the creator's
   `--smoke` regression harness — a `WARN creator:` line is fine to ignore as a student.)
2. Approve the browser MCP once: Claude Code shows `⏸ Pending approval` (run `/mcp`,
   approve `playwright`); Codex asks to trust the folder on first launch (answer yes).
3. Make sure the server is up (init.py's Port 9000 line — or start it:
   `nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`).
4. Open `teaching/README.md` (zh-TW: `teaching/README.zh-TW.md`) and follow it. **You (the
   AI) drive the page via the browser MCP** — open http://localhost:9000/ yourself, run the
   lesson playbook, and **leave the browser open** for the student to try. Do NOT ask the
   student to open their own browser; do NOT fall back to running the Python demo scripts as
   the student-facing demo (those are the creator's regression harness now).

### Division of labour (tell the student this)

The **web page is the instrument** — the student watches it to see the numbers move (tokens,
probability bars, turn traces, results). **You are the narration** — all explanation comes
from you; do not read the page's own text aloud. Say it plainly: "watch the screen, listen
to me." Point them at a `(?)` dropdown only if they want the written version.

### Driving the page via MCP — how to wait / handle failure

- **Model swap:** clicking a tab triggers a 0.6B↔4B swap. The page shows a visible
  "loading model" banner — re-take an accessibility snapshot until that banner text is gone
  before continuing (first swap ~3–5 s, longer for 4B). Tell the student to wait.
- **Generation done:** the "送出/Send" button is disabled during generation and re-enables
  when done (visible in the a11y snapshot as a disabled→enabled state); the probability
  numbers appear in the snapshot text after you click a token — read them directly.
- **Swap failure:** a failed swap raises a JS dialog "Model swap failed…". Handle the
  dialog (read + dismiss) and tell the student in plain words it failed, then follow
  Troubleshooting (port 8080). Don't get stuck waiting on a selector that won't appear.
```

- [ ] **Step 2: 改 `AGENTS.md` 的 Troubleshooting 第 3 點**

把現有「A demo script fails fast → it prints a one-line reason…」這點換成：
```markdown
- A lesson step won't progress → re-snapshot to see the current page state. If a swap
  banner is stuck >15 s, the model swap likely failed (see port 8080 above); narrate the
  failure to the student rather than retrying blindly.
```

- [ ] **Step 3: 同步改 `AGENTS.zh-TW.md`**

對 Step 1 / Step 2 做忠實中譯，章節標題譯成中文（`## 學生 → 教學模式`、`### 分工(跟學生講)`、`### 用 MCP 驅動頁面 — 怎麼等 / 怎麼處理失敗`）。所有指令 / 路徑 / 程式輸出字串（`READY*`、`python3 init.py --fix`、`⏸ Pending approval`、`/mcp`、URL、`WARN creator:`）保留 verbatim。中文版同樣**移除**「叫學生自己開 URL」「playwright 必裝」「不要用 browser MCP / scripts are the demo」這些 v1 句。

- [ ] **Step 4: 驗證**

Run: `grep -c "browser MCP\|leave the browser open" AGENTS.md; grep -c "Do NOT drive the page with a live browser-automation MCP\|have the student open http" AGENTS.md`
Expected: 第一個 ≥1；第二個 `0`（v1 矛盾句已清）

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md AGENTS.zh-TW.md
git commit -m "docs(agents): student mode drives page via MCP, leaves browser open"
```

---

### Task 4: README ×2 — AI 帶課段落改 MCP

**Files:**
- Modify: `README.md`、`README.zh-TW.md`（現有「🤖 AI 帶課模式 / AI-guided mode」一節）

- [ ] **Step 1: 改 `README.zh-TW.md` 該節三條 bullet（L66-68，標題與「學員用法」不動）**

old（確切現值）:
```markdown
- 跑 `python3 init.py` 幫你檢查環境(llama.cpp、模型、playwright),缺什麼帶你裝
- 照 [teaching/](./teaching/) 的課綱帶課:先問你預測 → 跑 Playwright demo 給你看畫面動 → 再揭曉
- 你只要回答問題、看畫面、偶爾自己動手
```
new:
```markdown
- 跑 `python3 init.py` 幫你檢查環境(llama.cpp、模型、Node/npx + browser MCP),缺什麼帶你裝
- 照 [teaching/](./teaching/) 課綱帶課:AI **自己用 browser MCP 開並操作**那一個瀏覽器、邊做邊解說,demo 完留著讓你接手試
- 你只要看那個畫面、聽解說、偶爾自己動手(不用自己開網址)
```

- [ ] **Step 2: 改 `README.md` 對應英文（L66-68）**

old（確切現值）:
```markdown
- runs `python3 init.py` to check your environment (llama.cpp, models, playwright) and guides any installs
- runs the course from [teaching/](./teaching/): asks for your prediction → plays a Playwright demo on screen → debriefs
- you just answer, watch, and occasionally drive
```
new:
```markdown
- runs `python3 init.py` to check your environment (llama.cpp, models, Node/npx + a browser MCP) and guides any installs
- runs the course from [teaching/](./teaching/): the AI **drives one browser itself via a browser MCP**, narrating as it goes, and leaves it open for you to try
- you just watch that screen, listen, and occasionally drive (no opening URLs yourself)
```

- [ ] **Step 3: 驗證 + Commit**

Run: `grep -c "browser MCP" README.md README.zh-TW.md`
Expected: 各 ≥1
```bash
git add README.md README.zh-TW.md
git commit -m "docs(readme): AI-guided section — MCP-driven single browser"
```

---

### Task 5: teaching/README ×2 — 守則改 MCP 三拍、清病灶

**Files:**
- Modify: `teaching/README.zh-TW.md`、`teaching/README.md`

- [ ] **Step 1: 改 `teaching/README.zh-TW.md` 守則 5、6**

```markdown
5. **Demo 三拍**:預告(說等下會看到什麼)→ 用 browser MCP 操作頁面 → 看結果 debrief。一個瀏覽器、你操作、學員看
6. demo 一律用 **browser MCP** 即時驅動,**不要**叫學生自己開網址、也不要跑 Python script 當學生 demo(那是 creator 跑 `--smoke` 回歸用)
```

- [ ] **Step 2: 改 `teaching/README.zh-TW.md` 的「## 跑 demo」整段（L28-38）**

整段換成：
```markdown
## 帶 demo(用 browser MCP)

你(AI)用 browser MCP 開 http://localhost:9000/index.zh-TW.html(英文用 `/`)、照 lesson 的
playbook 操作,demo 完**不要關**、留著讓學生試。等待 / 失敗訊號:

- 切 tab 會觸發 model swap → 重複 snapshot 到「載入…中」banner 文字消失再往下
- 生成中「送出」鈕 disabled、完成回 enabled;點 token 後機率值直接在 snapshot 文字裡
- swap 失敗會跳 dialog「Model swap failed…」→ 處理 dialog + 跟學生說失敗,照 AGENTS.md Troubleshooting(port 8080)

前置:`python3 init.py` 全綠(Node/npx + MCP 設定就位)、server 在跑、browser MCP 已核准。

> creator 回歸驗證(非帶課):`python3 teaching/demos/demo_tab*.py --smoke`(需 pip playwright)。
```

- [ ] **Step 3: 同步改 `teaching/README.md`（英文）**

對 Step 1、2 忠實英譯；課綱表的檔名欄保持指向 `.md`（英文 lesson）；指令 / URL（`/` 非 zh）/ 程式輸出字串保留。守則改成 MCP 三拍 + 「don't ask student to open URL / don't run Python scripts as the demo」。

- [ ] **Step 4: 驗證 + Commit**

Run: `grep -c "browser MCP" teaching/README.md teaching/README.zh-TW.md; grep -c "跑 script(blocking)\|不要改用 browser MCP" teaching/README.zh-TW.md`
Expected: 第一個各 ≥1；第二個 `0`
```bash
git add teaching/README.md teaching/README.zh-TW.md
git commit -m "docs(teaching): course rules + demo guide → MCP-driven (both langs)"
```

---

### Task 6: lesson-1 ×2 — Demo 段落 → MCP playbook（標準範例）

**Files:**
- Modify: `teaching/lesson-1-basics.zh-TW.md`、`teaching/lesson-1-basics.md`

**轉換規則（所有 lesson 共用）：** 每個「### 段落 N」底下，把「- 跑:`python3 teaching/demos/demo_tabN.py --segment K …`」這行（與相鄰的「畫面 / debrief」）改成 AI 用 MCP 的步驟。preset 值 / 點哪個元素**沿用該段原文 + 對應 `demo_tabN.py` 的 PRESETS/操作**（事實來源，不改）。等待用 §「等待訊號」（swap banner 文字消失 / run 鈕 enabled / token 機率在 snapshot）。

- [ ] **Step 1: 改 `lesson-1-basics.zh-TW.md` 三個段落**

段落 1（取代現有「跑 / 畫面 / debrief」三行）：
```markdown
- 用 MCP:開 http://localhost:9000/index.zh-TW.html → 點 Tab ①(`從這開始`旁的`① 基礎`)→ 重複 snapshot 到「載入…中」消失
- 選 preset「床前明月光,疑是地上」→ 點「送出」→ 等「送出」鈕回 enabled
- 點生成文字第一個 token → snapshot 讀機率(預期接「霜」、top-1 94%+)。旁白:它「背過」整首詩 → peaked
```
段落 2：
```markdown
- 用 MCP:選 preset「祖樹星上最高的山叫做」(先收學員預測:會說不知道、還是編山名?)→ 送出 → 等完成
- 點 token 讀 snapshot 機率。旁白:照樣高 confidence 編 → peaked ≠ 真實
```
段落 3：
```markdown
- 用 MCP:選 preset「他打開冰箱,拿出」(先問:top-10 會長怎樣?)→ 送出 → 等完成 → 點 token 讀機率
- 旁白:水/雞蛋/啤酒…分散 → 分佈形狀 = model 把握度
```
其餘段落（學習目標 / Hook 問答 / 學員動手 / 揭曉與回顧 / 常見問題）**不動**。

- [ ] **Step 2: 同步改 `lesson-1-basics.md`（英文）**

對應英譯，URL 用 `/`、preset 中文字串保留 backtick。其餘英文段落不動。

- [ ] **Step 3: 驗證 + Commit**

Run: `grep -c "用 MCP" teaching/lesson-1-basics.zh-TW.md; grep -c "demo_tab1.py" teaching/lesson-1-basics.zh-TW.md`
Expected: 第一個 ≥3（三段都有 MCP 步驟）；第二個 `0`（學生 demo 行已換掉）
```bash
git add teaching/lesson-1-basics.zh-TW.md teaching/lesson-1-basics.md
git commit -m "docs(teaching): lesson 1 demo → MCP playbook (both langs)"
```

---

### Task 7: lesson-2 / 3 / 4 ×2 — Demo 段落 → MCP playbook

**Files:**
- Modify: `teaching/lesson-2-product.zh-TW.md`、`lesson-2-product.md`、`lesson-3-reasoning.zh-TW.md`、`lesson-3-reasoning.md`、`lesson-4-agent.zh-TW.md`、`lesson-4-agent.md`

依 Task 6 同一轉換規則，逐課把「- 跑:`demo_tabN.py --segment K`」改成 MCP 步驟。各課對應 tab / 操作（事實來源 = 各課現有 Demo 段落 + `demo_tabN.py`）：

- [ ] **Step 1: lesson-2（Tab ② advanced，2 段）**

段落 1（raw）：`點 Tab ② → 等 swap → 確認 mode radio「裸 prompt」→ 選 preset「一年有幾個月?」→ 送出 → 等完成 → 讀輸出`。
段落 2（chat+system）：`填 system「你是行銷顧問,用條列式回答,只給 3 點。」→ 切 mode「產品加工(chat)」→ 選同 preset → 點開「實際送進 model 的 final prompt」preview → 送出 → 等完成 → 讀輸出 + 指 preview 的 <|im_start|> marker`。等待同 §訊號（無 token 點擊，看輸出文字出現即可）。雙語。

- [ ] **Step 2: lesson-3（Tab ③ reasoning，2 段）**

段落 1（直答）：`點 Tab ③ → 等 swap → 選 mode「直答(跳過 thinking)」→ 送出頁面預填的蘋果題 → 等完成 → 讀輸出`。
段落 2（thinking）：`選 mode「用 thinking」→ 送出同題 → 等完成 → 讀「完整回覆(含 <think>)」區 + 最終答案`。雙語。

- [ ] **Step 3: lesson-4（Tab ④ agent，2 段；第一次切會載 4B、banner 較久，先預告）**

段落 1：`點 Tab ④ → 等 4B swap(banner 較久)→ 選 preset「現在幾點?」→ 送出 → 看 turn 軌跡(紫色工具呼叫 / 綠色結果)→ 讀 final answer`。
段落 2：`選 preset「數一下這個 repo 底下有幾個 .md 檔」→ 送出 → 看 turn 累積 → 讀 final`。等待：agent 多 turn，run 鈕 enabled 才算完成。雙語。

- [ ] **Step 4: 驗證 + Commit**

Run: `grep -rc "demo_tab[234].py" teaching/lesson-2-product* teaching/lesson-3-reasoning* teaching/lesson-4-agent*`
Expected: 全部 `0`（學生 demo 行已換成 MCP）
```bash
git add teaching/lesson-2-product.zh-TW.md teaching/lesson-2-product.md teaching/lesson-3-reasoning.zh-TW.md teaching/lesson-3-reasoning.md teaching/lesson-4-agent.zh-TW.md teaching/lesson-4-agent.md
git commit -m "docs(teaching): lessons 2-4 demo → MCP playbook (both langs)"
```

---

### Task 8: demos 重定位註記（程式不改）

**Files:**
- Modify: `teaching/demos/_common.py`（檔頭 docstring）

- [ ] **Step 1: 在 `_common.py` 檔頭 docstring 開頭加一行定位說明**

把現有第一行 docstring `"""Shared Playwright helpers for teaching demos.` 改成：
```python
"""Shared Playwright helpers — CREATOR regression harness (NOT the student demo).

v2 帶課由 AI 用 browser MCP 即時驅動(見 AGENTS.md / lesson playbook);這些 Python script
降為 creator 跑 `--smoke` 的頁面回歸驗證(確認 preset/selector/生成流程沒漂移)。學生不用 pip playwright。

Shared Playwright helpers for the demo smoke harness.
```
（其餘程式不動。demo_tab1..4.py 不改。）

- [ ] **Step 2: 驗證 smoke 仍綠 + Commit**

Run: `python3 teaching/demos/demo_tab1.py --smoke 2>&1 | tail -1`
Expected: `DONE`
```bash
git add teaching/demos/_common.py
git commit -m "docs(demos): reframe Python scripts as creator smoke harness"
```

---

### Task 9: 網頁 trim + cache-bust

**Files:**
- Modify: `frontend/index.zh-TW.html`、`frontend/index.html`

- [ ] **Step 1: `index.zh-TW.html` — trim Tab ⓪ 手動導覽 CTA（~L93）**

刪掉結尾那行手動導覽 CTA：`<p class="text-sm text-muted">準備好了?點上面的 <strong>① 基礎</strong> 開始。</p>`（v2 由 AI 用 MCP 導覽,這句過時）。Tab ⓪ 其餘段落保留。

- [ ] **Step 2: `index.zh-TW.html` — 砍短 Tab ④ 最長 always-on 描述（~L333）**

找 Tab ④ `turns-area` 裡那段 `<p class="text-sm text-muted leading-relaxed">每個 turn 結束都會 …送進下一次 model 看。</p>`，砍短成：`<p class="text-sm text-muted">每個 turn 累積進 messages、送進下一次。細節聽 AI 講。</p>`（細節交給 AI 旁白 / `(?)`）。

- [ ] **Step 3: `index.html` — 鏡像 Step 1、2**

英文版對應位置同樣處理：刪 Tab ⓪ 的「Ready? Click ① Basics above to start.」CTA；砍短 Tab ④ 對應的 "Every turn accumulates into messages…" 段落為一句 + "details from the AI"。

- [ ] **Step 4: bump cache-bust v57 → v58（兩份 HTML）**

Run: `sed -i '' 's/v=57/v=58/g' frontend/index.zh-TW.html frontend/index.html`
驗證:Run `grep -c "v=58" frontend/index.zh-TW.html frontend/index.html`
Expected: 各 `2`

- [ ] **Step 5: 手動驗證頁面仍正常**

server 在跑時開 `http://localhost:9000/index.zh-TW.html`：Tab ⓪ 無 CTA 殘留、Tab ④ 描述變短、各 tab 互動正常、`(?)` explainer 還在。

- [ ] **Step 6: Commit**

```bash
git add frontend/index.zh-TW.html frontend/index.html
git commit -m "refactor(web): trim always-on prose duplicated by AI narration, bump v58"
```

---

### Task 10: 端到端驗證

**Files:** 無新檔（驗證）

- [ ] **Step 1: 自動回歸**

Run: `pytest agent/tests -q && for n in 1 2 3 4; do python3 teaching/demos/demo_tab$n.py --smoke >/dev/null 2>&1 && echo "tab$n DONE" || echo "tab$n FAIL"; done`
Expected: `67 passed` + 4 個 `DONE`

- [ ] **Step 2: init.py 真機**

Run: `python3 init.py; echo "exit=$?"`
Expected: Node/npx ✓、MCP 設定 ✓（偵測到 claude）、playwright 視情況 `WARN creator:`、summary 與 exit code 一致

- [ ] **Step 3: MCP dry-run（半手動，spec §8 的真正回歸網）**

在裝好 Playwright MCP 的 fresh Claude Code session：核准 MCP → 用 MCP navigate localhost:9000 → 實走 lesson-1 段落 1 的 playbook（切 Tab ①、等 banner 消、選 preset、送出、等 run enabled、點 token 讀機率）。確認每個等待訊號 + a11y ref 在 `@playwright/mcp@0.0.76` 下都 work。

- [ ] **Step 4: 進場演練（人工）**

fresh Claude Code session 開 repo → 核准 Playwright MCP → 說「hi」→ 確認 AI 問角色 → 答學員 → AI 跑 init.py → 用 MCP 開**一個**瀏覽器帶 lesson 1 → demo 後瀏覽器留著、學生自己換 preset 試。Codex 路徑抽查：首次信任 prompt → 同流程。

- [ ] **Step 5: 收尾**

確認 `git status` clean、所有 commit 進了；向 user 回報驗收結果與 §9 已知風險（MCP 不確定性 / token 成本），交還整合決策。
