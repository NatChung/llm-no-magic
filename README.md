# LLM 沒有魔法 · 只有 token 跟約定

> English: [README.en.md](./README.en.md)

6-tab 視覺化教學工具,讓 LLM 內部運作看得見:Token / 機率 / chat template / Agent 流程 / Skill 漸進載入 / MCP,逐層可見。

跑在你 Mac 上,完全 local — `llama.cpp` + Qwen3 GGUF 模型。

---

## Quick start(Mac)

不用自己手動裝、不用先開 terminal。打開 **Claude(桌面 app)**,左側選單切到 **Code** 分頁、開一個新 session,貼上:

```
請下載:https://github.com/NatChung/llm-no-magic,並開始這個教學
```

---

## Code tour

- `frontend/index.html` + `index.zh-TW.html` + `app.js` + `styles.css` — Tailwind Play CDN(零 build),6 tab UI(①接龍/②問答/③推理/④代理/⑤Skill/⑥MCP)
- `agent/server.py` — 單 port stdlib http.server(no FastAPI):同時 serve 靜態 frontend + API endpoints(`/drive` `/inspect` `/stop` `/agent` `/skill-agent` `/preview` `/events` `/health`)、swap orchestrator(`handle_swap`,由 `/drive` 呼叫)
- `agent/agent.py` — CLI fallback REPL + 4 tools(`get_time` / `read_file` / `write_file` / `exec_bash`)+ `dispatch_tool_call` + `AgentLoop`
- `agent/skill_agent.py` — Tab ⑤ 三層漸進式揭露 simulator(lazy 載 `SKILL.md` body + bundled scripts/)
- `agent/skills/` — Tab ⑤ demo 用的 2 個 skill(`check_weather`、`organize_files`)
- `agent/tests/` — pytest suite(mocked subprocess + requests + socket;`pytest agent/tests -q`)
- `agent/SETUP.md` — port / Fri AM check / fallback 操作備忘
- `agent/smoke.py` — creator 用的 playwright 迴歸驗證腳本(`--smoke`)
- `prompts.md` — 教學用 prompt 素材(token-level demo 的 input)

---

## About

本 repo 是 LLM 教學內容開源版本。教材設計 [Nat Chung](https://github.com/NatChung)、實作協作 Claude Code(Anthropic),MIT license — 自由 fork / 商業使用 / re-mix / 教學分享。

歡迎 issue / PR / fork,Nat 不積極 maintain 但會收 PR 看。
