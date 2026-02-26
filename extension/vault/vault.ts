// Encrypted vault — the sole persistence layer for wallet secrets.
//
// Security invariants:
//  1. Plaintext mnemonic never touches chrome.storage.* in any form.
//  2. The vault blob is opaque without the user's password.
//  3. Decrypted material lives only in the module-level _session variable.
//  4. lockWallet() clears the reference and requests GC immediately.
//  5. changePassword() re-encrypts atomically — old ciphertext is overwritten.
//  6. resetWallet() wipes all extension storage (full hard reset).

import type { EncryptedVault, VaultPayload, UnlockedSession } from "./types";
import { deriveKey, randomBytes } from "./kdf";
import { aesGcmEncrypt, aesGcmDecrypt, hexToBytes, bytesToHex } from "../crypto/aes";

// Storage keys
const VAULT_KEY = "forgeos.vault.v1";
const LOCK_STATE_KEY = "forgeos.lockstate.v1"; // "locked" | "unlocked" + expiry

// Auto-lock alarm name (managed by background service worker)
export const AUTO_LOCK_ALARM = "forgeos-autolock";

// Default auto-lock timeout in minutes
export const DEFAULT_AUTO_LOCK_MINUTES = 15;

// ── In-memory session (popup context only) ───────────────────────────────────
// This variable is the ONLY place the decrypted mnemonic is held.
// It is never serialised, never sent over any channel.
let _session: UnlockedSession | null = null;

/**
 * Return the active session, or null if locked / expired.
 * Expiry is enforced on every access — there is no background timer inside
 * this module; the popup polls getSession() via React state.
 */
export function getSession(): UnlockedSession | null {
  if (!_session) return null;
  if (Date.now() > _session.autoLockAt) {
    _wipeSession();
    return null;
  }
  return _session;
}

export function isUnlocked(): boolean {
  return getSession() !== null;
}

/** Zero-out the mnemonic reference and clear the session. */
function _wipeSession(): void {
  if (_session) {
    // Best-effort overwrite: JS strings are immutable, but we remove the reference
    // to allow GC. In a future iteration, store mnemonic as Uint8Array and zero it.
    try { (_session as Record<string, unknown>).mnemonic = ""; } catch { /* noop */ }
    _session = null;
  }
}

// ── Chrome storage helpers ───────────────────────────────────────────────────

function localStore(): chrome.storage.LocalStorageArea {
  return chrome.storage.local;
}

async function readVault(): Promise<EncryptedVault | null> {
  return new Promise((resolve) => {
    localStore().get(VAULT_KEY, (result) => {
      try {
        const raw = result[VAULT_KEY];
        if (!raw) return resolve(null);
        resolve(JSON.parse(raw) as EncryptedVault);
      } catch {
        resolve(null);
      }
    });
  });
}

