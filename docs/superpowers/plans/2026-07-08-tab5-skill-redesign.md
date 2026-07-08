# Tab ⑤ Skill Demo Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single-skill Tab ⑤ with a live pre-send prompt preview, per-turn actual-prompt views on EVERY turn, a skill-anatomy file-tree card, and the "four packagings of context injection" map in Lesson 5.

**Architecture:** Backend: extend `POST /preview` (first tab branch) and `POST /inspect` (tab-5 data response, no relay publish) in the stdlib server; anatomy data built by a new pure function in `agent/skill_agent.py`. Frontend: zero-build vanilla JS in `frontend/app.js` (closure-per-panel pattern), bilingual static HTML. No new endpoints, no new dependencies.

**Tech Stack:** Python 3 stdlib http server + `requests` (existing), pytest (plain functions + monkeypatch mocks — keep this style), vanilla JS + Tailwind Play CDN classes copied from existing markup.

**Spec:** `docs/superpowers/specs/2026-07-08-tab5-skill-redesign-design.md` (read it first).

## Global Constraints

- Bilingual: every user-facing string lands in BOTH `frontend/index.html` (EN) and `frontend/index.zh-TW.html` (zh-TW); JS strings go in the `I18N` table in `app.js` with `en` + `zh-TW` keys.
- Bump cache-bust `app.js?v=81` → `app.js?v=82` in BOTH html files (once, in the last frontend task).
- Tests: `pytest agent/tests -q` must stay green; plain pytest functions + monkeypatch, no classes/fixtures-files.
- Mode strings are exactly `proper` / `no_skills` (NOT `no_skill`).
- `/preview` and `/inspect` must keep their existing tab-④/①–③ behavior byte-identical (existing tests enforce this).
- Working branch: `feat/tab5-tab6-finish`. Commit after every task, message style `feat(tab5): …` / `test(tab5): …` / `docs(teaching): …`, each ending with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

### Task 1: Single skill — delete organize_files, fix dangling example, index tests

**Files:**
- Delete: `agent/skills/organize_files/` (whole dir: SKILL.md, REFERENCE.md, scripts/organize.py)
- Modify: `agent/skill_agent.py:92` (tool description example)
- Test: `agent/tests/test_skill_agent.py` (append two tests)

**Interfaces:**
- Consumes: `agent.skill_agent.load_index()` (existing, unchanged signature).
- Produces: repo guarantee "exactly one skill: check_weather" that Tasks 2–6 rely on; `load_index()` behavior itself unchanged (generic).

- [ ] **Step 1: Write the failing tests** — append to `agent/tests/test_skill_agent.py`:

```python
def test_repo_index_is_single_skill():
    """Repo policy (spec 2026-07-08): exactly one skill ships — check_weather."""
    import agent.skill_agent as sa
    index = sa.load_index()
    assert list(index.keys()) == ["check_weather"]
    assert index["check_weather"]["scripts"] == ["weather.py"]


def test_load_index_multi_skill_fixture(tmp_path, monkeypatch):
    """load_index() stays generic: N skill dirs → N entries (fixture, not repo)."""
    import agent.skill_agent as sa
    for name in ("alpha", "beta"):
        d = tmp_path / name
        (d / "scripts").mkdir(parents=True)
        (d / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: {name} desc\n---\nBody of {name}.\n")
        (d / "scripts" / "run.py").write_text("print('hi')\n")
    monkeypatch.setattr(sa, "SKILLS_DIR", tmp_path)
    index = sa.load_index()
    assert set(index.keys()) == {"alpha", "beta"}
    assert index["alpha"]["description"] == "alpha desc"
    assert index["beta"]["scripts"] == ["run.py"]
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `pytest agent/tests/test_skill_agent.py -q`
Expected: `test_repo_index_is_single_skill` FAILS (index has 2 keys); `test_load_index_multi_skill_fixture` PASSES (generic path already works — that's fine, it's a regression guard).

- [ ] **Step 3: Delete the skill and fix the example**

```bash
git rm -r agent/skills/organize_files
```

In `agent/skill_agent.py` line 92 change:

```python
                "script": {"type": "string", "description": "Filename inside the skill's scripts/ dir (e.g. organize.py)"},
