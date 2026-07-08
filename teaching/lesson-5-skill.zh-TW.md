# Lesson 5 — Tab ⑤ Skill:context 決定答案,skill 就是按需注入的 context

> English: [lesson-5-skill.md](./lesson-5-skill.md)

## 學習目標
1. 體感「context 直接改機率分佈」:塞進 prompt 的東西會翻轉答案
2. 知道 skill = L1 索引常駐 + L2 說明書按需注入 + L3 腳本只回結果
3. 看懂 context 計數:注入了多少、為什麼不整包塞

## 開場(不問答,直接帶入 demo)

一句話帶過:第一課看過「分佈」;這課先看 context 怎麼「改」分佈,再看 skill
怎麼把「改分佈」變成可管理的能力包。

## Demo 段落

### 段落 1 — context 翻轉答案(Tab ①,三段連發)
- 驅動:`POST /drive {"tab":"1","user":"1+1="}` → top-1「2」約 86%
- 驅動:`POST /drive {"tab":"1","user":"1+1=3。那麼 1+1="}` → top-1 還是「2」,
  但「3」從 0% 升到約 28% — 一句假話就把分佈拉歪了
- 驅動:`POST /drive {"tab":"1","user":"1+1=3。1+1=3。1+1="}` → top-1 翻成「3」
  (約 87%)— 餵夠了,答案整個翻過去
- 旁白:context 不是「參考資料」,是直接改每一步的機率;錯的 context 會拿到
  錯的答案,對的 context(你公司的 SOP、規則)就是這樣讓答案變對的

### 段落 2 — skill:把「注入 context」變成能力包(Tab ⑤)
- 預告:「model 一開始只看得到左邊的索引(L1,~幾十 token)。看它自己決定
  要載入哪包、載入瞬間 context 計數怎麼跳。」
- 驅動:`POST /drive {"tab":"5","user":"台北今天天氣怎樣?"}`(第一次會 swap 4B,banner 3-5 秒)
- 讀回應:藍色泡泡 `⟨tool_call⟩ load_skill("check_weather")` → 琥珀色塊
  「SKILL.md body 注入 context」(context 計數跳一截)→ 藍色泡泡呼叫
  `run_skill_script` → 紫色泡泡回 `{"city":"台北","temp_c":28,...}`(code 沒進
  context,只有輸出)→ 綠色「台北:28°C, 晴」— 格式是 SKILL.md 規定的
- 點深看:展開琥珀塊看注入的說明書全文;展開紫色泡泡下的「腳本原始碼」—
  你看得到,model 從頭到尾沒看過

## 學員動手 — 無 skill 對照
勾選「無 skill 對照」,同一句再送一次:索引是空的,model 只能靠自己編
(或老實說不知道)。對照:同一個 model、同一句話,**差別是有沒有 skill**。

## 揭曉與回顧
- 回到段落 1:skill 的 L2 注入跟「1+1=3」是同一件事 — 都是把 context 塞進
  prompt 改機率;差別是 skill 是**受控的**注入:誰寫的、載不載、載哪包,
  都看得見
- 左上 token 成本 chip:照著兩個數字唸 — 漸進式現在 ~M tokens,全塞進 system
  prompt 要 ~N。(單一小 skill 差距不大 — 重點是**方向**:每加一包差距就拉開;
  全塞跟「所有包」一起長,漸進式只跟「你載的那包」長。)
- 收尾地圖 — 同一個機制的四種包裝(context 注入改分佈,跟「1+1=3」一模一樣):
  - prompt engineering = 手寫的注入
  - RAG = 檢索來的注入
  - skill = 受控、按需的注入(誰寫的、載不載、載哪包,全部看得見)
  - context management = 決定注入什麼、丟掉什麼
  學生問到再口頭展開;真的 RAG demo 需要 embedding/檢索,超出本工具範圍(課後延伸)。
- 課後預告:工具目前都住在你電腦裡(skill 的腳本、Tab ④ 的 get_time)。
  下一課:工具住在**別人的 process** 裡怎麼辦?→ Lesson 6

## 常見學員問題
- 「skill 跟 Tab ④ 的工具差在哪?」— Tab ④ 工具寫死在 client;skill 多了
  「說明書」層:先注入怎麼做,才照著做,而且能力包可以一直加
- 「L2 注入跟我自己貼 SOP 進聊天框差在哪?」— 本質一樣!skill 就是把「你每
  次手貼」變成「model 自己按需取用」,還帶了可執行的腳本
- 「為什麼 code 不進 context?」— model 不需要看 code,只需要結果;code 進
  context 既花 token 又可能被亂改寫
