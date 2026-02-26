// Phase 6 — Integration tests: Vault (Phase 0)
// Tests createVault, unlockVault, lockWallet, resetWallet, changePassword, extendSession.
//
// chrome.storage.local → mocked with an in-memory store.
// PBKDF2 → vi.mock replaces kdf.ts with 1-iteration version (600k → 1) for speed.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── PBKDF2 speed mock ─────────────────────────────────────────────────────────
// Replaces the 600,000-iteration KDF with a 1-iteration version so tests run
// in milliseconds instead of seconds. The crypto operations are otherwise identical.
vi.mock("../../extension/vault/kdf", () => ({
  deriveKey: async (password: string, salt: Uint8Array) => {
    const enc = new TextEncoder();
    const passKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 1, hash: "SHA-256" },
      passKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  },
  randomBytes: (length: number) => crypto.getRandomValues(new Uint8Array(length)),
}));

// ── chrome mock ───────────────────────────────────────────────────────────────
const _store: Record<string, string> = {};
const _sendMessages: any[] = [];

(globalThis as any).chrome = {
  storage: {
    local: {
      get: (key: string, cb: (r: Record<string, unknown>) => void) => {
        cb({ [key]: _store[key] });
      },
      set: (items: Record<string, string>, cb: () => void) => {
        Object.assign(_store, items);
        cb();
      },
      clear: (cb: () => void) => {
        Object.keys(_store).forEach((k) => delete _store[k]);
        cb();
      },
      remove: (key: string, cb: () => void) => {
        delete _store[key];
        cb();
      },
    },
  },
  runtime: {
    sendMessage: (msg: any) => { _sendMessages.push(msg); },
    lastError: undefined,
  },
};

// ── Test fixtures ─────────────────────────────────────────────────────────────
const MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PASSWORD = "TestPassword123!";
const ADDRESS = "kaspa:qtest000000000000000000000";
const NETWORK = "testnet-10";

beforeEach(() => {
  Object.keys(_store).forEach((k) => delete _store[k]);
  _sendMessages.length = 0;
  vi.resetModules();
  vi.useRealTimers();
});

// ── vaultExists ───────────────────────────────────────────────────────────────

describe("vaultExists", () => {
  it("returns false when no vault stored", async () => {
    const { vaultExists } = await import("../../extension/vault/vault");
    expect(await vaultExists()).toBe(false);
  });

  it("returns true after createVault", async () => {
    const { createVault, vaultExists } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    expect(await vaultExists()).toBe(true);
  });
});

// ── createVault + unlockVault ─────────────────────────────────────────────────

