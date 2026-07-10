// ─────────────────────────────────────────────────────────────────────
// LLM 課 frontend — basic/advanced/reasoning/agent 互動 tabs,由 /events relay 驅動,各自獨立 state
// ─────────────────────────────────────────────────────────────────────

// ── i18n: language is taken from <html lang>;預設 en,zh-TW fallback ──
const LANG = document.documentElement.lang || 'en';

// Feature flag: English hasn't been walked through end-to-end yet -- hide the
// language-switch nav link so students land only on 繁體中文 for now. Flip to
// true once the English course has been tested.
const ENABLE_ENGLISH = false;
if (!ENABLE_ENGLISH) {
  document.querySelectorAll(".lang-switch").forEach((el) => el.classList.add("hidden"));
}

const I18N = {
  swap_failed: {
    'en':    'Model swap failed: {err}\n\nManual fallback: SETUP.md "Fri AM check"',
    'zh-TW': '切換 model 失敗:{err}\n\n手動補救:SETUP.md "Fri AM check"',
  },
  tok_title: {
    'en':    'Generated token #{n} — click to see its distribution',
    'zh-TW': '第 {n} 個生成 token — 點看當下分布',
  },
  probs_caption: {
    'en':    '└ viewing the distribution at token #{n} "{tok}"',
    'zh-TW': '└ 正在看第 {n} 個 token「{tok}」的分布',
  },
  mode_note_raw: {
    'en':    'No processing: your text goes straight into the model (completion mode).',
    'zh-TW': '沒加工:你打的字直接丟進 model(completion mode)。',
  },
  mode_note_chat: {
    'en':    'Processed: the product layer wraps your text in role markers — the blue parts are the added convention.',
    'zh-TW': '加工後:產品層用角色 marker 把你的字包起來 —— 藍色的就是被加上去的約定。',
  },
  mode_note_direct: {
    'en':    'Direct: an empty <think></think> is forced in — no room to reason, straight to the answer.',
    'zh-TW': '直答:強塞一個空的 <think></think>,model 沒空間想、直接吐答案。',
  },
  mode_note_thinking: {
    'en':    'Thinking: the <think> block is left open — the model writes its reasoning as tokens before answering.',
    'zh-TW': 'thinking:把 <think> 留著開口,model 先把推理寫成 token、再給答案。',
  },
  model_round_label: {
    'en':    'Model · round {n}',
    'zh-TW': '模型 · 第 {n} 回合',
  },
  tool_bubble_label: {
    'en':    'Tool · {name}',
    'zh-TW': '工具 · {name}',
  },
  user_bubble_label: {
    'en':    'You',
    'zh-TW': '你',
  },
  calls_tool_caption: {
    'en':    'calls the tool — your PC runs it →',
    'zh-TW': '呼叫工具,交給你的電腦跑 →',
  },
  local_exec_badge: {
    'en':    '💻 runs on your PC',
    'zh-TW': '💻 在你電腦執行',
  },
  feeds_back_caption: {
    'en':    '↩ result fed back to the model',
    'zh-TW': '↩ 結果餵回模型',
  },
  to_user_caption: {
    'en':    'no tool_call → goes to you',
    'zh-TW': '沒有 tool_call → 給使用者',
  },
  tool_returns: {
    'en':    'returns',
    'zh-TW': '回傳',
  },
  trace_summary: {
    'en':    'Model ⇄ tools: {trips} round-trip(s), {rounds} rounds in total — only then your turn',
    'zh-TW': '模型 ⇄ 工具 來回 {trips} 趟、共 {rounds} 個回合,最後才輪到你',
  },
  trace_summary_notool: {
    'en':    'No tool needed — the model answered you directly in 1 round',
    'zh-TW': '模型沒呼叫工具,1 個回合直接回答你',
  },
  sent_prompt_summary: {
    'en':    'The prompt actually sent to the AI (turn {turn})',
    'zh-TW': '送給 AI 的 prompt(turn {turn})',
  },
  model_raw_summary: {
    'en':    'The raw message the model emitted',
    'zh-TW': '模型吐的原始訊息',
  },
  to_user_raw_summary: {
    'en':    'The raw message sent to you',
    'zh-TW': '送給使用者的原始訊息',
  },
  l2_injected_label: {
    'en':    'SKILL.md injected into context',
    'zh-TW': 'SKILL.md 注入 context',
  },
  l2_injected_sub: {
    'en':    'the L2 manual now reweights everything that follows',
    'zh-TW': 'L2 說明書進來了,接下來每一步都被它改寫機率',
  },
  inject_back_caption: {
    'en':    '← stuffed back into the prompt',
    'zh-TW': '← 塞回 prompt',
  },
  context_chip: {
    'en':    'context: {n} tokens ({delta})',
    'zh-TW': 'context: {n} tokens({delta})',
  },
  token_cost_chip: {
    'en':    'Progressive loading: ~{proper} tokens now vs ~{naive} if everything were stuffed into the system prompt',
    'zh-TW': '漸進式載入 ~{proper} tokens;全塞進 system prompt 要 ~{naive} tokens',
  },
  script_source_summary: {
    'en':    'The script source (you can read it — the model never does)',
    'zh-TW': '腳本原始碼(你看得到,model 從頭到尾沒看過)',
  },
  skill_read_file_label: {
    'en':    'Tool · read_file',
    'zh-TW': '工具 · read_file',
  },
  no_l3_badge: {
    'en':    '💻 runs on your PC · code never enters context',
    'zh-TW': '💻 在你電腦執行 · code 不進 context',
  },
  no_skills_run_note: {
    'en':    'no-skill run: the index is empty, the model is on its own',
    'zh-TW': '無 skill 對照:索引是空的,model 只能靠自己',
  },
  anatomy_l1_caption: {
    'en':    'L1 · frontmatter (yaml) — always in context (~{n} tokens)',
    'zh-TW': 'L1 · frontmatter(yaml)— 永遠在 context(~{n} tokens)',
  },
  anatomy_l2_caption: {
    'en':    'L2 · SKILL.md body — enters context when read via read_file',
    'zh-TW': 'L2 · SKILL.md body — read_file 讀到時進 context',
  },
  anatomy_l3_caption: {
    'en':    'L3 · script — executed only, code never enters context',
    'zh-TW': 'L3 · 腳本 — 只執行,code 不進 context',
  },
  anatomy_unavailable: {
    'en':    '(anatomy unavailable)',
    'zh-TW': '(解剖資料讀不到)',
  },
  protocol_card_req: { 'en': '→ request',  'zh-TW': '→ 請求' },
  protocol_card_resp:{ 'en': '← response', 'zh-TW': '← 回應' },
  protocol_expand:   { 'en': 'Full JSON-RPC frames', 'zh-TW': '完整 JSON-RPC 內容' },
  wire_tools_summary: {
    'en':    '{n} tool(s), {chars} chars',
    'zh-TW': '{n} 個工具,{chars} 字元',
  },
  wire_toolcall_summary: {
    'en':    'tool call',
    'zh-TW': '工具呼叫',
  },
  wire_chars_summary: {
    'en':    '{chars} chars',
    'zh-TW': '{chars} 字元',
  },
  wire_obj_summary: {
    'en':    '{n} keys, {chars} chars',
    'zh-TW': '{n} 個欄位,{chars} 字元',
  },
  wire_arr_summary: {
    'en':    '{n} items, {chars} chars',
    'zh-TW': '{n} 個項目,{chars} 字元',
  },
  mcp_exec_badge: {
    'en':    '🔌 runs in the external process',
    'zh-TW': '🔌 在外部 process 執行',
  },
  handshake_empty: {
    'en':    '(not run yet)',
    'zh-TW': '(還沒跑)',
  },
};
function t(key, vars = {}) {
  let s = (I18N[key] && I18N[key][LANG]) || (I18N[key] && I18N[key].en) || key;
  for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
}