```
to
```python
                "script": {"type": "string", "description": "Filename inside the skill's scripts/ dir (e.g. weather.py)"},
```

- [ ] **Step 4: Run the whole suite**

Run: `pytest agent/tests -q`
Expected: all green (118 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add -A agent/skills agent/skill_agent.py agent/tests/test_skill_agent.py
git commit -m "feat(tab5): single skill — drop organize_files, fix tool example

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `/preview` tab-5 branch (server)

**Files:**
- Modify: `agent/server.py:37` (import line) and `agent/server.py:665-694` (`_handle_preview`)
- Test: `agent/tests/test_server.py` (append one test near `test_preview_uses_tab4_slim_config`, line ~153)

**Interfaces:**
- Consumes: `skill_agent.load_index()`, `proper_system_prompt(index)`, `no_skills_system_prompt()`, `LOAD_SKILL_TOOL`, `READ_SKILL_FILE_TOOL`, `RUN_SKILL_SCRIPT_TOOL` (all existing).
- Produces: `POST /preview` with body `{"tab":"5","user":str,"mode":"proper"|"no_skills"}` → `{"prompt": str}` (chat-template-expanded). Body WITHOUT `"tab"` behaves exactly as today (tab ④). Task 5's frontend calls this.

- [ ] **Step 1: Write the failing test** — append to `agent/tests/test_server.py` (reuse the module's existing `_mock_template_resp`, `_start_server_in_thread` helpers, same pattern as `test_preview_uses_tab4_slim_config`):

```python
def test_preview_tab5_proper_vs_no_skills(monkeypatch):
    """POST /preview tab=5:proper 帶 skill index system + 3 tools;no_skills 無 tools。"""
    import agent.server as server

    captured = {}
    def fake_post(url, **kw):
        captured["json"] = kw.get("json")
        return _mock_template_resp(prompt="TPL5")
    monkeypatch.setattr(server.requests, "post", fake_post)

    srv, port = _start_server_in_thread()
    try:
        def post_preview(body):
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/preview",
                data=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json"}, method="POST")
            return json.loads(urllib.request.urlopen(req, timeout=5).read())

        out = post_preview({"tab": "5", "user": "台北天氣?", "mode": "proper"})
        assert out["prompt"] == "TPL5"
        sent = captured["json"]
        assert "## Skill index (L1)" in sent["messages"][0]["content"]
        assert sent["messages"][1] == {"role": "user", "content": "台北天氣?"}
        assert [t["function"]["name"] for t in sent["tools"]] == [
            "load_skill", "read_skill_file", "run_skill_script"]

        post_preview({"tab": "5", "user": "台北天氣?", "mode": "no_skills"})
        sent = captured["json"]
        assert "Skill index" not in sent["messages"][0]["content"]
        assert "tools" not in sent
    finally:
        srv.shutdown()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest agent/tests/test_server.py::test_preview_tab5_proper_vs_no_skills -q`
Expected: FAIL — the assertion on `"## Skill index (L1)"` (handler still hardcodes tab4 `/no_think` system).

- [ ] **Step 3: Implement.** In `agent/server.py` extend the import at line 37:

```python
from agent.skill_agent import (skill_agent_loop, load_index, proper_system_prompt,
                               no_skills_system_prompt, LOAD_SKILL_TOOL,
                               READ_SKILL_FILE_TOOL, RUN_SKILL_SCRIPT_TOOL)
```

Replace the body of `_handle_preview` between `if body is None: return` and the `try:` with a tab dispatch (existing tab-④ path preserved verbatim in the else branch):

```python
        if body.get("tab") == "5":
            # Tab ⑤ pre-send preview (spec 2026-07-08 §3a): the exact turn-1
            # messages+tools skill_agent_loop would send, template-expanded.
            mode = body.get("mode") or "proper"
            if mode == "no_skills":
                system = no_skills_system_prompt()
                tools = []
            else:
                system = proper_system_prompt(load_index())
                tools = [LOAD_SKILL_TOOL, READ_SKILL_FILE_TOOL, RUN_SKILL_SCRIPT_TOOL]
            messages = [
                {"role": "system", "content": system},
                {"role": "user",   "content": body.get("user", "")},
            ]
            payload = {"messages": messages, "add_generation_prompt": True}
            if tools:
                payload["tools"] = tools
        else:
            messages = [
                {"role": "system", "content": tab4_system(body.get("system", ""))},
                {"role": "user",   "content": body.get("user", "")},
            ]
            payload = {"messages": messages, "tools": TAB4_TOOL_SCHEMAS,
                       "add_generation_prompt": True}