describe("createVault + unlockVault", () => {
  it("creates and unlocks with correct password, returning mnemonic + address", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    const session = await unlockVault(PASSWORD);
    expect(session.mnemonic).toBe(MNEMONIC);
    expect(session.address).toBe(ADDRESS);
    expect(session.network).toBe(NETWORK);
    expect(session.autoLockAt).toBeGreaterThan(Date.now());
  });

  it("throws INVALID_PASSWORD for wrong password", async () => {
    const { createVault, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    await expect(unlockVault("wrong-password")).rejects.toThrow("INVALID_PASSWORD");
  });

  it("throws NO_VAULT when storage is empty", async () => {
    const { unlockVault } = await import("../../extension/vault/vault");
    await expect(unlockVault(PASSWORD)).rejects.toThrow("NO_VAULT");
  });

  it("each createVault call uses a fresh salt (ciphertexts differ)", async () => {
    const { createVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    const blob1 = _store["forgeos.vault.v1"];
    // Reset only the module-level cache; keep storage to simulate re-encryption
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    const blob2 = _store["forgeos.vault.v1"];
    expect(blob1).not.toBe(blob2);
  });
});

// ── getSession / isUnlocked ───────────────────────────────────────────────────

describe("getSession / isUnlocked", () => {
  it("returns null and isUnlocked=false before any unlock", async () => {
    const { getSession, isUnlocked } = await import("../../extension/vault/vault");
    expect(getSession()).toBeNull();
    expect(isUnlocked()).toBe(false);
  });

  it("returns session and isUnlocked=true after unlock", async () => {
    const { createVault, unlockVault, getSession, isUnlocked } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    await unlockVault(PASSWORD);
    expect(getSession()).not.toBeNull();
    expect(isUnlocked()).toBe(true);
  });
});

// ── lockWallet ────────────────────────────────────────────────────────────────

describe("lockWallet", () => {
  it("clears the in-memory session after lock", async () => {
    const { createVault, unlockVault, lockWallet, getSession } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    await unlockVault(PASSWORD);
    lockWallet();
    expect(getSession()).toBeNull();
  });

  it("is safe to call when already locked (no-op, no throw)", async () => {
    const { lockWallet } = await import("../../extension/vault/vault");
    expect(() => lockWallet()).not.toThrow();
  });

  it("vault blob remains in storage after lock (lock ≠ wipe)", async () => {
    const { createVault, unlockVault, lockWallet, vaultExists } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    await unlockVault(PASSWORD);
    lockWallet();
    expect(await vaultExists()).toBe(true); // data survives, only session cleared
  });
});

// ── Session auto-expiry ────────────────────────────────────────────────────────

describe("session auto-expiry", () => {
  it("getSession returns null once autoLockAt is in the past", async () => {
    const { createVault, unlockVault, getSession } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    await unlockVault(PASSWORD, 15);
    const session = getSession()!;
    expect(session).not.toBeNull();
    // Freeze system clock to 1 ms after TTL
    vi.useFakeTimers({ now: session.autoLockAt + 1 });
    expect(getSession()).toBeNull(); // expired → wiped
  });
});

// ── changePassword ─────────────────────────────────────────────────────────────

describe("changePassword", () => {
  it("re-encrypts with new password — new password works, old fails", async () => {
    const { createVault, changePassword, unlockVault } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    await changePassword(PASSWORD, "NewPassword456!");
    const session = await unlockVault("NewPassword456!");
    expect(session.mnemonic).toBe(MNEMONIC);
    await expect(unlockVault(PASSWORD)).rejects.toThrow("INVALID_PASSWORD");
  });

  it("throws WEAK_PASSWORD for passwords shorter than 8 chars", async () => {
    const { createVault, changePassword } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    await expect(changePassword(PASSWORD, "short")).rejects.toThrow("WEAK_PASSWORD");
  });

  it("throws INVALID_PASSWORD when currentPassword is wrong", async () => {
    const { createVault, changePassword } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    await expect(changePassword("wrong", "NewPassword456!")).rejects.toThrow("INVALID_PASSWORD");
  });
});

// ── resetWallet ────────────────────────────────────────────────────────────────

describe("resetWallet", () => {
  it("wipes storage and clears in-memory session", async () => {
    const { createVault, unlockVault, resetWallet, vaultExists, isUnlocked } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    await unlockVault(PASSWORD);
    expect(isUnlocked()).toBe(true);
    await resetWallet();
    expect(isUnlocked()).toBe(false);
    expect(await vaultExists()).toBe(false);
  });

  it("is safe to call with no vault (no-op, no throw)", async () => {
    const { resetWallet } = await import("../../extension/vault/vault");
    await expect(resetWallet()).resolves.toBeUndefined();
  });
});

// ── extendSession ─────────────────────────────────────────────────────────────

describe("extendSession", () => {
  it("extends autoLockAt of the active session", async () => {
    const { createVault, unlockVault, getSession, extendSession } = await import("../../extension/vault/vault");
    await createVault(MNEMONIC, PASSWORD, ADDRESS, NETWORK);
    await unlockVault(PASSWORD, 15);
    const before = getSession()!.autoLockAt;
    extendSession(30);
    const after = getSession()!.autoLockAt;
    expect(after).toBeGreaterThan(before);
  });

  it("is a no-op when wallet is locked (no throw)", async () => {
    const { extendSession } = await import("../../extension/vault/vault");
    expect(() => extendSession(30)).not.toThrow();
  });
});
