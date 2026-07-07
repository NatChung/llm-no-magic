# Tab ④ 簡化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab ④ 移除 System Prompt UI、prompt preview 改常駐(Tab ②/③ 同款)、實際送進 model 的 prompt 瘦身成「system 只剩 `/no_think` + tools 只剩 `get_time`」,教材與 README 同步。

**Architecture:** 改動圈在 Tab ④ 路徑:`agent/server.py` 的 `agent_loop` + `_handle_preview` 改用新常數 `TAB4_TOOL_SCHEMAS` 與 helper `tab4_system()`;`agent.py`(CLI,保留 4 工具)與 Tab ⑤ `/skill-agent` 不動。前端刪 system textarea、`<details>` 換常駐區塊。spec:`docs/superpowers/specs/2026-07-07-tab4-simplify-design.md`。

**Tech Stack:** Python 3 stdlib http.server + pytest(mock `requests.post`)、零 build 前端(Tailwind Play CDN)、llama.cpp `/apply-template`。

## Global Constraints

- 雙語:每個 user-facing 改動同時落在 EN 與 zh-TW 檔(`index.html`/`index.zh-TW.html`、`README.md`/`README.en.md`、lesson-4 兩檔)
- 前端檔有改就把兩個 HTML 的 `app.js?v=75` bump 成 `?v=76`(`styles.css?v=65` 不動——styles.css 沒改)
- 測試風格:plain pytest function + monkeypatch/mock,跟 `agent/tests/test_server.py` 現有寫法一致
- Commit message 結尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 風險已預先實測(2026-07-07,4B):slim prompt 下「現在幾點?」4/4 呼叫 get_time、「1+1 等於幾?」4/4 不呼叫工具、2-turn loop 正常

---

### Task 0: 先把 working tree 既有的未 commit 修改收乾淨

工作樹裡有上一輪教材潤稿(10 檔,`agent/agent.py`、`frontend/app.js`、兩個 HTML、lesson-1/3/4 ×2)。它們與本 plan 要改的檔案重疊,必須先獨立 commit,本 plan 的 diff 才乾淨。

**Files:**
- Modify: 無(只 commit 既有修改)

- [ ] **Step 1: 確認現有 diff 就是教材潤稿**

Run: `git diff --stat`
Expected: 10 files changed(agent.py / app.js / index*.html / lesson-1,3,4 ×2)。若出現其他檔案,停下來問 Nat。

- [ ] **Step 2: 跑測試確認現狀是綠的**

Run: `pytest agent/tests -q`
Expected: 全 PASS

- [ ] **Step 3: Commit**

```bash
git add agent/agent.py frontend/app.js frontend/index.html frontend/index.zh-TW.html teaching/lesson-1-basics.md teaching/lesson-1-basics.zh-TW.md teaching/lesson-3-reasoning.md teaching/lesson-3-reasoning.zh-TW.md teaching/lesson-4-agent.md teaching/lesson-4-agent.zh-TW.md
git commit -m "docs(teaching): lesson polish — optional segment 2, registry note, sys-prompt sync

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: 後端 slim prompt(server.py,TDD)

**Files:**
- Modify: `agent/server.py`(import 區、`agent_loop` 約 L226-296、`_handle_preview` 約 L642-672)
- Test: `agent/tests/test_server.py`(附加在 `test_agent_loop_no_tools_yields_turn_then_final` 附近)

**Interfaces:**
- Consumes: `agent.agent.TOOL_SCHEMAS`(現有,不改)
- Produces: `server.TAB4_TOOL_SCHEMAS: list[dict]`(只含 get_time)、`server.tab4_system(system: str) -> str`(Task 4 驗證與未來測試依賴這兩個名字)

- [ ] **Step 1: 寫 failing tests**

加到 `agent/tests/test_server.py`(緊接 `test_agent_loop_no_tools_yields_turn_then_final` 之後;`_mock_llama_resp`、`_mock_template_resp`、`_start_server_in_thread` 是檔內既有 helper):

```python
def test_tab4_system_helper():
    """tab4_system:無 override → 純 /no_think;有 override → 附加在前。"""
    import agent.server as server
    assert server.tab4_system("") == "/no_think"
    assert server.tab4_system("Be brief.") == "Be brief.\n\n/no_think"


