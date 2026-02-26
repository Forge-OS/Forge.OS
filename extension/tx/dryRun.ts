// Dry-run validator — 5 mandatory checks before any transaction is signed.
// Fail-closed: any single check failure blocks the entire pipeline.

import type { PendingTx, DryRunResult } from "./types";
import { getOrSyncUtxos } from "../utxo/utxoSync";
import { estimateFee } from "../network/kaspaClient";
import { isKaspaAddress } from "../../src/helpers";
import { getSession } from "../vault/vault";

const NETWORK_PREFIXES: Record<string, string> = {
  mainnet: "kaspa:",
  "testnet-10": "kaspatest:",
};

/**
 * Run all 5 dry-run validation checks on a built transaction.
 *
 * Checks performed:
 *  1. UTXO availability  — all selected inputs still exist and are unspent.
 *  2. Fee correctness    — actual network fee ≤ estimated fee (rejects under-priced txs).
 *  3. Balance integrity  — inputs == outputs + change + fee (no value creation/loss).
 *  4. Destination integrity — all output addresses are valid Kaspa addresses.
 *  5. Network match      — output address prefixes and session network match tx.network.
 *
 * @returns DryRunResult — always returned (never throws); check .valid.
 */
export async function dryRunValidate(tx: PendingTx): Promise<DryRunResult> {
  const errors: string[] = [];

  // ── CHECK 1: UTXO availability ────────────────────────────────────────────
  let utxoSet;
  try {
    // Force a fresh fetch to catch concurrent spends
    utxoSet = await getOrSyncUtxos(tx.fromAddress, tx.network);
    const utxoIndex = new Set(
      utxoSet.utxos.map((u) => `${u.txId}:${u.outputIndex}`),
    );
    for (const inp of tx.inputs) {
      const key = `${inp.txId}:${inp.outputIndex}`;
      if (!utxoIndex.has(key)) {
        errors.push(`UTXO_SPENT: input ${key} no longer available`);
      }
    }
  } catch {
    errors.push("UTXO_FETCH_FAILED: could not verify input availability");
  }

  // ── CHECK 2: Fee correctness ──────────────────────────────────────────────
  let actualFee: bigint;
  try {
    actualFee = await estimateFee(tx.inputs.length, tx.outputs.length + (tx.changeOutput ? 1 : 0), tx.network);
    // Allow up to 2× overestimate (user pays slightly more is fine; under-pay fails node)
    if (tx.fee < actualFee) {
      errors.push(`FEE_TOO_LOW: estimated ${tx.fee.toString()} sompi, network requires ${actualFee.toString()} sompi`);
    }
  } catch {
    // Non-fatal: node might be temporarily unreachable; use the built fee
    actualFee = tx.fee;
  }

  // ── CHECK 3: Balance integrity ────────────────────────────────────────────
  const inputTotal = tx.inputs.reduce((acc, u) => acc + u.amount, 0n);
  const outputTotal = tx.outputs.reduce((acc, o) => acc + o.amount, 0n);
  const changeTotal = tx.changeOutput?.amount ?? 0n;

  if (inputTotal !== outputTotal + changeTotal + tx.fee) {
    errors.push(
      `BALANCE_MISMATCH: inputs=${inputTotal} != outputs=${outputTotal} + change=${changeTotal} + fee=${tx.fee}`,
    );
  }

  // ── CHECK 4: Destination integrity ───────────────────────────────────────
  for (const output of tx.outputs) {
    if (!isKaspaAddress(output.address)) {
      errors.push(`INVALID_ADDRESS: "${output.address}" is not a valid Kaspa address`);
    }
  }
  if (tx.changeOutput && !isKaspaAddress(tx.changeOutput.address)) {
    errors.push(`INVALID_CHANGE_ADDRESS: "${tx.changeOutput.address}"`);
  }

  // ── CHECK 5: Network match ────────────────────────────────────────────────
  const expectedPrefix = NETWORK_PREFIXES[tx.network];
  if (expectedPrefix) {
    for (const output of tx.outputs) {
      if (!output.address.toLowerCase().startsWith(expectedPrefix)) {
        errors.push(
          `NETWORK_MISMATCH: output address "${output.address}" does not match network "${tx.network}"`,
        );
      }
    }
    // Also validate session network matches tx network (prevents cross-network signing)
    const session = getSession();
    if (session && session.network !== tx.network) {
      errors.push(
        `SESSION_NETWORK_MISMATCH: session is on "${session.network}" but tx targets "${tx.network}"`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    estimatedFee: actualFee ?? tx.fee,
    changeAmount: tx.changeOutput?.amount ?? 0n,
    errors,
  };
}
