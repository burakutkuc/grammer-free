(() => {
  const DEBOUNCE_MS = 2000;
  const CLASS_PREFIX = "grammarfree";
  const MAX_MATCHES_RENDERED = 64; // basic guard
  const HIGHLIGHT_NAME = "grammarfree-highlight";
  const supportsHighlightApi = Boolean(globalThis.CSS && CSS.highlights);

  let settings = { enabled: true, disabledHosts: [] };
  let enabledForPage = true;
  let isChecking = false;

  const stateByElement = new Map();
  let tooltipEl = null;
  let tooltipState = { element: null, match: null };
  let refreshScheduled = false;
  const highlightRangeStore = new Map(); // element -> { range, match }[]

  injectStyles();
  setupTooltip();
  setupListeners();
  hydrateSettings();

  function injectStyles() {
    const style = document.createElement("style");
    style.setAttribute("data-grammarfree", "true");
    style.textContent = `
      .${CLASS_PREFIX}-inline {
        display: inline !important;
        text-decoration: underline wavy #ef4444;
        text-decoration-thickness: 2px;
        text-decoration-skip-ink: none;
        background: rgba(254, 202, 202, 0.35);
        color: inherit !important;
        font: inherit !important;
        border: none !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      ::highlight(${HIGHLIGHT_NAME}) {
        text-decoration: underline wavy #ef4444;
        text-decoration-thickness: 2px;
        text-decoration-skip-ink: none;
        background: rgba(254, 202, 202, 0.35);
        color: inherit;
      }
      .${CLASS_PREFIX}-underline {
        position: fixed;
        pointer-events: none;
        z-index: 2147483645;
        background: rgba(254, 202, 202, 0.65);
        box-shadow: inset 0 -3px 0 #ef4444;
        border-radius: 3px;
      }
      .${CLASS_PREFIX}-hitbox {
        position: fixed;
        pointer-events: auto;
        background: transparent;
        z-index: 2147483646;
        cursor: pointer;
      }
      .${CLASS_PREFIX}-tooltip {
        position: fixed;
        max-width: 320px;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 10px;
        padding: 10px 12px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.35);
        font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        line-height: 1.45;
        z-index: 2147483647;
        display: none;
      }
      .${CLASS_PREFIX}-tooltip h4 {
        margin: 0 0 6px 0;
        font-size: 13px;
        color: #f8fafc;
        font-weight: 600;
      }
      .${CLASS_PREFIX}-tooltip p {
        margin: 0 0 8px 0;
        white-space: normal;
        word-break: break-word;
      }
      .${CLASS_PREFIX}-tooltip button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #22c55e;
        color: #0b1325;
        border: none;
        border-radius: 8px;
        padding: 6px 10px;
        font-weight: 600;
        cursor: pointer;
      }
      .${CLASS_PREFIX}-tooltip .${CLASS_PREFIX}-tooltip-suggestion {
        margin: 0 0 6px 0;
        color: #cbd5f5;
        font-weight: 600;
      }
      .${CLASS_PREFIX}-tooltip button:disabled {
        opacity: 0.7;
        cursor: default;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function setupTooltip() {
    tooltipEl = document.createElement("div");
    tooltipEl.className = `${CLASS_PREFIX}-tooltip`;

    const title = document.createElement("h4");
    title.textContent = "GrammarFree";

    const message = document.createElement("p");
    message.className = `${CLASS_PREFIX}-tooltip-message`;

    const suggestionText = document.createElement("p");
    suggestionText.className = `${CLASS_PREFIX}-tooltip-suggestion`;

    const suggestionBtn = document.createElement("button");
    suggestionBtn.className = `${CLASS_PREFIX}-tooltip-apply`;
    suggestionBtn.type = "button";
    suggestionBtn.textContent = "Apply suggestion";
    suggestionBtn.addEventListener("click", () => {
      if (tooltipState.element && tooltipState.match) {
        applySuggestion(tooltipState.element, tooltipState.match);
      }
    });

    tooltipEl.append(title, message, suggestionText, suggestionBtn);
    document.documentElement.appendChild(tooltipEl);

    document.addEventListener("click", (evt) => {
      if (!tooltipEl) return;
      if (tooltipEl.contains(evt.target)) return;
      hideTooltip();
    });
  }

  function setupListeners() {
    document.addEventListener("focusin", (evt) => {
      const target = evt.target;
      if (!enabledForPage || !isSupported(target)) return;
      primeElementState(target);
      scheduleCheck(target, { immediate: true });
    });

    document.addEventListener(
      "input",
      (evt) => {
        const target = evt.target;
        if (!enabledForPage || !isSupported(target)) return;
        primeElementState(target);
        scheduleCheck(target);
      },
      true
    );

    document.addEventListener(
      "keyup",
      (evt) => {
        const target = evt.target;
        if (!enabledForPage || !isSupported(target)) return;
        primeElementState(target);
        scheduleCheck(target);
      },
      true
    );

    window.addEventListener(
      "scroll",
      () => {
        if (!enabledForPage) return;
        refreshAllHighlights();
      },
      true
    );

    window.addEventListener("resize", () => {
      if (!enabledForPage) return;
      refreshAllHighlights();
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "settingsUpdated" && message.settings) {
        settings = message.settings;
        enabledForPage = computeEnabled(settings);
        if (!enabledForPage) {
          clearAll();
        }
      }
    });
  }

  async function hydrateSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "getSettings" });
      if (response && response.settings) {
        settings = response.settings;
      }
    } catch (err) {
      console.warn("[GrammarFree] unable to load settings", err);
    }
    enabledForPage = computeEnabled(settings);
  }

  function computeEnabled(currentSettings) {
    if (!currentSettings.enabled) return false;
    const host = location.hostname || "";
    return !currentSettings.disabledHosts.includes(host);
  }

  function isSupported(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "email", "url", "tel"].includes(type);
    }
    return false;
  }

  function primeElementState(el) {
    if (stateByElement.has(el)) return;
      const cleanup = () => {
        const state = stateByElement.get(el);
        if (!state) return;
        clearHighlights(el, state);
        stateByElement.delete(el);
      };
    el.addEventListener("blur", cleanup, { once: true });
    el.addEventListener(
      "scroll",
      () => {
        const state = stateByElement.get(el);
        if (!state) return;
        renderHighlights(el, state.lastText, state.lastMatches);
      },
      { passive: true }
    );
    stateByElement.set(el, {
      timer: null,
      lastText: "",
      lastMatches: [],
      lastSignature: null,
      mode:
        el.isContentEditable && el.tagName !== "TEXTAREA" && el.tagName !== "INPUT"
          ? "rich"
          : "form",
      underlineNodes: [],
      hitboxes: [],
      inlineSpans: []
    });
  }

  function scheduleCheck(el, options = {}) {
    const state = stateByElement.get(el);
    if (!state) return;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (options.immediate) {
      runCheck(el);
      return;
    }
    state.timer = setTimeout(() => runCheck(el), DEBOUNCE_MS);
  }

  async function runCheck(el) {
    if (!chrome.runtime?.id) return;
    const state = stateByElement.get(el);
    if (!state) return;
    if (!enabledForPage) {
      clearHighlights(el, state);
      return;
    }

    const text = readText(el);
    if (text === state.lastText) {
      renderHighlights(el, text, state.lastMatches, { force: true });
      return;
    }
    state.lastText = text;

    if (!text || !text.trim()) {
      clearHighlights(el, state);
      state.lastMatches = [];
      return;
    }

    if (isChecking) return;
    isChecking = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "checkText",
        text,
        language: "en-US"
      });

      if (response && Array.isArray(response.matches)) {
        state.lastMatches = response.matches.slice(0, MAX_MATCHES_RENDERED);
        renderHighlights(el, text, state.lastMatches, { force: true });
      } else if (response && response.error) {
        console.warn("[GrammarFree] check error", response.error);
        clearHighlights(el, state);
      }
    } catch (err) {
      if (String(err).includes("Extension context invalidated")) {
        return;
      }
      if (String(err).includes("message channel closed")) {
        return;
      }
      console.warn("[GrammarFree] failed to reach Ollama", err);
      clearHighlights(el, state);
    } finally {
      isChecking = false;
    }
  }

  function refreshAllHighlights() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshScheduled = false;
      for (const [el, state] of stateByElement.entries()) {
        if (!document.contains(el)) {
          clearHighlights(el, state);
          stateByElement.delete(el);
          continue;
        }
        renderHighlights(el, state.lastText, state.lastMatches, { force: true });
      }
    });
  }

  function clearAll() {
    for (const [el, state] of stateByElement.entries()) {
      clearHighlights(el, state);
    }
    stateByElement.clear();
    hideTooltip();
  }

  function clearHighlights(el, state) {
    if (state.mode === "rich") {
      if (supportsHighlightApi) {
        highlightRangeStore.delete(el);
        rebuildHighlights();
      } else {
        const spans = el.querySelectorAll(`span.${CLASS_PREFIX}-inline`);
        spans.forEach((span) => {
          const textNode = document.createTextNode(span.textContent || "");
          span.replaceWith(textNode);
        });
        state.inlineSpans = [];
      }
    }
    for (const node of state.underlineNodes) node.remove();
    for (const hit of state.hitboxes) hit.remove();
    state.underlineNodes = [];
    state.hitboxes = [];
  }

  function renderHighlights(el, text, matches, { force = false } = {}) {
    const state = stateByElement.get(el);
    if (!state) return;

    const signature = buildSignature(text, matches);
    if (!force && state.lastSignature === signature) return;
    state.lastSignature = signature;

    clearHighlights(el, state);
    hideTooltip();

    if (!matches || matches.length === 0) {
      // explicitly clear any prior artifacts when no matches remain
      clearHighlights(el, state);
      return;
    }
    if (!document.contains(el)) return;

    if (state.mode === "rich") {
      renderInlineHighlights(el, matches, state);
      return;
    }

    const measurements = measureMatches(el, text, matches);
    const underlineNodes = [];
    const hitboxes = [];
    const underlineFragment = document.createDocumentFragment();
    const hitboxFragment = document.createDocumentFragment();

    for (const entry of measurements) {
      for (const rect of entry.rects) {
        const underline = document.createElement("div");
        underline.className = `${CLASS_PREFIX}-underline`;
        underline.style.left = `${rect.left}px`;
        underline.style.top = `${rect.top}px`;
        underline.style.width = `${rect.width}px`;
        underline.style.height = `${rect.height}px`;
        underlineFragment.appendChild(underline);
        underlineNodes.push(underline);

        const hit = document.createElement("div");
        hit.className = `${CLASS_PREFIX}-hitbox`;
        hit.dataset.matchId = entry.id;
        hit.style.left = `${rect.left}px`;
        hit.style.top = `${rect.top}px`;
        hit.style.width = `${Math.max(rect.width, 12)}px`;
        hit.style.height = `${rect.height}px`;
        hit.addEventListener("mouseenter", () => {
          showTooltip(entry.match, rect, el);
        });
        hit.addEventListener("click", (evt) => {
          evt.stopPropagation();
          showTooltip(entry.match, rect, el);
        });
        hitboxFragment.appendChild(hit);
        hitboxes.push(hit);
      }
    }

    document.documentElement.appendChild(underlineFragment);
    document.documentElement.appendChild(hitboxFragment);

    state.underlineNodes = underlineNodes;
    state.hitboxes = hitboxes;
  }

  function renderInlineHighlights(el, matches, state) {
    if (!matches || matches.length === 0) return;
    const sorted = matches
      .filter((m) => Number.isFinite(m.offset) && Number.isFinite(m.length) && m.length > 0)
      .sort((a, b) => a.offset - b.offset);
    if (sorted.length === 0) return;

    if (supportsHighlightApi) {
      const rangeEntries = buildRangeEntries(el, sorted);
      highlightRangeStore.set(el, rangeEntries);
      rebuildHighlights();

      const hitboxFragment = document.createDocumentFragment();
      const hitboxes = [];
      rangeEntries.forEach(({ range, match }) => {
        if (!match) return;
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          const hit = document.createElement("div");
          hit.className = `${CLASS_PREFIX}-hitbox`;
          hit.style.left = `${rect.left}px`;
          hit.style.top = `${rect.top}px`;
          hit.style.width = `${Math.max(rect.width, 12)}px`;
          hit.style.height = `${rect.height}px`;
          hit.addEventListener("mouseenter", () => showTooltip(match, rect, el));
          hit.addEventListener("click", (evt) => {
            evt.stopPropagation();
            showTooltip(match, rect, el);
          });
          hitboxFragment.appendChild(hit);
          hitboxes.push(hit);
        }
      });

      document.documentElement.appendChild(hitboxFragment);
      state.hitboxes = hitboxes;
      return;
    }

    // Fallback: inline spans when CSS Highlight API is unavailable
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    let cursor = 0;
    let matchIndex = 0;
    const spans = [];

    while (node && matchIndex < sorted.length) {
      const textContent = node.textContent || "";
      const nodeStart = cursor;
      const nodeEnd = cursor + textContent.length;

      const overlapping = [];
      while (
        matchIndex < sorted.length &&
        sorted[matchIndex].offset < nodeEnd &&
        sorted[matchIndex].offset + sorted[matchIndex].length > nodeStart
      ) {
        overlapping.push(sorted[matchIndex]);
        const matchEnd = sorted[matchIndex].offset + sorted[matchIndex].length;
        if (matchEnd <= nodeEnd) {
          matchIndex += 1;
        } else {
          break;
        }
      }

      if (overlapping.length > 0) {
        const frag = document.createDocumentFragment();
        let localPos = 0;
        for (const match of overlapping) {
          const start = Math.max(nodeStart, match.offset);
          const end = Math.min(nodeEnd, match.offset + match.length);
          const relStart = start - nodeStart;
          const relEnd = end - nodeStart;
          if (relStart > localPos) {
            frag.appendChild(document.createTextNode(textContent.slice(localPos, relStart)));
          }
          const span = document.createElement("span");
          span.className = `${CLASS_PREFIX}-inline`;
          span.textContent = textContent.slice(relStart, relEnd);
          span.dataset.matchOffset = String(match.offset);
          span.addEventListener("mouseenter", () => {
            const rect = span.getBoundingClientRect();
            showTooltip(match, rect, el);
          });
          span.addEventListener("click", (evt) => {
            evt.stopPropagation();
            const rect = span.getBoundingClientRect();
            showTooltip(match, rect, el);
          });
          frag.appendChild(span);
          spans.push(span);
          localPos = relEnd;
        }
        if (localPos < textContent.length) {
          frag.appendChild(document.createTextNode(textContent.slice(localPos)));
        }
        node.replaceWith(frag);
      }

      cursor = nodeEnd;
      node = walker.nextNode();
    }

    state.inlineSpans = spans;
  }

  function buildRangeEntries(el, matches) {
    const entries = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    let cursor = 0;
    let idx = 0;

    while (node && idx < matches.length) {
      const text = node.textContent || "";
      const nodeStart = cursor;
      const nodeEnd = nodeStart + text.length;
      const match = matches[idx];
      const matchStart = match.offset;
      const matchEnd = match.offset + match.length;

      if (matchStart >= nodeEnd) {
        cursor = nodeEnd;
        node = walker.nextNode();
        continue;
      }

      if (matchEnd <= nodeStart) {
        idx += 1;
        continue;
      }

      const start = Math.max(nodeStart, matchStart);
      const end = Math.min(nodeEnd, matchEnd);
      if (end > start) {
        const range = document.createRange();
        range.setStart(node, start - nodeStart);
        range.setEnd(node, end - nodeStart);
        entries.push({ range, match });
      }

      if (matchEnd <= nodeEnd) {
        idx += 1;
      }

      cursor = nodeEnd;
      node = walker.nextNode();
    }

    return entries;
  }

  function buildSignature(text, matches) {
    const matchPart = (matches || [])
      .slice(0, MAX_MATCHES_RENDERED)
      .map((m) => `${m.offset}-${m.length}-${m?.replacements?.[0]?.value || ""}`)
      .join("|");
    return `${hashText(text)}::${matchPart}`;
  }

  function hashText(str) {
    let hash = 0;
    const step = Math.max(1, Math.floor(str.length / 48));
    for (let i = 0; i < str.length; i += step) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return hash.toString(16);
  }

  function rebuildHighlights() {
    if (!supportsHighlightApi) return;
    const allRanges = [];
    for (const entries of highlightRangeStore.values()) {
      for (const entry of entries) allRanges.push(entry.range);
    }
    if (allRanges.length === 0) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      return;
    }
    const highlight = new Highlight(...allRanges);
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);
  }

  function measureMatches(el, text, matches) {
    const sorted = matches
      .filter((m) => Number.isFinite(m.offset) && Number.isFinite(m.length) && m.length > 0)
      .sort((a, b) => a.offset - b.offset);
    if (sorted.length === 0) return [];

    const mirror = document.createElement("div");
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.pointerEvents = "none";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.top = "0";
    mirror.style.left = "-9999px";

    const computed = getComputedStyle(el);
    mirror.style.fontFamily = computed.fontFamily;
    mirror.style.fontSize = computed.fontSize;
    mirror.style.fontWeight = computed.fontWeight;
    mirror.style.fontStyle = computed.fontStyle;
    mirror.style.lineHeight = computed.lineHeight;
    mirror.style.letterSpacing = computed.letterSpacing;
    mirror.style.padding = computed.padding;
    mirror.style.border = computed.border;
    mirror.style.boxSizing = "border-box";
    const width = el.clientWidth || parseFloat(computed.width) || 480;
    mirror.style.width = `${width}px`;
    mirror.style.height = "auto";
    mirror.style.minHeight = `${el.clientHeight}px`;
    mirror.style.background = "transparent";
    mirror.textContent = text;

    document.body.appendChild(mirror);

    const mirrorRect = mirror.getBoundingClientRect();
    const targetRect = el.getBoundingClientRect();
    const scrollTop = el.scrollTop || 0;
    const scrollLeft = el.scrollLeft || 0;

    const textNode = mirror.firstChild;
    const results = [];
    let index = 0;

    for (const match of sorted) {
      const start = Math.max(0, Math.min(text.length, match.offset));
      const end = Math.max(start, Math.min(text.length, match.offset + match.length));
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const rects = Array.from(range.getClientRects()).map((r) => ({
        left: targetRect.left + (r.left - mirrorRect.left) - scrollLeft,
        top: targetRect.top + (r.top - mirrorRect.top) - scrollTop,
        width: r.width,
        height: r.height
      }));
      results.push({ id: `match-${index++}`, match, rects });
      range.detach();
    }

    mirror.remove();
    return results;
  }

  function readText(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      return el.value || "";
    }
    return el.textContent || "";
  }

  function setCaret(el, position) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      el.setSelectionRange(position, position);
      el.focus();
      return;
    }
    const range = document.createRange();
    const selection = window.getSelection();
    const { node, offset } = locateTextPosition(el, position);
    range.setStart(node, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    el.focus();
  }

  function applySuggestion(el, match) {
    const replacement = match?.replacements?.[0]?.value;
    if (!replacement) {
      hideTooltip();
      return;
    }
    const text = readText(el);
    const start = match.offset;
    const end = start + match.length;
    if (start > text.length) return;

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const updated = text.slice(0, start) + replacement + text.slice(end);
      el.value = updated;
      setCaret(el, start + replacement.length);
    } else {
      replaceContentEditableRange(el, start, end, replacement);
    }

    hideTooltip();
    primeElementState(el);
    scheduleCheck(el, { immediate: true });
  }

  function replaceContentEditableRange(el, start, end, replacement) {
    const startPos = locateTextPosition(el, start);
    const endPos = locateTextPosition(el, end);
    if (!startPos.node || !endPos.node) return;

    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);

    const textNode = document.createTextNode(replacement);
    range.deleteContents();
    range.insertNode(textNode);

    const newOffset = start + replacement.length;
    setCaret(el, newOffset);
  }

  function locateTextPosition(root, targetIndex) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    let count = 0;
    while (node) {
      const nextCount = count + node.textContent.length;
      if (targetIndex <= nextCount) {
        return { node, offset: targetIndex - count };
      }
      count = nextCount;
      node = walker.nextNode();
    }
    return { node: root, offset: root.childNodes.length };
  }

  function showTooltip(match, rect, el) {
    if (!tooltipEl) return;
    tooltipState = { element: el, match };
    const messageEl = tooltipEl.querySelector(`.${CLASS_PREFIX}-tooltip-message`);
    const suggestionEl = tooltipEl.querySelector(`.${CLASS_PREFIX}-tooltip-suggestion`);
    const buttonEl = tooltipEl.querySelector(`.${CLASS_PREFIX}-tooltip-apply`);

    const suggestion = match?.replacements?.[0]?.value;
    const explanation = match?.message || match?.shortMessage || "Possible issue detected.";
    messageEl.textContent = explanation;
    suggestionEl.textContent = suggestion
      ? `Suggestion: ${suggestion}`
      : "No suggestion provided.";
    buttonEl.textContent = suggestion ? `Replace with "${suggestion}"` : "No suggestion";
    buttonEl.disabled = !suggestion;

    tooltipEl.style.display = "block";

    requestAnimationFrame(() => {
      const tooltipRect = tooltipEl.getBoundingClientRect();
      const margin = 6;
      const left = Math.min(
        Math.max(8, rect.left),
        window.innerWidth - tooltipRect.width - 8
      );
      const top = Math.min(
        rect.top + rect.height + margin,
        window.innerHeight - tooltipRect.height - 8
      );
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top = `${top}px`;
    });
  }

  function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.style.display = "none";
    tooltipState = { element: null, match: null };
  }
})();