def test_agent_loop_tab4_slim_prompt(monkeypatch):
    """Tab ④ 瘦身:tools 只送 get_time;system 沒 override 時內容只剩 /no_think。"""
    import agent.server as server

    captured = {}
    def fake_post(url, **kw):
        if "apply-template" in str(url):
            return _mock_template_resp(prompt="(stub)")
        captured["json"] = kw.get("json")
        return _mock_llama_resp(content="hi", logprobs_content=[])
    monkeypatch.setattr(server.requests, "post", fake_post)

    list(server.agent_loop("", "現在幾點?"))
    sent = captured["json"]
    assert [t["function"]["name"] for t in sent["tools"]] == ["get_time"]
    assert sent["messages"][0] == {"role": "system", "content": "/no_think"}


def test_preview_uses_tab4_slim_config(monkeypatch):
    """POST /preview 打 /apply-template 帶 get_time-only tools + /no_think system。"""
    import agent.server as server

    captured = {}
    def fake_post(url, **kw):
        captured["json"] = kw.get("json")
        return _mock_template_resp(prompt="TPL")
    monkeypatch.setattr(server.requests, "post", fake_post)

    srv, port = _start_server_in_thread()
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/preview",
            data=json.dumps({"user": "現在幾點?"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=5)
        assert json.loads(resp.read())["prompt"] == "TPL"
    finally:
        srv.shutdown()

    sent = captured["json"]
    assert [t["function"]["name"] for t in sent["tools"]] == ["get_time"]
    assert sent["messages"][0]["content"] == "/no_think"
```

註:`_start_server_in_thread` 的收尾寫法(`srv.shutdown()` 或其他)以檔內既有測試為準,照抄同款。

- [ ] **Step 2: 跑測試確認 fail**

Run: `pytest agent/tests/test_server.py -q -k "tab4_slim or tab4_system or preview_uses"`
Expected: 3 FAIL(`AttributeError: ... no attribute 'tab4_system'` 等)

- [ ] **Step 3: 實作**

`agent/server.py`:

3a. `MODEL_FOR_TAB` 定義(約 L223)之後加:

```python
# Tab ④ 教學用瘦身配置(spec 2026-07-07-tab4-simplify):頁面只教 get_time,
# system 只留 /no_think。CLI(agent.py)與 Tab ⑤ 仍用完整 SYSTEM_PROMPT /
# TOOL_SCHEMAS——這裡是唯一縮減的路徑。
TAB4_TOOL_SCHEMAS = [s for s in TOOL_SCHEMAS if s["function"]["name"] == "get_time"]


def tab4_system(system: str) -> str:
    """Tab ④ system 內容:可選 override + /no_think(Qwen3 documented switch,
    fallback:enable_thinking:false 在部分 llama.cpp build 壓不住 <think>)。"""
    return (system.strip() + "\n\n" if system and system.strip() else "") + "/no_think"
```

3b. `agent_loop` 開頭的 messages 改成:

```python
    messages = [
        {"role": "system", "content": tab4_system(system)},
        {"role": "user",   "content": user},
    ]
```

(原本的 system 那行與其上**三行** `/no_think` 註解(`# Qwen3 documented …` 起共 3 行)一併刪掉——內容已搬進 `tab4_system` docstring;直接以上面的 code block 為準整段替換即可)

3c. `agent_loop` 內兩處 `"tools": TOOL_SCHEMAS` → `"tools": TAB4_TOOL_SCHEMAS`(主呼叫 約L245 與 next_prompt 的 `/apply-template` 約L290)。

3d. `_handle_preview` 的 messages 與 tools 改成:

```python
        messages = [
            {"role": "system", "content": tab4_system(body.get("system", ""))},
            {"role": "user",   "content": body.get("user", "")},
        ]
```

與 `"tools": TAB4_TOOL_SCHEMAS`。

3e. import 區(約 L33-34):`SYSTEM_PROMPT` 在 server.py 已無使用者 → 從 import 移除(用 `grep -n SYSTEM_PROMPT agent/server.py` 確認 0 使用再刪)。

- [ ] **Step 4: 跑測試確認過**

Run: `pytest agent/tests -q`
Expected: 全 PASS(含既有 `test_agent_loop_*`——它們沒 assert system 內容/tools,不受影響;若有 fail,讀 fail 訊息修測試預期而非亂改實作)

- [ ] **Step 5: Commit**

```bash
git add agent/server.py agent/tests/test_server.py
git commit -m "feat(tab4): slim prompt — /no_think-only system, get_time-only tools

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 前端 — 刪 system UI、preview 常駐、cache bust

**Files:**
- Modify: `frontend/index.html:163-179`、`frontend/index.zh-TW.html:163-179`(Tab 4 prompt-area)
- Modify: `frontend/index.html:338`、`frontend/index.zh-TW.html:337`(`app.js?v=75` → `?v=76`)
- Modify: `frontend/app.js`(L90-96 常數、`setupAgent` L435-477、`beginRun` L651-659、`driveAgent` L669-674)

**Interfaces:**
- Consumes: `/preview` API(Task 1 後 body 只需 `{user}`)
- Produces: 無(頁面末端)

- [ ] **Step 1: index.html — 刪 system UI + preview 常駐**

`frontend/index.html` Tab 4 `prompt-area` 內:

刪掉這兩行(L165-166):

```html
      <label for="system-prompt-agent" class="block text-sm font-medium text-ink-soft">System Prompt (prefilled, editable)</label>
      <textarea class="system-prompt w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm font-mono focus:outline-none focus:border-final focus:ring-1 focus:ring-final" id="system-prompt-agent" rows="4"></textarea>
```

「Question」label 的 `pt-2` 拿掉(不再需要與上方 textarea 的間距):

```html
      <label for="prompt-agent" class="block text-sm font-medium text-ink-soft">Question</label>
```

整段 `<details class="preview-details">…</details>`(L174-177)換成 Tab ②/③ 同款常駐區塊:

```html
      <div class="pt-3 space-y-2">
        <h3 class="text-xs uppercase tracking-wider text-muted font-medium">Prompt actually sent to the model</h3>
        <pre class="final-prompt-preview rounded-lg shadow-[0_1px_3px_oklch(20%_0.012_280_/_0.06)] bg-surface border border-edge p-4 text-xs font-mono whitespace-pre-wrap break-all max-h-80 overflow-auto text-ink-soft"></pre>
      </div>
```

- [ ] **Step 2: index.zh-TW.html — 同步**

同 Step 1,但文案:label = `問題`(原檔就是)、h3 = `實際送進 model 的 prompt`(跟 Tab ②/③ zh 標題一致)。刪除的 system label 是 `System Prompt(預填,可改)` 那兩行(L165-166)、`<details>` 是 L174-177。

- [ ] **Step 3: 兩個 HTML bump cache-bust**

`frontend/index.html:338` 與 `frontend/index.zh-TW.html:337`:

```html
<script src="app.js?v=76"></script>
```

- [ ] **Step 4: app.js — 刪 system 邏輯**

4a. 刪 L90-96 整塊(註解 2 行 + `AGENT_DEFAULT_SYSTEM` 常數)。

4b. `setupAgent`:
- 刪 `const systemEl = panel.querySelector(".system-prompt");`
- 刪預填塊:`// 預填 system prompt` + `if (!systemEl.value) systemEl.value = AGENT_DEFAULT_SYSTEM;`
- `refreshPreview` 的 fetch body 改成:

```js
        body:   JSON.stringify({ user: promptEl.value }),
```

- 刪 `systemEl.addEventListener("input", debouncedRefreshPreview);`(保留 promptEl 那行)

4c. `beginRun`:刪 `if (frame && frame.system != null) systemEl.value = frame.system;`

4d. `driveAgent`:

```js
    postDrive({ tab: "4", user: promptEl.value })
```

4e. 確認乾淨:`grep -n 'systemEl\|AGENT_DEFAULT_SYSTEM\|system-prompt' frontend/app.js frontend/index.html frontend/index.zh-TW.html` → 0 hit。

- [ ] **Step 5: 跑測試(不該有影響,保險)**

Run: `pytest agent/tests -q`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html frontend/index.zh-TW.html frontend/app.js
git commit -m "feat(tab4): remove system-prompt UI, always-visible prompt preview

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 教材 + README + demo harness 同步(工具只剩 get_time 的後果)

**Files:**
- Modify: `teaching/lesson-4-agent.zh-TW.md`、`teaching/lesson-4-agent.md`
- Modify: `README.md:89-92`、`README.en.md:92-95`
- Modify: `teaching/demos/demo_tab4.py`

**Interfaces:** 無(純文件/harness)

- [ ] **Step 1: lesson-4-agent.zh-TW.md**

1a. 刪整段「### 段落 2(選配,時間夠才跑)— 數 .md 檔(exec_bash)」(標題到「示範 multi-turn 修正」止)。

1b. 「## 學員動手」整段(含其後的 `> 註:system prompt 刻意只點名 get_time…` blockquote)換成:

```markdown
## 學員動手
學員在輸入框自己打一句**不需要工具的問題**(例:`1+1 等於幾?`),送出,
看 turn 軌跡:這次**沒有**紫色「↑ 工具呼叫」,Turn 1 直接就是 final answer。
對照「現在幾點?」— 同一個 model、同一份 prompt,**要不要用工具是它在
Turn 1 自己決定的**;這也是為什麼看「↑ 工具呼叫」就能知道它這一輪在幹嘛。
```

1c. 揭曉與回顧:
- item 1 `read_file 是真的 Python function` → `get_time 是真的 Python function`
- item 2 `Agent(read_file 真讀檔)` → `Agent(用讀檔工具真讀檔 — 跟今天的 get_time 一樣,是 client 定義的真 function)`

1d. Demo 段落標題行與段落 1 不動。

- [ ] **Step 2: lesson-4-agent.md(EN 鏡像)**

2a. 刪「### Segment 2 (optional — run only if time allows) — Count .md files (exec_bash)」整段。

2b. Hands-On + 其後 `> Note:` blockquote 換成:

```markdown
## Hands-On
Have participants type **a question that needs no tool** (e.g. `1+1 等於幾?`) into the input box themselves and submit it.
Watch the turn trace: this time there is **no** purple "↑ Tool call" — Turn 1 goes straight to the final answer.
Contrast with `現在幾點?` — same model, same prompt: **whether to use a tool is the model's own Turn-1 decision.** This is exactly why watching the "↑ Tool call" block tells you what it did this round.
```

2c. Reveal item 1 `` `read_file` is a real Python function `` → `` `get_time` is a real Python function ``(原文 read_file 帶 backtick,用 substring 比對);item 2 `Agent (read_file reads files for real)` → `Agent (a file-reading tool reads files for real — a genuine client-defined function, just like today's get_time)`。

- [ ] **Step 3: README.md — Tab ④ demo 段**

L89-92 的「3 個 Tab ④ preset:」清單換成:

```markdown
Tab ④ 只掛一個工具:`get_time`(頁面的「實際送進 model 的 prompt」常駐區
可看到 `<tools>` 只有一行)。對照題:打一句不需要工具的問題(例:`1+1 等於
幾?`),model 這輪**不**呼叫工具直接答 — 用不用工具是 model 自己決定的。
```

- [ ] **Step 4: README.en.md — 鏡像**

L92-95 的「Three Tab ④ presets:」清單換成:

```markdown
Tab ④ ships exactly one tool: `get_time` (the always-visible "Prompt actually sent to the model" block shows a single-line `<tools>`). Contrast prompt: type a question that needs no tool (e.g. `1+1 等於幾?`) — the model answers directly with **no** tool call; whether to use a tool is the model's own decision.
```

- [ ] **Step 5: teaching/demos/demo_tab4.py — harness 同步**

docstring 第 4 行與 PRESETS 改成:

```python
段落:1=現在幾點?(get_time,最快) 2=1+1 等於幾?(對照:不呼叫工具直接答)
```

```python
PRESETS = {
    1: ("現在幾點?", "get_time"),
    2: ("1+1 等於幾?", "(no tool — 直接答)"),
}
```

`run_segment` 的 log 字串把「預期 <tool_call> {tool}」改為「預期:{tool}」(preset 2 的期望不是 tool_call)。`c.run_segments(page, None, args, 2, run_segment)` 的 `2` 不變(仍兩段)。

- [ ] **Step 6: 全域檢查沒有殘留失效敘述**

Run: `grep -rn 'llm-summary\|exec_bash\|read_file\|write_file' teaching/*.md README.md README.en.md`
Expected: 只剩 README `Code tour` 那行(講 `agent.py` CLI 有 4 tools — 仍為事實,保留)。
註:`agent/SETUP*.md` 刻意不在 grep 範圍——它們描述的是 `agent/smoke.py` 走 CLI(`agent.agent`)的回歸 harness,不受本次 server 端改動影響。

- [ ] **Step 7: Commit**

```bash
git add teaching/lesson-4-agent.md teaching/lesson-4-agent.zh-TW.md README.md README.en.md teaching/demos/demo_tab4.py
git commit -m "docs(lesson4): get_time-only tab4 — new no-tool hands-on, drop exec_bash segment

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Live 驗證(重啟 server + 實測)

**Files:** 無(驗證)

- [ ] **Step 1: 重啟 server**

```bash
pkill -f 'agent.server'; sleep 1
nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
sleep 2 && curl -s http://localhost:9000/health
```

Expected: `{"status": "ok", ...}`

- [ ] **Step 2: /preview 目視**

```bash
curl -s -X POST http://localhost:9000/preview -H 'Content-Type: application/json' -d '{"user":"現在幾點?"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['prompt'])"
```

Expected: system 區只有 `/no_think` + `# Tools`;`<tools>` 只有 get_time 一行;無「You are a helpful assistant…」。

- [ ] **Step 3: /drive 實測兩題**

```bash
curl -s -X POST http://localhost:9000/drive -H 'Content-Type: application/json' -d '{"tab":"4","user":"現在幾點?"}'
```

Expected: Turn 1 `tool_calls=[get_time]`、Turn 2 final 含正確 HH:MM:SS(首發含 0.6B→4B swap,等 3-5 s)。

```bash
curl -s -X POST http://localhost:9000/drive -H 'Content-Type: application/json' -d '{"tab":"4","user":"1+1 等於幾?"}'
```

Expected: 單 turn、無 tool_calls、final 直接答 2。

- [ ] **Step 4: 頁面目視**

請 Nat 重新整理 http://localhost:9000/(cache-bust 後要 reload):Tab ④ 應無 System Prompt 欄位、「實際送進 model 的 prompt」常駐顯示且內容為瘦身版、送出「現在幾點?」turn 軌跡正常。

- [ ] **Step 5: 全套測試收尾**

Run: `pytest agent/tests -q`
Expected: 全 PASS
