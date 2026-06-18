# LLM No Magic · Just Tokens and Conventions

> 繁體中文版: [README.zh-TW.md](./README.zh-TW.md)

A 4-tab visualization tool that makes LLM internals visible: tokens, probabilities, chat templates, and Agent flow — layer by layer.

Runs entirely local on your Mac — `llama.cpp` + Qwen3 GGUF models.

---

## What you'll see

- **① Basics** — Type something → watch the model emit tokens one at a time + the top-10 probability distribution at each step. Three Chinese presets form a complete teaching arc: `床前明月光,疑是地上` (peaked — the model has this Tang poem memorized → completes `霜` at top-1 94%+), `祖樹星上最高的山叫做` (peaked, but **you made up** the star name — the model still confidently invents an answer → **peaked ≠ truth**), `他打開冰箱,拿出` (flat, the model has no idea what to fill in). Together they show "confidence ≠ correctness" + "shape of the distribution reflects model certainty".
- **② Product Layer** — Add a system prompt + Qwen3 chat template, compare the "processed" prompt with raw. Three preset user prompts to try with one click: `一年有幾個月?` (general knowledge, short answer), `寫一個夏季冰飲的促銷文案` (creative), `請寫一首關於月亮的五言絕句` (literary form) — system prompt is yours to write (placeholder hint: "you are a marketing consultant, answer in bullet points, max 3").
- **③ Reasoning** — Thinking on/off. Same question, direct answer vs writing a think block first (effect of reasoning on accuracy).
- **④ Agent** — Multi-turn function calling. The model emits `<tool_call>` tokens → client parses them → **actually executes** (read/write files, run bash) → result goes back into the conversation → the model continues, until final.

Tabs 1-3 let you click any token to see the top-10 distribution at that step (bar chart pops up). Tab ④ tokens aren't clickable — instead, expand the "received / sent next" details to see how the chat template text and conversation accumulate.

Each tab also has small `(?)` explainer drop-downs (System prompt, chat template, thinking mode, Agent, tool_call, turn) — click them to read inline definitions while you experiment.

---

## Quick start (Mac)

```bash
# 1. Install llama.cpp
brew install llama.cpp

# 2. Download Qwen3 models (two sizes: 0.6B for token-level teaching, 4B for Agent function calling)
mkdir -p ~/models
hf download Qwen/Qwen3-0.6B-GGUF Qwen3-0.6B-Q4_K_M.gguf --local-dir ~/models
hf download Qwen/Qwen3-4B-GGUF   Qwen3-4B-Q4_K_M.gguf   --local-dir ~/models

# 3. Clone
git clone https://github.com/NatChung/llm-no-magic.git
cd llm-no-magic

# 4. Start the server (serves HTML + API on :9000, auto-launches llama-server on :8080)
nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &

# 5. Open browser
open http://localhost:9000/
```

When you switch tabs, the server auto-swaps models (Tabs 1-3 → 0.6B, Tabs ④/⑥ → 4B; Tabs ⑤/⑦ are static articles). The first switch shows a "Loading X..." banner for ~3-5 seconds.

**Classroom LAN demo** (students on the same WiFi join your Mac):

```bash
LISTEN_HOST=0.0.0.0 nohup python3 -u -m agent.server > /tmp/agent-server.log 2>&1 &
# Students open http://<your-mac-LAN-ip>:9000/  (e.g. 192.168.x.x:9000/)
# llama-server is auto-launched with --host 0.0.0.0 too
# Note: only one model on the GPU at a time — multiple students switching tabs may compete
```

**Dependencies**: `llama.cpp` (brew), `huggingface_hub` (`pip install -U "huggingface_hub[cli]"`), Python 3.10+, `requests` (`pip install requests`). No npm, no build step.

---

## 🤖 AI-guided mode (Claude Code / Codex)

Don't want to explore alone? Open this repo with an AI coding agent. It reads
[AGENTS.md](./AGENTS.md), asks whether you're the teacher or a student, then:

