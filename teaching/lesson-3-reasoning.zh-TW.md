# Lesson 3 — Tab ③ 推理:thinking 就是把思考寫成 token

## 學習目標
1. 知道 thinking mode = model 先吐 `<think>…</think>` 思考 token、再吐答案
2. 體會同一個 model,「有沒有空間想」對答案正確率的影響
3. 知道什麼任務值得開 thinking(拿捏題/多步推理),什麼不用(查表式短答)

## Hook 問答(先問,不給答案)
- 「爸爸有 3 顆蘋果,兒子多他 2 顆。請問兒子幾顆?— 這題你覺得 0.6B 小 model 直接答,會對嗎?」
- 「你用過 ChatGPT 的『思考中…』模式嗎?你覺得它在做什麼?」

## Demo 段落

### 段落 1 — 直答(常錯)
- 預告:「直答模式 = 我們強塞一個空的 <think></think>,model 沒空間想、直接吐答案。猜它答幾顆?」
- 跑:`python3 teaching/demos/demo_tab3.py --segment 1 --lang zh-TW`
- debrief:小 model 直答常錯(說 3 顆或亂答);它只是在接龍「最順的數字」

### 段落 2 — 用 thinking(通常對)
- 預告:「同一題,這次讓它把推理寫出來。注意畫面會多一個『完整回覆(含 <think>)』區。」
- 跑:`python3 teaching/demos/demo_tab3.py --segment 2 --lang zh-TW`
- debrief:看 thinking 區 — 推理真的是一個一個 token 寫出來的,不是隱形魔法;
  寫完 `</think>` 後才出最終答案,而且通常對了

## 學員動手
讓學員改數字(爸爸 7 顆、兒子少他 3 顆…)兩種模式各跑一次;體會 thinking 慢但穩。

## 揭曉與回顧
- 對照 Hook 預測:你猜對了嗎?差別不是 model 變聰明,是**給了它把推理寫成 token 的空間**
- 連回 Hook A:法律、賠償這類拿捏題,開 thinking 更穩;法律紅線要明寫(例:「不得違反 XX 條」)—
  但該給的知識(SOP)還是要給,thinking 不能補知識缺口

## 常見學員問題
- 「thinking 的內容可信嗎?」— 它是真實影響答案的 token,但也可能想錯;重要結論仍要核
- 「為什麼不每題都開?」— 慢、貴;查表式短答沒收益
