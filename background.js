const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_MODEL = "deepseek-r1:8b";
const SYSTEM_PROMPT =
  'You are an expert technical English copyeditor. Return ONLY valid JSON in this exact structure: { "corrections": [ { "bad_text": "the exact wrong words", "good_text": "the replacement", "reason": "explanation" } ] }. The bad_text MUST be only the specific short phrase that is wrong (e.g., "have forgot" or "for check there is"), not the surrounding sentence or clause. Do not include markdown, code fences, or any text outside the JSON object.';

const DEFAULT_SETTINGS = {
  enabled: true,
  disabledHosts: []
};

async function readSettings() {
  const stored = await chrome.storage.sync.get(["gfEnabled", "gfDisabledHosts"]);
  return {
    enabled: stored.gfEnabled ?? DEFAULT_SETTINGS.enabled,
    disabledHosts: stored.gfDisabledHosts ?? DEFAULT_SETTINGS.disabledHosts
  };
}

async function persistSettings(next) {
  await chrome.storage.sync.set({
    gfEnabled: next.enabled,
    gfDisabledHosts: next.disabledHosts
  });
  return next;
}

async function broadcastSettings(settings) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs
        .sendMessage(tab.id, {
          type: "settingsUpdated",
          settings
        })
        .catch(() => {});
    }
  }
}

async function ensureDefaults() {
  const current = await readSettings();
  if (current.enabled === undefined || current.disabledHosts === undefined) {
    await persistSettings(DEFAULT_SETTINGS);
  }
}

async function handleToggleHost(host, enabled) {
  const settings = await readSettings();
  const disabled = new Set(settings.disabledHosts);
  if (!enabled) {
    disabled.add(host);
  } else {
    disabled.delete(host);
  }
  const next = await persistSettings({
    enabled: settings.enabled,
    disabledHosts: Array.from(disabled)
  });
  await broadcastSettings(next);
  return next;
}

async function handleSetGlobalEnabled(enabled) {
  const settings = await readSettings();
  const next = await persistSettings({
    enabled,
    disabledHosts: settings.disabledHosts
  });
  await broadcastSettings(next);
  return next;
}

async function handleCheckText(text, language = "en-US") {
  const payload = {
    model: OLLAMA_MODEL,
    stream: false,
    format: "json",
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      {
        role: "user",
        content: text || ""
      }
    ]
  };

  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(
        `[GrammarFree] Ollama responded with ${response.status} ${response.statusText}`
      );
      return { matches: [] };
    }

    const data = await response.json();
    const rawContent = data?.message?.content;

    try {
      const parsed = parseOllamaContent(rawContent);
      const matches = buildMatchesFromCorrections(text || "", parsed);
      return { matches };
    } catch (parseErr) {
      console.error(
        "[GrammarFree] parse error for Ollama response",
        parseErr,
        "raw content:",
        rawContent
      );
      return { matches: [] };
    }
  } catch (err) {
    console.error("[GrammarFree] Ollama request failed", err);
    return { matches: [] };
  }
}

function parseOllamaContent(content) {
  if (content === undefined || content === null) {
    throw new Error("Empty Ollama content");
  }

  if (typeof content === "object") {
    return content;
  }

  if (typeof content !== "string") {
    throw new Error("Unexpected Ollama content type");
  }

  // Remove any <think>...</think> traces without complex regex and trim code fences.
  const cleaned = stripThinkBlocks(content)
    .replace("```json", "")
    .replace("```", "")
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : null;
  if (!jsonStr) {
    throw new Error("No JSON object found in Ollama response");
  }

  return JSON.parse(jsonStr);
}

function buildMatchesFromCorrections(originalText, parsed) {
  if (!parsed || !Array.isArray(parsed.corrections)) return [];

  const matches = [];
  let searchStart = 0;

  for (const correction of parsed.corrections) {
    const bad = correction?.bad_text;
    const good = correction?.good_text;
    const reason = correction?.reason || "Issue detected";

    if (!bad || !good || typeof bad !== "string" || typeof good !== "string") {
      continue;
    }

    let idx = originalText.indexOf(bad, searchStart);
    if (idx === -1) {
      idx = originalText.indexOf(bad);
    }
    if (idx === -1) continue;

    searchStart = idx + bad.length;

    matches.push({
      offset: idx,
      length: bad.length,
      message: reason,
      replacements: [{ value: good }]
    });
  }

  return matches;
}

function stripThinkBlocks(text) {
  let output = text;
  let start = output.indexOf("<think>");
  while (start !== -1) {
    const end = output.indexOf("</think>", start + 7);
    if (end === -1) break;
    output = output.slice(0, start) + output.slice(end + 8);
    start = output.indexOf("<think>");
  }
  return output;
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaults();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "checkText") {
    (async () => {
      try {
        const result = await handleCheckText(message.text || "", message.language);
        sendResponse(result);
      } catch (error) {
        console.error("Background error:", error);
        sendResponse({ matches: [] });
      }
    })();
    return true; // keep channel open for async response
  }

  switch (message.type) {
    case "getSettings": {
      (async () => {
        const settings = await readSettings();
        sendResponse({ settings });
      })();
      return true;
    }
    case "setGlobalEnabled": {
      (async () => {
        const updated = await handleSetGlobalEnabled(Boolean(message.enabled));
        sendResponse({ settings: updated });
      })();
      return true;
    }
    case "toggleHost": {
      (async () => {
        const host = message.host;
        const enable = Boolean(message.enable);
        const updated = await handleToggleHost(host, enable);
        sendResponse({ settings: updated });
      })();
      return true;
    }
    default: {
      sendResponse({});
      return false;
    }
  }
});
