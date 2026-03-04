// UTXO sync — fetch, cache, and reconcile UTXOs for managed wallet addresses.
//
// Design:
//  - In-memory cache (Map) for fast popup re-renders.
//  - Reconciliation: marks pending txs as confirmed when their inputs disappear.
//  - pendingOutbound: sum of outputs locked by in-flight txs (BROADCASTING/CONFIRMING).
//  - Stale threshold: 30 s. Callers decide whether to force-refresh.

import type { Utxo, UtxoSet } from "./types";
import type { KaspaUtxoResponse } from "../network/kaspaClient";
import { fetchBatchUtxos } from "../network/kaspaClient";

const STALE_THRESHOLD_MS = 30_000;

// ── In-memory UTXO cache ──────────────────────────────────────────────────────
const _cache = new Map<string, UtxoSet>();

// ── In-flight deduplication ───────────────────────────────────────────────────
// If two callers request syncUtxos for the same address+network concurrently,
// share the single in-flight fetch instead of firing duplicate HTTP requests.
const _inFlight = new Map<string, Promise<UtxoSet>>();
const _inFlightBatch = new Map<string, Promise<Record<string, UtxoSet>>>();

function cacheKey(address: string, network: string): string {
  return `${String(address || "").trim().toLowerCase()}:${String(network || "").trim().toLowerCase()}`;
}

function normalizeScriptHex(scriptPublicKey: string): string {
  return String(scriptPublicKey || "").trim().toLowerCase();
}

/**
 * Kaspa standard receive outputs are version=0 P2PK scripts:
 *   0x20 <32-byte-pubkey> 0xac   (34 bytes total)
 */
function isStandardP2pkScript(scriptVersion: number, scriptPublicKey: string): boolean {
  if (scriptVersion !== 0) return false;
  const normalized = normalizeScriptHex(scriptPublicKey);
  return /^20[0-9a-f]{64}ac$/.test(normalized);
}

/**
 * Detects known vProg covenant script patterns (KIP-9).
 *
 * A KAS→KRC20 atomic swap covenant script built by buildCovenantScriptBytes()
 * always starts with: OP_0 (0x00) OP_TXOUTPUTCOUNT (0xc1) OP_1 (0x51) OP_GREATERTHAN (0xa7) OP_VERIFY (0x69)
 * and ends with OP_CHECKSIG (0xac).
 *
 * Any script whose first byte is a vProg introspection opcode (0xc0–0xc4)
 * is also treated as covenant.
 */
function isVProgCovenantScript(scriptVersion: number, scriptPublicKey: string): boolean {
  if (scriptVersion !== 0) return false;
  const normalized = normalizeScriptHex(scriptPublicKey);
  // Byte 0 is a vProg introspection opcode
  if (/^c[0-4]/.test(normalized)) return true;
  // Starts with OP_0 OP_TXOUTPUTCOUNT (our canonical covenant prefix = 00c1)
  if (normalized.startsWith("00c1")) return true;
  return false;
}

/**
 * Classifies a script output into one of three categories:
 *   "standard"        — version-0 P2PK (normal spend, 34 bytes)
 *   "vprog_covenant"  — KIP-9 vProg covenant UTXO (introspection opcodes detected)
 *   "covenant"        — any other non-standard script (legacy escrow, OP_RETURN, etc.)
 */
function classifyScript(scriptVersion: number, scriptPublicKey: string): "standard" | "vprog_covenant" | "covenant" {
  if (isStandardP2pkScript(scriptVersion, scriptPublicKey)) return "standard";
  if (isVProgCovenantScript(scriptVersion, scriptPublicKey)) return "vprog_covenant";
  return "covenant";
}

/** Return cached UTXO set for an address+network, or null if missing / stale. */
export function getCachedUtxoSet(address: string, network: string): UtxoSet | null {
  const cached = _cache.get(cacheKey(address, network));
  if (!cached) return null;
  if (Date.now() - cached.lastSyncAt > STALE_THRESHOLD_MS) return null;
  return cached;
}

/** Manually invalidate the cache for an address (e.g. after broadcast).
 *  Also cancels any in-flight fetch so the next caller gets a fresh response. */
export function invalidateUtxoCache(address: string, network?: string): void {
  const addrLower = String(address || "").trim().toLowerCase();
  const normalizedNetwork = typeof network === "string" ? network.trim().toLowerCase() : "";

  if (!addrLower) return;
  if (normalizedNetwork) {
    _cache.delete(cacheKey(addrLower, normalizedNetwork));
    _inFlight.delete(cacheKey(addrLower, normalizedNetwork));
    for (const key of _inFlightBatch.keys()) {
      if (key.startsWith(`${normalizedNetwork}:`) && key.includes(addrLower)) _inFlightBatch.delete(key);
    }
    return;
  }

  // Backward-compat path: invalidate this address across all networks.
  for (const key of _cache.keys()) {
    if (key.startsWith(`${addrLower}:`)) _cache.delete(key);
  }
  for (const key of _inFlight.keys()) {
    if (key.startsWith(`${addrLower}:`)) _inFlight.delete(key);
  }
  for (const key of _inFlightBatch.keys()) {
    const sep = key.indexOf(":");
    const addressPart = sep >= 0 ? key.slice(sep + 1) : key;
    if (addressPart.split(",").includes(addrLower)) _inFlightBatch.delete(key);
  }
}

// ── Fetch + parse ─────────────────────────────────────────────────────────────

