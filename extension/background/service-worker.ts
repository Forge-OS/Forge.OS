/// <reference path="../chrome.d.ts" />
// Forge-OS Extension — MV3 Background Service Worker
//
// Responsibilities:
//  1. Poll KAS balance every 60s and update the extension badge.
//  2. Receive sanitised wallet metadata from the content script (no phrase).
//  3. Manage the auto-lock alarm — set/cancel on behalf of the popup.
//  4. Notify the popup when the auto-lock fires (popup wipes its in-memory session).
//  5. Handle site connect requests: open extension popup for user approval,
//     forward approval/rejection back to the requesting tab.
//
// SECURITY: The service worker never receives, stores, or forwards mnemonic data.
// Wallet metadata stored here is address + network ONLY.

export {};

const KAS_API = "https://api.kaspa.org";
const KAS_SOMPI = 1e8;
const BALANCE_ALARM = "forgeos-balance-poll";
const AUTOLOCK_ALARM = "forgeos-autolock";

// Storage keys (address + network only — no phrase)
const WALLET_META_KEY = "forgeos.wallet.meta.v2";
const AGENTS_KEY = "forgeos.session.agents.v2";

// Session storage key for pending site-connect request
const PENDING_CONNECT_KEY = "forgeos.connect.pending";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getStoredAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(WALLET_META_KEY, (result) => {
      try {
        const raw = result[WALLET_META_KEY];
        if (!raw) return resolve(null);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        resolve(typeof parsed?.address === "string" ? parsed.address : null);
      } catch { resolve(null); }
    });
  });
}

async function updateBadge(): Promise<void> {
  const address = await getStoredAddress();
  if (!address) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  try {
    const res = await fetch(
      `${KAS_API}/addresses/${encodeURIComponent(address)}/balance`,
    );
    if (!res.ok) return;
    const data = await res.json() as { balance?: number };
    const kas = (data?.balance ?? 0) / KAS_SOMPI;
    const label =
      kas >= 1_000_000 ? `${(kas / 1_000_000).toFixed(1)}M`
      : kas >= 1_000   ? `${(kas / 1_000).toFixed(1)}K`
      : kas.toFixed(0);
    chrome.action.setBadgeText({ text: label });
    chrome.action.setBadgeBackgroundColor({ color: "#39DDB6" });
  } catch { /* non-fatal — badge stays as-is */ }
}

// ── Alarm management ─────────────────────────────────────────────────────────

function ensureBalanceAlarm(): void {
  chrome.alarms.get(BALANCE_ALARM, (alarm) => {
    if (!alarm) chrome.alarms.create(BALANCE_ALARM, { periodInMinutes: 1 });
  });
}

function scheduleAutoLock(minutes: number): void {
  chrome.alarms.clear(AUTOLOCK_ALARM, () => {
    chrome.alarms.create(AUTOLOCK_ALARM, { delayInMinutes: minutes });
  });
}

function cancelAutoLock(): void {
  chrome.alarms.clear(AUTOLOCK_ALARM);
}

// ── Extension lifecycle ───────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  ensureBalanceAlarm();
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  ensureBalanceAlarm();
  updateBadge();
});

// ── Alarm handler ─────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BALANCE_ALARM) {
    updateBadge();
    return;
  }

  if (alarm.name === AUTOLOCK_ALARM) {
    chrome.runtime.sendMessage({ type: "AUTOLOCK_FIRED" }).catch(() => {});
    chrome.action.setBadgeText({ text: "🔒" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3_000);
  }
});

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: any, sender: any) => {
  // ── Content script sync (address + network only, never phrase) ───────────
  if (message?.type === "FORGEOS_SYNC") {
    const updates: Record<string, unknown> = {};
    if (message.agents) updates[AGENTS_KEY] = message.agents;
    if (message.wallet) {
      try {
        const meta = JSON.parse(message.wallet as string);
        const safe: Record<string, unknown> = {};
        if (typeof meta?.address === "string") safe.address = meta.address;
        if (typeof meta?.network === "string") safe.network = meta.network;
        if (safe.address) updates[WALLET_META_KEY] = JSON.stringify(safe);
      } catch { /* malformed message — ignore */ }
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
    return;
  }

  // ── Auto-lock scheduling ─────────────────────────────────────────────────
  if (message?.type === "SCHEDULE_AUTOLOCK") {
    scheduleAutoLock(typeof message.minutes === "number" ? message.minutes : 15);
    return;
  }

  if (message?.type === "CANCEL_AUTOLOCK") {
    cancelAutoLock();
    return;
  }

  // ── Open popup (simple, no connect flow) ────────────────────────────────
  if (message?.type === "FORGEOS_OPEN_POPUP") {
    chrome.action.openPopup().catch(() => {
      // openPopup() may fail in older Chrome or if not triggered by user gesture.
      // Silently ignore — user can click the extension icon manually.
    });
    return;
  }

  // ── Site connect request: open popup for wallet approval ─────────────────
  if (message?.type === "FORGEOS_OPEN_FOR_CONNECT") {
    const tabId = sender?.tab?.id as number | undefined;
    if (!tabId) return;

    // Store the pending request (session-scoped, cleared on browser close)
    chrome.storage.session.set({
      [PENDING_CONNECT_KEY]: { requestId: message.requestId, tabId },
    });

    // Open the extension popup — user will see ConnectApprovalScreen
    chrome.action.openPopup().catch(() => {
      // If openPopup fails (older Chrome / no user gesture), clean up
      chrome.storage.session.remove(PENDING_CONNECT_KEY);
      chrome.tabs.sendMessage(tabId, {
        type: "FORGEOS_CONNECT_RESULT",
        requestId: message.requestId,
        error: "Could not open Forge-OS popup. Click the extension icon in the toolbar.",
      }).catch(() => {});
    });
    return;
  }

  // ── Popup approved the connect request ──────────────────────────────────
  if (message?.type === "FORGEOS_CONNECT_APPROVE") {
    chrome.storage.session.get(PENDING_CONNECT_KEY).then((result: any) => {
      const pending = result[PENDING_CONNECT_KEY] as { requestId: string; tabId: number } | undefined;
      if (!pending) return;
      chrome.tabs.sendMessage(pending.tabId, {
        type: "FORGEOS_CONNECT_RESULT",
        requestId: pending.requestId,
        result: { address: message.address, network: message.network },
      }).catch(() => {});
      chrome.storage.session.remove(PENDING_CONNECT_KEY);
    });
    return;
  }

  // ── Popup rejected the connect request ──────────────────────────────────
  if (message?.type === "FORGEOS_CONNECT_REJECT") {
    chrome.storage.session.get(PENDING_CONNECT_KEY).then((result: any) => {
      const pending = result[PENDING_CONNECT_KEY] as { requestId: string; tabId: number } | undefined;
      if (!pending) return;
      chrome.tabs.sendMessage(pending.tabId, {
        type: "FORGEOS_CONNECT_RESULT",
        requestId: pending.requestId,
        error: "Connection rejected by user",
      }).catch(() => {});
      chrome.storage.session.remove(PENDING_CONNECT_KEY);
    });
    return;
  }
});