```

and change the `requests.post(LLAMA_TEMPLATE_URL, json={...})` call to `requests.post(LLAMA_TEMPLATE_URL, json=payload, timeout=5)`. The `[preview error] {ExcName}: {exc}` fallback and the JSON response writing stay untouched.

- [ ] **Step 4: Run tests**

Run: `pytest agent/tests/test_server.py -q`
Expected: all green, including the untouched `test_preview_uses_tab4_slim_config` (back-compat proof).

- [ ] **Step 5: Commit**

```bash
git add agent/server.py agent/tests/test_server.py
git commit -m "feat(tab5): /preview tab-5 branch — proper vs no_skills pre-send prompt

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: skill anatomy data — `skill_anatomy()` + `/inspect` tab-5 branch

**Files:**
- Modify: `agent/skill_agent.py` (new function after `load_skill_body`, ~line 156)
- Modify: `agent/server.py:711-717` (`_handle_inspect`) + the import from Task 2 (add `skill_anatomy`)
- Test: `agent/tests/test_skill_agent.py`, `agent/tests/test_server.py`

**Interfaces:**
- Produces: `skill_agent.skill_anatomy() -> list[dict]`, entries `{"path": str, "layer": "L1"|"L2"|"L3", "content": str}`; SKILL.md contributes TWO entries (`…/SKILL.md#frontmatter` = L1 incl. the `---` fences, `…/SKILL.md#body` = L2); each script file one L3 entry. Paths relative to `agent/` (e.g. `skills/check_weather/SKILL.md#frontmatter`).
- Produces: `POST /inspect` `{"tab":"5"}` → `{"files": [...]}`; MUST NOT publish to the relay. Any body without `"tab":"5"` → legacy publish of `{"type":"inspect","tokenIndex":…}` unchanged. Task 6's frontend calls this.

- [ ] **Step 1: Write the failing tests.** Append to `agent/tests/test_skill_agent.py`:

```python
def test_skill_anatomy_three_layers():
    import agent.skill_agent as sa
    files = sa.skill_anatomy()
    by_path = {f["path"]: f for f in files}
    fm = by_path["skills/check_weather/SKILL.md#frontmatter"]
    assert fm["layer"] == "L1" and fm["content"].startswith("---")
    assert "name: check_weather" in fm["content"]
    body = by_path["skills/check_weather/SKILL.md#body"]
    assert body["layer"] == "L2" and "---" not in body["content"].splitlines()[0]
    script = by_path["skills/check_weather/scripts/weather.py"]
    assert script["layer"] == "L3" and "def " in script["content"]
```

Append to `agent/tests/test_server.py`:

```python
def test_inspect_tab5_returns_files_and_does_not_publish(monkeypatch):
    """/inspect {'tab':'5'} → anatomy data, no relay publish;無 tab → 舊行為。"""
    import agent.server as server

    published = []
    monkeypatch.setattr(server, "publish", lambda f: published.append(f))

    srv, port = _start_server_in_thread()
    try:
        def post_inspect(body):
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/inspect",
                data=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json"}, method="POST")
            return json.loads(urllib.request.urlopen(req, timeout=5).read())

        out = post_inspect({"tab": "5"})
        assert any(f["layer"] == "L2" for f in out["files"])
        assert published == []

        out = post_inspect({"tokenIndex": 3})
        assert out["ok"] is True
        assert published == [{"type": "inspect", "tokenIndex": 3}]
    finally:
        srv.shutdown()
```

- [ ] **Step 2: Run to verify failures**

Run: `pytest agent/tests/test_skill_agent.py::test_skill_anatomy_three_layers agent/tests/test_server.py::test_inspect_tab5_returns_files_and_does_not_publish -q`
Expected: both FAIL (`skill_anatomy` not defined; `/inspect` publishes and lacks `files`).

