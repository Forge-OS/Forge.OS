// AES-256-GCM primitives via Web Crypto API.
// All functions are pure — no global state, no side effects.
// Works in extension popup, background service worker, and content script contexts.

/** Decode a hex string to a Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string length");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/** Encode a Uint8Array to a lowercase hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * The returned ciphertext includes the 16-byte GCM auth tag appended by SubtleCrypto.
 *
 * @param key   A CryptoKey with algorithm AES-GCM and "encrypt" usage.
 * @param iv    12-byte random nonce. Must be unique per (key, plaintext) pair.
 * @param data  Plaintext bytes to encrypt.
 * @returns     Ciphertext bytes (length = data.length + 16).
 */
export async function aesGcmEncrypt(
  key: CryptoKey,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return new Uint8Array(buf);
}

/**
 * Decrypt AES-256-GCM ciphertext.
 * Throws a DOMException if the auth tag check fails (tampered ciphertext or wrong key).
 *
 * @param key        A CryptoKey with algorithm AES-GCM and "decrypt" usage.
 * @param iv         The same 12-byte nonce used during encryption.
 * @param ciphertext Ciphertext bytes produced by aesGcmEncrypt.
 * @returns          Plaintext bytes.
 */
export async function aesGcmDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new Uint8Array(buf);
}
