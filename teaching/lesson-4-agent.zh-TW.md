# Lesson 4 — Tab ④ Agent:tool_call 約定與真執行(+ 整課收尾)

> English: [lesson-4-agent.md](./lesson-4-agent.md)

## 學習目標
1. 知道 Agent = model 吐 `<tool_call>` 約定標籤 → client parse → **真的執行** → 結果塞回對話
2. 看懂 multi-turn loop:每個 turn 的輸出累積進 messages、直到不再 tool_call
3. 收尾:說話工具 vs 動手工具的選擇判斷 + 60→90 分框架

## 開場(不問答,直接帶入 demo)

一句話帶過:上一課(Lesson 3)同一句「現在幾點?」,thinking 只能憑空編一個時間;這課用同一句
話,但這次 model 會**真的**呼叫工具拿到正確時間 — 這是①→②→③→④整條接龍要收的線。

## Demo 段落(第一次 drive Tab ④ 會載 4B model,banner 等 3-5 秒 — 先跟學員預告)

### 段落 1 — 現在幾點?(get_time)
- **接上一課(整條接龍的收線)**:輸入框裡的「現在幾點?」就是 Lesson 3 收尾那句 — 切過來時
  自動帶進來了。上一課連 thinking 都只能憑空編一個時間;這一課同一句、同一個 model,它會**真的
  去呼叫 get_time 拿到真實時間** — 這就是①→②→③→④整條接龍要收的線
- 預告:「model 沒有時鐘。猜它怎麼知道現在幾點?看紫色『↑ 工具呼叫』和綠色『↓ 工具結果』。」
- 驅動:`POST /drive {"tab":"4","user":"現在幾點?"}` → 頁面自動切到 Tab ④ 並渲染;**第一次會 0.6B→4B swap,banner 等 3-5s**(swap 在 `/drive` 內、頁面收 `swap_start` 顯示 banner)
- 讀回應:turn 軌跡 — Turn 1 紫「↑ 工具呼叫 get_time」→ 綠「↓ 工具結果」→ Turn 2 final answer(現在是 HH:MM:SS)→
  旁白:Turn 1 model 吐 `<tool_call>{"name":"get_time"…}` → client 真的跑 Python 拿時間 →
  塞回對話 → Turn 2 才答得出來。**XML 標籤只是約定,執行的是 client**;跟上一課對照:同一句
  「現在幾點?」,thinking 只能編,這裡真的拿到了 — 差別就是有沒有工具

## 學員動手
學員在輸入框自己打一句**不需要工具的問題**(例:`1+1 等於幾?`),送出,
看 turn 軌跡:這次**沒有**紫色「↑ 工具呼叫」,Turn 1 直接就是 final answer。
對照「現在幾點?」— 同一個 model、同一份 prompt,**要不要用工具是它在
Turn 1 自己決定的**;這也是為什麼看「↑ 工具呼叫」就能知道它這一輪在幹嘛。

## 揭曉與回顧(整課收尾)

1. **50 份逐字稿那題**:如果你電腦裡有 50 份客戶會議逐字稿,想讓 AI 讀過全部、摘出客戶最
   常抱怨什麼 — 它「真的」怎麼讀到你的檔?跟剛剛 get_time 一樣,是 client 定義的真
   Python function 讀檔,`<tool_call>` 只是約定標籤,沒有魔法。問學員:「現在換你來做
   這個任務,你會怎麼做?」記下回答就好,不用對照什麼「之前」
2. **那題的正解骨架**:Agent(用讀檔工具真讀檔 — 跟今天的 get_time 一樣,是 client 定義的真 function)→ 套摘要範本 → 挑樣本 spot-check →
   要重複用就包成工具
3. **說話 vs 動手(帶學員把這張表講一遍)**:
   - 說話工具(ChatGPT / Gemini):聊天框餵對 context(SOP/規則)+ 交代紅線 + 核重點。
     分界:context 你貼得完
   - 動手工具(Claude Code / Codex):讀你的檔、跑指令、多步。分界:context 太大 / 要自動讀檔
4. **60→90 分框架**:問學員一次:「學完這一整條(tokens → chat template → reasoning →
   agent),現在要用『同一個 GPT』處理 Lesson 1 那封客訴回信,你會怎麼做?」(常見兩極:
   還是直接貼客訴信叫它回 / 會連退款 SOP + 紅線一起打進聊天框,再核對承諾句)。點出差別:
   把 GPT 當許願池、賭它對,是 60 分用法;餵料、設規則、知道核哪句,才是 90 分用法 —
   同一個工具,差別不是學了多少術語,是知道任務該交給哪類工具、怎麼用到位、背後在做什麼
5. **課後導讀**(自學,不帶課):Tab ⑤ Skill、Tab ⑥ MCP 文章 — 講「怎麼把今天的東西包成
   可重複使用的工具」

## 常見學員問題
- 「它會不會亂跑指令?」— 工具是 client 白名單定義的;這也是為什麼要看「↑ 工具呼叫」確認
- 「ChatGPT 為什麼不能這樣?」— 網頁版沒給它你電腦的工具;不是 model 不同,是 client 不同
- 「4B 跟 0.6B 差在哪?」— function calling 要跟對格式約定,小 model 常跟丟;4B 才穩
