// Phase 6 — Integration tests: AES-256-GCM encryption layer (Phase 0 Security)
// Tests aes.ts encrypt/decrypt round-trips, authentication tag verification,
// and the kdf.ts key derivation (with a fast iteration count for test speed).
// Requires Node.js ≥18 for native globalThis.crypto.subtle.

import { describe, expect, it } from "vitest";

// ── AES-256-GCM ───────────────────────────────────────────────────────────────

describe("aes — hexToBytes / bytesToHex", () => {
  it("round-trips arbitrary byte sequences", async () => {
    const { hexToBytes, bytesToHex } = await import("../../extension/crypto/aes");
    const original = "deadbeef0102030405060708090a0b0c";
    expect(bytesToHex(hexToBytes(original))).toBe(original);
  });

  it("hexToBytes produces correct byte values", async () => {
    const { hexToBytes } = await import("../../extension/crypto/aes");
    const bytes = hexToBytes("0102ff");
    expect(bytes[0]).toBe(1);
    expect(bytes[1]).toBe(2);
    expect(bytes[2]).toBe(255);
  });
});

describe("aes — aesGcmEncrypt / aesGcmDecrypt", () => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  async function makeKey(): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      crypto.getRandomValues(new Uint8Array(32)),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  }

  it("encrypt then decrypt returns original plaintext", async () => {
    const { aesGcmEncrypt, aesGcmDecrypt } = await import("../../extension/crypto/aes");
    const key = await makeKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = "Hello, Forge-OS!";
    const ciphertext = await aesGcmEncrypt(key, iv, enc.encode(plaintext));
    const decrypted = await aesGcmDecrypt(key, iv, ciphertext);
    expect(dec.decode(decrypted)).toBe(plaintext);
  });

  it("encrypt produces different ciphertext for different IVs", async () => {
    const { aesGcmEncrypt, bytesToHex } = await import("../../extension/crypto/aes");
    const key = await makeKey();
    const iv1 = crypto.getRandomValues(new Uint8Array(12));
    const iv2 = crypto.getRandomValues(new Uint8Array(12));
    const data = enc.encode("same message");
    const c1 = bytesToHex(await aesGcmEncrypt(key, iv1, data));
    const c2 = bytesToHex(await aesGcmEncrypt(key, iv2, data));
    expect(c1).not.toBe(c2);
  });

  it("decrypt with wrong key throws (authentication tag mismatch)", async () => {
    const { aesGcmEncrypt, aesGcmDecrypt } = await import("../../extension/crypto/aes");
    const correctKey = await makeKey();
    const wrongKey = await makeKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await aesGcmEncrypt(correctKey, iv, enc.encode("secret"));
    await expect(aesGcmDecrypt(wrongKey, iv, ciphertext)).rejects.toThrow();
  });

  it("decrypt with tampered ciphertext throws", async () => {
    const { aesGcmEncrypt, aesGcmDecrypt } = await import("../../extension/crypto/aes");
    const key = await makeKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await aesGcmEncrypt(key, iv, enc.encode("tamper me"));
    // Flip the last byte of the auth tag
    const tampered = new Uint8Array(ciphertext);
    tampered[tampered.length - 1] ^= 0xff;
    await expect(aesGcmDecrypt(key, iv, tampered)).rejects.toThrow();
  });

  it("empty string round-trips correctly", async () => {
    const { aesGcmEncrypt, aesGcmDecrypt } = await import("../../extension/crypto/aes");
    const key = await makeKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await aesGcmEncrypt(key, iv, enc.encode(""));
    const result = await aesGcmDecrypt(key, iv, ct);
    expect(dec.decode(result)).toBe("");
  });

  it("long JSON payload round-trips correctly", async () => {
    const { aesGcmEncrypt, aesGcmDecrypt } = await import("../../extension/crypto/aes");
    const key = await makeKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = JSON.stringify({ mnemonic: "word ".repeat(24).trim(), address: "kaspa:qtest" });
    const ct = await aesGcmEncrypt(key, iv, enc.encode(payload));
    expect(dec.decode(await aesGcmDecrypt(key, iv, ct))).toBe(payload);
  });
});

// ── KDF — randomBytes ─────────────────────────────────────────────────────────

describe("kdf — randomBytes", () => {
  it("produces the requested number of bytes", async () => {
    const { randomBytes } = await import("../../extension/vault/kdf");
    expect(randomBytes(16).length).toBe(16);
    expect(randomBytes(32).length).toBe(32);
  });

  it("produces unique values on each call", async () => {
    const { randomBytes } = await import("../../extension/vault/kdf");
    const a = Array.from(randomBytes(16)).join(",");
    const b = Array.from(randomBytes(16)).join(",");
    expect(a).not.toBe(b);
  });
});

describe("kdf — deriveKey", () => {
  it("returns a non-extractable AES-GCM CryptoKey", async () => {
    const { deriveKey, randomBytes } = await import("../../extension/vault/kdf");
    const salt = randomBytes(32);
    const key = await deriveKey("test-password", salt);
    expect(key.type).toBe("secret");
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe("AES-GCM");
  });

  it("same password + salt always produces a key that decrypts successfully", async () => {
    // We can't extract and compare key bytes (non-extractable), so we verify by
    // encrypting with key1 and decrypting with key2 (same inputs → same key).
    const { deriveKey, randomBytes } = await import("../../extension/vault/kdf");
    const { aesGcmEncrypt, aesGcmDecrypt } = await import("../../extension/crypto/aes");
    const e = new TextEncoder();
    const d = new TextDecoder();
    const salt = randomBytes(32);
    const password = "hunter2";
    const key1 = await deriveKey(password, salt);
    const key2 = await deriveKey(password, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await aesGcmEncrypt(key1, iv, e.encode("round-trip"));
    expect(d.decode(await aesGcmDecrypt(key2, iv, ct))).toBe("round-trip");
  });

  it("different passwords produce keys that fail to decrypt each other", async () => {
    const { deriveKey, randomBytes } = await import("../../extension/vault/kdf");
    const { aesGcmEncrypt, aesGcmDecrypt } = await import("../../extension/crypto/aes");
    const salt = randomBytes(32);
    const key1 = await deriveKey("password-A", salt);
    const key2 = await deriveKey("password-B", salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await aesGcmEncrypt(key1, iv, new TextEncoder().encode("secret"));
    await expect(aesGcmDecrypt(key2, iv, ct)).rejects.toThrow();
  });
});
