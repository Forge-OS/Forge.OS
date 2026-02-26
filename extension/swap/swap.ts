// Swap gating logic + quote scaffolding.
// All public functions are safe to call regardless of SWAP_CONFIG.enabled;
// they return appropriate disabled/null responses rather than throwing.

import type { SwapRequest, SwapQuote } from "./types";
import { SWAP_CONFIG } from "./types";
import { isTokenEnabled } from "../tokens/registry";
import { getSession } from "../vault/vault";

export interface SwapGatingStatus {
  enabled: boolean;
  reason: string | null; // Non-null explains why swap is disabled
}

/**
 * Return the current gating status for the swap feature.
 * Call this before rendering any interactive swap UI.
 */
export function getSwapGatingStatus(): SwapGatingStatus {
  if (!SWAP_CONFIG.enabled) {
    return { enabled: false, reason: "Swap functionality not yet active on Kaspa." };
  }

  if (!SWAP_CONFIG.dexEndpoint) {
    return { enabled: false, reason: "No DEX endpoint configured." };
  }

  const session = getSession();
  if (!session) {
    return { enabled: false, reason: "Wallet is locked." };
  }

  return { enabled: true, reason: null };
}

/**
 * Validate a swap request before requesting a quote.
 * Returns a list of errors (empty = valid).
 */
export function validateSwapRequest(req: SwapRequest): string[] {
  const errors: string[] = [];

  if (req.tokenIn === req.tokenOut) {
    errors.push("Token in and token out must be different.");
  }

  if (!isTokenEnabled(req.tokenIn)) {
    errors.push(`${req.tokenIn} is not currently available.`);
  }

  if (!isTokenEnabled(req.tokenOut)) {
    errors.push(`${req.tokenOut} is not currently available.`);
  }

  if (req.amountIn <= 0n) {
    errors.push("Amount must be greater than zero.");
  }

  if (req.slippageBps < 0 || req.slippageBps > SWAP_CONFIG.maxSlippageBps) {
    errors.push(
      `Slippage must be between 0 and ${SWAP_CONFIG.maxSlippageBps} bps (${SWAP_CONFIG.maxSlippageBps / 100}%).`,
    );
  }

  return errors;
}

/**
 * Fetch a swap quote from the configured DEX.
 * Always returns null when SWAP_CONFIG.enabled = false.
 * Throws on network/validation error when enabled.
 */
export async function getSwapQuote(req: SwapRequest): Promise<SwapQuote | null> {
  const gating = getSwapGatingStatus();
  if (!gating.enabled) return null;

  const validationErrors = validateSwapRequest(req);
  if (validationErrors.length > 0) {
    throw new Error(`SWAP_VALIDATION: ${validationErrors.join("; ")}`);
  }

  // TODO: Implement DEX quote fetch when SWAP_CONFIG.enabled = true.
  // The implementation will:
  //  1. POST to SWAP_CONFIG.dexEndpoint with the SwapRequest.
  //  2. Validate response — enforce maxSlippageBps.
  //  3. Check priceImpact < threshold.
  //  4. Return SwapQuote with validUntil = now + 30s.
  throw new Error("SWAP_NOT_IMPLEMENTED: DEX integration pending.");
}

/**
 * Enforce max slippage before requesting user signature.
 * Fail-closed: throws if actual slippage exceeds cap.
 */
export function enforceMaxSlippage(quote: SwapQuote, requestedBps: number): void {
  if (requestedBps > SWAP_CONFIG.maxSlippageBps) {
    throw new Error(
      `SLIPPAGE_EXCEEDED: requested ${requestedBps} bps exceeds max ${SWAP_CONFIG.maxSlippageBps} bps`,
    );
  }

  // Check actual price impact derived from quote
  const actualBps = Math.round(quote.priceImpact * 10_000);
  if (actualBps > SWAP_CONFIG.maxSlippageBps) {
    throw new Error(
      `PRICE_IMPACT_TOO_HIGH: actual impact ${actualBps} bps exceeds max ${SWAP_CONFIG.maxSlippageBps} bps`,
    );
  }
}
