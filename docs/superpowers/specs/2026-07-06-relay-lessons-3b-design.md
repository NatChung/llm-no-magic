# AI 帶課 relay v3 — 子專案 3b:lesson ①–④ 驅動食譜換 relay Design

日期:2026-07-06
狀態:待 review
母 spec:[2026-06-28-ai-teaching-relay-design.md](./2026-06-28-ai-teaching-relay-design.md)(§8 lesson 改寫)
姊妹:[2026-07-06-relay-onboarding-3a-design.md](./2026-07-06-relay-onboarding-3a-design.md)(3a 進場,已 ship)
前置:relay 後端 + 前端 + 3a 進場 + `/swap` 文件 follow-up 皆已 ship + verified。

## 背景

3a 只改了**進場文件**(AGENTS / README / teaching-README 進場段)。**lesson ①–④(×2 語言)的內文腳本仍是 v2**——每個 Demo 段落還寫著「用 MCP:開頁 → 點 Tab → snapshot 到載入消失 → 選 preset → 送出 → 點 token 讀 snapshot」。這是 3a spec §8 明標的**過渡期**:進場說 relay、lesson 內文說 MCP。3b 把 lesson 內文對齊 relay,關掉這個窗。

實際落定時 brainstorm 決定:**只換驅動食譜**——lesson 的教學內容(學習目標 / Hook 問答 / 旁白 / 學員動手 / 揭曉回顧 / 常見問題)大多與驅動機制無關、仍然好用;過時的只有每段的 MCP 驅動食譜行。3b 做外科式抽換,不重寫教學散文。

## 目標

把 `teaching/lesson-1..4`(EN + zh-TW,共 8 檔)每個 Demo 段落的 **MCP 驅動食譜**換成 **relay 驅動食譜**(`POST /drive` payload + 讀回應預期值 + `POST /inspect`),並掃掉少數散文裡提到 preset / 點 tab 的句子,讓「照著寫好的 lesson 走」跟實際 relay 驅動一致。

## 範圍

**做**:`teaching/lesson-1-basics{.md,.zh-TW.md}`、`lesson-2-product{…}`、`lesson-3-reasoning{…}`、`lesson-4-agent{…}` 的驅動食譜抽換 + preset/tab 散文清掃。

**不做(明確排除)**:
- **重寫教學內容**(學習目標 / Hook / 旁白 / 學員動手 / 揭曉 / 常見問題)—— 保留原文,只在提到 preset/點-tab 的句子做最小修正。
- **Tab ⑤/⑦ 純文章**(commands / mcp / recap / skill 文章)—— 不是 model 驅動的 lesson,不動。
- **`teaching/demos/*`**(3a 已 retarget)、`teaching/README*`(3a 已改進場段)、前後端 code、init.py。
- Tab ⑥ skill、Tab ⑤/⑦/⑧ 文章 tab。

## 驅動食譜的轉換(核准樣板)

**現況(v2,每段長這樣)**:
```
- 用 MCP:開 http://localhost:9000/index.zh-TW.html → 點 Tab ①(...)→ 重複 snapshot 到「載入…中」消失
- 選 preset「床前明月光,疑是地上」→ 點「送出」→ 等「送出」鈕回 enabled
- 點生成文字第一個 token → snapshot 讀機率(預期接「霜」、top-1 94%+)
```

**改後(v3 relay,同段)**:
```
- 驅動:`POST /drive {"tab":"1","user":"床前明月光,疑是地上"}` → 學員頁面自動切到 Tab ① 並逐 token 渲染
- 讀回應:首 token 預期「霜」、prob ~0.95 → 旁白:它「背過」整首詩 → peaked
- 點深看:`POST /inspect {"tokenIndex":0}` → 學員頁面彈那個 token 的機率圖,對著螢幕講
```

**轉換規則**:
1. **刪除**每段**現有的** MCP 機械行——**逐段看哪些在**(不是每段都齊):**第一段**通常有「開頁 URL」「點 Tab N」「repeat snapshot 到載入消失」;**後續段**因頁面已開,通常只有「選 preset X / 送出 / 點 token 讀 snapshot」。有哪行刪哪行。
2. **換上** relay 行:`POST /drive {payload}`(具體 JSON)+ 一行讀回應預期值 + (只有 lesson-1 逐 token 段適用)`POST /inspect {tokenIndex}`。頁面切 tab 由 `drive_start` 自動處理(已驗:`activateTabUI` + `beginRun` 反映 user/system/mode 到欄位),食譜註明「頁面自動切到 Tab N」不叫 AI 點。
   - **`user` payload 字串來源**:①②④ 沿用原段落的 preset 字串(逐字)。**③(reasoning)無 preset 字串**——prompt 只存在 HTML 預填(`index*.html` 的 reasoning 面板 prefill,如 zh-TW 的 `爸爸有3顆蘋果,兒子多他2顆。請問兒子幾顆?`),`user` 直接用**該 HTML prefill 字串逐字**(注意 Hook 裡的版本可能有空格差異,以 prefill 為準);plan 抓出各語言 prefill 的確切字串。lesson-3 段落是靠 **mode radio**(direct/thinking)切換、不是 preset。
3. **保留**每段的預告(教學問答/收預測)與旁白文字——只把「我讓瀏覽器自己動」這類仍正確的敘述留著。
4. **per-tab payload**(對齊 relay API,母 spec §3.1):
   - ① `{"tab":"1","user":"…"}`
   - ② `{"tab":"2","user":"…","system":"…","mode":"raw"|"chat"}`
   - ③ `{"tab":"3","user":"…","mode":"direct"|"thinking"}`
   - ④ `{"tab":"4","user":"…"[,"system":"…"]}`

## 各課特例

