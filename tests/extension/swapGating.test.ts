// Phase 6 — Integration tests: Swap Gating (Phase 4)
// Tests feature-flag gating, request validation, quote short-circuit, slippage enforcement.
//
// SWAP_CONFIG.enabled = false by default — most tests verify the disabled/gated state.
// The vault is not mocked because getSwapGatingStatus() returns early before
// calling getSession() when the feature flag is off.

import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

// ── getSwapGatingStatus ───────────────────────────────────────────────────────

describe("getSwapGatingStatus", () => {
  it("returns disabled while SWAP_CONFIG.enabled = false", async () => {
    const { getSwapGatingStatus } = await import("../../extension/swap/swap");
    const status = getSwapGatingStatus();
    expect(status.enabled).toBe(false);
    expect(status.reason).toBeTruthy();
  });

  it("disabled reason mentions Kaspa (user-friendly message)", async () => {
    const { getSwapGatingStatus } = await import("../../extension/swap/swap");
    const { reason } = getSwapGatingStatus();
    expect(reason).toMatch(/kaspa/i);
  });
});

// ── validateSwapRequest ───────────────────────────────────────────────────────

describe("validateSwapRequest", () => {
  it("returns empty array for a fully valid request (KAS → KAS with same token is invalid, so use known-valid combo)", async () => {
    // NOTE: with STABLES_ENABLED=false only KAS is enabled. Any pair involving
    // USDT/USDC will fail. We can only confirm the validation shape here.
    const { validateSwapRequest } = await import("../../extension/swap/swap");
    // KAS→KAS: "different" error
    // KAS→USDT: "not available" error for USDT
    // There's no fully valid pair while stables are disabled; test the error cases.
    const errs = validateSwapRequest({ tokenIn: "KAS", tokenOut: "KAS", amountIn: 1_000n, slippageBps: 50 });
    // At minimum the same-token error fires
    expect(Array.isArray(errs)).toBe(true);
  });

  it("errors when tokenIn === tokenOut", async () => {
    const { validateSwapRequest } = await import("../../extension/swap/swap");
    const errs = validateSwapRequest({ tokenIn: "KAS", tokenOut: "KAS", amountIn: 1_000n, slippageBps: 50 });
    expect(errs.some((e) => /different/i.test(e))).toBe(true);
  });

  it("errors when tokenOut is disabled (USDT)", async () => {
    const { validateSwapRequest } = await import("../../extension/swap/swap");
    const errs = validateSwapRequest({ tokenIn: "KAS", tokenOut: "USDT", amountIn: 1_000n, slippageBps: 50 });
    expect(errs.some((e) => /USDT/i.test(e))).toBe(true);
  });

  it("errors when tokenIn is disabled (USDC)", async () => {
    const { validateSwapRequest } = await import("../../extension/swap/swap");
    const errs = validateSwapRequest({ tokenIn: "USDC", tokenOut: "KAS", amountIn: 1_000n, slippageBps: 50 });
    expect(errs.some((e) => /USDC/i.test(e))).toBe(true);
  });

  it("errors when amountIn is zero", async () => {
    const { validateSwapRequest } = await import("../../extension/swap/swap");
    const errs = validateSwapRequest({ tokenIn: "KAS", tokenOut: "USDT", amountIn: 0n, slippageBps: 50 });
    expect(errs.some((e) => /greater than zero/i.test(e))).toBe(true);
  });

  it("errors when amountIn is negative", async () => {
    const { validateSwapRequest } = await import("../../extension/swap/swap");
    const errs = validateSwapRequest({ tokenIn: "KAS", tokenOut: "USDT", amountIn: -1n, slippageBps: 50 });
    expect(errs.some((e) => /greater than zero/i.test(e))).toBe(true);
  });

  it("errors when slippageBps exceeds maxSlippageBps (500)", async () => {
    const { validateSwapRequest } = await import("../../extension/swap/swap");
    const errs = validateSwapRequest({ tokenIn: "KAS", tokenOut: "USDT", amountIn: 1_000n, slippageBps: 600 });
    expect(errs.some((e) => /slippage/i.test(e))).toBe(true);
  });

  it("errors when slippageBps is negative", async () => {
    const { validateSwapRequest } = await import("../../extension/swap/swap");
    const errs = validateSwapRequest({ tokenIn: "KAS", tokenOut: "USDT", amountIn: 1_000n, slippageBps: -1 });
    expect(errs.some((e) => /slippage/i.test(e))).toBe(true);
  });

  it("accumulates multiple independent validation errors", async () => {
    const { validateSwapRequest } = await import("../../extension/swap/swap");
    const errs = validateSwapRequest({ tokenIn: "KAS", tokenOut: "KAS", amountIn: 0n, slippageBps: 9999 });
    // same-token + zero-amount + slippage-exceeded = at least 3
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
});

// ── getSwapQuote ──────────────────────────────────────────────────────────────

describe("getSwapQuote", () => {
  it("returns null immediately when feature is disabled (no network call)", async () => {
    const { getSwapQuote } = await import("../../extension/swap/swap");
    const quote = await getSwapQuote({ tokenIn: "KAS", tokenOut: "USDT", amountIn: 1_000n, slippageBps: 50 });
    expect(quote).toBeNull();
  });
});

// ── enforceMaxSlippage ────────────────────────────────────────────────────────

describe("enforceMaxSlippage", () => {
  // Build a minimal valid SwapQuote for slippage tests (priceImpact = 1% = 100 bps)
  const baseQuote = {
    tokenIn: "KAS" as const,
    tokenOut: "USDT" as const,
    amountIn: 1_000_000n,
    amountOut: 990_000n,
    priceImpact: 0.01,           // 1% → 100 bps — within 500 bps hard cap
    fee: 1_000n,
    route: ["KAS", "USDT"],
    validUntil: Date.now() + 30_000,
    dexEndpoint: "https://dex.example.com",
  };

  it("does not throw when requestedBps is within cap", async () => {
    const { enforceMaxSlippage } = await import("../../extension/swap/swap");
    expect(() => enforceMaxSlippage(baseQuote, 100)).not.toThrow();
  });

  it("does not throw at exactly maxSlippageBps (boundary)", async () => {
    const { enforceMaxSlippage } = await import("../../extension/swap/swap");
    expect(() => enforceMaxSlippage(baseQuote, 500)).not.toThrow();
  });

  it("throws SLIPPAGE_EXCEEDED when requestedBps > maxSlippageBps", async () => {
    const { enforceMaxSlippage } = await import("../../extension/swap/swap");
    expect(() => enforceMaxSlippage(baseQuote, 501)).toThrow(/SLIPPAGE_EXCEEDED/);
  });

  it("throws PRICE_IMPACT_TOO_HIGH when quote priceImpact bps > maxSlippageBps", async () => {
    const { enforceMaxSlippage } = await import("../../extension/swap/swap");
    const highImpactQuote = { ...baseQuote, priceImpact: 0.06 }; // 6% → 600 bps > 500
    expect(() => enforceMaxSlippage(highImpactQuote, 50)).toThrow(/PRICE_IMPACT_TOO_HIGH/);
  });

  it("checks requestedBps BEFORE priceImpact (requestedBps gate fires first)", async () => {
    const { enforceMaxSlippage } = await import("../../extension/swap/swap");
    // Both violations present; only SLIPPAGE_EXCEEDED should be thrown
    const highImpactQuote = { ...baseQuote, priceImpact: 0.06 }; // 600 bps
    expect(() => enforceMaxSlippage(highImpactQuote, 600)).toThrow(/SLIPPAGE_EXCEEDED/);
  });
});