function showSwapBanner(modelName) {
  const banner = document.getElementById("swap-banner");
  const label  = document.getElementById("swap-banner-model");
  if (!banner || !label) return;
  label.textContent = modelName;
  banner.classList.remove("hidden");
  document.body.classList.add("swapping");
}

function hideSwapBanner() {
  const banner = document.getElementById("swap-banner");
  if (banner) banner.classList.add("hidden");
  document.body.classList.remove("swapping");
}

// ── Render top-K probability bar chart (module-level, 可被多 panel 重用)──
function renderProbs(probsEl, topLogprobs) {
  if (!topLogprobs || !Array.isArray(topLogprobs)) {
    console.warn("renderProbs: top_logprobs missing", topLogprobs);
    return;
  }
  probsEl.innerHTML = "";
  const top = topLogprobs.slice(0, 10);
  const items = top.map(({token, logprob}) => ({token, prob: Math.exp(logprob)}));
  for (const {token, prob} of items) {
    const row = document.createElement("div"); row.className = "bar-row";
    const lbl = document.createElement("span"); lbl.className = "bar-label";
    lbl.textContent = JSON.stringify(token).slice(1, -1);
    const track = document.createElement("div"); track.className = "bar-track";
    const fill = document.createElement("div"); fill.className = "bar-fill";
    // bar width = absolute probability (27% prob → 27% bar). previously
    // normalised by max-in-top-10 which made top-1 always look 100%.
    fill.style.width = `${prob * 100}%`;
    track.appendChild(fill);
    const pct = document.createElement("span"); pct.className = "bar-pct";
    pct.textContent = `${(prob * 100).toFixed(1)}%`;
    row.append(lbl, track, pct);
    probsEl.appendChild(row);
  }
}

// ── Relay: page is a pure instrument driven by POST /drive, reflecting via
//    GET /events. Backend GEN_LOCK serializes generation, so exactly one
//    panel is "active" at a time — a single pointer set on drive_start. ──
const PANEL_TO_TAB = { basic: "1", advanced: "2", reasoning: "3", agent: "4", skill: "5", mcp: "6" };
const TAB_TO_PANEL = { "1": "basic", "2": "advanced", "3": "reasoning", "4": "agent", "5": "skill", "6": "mcp" };
const PANELS = {};   // tab id "1".."4" → render callbacks (registered in setup*)

// Switch the visible panel by panel-name (HTML data-panel value), and keep
// the nav dropdown in sync. Shared by the dropdown AND drive_start
// (spec §3.6: drive_start → switch tab UI).
function activateTabUI(panelName) {
  document.querySelectorAll(".tab-panel").forEach((p) =>
    p.classList.toggle("active", p.dataset.panel === panelName));
  const sel = document.querySelector(".tab-select");
  if (sel && sel.value !== panelName) sel.value = panelName;
}

// ── Lesson bridge: carry the last-used prompt across tab switches ──
// lastPrompt tracks the most recently edited/driven interactive prompt.
// On a user tab click it is copied into the destination tab's .prompt so
// each lesson opens where the previous one closed. Only interactive tabs
// 1-4 have a .prompt; skill (.skill-prompt) and mcp (no prompt) are skipped.
let lastPrompt = "";
document.querySelectorAll('[data-panel] .prompt').forEach((el) =>
  el.addEventListener("input", () => { lastPrompt = el.value; }));

const NO_CARRY_PANELS = new Set(["skill", "mcp"]);   // 接龍串只到 ④;⑤⑥ 各有自己的題型
function carryPromptInto(panelName) {
  if (NO_CARRY_PANELS.has(panelName)) return;
  if (!PANEL_TO_TAB[panelName] || !lastPrompt) return;   // interactive tabs only
  const el = document.querySelector(`.tab-panel[data-panel="${panelName}"] .prompt`);
  if (!el) return;
  el.value = lastPrompt;
  el.dispatchEvent(new Event("input", { bubbles: true }));  // refresh preview (advanced/reasoning)
}

// Render the "final prompt sent to the model" preview with chat-template
// markers (<|im_start|>, <|im_end|>, any <|…|>) highlighted in Signal Blue —
// so the product-layer processing reads at a glance: the colored markers ARE
// the role convention the product layer adds. Escapes first, so user text is
// never interpreted as HTML.
function renderPromptPreview(previewEl, text) {
  if (!previewEl) return;
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  // <tools>...</tools> ships as one dense JSON line per function signature --
  // pretty-print + color it (purple keys / green string values) so students
  // can actually read the schema instead of one long escaped line.
  function renderToolJson(line) {
    let obj;
    try { obj = JSON.parse(line); } catch { return esc(line); }
    return esc(JSON.stringify(obj, null, 2))
      .replace(/"([^"]+)":/g, '<span class="text-tool">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="text-result">"$1"</span>');
  }

  const placeholders = [];
  const withMarkers = text.replace(/<tools>([\s\S]*?)<\/tools>/g, (full, inner) => {
    const lines = inner.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return full;   // e.g. an inline "<tools></tools>" mention in prose -- leave as-is
    const body = lines.map(renderToolJson).join("\n\n");
    placeholders.push(
      `<span class="text-muted">&lt;tools&gt;</span>\n${body}\n<span class="text-muted">&lt;/tools&gt;</span>`
    );
    return `@@TOOLS_BLOCK_${placeholders.length - 1}@@`;
  });

  let html = esc(withMarkers).replace(
    /&lt;\|[^|]*\|&gt;/g,
    (m) => `<span class="text-final font-semibold">${m}</span>`
  );
  html = html.replace(/@@TOOLS_BLOCK_(\d+)@@/g, (_, i) => placeholders[Number(i)]);
  previewEl.innerHTML = html;
}


