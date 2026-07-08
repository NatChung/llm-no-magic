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

### 段落 2 — 泡泡 + 協定卡交錯讀
- 讀回應:藍色泡泡(model 吐 tool_call)→ 協定卡(tools/call 請求/回應,
  跨 process 的那條線)→ 紫色泡泡(結果餵回模型)→ 重複 → 綠色 final
  融合兩個結果
- 對照 Tab ④:model 端**一模一樣**(吐 tool_call 約定標籤);變的是 client
  拿到 tool_call 之後去哪執行 — 內建 function vs 問外部 process

## 學員動手
自己打一句只需要其中一個工具的問題(例:`現在幾點?`),看 model 只挑
get_time、只有一張 tools/call 卡。工具用不用、用哪個,還是 model 在決定。

## 揭曉與回顧
- 有學員會發現:這裡的台北天氣是 16°C 有雨,上一課的 skill 說 28°C 晴!
  故意的 — 兩個「工具」實作不同、來源不同,答案就不同。**工具從哪來,
  答案就從哪來** — 這也是為什麼接第三方工具要知道它背後是誰
- 三課收線:Tab ④ 工具住在 client(寫死)→ Tab ⑤ skill(本機能力包,按需
  載入說明書+腳本)→ Tab ⑥ MCP(外部 process,協定發現)。全部都是同一招:
  把 context 和工具送到 model 面前;來源不同、信任邊界不同
- 想深入:展開頁尾「完整文章」

## 常見學員問題
- 「MCP server 可以是別人寫的嗎?」— 對,這正是重點;今天的迷你 server 是
  本課自帶的,但換成任何人的 server,握手流程一模一樣
- 「跟 API 有什麼不同?」— API 各家格式各異;MCP 是統一的「工具描述+呼叫」
  協定,client 接一次就能用所有支援的 server
- 「安全嗎?」— 你在協定卡看到了 client 送出去/收回來的一切;信任邊界在
  server 是誰寫的 — 跟裝瀏覽器外掛同一種判斷
