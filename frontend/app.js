// ─────────────────────────────────────────────────────────────────────
// LLM 課 frontend — 2 tabs(基礎 / 產品加工),各自獨立 state
// ─────────────────────────────────────────────────────────────────────

// ── i18n: language is taken from <html lang>;預設 en,zh-TW fallback ──
const LANG = document.documentElement.lang || 'en';
const I18N = {
  swap_failed: {
    'en':    'Model swap failed: {err}\n\nManual fallback: SETUP.md "Fri AM check"',
    'zh-TW': '切換 model 失敗:{err}\n\n手動補救:SETUP.md "Fri AM check"',
  },
  tok_title: {
    'en':    'Generated token #{n} — click to see its distribution',
    'zh-TW': '第 {n} 個生成 token — 點看當下分布',
  },
  cjk_guard_log: {
    'en':    '[llama.cpp guard] single CJK char "{ch}" — appending trailing space',
    'zh-TW': '[llama.cpp guard] 單 CJK 字 "{ch}" 補尾空格',
  },
  turn_subtitle_more: {
    'en':    'The whole turn (model output plus tool results) accumulates into messages and is sent to the model next turn',
    'zh-TW': '整個 turn(model 吐的字 加上 tool 結果)累積進 messages,送進下次 model',
  },
  turn_subtitle_final: {
    'en':    'This is the final turn — model did not tool_call again, done',
    'zh-TW': '這是 final turn,model 沒再 tool_call,結束了',
  },
  tool_call_label: {
    'en':    'Tool call',
    'zh-TW': '工具呼叫',
  },
  tool_call_sub: {
    'en':    'parsed from the tokens the model emitted, handed off to the client to run',
    'zh-TW': 'model 從吐的 token 解析出來,交給 client 跑',
  },
  tool_result_label: {
    'en':    'Tool result',
    'zh-TW': '工具結果',
  },
  tool_result_sub: {
    'en':    'the return value the client actually ran, fed back into messages for the next turn',
    'zh-TW': 'client 真執行的回傳,會塞回 messages 給下次 model',
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

// llama-server is a separate C++ process, fixed at :8080. Frontend HTML
// + API are now the same Python server (default :9000 served by
// agent/server.py), so API endpoints are same-origin relative paths.
// _HOST stays for llama-server URL (host taken from page → LAN-friendly).
const _HOST = window.location.hostname;

const LLAMA_URL = `http://${_HOST}:8080/completion`;

const AGENT_BACKEND_URL = "/agent";

// ── /swap orchestrator(spec §5)──────────────────────────────────────
const SWAP_URL = "/swap";
const TAB_TO_MODEL = {
  basic:     "0.6B",
  advanced:  "0.6B",
  reasoning: "0.6B",
  agent:     "4B",
  // commands tab is pure static article (no model swap needed)
  skill:     "4B",  // ⑥ Skill preview — function calling needs 4B
};
let currentLLMModel = null;

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

async function ensureModel(wanted) {
  if (currentLLMModel === wanted) return;
  showSwapBanner(wanted);
  try {
    const r = await fetch(SWAP_URL, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body:   JSON.stringify({model: wanted}),
    });
    const d = await r.json().catch(() => ({status: "error", message: "non-JSON response"}));
    if (!r.ok || d.status !== "ready") {
      throw new Error(d.message || `swap failed (HTTP ${r.status})`);
    }
    currentLLMModel = d.model;
    console.log(`[swap] ready: ${d.model} (${d.took_ms}ms, skipped=${d.skipped})`);
  } catch (err) {
    console.error("[swap] failed", err);
    alert(t('swap_failed', {err: err.message}));
    throw err;
  } finally {
    hideSwapBanner();
  }
}

// 預填的 system prompt — 跟 agent.py SYSTEM_PROMPT 逐字相符(canonical 源 = agent.py)
// 改這個常數 = 也要改 agent.py SYSTEM_PROMPT,反之亦然
const AGENT_DEFAULT_SYSTEM = (
  "You are a helpful assistant with access to tools (get_time, read_file, " +
  "write_file, exec_bash). Use them when relevant — call get_time for time " +
  "questions, read_file to read files, write_file to create or modify files, " +
  "exec_bash to run shell commands. Always call tools first, don't guess. " +
  "Answer in 繁體中文 when the user writes Chinese."
);

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

// ── Tab switching ────────────────────────────────────────────────────
// 切 tab 前先確保 :8080 上是正確的 model(spec §5);swap 失敗就不切 tab。
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const id = btn.dataset.tab;
    const wanted = TAB_TO_MODEL[id];

    if (wanted) {
      try {
        await ensureModel(wanted);
      } catch (err) {
        return;  // swap 失敗 → tab 不切,user 從 alert 知道有問題
      }
    }

    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.dataset.panel === id);
    });
  });
});

