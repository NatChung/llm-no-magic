# Lesson 4 — Tab ④ Agent:tool_call 約定與真執行(+ 整課收尾)

> English: [lesson-4-agent.md](./lesson-4-agent.md)

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
- 用 MCP:開 http://localhost:9000/index.zh-TW.html → 點 Tab ④(Agent)→ 重複 snapshot 到「載入…中」消失(4B 換模載入較久,耐心等)
- 選 preset「現在幾點?」→ 點「送出」→ 等「送出」鈕回 enabled
- 看 turn 軌跡(紫色工具呼叫 / 綠色工具結果)→ 讀 final answer
- debrief:Turn 1 model 吐 `<tool_call>{"name":"get_time"…}` → client 真的跑 Python 拿時間 →
  塞回對話 → Turn 2 才答得出來。**XML 標籤只是約定,執行的是 client**

### 段落 2 — 數 .md 檔(exec_bash)
- 預告:「這次它要跑 shell 指令、真的數這個 repo 的檔案。」
- 用 MCP:選 preset「數一下這個 repo 底下有幾個 .md 檔」→ 點「送出」→ 等「送出」鈕回 enabled
- 看 turn 累積 → 讀 final answer
- debrief:展開 turn block 的「再送出」details:看 conversation 怎麼一輪輪累積成下次 input

## 學員動手
preset 2「讀+寫 摘要」:學員自己送出,跑完去開 `~/Desktop/llm-summary.md` — **檔案真的在**,
這就是「動手工具」跟「說話工具」的差別。

## 揭曉與回顧(整課收尾 — 對照 Lesson 1 與本課 Hook 答案)

1. **回放 Hook B + 再問一次(after 題)**:Q2 你選「覺得像魔法」的話 — 現在你看過了:
   read_file 是真的 Python function,`<tool_call>` 是約定標籤,沒有魔法。然後問:
   「**現在再讓你做這個任務(50 份逐字稿),你會怎麼做?**」記下回答,跟他課前 Q3 的回答對照
2. **50 份逐字稿那題的正解骨架**:Agent(read_file 真讀檔)→ 套摘要範本 → 挑樣本 spot-check →
   要重複用就包成工具
3. **說話 vs 動手(帶學員把這張表講一遍)**:
   - 說話工具(ChatGPT / Gemini):聊天框餵對 context(SOP/規則)+ 交代紅線 + 核重點。
     分界:context 你貼得完
   - 動手工具(Claude Code / Codex):讀你的檔、跑指令、多步。分界:context 太大 / 要自動讀檔
4. **60→90 分框架(回放學員 Lesson 1 的 Hook 答案,讓他自己看判斷怎麼變)**:
   先**再問一次 Hook A 的 after 選擇題**:「現在『同一個 GPT』,你會怎麼用那封客訴回信?」
   (還是直接貼客訴信叫它回 / 會連退款 SOP + 紅線一起打進聊天框,再核承諾句 /
   會了,但這題我寧可自己寫)。對照他 Lesson 1 的 Q1-Q3:before 是把 GPT 當許願池、賭它對;
   after 是你餵料、設規則、知道核哪句 — 同一個工具,60 分用到 90 分。不是學了一堆術語,
   是知道任務該交給哪類工具、怎麼用到位、背後在做什麼
5. **課後導讀**(自學,不帶課):Tab ⑤ 指令/Script/API、Tab ⑥ Skill、Tab ⑦ MCP 三篇文章 +
   Tab ⑧ 總結 — 講「怎麼把今天的東西包成可重複使用的工具」

## 常見學員問題
- 「它會不會亂跑指令?」— 工具是 client 白名單定義的;這也是為什麼要看「↑ 工具呼叫」確認
- 「ChatGPT 為什麼不能這樣?」— 網頁版沒給它你電腦的工具;不是 model 不同,是 client 不同
- 「4B 跟 0.6B 差在哪?」— function calling 要跟對格式約定,小 model 常跟丟;4B 才穩