// ── Shared chat-bubble builders (tabs ④⑤⑥) ──────────────────────────
// 視覺語彙:模型=藍(左)、工具=紫(右)、給使用者=綠(全寬)。
const BUBBLE = {
  tw: {
    block:      "turn-block space-y-1",
    mRow:       "max-w-[88%] md:max-w-[75%]",
    mLabel:     "text-xs font-semibold text-final mb-1",
    mChip:      "ml-1.5 font-normal text-muted",
    mBubble:    "w-fit rounded-2xl rounded-tl-sm bg-final-tint border border-final/15 px-4 py-3 font-mono text-sm break-all leading-relaxed text-ink",
    mCaption:   "text-xs text-muted mt-1 ml-1",
    tRow:       "ml-auto max-w-[88%] md:max-w-[75%] flex flex-col items-end",
    tLabel:     "text-xs font-semibold text-tool mb-1",
    tBadge:     "ml-1.5 font-normal text-muted",
    tBubble:    "rounded-2xl rounded-tr-sm bg-tool-tint border border-tool/15 px-4 py-3 font-mono text-sm break-all leading-relaxed text-ink text-left",
    tCaption:   "text-xs text-tool mt-1 mr-1",
    // user 泡:靠右(右側 = 東西進來),中性色 — 跟工具紫、注入琥珀區隔
    uLabel:     "text-xs font-semibold text-ink-soft mb-1",
    uBubble:    "rounded-2xl rounded-tr-sm bg-surface-2 border border-edge px-4 py-3 font-mono text-sm break-all leading-relaxed text-ink text-left",
    // 琥珀變體(tab⑤ L2 注入):同右側工具泡泡的節奏,顏色標「這一發是注入」
    iLabel:     "text-xs font-semibold text-inject mb-1",
    iBubble:    "rounded-2xl rounded-tr-sm bg-inject-tint border border-inject/25 px-4 py-3 text-sm break-all leading-relaxed text-ink text-left",
    iCaption:   "text-xs text-inject mt-1 mr-1",
    fCaption:   "text-center text-xs font-semibold text-result pt-2 mb-2",
    fBubble:    "rounded-xl bg-result-tint border border-result/15 px-4 py-3.5 text-center text-base md:text-lg leading-relaxed text-ink",
    banner:     "rounded-lg bg-surface-2 border border-edge-soft px-4 py-3 flex items-center gap-3 text-sm text-ink-soft",
    bannerIcon: "w-7 h-7 rounded-full bg-final-tint text-final flex items-center justify-center flex-shrink-0",
    npDetails:  "mt-1.5 w-full text-left",
    npSummary:  "cursor-pointer text-xs text-muted hover:text-ink-soft py-1 list-none [&::-webkit-details-marker]:hidden before:content-['▸_'] [&[open]]:before:content-['▾_']",
    // 右側泡泡(user / 工具 / 注入)的展開器:npDetails 的 w-full 會撐滿整列,
    // text-left 就把 summary 推到列的最左緣、離泡泡 300px 遠。summary 靠右對齊,
    // 讓它的右緣貼齊泡泡右緣;<pre> 仍靠左(展開後才好讀)。
    npSummaryRight: "text-right",
    npPre:      "mt-1.5 rounded-md bg-surface border border-edge-soft p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto text-ink-soft",
    errorBox:   "mt-3 rounded-md bg-surface-2 border border-edge p-3 text-sm font-mono text-ink-soft",
  },
  // align: "right" 給右側泡泡用 —— summary 跟著泡泡靠右,不要孤零零留在列左緣
  details(summaryText, contentEl, { align = "left" } = {}) {
    const details = document.createElement("details");
    details.className = BUBBLE.tw.npDetails;
    const summary = document.createElement("summary");
    summary.className = align === "right"
      ? `${BUBBLE.tw.npSummary} ${BUBBLE.tw.npSummaryRight}`
      : BUBBLE.tw.npSummary;
    summary.textContent = summaryText;
    details.append(summary, contentEl);
    return details;
  },
  pre(text) {
    const pre = document.createElement("pre");
    pre.className = BUBBLE.tw.npPre;
    pre.textContent = text;
    return pre;
  },
  user({ text }) {
    const row = document.createElement("div");
    row.className = BUBBLE.tw.tRow;
    const labelEl = document.createElement("div");
    labelEl.className = BUBBLE.tw.uLabel;
    labelEl.textContent = t('user_bubble_label');
    const bubble = document.createElement("div");
    bubble.className = BUBBLE.tw.uBubble;
    bubble.textContent = text;
    row.append(labelEl, bubble);
    return { row, bubble };
  },
  model({ label, lines, caption, chip }) {
    const row = document.createElement("div");
    row.className = BUBBLE.tw.mRow;
    const labelEl = document.createElement("div");
    labelEl.className = BUBBLE.tw.mLabel;
    labelEl.textContent = label;
    if (chip) {
      const chipEl = document.createElement("span");
      chipEl.className = BUBBLE.tw.mChip;
      chipEl.textContent = chip;
      labelEl.appendChild(chipEl);
    }
    const bubble = document.createElement("div");
    bubble.className = BUBBLE.tw.mBubble;
    for (const line of lines) {
      const div = document.createElement("div");
      div.textContent = line;
      bubble.appendChild(div);
    }
    row.append(labelEl, bubble);
    if (caption) {
      const cap = document.createElement("div");
      cap.className = BUBBLE.tw.mCaption;
      cap.textContent = caption;
      row.appendChild(cap);
    }
    return { row, bubble };
  },
  tool({ label, badge, body, caption, tone }) {
    const inject = tone === "inject";
    const row = document.createElement("div");
    row.className = BUBBLE.tw.tRow;
    const labelEl = document.createElement("div");
    labelEl.className = inject ? BUBBLE.tw.iLabel : BUBBLE.tw.tLabel;
    labelEl.textContent = label;
    if (badge) {
      const badgeEl = document.createElement("span");
      badgeEl.className = BUBBLE.tw.tBadge;
      badgeEl.textContent = badge;
      labelEl.appendChild(badgeEl);
    }
    const bubble = document.createElement("div");
    bubble.className = inject ? BUBBLE.tw.iBubble : BUBBLE.tw.tBubble;
    bubble.textContent = body;
    row.append(labelEl, bubble);
    if (caption) {
      const cap = document.createElement("div");
      cap.className = inject ? BUBBLE.tw.iCaption : BUBBLE.tw.tCaption;
      cap.textContent = caption;
      row.appendChild(cap);
    }
    return { row, bubble };
  },
  finalBlock({ caption, content }) {
    const block = document.createElement("div");
    block.className = BUBBLE.tw.block;
    const capEl = document.createElement("div");
    capEl.className = BUBBLE.tw.fCaption;
    capEl.textContent = caption;
    const bubble = document.createElement("div");
    bubble.className = BUBBLE.tw.fBubble;
    bubble.textContent = content || "(no final content)";
    block.append(capEl, bubble);
    return block;
  },
  banner(text) {
    const el = document.createElement("div");
    el.className = BUBBLE.tw.banner;
    const icon = document.createElement("span");
    icon.className = BUBBLE.tw.bannerIcon;
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⟳";
    const span = document.createElement("span");
    span.textContent = text;
    el.append(icon, span);
    return el;
  },
};

