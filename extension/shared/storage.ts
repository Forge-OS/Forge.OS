// Typed chrome.storage.local wrappers
// Uses the same key names as the main Forge-OS site so the content script
// can sync localStorage → extension storage seamlessly.

const KEYS = {
  agents: "forgeos.session.agents.v2",
  activeAgent: "forgeos.session.activeAgent.v2",
  managedWallet: "forgeos.managed.wallet.v1",
  network: "forgeos.network",
  lastProvider: "forgeos.wallet.lastProvider.mainnet",
} as const;

function chromeStorage() {
  // Works in both Chrome (chrome.storage) and Firefox (browser.storage via polyfill)
  if (typeof chrome !== "undefined" && chrome.storage) return chrome.storage.local;
  return null;
}

export async function getAgents(): Promise<any[]> {
  const store = chromeStorage();
  if (!store) return [];
  return new Promise((resolve) => {
    store.get(KEYS.agents, (result) => {
      try {
        const raw = result[KEYS.agents];
        if (!raw) return resolve([]);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch { resolve([]); }
    });
  });
}

export async function getActiveAgentId(): Promise<string> {
  const store = chromeStorage();
  if (!store) return "";
  return new Promise((resolve) => {
    store.get(KEYS.activeAgent, (result) => resolve(result[KEYS.activeAgent] || ""));
  });
}

export interface ManagedWallet {
  phrase: string;
  address: string;
  network: string;
}

export async function getManagedWallet(): Promise<ManagedWallet | null> {
  const store = chromeStorage();
  if (!store) return null;
  return new Promise((resolve) => {
    store.get(KEYS.managedWallet, (result) => {
      try {
        const raw = result[KEYS.managedWallet];
        if (!raw) return resolve(null);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        resolve(parsed?.address ? parsed : null);
      } catch { resolve(null); }
    });
  });
}

export async function setManagedWallet(data: ManagedWallet): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.managedWallet]: JSON.stringify(data) }, resolve);
  });
}

export async function clearManagedWallet(): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => { store.remove(KEYS.managedWallet, resolve); });
}

export async function getNetwork(): Promise<string> {
  const store = chromeStorage();
  if (!store) return "mainnet";
  return new Promise((resolve) => {
    store.get(KEYS.network, (result) => resolve(result[KEYS.network] || "mainnet"));
  });
}

export async function setAgents(agents: any[]): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.agents]: JSON.stringify(agents) }, resolve);
  });
}
