const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_MODEL = "deepseek-r1:8b";
const SYSTEM_PROMPT =
  'You are an expert technical English copyeditor. Analyze the text for grammar, awkward phrasing, and flow. Return ONLY valid JSON in this exact structure: { "matches": [ { "offset": number, "length": number, "message": string, "replacements": [ { "value": string } ] } ] }';

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
      if (parsed && Array.isArray(parsed.matches)) {
        return { matches: parsed.matches };
      }
      console.error("[GrammarFree] Ollama JSON missing matches array", parsed);
      return { matches: [] };
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

  // Remove any <think>...</think> traces without regex to avoid syntax issues.
  let cleaned = stripThinkBlocks(content);

  // Trim code fences that the model may add.
  cleaned = cleaned
    .replace("```json", "")
    .replace("```", "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Best-effort: try parsing the substring between the first { and last }.
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = cleaned.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    }
    throw err;
  }
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
  (async () => {
    switch (message.type) {
      case "getSettings": {
        const settings = await readSettings();
        sendResponse({ settings });
        break;
      }
      case "setGlobalEnabled": {
        const updated = await handleSetGlobalEnabled(Boolean(message.enabled));
        sendResponse({ settings: updated });
        break;
      }
      case "toggleHost": {
        const host = message.host;
        const enable = Boolean(message.enable);
        const updated = await handleToggleHost(host, enable);
        sendResponse({ settings: updated });
        break;
      }
      case "checkText": {
        const result = await handleCheckText(message.text || "", message.language);
        sendResponse(result);
        break;
      }
      default:
        sendResponse({});
    }
  })();
  return true;
});
