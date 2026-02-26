// Pending transaction store.
// Persists to chrome.storage.local so in-flight txs survive popup close.
// Pruned on load: CONFIRMED / FAILED / CANCELLED txs older than 7 days are dropped.

import type { PendingTx } from "./types";
import { PENDING_TX_STORAGE_KEY } from "./types";

const PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── In-memory mirror ──────────────────────────────────────────────────────────
let _txs: PendingTx[] = [];
let _loaded = false;

// ── Persistence ───────────────────────────────────────────────────────────────

function isTerminal(tx: PendingTx): boolean {
  return ["CONFIRMED", "FAILED", "CANCELLED"].includes(tx.state);
}

async function persist(): Promise<void> {
  return new Promise((resolve) => {
    // Serialise BigInt fields as strings before JSON.stringify
    const serialisable = _txs.map(serialiseTx);
    chrome.storage.local.set(
      { [PENDING_TX_STORAGE_KEY]: JSON.stringify(serialisable) },
      resolve,
    );
  });
}

/** Load and prune pending txs from storage. Idempotent. */
export async function loadPendingTxs(): Promise<PendingTx[]> {
  if (_loaded) return _txs;
  _loaded = true;

  return new Promise((resolve) => {
    chrome.storage.local.get(PENDING_TX_STORAGE_KEY, (result) => {
      try {
        const raw = result[PENDING_TX_STORAGE_KEY];
        if (!raw) { resolve([]); return; }
        const parsed: PendingTx[] = JSON.parse(raw).map(deserialiseTx);

        // Prune stale terminal txs
        const cutoff = Date.now() - PRUNE_AGE_MS;
        _txs = parsed.filter(
          (tx) => !(isTerminal(tx) && tx.builtAt < cutoff),
        );
      } catch {
        _txs = [];
      }
      resolve(_txs);
    });
  });
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function addPendingTx(tx: PendingTx): Promise<void> {
  await loadPendingTxs();
  _txs.push(tx);
  await persist();
}

export async function updatePendingTx(updated: PendingTx): Promise<void> {
  await loadPendingTxs();
  const idx = _txs.findIndex((t) => t.id === updated.id);
  if (idx >= 0) _txs[idx] = updated;
  else _txs.push(updated);
  await persist();
}

export async function getPendingTxById(id: string): Promise<PendingTx | null> {
  await loadPendingTxs();
  return _txs.find((t) => t.id === id) ?? null;
}

/** Get all non-terminal txs for an address. */
export async function getActiveTxsForAddress(address: string): Promise<PendingTx[]> {
  await loadPendingTxs();
  return _txs.filter(
    (t) => t.fromAddress.toLowerCase() === address.toLowerCase() && !isTerminal(t),
  );
}

/** Keys of UTXOs locked by active (non-terminal) txs. */
export async function getLockedUtxoKeys(address: string): Promise<Set<string>> {
  const active = await getActiveTxsForAddress(address);
  const keys = new Set<string>();
  for (const tx of active) {
    for (const inp of tx.inputs) {
      keys.add(`${inp.txId}:${inp.outputIndex}`);
    }
  }
  return keys;
}

/** Sum of pending outbound amounts for an address. */
export async function getPendingOutbound(address: string): Promise<bigint> {
  const active = await getActiveTxsForAddress(address);
  return active.reduce((acc, tx) => {
    const outToOthers = tx.outputs
      .filter((o) => o.address.toLowerCase() !== address.toLowerCase())
      .reduce((s, o) => s + o.amount, 0n);
    return acc + outToOthers + tx.fee;
  }, 0n);
}

// ── BigInt serialisation helpers ──────────────────────────────────────────────
// JSON.stringify can't handle BigInt natively.

type Serialisable = Record<string, unknown>;

function serialiseTx(tx: PendingTx): Serialisable {
  return {
    ...tx,
    fee: tx.fee.toString(),
    changeOutput: tx.changeOutput
      ? { ...tx.changeOutput, amount: tx.changeOutput.amount.toString() }
      : null,
    outputs: tx.outputs.map((o) => ({ ...o, amount: o.amount.toString() })),
    inputs: tx.inputs.map((i) => ({
      ...i,
      amount: i.amount.toString(),
      blockDaaScore: i.blockDaaScore.toString(),
    })),
  };
}

function deserialiseTx(raw: Serialisable): PendingTx {
  return {
    ...(raw as PendingTx),
    fee: BigInt(raw.fee as string),
    changeOutput: raw.changeOutput
      ? { ...(raw.changeOutput as Record<string, unknown>), amount: BigInt((raw.changeOutput as Record<string, unknown>).amount as string) }
      : null,
    outputs: (raw.outputs as Array<Record<string, unknown>>).map((o) => ({
      ...(o as TxOutputRaw),
      amount: BigInt(o.amount as string),
    })),
    inputs: (raw.inputs as Array<Record<string, unknown>>).map((i) => ({
      ...(i as Record<string, unknown>),
      amount: BigInt(i.amount as string),
      blockDaaScore: BigInt(i.blockDaaScore as string),
    })),
  } as PendingTx;
}

// Local type alias for clarity in deserialise helper
type TxOutputRaw = { address: string; amount: string };