function parseRawUtxo(raw: KaspaUtxoResponse): Utxo {
  const scriptVersion = raw.utxoEntry.scriptPublicKey.version;
  const scriptPublicKey = raw.utxoEntry.scriptPublicKey.scriptPublicKey;
  return {
    txId: raw.outpoint.transactionId,
    outputIndex: raw.outpoint.index,
    address: raw.address,
    amount: BigInt(raw.utxoEntry.amount),
    scriptPublicKey,
    scriptVersion,
    scriptClass: classifyScript(scriptVersion, scriptPublicKey),
    blockDaaScore: BigInt(raw.utxoEntry.blockDaaScore),
    isCoinbase: raw.utxoEntry.isCoinbase,
  };
}

function normalizeAddressList(addresses: string[]): string[] {
  const out: string[] = [];
  for (const candidate of addresses) {
    const normalized = String(candidate || "").trim().toLowerCase();
    if (!normalized) continue;
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

function makeUtxoSet(
  addressLower: string,
  raws: KaspaUtxoResponse[],
  pendingOutbound = 0n,
): UtxoSet {
  const utxos = raws.map(parseRawUtxo);
  const confirmedBalance = utxos.reduce((acc, u) => acc + u.amount, 0n);
  return {
    address: addressLower,
    utxos,
    confirmedBalance,
    pendingOutbound,
    lastSyncAt: Date.now(),
  };
}

/**
 * Fetch the latest UTXO set from the Kaspa REST API and update the cache.
 * Also reconciles any in-flight pending transactions passed in.
 *
 * @param address         Kaspa address to sync.
 * @param network         Network identifier (mainnet / testnet profiles).
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
  const key = cacheKey(address, network);

  // Deduplicate concurrent fetches for the same address+network.
  // dryRun explicitly calls syncUtxos (bypass cache) but two concurrent dryRuns
  // for the same address should still share one network round trip.
  const existing = _inFlight.get(key);
  if (existing) return existing;

  const fetch = (async (): Promise<UtxoSet> => {
    try {
      // Use the v1.1 batch endpoint even for single-address sync so runtime
      // path stays aligned with multi-address UTXO fetch behavior.
      const rawList = await fetchBatchUtxos([address], network);
      const utxoSet = makeUtxoSet(address.toLowerCase(), rawList, pendingOutbound);
      _cache.set(key, utxoSet);
      return utxoSet;
    } finally {
      _inFlight.delete(key);
    }
  })();

  _inFlight.set(key, fetch);
  return fetch;
}

/**
 * Batch-sync UTXOs for multiple addresses with one network call.
 * Returns a map keyed by normalized lower-case address.
 */
export async function syncUtxosBatch(
  addresses: string[],
  network: string,
  pendingOutboundByAddress: Record<string, bigint> = {},
): Promise<Record<string, UtxoSet>> {
  const unique = normalizeAddressList(addresses);
  if (unique.length === 0) return {};
  const normalizedNetwork = String(network || "").trim().toLowerCase();
  const batchKey = `${normalizedNetwork}:${[...unique].sort().join(",")}`;
  const existing = _inFlightBatch.get(batchKey);
  if (existing) return existing;

  const fetch = (async (): Promise<Record<string, UtxoSet>> => {
    try {
      const rawList = await fetchBatchUtxos(unique, network);
      const grouped = new Map<string, KaspaUtxoResponse[]>();
      for (const raw of rawList) {
        const key = String(raw?.address || "").trim().toLowerCase();
        if (!key) continue;
        const bucket = grouped.get(key);
        if (bucket) bucket.push(raw);
        else grouped.set(key, [raw]);
      }

      const out: Record<string, UtxoSet> = {};
      for (const addressLower of unique) {
        const raws = grouped.get(addressLower) ?? [];
        const pendingOutbound = pendingOutboundByAddress[addressLower] ?? 0n;
        const utxoSet = makeUtxoSet(addressLower, raws, pendingOutbound);
        _cache.set(cacheKey(addressLower, normalizedNetwork), utxoSet);
        out[addressLower] = utxoSet;
      }
      return out;
    } finally {
      _inFlightBatch.delete(batchKey);
    }
  })();

  _inFlightBatch.set(batchKey, fetch);
  return fetch;
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
  const cached = getCachedUtxoSet(address, network);
  if (cached) return cached;
  return syncUtxos(address, network, pendingInputs, pendingOutbound);
}

/**
 * Return fresh UTXO sets for multiple addresses.
 * Uses cache when fresh; fetches only stale/missing addresses in one batch call.
 */
export async function getOrSyncUtxosBatch(
  addresses: string[],
  network: string,
  pendingOutboundByAddress: Record<string, bigint> = {},
): Promise<Record<string, UtxoSet>> {
  const unique = normalizeAddressList(addresses);
  if (unique.length === 0) return {};

  const out: Record<string, UtxoSet> = {};
  const missing: string[] = [];
  for (const address of unique) {
    const cached = getCachedUtxoSet(address, network);
    if (cached) {
      out[address] = cached;
    } else {
      missing.push(address);
    }
  }

  if (missing.length === 0) return out;
  const fetched = await syncUtxosBatch(missing, network, pendingOutboundByAddress);
  return { ...out, ...fetched };
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
  const unlocked = utxos.filter((u) => !lockedKeys.has(`${u.txId}:${u.outputIndex}`));
  const available = unlocked
    .filter((u) => (u.scriptClass ?? "standard") === "standard")
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0)); // largest first

  const need = targetSompi + feeSompi;
  let total = 0n;
  const selected: Utxo[] = [];

  for (const utxo of available) {
    selected.push(utxo);
    total += utxo.amount;
    if (total >= need) break;
  }

  if (total < need) {
    const unlockedTotal = unlocked.reduce((acc, u) => acc + u.amount, 0n);
    if (unlockedTotal >= need) {
      throw new Error("COVENANT_ONLY_FUNDS");
    }
    throw new Error("INSUFFICIENT_FUNDS");
  }
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
