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
1. **刪除**每段的 MCP 機械行:「開頁 URL」「點 Tab N」「repeat snapshot 到載入消失」「選 preset X」「點送出」「等送出鈕 enabled」「點 token → snapshot 讀機率」。
2. **換上** relay 行:`POST /drive {payload}`(具體 JSON,payload 字串沿用原 preset 字串)+ 一行讀回應預期值 + (①②③ 適用)`POST /inspect {tokenIndex}`。頁面切 tab 由 `drive_start` 自動處理,食譜註明「頁面自動切到 Tab N」不叫 AI 點。
3. **保留**每段的預告(教學問答/收預測)與旁白文字——只把「我讓瀏覽器自己動」這類仍正確的敘述留著。
4. **per-tab payload**(對齊 relay API,母 spec §3.1):
   - ① `{"tab":"1","user":"…"}`
   - ② `{"tab":"2","user":"…","system":"…","mode":"raw"|"chat"}`
   - ③ `{"tab":"3","user":"…","mode":"direct"|"thinking"}`
   - ④ `{"tab":"4","user":"…"[,"system":"…"]}`

## 各課特例

- **lesson-1(basic)**:3 段,每段 `/drive` + `/inspect`(點 token 看分佈)。學員動手「換一個 preset 重跑」→「換一句 prompt 重打」(preset 下拉已移除)。
- **lesson-2(advanced)**:raw vs chat 兩模式,payload 帶 `system` + `mode`。讀回應看「chat 條列 vs raw 亂續」的差異。**教學點:chat template**——原課有引導學員看 `final-prompt-preview`(`<|im_start|>` 那段 template 文字)。**驗證時要確認**:AI 用 `/drive` 驅動、`drive_start` 程式化填輸入框後,頁面的 preview 面板**是否**跟著刷新(`refreshPreview` 綁 input 事件,程式化 set value 可能不觸發)。若刷新 → 食譜叫學員/AI 展開 preview 看;**若不刷新** → 食譜改成叫**學員自己在輸入框打字**(觸發 input 事件、preview 才更新)後再展開,或指向 server 的 `/preview` 端點。plan 依驗證結果定稿這段。
- **lesson-3(reasoning)**:direct vs thinking,payload 帶 `mode`。thinking 段讀回應看 `<think>…</think>` 相位 + `</think>` 後的 final answer(頁面 thinking-content + generated-text)。`n_predict=1500` 在 server 端,thinking 會跑完。
- **lesson-4(agent)**:payload `{tab:"4",…}`。**無 `/inspect`**——這課的重點是 **turn 軌跡**(紫色↑工具呼叫 / 綠色↓工具結果 / final answer),食譜讀「turn 數 + 工具呼叫 + final」而非 token 機率。**第一次 drive tab4 會 0.6B→4B swap**,食譜保留「banner 等 3-5s」的預告(swap 現在在 `/drive` 內,頁面收 `swap_start` 顯示 banner)。學員動手「preset 2 讀+寫摘要 → 開 `~/Desktop/llm-summary.md`」照舊(那是 exec 結果,不涉驅動機制)。

## 驗證

- **每課 relay 實跑**:改完一課,用 relay 對 live server 實跑該課每段的 `/drive`(像 3a demos smoke),確認食譜寫的**預期值**(① 霜 ~0.95、② chat 條列 vs raw 亂續、③ thinking 有 `<think>` 相位、④ get_time/exec_bash turn 軌跡)跟真實輸出對得上——食譜的數字不能憑空寫。用 Playwright 開頁面觀察 + curl `/drive` 讀回應。
- **grep gate(每課雙語)**:互動 lesson 的驅動段落不再有 `用 MCP`/`Via MCP`/`snapshot`/`選 preset`/`select preset`/`點 Tab`/`click Tab`/`preset` 殘留;`POST /drive` 出現在每課雙語。
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