// Returns the fetch Response (or null on network error) so callers can detect
// a rejected/failed drive (409 busy, or a 5xx e.g. swap failure) and re-enable
// their Send button — no drive_start/final will arrive for it. On 200 the
// response resolves AFTER generation, by which point final has already
// re-enabled — so callers only need to act when !r.ok.
async function postDrive(payload) {
  try {
    const r = await fetch("/drive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.status === 409) console.warn("[drive] busy (409) — a generation is already running");
    return r;
  } catch (err) {
    console.error("[drive] failed", err);
    return null;
  }
}

async function postStop() {
  try {
    await fetch("/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch (err) { console.error("[stop] failed", err); }
}

function connectEvents() {
  let active = null;   // the PANELS[tab] entry currently being driven
  const es = new EventSource("/events");
  es.onmessage = (e) => {
    let f;
    try { f = JSON.parse(e.data); } catch (_) { return; }
    switch (f.type) {
      case "swap_start":  showSwapBanner(f.model); active = null; break;
        // ^ reset active so a swap FAILURE (swap_start → error → final, no
        //   drive_start) can't misroute error/final to the previously-driven
        //   panel. A successful swap re-sets active at drive_start below.
      case "drive_start":
        hideSwapBanner();
        if (TAB_TO_PANEL[f.tab]) activateTabUI(TAB_TO_PANEL[f.tab]);  // §3.6: bring the driven tab into view
        active = PANELS[f.tab] || null;
        active && active.onDriveStart && active.onDriveStart(f);
        break;
      case "token":          active && active.onToken && active.onToken(f); break;
      case "turn_complete":  active && active.onTurnComplete && active.onTurnComplete(f); break;
      case "index":          active && active.onIndex && active.onIndex(f); break;
      case "tools_exposed":  active && active.onToolsExposed && active.onToolsExposed(f); break;
      case "sent":           active && active.onSent && active.onSent(f); break;
      case "received":       active && active.onReceived && active.onReceived(f); break;
      case "turn":           active && active.onTurn && active.onTurn(f); break;
      case "skill_loaded":   active && active.onSkillLoaded && active.onSkillLoaded(f); break;
      case "l3_loaded":      active && active.onL3Loaded && active.onL3Loaded(f); break;
      case "tool_result":    active && active.onToolResult && active.onToolResult(f); break;
      case "protocol":       active && active.onProtocol && active.onProtocol(f); break;
      case "final":
        hideSwapBanner();
        active && active.onFinal && active.onFinal(f);
        break;
      case "inspect":        active && active.onInspect && active.onInspect(f); break;
      case "error":
        hideSwapBanner();
        // active is null on a swap failure (reset at swap_start) or a
        // first-ever drive that never reached drive_start; a non-swap
        // generation error keeps active = the driven panel. Fall back to a
        // visible alert whenever no panel can render the error.
        if (active && active.onError) active.onError(f);
        else alert(t('swap_failed', { err: f.message }));
        break;
    }
  };
  es.onerror = () => { /* EventSource auto-reconnects; banner stays as-is */ };
}

// ── Tab switching — UI only, via the nav dropdown. The server swaps the
//    model inside /drive; the page reacts to swap_start (banner). ──
document.querySelector(".tab-select")?.addEventListener("change", (e) => {
  activateTabUI(e.target.value);
  carryPromptInto(e.target.value);
});

// ── Per-panel setup (closure pattern,每 tab 自己一份 state)──────────
function setupPanel(panel) {
  const promptEl  = panel.querySelector(".prompt");
  const runBtn    = panel.querySelector(".run");
  const textEl    = panel.querySelector(".generated-text");
  const probsEl   = panel.querySelector(".probs");
  const previewEl = panel.querySelector(".final-prompt-preview");    // 只有 advanced / reasoning panel 有
  const thinkingArea = panel.querySelector(".thinking-area");        // 只有 reasoning panel 有
  const thinkingContentEl = panel.querySelector(".thinking-content");
  const captionEl = panel.querySelector(".probs-caption");           // 只有 basic panel 有
  const modeNoteEl = panel.querySelector(".mode-note");              // 只有 advanced panel 有
  const panelType = panel.dataset.panel;  // 'basic' | 'advanced' | 'reasoning'

  let tokenSteps = [];
  // phase state for reasoning mode: "pre_think" → "in_think" → "in_answer"
  // tokens route to thinking-content while "in_think", else to generated-text
  let phase = "pre_think";

  function buildFinalPrompt() {
    if (panelType === "basic") return promptEl.value;
    const user = promptEl.value;
    const chatBase = `<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n`;

    if (panelType === "advanced") {
      const mode = panel.querySelector('input[name="mode-advanced"]:checked')?.value || "raw";
      if (mode === "raw") return user;
      // 加工模式預設跳 thinking(乾淨答案);think 標記留給 Lesson 3 再解釋,預覽不顯示
      return chatBase;
    }
    if (panelType === "reasoning") {
      const mode = panel.querySelector('input[name="mode-reasoning"]:checked')?.value || "direct";
      // direct = 跳 thinking;thinking = 保留(讓 model 自己想)
      return mode === "direct" ? chatBase + `<think>\n\n</think>\n\n` : chatBase;
    }
    return user;
  }

  function refreshPreview() {
    if (previewEl) renderPromptPreview(previewEl, buildFinalPrompt());
    if (modeNoteEl && panelType === "advanced") {
      const mode = panel.querySelector('input[name="mode-advanced"]:checked')?.value || "raw";
      modeNoteEl.textContent = t(mode === "raw" ? "mode_note_raw" : "mode_note_chat");
    }
    if (modeNoteEl && panelType === "reasoning") {
      const mode = panel.querySelector('input[name="mode-reasoning"]:checked')?.value || "direct";
      modeNoteEl.textContent = t(mode === "direct" ? "mode_note_direct" : "mode_note_thinking");
    }
  }

  // GPT-style combined button:idle = send(↑),生成中 = stop(■)可按停
  let running = false;
  function setRunning(on) { running = on; runBtn.classList.toggle("running", on); }

  function appendClickableToken(stepIdx, token, target) {
    const span = document.createElement("span");
    span.dataset.step = String(stepIdx);
    span.textContent = token;
    if (probsEl) {
      span.className = "tok";
      span.title = t('tok_title', {n: stepIdx + 1});
      span.addEventListener("click", () => {
        const s = tokenSteps[stepIdx];
        if (!s) return;
        renderProbs(probsEl, s.top_logprobs);
        highlightStep(stepIdx);
      });
    } else {
      span.className = "tok tok-static";   // reasoning: no probs panel to pop; styles.css 的 .tok.tok-static 規則依賴這個字面值(必留)
    }
    (target || textEl).appendChild(span);
  }

  function highlightStep(idx) {
    // tokens may live in either textEl or thinkingContentEl
    const allToks = [
      ...textEl.querySelectorAll(".tok"),
      ...(thinkingContentEl ? thinkingContentEl.querySelectorAll(".tok") : []),
    ];
    allToks.forEach((s) => {
      s.classList.toggle("selected", parseInt(s.dataset.step) === idx);
    });
    // Tab ①:輸出框下方的「正在看第 N 個 token 的分布」提示
    if (captionEl && tokenSteps[idx]) {
      const tokText = tokenSteps[idx].token.replace(/\n/g, "⏎").trim() || tokenSteps[idx].token;
      captionEl.textContent = t('probs_caption', { n: idx + 1, tok: tokText });
      captionEl.classList.remove("hidden");
    }
  }

  // ── Relay render callbacks (replace the old self-fetch runCompletion) ──
  let isThinkingMode = false;
  function beginRun(frame) {
    setRunning(true);
    textEl.textContent = ""; if (probsEl) probsEl.innerHTML = "";
    if (captionEl) captionEl.classList.add("hidden");
    tokenSteps = [];
    // §3.6 顯示輸入 — drive_start carries the driven user/system/mode; reflect
    // them into this panel's own input fields so the student watches the
    // instrument show the question that was actually asked, not a blank one.
    if (frame.user != null) { promptEl.value = frame.user; lastPrompt = frame.user; }
    // Tab ①:輸出框先回聲 prompt(灰字),生成 token 接在後面 — 畫面直接呈現「接龍」
    if (panelType === "basic" && frame.user) {
      const echo = document.createElement("span");
      echo.className = "echo";
      echo.textContent = frame.user;
      textEl.appendChild(echo);
    }
    if (frame.mode != null) {
      const radio = panel.querySelector(`input[name="mode-${panelType}"][value="${frame.mode}"]`);
      if (radio) radio.checked = true;
    }
    isThinkingMode = panelType === "reasoning" && frame.mode === "thinking";
    phase = isThinkingMode ? "pre_think" : "in_answer";
    if (thinkingContentEl) thinkingContentEl.textContent = "";
    if (thinkingArea) thinkingArea.classList.toggle("hidden", !isThinkingMode);
    if (panelType !== "basic") refreshPreview();
  }
  function onTokenStep(step) {
    const stepIdx = tokenSteps.length;
    tokenSteps.push({ token: step.token, top_logprobs: step.top_logprobs });
    const trim = step.token.replace(/[\s\n]/g, "");
    if (isThinkingMode) appendClickableToken(stepIdx, step.token, thinkingContentEl);
    if (isThinkingMode && trim === "<think>") phase = "in_think";
    else if (isThinkingMode && trim === "</think>") phase = "in_answer";
    else if (phase === "in_answer") appendClickableToken(stepIdx, step.token, textEl);
    if (probsEl && stepIdx === 0) { renderProbs(probsEl, step.top_logprobs); highlightStep(0); }
  }
  function endRun() { setRunning(false); }
  function onInspect(frame) {
    if (!probsEl) return;                     // reasoning: no probs panel
    const s = tokenSteps[frame.tokenIndex];
    if (!s) return;
    renderProbs(probsEl, s.top_logprobs);
    highlightStep(frame.tokenIndex);
  }
  function onError(frame) {
    textEl.textContent += `\n[error] ${frame.message}`;
    endRun();
  }

  // Register this panel so the global /events dispatcher can drive it.
  PANELS[PANEL_TO_TAB[panelType]] = {
    onDriveStart: beginRun,
    onToken: (f) => onTokenStep(f),
    onFinal: endRun,
    onInspect: onInspect,
    onError: onError,
  };

  function driveThisPanel() {
    if (!promptEl.value.trim()) return;
    setRunning(true);   // flip to stop-icon immediately, avoid double-fire 409
    const payload = { tab: PANEL_TO_TAB[panelType], user: promptEl.value };
    if (panelType === "advanced") {
      payload.mode = panel.querySelector('input[name="mode-advanced"]:checked')?.value || "raw";
    } else if (panelType === "reasoning") {
      payload.mode = panel.querySelector('input[name="mode-reasoning"]:checked')?.value || "direct";
    }
    // Re-enable Send if the drive was rejected (409 busy) or failed (e.g. a
    // 5xx from a swap failure) — no drive_start/final will arrive for it.
    // On 200 (r.ok) final has already re-enabled via onFinal.
    postDrive(payload).then((r) => { if (!r || !r.ok) setRunning(false); });
  }

  // ── Wire events ────────────────────────────────────────────────────
  runBtn.addEventListener("click", () => {
    if (running) { postStop(); setRunning(false); }   // 生成中:按 = 停止
    else driveThisPanel();
  });
  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      if (!promptEl.value.trim() || running) return;
      driveThisPanel();
    }
  });

  // Advanced / Reasoning panel:live preview update
  if (panelType !== "basic") {
    const updatePreview = () => refreshPreview();
    promptEl.addEventListener("input", updatePreview);
    panel.querySelectorAll(`input[name="mode-${panelType}"]`).forEach((r) =>
      r.addEventListener("change", updatePreview)
    );
    refreshPreview();  // initial render
  }
}

