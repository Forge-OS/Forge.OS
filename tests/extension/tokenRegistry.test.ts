// Phase 6 — Integration tests: Token Registry (Phase 4)
// Tests DEFAULT_REGISTRY structure, accessor functions, and STABLES_ENABLED flag.
// Pure functions — no chrome or browser mocks needed.

import { describe, expect, it } from "vitest";

// ── DEFAULT_REGISTRY structure ────────────────────────────────────────────────

describe("DEFAULT_REGISTRY", () => {
  it("contains KAS, USDT, and USDC entries", async () => {
    const { DEFAULT_REGISTRY } = await import("../../extension/tokens/registry");
    expect(DEFAULT_REGISTRY.tokens.KAS).toBeDefined();
    expect(DEFAULT_REGISTRY.tokens.USDT).toBeDefined();
    expect(DEFAULT_REGISTRY.tokens.USDC).toBeDefined();
  });

  it("KAS is enabled with 8 decimals and null assetId (native)", async () => {
    const { DEFAULT_REGISTRY } = await import("../../extension/tokens/registry");
    const kas = DEFAULT_REGISTRY.tokens.KAS;
    expect(kas.enabled).toBe(true);
    expect(kas.decimals).toBe(8);
    expect(kas.assetId).toBeNull();
    expect(kas.disabledReason).toBeNull();
  });

  it("USDT and USDC are disabled while STABLES_ENABLED = false", async () => {
    const { DEFAULT_REGISTRY, STABLES_ENABLED } = await import("../../extension/tokens/registry");
    expect(STABLES_ENABLED).toBe(false);
    expect(DEFAULT_REGISTRY.tokens.USDT.enabled).toBe(false);
    expect(DEFAULT_REGISTRY.tokens.USDC.enabled).toBe(false);
  });

  it("disabled tokens carry a non-empty disabledReason", async () => {
    const { DEFAULT_REGISTRY } = await import("../../extension/tokens/registry");
    expect(DEFAULT_REGISTRY.tokens.USDT.disabledReason).toBeTruthy();
    expect(DEFAULT_REGISTRY.tokens.USDC.disabledReason).toBeTruthy();
  });

  it("USDT and USDC have 6 decimals", async () => {
    const { DEFAULT_REGISTRY } = await import("../../extension/tokens/registry");
    expect(DEFAULT_REGISTRY.tokens.USDT.decimals).toBe(6);
    expect(DEFAULT_REGISTRY.tokens.USDC.decimals).toBe(6);
  });
});

// ── getToken ──────────────────────────────────────────────────────────────────

describe("getToken", () => {
  it("returns the KAS token definition", async () => {
    const { getToken } = await import("../../extension/tokens/registry");
    const kas = getToken("KAS");
    expect(kas.id).toBe("KAS");
    expect(kas.symbol).toBe("KAS");
    expect(kas.name).toBe("Kaspa");
  });

  it("returns USDT token definition (even when disabled)", async () => {
    const { getToken } = await import("../../extension/tokens/registry");
    const usdt = getToken("USDT");
    expect(usdt.id).toBe("USDT");
    expect(usdt.symbol).toBe("USDT");
  });

  it("returns USDC token definition (even when disabled)", async () => {
    const { getToken } = await import("../../extension/tokens/registry");
    const usdc = getToken("USDC");
    expect(usdc.id).toBe("USDC");
    expect(usdc.symbol).toBe("USDC");
  });
});

// ── isTokenEnabled ─────────────────────────────────────────────────────────────

describe("isTokenEnabled", () => {
  it("returns true for KAS", async () => {
    const { isTokenEnabled } = await import("../../extension/tokens/registry");
    expect(isTokenEnabled("KAS")).toBe(true);
  });

  it("returns false for USDT (STABLES_ENABLED = false)", async () => {
    const { isTokenEnabled } = await import("../../extension/tokens/registry");
    expect(isTokenEnabled("USDT")).toBe(false);
  });

  it("returns false for USDC (STABLES_ENABLED = false)", async () => {
    const { isTokenEnabled } = await import("../../extension/tokens/registry");
    expect(isTokenEnabled("USDC")).toBe(false);
  });
});

// ── getEnabledTokens ───────────────────────────────────────────────────────────

describe("getEnabledTokens", () => {
  it("returns only tokens with enabled=true", async () => {
    const { getEnabledTokens } = await import("../../extension/tokens/registry");
    const enabled = getEnabledTokens();
    expect(enabled.every((t) => t.enabled)).toBe(true);
  });

  it("includes KAS", async () => {
    const { getEnabledTokens } = await import("../../extension/tokens/registry");
    const ids = getEnabledTokens().map((t) => t.id);
    expect(ids).toContain("KAS");
  });

  it("excludes USDT and USDC while STABLES_ENABLED = false", async () => {
    const { getEnabledTokens } = await import("../../extension/tokens/registry");
    const ids = getEnabledTokens().map((t) => t.id);
    expect(ids).not.toContain("USDT");
    expect(ids).not.toContain("USDC");
  });
});

// ── getAllTokens ───────────────────────────────────────────────────────────────

describe("getAllTokens", () => {
  it("returns all tokens regardless of enabled state", async () => {
    const { getAllTokens } = await import("../../extension/tokens/registry");
    const all = getAllTokens();
    const ids = all.map((t) => t.id);
    expect(ids).toContain("KAS");
    expect(ids).toContain("USDT");
    expect(ids).toContain("USDC");
  });

  it("count matches the number of entries in DEFAULT_REGISTRY", async () => {
    const { getAllTokens, DEFAULT_REGISTRY } = await import("../../extension/tokens/registry");
    expect(getAllTokens().length).toBe(Object.keys(DEFAULT_REGISTRY.tokens).length);
  });
});
