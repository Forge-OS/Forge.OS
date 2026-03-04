// Pair intent dispatcher — executes PairExecutionIntent via the configured DEX endpoint.
//
// Supports the Kaspa-native DEX API schema (POST /quote → POST /execute).
// Set VITE_SWAP_DEX_ENDPOINT to enable auto-execution of pair trading signals.
// When the vProg covenant path is preferred (VITE_VPROG_ENABLED=true, post KIP-9 upgrade),
// execution will be routed through the covenant layer instead — stubbed here until then.
//
// Slippage protection: rejects execution if the DEX quotes slippage above intent tolerance.

import type { PairExecutionIntent } from "../quant/pairTrading";

const DEX_ENDPOINT = (
  (import.meta.env.VITE_SWAP_DEX_ENDPOINT || import.meta.env.VITE_PAIR_DEX_ENDPOINT || "")
    .trim()
    .replace(/\/+$/, "")
);

const QUOTE_PATH   = (import.meta.env.VITE_SWAP_KASPA_NATIVE_QUOTE_PATH   || "/quote").trim();
const EXECUTE_PATH = (import.meta.env.VITE_SWAP_KASPA_NATIVE_EXECUTE_PATH || "/execute").trim();
const STATUS_PATH  = (import.meta.env.VITE_SWAP_KASPA_NATIVE_STATUS_PATH  || "/status").trim();
const TIMEOUT_MS   = Math.max(5_000, Number(import.meta.env.VITE_SWAP_KASPA_NATIVE_TIMEOUT_MS || 12_000));
const MAX_SLIPPAGE_BPS = Math.max(10, Number(import.meta.env.VITE_SWAP_MAX_SLIPPAGE_BPS || 500));

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PairSwapQuote {
  quoteId: string;
  fromAsset: string;
  toAsset: string;
  fromAmount: number;
  toAmount: number;
  slippageBps: number;
  expiresAt: number;
}

export interface PairSwapResult {
  txId: string;
  fromAmount: number;
  toAmount: number;
  slippageBps: number;
  executedAt: number;
}

export interface PairSwapStatus {
  txId: string;
  status: "pending" | "confirming" | "confirmed" | "failed";
  confirmedAt?: number;
  error?: string;
}

// ── Gating ────────────────────────────────────────────────────────────────────

/** True when a DEX endpoint is configured — gates auto-execution of pair intents. */
export function isPairSwapConfigured(): boolean {
  return Boolean(DEX_ENDPOINT);
}

// ── HTTP primitives ───────────────────────────────────────────────────────────

async function dexFetch<T>(path: string, body?: object, timeoutMs = TIMEOUT_MS): Promise<T> {
  if (!DEX_ENDPOINT) {
    throw new Error("PAIR_SWAP_NO_ENDPOINT: set VITE_SWAP_DEX_ENDPOINT to enable auto-execution");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${DEX_ENDPOINT}${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String((data as any)?.error?.message || (data as any)?.message || `dex_${res.status}`);
      throw new Error(`PAIR_SWAP_${res.status}: ${msg}`);
    }
    return data as T;
  } catch (err) {
    if ((err as any)?.name === "AbortError") throw new Error(`PAIR_SWAP_TIMEOUT_${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Request a swap quote from the DEX.
 *   BUY_KAS:  stablecoin → KAS  (agent is accumulating KAS with stablecoin funds)
 *   SELL_KAS: KAS → stablecoin  (agent is exiting KAS into stablecoin)
 */
export async function getPairSwapQuote(
  intent: PairExecutionIntent,
  fromAddress: string,
): Promise<PairSwapQuote> {
  const isBuy = intent.direction === "BUY_KAS";
  const slippageBps = Math.min(intent.slippageBps, MAX_SLIPPAGE_BPS);
  return dexFetch<PairSwapQuote>(QUOTE_PATH, {
    fromAsset:   isBuy ? intent.stableTick : "KAS",
    toAsset:     isBuy ? "KAS" : intent.stableTick,
    fromAmount:  isBuy ? intent.stableAmount : intent.kasAmount,
    fromAddress,
    slippageBps,
    direction:   intent.direction,
  });
}

/**
 * Submit an accepted quote for execution.
 * The DEX builds and broadcasts the Kaspa transaction; returns the resulting txId.
 */
export async function executePairSwapQuote(
  quote: PairSwapQuote,
  fromAddress: string,
): Promise<PairSwapResult> {
  return dexFetch<PairSwapResult>(EXECUTE_PATH, {
    quoteId: quote.quoteId,
    fromAddress,
  });
}

/**
 * Full pipeline: quote → slippage check → execute.
 *
 * Validates that the DEX's quoted slippage does not exceed the intent's tolerance
 * before submitting — prevents executing at a worse price than expected.
 *
 * @throws PAIR_SWAP_NO_ENDPOINT  — DEX not configured
 * @throws PAIR_SWAP_ZERO_AMOUNT  — intent has zero amounts
 * @throws PAIR_SWAP_SLIPPAGE_EXCEEDED — quoted slippage exceeds tolerance
 * @throws PAIR_SWAP_{status}     — HTTP error from DEX
 */
export async function executePairIntent(
  intent: PairExecutionIntent,
  fromAddress: string,
): Promise<PairSwapResult> {
  if (!DEX_ENDPOINT) throw new Error("PAIR_SWAP_NO_ENDPOINT");
  const amount = intent.direction === "BUY_KAS" ? intent.stableAmount : intent.kasAmount;
  if (amount <= 0) throw new Error("PAIR_SWAP_ZERO_AMOUNT");

  const quote = await getPairSwapQuote(intent, fromAddress);

  // Slippage guard: reject if DEX quotes worse than intent's declared tolerance.
  const maxAllowed = Math.min(intent.slippageBps, MAX_SLIPPAGE_BPS);
  if (quote.slippageBps > maxAllowed) {
    throw new Error(
      `PAIR_SWAP_SLIPPAGE_EXCEEDED: DEX quoted ${quote.slippageBps}bps > allowed ${maxAllowed}bps`,
    );
  }

  return executePairSwapQuote(quote, fromAddress);
}

/**
 * Poll swap status by txId.
 * Returns null on 404 or transient failures (treat as pending).
 */
export async function getPairSwapStatus(txId: string): Promise<PairSwapStatus | null> {
  try {
    return await dexFetch<PairSwapStatus>(`${STATUS_PATH}?txId=${encodeURIComponent(txId)}`);
  } catch {
    return null;
  }
}