// ── Tab ④ Agent — 真執行 tool,SSE per-turn render ─────────────────────
function setupAgent(panel) {
  const promptEl   = panel.querySelector(".prompt");
  const runBtn     = panel.querySelector(".run");
  const turnsEl    = panel.querySelector(".turns");
  // Note: Tab ④ 拿掉 probs-area,token 不再 clickable(教學焦點移到 turn-level
  // 累積 prompt,不在 per-token 機率)— renderProbs 仍在 Tab 1-3 用
  // final answer 不再有獨立 section:綠色「給使用者」泡泡直接渲染在 turns 流裡
  // 「實際送進 model 的 prompt」不再放頁面 — AI 老師用 POST /preview 取回,
  // 在對話裡上色講解(頁面愈來愈滿,這塊由 AI 演比較清楚)。

  // Per-turn token storage(避免不同 turn 的 token index 衝突)
  // turns[i] = { tokenSteps: [{token, top_logprobs}, ...], el: HTMLElement, hadTool: bool }
  let turns = [];
  let finalRendered = false;   // final turn 的綠色泡泡是否已渲染
  // lastRightBubble: the most recently rendered right-side bubble (user row,
  // or a turn's last purple tool row) that hasn't yet received its "prompt
  // actually sent because of it" expander. turn_complete(N).sent_prompt is
  // that prompt — it attaches HERE, not to the model bubble that triggered it
  // (spec 2026-07-10-expander-belongs-to-its-own-bubble.md).
  let lastRightBubble = null;

  function clearAll() {
    turns = [];
    finalRendered = false;
    lastRightBubble = null;
    turnsEl.innerHTML = "";
  }

  function renderTurnBlock(turn, message_tokens, tool_calls, tool_results, sent_prompt, received_chunk) {
    const block = document.createElement("div");
    block.className = BUBBLE.tw.block;
    block.dataset.turn = String(turn);
    const hasToolCalls = (tool_calls || []).length > 0;

    // sent_prompt for THIS turn is what produced this turn's own response —
    // it belongs to whichever right-side bubble caused it (user bubble for
    // turn 1, else the previous turn's last purple tool bubble).
    if (sent_prompt && lastRightBubble) {
      lastRightBubble.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn }),
                                                  BUBBLE.pre(sent_prompt),
                                                  { align: "right" }));
      lastRightBubble = null;
    }

    if (hasToolCalls) {
      const lines = tool_calls.map((tc) => {
        const argsStr = (tc.args || "").trim();
        return `⟨tool_call⟩ ${tc.name}(${argsStr === "{}" ? "" : argsStr})`;
      });
      const { row: mRow } = BUBBLE.model({
        label: t('model_round_label', { n: turn }),
        lines,
        caption: t('calls_tool_caption'),
      });
      if (received_chunk) {
        mRow.appendChild(BUBBLE.details(t('model_raw_summary'), BUBBLE.pre(received_chunk)));
      }
      block.appendChild(mRow);

      // 紫泡:掛下一 turn 的 sent_prompt(見上方);多顆時只有最後一顆掛
      let lastToolRow = null;
      (tool_results || []).forEach((tr) => {
        const raw = (tr.result_text || "").trim();
        const looksJson = raw.startsWith("{") || raw.startsWith("[");
        const { row: tRow } = BUBBLE.tool({
          label: t('tool_bubble_label', { name: tr.name }),
          badge: t('local_exec_badge'),
          body: `${t('tool_returns')} ${looksJson ? raw : JSON.stringify(raw)}`,
          caption: t('feeds_back_caption'),
        });
        block.appendChild(tRow);
        lastToolRow = tRow;
      });
      lastRightBubble = lastToolRow;
    } else {
      // ── final 回合:沒有 tool_call → 綠色全寬「給使用者」 ──
      finalRendered = true;
      const content = (message_tokens || []).map((s) => s.token).join("");
      const fb = BUBBLE.finalBlock({ caption: t('to_user_caption'), content });
      if (received_chunk) {
        fb.appendChild(BUBBLE.details(t('to_user_raw_summary'), BUBBLE.pre(received_chunk)));
      }
      block.appendChild(fb);
    }

    turnsEl.appendChild(block);
    turns.push({
      tokenSteps: message_tokens || [],
      el:         block,
      hadTool:    hasToolCalls,
    });
  }

  // final 後 prepend 頂端摘要:模型 ⇄ 工具 來回 N 趟、共 M 個回合
  function renderTraceSummary() {
    const rounds = turns.length;
    if (!rounds) return;
    const trips = turns.filter((tn) => tn.hadTool).length;
    turnsEl.prepend(BUBBLE.banner(
      trips === 0 ? t('trace_summary_notool') : t('trace_summary', { trips, rounds })));
  }

  function renderFinal(content) {
    // 正常流程綠色泡泡已在 final turn 的 turn_complete 渲染;這裡只補
    // 「最後一 turn 仍在 tool_call 就被截停」的 fallback(如 max-turns cap)
    if (finalRendered || !content) return;
    turnsEl.appendChild(BUBBLE.finalBlock({ caption: t('to_user_caption'), content }));
  }

  function renderError(msg) {
    const errBox = document.createElement("div");
    errBox.className = BUBBLE.tw.errorBox;
    errBox.textContent = `[error] ${msg}`;
    turnsEl.appendChild(errBox);
  }

  // ── Relay: register so the global /events dispatcher drives this panel ──
  let running = false;
  function setRunning(on) { running = on; runBtn.classList.toggle("running", on); }
  function beginRun(frame) {
    clearAll();
    setRunning(true);
    // §3.6 顯示輸入 — reflect the driven user into the panel's own
    // input fields so the student sees the question that was actually asked.
    if (frame && frame.user != null) { promptEl.value = frame.user; lastPrompt = frame.user; }
    // user 泡領頭:右側 = 東西進來,你的問題是最先進來的那個
    if (frame && frame.user) {
      const { row } = BUBBLE.user({ text: frame.user });
      turnsEl.appendChild(row);
      lastRightBubble = row;   // turn 1's sent_prompt attaches here
    }
  }
  function endRun() { setRunning(false); }
  PANELS["4"] = {
    onDriveStart: beginRun,
    onTurnComplete: (f) =>
      renderTurnBlock(f.turn, f.message_tokens, f.tool_calls, f.tool_results, f.sent_prompt, f.received_chunk),
    onFinal: (f) => { renderFinal(f.content); renderTraceSummary(); endRun(); },
    onError: (f) => { renderError(f.message); endRun(); },
  };

  function driveAgent() {
    if (!promptEl.value.trim()) return;
    setRunning(true);   // flip to stop-icon immediately, avoid double-fire 409
    postDrive({ tab: "4", user: promptEl.value })
      .then((r) => { if (!r || !r.ok) setRunning(false); });
  }

  runBtn.addEventListener("click", () => {
    if (running) { postStop(); setRunning(false); }   // 生成中:按 = 停止
    else driveAgent();
  });
}

