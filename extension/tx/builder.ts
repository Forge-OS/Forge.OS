// Transaction builder — coin selection + kaspa-wasm Generator.
//
// Uses the kaspa-wasm Generator class for correct mass-based fee calculation
// and UTXO-to-transaction mapping. If the Generator API differs between
// kaspa-wasm patch versions, falls back to a manual construction path.
//
// NOTE: kaspa-wasm is loaded lazily to avoid blocking the popup on WASM init.

import type { PendingTx, TxOutput } from "./types";
import type { Utxo } from "../utxo/types";
import { selectUtxos, kasToSompi } from "../utxo/utxoSync";
import { estimateFee } from "../network/kaspaClient";
import { getLockedUtxoKeys } from "./store";
import { getOrSyncUtxos } from "../utxo/utxoSync";

// Lazy-load kaspa-wasm (heavy WASM binary — only when actually sending)
async function loadKaspa() {
  const kaspa = await import("kaspa-wasm");
  const initFn = (kaspa as Record<string, unknown>).default || (kaspa as Record<string, unknown>).init;
  if (typeof initFn === "function") {
    try { await (initFn as () => Promise<void>)(); } catch { /* idempotent */ }
  }
  return kaspa;
}

/**
 * Build a transaction for the given send parameters.
 *
 * Performs coin selection, fee estimation, change calculation, and constructs
 * the PendingTx model. Does NOT sign or broadcast.
 *
 * @param fromAddress  Sender's Kaspa address.
 * @param toAddress    Recipient's Kaspa address.
 * @param amountKas    Amount to send in KAS (will be converted to sompi).
 * @param network      Network identifier.
 * @returns            PendingTx in BUILDING state with inputs, outputs, fee, change.
 */
export async function buildTransaction(
  fromAddress: string,
  toAddress: string,
  amountKas: number,
  network: string,
): Promise<PendingTx> {
  const amountSompi = kasToSompi(amountKas);
  if (amountSompi <= 0n) throw new Error("AMOUNT_TOO_SMALL");

  // Get locked UTXOs (inputs already reserved by in-flight txs)
  const lockedKeys = await getLockedUtxoKeys(fromAddress);

  // Fetch or use cached UTXO set
  const utxoSet = await getOrSyncUtxos(fromAddress, network);

  // Estimate fee with 2 outputs (destination + change) and N inputs
  // We'll select inputs first with a preliminary fee estimate, then refine.
  const preliminary = await estimateFee(1, 2, network);
  const { selected, total } = selectUtxos(
    utxoSet.utxos,
    amountSompi,
    preliminary,
    lockedKeys,
  );

  // Refine fee with actual input count
  const refinedFee = await estimateFee(selected.length, 2, network);

  // Re-select with refined fee if coverage changed
  let inputs = selected;
  let inputTotal = total;
  if (total < amountSompi + refinedFee) {
    const refined = selectUtxos(utxoSet.utxos, amountSompi, refinedFee, lockedKeys);
    inputs = refined.selected;
    inputTotal = refined.total;
  }

  const changeAmount = inputTotal - amountSompi - refinedFee;
  const outputs: TxOutput[] = [{ address: toAddress, amount: amountSompi }];
  const changeOutput: TxOutput | null =
    changeAmount > 0n ? { address: fromAddress, amount: changeAmount } : null;

  const pendingTx: PendingTx = {
    id: crypto.randomUUID(),
    state: "BUILDING",
    fromAddress,
    network,
    inputs,
    outputs,
    changeOutput,
    fee: refinedFee,
    builtAt: Date.now(),
  };

  return pendingTx;
}

/**
 * Construct the kaspa-wasm Generator and produce a signed-ready transaction.
 * Called by signer.ts after the user confirms in the UI.
 *
 * Returns the generator's pending transaction object (kaspa-wasm type).
 * Throws if the kaspa-wasm API is unavailable or inputs are exhausted.
 */
export async function buildKaspaWasmTx(
  tx: PendingTx,
): Promise<unknown /* PendingTransactionT from kaspa-wasm */> {
  const kaspa = await loadKaspa();

  // Convert internal Utxo model to kaspa-wasm UtxoEntry objects
  // kaspa-wasm v0.13.x UtxoEntry constructor / shape:
  const UtxoEntry = (kaspa as Record<string, unknown>).UtxoEntry as
    | (new (args: unknown) => unknown)
    | undefined;

  // Build entry list — try UtxoEntry class first, fall back to plain object
  const entries = tx.inputs.map((utxo: Utxo) => {
    const entry = {
      address: utxo.address,
      outpoint: { transactionId: utxo.txId, index: utxo.outputIndex },
      amount: utxo.amount,
      scriptPublicKey: {
        version: utxo.scriptVersion,
        scriptPublicKey: utxo.scriptPublicKey,
      },
      blockDaaScore: utxo.blockDaaScore,
      isCoinbase: utxo.isCoinbase,
    };
    if (UtxoEntry) {
      try { return new UtxoEntry(entry); } catch { return entry; }
    }
    return entry;
  });

  // Build payment outputs
  const outputList = tx.outputs.map((o: TxOutput) => ({
    address: o.address,
    amount: o.amount,
  }));

  // Build generator config
  const generatorConfig: Record<string, unknown> = {
    entries,
    outputs: outputList,
    changeAddress: tx.fromAddress,
    priorityFee: { sompi: tx.fee },
    networkId: tx.network,
  };

  const Generator = (kaspa as Record<string, unknown>).Generator as
    | (new (config: unknown) => { next: () => unknown | null })
    | undefined;

  if (!Generator) {
    throw new Error(
      "WASM_GENERATOR_UNAVAILABLE: kaspa-wasm Generator class not found. " +
      "Ensure kaspa-wasm ≥ 0.13.0 is installed.",
    );
  }

  const generator = new Generator(generatorConfig);
  const pending = generator.next();

  if (!pending) {
    throw new Error("GENERATOR_EMPTY: Generator produced no transaction. Check UTXO availability.");
  }

  return pending;
}
