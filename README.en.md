# LLM No Magic · Just Tokens and Conventions

> 繁體中文版: [README.md](./README.md)

A 4-tab visualization tool that makes LLM internals visible: tokens, probabilities, chat templates, and Agent flow — layer by layer.

Runs entirely local on your Mac — `llama.cpp` + Qwen3 GGUF models.

---

## What you'll see

- **① Basics** — Type something → watch the model emit tokens one at a time + the top-10 probability distribution at each step. Three Chinese presets form a complete teaching arc: `床前明月光,疑是地上` (peaked — the model has this Tang poem memorized → completes `霜` at top-1 94%+), `祖樹星上最高的山叫做` (peaked, but **you made up** the star name — the model still confidently invents an answer → **peaked ≠ truth**), `他打開冰箱,拿出一包` (flat — top-1 barely above 10%, the model has no idea what to fill in). Together they show "confidence ≠ correctness" + "shape of the distribution reflects model certainty".
- **② Product Layer** — Watch "how chaining becomes Q&A": send the same `一年有幾個月?` ("How many months in a year?") three ways — raw prompt (pure chaining, loops without answering), hand-typed "Q:/A:" (a plain text pattern alone flips it into answer mode, but it spirals into more questions), and the real Qwen3 chat template (swaps in reserved tokens like `<|im_start|>` whose boundary meaning was assigned during training, which is what gives a clean stop signal). Expand the raw-vs-chat-template final prompt to see exactly what the product layer adds.
- **③ Reasoning** — Thinking on/off. Same question, direct answer vs writing a think block first (effect of reasoning on accuracy).
- **④ Agent** — Multi-turn function calling. The model emits `<tool_call>` tokens → client parses them → **actually executes** (read/write files, run bash) → result goes back into the conversation → the model continues, until final.

Tabs 1-3 let you click any token to see the top-10 distribution at that step (bar chart pops up). Tab ④ tokens aren't clickable — instead, expand the "received / sent next" details to see how the chat template text and conversation accumulate.

Each tab also has small `(?)` explainer drop-downs (System prompt, chat template, thinking mode, Agent, tool_call, turn) — click them to read inline definitions while you experiment.

---

## Quick start (Mac)

No manual install needed. Open this repo with an AI coding agent (Claude Code / Codex).
It reads [AGENTS.md](./AGENTS.md), asks whether you're the teacher or a student, then:

- runs `python3 init.py` to check your environment (llama.cpp, models) and guides any
  installs — teaching only needs an HTTP-capable AI plus a browser you open once, no Node
  and no MCP required
- runs the course from [teaching/](./teaching/): the AI **drives the page over HTTP**
  (`POST /drive`) while the page reflects every action live via SSE (`/events`), narrating
  as it goes, and leaves it open for you to try
