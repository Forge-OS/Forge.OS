// Transaction broadcast + confirmation polling.
// Idempotency: a tx with an existing txId is never broadcast twice.
// Confirmation: polls /transactions/{txId} until acceptingBlockHash is set.

import type { PendingTx } from "./types";
import { broadcastTx } from "../network/kaspaClient";
import { updatePendingTx } from "./store";
import { invalidateUtxoCache } from "../utxo/utxoSync";
import { waitForKaspaConfirmation } from "./receiptReconciler";

const CONFIRM_POLL_INTERVAL_MS = 1_000;   // poll every 1 s — Kaspa confirms at 10 BPS
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

  let probeAttempts = 0;
  const reconciled = await waitForKaspaConfirmation(
    { ...tx, state: "CONFIRMING" },
    {
      timeoutMs: CONFIRM_TIMEOUT_MS,
      pollIntervalMs: CONFIRM_POLL_INTERVAL_MS,
      onProbe: async (probe) => {
        probeAttempts += 1;
        const pendingUpdate: PendingTx = {
          ...tx,
          state: "CONFIRMING",
          receiptCheckedAt: probe.checkedAt,
          receiptProbeAttempts: probeAttempts,
          receiptSourceBackend: probe.backend.source,
          receiptSourceReason: probe.backend.reason,
          receiptSourceEndpoint: probe.backend.activeEndpoint,
          acceptingBlockHash: probe.acceptingBlockHash,
        };
        await updatePendingTx(pendingUpdate);
        onUpdate(pendingUpdate);
      },
    },
  );

  await updatePendingTx(reconciled);
  onUpdate(reconciled);
  if (reconciled.state === "FAILED") {
    throw new Error(reconciled.error || "CONFIRM_TIMEOUT");
  }
  return reconciled;
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

  // Start polling — fire and forget (caller uses onUpdate for progress).
  // On any error (timeout OR unexpected), push a FAILED state so the UI
  // doesn't hang showing BROADCASTING indefinitely.
  pollConfirmation(confirming, onUpdate).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    onUpdate({ ...confirming, state: "FAILED", error: msg });
  });

  return confirming;
}
