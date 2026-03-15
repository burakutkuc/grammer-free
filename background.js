const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_MODEL = "qwen2.5:3b";
const SYSTEM_PROMPT =
  'You are an expert English copyeditor. Your goal is to make the text meaningful, natural, and grammatically correct. Fix typos, incorrect verb tenses (e.g., "to finished" -> "to finish"), and awkward phrasing. CRITICAL: If a word is missing to make sense, you MUST add it in your fix (e.g., "do not how" -> "do not know how"). Extract the incorrect phrase (max 6 words) into "exact_typo". Provide the corrected phrase in "fix". Provide a brief explanation in "reason". If perfectly correct, return { "errors": [] }.';

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const payload = {
    model: OLLAMA_MODEL,
    stream: false,
    format: "json",
    options: {
      temperature: 0.0
    },
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
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      console.error(
        `[GrammarFree] Ollama responded with ${response.status} ${response.statusText}`
      );
      return { errors: [], rawContent: null };
    }

    const data = await response.json();
    const rawContent = data?.message?.content;
    console.log("[DEBUG] RAW LLM Response:", data.message.content);

    try {
      const parsed = parseOllamaContent(rawContent);
      console.log("[DEBUG] Ollama Parsed JSON (errors):", parsed);
      const errors = Array.isArray(parsed?.errors) ? parsed.errors : [];
      return { errors, rawContent };
    } catch (parseErr) {
      console.error(
        "[GrammarFree] parse error for Ollama response",
        parseErr,
        "raw content:",
        rawContent
      );
      return { errors: [], rawContent };
    }
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn("[GrammarFree] Ollama request timed out after 15s");
    } else {
      console.error("[GrammarFree] Ollama request failed", err);
    }
    return { errors: [], rawContent: null };
  } finally {
    clearTimeout(timeoutId);
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

function buildMatchesFromErrors(originalText, parsed) {
  if (!parsed || !Array.isArray(parsed.errors)) return [];

  const matches = [];

  for (const correction of parsed.errors) {
    const bad = correction?.exact_typo;
    const good = correction?.fix;
    const reason = correction?.reason || "Issue detected";

    if (!bad || !good || typeof bad !== "string" || typeof good !== "string") {
      continue;
    }
    if (bad.length > 80) {
      continue;
    }

    const lowerText = originalText.toLowerCase();
    const lowerTypo = bad.toLowerCase();
    let startIndex = lowerText.indexOf(lowerTypo);
    console.log("[DEBUG] Searching for:", bad, "-> Index:", startIndex);
    if (startIndex === -1) {
      console.warn("[WARN] Could not find exact_typo in original text verbatim!");
      continue;
    }
    const length = bad.length;

    matches.push({
      offset: startIndex,
      length,
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
  const safeSendResponse = (data) => {
    try {
      sendResponse(data);
    } catch (e) {
      // message channel may already be closed
    }
  };

  if (message.type === "checkText") {
    (async () => {
      const fullText = message.text || "";
      const sentences = fullText.match(/[^.!?\n]+[.!?\n]+/g) || [fullText];
      let allMatches = [];

      if (!fullText.trim()) {
        safeSendResponse({ matches: [] });
        return;
      }

      try {
        for (const sentence of sentences) {
          console.log("[DEBUG] Processing chunk:", sentence);

          const { errors, rawContent } = await handleCheckText(
            sentence,
            message.language
          );
          console.log("[DEBUG] Qwen returned:", rawContent);

          if (!Array.isArray(errors)) {
            continue;
          }

          for (const correction of errors) {
            const bad = correction?.exact_typo;
            const good = correction?.fix;
            const reason = correction?.reason || "Issue detected";

            if (!bad || !good || typeof bad !== "string" || typeof good !== "string") {
              continue;
            }
            if (bad.length > 80) {
              continue;
            }

            const startIndex = fullText.indexOf(bad);
            console.log("[DEBUG] Mapped Index:", startIndex);
            if (startIndex === -1) {
              console.warn("[WARN] Could not locate phrase in full text:", bad);
              continue;
            }

            allMatches.push({
              offset: startIndex,
              length: bad.length,
              message: reason,
              replacements: [{ value: good }]
            });
          }
        }

        safeSendResponse({ matches: allMatches });
      } catch (error) {
        console.error("Background error:", error);
        safeSendResponse({ matches: allMatches });
      }
    })();
    return true; // keep channel open for async response
  }

  switch (message.type) {
    case "getSettings": {
      (async () => {
        const settings = await readSettings();
        safeSendResponse({ settings });
      })();
      return true;
    }
    case "setGlobalEnabled": {
      (async () => {
        const updated = await handleSetGlobalEnabled(Boolean(message.enabled));
        safeSendResponse({ settings: updated });
      })();
      return true;
    }
    case "toggleHost": {
      (async () => {
        const host = message.host;
        const enable = Boolean(message.enable);
        const updated = await handleToggleHost(host, enable);
        safeSendResponse({ settings: updated });
      })();
      return true;
    }
    default: {
      safeSendResponse({});
      return false;
    }
  }
});