- [ ] **Step 3: Implement.** In `agent/skill_agent.py` after `load_skill_body` add:

```python
def skill_anatomy() -> list[dict]:
    """Anatomy card data (spec 2026-07-08 §2): the on-disk three layers.

    SKILL.md is deliberately split into two entries — the pedagogical point
    is that ONE file carries L1 (frontmatter) and L2 (body).
    """
    files = []
    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        skill_md = skill_dir / "SKILL.md"
        if not skill_dir.is_dir() or not skill_md.exists():
            continue
        text = skill_md.read_text()
        m = re.match(r"^(---\s*\n.*?\n---\s*\n)(.*)", text, re.DOTALL)
        fm, body = (m.group(1), m.group(2)) if m else ("", text)
        rel = str(skill_dir.relative_to(SKILLS_DIR.parent))
        files.append({"path": f"{rel}/SKILL.md#frontmatter", "layer": "L1", "content": fm.strip()})
        files.append({"path": f"{rel}/SKILL.md#body", "layer": "L2", "content": body.strip()})
        scripts_dir = skill_dir / "scripts"
        if scripts_dir.exists():
            for s in sorted(scripts_dir.iterdir()):
                if s.is_file():
                    files.append({"path": f"{rel}/scripts/{s.name}", "layer": "L3",
                                  "content": s.read_text()})
    return files
```

In `agent/server.py`: add `skill_anatomy` to the Task-2 import list, and replace `_handle_inspect` body after `if body is None: return` with:

```python
        if body.get("tab") == "5":
            # data response only — no relay publish (spec 2026-07-08 §2:
            # reusing /inspect keeps the endpoint list unchanged; the tab
            # discriminator keeps tabs ①-③ tokenIndex behavior intact)
            self._send_json({"files": skill_anatomy()})
            return
        publish({"type": "inspect", "tokenIndex": body.get("tokenIndex", 0)})
        self._send_json({"ok": True, "subscribers": subscriber_count()})
```

- [ ] **Step 4: Run the whole suite**

Run: `pytest agent/tests -q`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add agent/skill_agent.py agent/server.py agent/tests/test_skill_agent.py agent/tests/test_server.py
git commit -m "feat(tab5): skill_anatomy() + /inspect tab-5 data branch (no publish)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: frontend — sent/received expanders on the FINAL turn too

**Files:**
- Modify: `frontend/app.js` — `setupSkillTab`: `onTurn` (~line 915-918) and `onFinal` (~line 982-994); `I18N` table (~line 89).

**Interfaces:**
- Consumes: `sent`/`received` frames buffered in `pendingSent`/`pendingReceived` (existing), `BUBBLE.details`, `BUBBLE.pre`, `BUBBLE.finalBlock` (existing helpers).
- Produces: every turn — including the content-only final turn — carries the「此 turn 實際送出的 prompt」expander. New I18N key `sent_prompt_summary` (tab ⑤ only; tabs ④/⑥ keep `next_prompt_summary` untouched).

- [ ] **Step 1: Add the I18N key** (after the `next_prompt_summary` entry, app.js ~line 92):

```js
  sent_prompt_summary: {
    'en':    'Actual prompt sent this turn (turn {turn})',
    'zh-TW': '此 turn 實際送出的 prompt(turn {turn})',
  },
```

- [ ] **Step 2: Stop dropping the final turn's frames.** In `onTurn` change:

```js
    if (!hasCalls) { pendingSent = null; pendingReceived = null; return; }  // content-only turn renders at `final`
```
to
```js
    if (!hasCalls) return;  // content-only turn renders at `final` — keep pendingSent/Received for it
```

and in the same function switch the expander label from `t('next_prompt_summary', { turn: f.turn })` to `t('sent_prompt_summary', { turn: f.turn })`.

- [ ] **Step 3: Attach them in `onFinal`.** Replace the `if (!finalDone && f.content) { … }` block with:

