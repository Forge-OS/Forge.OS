// Swap types — scaffolding for future DEX integration.
// SWAP_ENABLED = false until a Kaspa DEX exists.
// All fields present so the UI and validation logic are ready to wire up.

import type { TokenId } from "../tokens/types";

export interface SwapRequest {
  tokenIn: TokenId;
  tokenOut: TokenId;
  amountIn: bigint;       // In token's smallest unit
  slippageBps: number;    // Basis points (50 = 0.5%)
}

export interface SwapQuote {
  tokenIn: TokenId;
  tokenOut: TokenId;
  amountIn: bigint;
  amountOut: bigint;      // Expected output after slippage
  priceImpact: number;    // Fraction (0.01 = 1%)
  fee: bigint;            // Protocol fee
  route: string[];        // DEX routing path
  validUntil: number;     // Unix ms — quote expires after this
  dexEndpoint: string;
}

export interface SwapConfig {
  enabled: boolean;
  maxSlippageBps: number; // Hard cap — UI enforces this
  defaultSlippageBps: number;
  dexEndpoint: string | null;
}

export const SWAP_CONFIG: SwapConfig = {
  enabled: false,          // GATED: no Kaspa DEX yet
  maxSlippageBps: 500,     // 5% hard cap when live
  defaultSlippageBps: 50,  // 0.5% default
  dexEndpoint: null,
};