// ── Per-panel setup (closure pattern,每 tab 自己一份 state)──────────
function setupPanel(panel) {
  const promptEl  = panel.querySelector(".prompt");
  const runBtn    = panel.querySelector(".run");
  const stopBtn   = panel.querySelector(".stop");
  const textEl    = panel.querySelector(".generated-text");
  const probsEl   = panel.querySelector(".probs");
  const systemEl  = panel.querySelector(".system-prompt");           // 只有 advanced panel 有
  const previewEl = panel.querySelector(".final-prompt-preview");    // 只有 advanced / reasoning panel 有
  const thinkingArea = panel.querySelector(".thinking-area");        // 只有 reasoning panel 有
  const thinkingContentEl = panel.querySelector(".thinking-content");
  const panelType = panel.dataset.panel;  // 'basic' | 'advanced' | 'reasoning'

  let tokenSteps = [];
  let abortCtl = null;
  // phase state for reasoning mode: "pre_think" → "in_think" → "in_answer"
  // tokens route to thinking-content while "in_think", else to generated-text
  let phase = "pre_think";

  function buildFinalPrompt() {
    if (panelType === "basic") return promptEl.value;
    const sys  = (systemEl?.value || "").trim();
    const user = promptEl.value;
    const sysBlock = sys ? `<|im_start|>system\n${sys}<|im_end|>\n` : "";
    const chatBase = sysBlock + `<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n`;

    if (panelType === "advanced") {
      const mode = panel.querySelector('input[name="mode-advanced"]:checked')?.value || "raw";
      if (mode === "raw") return user;
      // 加工模式預設跳 thinking(乾淨答案)
      return chatBase + `<think>\n\n</think>\n\n`;
    }
    if (panelType === "reasoning") {
      const mode = panel.querySelector('input[name="mode-reasoning"]:checked')?.value || "direct";
      // direct = 跳 thinking;thinking = 保留(讓 model 自己想)
      return mode === "direct" ? chatBase + `<think>\n\n</think>\n\n` : chatBase;
    }
    return user;
  }

  // Reasoning mode 需要更多 token 給 model 想 + 答
  // reasoning: Qwen3 thinking can be 600-1500 tokens before </think>; was 300 too small
  // (with 300 the model never closed </think> on the apple problem,
  //  phase stuck in "in_think", final answer area stayed empty)
  const nPredict = panelType === "reasoning" ? 1500 : 80;

  function refreshPreview() {
    if (previewEl) previewEl.textContent = buildFinalPrompt();
  }

  function appendClickableToken(stepIdx, token, target) {
    const span = document.createElement("span");
    span.className = "tok";
    span.dataset.step = String(stepIdx);
    span.textContent = token;
    span.title = t('tok_title', {n: stepIdx + 1});
    span.addEventListener("click", () => {
      const s = tokenSteps[stepIdx];
      if (!s) return;
      renderProbs(probsEl, s.top_logprobs);
      highlightStep(stepIdx);
    });
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
  }

  async function runCompletion() {
    abortCtl = new AbortController();
    runBtn.disabled = true; stopBtn.disabled = false;
    textEl.textContent = ""; probsEl.innerHTML = "";
    tokenSteps = [];

    // detect thinking mode (reasoning panel only)
    const isThinkingMode = panelType === "reasoning" &&
      panel.querySelector('input[name="mode-reasoning"]:checked')?.value === "thinking";
    // direct mode: no <think> emitted, all tokens are final answer → start in "in_answer"
    phase = isThinkingMode ? "pre_think" : "in_answer";
    if (thinkingContentEl) thinkingContentEl.textContent = "";
    if (thinkingArea) thinkingArea.classList.toggle("hidden", !isThinkingMode);

    const finalPrompt = buildFinalPrompt();

    // llama.cpp Qwen3-0.6B tokenizer 對單個 CJK 字 prompt throw 500 — 自動補尾空格
    let safePrompt = finalPrompt;
    if (finalPrompt.length === 1 && finalPrompt.charCodeAt(0) > 127) {
      safePrompt = finalPrompt + " ";
      console.info(t('cjk_guard_log', {ch: finalPrompt}));
    }

    let res;
    try {
      res = await fetch(LLAMA_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          prompt: safePrompt,
          n_predict: nPredict,
          n_probs: 10,
          stream: true,
          temperature: 0,  // greedy
        }),
        signal: abortCtl.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") textEl.textContent += "\n[stopped]";
      else { textEl.textContent = `[fetch error] ${err.message}`; console.error(err); }
      runBtn.disabled = false; stopBtn.disabled = true;
      return;
    }

    if (!res.ok) {
      textEl.textContent = `[server error] HTTP ${res.status} ${res.statusText}`;
      runBtn.disabled = false; stopBtn.disabled = true;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buf += decoder.decode(value, {stream: true});
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const ln of lines) {
          if (!ln.startsWith("data: ")) continue;
          let data;
          try { data = JSON.parse(ln.slice(6)); }
          catch (e) { console.warn("JSON parse err", ln); continue; }
          if (data.completion_probabilities && data.completion_probabilities[0]) {
            const step = data.completion_probabilities[0];
            const stepIdx = tokenSteps.length;
            tokenSteps.push({token: step.token, top_logprobs: step.top_logprobs});

            // LEFT (complete-response, thinking-content) — gets every token in
            // thinking mode (always-clickable, models the real stream).
            // RIGHT (final-answer, textEl) — gets only post-</think> tokens
            // (i.e. what the user actually sees).
            // <think> / </think> are single Qwen3 tokens; marker goes to LEFT only.
            const trim = step.token.replace(/[\s\n]/g, "");

            // LEFT: in thinking mode, every token goes here
            if (isThinkingMode) {
              appendClickableToken(stepIdx, step.token, thinkingContentEl);
            }

            // Phase transitions on markers (thinking mode only — direct mode
            // starts at "in_answer" and stays there)
            if (isThinkingMode && trim === "<think>") {
              phase = "in_think";
            } else if (isThinkingMode && trim === "</think>") {
              phase = "in_answer";
            } else if (phase === "in_answer") {
              // RIGHT: tokens that are part of the final answer (mirrors
              // LEFT post-</think>, OR in direct mode = the only output)
              appendClickableToken(stepIdx, step.token, textEl);
            }
            if (stepIdx === 0) {
              renderProbs(probsEl, step.top_logprobs);
              highlightStep(0);
            }
          } else if (data.content !== undefined && !data.stop) {
            textEl.appendChild(document.createTextNode(data.content));
          }
          if (data.stop) break;
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("stream read err", err);
        textEl.textContent += `\n[stream error] ${err.message}`;
      } else textEl.textContent += "\n[stopped]";
    }

    runBtn.disabled = false; stopBtn.disabled = true;
  }

  // ── Wire events ────────────────────────────────────────────────────
  runBtn.addEventListener("click", () => {
    if (!promptEl.value.trim()) return;
    runCompletion();
  });
  stopBtn.addEventListener("click", () => abortCtl?.abort());

  // Ctrl/Cmd+Enter submit
  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      if (!promptEl.value.trim() || runBtn.disabled) return;
      runCompletion();
    }
  });

  // Preset dropdown(目前只 Tab ① basic 有;Tab 2/3 用 mode radio 不用 preset)
  const presetEl = panel.querySelector(".preset-select");
  if (presetEl) {
    presetEl.addEventListener("change", () => {
      if (presetEl.value) {
        promptEl.value = presetEl.value;
        presetEl.selectedIndex = 0;  // reset 讓 user 可重選同 preset
        // Tab 2/3 才有 preview,basic 沒;先 guard
        if (panelType !== "basic" && previewEl) refreshPreview();
      }
    });
  }

  // Advanced / Reasoning panel:live preview update
  if (panelType !== "basic") {
    const updatePreview = () => refreshPreview();
    promptEl.addEventListener("input", updatePreview);
    systemEl?.addEventListener("input", updatePreview);
    panel.querySelectorAll(`input[name="mode-${panelType}"]`).forEach((r) =>
      r.addEventListener("change", updatePreview)
    );
    refreshPreview();  // initial render
  }
}

