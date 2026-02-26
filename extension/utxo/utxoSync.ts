// UTXO sync — fetch, cache, and reconcile UTXOs for managed wallet addresses.
//
// Design:
//  - In-memory cache (Map) for fast popup re-renders.
//  - Reconciliation: marks pending txs as confirmed when their inputs disappear.
//  - pendingOutbound: sum of outputs locked by in-flight txs (BROADCASTING/CONFIRMING).
//  - Stale threshold: 30 s. Callers decide whether to force-refresh.

import type { Utxo, UtxoSet } from "./types";
import type { KaspaUtxoResponse } from "../network/kaspaClient";
import { fetchUtxos } from "../network/kaspaClient";

const STALE_THRESHOLD_MS = 30_000;

// ── In-memory UTXO cache ──────────────────────────────────────────────────────
const _cache = new Map<string, UtxoSet>();

/** Return cached UTXO set, or null if missing / stale. */
export function getCachedUtxoSet(address: string): UtxoSet | null {
  const cached = _cache.get(address.toLowerCase());
  if (!cached) return null;
  if (Date.now() - cached.lastSyncAt > STALE_THRESHOLD_MS) return null;
  return cached;
}

/** Manually invalidate the cache for an address (e.g. after broadcast). */
export function invalidateUtxoCache(address: string): void {
  _cache.delete(address.toLowerCase());
}

// ── Fetch + parse ─────────────────────────────────────────────────────────────

function parseRawUtxo(raw: KaspaUtxoResponse): Utxo {
  return {
    txId: raw.outpoint.transactionId,
    outputIndex: raw.outpoint.index,
    address: raw.address,
    amount: BigInt(raw.utxoEntry.amount),
    scriptPublicKey: raw.utxoEntry.scriptPublicKey.scriptPublicKey,
    scriptVersion: raw.utxoEntry.scriptPublicKey.version,
    blockDaaScore: BigInt(raw.utxoEntry.blockDaaScore),
    isCoinbase: raw.utxoEntry.isCoinbase,
  };
}

/**
 * Fetch the latest UTXO set from the Kaspa REST API and update the cache.
 * Also reconciles any in-flight pending transactions passed in.
 *
 * @param address         Kaspa address to sync.
 * @param network         Network identifier ("mainnet" | "testnet-10").
 * @param pendingInputs   Set of "txId:outputIndex" strings locked by pending txs.
 * @param pendingOutbound Sum of pending outbound amounts in sompi.
 * @returns               Updated UtxoSet (also stored in cache).
 */
export async function syncUtxos(
  address: string,
  network: string,
  pendingInputs: Set<string> = new Set(),
  pendingOutbound: bigint = 0n,
): Promise<UtxoSet> {
  const rawList = await fetchUtxos(address, network);

  const utxos: Utxo[] = rawList.map(parseRawUtxo);

  // Confirmed balance = sum of ALL confirmed UTXOs
  const confirmedBalance = utxos.reduce((acc, u) => acc + u.amount, 0n);

  const utxoSet: UtxoSet = {
    address: address.toLowerCase(),
    utxos,
    confirmedBalance,
    pendingOutbound,
    lastSyncAt: Date.now(),
  };

  _cache.set(address.toLowerCase(), utxoSet);
  return utxoSet;
}

/**
 * Return a fresh UtxoSet — from cache if fresh, or fetched if stale.
 */
export async function getOrSyncUtxos(
  address: string,
  network: string,
  pendingInputs?: Set<string>,
  pendingOutbound?: bigint,
): Promise<UtxoSet> {
  const cached = getCachedUtxoSet(address);
  if (cached) return cached;
  return syncUtxos(address, network, pendingInputs, pendingOutbound);
}

/**
 * Select UTXOs for spending using a largest-first strategy.
 * Excludes UTXOs already locked by pending transactions.
 *
 * @param utxos          Available UTXOs.
 * @param targetSompi    Amount to cover (before fee).
 * @param feeSompi       Fee to cover.
 * @param lockedKeys     Set of "txId:outputIndex" to exclude (locked by pending txs).
 * @returns              Selected UTXOs + total accumulated amount.
 * @throws               "INSUFFICIENT_FUNDS" if coverage is impossible.
 */
export function selectUtxos(
  utxos: Utxo[],
  targetSompi: bigint,
  feeSompi: bigint,
  lockedKeys: Set<string> = new Set(),
): { selected: Utxo[]; total: bigint } {
  const available = utxos
    .filter((u) => !lockedKeys.has(`${u.txId}:${u.outputIndex}`))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0)); // largest first

  const need = targetSompi + feeSompi;
  let total = 0n;
  const selected: Utxo[] = [];

  for (const utxo of available) {
    selected.push(utxo);
    total += utxo.amount;
    if (total >= need) break;
  }

  if (total < need) throw new Error("INSUFFICIENT_FUNDS");
  return { selected, total };
}

/**
 * Convert sompi (bigint) to KAS (number).
 * Safe for display; do not use for math.
 */
export function sompiToKas(sompi: bigint): number {
  return Number(sompi) / 1e8;
}

/** Convert KAS (number) to sompi (bigint). Truncates sub-sompi fractions. */
export function kasToSompi(kas: number): bigint {
  return BigInt(Math.floor(kas * 1e8));
}
