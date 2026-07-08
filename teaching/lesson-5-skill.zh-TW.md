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

節拍順序(定案):**先講 skill → 開火 → AI 秀 prompt → 講來回軌跡**。

- **1. 先講 skill**(還沒送出,指著左欄「Skill 解剖 — 一個資料夾、三層」卡,
  由上而下講三層;點檔名可看每層實際內容):
  - **L1** frontmatter(幾行 yaml)— model 唯一常駐看得到的「圖書館目錄」:
    這包是什麼、什麼時候用、東西放磁碟哪裡,才幾十個 token
  - **L2** SKILL.md 正文 — 完整說明書(怎麼查、輸出什麼格式),躺在磁碟
  - **L3** 腳本 — 真正幹活的 code,躺在磁碟
  - 收一句:「說明書跟腳本現在都還躺在磁碟上,一個 token 都沒進 context —
    model 手上只有 L1 那幾行目錄」
- **2. 開火**:`POST /drive {"tab":"5","user":"台北今天天氣怎樣?"}`
  (第一次會 swap 4B,banner 3-5 秒)
- **3. AI 秀 prompt**(跑完、講軌跡前):`POST /preview {"tab":"5","user":...,
  "mode":"proper"}` 取回剛剛那份 prompt,用 ```diff 染色貼進對話 — 重點一句:
  「綠色部分沒有半個字的天氣知識,只有目錄跟兩支通用工具」。(上色:`+` 綠=我們寫的、
  `-` 紅=訓練約定改不掉、無前綴灰=template 標記。一律直接貼在對話裡,不要另出
  HTML/artifact)
- **4. 講來回軌跡**(乒乓讀法:左=model 在想、右=東西進來):
  藍 `read_file("skills/check_weather/SKILL.md")` → 右琥珀「SKILL.md 注入 context
  ← 塞回 prompt」(context 計數跳一截)→ 藍 `run_script` → 右紫回
  `{"city":"台北","temp_c":28,...}`(code 沒進 context,只有輸出)→
  綠「台北:28°C, 晴」— 格式是 SKILL.md 規定的
- 講重點:model 用的是**通用工具**(讀檔、跑腳本),沒有任何 skill 專用機制 —
  這正是 Anthropic 的正規做法:skill = 檔案結構 + 慣例,沒有魔法
- 點深看:展開琥珀泡泡看注入的說明書全文;展開紫泡泡下的「腳本原始碼」— 你看得到,
  model 從頭到尾沒看過;展開綠泡泡的「此 turn 實際送出的 prompt」— 剛注入的 L2
  說明書就躺在 messages 裡(琥珀泡泡上那行提示指的就是它)

## 學員動手 — 無 skill 對照
勾選「無 skill 對照」,同一句再送一次:索引是空的(解剖卡上方的 chip 會顯示
「索引是空的」提示),model 只能靠自己編
(或老實說不知道)。對照:同一個 model、同一句話,**差別是有沒有 skill**。
AI 同時用 `/preview` 把兩種 mode 的 prompt 並排秀出來:no_skills 版連索引
都沒有 — model 根本不知道 skill 存在,自然拿不到。

## 揭曉與回顧
- 回到段落 1:skill 的 L2 注入跟「1+1=3」是同一件事 — 都是把 context 塞進
  prompt 改機率;差別是 skill 是**受控的**注入:誰寫的、載不載、載哪包,
  都看得見
- 「context 改機率」的三個互扣證據,一次收線:
  1. **Tab ① 三連發**(定量):機率條親眼看到「2」86% → 「3」87.5% 翻轉
  2. **無 skill 對照**(行為):同 model 同一句,索引在/不在 → 「28°C 晴」變
     「我無法提供即時資訊」
  3. **sent 展開器**(物證):翻開第 2 turn 的 prompt,SKILL.md 就躺在
     messages 裡 — 注入的現場
  先用 1 證明機制存在,Tab ⑤ 展示機制被工程化,2、3 收尾驗屍
- 解剖卡上方的 token 成本 chip:照著兩個數字唸 — 漸進式現在 ~M tokens,全塞進 system
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
- 「skill 跟 Tab ④ 的工具差在哪?」— 差在**能力清單怎麼註冊**。Tab ④ 是
  菜單印死在店裡:工具 schema 寫死在 client code,加一個能力 = 改 code、重新
  部署。skill 是廚房自己看食譜櫃:code 裡永遠只有兩支通用工具(讀檔、跑腳本),
  加能力 = 丟一個資料夾進 skills/,不改半行 code。請 AI 用 `/preview` 秀 prompt
  看 `<tools>` 區塊就知道:**能力變多,工具清單不變** — 這就是 skill 省 context 的關鍵
- 「L2 注入跟我自己貼 SOP 進聊天框差在哪?」— 本質一樣!skill 就是把「你每
  次手貼」變成「model 自己按需取用」,還帶了可執行的腳本
- 「為什麼 code 不進 context?」— model 不需要看 code,只需要結果;code 進
  context 既花 token 又可能被亂改寫