// ── Tab ④ Agent — 真執行 tool,SSE per-turn render ─────────────────────
function setupAgent(panel) {
  const systemEl   = panel.querySelector(".system-prompt");
  const promptEl   = panel.querySelector(".prompt");
  const presetEl   = panel.querySelector(".preset-select");
  const previewEl  = panel.querySelector(".final-prompt-preview");
  const runBtn     = panel.querySelector(".run");
  const stopBtn    = panel.querySelector(".stop");
  const turnsEl    = panel.querySelector(".turns");
  const finalEl    = panel.querySelector(".final-content");
  // Note: Tab ④ 拿掉 probs-area,token 不再 clickable(教學焦點移到 turn-level
  // 累積 prompt,不在 per-token 機率)— renderProbs 仍在 Tab 1-3 用

  // 預填 system prompt
  if (!systemEl.value) systemEl.value = AGENT_DEFAULT_SYSTEM;

  // 即時 preview「實際送到 model 的 prompt」— 跟 Tab 2/3 一致(chat template
  // 包好的 text);呼叫 backend /preview,由 llama.cpp /apply-template 算出。
  const AGENT_PREVIEW_URL = "/preview";
  async function refreshPreview() {
    if (!previewEl) return;
    try {
      const res = await fetch(AGENT_PREVIEW_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body:   JSON.stringify({
          system: systemEl.value || AGENT_DEFAULT_SYSTEM,
          user:   promptEl.value,
        }),
      });
      if (!res.ok) { previewEl.textContent = `[preview HTTP ${res.status}]`; return; }
      const d = await res.json();
      previewEl.textContent = d.prompt || "(no prompt)";
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
  systemEl.addEventListener("input", debouncedRefreshPreview);
  promptEl.addEventListener("input", debouncedRefreshPreview);

  // Per-turn token storage(避免不同 turn 的 token index 衝突)
  // turns[i] = { tokenSteps: [{token, top_logprobs}, ...], el: HTMLElement }
  let turns = [];
  let abortCtl = null;

  function clearAll() {
    turns = [];
    turnsEl.innerHTML = "";
    finalEl.innerHTML = "";
  }

  // ── Tailwind utility class strings,集中管理(spec §5 帶 .turn-block / .tok
  //     等必留 class 給 CSS,其餘全 utility,no side-stripe border) ──
  const TW = {
    block:         "turn-block rounded-lg bg-surface-2 border border-edge-soft px-4 py-3 md:px-5 md:py-4",
    header:        "flex justify-between items-start gap-3 mb-2",
    titleGroup:    "flex flex-col md:flex-row md:items-baseline md:gap-3 min-w-0",
    title:         "text-base font-semibold text-ink",
    subtitle:      "text-xs text-muted font-normal mt-0.5 md:mt-0 leading-snug",
    collapseBtn:   "text-xs px-2 py-1 rounded border border-edge text-muted hover:text-ink-soft hover:bg-surface transition-colors flex-shrink-0 font-mono",
    tokensBox:     "rounded-md bg-surface border border-edge-soft p-3 my-3 font-mono text-sm break-all leading-relaxed",
    toolCallBox:   "rounded-md bg-tool-tint p-3 my-2",
    toolCallHead:  "text-sm font-semibold text-tool flex items-baseline gap-1.5 flex-wrap",
    toolCallSub:   "text-muted font-normal text-xs",
    toolCallBody:  "mt-1.5 font-mono text-sm break-all text-ink",
    toolResultBox: "rounded-md bg-result-tint p-3 my-2",
    toolResultHead:"text-sm font-semibold text-result flex items-baseline gap-1.5 flex-wrap",
    toolResultSub: "text-muted font-normal text-xs",
    toolResultBody:"mt-1.5 font-mono text-xs bg-surface border border-edge-soft p-2.5 rounded max-h-48 overflow-auto whitespace-pre-wrap break-all text-ink-soft",
    npDetails:     "mt-2",
    npSummary:     "cursor-pointer text-xs text-muted hover:text-ink-soft py-1 list-none [&::-webkit-details-marker]:hidden before:content-['▸_'] [&[open]]:before:content-['▾_']",
    npPre:         "mt-1.5 rounded-md bg-surface border border-edge-soft p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto text-ink-soft",
    errorBox:      "mt-3 rounded-md bg-surface-2 border border-edge p-3 text-sm font-mono text-ink-soft",
  };

  function renderTurnBlock(turn, message_tokens, tool_calls, tool_results, received_chunk, next_prompt) {
    const block = document.createElement("div");
    block.className = TW.block;
    block.dataset.turn = String(turn);

    // Turn header(title + subtitle 對齊 baseline,collapse btn 在右)
    const header = document.createElement("div");
    header.className = TW.header;
    const titleSpan = document.createElement("span");
    titleSpan.className = TW.title;
    titleSpan.textContent = `Turn ${turn}`;
    const subtitleSpan = document.createElement("span");
    subtitleSpan.className = TW.subtitle;
    const hasNextTurn = (tool_calls || []).length > 0;
    subtitleSpan.textContent = hasNextTurn
      ? t('turn_subtitle_more')
      : t('turn_subtitle_final');
    const collapseBtn = document.createElement("button");
    collapseBtn.className = TW.collapseBtn;
    collapseBtn.textContent = "▼ collapse";
    collapseBtn.addEventListener("click", () => {
      block.classList.toggle("collapsed");
      collapseBtn.textContent = block.classList.contains("collapsed") ? "▶ expand" : "▼ collapse";
    });
    const titleGroup = document.createElement("div");
    titleGroup.className = TW.titleGroup;
    titleGroup.append(titleSpan, subtitleSpan);
    header.append(titleGroup, collapseBtn);
    block.appendChild(header);

    // Token sequence — `.tok` + `.tok-static` 是 styles.css 邏輯依賴(必留)
    if (message_tokens && message_tokens.length) {
      const tokensBox = document.createElement("div");
      tokensBox.className = TW.tokensBox;
      const turnIdx = turns.length;  // 0-based array index for turns[]
      message_tokens.forEach((step, tokIdx) => {
        const span = document.createElement("span");
        span.className = "tok tok-static";
        span.dataset.turn = String(turnIdx);
        span.dataset.tokIdx = String(tokIdx);
        span.textContent = step.token;
        span.title = `Turn ${turn} / token ${tokIdx + 1}`;
        tokensBox.appendChild(span);
      });
      block.appendChild(tokensBox);
    }

    // tool_calls — 紫色 bg tint(非 side-stripe),↑ 上行 icon
    for (const tc of (tool_calls || [])) {
      const tcBox = document.createElement("div");
      tcBox.className = TW.toolCallBox;
      const tcHead = document.createElement("div");
      tcHead.className = TW.toolCallHead;
      const tcArrow = document.createElement("span");
      tcArrow.setAttribute("aria-hidden", "true");
      tcArrow.textContent = "↑";
      const tcLabel = document.createElement("span");
      tcLabel.textContent = t('tool_call_label');
      const tcSub = document.createElement("span");
      tcSub.className = TW.toolCallSub;
      tcSub.textContent = t('tool_call_sub');
      tcHead.append(tcArrow, tcLabel, tcSub);
      const tcBody = document.createElement("div");
      tcBody.className = TW.toolCallBody;
      tcBody.textContent = `${tc.name}(${tc.args})`;
      tcBox.append(tcHead, tcBody);
      block.appendChild(tcBox);
    }

    // tool_results — 綠色 bg tint(非 side-stripe),↓ 下行 icon
    for (const tr of (tool_results || [])) {
      const trBox = document.createElement("div");
      trBox.className = TW.toolResultBox;
      const trHead = document.createElement("div");
      trHead.className = TW.toolResultHead;
      const trArrow = document.createElement("span");
      trArrow.setAttribute("aria-hidden", "true");
      trArrow.textContent = "↓";
      const trLabel = document.createElement("span");
      trLabel.textContent = t('tool_result_label');
      const trSub = document.createElement("span");
      trSub.className = TW.toolResultSub;
      trSub.textContent = t('tool_result_sub');
      trHead.append(trArrow, trLabel, trSub);
      const trBody = document.createElement("pre");
      trBody.className = TW.toolResultBody;
      trBody.textContent = tr.result_text;
      trBox.append(trHead, trBody);
      block.appendChild(trBox);
    }

    // 兩個 details — 收到 / 再送出 (各自獨立 toggle)
    if (received_chunk) {
      const rcDetails = document.createElement("details");
      rcDetails.className = TW.npDetails;
      const rcSummary = document.createElement("summary");
      rcSummary.className = TW.npSummary;
      rcSummary.textContent = t('received_summary');
      const rcPre = document.createElement("pre");
      rcPre.className = TW.npPre;
      rcPre.textContent = received_chunk;
      rcDetails.append(rcSummary, rcPre);
      block.appendChild(rcDetails);
    }
    if (next_prompt) {
      const npDetails = document.createElement("details");
      npDetails.className = TW.npDetails;
      const npSummary = document.createElement("summary");
      npSummary.className = TW.npSummary;
      npSummary.textContent = t('next_prompt_summary', {turn});
      const npPre = document.createElement("pre");
      npPre.className = TW.npPre;
      npPre.textContent = next_prompt;
      npDetails.append(npSummary, npPre);
      block.appendChild(npDetails);
    }

    turnsEl.appendChild(block);
    turns.push({
      tokenSteps: message_tokens || [],
      el:         block,
    });
  }

  function renderFinal(content) {
    finalEl.textContent = content || "(no final content)";
  }

  function renderError(msg) {
    const errBox = document.createElement("div");
    errBox.className = TW.errorBox;
    errBox.textContent = `[error] ${msg}`;
    finalEl.appendChild(errBox);
  }

  async function runAgent() {
    clearAll();
    abortCtl = new AbortController();
    runBtn.disabled = true; stopBtn.disabled = false;

    let res;
    try {
      res = await fetch(AGENT_BACKEND_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body:   JSON.stringify({
          system: systemEl.value,
          user:   promptEl.value,
        }),
        signal: abortCtl.signal,
      });
    } catch (err) {
      if (err.name !== "AbortError") renderError(`fetch failed: ${err.message}`);
      runBtn.disabled = false; stopBtn.disabled = true;
      return;
    }
    if (!res.ok) {
      renderError(`HTTP ${res.status} ${res.statusText}`);
      runBtn.disabled = false; stopBtn.disabled = true;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buf += decoder.decode(value, {stream: true});
        const frames = buf.split("\n\n");
        buf = frames.pop();
        for (const fr of frames) {
          if (!fr.startsWith("data: ")) continue;
          let evt;
          try { evt = JSON.parse(fr.slice(6)); }
          catch (e) { console.warn("bad frame", fr); continue; }
          if (evt.type === "turn_complete") {
            renderTurnBlock(evt.turn, evt.message_tokens, evt.tool_calls, evt.tool_results, evt.received_chunk, evt.next_prompt);
          } else if (evt.type === "final") {
            renderFinal(evt.content);
          } else if (evt.type === "error") {
            renderError(evt.message);
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") renderError(`stream: ${err.message}`);
    }
    runBtn.disabled = false; stopBtn.disabled = true;
  }

  presetEl.addEventListener("change", () => {
    if (presetEl.value) {
      promptEl.value = presetEl.value;
      presetEl.selectedIndex = 0;  // reset so user can pick same preset again
      refreshPreview();             // programmatic .value 不會 trigger input event,手動 refresh
    }
  });

  runBtn.addEventListener("click", () => {
    if (!promptEl.value.trim()) return;
    runAgent();
  });
  stopBtn.addEventListener("click", () => abortCtl?.abort());
}

// Initial page load:確保當前 active tab 的 model 已 loaded
window.addEventListener("DOMContentLoaded", () => {
  const active = document.querySelector(".tab.active");
  if (active) {
    const wanted = TAB_TO_MODEL[active.dataset.tab];
    if (wanted) ensureModel(wanted).catch(() => {});
  }
});

// Initialize panels — basic/advanced/reasoning go through setupPanel;
// agent uses setupAgent; skill uses setupSkill; placeholders (script/api/mcp) skip.
// Static-content tabs (no .prompt/.run interactivity → setupPanel skips them):
// - commands: full article (⑤ Commands, Scripts & APIs)
// - mcp: placeholder ("coming soon")
const PLACEHOLDER_PANELS = new Set(["commands", "mcp"]);
document.querySelectorAll(".tab-panel").forEach((panel) => {
  const id = panel.dataset.panel;
  if (PLACEHOLDER_PANELS.has(id)) return;
  if (id === "agent") setupAgent(panel);
  else if (id === "skill") setupSkill(panel);
  else setupPanel(panel);
});


// ── Tab 7: Skill preview ─────────────────────────────────────────────
const SKILL_BACKEND_URL = "/skill-agent";

function setupSkill(panel) {
  const preset = panel.querySelector(".skill-preset");
  const promptEl = panel.querySelector(".skill-prompt");
  const runBtn = panel.querySelector(".skill-run");
  const stopBtn = panel.querySelector(".skill-stop");
  const indexEl = panel.querySelector(".skill-index");
  const toolsEl = panel.querySelector(".skill-tools");
  const turnsEl = panel.querySelector(".skill-turns");
  const finalArea = panel.querySelector(".skill-final-area");
  const finalEl = panel.querySelector(".skill-final");
  const _isZh2 = LANG.toLowerCase().startsWith("zh");

  // Tab ⑦ always runs with skills. To demo "no skills" contrast, reader
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

  async function run() {
    if (!promptEl.value.trim()) return;
    reset();

    runBtn.disabled = true;
    stopBtn.disabled = false;
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
      runBtn.disabled = false;
      stopBtn.disabled = true;
      abortCtl = null;
    }
  }

  runBtn.addEventListener("click", run);
  stopBtn.addEventListener("click", () => abortCtl?.abort());
  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      run();
    }
  });
}