// On load: subscribe to the relay. No model swap here — the server swaps
// inside the first /drive (page reacts to swap_start).
window.addEventListener("DOMContentLoaded", connectEvents);

// Initialize panels — basic/advanced/reasoning go through setupPanel;
// agent → setupAgent; skill → setupSkillTab; mcp → setupMcpTab.
document.querySelectorAll(".tab-panel").forEach((panel) => {
  const id = panel.dataset.panel;
  if (id === "agent") setupAgent(panel);
  else if (id === "skill") setupSkillTab(panel);
  else if (id === "mcp") setupMcpTab(panel);
  else setupPanel(panel);
});


// ── Tab ⑤ Skill — 三層漸進式揭露,drive 經 /drive relay ────────────────
function setupSkillTab(panel) {
  const promptEl = panel.querySelector(".prompt");
  const runBtn   = panel.querySelector(".run");
  const turnsEl  = panel.querySelector(".turns");
  const chipEl   = panel.querySelector(".skill-token-chip");
  const noSkillsToggle = panel.querySelector(".no-skills-toggle");
  // 「實際送進 model 的 prompt」由 AI 老師經 POST /preview 取回、在對話裡講解
  // (同 tab④)— 頁面不再放 preview 框。

  let turns = [];               // {hadTool} for the banner
  let lastPromptTokens = null;  // context-chip delta
  let scriptSources = {};
  let finalDone = false;
  // lastRightBubble: the most recently rendered right-side bubble (user row,
  // amber L2-injection row, or a non-script purple row) that hasn't yet
  // received its "prompt actually sent because of it" expander. A `sent(N)`
  // frame attaches there and clears it. A script-output purple row is the one
  // deliberate exception: it sets lastRightBubble = null (script source never
  // appears in any prompt), so the NEXT `sent` has nowhere to attach and is
  // dropped silently (spec 2026-07-10-expander-belongs-to-its-own-bubble.md).
  let lastRightBubble = null;
  // `received` arrives BEFORE its `turn` frame (loop yield order) — buffer it
  // here and attach to the model/final bubble once it's built.
  let pendingReceived = null;

  function clearAll() {
    turns = []; lastPromptTokens = null; finalDone = false;
    lastRightBubble = null; pendingReceived = null;
    turnsEl.innerHTML = "";
  }

  function contextChip(usage) {
    if (!usage || usage.prompt_tokens == null) return null;
    const n = usage.prompt_tokens;
    const delta = lastPromptTokens == null ? "—" : `+${n - lastPromptTokens}`;
    lastPromptTokens = n;
    return t('context_chip', { n, delta });
  }

  function onIndex(f) {
    scriptSources = f.script_sources || {};
    chipEl.classList.remove("hidden");
    if (!f.skills.length) {
      // no_skills 對照:估算值是對空索引算的、沒意義 — chip 改顯示對照提示
      chipEl.textContent = t('no_skills_run_note');
      return;
    }
    chipEl.textContent = t('token_cost_chip',
      { proper: f.proper_tokens_est, naive: f.naive_tokens_est });
  }

  function onSent(f) {
    // sent(N).messages is the prompt that produced THIS turn's response — it
    // belongs to whichever right-side bubble caused it, not the model bubble
    // that's about to render for turn N.
    if (lastRightBubble) {
      lastRightBubble.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn: f.turn }),
        BUBBLE.pre(JSON.stringify(f.messages, null, 2)), { align: "right" }));
      lastRightBubble = null;
    }
    // else: no home for this prompt — drop silently. Two ways to get here:
    //   1. it follows the exempt script-output bubble (by design; that bubble
    //      keeps its script source, which no prompt can replace)
    //   2. skill_agent retried an empty content-only turn, which rendered no
    //      right-side bubble — the retry's prompt then has nowhere to hang, so
    //      that answer's expander is missing. Degraded, not broken; rare.
  }

  function onReceived(f) { pendingReceived = f.response; }

  function onTurn(f) {
    const hasCalls = (f.tool_calls || []).length > 0;
    turns.push({ hadTool: hasCalls });
    if (!hasCalls) return;  // content-only turn renders at `final` — keep pendingReceived for it
    const lines = f.tool_calls.map((tc) => {
      const a = (tc.args || "").trim();
      return `⟨tool_call⟩ ${tc.name}(${a === "{}" ? "" : a})`;
    });
    const { row } = BUBBLE.model({
      label: t('model_round_label', { n: f.turn }),
      lines,
      caption: t('calls_tool_caption'),
      chip: contextChip(f.usage),
    });
    row.dataset.turn = String(f.turn);
    // attach the buffered wire view for THIS turn (received preceded us)
    if (pendingReceived) {
      row.appendChild(BUBBLE.details(t('model_raw_summary'),
        BUBBLE.pre(JSON.stringify(pendingReceived, null, 2))));
      pendingReceived = null;
    }
    turnsEl.appendChild(row);
  }

  function onSkillLoaded(f) {
    // 右側琥珀泡泡 — 注入就是 read_file 的「回傳」,跟 tab④ 的紫泡泡同節奏,
    // 琥珀色標出「這一發塞的是說明書」。它自己的按鈕是下一發 sent(N+1),
    // 注入內容就躺在那份 messages 裡(比單看 SKILL.md 全文更接近「注入的現場」)。
    const { row } = BUBBLE.tool({
      label: `📥 ${t('l2_injected_label')} — ${f.name}`,
      body: t('l2_injected_sub'),
      caption: t('inject_back_caption'),
      tone: "inject",
    });
    turnsEl.appendChild(row);
    lastRightBubble = row;   // next sent(N+1) attaches here
  }

  function onL3Loaded(f) {
    const isScript = f.kind === "script_output";
    const { row } = BUBBLE.tool({
      label: isScript ? t('tool_bubble_label', { name: f.filename }) : t('skill_read_file_label'),
      badge: isScript ? t('no_l3_badge') : null,
      body: `${t('tool_returns')} ${f.content}`,
      caption: t('feeds_back_caption'),
    });
    if (isScript) {
      const key = `${f.skill}/${f.filename.replace(/^scripts\//, "")}`;
      if (scriptSources[key]) {
        row.appendChild(BUBBLE.details(t('script_source_summary'),
                                       BUBBLE.pre(scriptSources[key]), { align: "right" }));
      }
      // 唯一例外:腳本原始碼永遠不進 prompt — 不接下一發 sent
      lastRightBubble = null;
    } else {
      lastRightBubble = row;   // non-script read_file: next sent(N+1) attaches here
    }
    turnsEl.appendChild(row);
  }

  function onToolResult(f) {
    const errBox = document.createElement("div");
    errBox.className = BUBBLE.tw.errorBox;
    errBox.textContent = `[error] ${f.result}`;
    turnsEl.appendChild(errBox);
  }

  function onFinal(f) {
    // f.content 空字串 = cancel/stop 的 terminal-final(§3.6)— 只解鎖按鈕,
    // 不畫空的綠泡泡(同 tab4 renderFinal 的 guard)
    if (!finalDone && f.content) {
      const fb = BUBBLE.finalBlock({ caption: t('to_user_caption'), content: f.content });
      // final turn is content-only, so onTurn skipped its wire view — the
      // final turn's `received` is the model's own raw response. Label it
      // to_user_raw_summary like tabs ④⑥'s green block: same position, same
      // data, so the student must not meet two different names for it.
      if (pendingReceived) {
        fb.appendChild(BUBBLE.details(t('to_user_raw_summary'),
          BUBBLE.pre(JSON.stringify(pendingReceived, null, 2))));
        pendingReceived = null;
      }
      turnsEl.appendChild(fb);
      const rounds = turns.length;
      const trips = turns.filter((x) => x.hadTool).length;
      if (rounds) turnsEl.prepend(BUBBLE.banner(
        trips === 0 ? t('trace_summary_notool') : t('trace_summary', { trips, rounds })));
      finalDone = true;
    }
    setRunning(false);
  }

  let running = false;
  function setRunning(on) { running = on; runBtn.classList.toggle("running", on); }

  PANELS["5"] = {
    onDriveStart: (f) => {
      clearAll(); setRunning(true);
      if (f.user != null) promptEl.value = f.user;
      if (f.user) {
        const { row } = BUBBLE.user({ text: f.user });
        turnsEl.appendChild(row);
        lastRightBubble = row;   // sent(1) attaches here
      }
      noSkillsToggle.checked = f.mode === "no_skills";
    },
    onIndex, onSent, onReceived, onTurn, onSkillLoaded, onL3Loaded, onToolResult,
    onFinal,
    onError: (f) => {
      const errBox = document.createElement("div");
      errBox.className = BUBBLE.tw.errorBox;
      errBox.textContent = `[error] ${f.message}`;
      turnsEl.appendChild(errBox);
      setRunning(false);
    },
  };

  function driveSkill() {
    if (!promptEl.value.trim()) return;
    setRunning(true);
    postDrive({ tab: "5", user: promptEl.value,
                mode: noSkillsToggle.checked ? "no_skills" : "proper" })
      .then((r) => { if (!r || !r.ok) setRunning(false); });
  }
  runBtn.addEventListener("click", () => {
    if (running) { postStop(); setRunning(false); }
    else driveSkill();
  });
  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && promptEl.value.trim() && !running) driveSkill();
  });

  // anatomy card (spec 2026-07-08 §2) — static, fetched once at init
  const anatomyEl = panel.querySelector(".skill-anatomy");
  if (anatomyEl) {
    fetch("/inspect", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "5" }),
    }).then((r) => r.json()).then((j) => {
      const CAPTION = { L1: "anatomy_l1_caption", L2: "anatomy_l2_caption", L3: "anatomy_l3_caption" };
      const BADGE = {
        L1: "text-ink-soft border-edge",
        L2: "text-inject border-inject/40 bg-inject-tint",
        L3: "text-tool border-tool/40",
      };
      for (const f of j.files || []) {
        const row = document.createElement("div");
        const label = document.createElement("span");
        label.className = `inline-block rounded border px-1 mr-2 ${BADGE[f.layer]}`;
        label.textContent = f.layer;
        const d = BUBBLE.details(
          f.path + " — " + t(CAPTION[f.layer], { n: Math.round(f.content.length / 4) }),
          BUBBLE.pre(f.content));
        row.append(label, d);
        anatomyEl.appendChild(row);
      }
    }).catch(() => { anatomyEl.textContent = t('anatomy_unavailable'); });
  }
}