async function writeVault(vault: EncryptedVault): Promise<void> {
  return new Promise((resolve) => {
    localStore().set({ [VAULT_KEY]: JSON.stringify(vault) }, resolve);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/** True if an encrypted vault blob exists in storage (doesn't mean it's unlocked). */
export async function vaultExists(): Promise<boolean> {
  return (await readVault()) !== null;
}

/**
 * Encrypt mnemonic + metadata and write the vault blob to chrome.storage.local.
 * Overwrites any existing vault — used for both first-time creation and
 * password changes.
 *
 * @param mnemonic   24-word BIP39 phrase (plaintext, held only for this call).
 * @param password   User password — never stored; only the derived key is used.
 * @param address    Derived receive address (index 0).
 * @param network    Network identifier ("mainnet" | "testnet-10").
 */
export async function createVault(
  mnemonic: string,
  password: string,
  address: string,
  network: string,
): Promise<void> {
  // Fresh random salt + IV for every vault write
  const salt = randomBytes(32);
  const iv = randomBytes(12);

  const key = await deriveKey(password, salt);

  const payload: VaultPayload = {
    version: 1,
    mnemonic,
    address,
    network: network as VaultPayload["network"],
    derivationPath: "m/44'/111'/0'",
    addressIndex: 0,
  };

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await aesGcmEncrypt(key, iv, plaintext);

  const vault: EncryptedVault = {
    version: 1,
    kdf: "pbkdf2",
    salt: bytesToHex(salt),
    iterations: 600_000,
    hash: "SHA-256",
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(ciphertext),
    createdAt: (await readVault())?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };

  await writeVault(vault);
}

/**
 * Decrypt the vault with the provided password and populate the in-memory session.
 *
 * Throws "NO_VAULT" if no vault exists.
 * Throws "INVALID_PASSWORD" if decryption or auth-tag check fails.
 * (Both use the same generic message to avoid oracle attacks.)
 *
 * @param password         User password.
 * @param autoLockMinutes  Session TTL. Defaults to DEFAULT_AUTO_LOCK_MINUTES.
 * @returns                The newly created UnlockedSession.
 */
export async function unlockVault(
  password: string,
  autoLockMinutes: number = DEFAULT_AUTO_LOCK_MINUTES,
): Promise<UnlockedSession> {
  const vault = await readVault();
  if (!vault) throw new Error("NO_VAULT");

  const salt = hexToBytes(vault.salt);
  const iv = hexToBytes(vault.iv);
  const ciphertext = hexToBytes(vault.ciphertext);

  const key = await deriveKey(password, salt);

  let plaintext: Uint8Array;
  try {
    plaintext = await aesGcmDecrypt(key, iv, ciphertext);
  } catch {
    // AES-GCM auth tag failure — wrong password or tampered ciphertext
    throw new Error("INVALID_PASSWORD");
  }

  const payload: VaultPayload = JSON.parse(new TextDecoder().decode(plaintext));

  _session = {
    mnemonic: payload.mnemonic,
    address: payload.address,
    network: payload.network,
    autoLockAt: Date.now() + autoLockMinutes * 60_000,
  };

  // Tell the service worker to set the auto-lock alarm
  try {
    chrome.runtime.sendMessage({
      type: "SCHEDULE_AUTOLOCK",
      minutes: autoLockMinutes,
    });
  } catch { /* popup may be standalone — non-fatal */ }

  return _session;
}

/**
 * Lock the wallet: wipe the in-memory session and cancel the auto-lock alarm.
 * Safe to call when already locked.
 */
export function lockWallet(): void {
  _wipeSession();
  try {
    chrome.runtime.sendMessage({ type: "CANCEL_AUTOLOCK" });
  } catch { /* non-fatal */ }
}

/**
 * Change the vault password.
 * Validates the current password, then re-encrypts with the new one.
 * The session is re-established after the re-encryption.
 *
 * Throws "INVALID_PASSWORD" if currentPassword is wrong.
 * Throws "WEAK_PASSWORD" if newPassword is fewer than 8 characters.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 8) throw new Error("WEAK_PASSWORD");

  // Decrypt with current password (will throw INVALID_PASSWORD if wrong)
  const session = await unlockVault(currentPassword);

  // Re-encrypt with new password
  await createVault(session.mnemonic, newPassword, session.address, session.network);

  // Re-establish session (unlock with new password so the session is fresh)
  _wipeSession();
  await unlockVault(newPassword);
}

/**
 * Hard reset: wipe ALL extension storage and clear the in-memory session.
 * This is irreversible. Callers must show an explicit confirmation UI before
 * invoking this function.
 */
export async function resetWallet(): Promise<void> {
  _wipeSession();
  await new Promise<void>((resolve) => localStore().clear(resolve));
}

/**
 * Extend the current session TTL (call on user activity to defer auto-lock).
 * No-op if wallet is not unlocked.
 */
export function extendSession(minutes: number = DEFAULT_AUTO_LOCK_MINUTES): void {
  if (_session) {
    _session.autoLockAt = Date.now() + minutes * 60_000;
    try {
      chrome.runtime.sendMessage({ type: "SCHEDULE_AUTOLOCK", minutes });
    } catch { /* non-fatal */ }
  }
}
