// Forge-OS Extension — MV3 Background Service Worker
// Polls KAS balance every 60s and updates the badge.

const KAS_API = "https://api.kaspa.org";
const KAS_SOMPI = 1e8;
const ALARM_NAME = "forgeos-balance-poll";
const WALLET_KEY = "forgeos.managed.wallet.v1";
const AGENTS_KEY = "forgeos.session.agents.v2";

async function getStoredWallet(): Promise<{ address: string } | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(WALLET_KEY, (result) => {
      try {
        const raw = result[WALLET_KEY];
        if (!raw) return resolve(null);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        resolve(parsed?.address ? parsed : null);
      } catch { resolve(null); }
    });
  });
}

async function updateBadge() {
  const wallet = await getStoredWallet();
  if (!wallet?.address) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  try {
    const res = await fetch(`${KAS_API}/addresses/${encodeURIComponent(wallet.address)}/balance`);
    if (!res.ok) return;
    const data = await res.json();
    const kas = (data?.balance ?? 0) / KAS_SOMPI;
    const label = kas >= 1000 ? `${(kas / 1000).toFixed(1)}K` : kas.toFixed(0);
    chrome.action.setBadgeText({ text: label });
    chrome.action.setBadgeBackgroundColor({ color: "#39DDB6" });
  } catch {}
}

// Set up alarm on install / browser start
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) updateBadge();
});

// Listen for sync messages from the content script
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "FORGEOS_SYNC") {
    const updates: Record<string, any> = {};
    if (message.agents) updates[AGENTS_KEY] = message.agents;
    if (message.wallet) updates[WALLET_KEY] = message.wallet;
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  }
});
