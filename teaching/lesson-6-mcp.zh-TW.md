# Lesson 6 — Tab ⑥ MCP:工具不必寫死在 client 裡

> English: [lesson-6-mcp.md](./lesson-6-mcp.md)

## 學習目標
1. 知道 MCP = client 跟外部 process 之間的工具協定(JSON-RPC)
2. 看懂握手:initialize → initialized → tools/list — 工具是「問」出來的
3. 分清三個來源:Tab ④ client 內建 / Tab ⑤ skill 腳本 / Tab ⑥ 外部 process

## 開場(不問答,直接帶入 demo)

一句話帶過:到目前為止,所有工具都住在你電腦、由這個 client 定義。
問題:別人寫好的工具,怎麼接進來?這就是 MCP 要解的。

## Demo 段落

### 段落 1 — 握手:client 事先不知道有什麼工具
- 驅動:`POST /drive {"tab":"6","user":"現在幾點?台北天氣如何?"}`
- 先指「握手」區的三張協定卡:`initialize`(你好,我是 client)→
  `notifications/initialized`(準備好了)→ `tools/list`(你有什麼工具?)
  → 回應列出 get_time、get_weather — **client 是問出來的,不是寫死的**
- 旁白:這三張卡就是 MCP 的核心;下面的每張 `tools/call` 卡,是 model 決定
  用工具時,client 幫它跨 process 打電話
