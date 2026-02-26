// Ambient chrome global type — aliases the WebExtension Browser API.
// @types/webextension-polyfill provides the Browser interface;
// this shim makes `chrome` available without installing @types/chrome.
// Covers: chrome.tabs, chrome.storage, chrome.runtime, chrome.alarms, chrome.action.

import type Browser from "webextension-polyfill";

declare global {
  // Chrome's API surface mirrors the W3C WebExtension API.
  // Using `typeof Browser` gives full type-safety from the polyfill package.
  const chrome: typeof Browser & {
    // chrome.action (MV3 replacement for browserAction)
    action: {
      setBadgeText(details: { text: string; tabId?: number }): void;
      setBadgeBackgroundColor(details: { color: string; tabId?: number }): void;
      /** Open the extension popup programmatically (Chrome 127+). */
      openPopup(): Promise<void>;
    };
    // chrome.storage.session — session-scoped storage cleared on browser close (Chrome 102+)
    storage: typeof Browser.storage & {
      session: typeof Browser.storage.local;
    };
    // chrome.tabs.sendMessage — send message to a specific tab's content scripts
    tabs: typeof Browser.tabs & {
      sendMessage(tabId: number, message: any): Promise<any>;
    };
  };
}

export {};
