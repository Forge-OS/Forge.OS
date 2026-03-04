import type { PendingTx } from "./types";
import {
  fetchTransactionAcceptance,
  getKaspaBackendSelection,
  type KaspaBackendSelectionSnapshot,
} from "../network/kaspaClient";

const DEFAULT_CONFIRM_POLL_INTERVAL_MS = 1_000;
const DEFAULT_CONFIRM_TIMEOUT_MS = 5 * 60_000;

export interface KaspaReceiptProbe {
  txId: string;
  network: string;
  checkedAt: number;
  confirmed: boolean;
  acceptingBlockHash: string | null;
  backend: KaspaBackendSelectionSnapshot;
  error: string | null;
}

export interface WaitForKaspaConfirmationOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  onProbe?: (probe: KaspaReceiptProbe) => void | Promise<void>;
}

export async function probeKaspaReceipt(
  txId: string,
  network = "mainnet",
): Promise<KaspaReceiptProbe> {
  const backend = await getKaspaBackendSelection(network);
  try {
    // Use batch acceptance endpoint (rusty-kaspa v1.1.0+) — single POST is more efficient
    // than a GET /transactions/{id} which returns full transaction data we don't need here.
    const results = await fetchTransactionAcceptance([txId], network);
    const entry = results.find((r) => r.transactionId === txId) ?? results[0] ?? null;
    return {
      txId,
      network,
      checkedAt: Date.now(),
      confirmed: Boolean(entry?.isAccepted),
      acceptingBlockHash: entry?.acceptingBlockHash ?? null,
      backend,
      error: null,
    };
  } catch (error) {
    return {
      txId,
      network,
      checkedAt: Date.now(),
      confirmed: false,
      acceptingBlockHash: null,
      backend,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function applyReceiptProbeToPendingTx(tx: PendingTx, probe: KaspaReceiptProbe): PendingTx {
  return {
    ...tx,
    receiptCheckedAt: probe.checkedAt,
    receiptSourceBackend: probe.backend.source,
    receiptSourceReason: probe.backend.reason,
    receiptSourceEndpoint: probe.backend.activeEndpoint,
    acceptingBlockHash: probe.acceptingBlockHash,
  };
}

export async function waitForKaspaConfirmation(
  tx: PendingTx,
  options: WaitForKaspaConfirmationOptions = {},
): Promise<PendingTx> {
  if (!tx.txId) throw new Error("NO_TXID: cannot reconcile receipt without txId");

  const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS));
  const pollIntervalMs = Math.max(250, Math.floor(options.pollIntervalMs ?? DEFAULT_CONFIRM_POLL_INTERVAL_MS));
  const deadline = Date.now() + timeoutMs;
  let probeAttempts = 0;
  let current = { ...tx, state: "CONFIRMING" as const };

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const probe = await probeKaspaReceipt(tx.txId, tx.network);
    probeAttempts += 1;
    if (options.onProbe) await options.onProbe(probe);

    current = applyReceiptProbeToPendingTx(current, probe);
    current = {
      ...current,
      receiptProbeAttempts: probeAttempts,
    };

    if (probe.confirmed) {
      return {
        ...current,
        state: "CONFIRMED",
        confirmations: 1,
        confirmedAt: probe.checkedAt,
        signedTxPayload: undefined,
      };
    }
  }

  return {
    ...current,
    state: "FAILED",
    error: "CONFIRM_TIMEOUT: transaction not confirmed within timeout window",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

