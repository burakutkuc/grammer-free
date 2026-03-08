const globalToggle = document.getElementById("toggle-global");
const siteToggle = document.getElementById("toggle-site");
const siteLabel = document.getElementById("site-label");
const statusPill = document.getElementById("status-pill");

let currentHost = "";
let currentSettings = { enabled: true, disabledHosts: [] };

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const tab = await getActiveTab();
  if (tab?.url) {
    try {
      const url = new URL(tab.url);
      currentHost = url.hostname;
      siteLabel.textContent = currentHost;
    } catch (_) {
      siteLabel.textContent = "Unknown site";
    }
  }

  await loadSettings();
  globalToggle.addEventListener("change", onGlobalChange);
  siteToggle.addEventListener("change", onSiteChange);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "getSettings" });
    if (response?.settings) {
      currentSettings = response.settings;
      render();
    }
  } catch (err) {
    statusPill.textContent = "Error";
    console.warn("[GrammarFree] popup load error", err);
  }
}

async function onGlobalChange() {
  const enabled = globalToggle.checked;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "setGlobalEnabled",
      enabled
    });
    if (response?.settings) {
      currentSettings = response.settings;
      render();
    }
  } catch (err) {
    console.warn("[GrammarFree] global toggle failed", err);
  }
}

async function onSiteChange() {
  if (!currentHost) return;
  const enable = siteToggle.checked;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "toggleHost",
      host: currentHost,
      enable
    });
    if (response?.settings) {
      currentSettings = response.settings;
      render();
    }
  } catch (err) {
    console.warn("[GrammarFree] site toggle failed", err);
  }
}

function render() {
  globalToggle.checked = currentSettings.enabled;
  const enabledHere =
    currentSettings.enabled && !currentSettings.disabledHosts.includes(currentHost);
  siteToggle.checked = enabledHere;
  siteToggle.disabled = !currentSettings.enabled;

  statusPill.textContent = enabledHere ? "On" : "Paused";
  statusPill.style.background = enabledHere ? "#dcfce7" : "#e2e8f0";
  statusPill.style.color = enabledHere ? "#166534" : "#0f172a";
}
