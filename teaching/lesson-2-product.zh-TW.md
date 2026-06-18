# Lesson 2 — Tab ② 產品層加工:system prompt 與 chat template

> English: [lesson-2-product.md](./lesson-2-product.md)

## 學習目標
1. 看懂 chat template 的核心是「**問:答:**」結構 — marker 標好「這段是 user **問**的、接下來換 assistant **答**」,model 才會「答」而不是把你的字當題目「接龍」
2. 知道 system prompt 是疊在上面的**第二個旋鈕** — 交代「**怎麼**答」(風格/規則),不是「答不答」
3. 連回 Hook A:「問:答:」結構跟 system 那句,在 model 眼裡都只是 `<|im_start|>…` 包好的 token — 所以聊天框直接貼 SOP 一樣有效

## Hook 問答(先問,不給答案)
- 「同一個問題『一年有幾個月?』,如果前面多一句『你是行銷顧問,用條列式回答,只給 3 點。』,
  你猜輸出會差多少?差在哪?」
- 「你覺得 ChatGPT 收到你訊息時,model 看到的就是你打的那串字嗎?」

## Demo 段落

### 段落 1 — 裸 prompt(對照組)
- 預告:「先看不加工:問題原樣丟進去,沒有任何結構。」
- 用 MCP:開 http://localhost:9000/index.zh-TW.html → 點 Tab ②(產品層加工)→ 重複 snapshot 到「載入…中」消失
- 確認 mode radio 選「裸 prompt」→ 選 preset「一年有幾個月?」→ 點「送出」→ 等「送出」鈕回 enabled
- debrief:輸出散開、像接續不像回答(甚至 loop)— model 不知道你在「**問**」,把「一年有幾個月?」當題目接龍。沒有「問:答:」結構,它分不出誰問、誰答

### 段落 2 — 加 chat template(問:答:)+ system(怎麼答)
- 預告:「同一題,這次用 Qwen3 chat template 包成『問:答:』結構,再加一句 system 交代風格。會先展開『實際送進 model 的 final prompt』給你看真面目。」
- 用 MCP:填 system 欄「你是行銷顧問,用條列式回答,只給 3 點。」→ 切 mode「產品加工(chat)」→ 選 preset「一年有幾個月?」→ 點開「實際送進 model 的 final prompt」preview
- 點「送出」→ 等「送出」鈕回 enabled → 讀輸出(整齊條列)
- debrief:變整齊條列。兩件事疊起來:
  1. **「問:答:」結構**(主因)— marker 跟 model 說「`<|im_start|>user` 這段是問、`<|im_start|>assistant` 換你答」,所以它「答」而不是接龍
  2. **system 那句**(你是行銷顧問…)疊在最前面,只負責「**怎麼**答」(條列、3 點)
- 指 preview 的 `<|im_start|>` marker:看起來 12 個字元,model 眼裡是 1 個 token(vocab id 151644)

## 學員動手
preset 2「夏季冰飲文案」:讓學員自己 raw 跑一次、再加 system 跑一次,對比結構化程度;
鼓勵他改 system prompt 內容(例:「用台語腔」「只回 1 句」)看輸出跟著變。

## 揭曉與回顧
- 兩個旋鈕分清楚:**「問:答:」結構**決定它「答不答」(vs 接龍)、**system 那句**決定它「怎麼答」(風格/規則)— 但兩個在 model 眼裡**都只是 `<|im_start|>…` 包好的 token**
- 回到 Hook A Q3:所以為什麼「貼 SOP + 交代規則」有效 — ChatGPT 網頁版雖然沒有 system prompt 欄位,但**那只是拼進 token 的文字**,你打進聊天框效果一樣
- 一句話總結:產品層沒有魔法,是「替你把『問:答:』跟交代句打好」

## 常見學員問題
- 「system prompt 是不是比較『強制』?」— 訓練讓 model 更聽 system 段,但本質同樣是 token
- 「我可以叫它忽略 system prompt 嗎?」— 這就是 prompt injection 的由來;約定不是強制
