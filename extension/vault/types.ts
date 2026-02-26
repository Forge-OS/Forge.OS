// Vault type definitions — no plaintext secrets ever leave this boundary.

/**
 * Persisted to chrome.storage.local.
 * Contains ONLY encrypted ciphertext + KDF parameters.
 * Mnemonic/private key is NEVER stored here in plaintext.
 */
export interface EncryptedVault {
  version: 1;
  kdf: "pbkdf2";
  salt: string;        // hex-encoded, 32 bytes
  iterations: number;  // PBKDF2 iteration count (600_000)
  hash: "SHA-256";
  iv: string;          // hex-encoded, 12 bytes (AES-GCM nonce)
  // AES-256-GCM output — plaintext + 16-byte auth tag appended by SubtleCrypto
  ciphertext: string;  // hex-encoded
  createdAt: number;   // Unix ms
  updatedAt: number;   // Unix ms
}

/**
 * The plaintext payload encrypted inside the vault.
 * Only ever exists in memory while unlocked.
 */
export interface VaultPayload {
  version: 1;
  mnemonic: string;
  address: string;      // Derived receive address (index 0)
  network: "mainnet" | "testnet-10";
  derivationPath: string; // "m/44'/111'/0'"
  addressIndex: number;   // 0
}

/**
 * In-memory unlocked session — never persisted to any storage.
 * Cleared immediately on lock.
 */
export interface UnlockedSession {
  mnemonic: string;
  address: string;
  network: string;
  autoLockAt: number; // Unix ms — session expires at this timestamp
}
