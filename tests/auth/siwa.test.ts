// Phase 6 — Integration tests: Sign-In With (Kaspa) Address (SIWA)
// Covers: nonce generation, message format, session lifecycle, expiry, replay protection.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── localStorage mock ─────────────────────────────────────────────────────────
const storage: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
};

beforeEach(() => {
  localStorageMock.clear();
  (globalThis as any).localStorage = localStorageMock;
  vi.resetModules();
});

afterEach(() => {
  delete (globalThis as any).localStorage;
});

// ── Nonce ─────────────────────────────────────────────────────────────────────

describe("generateNonce", () => {
  it("returns a 32-character lowercase hex string", async () => {
    const { generateNonce } = await import("../../src/auth/siwa");
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces unique values on each call", async () => {
    const { generateNonce } = await import("../../src/auth/siwa");
    const nonces = new Set(Array.from({ length: 10 }, () => generateNonce()));
    expect(nonces.size).toBe(10);
  });
});

// ── Message ───────────────────────────────────────────────────────────────────

describe("buildSignInMessage", () => {
  it("includes all required fields", async () => {
    const { buildSignInMessage } = await import("../../src/auth/siwa");
    const msg = buildSignInMessage("kaspa:qtest", "mainnet", "abc123");
    expect(msg).toContain("Sign in to Forge.OS");
    expect(msg).toContain("Domain: forgeos.xyz");
    expect(msg).toContain("Address: kaspa:qtest");
    expect(msg).toContain("Nonce: abc123");
    expect(msg).toContain("Network: mainnet");
    expect(msg).toContain("Issued At:");
    expect(msg).toContain("Expires At:");
    expect(msg).toContain("will not trigger a blockchain transaction");
  });

  it("is domain-bound to forgeos.xyz (anti-phishing)", async () => {
    const { buildSignInMessage } = await import("../../src/auth/siwa");
    const msg = buildSignInMessage("kaspa:q", "mainnet", "n1");
    // Only forgeos.xyz should appear — a phishing page on evil.com cannot replay this
    expect(msg).toContain("Domain: forgeos.xyz");
    expect(msg).not.toMatch(/Domain: (?!forgeos\.xyz)/);
  });

  it("includes expiry ~24h after issuance", async () => {
    const { buildSignInMessage } = await import("../../src/auth/siwa");
    const before = Date.now();
    const msg = buildSignInMessage("kaspa:q", "mainnet", "n1");
    const issuedMatch = msg.match(/Issued At: (.+)/);
    const expiresMatch = msg.match(/Expires At: (.+)/);
    expect(issuedMatch).not.toBeNull();
    expect(expiresMatch).not.toBeNull();
    const issued = new Date(issuedMatch![1].trim()).getTime();
    const expires = new Date(expiresMatch![1].trim()).getTime();
    expect(issued).toBeGreaterThanOrEqual(before);
    expect(expires - issued).toBeCloseTo(24 * 60 * 60 * 1000, -3);
  });

  it("different addresses produce different messages (no cross-address replay)", async () => {
    const { buildSignInMessage } = await import("../../src/auth/siwa");
    const m1 = buildSignInMessage("kaspa:qaddr1", "mainnet", "nonce");
    const m2 = buildSignInMessage("kaspa:qaddr2", "mainnet", "nonce");
    expect(m1).not.toBe(m2);
  });
});

// ── Session ───────────────────────────────────────────────────────────────────

describe("createSession", () => {
  it("creates session with correct public fields only", async () => {
    const { createSession } = await import("../../src/auth/siwa");
    const before = Date.now();
    const s = createSession("kaspa:qtest", "mainnet", "kasware", "nonce1");
    expect(s.address).toBe("kaspa:qtest");
    expect(s.network).toBe("mainnet");
    expect(s.provider).toBe("kasware");
    expect(s.nonce).toBe("nonce1");
    expect(s.signedAt).toBeGreaterThanOrEqual(before);
    expect(s.expiresAt).toBeGreaterThan(s.signedAt);
    // Must not store secrets
    expect((s as any).mnemonic).toBeUndefined();
    expect((s as any).privateKey).toBeUndefined();
    expect((s as any).seed).toBeUndefined();
    expect((s as any).signature).toBeUndefined();
  });

  it("sets skipSigning flag when requested", async () => {
    const { createSession } = await import("../../src/auth/siwa");
    const s = createSession("kaspa:q", "mainnet", "kaspium", "n", true);
    expect(s.skipSigning).toBe(true);
  });

  it("does not set skipSigning by default", async () => {
    const { createSession } = await import("../../src/auth/siwa");
    const s = createSession("kaspa:q", "mainnet", "kasware", "n");
    expect(s.skipSigning).toBeFalsy();
  });

  it("session TTL is 24 hours", async () => {
    const { createSession } = await import("../../src/auth/siwa");
    const s = createSession("kaspa:q", "mainnet", "kasware", "n");
    const ttl = s.expiresAt - s.signedAt;
    const expected = 24 * 60 * 60 * 1000;
    expect(ttl).toBeGreaterThanOrEqual(expected - 100);
    expect(ttl).toBeLessThanOrEqual(expected + 100);
  });
});

describe("saveSession + loadSession", () => {
  it("round-trips a valid session", async () => {
    const { createSession, saveSession, loadSession } = await import("../../src/auth/siwa");
    const s = createSession("kaspa:qtest", "mainnet", "kasware", "nonce1");
    saveSession(s);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.address).toBe("kaspa:qtest");
    expect(loaded!.nonce).toBe("nonce1");
    expect(loaded!.provider).toBe("kasware");
  });

  it("returns null when no session saved", async () => {
    const { loadSession } = await import("../../src/auth/siwa");
    expect(loadSession()).toBeNull();
  });

  it("returns null for expired session and clears it", async () => {
    const { loadSession } = await import("../../src/auth/siwa");
    const expired = {
      address: "kaspa:qtest",
      network: "mainnet",
      provider: "kasware",
      nonce: "n1",
      signedAt: Date.now() - 100_000,
      expiresAt: Date.now() - 1, // past
    };
    storage["forgeos.signin.session.v1"] = JSON.stringify(expired);
    expect(loadSession()).toBeNull();
    // Must be evicted from storage
    expect(storage["forgeos.signin.session.v1"]).toBeUndefined();
  });

  it("returns null for malformed JSON", async () => {
    const { loadSession } = await import("../../src/auth/siwa");
    storage["forgeos.signin.session.v1"] = "{not valid json";
    expect(loadSession()).toBeNull();
  });

  it("returns null for session missing required fields", async () => {
    const { loadSession } = await import("../../src/auth/siwa");
    storage["forgeos.signin.session.v1"] = JSON.stringify({ address: "kaspa:q" });
    expect(loadSession()).toBeNull();
  });
});

describe("clearSession", () => {
  it("removes an existing session", async () => {
    const { createSession, saveSession, clearSession, loadSession } = await import("../../src/auth/siwa");
    saveSession(createSession("kaspa:q", "mainnet", "kasware", "n"));
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it("is a no-op when no session exists", async () => {
    const { clearSession } = await import("../../src/auth/siwa");
    expect(() => clearSession()).not.toThrow();
  });
});