- runs `python3 init.py` to check your environment (llama.cpp, models, Node/npx + a browser MCP) and guides any installs
- runs the course from [teaching/](./teaching/): the AI **drives one browser itself via a browser MCP**, narrating as it goes, and leaves it open for you to try
- you just watch that screen, listen, and occasionally drive (no opening URLs yourself)

Student usage: clone, open Claude Code in the repo folder, say "hi".

---

## Try it

### Tab ① Basics — 60-second comparison

1. Open Tab ① (default active)
2. Preset 1 `床前明月光,疑是地上` + Send → expect the model to continue with `霜`, top-1 at 94%+ (next-best only 3%, high confidence on familiar text)
3. Preset 2 `祖樹星上最高的山叫做` + Send → expect the model to confidently invent a fake mountain name, top-1 also high — **same peaked shape, but this time it's made up** (peaked ≠ truth / confidence ≠ correctness)
4. Preset 3 `他打開冰箱,拿出` + Send → expect top-10 spread out (water / eggs / leftovers / beer...flat), the model is "unsure what comes next"
5. Click any token to see the top-10 bar chart. The "shape comparison" across the three presets is the entire teaching point of Tab ①.

### Tab ② Product Layer — processed vs raw

1. Switch to Tab ② (0.6B, banner ~3 sec)
2. Preset 1 `一年有幾個月?` + **raw mode** + Send → watch the model ramble (might say "12 months" plus a bunch of filler)
3. Same prompt + add system `你是行銷顧問,用條列式回答,只給 3 點。` + **chat mode** + Send → see the "processed" output become a tidy bullet list
4. Expand "Final prompt sent to model" details → see how `<|im_start|>system\n...<|im_end|>` wraps everything
5. Try preset 2 "summer drink marketing copy" the same way for contrast

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
    ↓ GET / (HTML)    ↓ POST /agent /skill-agent /swap /preview (SSE/JSON)
Server :9000 (agent/server.py — static + API in one process)
    ↓ POST /v1/chat/completions  (non-stream + logprobs + tools)
llama-server :8080 (Qwen3 model — auto-swap by /swap)
```

**Core points**:
- Tabs 1-3: frontend talks directly to llama `/completion` (stream + n_probs). Tabs 2-3 assemble chat template tags themselves.
- Tab ④ Agent: frontend → `/agent` (SSE) → server runs multi-turn agent loop, OpenAI chat completions API + tools schema, real-executes tools, results back into messages, until model stops emitting tool_call.
- Tab ⑥ Skill: frontend → `/skill-agent` (SSE) → server runs 3-layer progressive disclosure simulator (lazy-loads SKILL.md body + bundled scripts/).
- Tabs ⑤/⑦: static article only, no model interaction.
- Tab switch: `ensureModel(wanted)` POSTs `/swap?model=X` → server's `SWAP_LOCK` serializes calls → `pkill llama-server` + wait for port to free + `subprocess.Popen` to start the new model + poll `/v1/models` until ready (~3-5s).

---

## Code tour

- `frontend/index.html` + `app.js` + `styles.css` — Tailwind Play CDN (zero build), 7-tab UI
- `agent/server.py` — single-port stdlib http.server (no FastAPI): static frontend files + API endpoints (agent loop, skill simulator, `/swap` orchestrator, `/preview` apply-template proxy). `LISTEN_HOST=0.0.0.0` opt-in for LAN demo.
- `agent/agent.py` — CLI fallback REPL + 4 tools (`get_time` / `read_file` / `write_file` / `exec_bash`) + `dispatch_tool_call` + `AgentLoop`
- `agent/tests/` — 43 tests (mocked subprocess + requests + socket; run with `pytest agent/tests -q`)
- `agent/SETUP.md` — port layout / Fri morning check / fallback ops notes
- `prompts.md` — teaching prompt material (token-level demo inputs)

---

## About

This repo is the open-source version of LLM teaching material. Curriculum designed by [Nat Chung](https://github.com/NatChung); implementation done together with Claude Code (Anthropic). MIT licensed — free to fork, use commercially, remix, share for teaching.

Issues / PRs / forks welcome. Nat doesn't actively maintain but will read PRs.
