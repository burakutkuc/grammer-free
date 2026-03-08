const API_URL = "https://api.languagetool.org/v2/check";
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
  const params = new URLSearchParams();
  params.set("text", text);
  params.set("language", language);
  params.set("level", "default");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LanguageTool error (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data.matches || [];
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
