// Built-in Chrome AI (Gemini Nano via Prompt API)
let localModelSession = null;
const SYSTEM_PROMPT =
  "You are an expert technical English copyeditor for a software engineer. Fix grammar, awkward phrasing, redundancy, and ensure natural, professional English flow. You must calculate exact character offsets for the text that needs changing. Return ONLY valid JSON with matches array.";
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
  try {
    const session = await getLocalModelSession();

    const userPrompt = [
      "Return ONLY JSON exactly in this shape:",
      '{ "matches": [ { "offset": number, "length": number, "message": string, "replacements": [ { "value": string } ] } ] }',
      "Rules:",
      "- offsets are zero-based within the provided text.",
      "- length is the exact span to replace.",
      "- message is a concise explanation of the issue.",
      "- replacements[0].value is the suggested fix.",
      "Text to analyze:",
      text
    ].join("\n");

    const responseText = await session.prompt(userPrompt);
    const cleaned = sanitizeJsonString(responseText);

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error("[GrammarFree] JSON parse failed. Raw response:", responseText);
      throw err;
    }

    if (!parsed || !Array.isArray(parsed.matches)) {
      throw new Error("Local AI JSON missing matches array");
    }

    return parsed.matches;
  } catch (err) {
    console.error("[GrammarFree] local AI call failed", err);
    return [];
  }
}

async function getLocalModelSession() {
  if (localModelSession) return localModelSession;

  console.log("[GrammarFree] ai object present:", typeof self !== "undefined", !!self?.ai);
  console.log(
    "[GrammarFree] ai.languageModel present:",
    typeof self !== "undefined" && !!self?.ai?.languageModel
  );

  if (typeof self === "undefined" || !self.ai || !self.ai.languageModel) {
    throw new Error(
      "Chrome built-in AI unavailable. Enable chrome://flags/#prompt-api-for-gemini-nano and restart."
    );
  }

  const caps = await self.ai.languageModel.capabilities();
  if (!caps || caps.available !== "readily") {
    throw new Error(
      "Chrome built-in AI not ready. Enable chrome://flags/#prompt-api-for-gemini-nano and wait for download."
    );
  }

  localModelSession = await self.ai.languageModel.create({
    systemPrompt: SYSTEM_PROMPT
  });

  return localModelSession;
}

function sanitizeJsonString(raw) {
  if (!raw || typeof raw !== "string") return raw;
  // strip markdown code fences like ```json ... ```
  const fenceMatch = raw.match(/```(?:json)?\\s*([\\s\\S]*?)\\s*```/i);
  const candidate = fenceMatch ? fenceMatch[1] : raw;
  // remove leading/trailing markers like "json\n"
  return candidate.trim();
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
