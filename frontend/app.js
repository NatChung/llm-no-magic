// ─────────────────────────────────────────────────────────────────────
// LLM 課 frontend — 2 tabs(基礎 / 產品加工),各自獨立 state
// ─────────────────────────────────────────────────────────────────────
const LLAMA_URL = "http://localhost:8080/completion";

const AGENT_BACKEND_URL = "http://localhost:8082/agent";

// ── /swap orchestrator(spec §5)──────────────────────────────────────
const SWAP_URL = "http://localhost:8082/swap";
const TAB_TO_MODEL = {
  basic:     "0.6B",
  advanced:  "0.6B",
  reasoning: "0.6B",
  agent:     "4B",
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
    alert(`切換 model 失敗:${err.message}\n\n手動補救:SETUP.md "Fri AM check"`);
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
  const max = Math.max(...items.map((i) => i.prob), 1e-9);
  for (const {token, prob} of items) {
    const row = document.createElement("div"); row.className = "bar-row";
    const lbl = document.createElement("span"); lbl.className = "bar-label";
    lbl.textContent = JSON.stringify(token).slice(1, -1);
    const track = document.createElement("div"); track.className = "bar-track";
    const fill = document.createElement("div"); fill.className = "bar-fill";
    fill.style.width = `${(prob / max) * 100}%`;
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
  const panelType = panel.dataset.panel;  // 'basic' | 'advanced' | 'reasoning'

  let tokenSteps = [];
  let abortCtl = null;

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
  const nPredict = panelType === "reasoning" ? 300 : 80;

  function refreshPreview() {
    if (previewEl) previewEl.textContent = buildFinalPrompt();
  }

  function appendClickableToken(stepIdx, token) {
    const span = document.createElement("span");
    span.className = "tok";
    span.dataset.step = String(stepIdx);
    span.textContent = token;
    span.title = `第 ${stepIdx + 1} 個生成 token — 點看當下分布`;
    span.addEventListener("click", () => {
      const s = tokenSteps[stepIdx];
      if (!s) return;
      renderProbs(probsEl, s.top_logprobs);
      highlightStep(stepIdx);
    });
    textEl.appendChild(span);
  }

  function highlightStep(idx) {
    textEl.querySelectorAll(".tok").forEach((s) => {
      s.classList.toggle("selected", parseInt(s.dataset.step) === idx);
    });
  }

  async function runCompletion() {
    abortCtl = new AbortController();
    runBtn.disabled = true; stopBtn.disabled = false;
    textEl.textContent = ""; probsEl.innerHTML = "";
    tokenSteps = [];

    const finalPrompt = buildFinalPrompt();

    // llama.cpp Qwen3-0.6B tokenizer 對單個 CJK 字 prompt throw 500 — 自動補尾空格
    let safePrompt = finalPrompt;
    if (finalPrompt.length === 1 && finalPrompt.charCodeAt(0) > 127) {
      safePrompt = finalPrompt + " ";
      console.info(`[llama.cpp guard] 單 CJK 字 "${finalPrompt}" 補尾空格`);
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
            appendClickableToken(stepIdx, step.token);
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
  const AGENT_PREVIEW_URL = "http://localhost:8082/preview";
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
      ? "整個 turn(model 吐的字 加上 tool 結果)累積進 messages,送進下次 model"
      : "這是 final turn,model 沒再 tool_call,結束了";
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
      tcLabel.textContent = "工具呼叫";
      const tcSub = document.createElement("span");
      tcSub.className = TW.toolCallSub;
      tcSub.textContent = "model 從吐的 token 解析出來,交給 client 跑";
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
      trLabel.textContent = "工具結果";
      const trSub = document.createElement("span");
      trSub.className = TW.toolResultSub;
      trSub.textContent = "client 真執行的回傳,會塞回 messages 給下次 model";
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
      rcSummary.textContent = "收到,model 在這 turn 吐的字串(原樣)";
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
      npSummary.textContent = `再送出,累積 ${turn} turn 後送進下次 model 的 prompt`;
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

// Initialize panels — basic/advanced/reasoning go through setupPanel; agent uses setupAgent
document.querySelectorAll(".tab-panel").forEach((panel) => {
  if (panel.dataset.panel === "agent") setupAgent(panel);
  else                                  setupPanel(panel);
});