```js
  if (!finalDone && f.content) {
    const fb = BUBBLE.finalBlock({ caption: t('to_user_caption'), content: f.content });
    turnsEl.appendChild(fb);
    // final turn is content-only, so onTurn skipped its wire views — the
    // final turn's `sent` holds the FULLEST accumulated messages (incl. the
    // injected L2 body): attach here so EVERY turn has its expander.
    if (pendingSent) {
      fb.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn: pendingSent.turn }),
        BUBBLE.pre(JSON.stringify(pendingSent.messages, null, 2))));
      pendingSent = null;
    }
    if (pendingReceived) {
      fb.appendChild(BUBBLE.details(t('received_summary'),
        BUBBLE.pre(JSON.stringify(pendingReceived.response, null, 2))));
      pendingReceived = null;
    }
    const rounds = turns.length;
    const trips = turns.filter((x) => x.hadTool).length;
    if (rounds) turnsEl.prepend(BUBBLE.banner(
      trips === 0 ? t('trace_summary_notool') : t('trace_summary', { trips, rounds })));
    finalDone = true;
  }
  setRunning(false);
```

(`BUBBLE.finalBlock` returns a bare DOM node — app.js:360-371 — so `fb.appendChild(...)` works directly.)

- [ ] **Step 4: Verify by driving.** Server up (`nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &`), page open at http://localhost:9000/, then:

```bash
curl -s -X POST http://localhost:9000/drive -H 'Content-Type: application/json' \
  -d '{"tab":"5","user":"台北今天天氣怎樣?"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['turns']), d['final'])"
```

Expected on the page: the green final block now has TWO ▸ expanders under it; the sent one shows `messages` containing the SKILL.md body (role `tool` + the L2 injection). Hard-reload with devtools open (cache-bust lands in Task 6).

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js
git commit -m "feat(tab5): final turn gets sent/received expanders too

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: frontend — live pre-send prompt preview (both HTML files + wiring)

**Files:**
- Modify: `frontend/index.html` (~line 320, inside the left `<section>` of the skill panel, after the no-skills-toggle `</label>` closing its parent `<div>`)
- Modify: `frontend/index.zh-TW.html` (same position)
- Modify: `frontend/app.js` — `setupSkillTab` (~line 850-866 for element refs, wiring after `driveSkill` definition ~line 1022)

**Interfaces:**
- Consumes: `POST /preview {"tab":"5","user","mode"}` → `{"prompt"}` (Task 2); `renderPromptPreview(previewEl, text)` (existing, app.js:233).
- Produces: `.final-prompt-preview` box in the skill panel, refreshed (300 ms debounce) on input/toggle/init.