- you open the page once (http://localhost:9000/) and leave it up; from there you just watch, listen, and occasionally drive it yourself — the AI does the rest over HTTP

```bash
git clone https://github.com/NatChung/llm-no-magic.git
cd llm-no-magic
```

Open Claude Code / Codex and say "hi".

**Dependencies** (the AI checks/installs these for you — listed here for reference):
`llama.cpp` (brew), `huggingface_hub` (`pip install -U "huggingface_hub[cli]"`),
Python 3.10+, `requests`. No npm, no build step.

---

## Advanced: classroom LAN demo (creator runs manually)

Students on the same WiFi join your Mac, without going through the AI — you start the
server yourself for multiple people to connect at once:

```bash
LISTEN_HOST=0.0.0.0 nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
# Students open http://<your-mac-LAN-ip>:9000/  (e.g. 192.168.x.x:9000/)
# llama-server is auto-launched with --host 0.0.0.0 too
# Note: only one model on the GPU at a time — multiple students switching tabs may compete
```

When you drive a tab, the server auto-swaps models (tab-switching itself is UI-only) (Tabs 1-3 → 0.6B, Tabs ④/⑤ → 4B; Tab ⑥ is a static article). The first swap shows a "Loading X..." banner for ~3-5 seconds.

---

## Try it

### Tab ① Basics — 60-second comparison

1. Open Tab ① (default active)
2. Preset 1 `床前明月光,疑是地上` + Send → expect the model to continue with `霜`, top-1 at 94%+ (next-best only 3%, high confidence on familiar text)
3. Preset 2 `祖樹星上最高的山叫做` + Send → expect the model to confidently invent a fake mountain name, top-1 also high — **same peaked shape, but this time it's made up** (peaked ≠ truth / confidence ≠ correctness)
4. Preset 3 `他打開冰箱,拿出一包` + Send → expect top-10 spread out (candy / chips / chocolate / milk...flat, top-1 barely above 10%), the model is "unsure what comes next"
5. **Every token the model produces is clickable, not just the first one** — click any of them to see the top-10 bar chart. The "shape comparison" across the three presets is the entire teaching point of Tab ①.

### Tab ② Product Layer — how chaining becomes Q&A

1. Switch to Tab ② (0.6B, banner ~3 sec)
2. `一年有幾個月?` ("How many months in a year?") + **raw mode** + Send → the model loops on "有沒有其他月份的特殊性?" ("anything else special about the other months?"), the same pure chaining as Lesson 1 — not an answer
3. Change it to `問:一年有幾個月?\n答:` ("Q: ... A:"), still **raw mode** + Send → it opens with the correct "一年有12个月" but then keeps generating another Q/A round on its own — **just typing two extra characters, "Q:" and "A:", flips it from chaining into answering, but plain text has no stop boundary**
4. Same `一年有幾個月?`, switch to **chat mode** + Send → a clean answer, no looping; expand "Final prompt sent to model" and see `<|im_start|>user\n...<|im_end|>\n<|im_start|>assistant\n` — the same move as step 3's "Q:"/"A:", just swapped for reserved tokens whose boundary meaning was assigned by training, which is what gives it a clean stop signal

### Tab ④ Agent — real execution demo

1. Switch to Tab ④ (you'll see a "Loading 4B..." banner for ~5 sec)
2. Preset 1 "What time is it?" + Send
3. Expected:
   - Turn 1: model emits token stream (starts with `<tool_call>`) + purple "↑ tool call" block showing `get_time({})` + green "↓ tool result" showing `HH:MM:SS`
   - Turn 2: final "現在是 HH:MM:SS"
4. Expand the per-turn "sent next — prompt accumulated across N turns sent into next model call" details → see how the chat template text and conversation accumulate as next input

Three Tab ④ presets:
- 1. **What time is it?** — `get_time` demo (fastest, 1-2 turns)
- 2. **Read + write summary** — `read_file` → `write_file` actually writes a file to `~/Desktop/llm-summary.md`
- 3. **Count .md files** — `exec_bash` runs `find` to actually count files in the repo

---

## How it works

```
Browser
    ↓ GET / (HTML)    ↓ POST /drive /inspect /stop /agent /skill-agent /preview
    ↓ GET /events (SSE)
Server :9000 (agent/server.py — static + API in one process)
    ↓ POST /v1/chat/completions  (non-stream + logprobs + tools)
llama-server :8080 (Qwen3 model — auto-swap inside /drive)
```

**Core points**:
- Tabs 1-3: Send → `POST /drive` → server calls llama `/completion` (stream + n_probs) → publishes each token to `/events`, page renders live.
- Tab ④ Agent: `POST /drive {tab:4}` → server runs a multi-turn agent loop (OpenAI chat completions + tools, real-executes tools, results back into messages) → publishes each turn/final to `/events`.
- Tab ⑤ Skill: frontend → `/skill-agent` (SSE) → server runs 3-layer progressive disclosure simulator (lazy-loads SKILL.md body + bundled scripts/).
- Tab ⑥: static article only, no model interaction.
- On send, the server compares `GLOBAL_STATE['model']` inside `/drive` and calls `handle_swap` only if needed (`SWAP_LOCK` serializes calls → `pkill` + wait for port to free + `Popen` + poll `/v1/models` until ready ~3-5s); tab-switching itself is UI-only and does not trigger a swap.

---

## Code tour

- `frontend/index.html` + `app.js` + `styles.css` — Tailwind Play CDN (zero build), 7-tab UI
- `agent/server.py` — single-port stdlib http.server (no FastAPI): static frontend files + API endpoints (agent loop, skill simulator, swap orchestrator (`handle_swap`, called by `/drive`), `/preview` apply-template proxy). `LISTEN_HOST=0.0.0.0` opt-in for LAN demo.
- `agent/agent.py` — CLI fallback REPL + 4 tools (`get_time` / `read_file` / `write_file` / `exec_bash`) + `dispatch_tool_call` + `AgentLoop`
- `agent/tests/` — pytest suite (mocked subprocess + requests + socket; run with `pytest agent/tests -q`)
- `agent/SETUP.md` — port layout / Fri morning check / fallback ops notes
- `prompts.md` — teaching prompt material (token-level demo inputs)

---

## About

This repo is the open-source version of LLM teaching material. Curriculum designed by [Nat Chung](https://github.com/NatChung); implementation done together with Claude Code (Anthropic). MIT licensed — free to fork, use commercially, remix, share for teaching.

Issues / PRs / forks welcome. Nat doesn't actively maintain but will read PRs.