// ── Tab ⑥ MCP — 真 stdio JSON-RPC 迷你 server,協定幀可視化 ────────────
function setupMcpTab(panel) {
  const promptEl    = panel.querySelector(".prompt");
  const runBtn      = panel.querySelector(".run");
  const turnsEl     = panel.querySelector(".turns");
  const handshakeEl = panel.querySelector(".handshake");

  let turns = [];
  let finalDone = false;
  // phase:"call" protocol frames stream in BEFORE their turn_complete —
  // buffer them and flush between the blue bubble and the purple results,
  // so reading order matches the causality (model decides → wire call →
  // result).
  let pendingCallCards = [];
  // lastRightBubble: the most recently rendered right-side bubble (user row,
  // or a turn's last purple tool row) that hasn't yet received its "prompt
  // actually sent because of it" expander. turn_complete(N).sent_prompt is
  // that prompt — it attaches HERE, not to the model bubble that triggered it
  // (spec 2026-07-10-expander-belongs-to-its-own-bubble.md).
  let lastRightBubble = null;

  function protocolCard(f) {
    const card = document.createElement("div");
    card.className = "rounded-md bg-surface-2 border border-edge px-3 py-2 font-mono text-xs text-ink-soft";
    const title = document.createElement("div");
    title.className = "font-semibold text-ink";
    title.textContent = f.method;
    const req = document.createElement("div");
    req.className = "truncate";
    req.textContent = `${t('protocol_card_req')} ${JSON.stringify(f.request)}`;
    card.append(title, req);
    if (f.response) {
      const resp = document.createElement("div");
      resp.className = "truncate";
      resp.textContent = `${t('protocol_card_resp')} ${JSON.stringify(f.response)}`;
      card.appendChild(resp);
    }
    card.appendChild(BUBBLE.details(t('protocol_expand'),
      BUBBLE.pre(JSON.stringify({ request: f.request, response: f.response }, null, 2))));
    return card;
  }

  function onProtocol(f) {
    if (f.phase === "handshake") {
      if (handshakeEl.dataset.filled !== "1") {
        handshakeEl.innerHTML = "";
        handshakeEl.dataset.filled = "1";
      }
      handshakeEl.appendChild(protocolCard(f));
    } else {
      pendingCallCards.push(protocolCard(f));   // flushed in onTurnComplete
    }
  }

  function onTurnComplete(f) {
    const hasCalls = (f.tool_calls || []).length > 0;
    turns.push({ hadTool: hasCalls });

    // sent_prompt for THIS turn is what produced this turn's own response —
    // it belongs to whichever right-side bubble caused it (user bubble for
    // turn 1, else the previous turn's last purple tool bubble).
    if (f.sent_prompt && lastRightBubble) {
      lastRightBubble.appendChild(BUBBLE.details(t('sent_prompt_summary', { turn: f.turn }),
                                                  BUBBLE.pre(f.sent_prompt),
                                                  { align: "right" }));
      lastRightBubble = null;
    }

    if (hasCalls) {
      const lines = f.tool_calls.map((tc) => {
        const a = (tc.args || "").trim();
        return `⟨tool_call⟩ ${tc.name}(${a === "{}" ? "" : a})`;
      });
      const { row } = BUBBLE.model({
        label: t('model_round_label', { n: f.turn }),
        lines,
        caption: t('calls_tool_caption'),
      });
      if (f.received_chunk) {
        row.appendChild(BUBBLE.details(t('model_raw_summary'), BUBBLE.pre(f.received_chunk)));
      }
      turnsEl.appendChild(row);
      // flush this turn's wire calls: blue bubble → protocol card(s) → purple results
      for (const card of pendingCallCards) turnsEl.appendChild(card);
      pendingCallCards = [];
      let lastToolRow = null;
      (f.tool_results || []).forEach((tr) => {
        const raw = (tr.result_text || "").trim();
        const looksJson = raw.startsWith("{") || raw.startsWith("[");
        const { row: tRow } = BUBBLE.tool({
          label: t('tool_bubble_label', { name: tr.name }),
          badge: t('mcp_exec_badge'),
          body: `${t('tool_returns')} ${looksJson ? raw : JSON.stringify(raw)}`,
          caption: t('feeds_back_caption'),
        });
        turnsEl.appendChild(tRow);
        lastToolRow = tRow;
      });
      lastRightBubble = lastToolRow;
    } else {
      finalDone = true;
      const fb = BUBBLE.finalBlock({ caption: t('to_user_caption'), content: f.content });
      if (f.received_chunk) {
        fb.appendChild(BUBBLE.details(t('to_user_raw_summary'), BUBBLE.pre(f.received_chunk)));
      }
      turnsEl.appendChild(fb);
    }
  }

  function onFinal(f) {
    if (!finalDone && f.content) {
      turnsEl.appendChild(BUBBLE.finalBlock({ caption: t('to_user_caption'), content: f.content }));
      finalDone = true;
    }
    const rounds = turns.length;
    const trips = turns.filter((x) => x.hadTool).length;
    if (rounds) turnsEl.prepend(BUBBLE.banner(
      trips === 0 ? t('trace_summary_notool') : t('trace_summary', { trips, rounds })));
    setRunning(false);
  }

  let running = false;
  function setRunning(on) { running = on; runBtn.classList.toggle("running", on); }

  PANELS["6"] = {
    onDriveStart: (f) => {
      turns = []; finalDone = false; pendingCallCards = []; lastRightBubble = null;
      turnsEl.innerHTML = "";
      handshakeEl.innerHTML = "";
      handshakeEl.dataset.filled = "0";
      handshakeEl.textContent = t('handshake_empty');
      setRunning(true);
      if (f.user != null) promptEl.value = f.user;
      if (f.user) {
        const { row } = BUBBLE.user({ text: f.user });
        turnsEl.appendChild(row);
        lastRightBubble = row;   // turn 1's sent_prompt attaches here
      }
    },
    onProtocol,
    onTurnComplete,
    onFinal,
    onError: (f) => {
      const errBox = document.createElement("div");
      errBox.className = BUBBLE.tw.errorBox;
      errBox.textContent = `[error] ${f.message}`;
      turnsEl.appendChild(errBox);
      setRunning(false);
    },
  };

  function driveMcp() {
    if (!promptEl.value.trim()) return;
    setRunning(true);
    postDrive({ tab: "6", user: promptEl.value })
      .then((r) => { if (!r || !r.ok) setRunning(false); });
  }
  runBtn.addEventListener("click", () => {
    if (running) { postStop(); setRunning(false); }
    else driveMcp();
  });
  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && promptEl.value.trim() && !running) driveMcp();
  });
}