- [ ] **Step 1: Add markup.** In `frontend/index.html` insert after the `</div>` that closes the Question block (the div containing textarea + toggle, i.e. after line 321's `</div>`):

```html
        <div>
          <h3 class="text-xs uppercase tracking-wider text-muted font-medium mb-2">Prompt actually sent to the model (turn 1)</h3>
          <pre class="final-prompt-preview rounded-lg shadow-[0_1px_3px_oklch(20%_0.012_280_/_0.06)] bg-surface border border-edge p-4 text-xs font-mono whitespace-pre-wrap break-all max-h-80 overflow-auto text-ink-soft"></pre>
        </div>
```

Same block in `frontend/index.zh-TW.html`, heading text:「實際送進 model 的 prompt(第 1 turn)」.

- [ ] **Step 2: Wire it.** In `setupSkillTab`, add with the other element refs (after `const noSkillsToggle = …`):

```js
  const previewEl = panel.querySelector(".final-prompt-preview");
```

After the `driveSkill` function definition add:

```js
  // live pre-send preview (spec 2026-07-08 §3a): server-built, template-expanded
  let previewTimer = null;
  function refreshSkillPreview() {
    if (!previewEl) return;
    fetch("/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "5", user: promptEl.value,
                             mode: noSkillsToggle.checked ? "no_skills" : "proper" }),
    }).then((r) => r.json())
      .then((j) => renderPromptPreview(previewEl, j.prompt || ""))
      .catch((e) => { previewEl.textContent = `[preview error] ${e}`; });
  }
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshSkillPreview, 300);
  }
  promptEl.addEventListener("input", schedulePreview);
  noSkillsToggle.addEventListener("change", refreshSkillPreview);
  refreshSkillPreview();  // initial render
```

(Fetch idiom verified: tab ④ calls plain relative `fetch("/preview", …)` — app.js:669-673 — same-origin single-port server; no helper needed.)

- [ ] **Step 3: Verify.** With server + page up: type in the Tab ⑤ textarea → after ~300 ms the box fills with the template-expanded prompt containing `## Skill index (L1)` and the `<tools>` block (colored). Tick「無 skill 對照」→ the index section and tools disappear from the preview. Stop llama-server (`pkill llama-server`) and toggle → box shows `[preview error] …` (no crash).

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/index.zh-TW.html frontend/app.js
git commit -m "feat(tab5): live pre-send prompt preview wired to /preview tab-5

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: frontend — skill anatomy card + cache bust

**Files:**
- Modify: `frontend/index.html` (left section, after the Skill-index block ending line ~326) + `?v=81`→`?v=82` (line 339)
- Modify: `frontend/index.zh-TW.html` (same two places)
- Modify: `frontend/app.js` — `I18N` table + `setupSkillTab`

**Interfaces:**
- Consumes: `POST /inspect {"tab":"5"}` → `{"files":[{path,layer,content}]}` (Task 3).
- Produces: static anatomy card rendered once at panel init; L1/L2/L3 badges reuse flow colors (`text-inject`/`bg-inject-tint` amber for L2, `text-tool` purple for L3, `text-ink-soft` neutral for L1).

- [ ] **Step 1: Markup.** In `frontend/index.html` after the `skill-index` div's parent `</div>` (line ~326) insert:

```html
        <div>
          <h3 class="text-xs uppercase tracking-wider text-muted font-medium mb-2">Skill anatomy — one folder, three layers</h3>
          <div class="skill-anatomy rounded-lg border border-edge bg-surface p-3 text-xs font-mono space-y-1"></div>
        </div>
```

zh-TW heading:「Skill 解剖 — 一個資料夾、三層」. Bump BOTH files' `<script src="app.js?v=81">` → `?v=82`.

- [ ] **Step 2: I18N keys** (append inside the `I18N` object in app.js):

```js
  anatomy_l1_caption: {
    'en':    'L1 · frontmatter (yaml) — always in context (~{n} tokens)',
    'zh-TW': 'L1 · frontmatter(yaml)— 永遠在 context(~{n} tokens)',
  },
  anatomy_l2_caption: {
    'en':    'L2 · SKILL.md body — injected on load_skill',
    'zh-TW': 'L2 · SKILL.md body — load_skill 時注入',
  },
  anatomy_l3_caption: {
    'en':    'L3 · script — executed only, code never enters context',
    'zh-TW': 'L3 · 腳本 — 只執行,code 不進 context',
  },
```

(`{n}` = `Math.round(content.length / 4)` of the frontmatter entry only — per spec §2 the badge quotes THIS skill's L1 cost, not the whole system prompt.)

- [ ] **Step 3: Render.** In `setupSkillTab` add after the preview wiring:

```js
  // anatomy card (spec 2026-07-08 §2) — static, fetched once at init
  const anatomyEl = panel.querySelector(".skill-anatomy");
  if (anatomyEl) {
    fetch("/inspect", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "5" }),
    }).then((r) => r.json()).then((j) => {
      const CAPTION = { L1: "anatomy_l1_caption", L2: "anatomy_l2_caption", L3: "anatomy_l3_caption" };
      const BADGE = {
        L1: "text-ink-soft border-edge",
        L2: "text-inject border-inject/40 bg-inject-tint",
        L3: "text-tool border-tool/40",
      };
      for (const f of j.files || []) {
        const row = document.createElement("div");
        const label = document.createElement("span");
        label.className = `inline-block rounded border px-1 mr-2 ${BADGE[f.layer]}`;
        label.textContent = f.layer;
        const d = BUBBLE.details(
          f.path + " — " + t(CAPTION[f.layer], { n: Math.round(f.content.length / 4) }),
          BUBBLE.pre(f.content));
        row.append(label, d);
        anatomyEl.appendChild(row);
      }
    }).catch(() => { anatomyEl.textContent = "(anatomy unavailable)"; });
  }
```

(Same caveat as Task 5 on the fetch idiom; `BUBBLE.details(summaryText, node)` and `BUBBLE.pre(text)` are the existing helpers used throughout `setupSkillTab`. The `{n}` token estimate is only meaningful for L1 — for L2/L3 the captions carry no `{n}` placeholder, so the extra var is ignored by `t()`.)

- [ ] **Step 4: Verify.** Hard-reload http://localhost:9000/ (check the network tab loads `app.js?v=82`). Tab ⑤ left column shows the card with 3 rows: `skills/check_weather/SKILL.md#frontmatter [L1]`, `…#body [L2]`, `…scripts/weather.py [L3]`; each expands to the real file content; L1 caption shows a small token figure (~15–25). Repeat on http://localhost:9000/index.html (EN copy check).

- [ ] **Step 5: Full suite + commit**

Run: `pytest agent/tests -q` → green (frontend-only change; guard against accidental server edits).

```bash
git add frontend/index.html frontend/index.zh-TW.html frontend/app.js
git commit -m "feat(tab5): skill anatomy card (L1/L2/L3 file tree) + cache bust v82

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Lesson 5 — four-packagings map + chip narration fix (bilingual)

**Files:**
- Modify: `teaching/lesson-5-skill.md` (Reveal and Wrap-Up section, lines 46-56)
- Modify: `teaching/lesson-5-skill.zh-TW.md` (揭曉與回顧 section, lines 41-48)

**Interfaces:** none (teaching material only).

- [ ] **Step 1: EN.** In `teaching/lesson-5-skill.md`, inside "## Reveal and Wrap-Up": replace the token-chip bullet (lines 51-53, "The token-cost chip … load on demand") with:

```markdown
- The token-cost chip at the top left: read the two numbers as-is — progressive
  loading costs ~M tokens now vs ~N if everything were stuffed into the system
  prompt. (With a single small skill the gap is modest — the POINT is the
  direction: every pack you add widens it, and stuffing scales with ALL packs
  while progressive scales with the ONE you load.)
- One map to close the loop — four packagings of the SAME mechanism (context
  injection changes the distribution, exactly like "1+1=3"):
  - prompt engineering = hand-written injection
  - RAG = retrieved injection
  - a skill = governed, on-demand injection (who wrote it, whether and what
    loads — all visible)
  - context management = deciding what to inject and what to evict
  Expand verbally only if a student asks; a real RAG demo needs
  embeddings/retrieval and is out of scope for this tool (課後延伸).
```

- [ ] **Step 2: zh-TW.** In `teaching/lesson-5-skill.zh-TW.md`, inside「## 揭曉與回顧」replace the corresponding chip bullet(「左上 token 成本 chip:全塞進 system prompt 要 ~N tokens、漸進式只要 ~M — context 影響力大,但 token 也貴,所以按需載入」)with:

```markdown
- 左上 token 成本 chip:照著兩個數字唸 — 漸進式現在 ~M tokens,全塞進 system
  prompt 要 ~N。(單一小 skill 差距不大 — 重點是**方向**:每加一包差距就拉開;
  全塞跟「所有包」一起長,漸進式只跟「你載的那包」長。)
- 收尾地圖 — 同一個機制的四種包裝(context 注入改分佈,跟「1+1=3」一模一樣):
  - prompt engineering = 手寫的注入
  - RAG = 檢索來的注入
  - skill = 受控、按需的注入(誰寫的、載不載、載哪包,全部看得見)
  - context management = 決定注入什麼、丟掉什麼
  學生問到再口頭展開;真的 RAG demo 需要 embedding/檢索,超出本工具範圍(課後延伸)。
```

- [ ] **Step 3: Cross-check both files** — the surrounding bullets (L2-injection-equals-1+1=3, Lesson-6 teaser) stay untouched; the two files must say the same thing.

- [ ] **Step 4: Commit**

```bash
git add teaching/lesson-5-skill.md teaching/lesson-5-skill.zh-TW.md
git commit -m "docs(teaching): lesson 5 — four-packagings map, honest chip narration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `pytest agent/tests -q` — green.
- [ ] Fresh server + hard reload; drive Tab ⑤ proper AND no_skills once each; walk Acceptance 1-6 in the spec one by one.
- [ ] `git log --oneline` shows one commit per task.