- **lesson-1(basic)**:3 段,每段 `/drive` + `/inspect`(點 token 看分佈)。學員動手「換一個 preset 重跑」→「換一句 prompt 重打」(preset 下拉已移除)。
- **lesson-2(advanced)**:raw vs chat 兩模式,payload 帶 `system` + `mode`。讀回應看「chat 條列 vs raw 亂續」的差異。**教學點:chat template**——原課引導學員看 `final-prompt-preview`(`<|im_start|>` 那段 template 文字)。**內容確實會刷新**:`drive_start` handler(`beginRun`)直接呼叫 `refreshPreview()`(不靠 input 事件),AI 驅動後 preview 內容是新的。**真正的卡點**:preview 在一個**收合的 `<details class="preview-details">`** 裡,而 relay **沒有展開 `<details>` 的指令**(§3.6 frame table 無此 type)。所以解法同母 spec §8 對 lesson-4 的處理——**AI 旁白「學員,點一下把 preview 展開來看」**(人類手動展開),不是程式驅動。
- **lesson-3(reasoning)**:direct vs thinking,payload 帶 `mode`。thinking 段讀回應看 `<think>…</think>` 相位 + `</think>` 後的 final answer(頁面 thinking-content + generated-text)。`n_predict=1500` 在 server 端,thinking 會跑完。
- **lesson-4(agent)**:payload `{tab:"4",…}`。**無 `/inspect`**——這課的重點是 **turn 軌跡**(紫色↑工具呼叫 / 綠色↓工具結果 / final answer),食譜讀「turn 數 + 工具呼叫 + final」而非 token 機率。**第一次 drive tab4 會 0.6B→4B swap**,食譜保留「banner 等 3-5s」的預告(swap 現在在 `/drive` 內,頁面收 `swap_start` 顯示 banner)。
  - **「展開 resend details」→ 改人類手動展開**(母 spec §8:「lesson 4『展開 resend 細節』因 `reveal` YAGNI → 改寫成人類 practice 手動展開」):原段落 debrief 叫「展開 turn block 的『再送出』details」,那是收合的 `<details>`、relay 不能展開 → 改成 AI 旁白「學員,點一下展開那個 turn 的『再送出』看 conversation 怎麼累積」。
  - **學員動手 preset → 打字**:原文「preset 2『讀+寫摘要』」——preset 下拉已移除(母 spec §4.3),改成「學員在輸入框**打**那句 prompt(plan 抓出確切字串)」,跑完去開 `~/Desktop/llm-summary.md`(exec 結果那半照舊)。
- **lesson-1/2 學員動手同樣掃 preset**:lesson-1 已列「換 preset→換 prompt 打」;**lesson-2 學員動手若也提 preset(如「preset 2 夏季冰飲文案」)一律改成打 prompt 字串**。目標:preset 下拉移除後,沒有任何 lesson 叫學員去「選 preset」。

## 驗證

- **每課 relay 實跑**:改完一課,用 relay 對 live server 實跑該課每段的 `/drive`(像 3a demos smoke),確認食譜寫的**預期值**(① 霜 ~0.95、② chat 條列 vs raw 亂續、③ thinking 有 `<think>` 相位、④ get_time/exec_bash turn 軌跡)跟真實輸出對得上——食譜的數字不能憑空寫。用 Playwright 開頁面觀察 + curl `/drive` 讀回應。
- **grep gate(每課雙語,file-wide)**:因 I3 把學員動手的 preset 也清掉,`preset` 應該**全檔 0**;連同 `用 MCP`/`Via MCP`/`snapshot`/`選 preset`/`select preset`/`點 Tab`/`click Tab` 也全檔 0(這些是 v2 驅動殘留)。`POST /drive` 出現在每課雙語。(注意:`<details>` 展開改人類手動後,食譜可能仍有「展開 preview / 展開 resend」字樣——那是叫**學員**點,不是 MCP 驅動,合法保留。)
- **雙語同步**:每課 EN + zh-TW 鏡像同一結構(段落數、payload、預期值一致;只語言不同)。

## 執行方式

**一課一單位,共 4 個 task**(brainstorm 決定 per-lesson 粒度)。Nat 已授權自動跑(分岔用推薦答案、不中途 gate);執行用 **workflow fan-out**:4 課各一 agent 抽換雙語食譜(檔案互不重疊、免 worktree)→ 每課一 review agent 檢查(payload 對 API、預期值保留、雙語同步、無 MCP 殘留)→ controller 對每課做 **relay live 驗證** + commit。lesson-4 食譜最複雜(swap + tool + turn),但同原則。

## 檔案異動總覽

| 動作 | 檔案 |
|---|---|
| 修改 | `teaching/lesson-1-basics.md` + `.zh-TW.md`(3 段 `/drive`+`/inspect`;學員動手 preset→prompt) |
| 修改 | `teaching/lesson-2-product.md` + `.zh-TW.md`(raw/chat mode payload) |
| 修改 | `teaching/lesson-3-reasoning.md` + `.zh-TW.md`(direct/thinking mode payload) |
| 修改 | `teaching/lesson-4-agent.md` + `.zh-TW.md`(tab4 payload;turn 軌跡非 inspect;4B swap banner 預告) |
| 不動 | 教學散文(學習目標/Hook/旁白/揭曉/常見問題,除 preset/tab 句)、Tab ⑤/⑦ 文章、demos、teaching/README、前後端、Tab ⑥ |

## 不做(YAGNI 重申)

lesson 內容/例子/結構重新設計、Tab ⑤/⑦/⑧ 文章、`reveal` 指令、動 demos 或 code。3b 只碰 lesson ①–④ 的驅動食譜行 + 少數 preset/tab 散文修正。
