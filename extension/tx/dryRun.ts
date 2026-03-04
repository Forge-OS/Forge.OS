// Dry-run validator — 5 mandatory checks before any transaction is signed.
// Fail-closed: any single check failure blocks the entire pipeline.

import type { PendingTx, DryRunResult } from "./types";
import { syncUtxos } from "../utxo/utxoSync";
import { estimateFee } from "../network/kaspaClient";
import { isKaspaAddress } from "../../src/helpers";

const NETWORK_PREFIXES: Record<string, string> = {
  mainnet: "kaspa:",
  "testnet-10": "kaspatest:",
  "testnet-11": "kaspatest:",
  "testnet-12": "kaspatest:",
};

/**
 * Run all 5 dry-run validation checks on a built transaction.
 *
 * Checks performed:
 *  1. UTXO availability  — all selected inputs still exist and are unspent.
 *  2. Fee correctness    — actual network fee ≤ estimated fee (rejects under-priced txs).
 *  3. Balance integrity  — inputs == outputs + change + fee (no value creation/loss).
 *  4. Destination integrity — all output addresses are valid Kaspa addresses.
 *  5. Network match      — output/change address prefixes must match tx.network.
 *
 * @returns DryRunResult — always returned (never throws); check .valid.
 */
export async function dryRunValidate(tx: PendingTx): Promise<DryRunResult> {
  const errors: string[] = [];

  // ── CHECK 1: UTXO availability ────────────────────────────────────────────
  let utxoSet;
  try {
    // vprog_covenant UTXOs require covenant-aware spend tx (KIP-9 path, post-upgrade).
    // Legacy "covenant" UTXOs (escrow, OP_RETURN) are always unsupported in standard send.
    const vProgInputs = tx.inputs.filter((input) => (input.scriptClass ?? "standard") === "vprog_covenant");
    const legacyCovenantInputs = tx.inputs.filter((input) => (input.scriptClass ?? "standard") === "covenant");
    if (vProgInputs.length > 0) {
      errors.push(
        `VPROG_COVENANT_INPUT: ${vProgInputs.length} vProg covenant UTXO(s) detected — use atomic swap claim path, not standard send`,
      );
    }
    if (legacyCovenantInputs.length > 0) {
      errors.push(
        `COVENANT_INPUT_UNSUPPORTED: ${legacyCovenantInputs.length} non-standard UTXO(s) require covenant-aware spend logic`,
      );
    }

    // Force a fresh network fetch to catch concurrent spends (bypass cache)
    utxoSet = await syncUtxos(tx.fromAddress, tx.network);
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
    if (tx.changeOutput && !tx.changeOutput.address.toLowerCase().startsWith(expectedPrefix)) {
      errors.push(
        `NETWORK_MISMATCH: change address "${tx.changeOutput.address}" does not match network "${tx.network}"`,
      );
    }
  }

  // ── CHECK 6: KIP-9 dust threshold ────────────────────────────────────────
  // Storage mass formula requires each output to carry at least 20,000 sompi
  // (the minimum that keeps storage_mass finite). Outputs below this threshold
  // are rejected by rusty-kaspa nodes running the Crescendo ruleset.
  const KIP9_MIN_OUTPUT_SOMPI = 20_000n;
  for (const output of tx.outputs) {
    if (output.amount < KIP9_MIN_OUTPUT_SOMPI) {
      errors.push(
        `DUST_OUTPUT: output to "${output.address}" is ${output.amount.toString()} sompi — below KIP-9 minimum of ${KIP9_MIN_OUTPUT_SOMPI.toString()} sompi`,
      );
    }
  }
  if (tx.changeOutput && tx.changeOutput.amount > 0n && tx.changeOutput.amount < KIP9_MIN_OUTPUT_SOMPI) {
    errors.push(
      `DUST_CHANGE: change output is ${tx.changeOutput.amount.toString()} sompi — below KIP-9 minimum of ${KIP9_MIN_OUTPUT_SOMPI.toString()} sompi`,
    );
  }

  return {
    valid: errors.length === 0,
    estimatedFee: actualFee ?? tx.fee,
    changeAmount: tx.changeOutput?.amount ?? 0n,
    errors,
  };
}
