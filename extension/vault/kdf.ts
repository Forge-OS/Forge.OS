// Key derivation — PBKDF2-SHA-256 via Web Crypto API.
// 600,000 iterations satisfies OWASP 2023 guidance for password-derived AES keys.
// Works across all browser extension contexts (popup, service worker, content).

const ITERATIONS = 600_000;
const KEY_USAGE_ENCRYPT: KeyUsage[] = ["encrypt", "decrypt"];

/**
 * Derive a 256-bit AES-GCM key from a password + salt.
 *
 * The returned CryptoKey is non-extractable and usable only for AES-GCM
 * encrypt/decrypt operations. It is never stored — only held in memory for
 * the duration of a single vault open/close operation.
 *
 * @param password  User password string (UTF-8 encoded internally).
 * @param salt      32-byte random salt stored with the vault blob.
 * @returns         Non-extractable AES-GCM CryptoKey.
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder();

  // Import raw password bytes as a PBKDF2 base key
  const passKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,           // not extractable
    ["deriveKey"],
  );

  // Derive the AES-256-GCM key
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    passKey,
    { name: "AES-GCM", length: 256 },
    false,           // not extractable — key bytes never leave SubtleCrypto
    KEY_USAGE_ENCRYPT,
  );
}

/**
 * Generate cryptographically secure random bytes using the browser CSPRNG.
 */
export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}
