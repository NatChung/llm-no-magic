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
  raw_tokens_summary: {
    'en':    'The raw token stream the model emitted this round',
    'zh-TW': '這回合 model 吐的原始 token 流',
  },
  received_summary: {
    'en':    'Received: the raw string the model emitted on this turn',
    'zh-TW': '收到,model 在這 turn 吐的字串(原樣)',
  },
  next_prompt_summary: {
    'en':    'Sent again: the prompt sent to the model after accumulating {turn} turn(s)',
    'zh-TW': '再送出,累積 {turn} turn 後送進下次 model 的 prompt',
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
const PANEL_TO_TAB = { basic: "1", advanced: "2", reasoning: "3", agent: "4" };
const TAB_TO_PANEL = { "1": "basic", "2": "advanced", "3": "reasoning", "4": "agent" };
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

function carryPromptInto(panelName) {
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
    fCaption:   "text-center text-xs font-semibold text-result pt-2 mb-2",
    fBubble:    "rounded-xl bg-result-tint border border-result/15 px-4 py-3.5 text-center text-base md:text-lg leading-relaxed text-ink",
    banner:     "rounded-lg bg-surface-2 border border-edge-soft px-4 py-3 flex items-center gap-3 text-sm text-ink-soft",
    bannerIcon: "w-7 h-7 rounded-full bg-final-tint text-final flex items-center justify-center flex-shrink-0",
    tokensBox:  "mt-1.5 rounded-md bg-surface border border-edge-soft p-3 font-mono text-xs break-all leading-relaxed max-h-48 overflow-auto",
    npDetails:  "mt-1.5 w-full text-left",
    npSummary:  "cursor-pointer text-xs text-muted hover:text-ink-soft py-1 list-none [&::-webkit-details-marker]:hidden before:content-['▸_'] [&[open]]:before:content-['▾_']",
    npPre:      "mt-1.5 rounded-md bg-surface border border-edge-soft p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto text-ink-soft",
    errorBox:   "mt-3 rounded-md bg-surface-2 border border-edge p-3 text-sm font-mono text-ink-soft",
  },
  details(summaryText, contentEl) {
    const details = document.createElement("details");
    details.className = BUBBLE.tw.npDetails;
    const summary = document.createElement("summary");
    summary.className = BUBBLE.tw.npSummary;
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
  tool({ label, badge, body, caption }) {
    const row = document.createElement("div");
    row.className = BUBBLE.tw.tRow;
    const labelEl = document.createElement("div");
    labelEl.className = BUBBLE.tw.tLabel;
    labelEl.textContent = label;
    if (badge) {
      const badgeEl = document.createElement("span");
      badgeEl.className = BUBBLE.tw.tBadge;
      badgeEl.textContent = badge;
      labelEl.appendChild(badgeEl);
    }
    const bubble = document.createElement("div");
    bubble.className = BUBBLE.tw.tBubble;
    bubble.textContent = body;
    row.append(labelEl, bubble);
    if (caption) {
      const cap = document.createElement("div");
      cap.className = BUBBLE.tw.tCaption;
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
      span.className = "tok tok-static";   // reasoning: no probs panel to pop
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
  const previewEl  = panel.querySelector(".final-prompt-preview");
  const runBtn     = panel.querySelector(".run");
  const turnsEl    = panel.querySelector(".turns");
  // Note: Tab ④ 拿掉 probs-area,token 不再 clickable(教學焦點移到 turn-level
  // 累積 prompt,不在 per-token 機率)— renderProbs 仍在 Tab 1-3 用
  // final answer 不再有獨立 section:綠色「給使用者」泡泡直接渲染在 turns 流裡

  // 即時 preview「實際送到 model 的 prompt」— 跟 Tab 2/3 一致(chat template
  // 包好的 text);呼叫 backend /preview,由 llama.cpp /apply-template 算出。
  const AGENT_PREVIEW_URL = "/preview";
  async function refreshPreview() {
    if (!previewEl) return;
    try {
      const res = await fetch(AGENT_PREVIEW_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body:   JSON.stringify({ user: promptEl.value }),
      });
      if (!res.ok) { previewEl.textContent = `[preview HTTP ${res.status}]`; return; }
      const d = await res.json();
      renderPromptPreview(previewEl, d.prompt || "(no prompt)");
    } catch (err) {
      previewEl.textContent = `[preview error] ${err.message}`;
    }
  }
  // Debounce input events 300ms 避免每按一鍵都打 backend
  let previewTimer = null;
  function debouncedRefreshPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 300);
  }
  refreshPreview();
  promptEl.addEventListener("input", debouncedRefreshPreview);

  // Per-turn token storage(避免不同 turn 的 token index 衝突)
  // turns[i] = { tokenSteps: [{token, top_logprobs}, ...], el: HTMLElement, hadTool: bool }
  let turns = [];
  let finalRendered = false;   // final turn 的綠色泡泡是否已渲染

  function clearAll() {
    turns = [];
    finalRendered = false;
    turnsEl.innerHTML = "";
  }

  function makeTokensBox(turn, message_tokens) {
    const box = document.createElement("div");
    box.className = BUBBLE.tw.tokensBox;
    const turnIdx = turns.length;  // 0-based array index for turns[]
    message_tokens.forEach((step, tokIdx) => {
      // `.tok` + `.tok-static` 是 styles.css 邏輯依賴(必留)
      const span = document.createElement("span");
      span.className = "tok tok-static";
      span.dataset.turn = String(turnIdx);
      span.dataset.tokIdx = String(tokIdx);
      span.textContent = step.token;
      span.title = `Turn ${turn} / token ${tokIdx + 1}`;
      box.appendChild(span);
    });
    return box;
  }

  function renderTurnBlock(turn, message_tokens, tool_calls, tool_results, received_chunk, next_prompt) {
    const block = document.createElement("div");
    block.className = BUBBLE.tw.block;
    block.dataset.turn = String(turn);
    const hasToolCalls = (tool_calls || []).length > 0;

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
      if (message_tokens && message_tokens.length) {
        mRow.appendChild(BUBBLE.details(t('raw_tokens_summary'), makeTokensBox(turn, message_tokens)));
      }
      if (received_chunk) {
        mRow.appendChild(BUBBLE.details(t('received_summary'), BUBBLE.pre(received_chunk)));
      }
      block.appendChild(mRow);

      (tool_results || []).forEach((tr, i) => {
        const raw = (tr.result_text || "").trim();
        const looksJson = raw.startsWith("{") || raw.startsWith("[");
        const { row: tRow } = BUBBLE.tool({
          label: t('tool_bubble_label', { name: tr.name }),
          badge: t('local_exec_badge'),
          body: `${t('tool_returns')} ${looksJson ? raw : JSON.stringify(raw)}`,
          caption: t('feeds_back_caption'),
        });
        if (next_prompt && i === tool_results.length - 1) {
          tRow.appendChild(BUBBLE.details(t('next_prompt_summary', { turn }), BUBBLE.pre(next_prompt)));
        }
        block.appendChild(tRow);
      });
    } else {
      // ── final 回合:沒有 tool_call → 綠色全寬「給使用者」 ──
      finalRendered = true;
      const content = (message_tokens || []).map((s) => s.token).join("");
      block.appendChild(BUBBLE.finalBlock({ caption: t('to_user_caption'), content }));
      if (message_tokens && message_tokens.length) {
        block.appendChild(BUBBLE.details(t('raw_tokens_summary'), makeTokensBox(turn, message_tokens)));
      }
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
    refreshPreview();
  }
  function endRun() { setRunning(false); }
  PANELS["4"] = {
    onDriveStart: beginRun,
    onTurnComplete: (f) =>
      renderTurnBlock(f.turn, f.message_tokens, f.tool_calls, f.tool_results, f.received_chunk, f.next_prompt),
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
// agent uses setupAgent; skill uses setupSkill; placeholders (mcp) skip.
// Static-content tabs (no .prompt/.run interactivity → setupPanel skips them):
// - mcp: full article (⑥ MCP)
const PLACEHOLDER_PANELS = new Set(["mcp"]);
document.querySelectorAll(".tab-panel").forEach((panel) => {
  const id = panel.dataset.panel;
  if (PLACEHOLDER_PANELS.has(id)) return;
  if (id === "agent") setupAgent(panel);
  else if (id === "skill") setupSkill(panel);
  else setupPanel(panel);
});


// ── Tab 5: Skill preview ─────────────────────────────────────────────
const SKILL_BACKEND_URL = "/skill-agent";

function setupSkill(panel) {
  const preset = panel.querySelector(".skill-preset");
  const promptEl = panel.querySelector(".skill-prompt");
  const runBtn = panel.querySelector(".skill-run");
  const indexEl = panel.querySelector(".skill-index");
  const toolsEl = panel.querySelector(".skill-tools");
  const turnsEl = panel.querySelector(".skill-turns");
  const finalArea = panel.querySelector(".skill-final-area");
  const finalEl = panel.querySelector(".skill-final");
  const _isZh2 = LANG.toLowerCase().startsWith("zh");

  // Tab ⑤ always runs with skills. To demo "no skills" contrast, reader
  // switches to Tab ④ Agent (raw function-calling agent, no skill layer).
  const mode = "proper";
  let abortCtl = null;

  preset.addEventListener("change", () => {
    if (preset.value) promptEl.value = preset.value;
  });

  const _isZh = LANG.toLowerCase().startsWith("zh");

  function reset() {
    indexEl.innerHTML = "";
    toolsEl.textContent = _isZh ? "(尚未啟動)" : "(not yet started)";
    turnsEl.innerHTML = "";
    finalArea.classList.add("hidden");
    finalEl.textContent = "";
  }

  let _scriptSources = {};

  function renderIndex(skills) {
    indexEl.innerHTML = "";
    indexEl.className = "divide-y divide-edge-soft -mt-2";  // override outer space-y-2
    for (const s of skills) {
      const card = document.createElement("div");
      card.className = "py-3 text-xs space-y-1";
      const extras = (s.extras || []);
      const scripts = (s.scripts || []);
      let html = `
        <div class="font-medium text-ink-soft text-sm">${s.name}</div>
        <div class="text-muted leading-relaxed">${s.description}</div>
        <div class="text-faint text-[10px] font-mono">${s.dir}/</div>
      `;
      if (extras.length || scripts.length) {
        html += `<div class="pt-1 space-y-1">`;
        if (extras.length) {
          const ext = extras.map(e => `<code class="text-ink-soft">${e}</code>`).join(" · ");
          html += `<div class="text-muted">docs:&nbsp; ${ext}</div>`;
        }
        if (scripts.length) {
          html += `<div class="text-muted">scripts:`;
          for (const script of scripts) {
            const code = _scriptSources[`${s.name}/${script}`] || "(source not loaded)";
            html += `
              <details class="mt-0.5 ml-12">
                <summary class="cursor-pointer text-tool font-mono inline-block -ml-12">${script}</summary>
                <pre class="text-[10px] mt-1 p-2 bg-surface-2 rounded whitespace-pre-wrap overflow-auto max-h-60 text-ink-soft">${escape(code)}</pre>
                <p class="text-[10px] text-faint mt-0.5">human view — model 只看 stdout、不看 source</p>
              </details>
            `;
          }
          html += `</div>`;
        }
        html += `</div>`;
      }
      card.innerHTML = html;
      indexEl.appendChild(card);
    }
  }

  function renderMessageRow(m) {
    // De-nested, no card, no role bg — role as small label + indent.
    // Keeps the established anchor colors (tool 紫 / result 綠) only on
    // the actual tool_call line per the cross-tab visual vocabulary.
    let body = "";
    if (m.content) {
      body += `<pre class="text-xs whitespace-pre-wrap text-ink-soft leading-relaxed">${escape(m.content)}</pre>`;
    }
    if (m.tool_calls && m.tool_calls.length) {
      for (const tc of m.tool_calls) {
        body += `<div class="text-xs font-mono text-tool mt-1">↑ ${tc.function.name}(${escape(tc.function.arguments)})</div>`;
      }
    }
    if (m.tool_call_id) {
      body += `<div class="text-[10px] text-faint mt-0.5">tool_call_id: ${escape(m.tool_call_id)}</div>`;
    }
    return `<div class="py-2">
      <div class="text-[10px] uppercase tracking-wider font-medium text-faint mb-1">${m.role}</div>
      <div class="pl-3">${body || '<span class="text-faint text-xs">(empty)</span>'}</div>
    </div>`;
  }

  function renderTools(tools) {
    toolsEl.innerHTML = tools.map((t) => `<code class="inline-block bg-surface px-1.5 py-0.5 rounded border border-edge-soft mr-1">${t}</code>`).join("");
  }

  function ensureTurnHeader(turnNum) {
    let wrap = turnsEl.querySelector(`[data-turn="${turnNum}"]`);
    if (wrap) return wrap.querySelector(".turn-body");
    wrap = document.createElement("div");
    wrap.className = "rounded-md border border-edge-soft overflow-hidden";
    wrap.dataset.turn = turnNum;
    wrap.innerHTML = `
      <div class="px-3 py-1.5 bg-surface-2 text-xs uppercase tracking-wider text-muted font-medium">Turn ${turnNum}</div>
      <div class="turn-body p-3 space-y-2 text-sm"></div>
    `;
    turnsEl.appendChild(wrap);
    return wrap.querySelector(".turn-body");
  }

  function appendToTurn(turnNum, html) {
    const body = ensureTurnHeader(turnNum);
    const div = document.createElement("div");
    div.innerHTML = html;
    body.appendChild(div);
  }

  function escape(s) {
    return String(s).replace(/[&<>]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"})[c]);
  }

  let running = false;
  function setRunning(on) { running = on; runBtn.classList.toggle("running", on); }
  async function run() {
    if (!promptEl.value.trim()) return;
    reset();

    setRunning(true);
    abortCtl = new AbortController();

    let currentTurn = 0;
    try {
      const resp = await fetch(SKILL_BACKEND_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({mode, user: promptEl.value}),
        signal: abortCtl.signal,
      });
      if (!resp.ok) throw new Error(`backend HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buf += decoder.decode(value, {stream: true});
        const lines = buf.split("\n\n");
        buf = lines.pop();
        for (const block of lines) {
          if (!block.startsWith("data: ")) continue;
          const evt = JSON.parse(block.slice(6));

          if (evt.type === "index") {
            _scriptSources = evt.script_sources || {};
            renderIndex(evt.skills);
          } else if (evt.type === "tools_exposed") {
            renderTools(evt.tools);
            if (evt.turn > 0) appendToTurn(evt.turn, `<div class="text-xs text-muted">↻ tools now exposed: <span class="font-mono">${evt.tools.join(", ")}</span></div>`);
          } else if (evt.type === "sent") {
            currentTurn = evt.turn;
            const rows = evt.messages.map(renderMessageRow).join("");
            const rawJson = JSON.stringify(evt.messages, null, 2);
            appendToTurn(evt.turn, `
              <details class="border border-edge-soft rounded">
                <summary class="cursor-pointer text-xs text-muted px-2 py-1 font-medium">📤 Sent to model (${evt.messages.length} messages, tools=[${evt.tools.join(", ")}])</summary>
                <div class="px-2 divide-y divide-edge-soft">
                  ${rows}
                  <details class="py-1.5">
                    <summary class="cursor-pointer text-[10px] text-faint">raw JSON</summary>
                    <pre class="text-[10px] mt-1 p-2 bg-surface-2 rounded whitespace-pre-wrap max-h-80 overflow-auto text-ink-soft">${escape(rawJson)}</pre>
                  </details>
                </div>
              </details>
            `);
            // loading indicator while waiting for llama (the slow part)
            appendToTurn(evt.turn, `
              <div data-loading-turn="${evt.turn}" class="flex items-center gap-2 text-xs text-muted pl-1">
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-final animate-pulse"></span>
                <span>${_isZh2 ? "model 思考中…" : "model thinking…"}</span>
              </div>
            `);
          } else if (evt.type === "received") {
            currentTurn = evt.turn;
            // remove the per-turn loading indicator
            const loadingEl = panel.querySelector(`[data-loading-turn="${evt.turn}"]`);
            if (loadingEl) loadingEl.remove();
            const choice = (evt.response.choices || [{}])[0];
            const reply = choice.message || {};
            const finish = choice.finish_reason;
            const usage = evt.response.usage || {};
            const replyRow = renderMessageRow(reply);
            const metaLine = `<div class="text-[10px] text-faint py-1.5">finish_reason: <code>${finish || "—"}</code> · usage: prompt=${usage.prompt_tokens ?? "?"}, completion=${usage.completion_tokens ?? "?"}, total=${usage.total_tokens ?? "?"}</div>`;
            const rawJson = JSON.stringify(evt.response, null, 2);
            appendToTurn(evt.turn, `
              <details class="border border-edge-soft rounded">
                <summary class="cursor-pointer text-xs text-muted px-2 py-1 font-medium">📥 Received from model</summary>
                <div class="px-2 divide-y divide-edge-soft">
                  ${replyRow}
                  ${metaLine}
                  <details class="py-1.5">
                    <summary class="cursor-pointer text-[10px] text-faint">raw JSON (含 id / object / system_fingerprint 等 metadata)</summary>
                    <pre class="text-[10px] mt-1 p-2 bg-surface-2 rounded whitespace-pre-wrap max-h-80 overflow-auto text-ink-soft">${escape(rawJson)}</pre>
                  </details>
                </div>
              </details>
            `);
          } else if (evt.type === "turn") {
            currentTurn = evt.turn;
            if (evt.content) {
              appendToTurn(evt.turn, `<div><span class="text-xs uppercase tracking-wider text-muted">Assistant:</span> <span class="text-ink whitespace-pre-wrap">${escape(evt.content)}</span></div>`);
            }
            for (const tc of (evt.tool_calls || [])) {
              const isLoad = tc.name === "load_skill";
              const cls = isLoad ? "text-final" : "text-tool";
              appendToTurn(evt.turn, `<div class="font-mono text-xs"><span class="${cls}">↑ ${tc.name}</span>(<span class="text-ink-soft">${escape(tc.args)}</span>)</div>`);
            }
          } else if (evt.type === "skill_loaded") {
            appendToTurn(currentTurn, `
              <details class="rounded bg-final-tint p-2 border border-final/20">
                <summary class="cursor-pointer text-xs text-final font-medium">📄 L2 SKILL.md body loaded: <code>${evt.name}</code> (${evt.body.length} chars)</summary>
                <pre class="mt-2 text-xs whitespace-pre-wrap text-ink-soft">${escape(evt.body)}</pre>
              </details>
            `);
          } else if (evt.type === "l3_loaded") {
            const kindLabel = evt.kind === "script_output"
              ? `🛠 L3 script executed: <code>${evt.skill}/${evt.filename}</code>${evt.args ? ` <span class="text-faint">args: ${escape(evt.args)}</span>` : ""} <span class="text-faint">(code not in context)</span>`
              : `📑 L3 reference loaded: <code>${evt.skill}/${evt.filename}</code> (${evt.content.length} chars)`;
            appendToTurn(currentTurn, `
              <details class="rounded bg-result-tint p-2 border border-result/20">
                <summary class="cursor-pointer text-xs text-result font-medium">${kindLabel}</summary>
                <pre class="mt-2 text-xs whitespace-pre-wrap text-ink-soft">${escape(evt.content)}</pre>
              </details>
            `);
          } else if (evt.type === "tool_result") {
            const errCls = evt.error ? "text-tool" : "text-result";
            appendToTurn(currentTurn, `<div class="font-mono text-xs"><span class="${errCls}">↓ ${evt.name}</span> → <span class="text-ink-soft whitespace-pre-wrap">${escape(evt.result)}</span></div>`);
          } else if (evt.type === "final") {
            finalArea.classList.remove("hidden");
            finalEl.textContent = evt.content;
          } else if (evt.type === "error") {
            appendToTurn(currentTurn || 1, `<div class="text-tool text-xs">ERROR: ${escape(evt.message)}</div>`);
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error(err);
        appendToTurn(currentTurn || 1, `<div class="text-tool text-xs">FETCH ERROR: ${escape(err.message)}</div>`);
      }
    } finally {
      setRunning(false);
      abortCtl = null;
    }
  }

  runBtn.addEventListener("click", () => {
    if (running) abortCtl?.abort();   // 生成中:按 = 中止 SSE
    else run();
  });
  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      run();
    }
  });
}
