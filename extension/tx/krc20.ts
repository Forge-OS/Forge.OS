// KRC-20 token transfers via Kasplex inscription protocol.
//
// KRC-20 transfers use a single Kaspa transaction with:
//   1. An OP_RETURN output containing the inscription JSON payload
//   2. A dust KAS send to the recipient (makes the inscription valid per Kasplex)
//   3. Standard KAS send pipeline (build → dryRun → sign → broadcast)
//
// Inscription format: {"p":"krc-20","op":"transfer","tick":"TICKER","amt":"N","to":"kaspa:q..."}
// "amt" is the token amount in the token's SMALLEST unit (integer string, no decimals).
// "tick" is uppercase, max 4 chars for KRC-20.

import { buildBatchTransaction } from "./builder";
import type { PendingTx } from "./types";

// How much KAS dust to include in the output to the recipient.
// Must be > 0 (recipient must receive at least some KAS for the inscription to be indexable).
export const KRC20_INSCRIPTION_DUST_KAS = 0.3;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Krc20TransferParams {
  fromAddress: string;
  toAddress: string;
  /** Token ticker, e.g. "NACHO". Will be uppercased and validated. */
  tick: string;
  /** Amount in token DISPLAY units (e.g. 100.5 NACHO). Converted internally. */
  amountDisplay: number;
  /** Token decimals — used to convert displayAmount to smallest unit. */
  decimals: number;
  network: string;
  /** Optional: override the dust KAS to send alongside the inscription. Default: 0.3 KAS. */
  dustKas?: number;
}

// ── Encoding ──────────────────────────────────────────────────────────────────

/**
 * Encode a KRC-20 transfer inscription as a hex string for OP_RETURN.
 * Format: UTF-8 JSON → hex.
 */
export function encodeKrc20Inscription(tick: string, amtSmallestUnit: bigint, toAddress: string): string {
  const payload = JSON.stringify({
    p:   "krc-20",
    op:  "transfer",
    tick: String(tick).toUpperCase().slice(0, 4),
    amt:  amtSmallestUnit.toString(),
    to:   toAddress,
  });
  return Array.from(new TextEncoder().encode(payload))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert a display-unit token amount to the smallest unit (BigInt).
 * @param amountDisplay — e.g. 100.5 (user-facing)
 * @param decimals      — e.g. 8 (means 1 display unit = 1e8 smallest units)
 */
export function displayToSmallestUnit(amountDisplay: number, decimals: number): bigint {
  if (!Number.isFinite(amountDisplay) || amountDisplay <= 0) throw new Error("KRC20_INVALID_AMOUNT");
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > 18) throw new Error("KRC20_INVALID_DECIMALS");
  // Use string arithmetic to avoid floating-point rounding
  const factor = 10 ** decimals;
  return BigInt(Math.round(amountDisplay * factor));
}

/**
 * Convert a smallest-unit amount back to display units.
 */
export function smallestToDisplayUnit(amountSmallest: bigint | string, decimals: number): number {
  return Number(amountSmallest) / 10 ** decimals;
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Build a KRC-20 transfer transaction (inscription + KAS dust to recipient).
 *
 * Returns a PendingTx in BUILDING state. Pass to signer.ts and broadcast.ts
 * via the standard pipeline, or use executeKaspaIntent for the full flow.
 */
export async function buildKrc20Transfer(params: Krc20TransferParams): Promise<PendingTx> {
  const { fromAddress, toAddress, tick, amountDisplay, decimals, network } = params;
  const dustKas = params.dustKas ?? KRC20_INSCRIPTION_DUST_KAS;

  const tickUpper = String(tick).toUpperCase().slice(0, 4);
  if (!tickUpper) throw new Error("KRC20_INVALID_TICK");
  if (!toAddress) throw new Error("KRC20_INVALID_RECIPIENT");

  const amtSmallest = displayToSmallestUnit(amountDisplay, decimals);
  const opReturnHex = encodeKrc20Inscription(tickUpper, amtSmallest, toAddress);

  // OP_RETURN must be < 80 bytes — check the encoded payload
  if (opReturnHex.length / 2 > 80) {
    throw new Error(`KRC20_INSCRIPTION_TOO_LARGE: inscription payload is ${opReturnHex.length / 2} bytes (max 80)`);
  }

  return buildBatchTransaction(
    fromAddress,
    [{ address: toAddress, amountKas: dustKas }],
    network,
    { opReturnHex },
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Validate that a numeric string represents a positive token amount in display units. */
export function validateKrc20Amount(input: string, decimals: number): { valid: boolean; error?: string; amount?: number } {
  const n = parseFloat(input);
  if (!Number.isFinite(n) || n <= 0) return { valid: false, error: "Enter a valid positive amount" };
  const smallest = BigInt(Math.round(n * 10 ** decimals));
  if (smallest <= 0n) return { valid: false, error: "Amount too small (rounds to zero in smallest unit)" };
  return { valid: true, amount: n };
}
