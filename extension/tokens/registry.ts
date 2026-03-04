// Token registry — single source of truth for all asset definitions.
//
// Feature flag:
//   STABLES_ENABLED = false  →  USDT/USDC render as disabled scaffolding.
//   Flip to true + set assetId when Kaspa native assets go live.
//   ZEROX_ENABLED gates 0x route token visibility in wallet UI.
//
// DO NOT add fake balances. DO NOT allow transfers for disabled tokens.

import type { Token, TokenId, TokenRegistry } from "./types";

// ── Feature flags ─────────────────────────────────────────────────────────────
export const STABLES_ENABLED = true;
export const ZEROX_ENABLED = true;

// KRC20 tick for the stablecoin used in pair trading.
// Set via VITE_PAIR_STABLE_TICK (default "USDC").
// After the May 2026 Kaspa upgrade confirms the official KRC20 USDC tick, hardcode it here.
const ENV = (typeof import.meta !== "undefined" && (import.meta as any)?.env) ?? {};
export const PAIR_STABLE_TICK: string =
  String(ENV?.VITE_PAIR_STABLE_TICK ?? "USDC").trim().toUpperCase() || "USDC";

// ── Default registry ──────────────────────────────────────────────────────────
export const DEFAULT_REGISTRY: TokenRegistry = {
  version: 1,
  tokens: {
    KAS: {
      id: "KAS",
      symbol: "KAS",
      name: "Kaspa",
      decimals: 8,         // 1 KAS = 1e8 sompi
      assetId: null,       // native
      enabled: true,
      disabledReason: null,
    },
    USDT: {
      id: "USDT",
      symbol: "USDT",
      name: "Tether USD",
      decimals: 6,
      assetId: null,       // future Kaspa native asset ID (post-bridge)
      krc20Tick: "USDT",   // KRC20 tick on Kaspa (Kasplex inscription protocol)
      enabled: STABLES_ENABLED,
      disabledReason: STABLES_ENABLED ? null : "Temporarily disabled in this wallet build.",
    },
    USDC: {
      id: "USDC",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      assetId: null,       // future Kaspa native asset ID (post-bridge)
      // KRC20 tick sourced from env so it can be updated without a code change if the
      // official Kaspa-native USDC tick differs. Expected value post-upgrade: "USDC".
      krc20Tick: PAIR_STABLE_TICK,
      enabled: STABLES_ENABLED,
      disabledReason: STABLES_ENABLED ? null : "Temporarily disabled in this wallet build.",
    },
    ZRX: {
      id: "ZRX",
      symbol: "0x",
      name: "0x Protocol",
      decimals: 18,
      assetId: null,
      enabled: ZEROX_ENABLED,
      disabledReason: ZEROX_ENABLED ? null : "0x route is disabled in this wallet build.",
    },
  },
};

// ── Accessors ─────────────────────────────────────────────────────────────────

export function getToken(id: TokenId): Token {
  return DEFAULT_REGISTRY.tokens[id];
}

export function isTokenEnabled(id: TokenId): boolean {
  return DEFAULT_REGISTRY.tokens[id]?.enabled ?? false;
}

export function getEnabledTokens(): Token[] {
  return Object.values(DEFAULT_REGISTRY.tokens).filter((t) => t.enabled);
}

export function getAllTokens(): Token[] {
  return Object.values(DEFAULT_REGISTRY.tokens);
}
