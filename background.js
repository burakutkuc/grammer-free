const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY"; // TODO: paste your key here
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
      chrome.tabs.sendMessage(tab.id, {
        type: "settingsUpdated",
        settings
      }).catch(() => {});
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
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY") {
    throw new Error("Gemini API key missing. Set GEMINI_API_KEY in background.js");
  }

  const systemPrompt =
    "You are an expert technical English copyeditor for a software engineer. Fix grammar, typos, awkward phrasing, redundancy, and ensure natural, professional English flow. You must calculate exact character offsets for the text that needs changing. Return ONLY valid JSON with matches array.";

  const userPrompt = [
    "Return ONLY JSON exactly in this shape:",
    '{ "matches": [ { "offset": number, "length": number, "message": string, "replacements": [ { "value": string } ] } ] }',
    "Rules:",
    "- offsets are zero-based within the provided text.",
    "- length is the exact span to replace.",
    "- message is a concise explanation.",
    "- replacements[0].value is the suggested fix.",
    "Text to analyze:",
    text
  ].join("\n");

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: `SYSTEM:\n${systemPrompt}` },
          { text: `USER:\n${userPrompt}` }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.95,
      maxOutputTokens: 1024
    }
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Gemini error (${response.status}): ${bodyText}`);
  }

  const data = await response.json();
  const textPart =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";

  let parsed;
  try {
    parsed = JSON.parse(textPart);
  } catch (err) {
    throw new Error("Gemini returned non-JSON response");
  }

  if (!parsed || !Array.isArray(parsed.matches)) {
    throw new Error("Gemini JSON missing matches array");
  }

  return parsed.matches;
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
        try {
          const matches = await handleCheckText(message.text || "", message.language);
          sendResponse({ matches });
        } catch (err) {
          sendResponse({ error: err.message || String(err) });
        }
        break;
      }
      default:
        sendResponse({});
    }
  })();
  return true;
});
