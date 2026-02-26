// Token registry — single source of truth for all asset definitions.
//
// Feature flag:
//   STABLES_ENABLED = false  →  USDT/USDC render as disabled scaffolding.
//   Flip to true + set assetId when Kaspa native assets go live.
//
// DO NOT add fake balances. DO NOT allow transfers for disabled tokens.

import type { Token, TokenId, TokenRegistry } from "./types";

// ── Feature flags ─────────────────────────────────────────────────────────────
export const STABLES_ENABLED = false;

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
      assetId: null,       // future Kaspa native asset ID
      enabled: STABLES_ENABLED,
      disabledReason: STABLES_ENABLED ? null : "Not available on Kaspa yet.",
    },
    USDC: {
      id: "USDC",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      assetId: null,
      enabled: STABLES_ENABLED,
      disabledReason: STABLES_ENABLED ? null : "Not available on Kaspa yet.",
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
