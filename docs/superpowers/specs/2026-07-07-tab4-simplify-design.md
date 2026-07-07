# Tab ④ Agent 簡化 — system UI 移除 + preview 常駐 + prompt 瘦身

日期:2026-07-07
狀態:設計已由 Nat 口頭核准(本文件為書面化)

## 目標

Tab ④(Agent 分頁)第一眼資訊量過大。三項簡化:

1. 移除 System Prompt UI(label + textarea)
2. 「實際送到 model 的 prompt」從收合 `<details>` 改成 Tab ②/③ 同款**常駐區塊**
3. 實際送進 model 的 prompt 瘦身:刪掉 system 指令句(「You are a helpful
   assistant…」),`<tools>` 只留 `get_time`(移除 read_file / write_file /
   exec_bash)——**是真的改送進 model 的內容**,不是只改顯示

## 已拍板的取捨(Nat 決定)

- **工具真的只留 get_time**:第 4 課「學員動手」(讀 prompts.md → 寫
  ~/Desktop/llm-summary.md)與選配 exec_bash 段落因此跑不動,教材一併改
- **system 只留 `/no_think`**:指令句全刪。`/no_think` 必須保留(壓住 Qwen3-4B
  吐 `<think>` 的機制開關)
- 使用者訊息的「第 4 點」是手滑,共三點需求

## 範圍圈定

改動**只圈在 Tab ④ 路徑**(`agent_loop` + `/preview`):

- `agent.py` 的 `SYSTEM_PROMPT` / `TOOL_SCHEMAS` **不動**(CLI 是 creator 回歸
  測試工具,保留 4 工具)
- Tab ⑤ `/skill-agent` 路徑不動

## 改動清單

### 1. 後端 `agent/server.py`

- 新增 `TAB4_TOOL_SCHEMAS = [s for s in TOOL_SCHEMAS if s["function"]["name"] == "get_time"]`
- `agent_loop`:
  - system 訊息內容:`(system + "\n\n" if system else "") + "/no_think"`
    (`system` 參數保留 API 相容;UI 不再傳,預設為純 `/no_think`)
  - 送 llama 的 `tools`(含 next_prompt 的 `/apply-template` 呼叫)改用
    `TAB4_TOOL_SCHEMAS`
- `_handle_preview`:同步改用同一組 system + tools(preview 顯示的仍是事實)

### 2. 前端 `frontend/index.html` + `index.zh-TW.html`(雙語同步)

- 刪 System Prompt label + `#system-prompt-agent` textarea
- `<details class="preview-details">` 換成 Tab ②/③ 同款常駐區塊:
  `<h3>`(EN: "Prompt actually sent to the model" / zh: "實際送進 model 的
  prompt")+ `<pre class="final-prompt-preview">`(同 Tab ③ 樣式 class)
- 兩檔 `?v=NN` cache-bust +1

### 3. 前端 `frontend/app.js`

- 刪 `AGENT_DEFAULT_SYSTEM` 常數與 `setupAgent` 內 `systemEl` 相關邏輯
- `/preview` 請求 body 只送 `{user}`

### 4. 教材 `teaching/lesson-4-agent.md` + `.zh-TW.md`(雙語同步)

- 刪「段落 2(選配)exec_bash 數 .md 檔」
- 「學員動手」改版:學員自己打一句**不需要時間的問題**(例:「1+1 等於幾?」),
  看 model 不呼叫工具直接答——教學點:「要不要用工具是 model 在 Turn 1 自己
  決定的」
- 刪「system prompt 只點名 get_time 但 registry 藏著其他工具」註記
- 揭曉段落以 read_file 舉例處改為 get_time

### 5. 驗證

- `pytest agent/tests -q`
- 重啟 server 後 `/drive {"tab":"4","user":"現在幾點?"}` 實測:確認 system 只剩
  `/no_think` 時 4B 仍穩定呼叫 get_time
- `/preview` 回傳目視確認:無指令句、`<tools>` 只有 get_time
- 頁面目視/截圖:system UI 已消失、preview 常駐且與 Tab ③ 同款

## 風險

拿掉「Always call tools first, don't guess」後,get_time 呼叫穩定性未知。實測
若翻車(model 直接猜時間),回報 Nat 決定是否加回一句極短指令(例:"Use tools
when relevant. Don't guess.")。
