# Lesson 2 — Tab ② 產品層加工:system prompt 與 chat template

> English: [lesson-2-product.md](./lesson-2-product.md)

## 學習目標
1. 知道「產品層加工」= 在你的字前後**拼上更多文字**再丟給 model(沒有別的魔法)
2. 看懂 `<|im_start|>system / user / assistant` 角色邊界 marker
3. 連回 Hook A:聊天框貼 SOP 之所以有效,就是因為「都只是拼進 token 的文字」

## Hook 問答(先問,不給答案)
- 「同一個問題『一年有幾個月?』,如果前面多一句『你是行銷顧問,用條列式回答,只給 3 點。』,
  你猜輸出會差多少?差在哪?」
- 「你覺得 ChatGPT 收到你訊息時,model 看到的就是你打的那串字嗎?」

## Demo 段落

### 段落 1 — 裸 prompt(對照組)
- 預告:「先看不加工:問題原樣丟進去,model 當接龍題做。」
- 跑:`python3 teaching/demos/demo_tab2.py --segment 1 --lang zh-TW`
- debrief:輸出散開、像接續不像回答 — model 根本不知道「誰在問誰」

### 段落 2 — 加 system + chat template
- 預告:「同一題,加 system prompt + 用 Qwen3 chat template 包好。會先展開『實際送進 model 的
  final prompt』給你看 marker。」
- 跑:`python3 teaching/demos/demo_tab2.py --segment 2 --lang zh-TW`
- debrief:輸出變整齊條列。重點看 preview:`<|im_start|>system…<|im_end|>` 怎麼把你的字包進去;
  marker 看起來 12 個字元,model 眼裡是 1 個 token(vocab id 151644)

## 學員動手
preset 2「夏季冰飲文案」:讓學員自己 raw 跑一次、再加 system 跑一次,對比結構化程度;
鼓勵他改 system prompt 內容(例:「用台語腔」「只回 1 句」)看輸出跟著變。

## 揭曉與回顧
- 回到 Hook A Q3:現在你知道為什麼「貼 SOP + 交代規則」有效 — ChatGPT 網頁版雖然沒有
  system prompt 欄位,但**那只是拼進 token 的文字**,你打進聊天框效果一樣
- 一句話總結:產品層沒有魔法,是「替你打字」

## 常見學員問題
- 「system prompt 是不是比較『強制』?」— 訓練讓 model 更聽 system 段,但本質同樣是 token
- 「我可以叫它忽略 system prompt 嗎?」— 這就是 prompt injection 的由來;約定不是強制