- **AI 秀 prompt**(頁面沒有 preview 框 — 由 AI 演):`POST /preview
  {"tab":"6","user":"現在幾點?台北天氣如何?"}` — server 會真的起一個 mini MCP
  server、握手拿工具清單、再展開 prompt。對照前兩課:`<tools>` 裡的 get_time +
  get_weather 是**問來的** — 不是寫死(④)、也不是磁碟上的檔案(⑤);等一下展開泡泡時,
  訊息是一排收合的清單 — 先點開 `<|im_start|> system` 那則,裡面的 `<tools>` 區塊就在那(也
  是收合的)— 再點開它才看到工具清單,是劇情的一部分,不是卡住。
  (上色:用 ```diff code block — `+` 綠=我們寫的、`-` 紅=訓練約定改不掉、無前綴灰=template 標記。一律直接貼在對話裡,不要另出 HTML/artifact)

### 段落 2 — 泡泡 + 協定卡交錯讀
- 對話流從你的問題開頭(靠右灰泡)—— 而且藏著關鍵的是這顆泡泡,不是模型那顆:展開它的
  「送給 AI 的 prompt(turn 1)」,會看到一個折疊起來的 `▸ <tools> 2 個工具,423 字元` —
  因為太長預設收合,點開它,get_time + get_weather 就躺在裡面 —— 那是剛剛跟 mini MCP
  server 握手問來的,不是寫死的。(藍泡自己的展開器秀的是另一件事:模型吐的原始
  `<tool_call>`。)
- 讀回應:藍色泡泡(model 吐 tool_call)→ 協定卡(tools/call 請求/回應,
  跨 process 的那條線)→ 紫色泡泡(結果餵回模型,它自己的展開器帶著下一輪的 prompt)
  → 重複 → 綠色 final 融合兩個結果。每一份送出的 prompt 裡,最後一則(琥珀底、標
  「← 這次新增、要送出的」)都是這一發剛加進來、要送給 model 的新輸入 —— turn 1
  是你的問題,之後是餵回的工具結果。
- 對照 Tab ④:model 端**一模一樣**(吐 tool_call 約定標籤);變的是 client
  拿到 tool_call 之後去哪執行 — 內建 function vs 問外部 process

## 學員動手
自己打一句只需要其中一個工具的問題(例:`現在幾點?`),看 model 只挑
get_time、只有一張 tools/call 卡。工具用不用、用哪個,還是 model 在決定。

## 揭曉與回顧

### 1. 來源不同,答案就不同
有學員會發現:這裡的台北天氣是 16°C 有雨,上一課的 skill 說 28°C 晴!
故意的 — 兩個「工具」實作不同、來源不同,答案就不同。**工具從哪來,答案就
從哪來** — 這也是為什麼接第三方工具要知道它背後是誰。

### 2. 不只答案不同,連「講法」都不同 ← 本課重點
現場帶學員在 ⑤ 和 ⑥ 各打同一句 `台北天氣如何?`(2026-07-29 實測):

| | Tab ⑤ Skill | Tab ⑥ MCP |
|---|---|---|
| 模型回答 | `台北:28°C, 晴` | `台北的天氣是16度,有雨。` |
| turn 數 | 3 | 2 |
| turn 1 prompt_tokens | 506 | 218 |
| 最後一輪 prompt_tokens | 912 | 270 |

同一個模型、同一個問題。⑤ 守著 `°C`、冒號、不加句號 —— 因為 SKILL.md 裡有
「回覆格式 + 注意事項」。⑥ 自己發揮成一句中文 —— 因為它只拿到 JSON schema。

**`tools/list` 只給 name + description + inputSchema,放不下「一律 °C、不要
emoji、一次一個城市」。** 這就是**「做得到」和「做得對」**的差別。

**誠實的反例(照講,不要跳過)**:照口號說,MCP 每輪都帶著工具定義應該比較貴。
但螢幕上 ⑥ 是 270、⑤ 是 912 —— 反過來。因為 ⑤ 為了「用到才載」,得先花一整輪
把 SKILL.md 讀進 context。這個玩具規模太小,反轉要到工具七八個才會發生
(codegraph 做了 8 個工具卻預設只曝 1 個,原始碼註解寫著
`long instructions burn tokens`)。**這個 repo 的立場是螢幕上的數字說了算 ——
連口號一起拆。**

### 3. 三課收線 — 能力清單從哪來(給客戶講就用這張表)

| | Tab ④ 寫死 | Tab ⑤ Skill | Tab ⑥ MCP |
|---|---|---|---|
| 能力清單在哪 | 寫死在 client code | 磁碟上的資料夾(code 只有 2 支通用工具) | 外部 process,握手問出來 |
| 加一個能力 | 改 code、重新部署 | 丟一個資料夾 | 別人更新他的 server |
| 誰維護 | 你 | 你(寫文件+腳本) | 別人 |
| **規矩(格式/順序/邊界)放哪** | code 裡 | **SKILL.md** | **放不下** |

比喻:④ 菜單印死在店裡(加菜要重印)、⑤ 廚房自己看食譜櫃(放一本新食譜就會
了)、⑥ 叫外送(菜單是別家的,他們更新你自動有)。**但叫外送不代表不用擺盤** ——
外送把菜送到(MCP 給能力),要不要換盤子、客人不吃辣怎麼辦,是你廚房的事
(Skill 給規矩)。真實情況多半是:**外送叫來,自己重新擺盤。**

### 4. 「那我自己要打包一個服務,要做成 Skill 還是 MCP?」

學員一定會問。**答案是切兩刀,不是一刀。**

**第一刀 — shipped 還是 hosted?**
> 東西要**送一份到對方機器上**,還是**跑在你機器上讓對方連過來**?

- **shipped → Skill / Plugin**。對方拿到一份拷貝;你的邏輯和資料在他手上
- **hosted → MCP 或你自己的 API**。要養機器,但撤得回、看得到用量

**第二刀 — hosted 的話,對方怎麼接上來?這一刀由「對方的 client」決定,不是你決定。**

Skill 裡的腳本能不能對外打 HTTP(2026-07 查證,會變,講之前先確認):

| 環境 | 能不能 |
|---|---|
| Claude Code | ✅ 不限制 |
| claude.ai / Cowork | ⚠️ **預設只放行 16 個網域**(套件管理器 + github.com);管理員可改成全開 |
| Claude API | ❌ 明文「no network access」 |

所以:
- 對方用 **Claude Code** → **Skill + 你的 API 就夠**,MCP 非必要
- 對方用 **Cowork / claude.ai(預設)** → 腳本打不到你的 API → **只能 MCP connector**
- 對方用 **別家 client** → **MCP**

> **「要不要 MCP」有一半不是你的選擇,是你使用者的環境替你決定的。**

這也解釋了為什麼社群吵不出結論:主張「本地寫 skill + CLI 就夠」的那派跟主張
「ChatGPT 跑不了 CLI,靠 CLI 的 skill 一出生就死了」的那派,**使用者環境不一樣,
兩邊都對**。

### 5. 這些都不是判準(每一條都有反例,學員最容易誤判)

| ❌ 不是判準 | 反例 |
|---|---|
| 任務明不明確 | codegraph 的 `add-lang` 是 Step 1→10 死流程卻是 Skill;`codegraph_explore` 吃自然語言卻是 MCP |
| 連不連外部 | Skill 的腳本一樣 curl 得出去 |
| 有沒有 auth | 腳本可以檢查 token、沒有就開 browser 登入(`gh auth login` 那個形狀) |
| 要不要記狀態 | 腳本可以寫本地 jsonl / SQLite |
| 能不能撤銷 | **hosted skill 可以用 API 刪掉** —— 真正的軸是 hosted vs shipped |
| 計費 / 限流 | 有廠商就是用 skill 賣 API gateway,附分級限流 |
| context 成本 | 見上面實測,方向常常相反 |

### 6. 另一半永遠別忘
**「怎麼用得對」只能是 Skill** —— 順序、格式、邊界、什麼時候別用。MCP 協定裡
沒有欄位放它(server `instructions` 是整台一份、每個 session 都在,不能分層、
不能按任務切換)。所以真實世界最常見的答案是**兩個都出**:**MCP 給能力,
Skill 給規矩。**

## 常見學員問題
- 「MCP server 可以是別人寫的嗎?」— 對,這正是重點;今天的迷你 server 是
  本課自帶的,但換成任何人的 server,握手流程一模一樣
- 「跟 API 有什麼不同?」— API 各家格式各異;MCP 是統一的「工具描述+呼叫」
  協定,client 接一次就能用所有支援的 server
- 「安全嗎?」— 你在協定卡看到了 client 送出去/收回來的一切;信任邊界在
  server 是誰寫的 — 跟裝瀏覽器外掛同一種判斷
