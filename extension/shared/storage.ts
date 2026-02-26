// Typed chrome.storage.local wrappers.
// SECURITY: ManagedWallet no longer carries a phrase field.
// The mnemonic lives exclusively in the encrypted vault (forgeos.vault.v1).
// The content bridge syncs only non-sensitive metadata (address, network, agents).

const KEYS = {
  agents: "forgeos.session.agents.v2",
  activeAgent: "forgeos.session.activeAgent.v2",
  // Wallet address + network only — phrase is in the vault, never here
  walletMeta: "forgeos.wallet.meta.v2",
  network: "forgeos.network",
  lastProvider: "forgeos.wallet.lastProvider.mainnet",
  // Auto-lock settings (minutes)
  autoLockMinutes: "forgeos.autolock.minutes.v1",
} as const;

function chromeStorage(): chrome.storage.LocalStorageArea | null {
  if (typeof chrome !== "undefined" && chrome.storage) return chrome.storage.local;
  return null;
}

// ── Agents ───────────────────────────────────────────────────────────────────

export async function getAgents(): Promise<unknown[]> {
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

export async function setAgents(agents: unknown[]): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.agents]: JSON.stringify(agents) }, resolve);
  });
}

export async function getActiveAgentId(): Promise<string> {
  const store = chromeStorage();
  if (!store) return "";
  return new Promise((resolve) => {
    store.get(KEYS.activeAgent, (result) => resolve(result[KEYS.activeAgent] || ""));
  });
}

// ── Wallet metadata (address + network ONLY — no phrase) ─────────────────────

/**
 * Non-sensitive wallet metadata stored in chrome.storage.local.
 * The mnemonic is NEVER included here — it lives in the encrypted vault.
 */
export interface WalletMeta {
  address: string;
  network: string;
}

export async function getWalletMeta(): Promise<WalletMeta | null> {
  const store = chromeStorage();
  if (!store) return null;
  return new Promise((resolve) => {
    store.get(KEYS.walletMeta, (result) => {
      try {
        const raw = result[KEYS.walletMeta];
        if (!raw) return resolve(null);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        resolve(parsed?.address ? (parsed as WalletMeta) : null);
      } catch { resolve(null); }
    });
  });
}

export async function setWalletMeta(meta: WalletMeta): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.walletMeta]: JSON.stringify(meta) }, resolve);
  });
}

export async function clearWalletMeta(): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.remove(KEYS.walletMeta, resolve);
  });
}

// ── Network ───────────────────────────────────────────────────────────────────

export async function getNetwork(): Promise<string> {
  const store = chromeStorage();
  if (!store) return "mainnet";
  return new Promise((resolve) => {
    store.get(KEYS.network, (result) => resolve(result[KEYS.network] || "mainnet"));
  });
}

export async function setNetwork(network: string): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.network]: network }, resolve);
  });
}

// ── Auto-lock settings ────────────────────────────────────────────────────────

export async function getAutoLockMinutes(): Promise<number> {
  const store = chromeStorage();
  if (!store) return 15;
  return new Promise((resolve) => {
    store.get(KEYS.autoLockMinutes, (result) => {
      const val = result[KEYS.autoLockMinutes];
      resolve(typeof val === "number" ? val : 15);
    });
  });
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  const store = chromeStorage();
  if (!store) return;
  return new Promise((resolve) => {
    store.set({ [KEYS.autoLockMinutes]: minutes }, resolve);
  });
}

// ── Legacy shim ───────────────────────────────────────────────────────────────
// Kept for backward compatibility during migration. Remove after one release cycle.

/** @deprecated Use getWalletMeta() — phrase field is always undefined. */
export interface ManagedWallet {
  address: string;
  network: string;
  phrase?: never; // Explicitly forbidden — phrase lives in the vault only
}

/** @deprecated Use getWalletMeta(). */
export async function getManagedWallet(): Promise<ManagedWallet | null> {
  return getWalletMeta();
}

/** @deprecated Use setWalletMeta(). */
export async function setManagedWallet(data: Pick<ManagedWallet, "address" | "network">): Promise<void> {
  return setWalletMeta(data);
}

/** @deprecated Use resetWallet() from vault/vault.ts for a full wipe. */
export async function clearManagedWallet(): Promise<void> {
  return clearWalletMeta();
}
