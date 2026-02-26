// Transaction broadcast + confirmation polling.
// Idempotency: a tx with an existing txId is never broadcast twice.
// Confirmation: polls /transactions/{txId} until acceptingBlockHash is set.

import type { PendingTx } from "./types";
import { broadcastTx, fetchTransaction } from "../network/kaspaClient";
import { updatePendingTx } from "./store";
import { invalidateUtxoCache } from "../utxo/utxoSync";

const CONFIRM_POLL_INTERVAL_MS = 3_000;   // poll every 3 s
const CONFIRM_TIMEOUT_MS = 5 * 60_000;    // give up after 5 min

/**
 * Broadcast a signed transaction to the Kaspa network.
 *
 * Idempotency: if tx.txId is already set, skip broadcast and go straight to
 * CONFIRMING (handles popup-close-then-reopen during broadcast).
 *
 * @param tx  PendingTx in SIGNED state with signedTxPayload populated.
 * @returns   Updated tx in BROADCASTING state with txId set.
 * @throws    "NOT_SIGNED" if signedTxPayload is missing.
 * @throws    "BROADCAST_FAILED" wrapping the network error.
 */
export async function broadcastTransaction(tx: PendingTx): Promise<PendingTx> {
  // Idempotency guard
  if (tx.txId) {
    console.info(`[broadcast] tx ${tx.id} already has txId=${tx.txId}; skipping re-broadcast`);
    return { ...tx, state: "CONFIRMING" };
  }

  if (!tx.signedTxPayload) throw new Error("NOT_SIGNED");

  let payload: object;
  try {
    payload = JSON.parse(tx.signedTxPayload);
  } catch {
    throw new Error("BROADCAST_FAILED: signedTxPayload is not valid JSON");
  }

  let txId: string;
  try {
    txId = await broadcastTx(payload, tx.network);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed: PendingTx = {
      ...tx,
      state: "FAILED",
      error: `BROADCAST_FAILED: ${msg}`,
    };
    await updatePendingTx(failed);
    throw new Error(`BROADCAST_FAILED: ${msg}`);
  }

  const broadcasting: PendingTx = {
    ...tx,
    state: "BROADCASTING",
    txId,
    broadcastAt: Date.now(),
    // Clear payload after broadcast to reduce storage size
    signedTxPayload: undefined,
  };
  await updatePendingTx(broadcasting);

  // Invalidate UTXO cache — inputs are now spent
  invalidateUtxoCache(tx.fromAddress);

  return { ...broadcasting, state: "CONFIRMING" };
}

/**
 * Poll for transaction confirmation.
 * Resolves when the tx has an acceptingBlockHash (confirmed in BlockDAG).
 * Rejects on timeout.
 *
 * Should be called after broadcastTransaction returns; can safely be called
 * without awaiting (fire-and-forget) for UX while showing "pending" state.
 *
 * @param tx         PendingTx in CONFIRMING state.
 * @param onUpdate   Callback called with each state update (for live UI).
 */
export async function pollConfirmation(
  tx: PendingTx,
  onUpdate: (updated: PendingTx) => void = () => {},
): Promise<PendingTx> {
  if (!tx.txId) throw new Error("NO_TXID: cannot poll without txId");

  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  let current: PendingTx = { ...tx, state: "CONFIRMING" };

  while (Date.now() < deadline) {
    await sleep(CONFIRM_POLL_INTERVAL_MS);

    try {
      const remote = await fetchTransaction(tx.txId, tx.network);
      if (remote?.acceptingBlockHash) {
        current = {
          ...current,
          state: "CONFIRMED",
          confirmations: 1,
          confirmedAt: Date.now(),
          signedTxPayload: undefined,
        };
        await updatePendingTx(current);
        onUpdate(current);
        return current;
      }
    } catch { /* network blip — keep polling */ }
  }

  // Timeout: mark as failed (tx may still confirm later on chain)
  current = {
    ...current,
    state: "FAILED",
    error: "CONFIRM_TIMEOUT: transaction not confirmed within 5 minutes",
  };
  await updatePendingTx(current);
  onUpdate(current);
  throw new Error(current.error!);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Full pipeline: sign → broadcast → begin polling.
 * Returns immediately after broadcast; polling continues in background.
 *
 * @param tx        Signed PendingTx.
 * @param onUpdate  Live callback for state changes.
 */
export async function broadcastAndPoll(
  tx: PendingTx,
  onUpdate: (updated: PendingTx) => void,
): Promise<PendingTx> {
  const confirming = await broadcastTransaction(tx);
  onUpdate(confirming);

  // Start polling — fire and forget (caller uses onUpdate for progress)
  pollConfirmation(confirming, onUpdate).catch(() => {/* timeout handled in onUpdate */});

  return confirming;
}
