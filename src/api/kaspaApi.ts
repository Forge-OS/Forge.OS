import { DEFAULT_NETWORK, KAS_API, KAS_API_FALLBACKS } from "../constants";
import { fmt } from "../helpers";
import { rpcError } from "../runtime/errorTaxonomy";
import { getCustomApiRoot } from "../network/networkConfig";

const API_ROOT = String(KAS_API || "").replace(/\/+$/, "");
const API_ROOTS_DEFAULT = Array.from(new Set([API_ROOT, ...KAS_API_FALLBACKS.map((v) => String(v || "").replace(/\/+$/, ""))]))
  .filter(Boolean);
// Backwards-compat alias — used in resolveApiRoots which now delegates to getEffectiveApiRoots()
const API_ROOTS = API_ROOTS_DEFAULT;

/** Returns the active API root list, honouring any runtime custom endpoint override. */
function getEffectiveApiRoots(): string[] {
  const custom = getCustomApiRoot();
  return custom ? [custom] : API_ROOTS_DEFAULT;
}
const REQUEST_TIMEOUT_MS = 12000;
const MAX_ATTEMPTS_PER_ROOT = 2;
const RETRY_BASE_DELAY_MS = 250;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const PRICE_CACHE_TTL_MS = 20000;
const NODE_STATUS_CACHE_TTL_MS = 15_000;

// Circuit breaker: after 3 consecutive total failures, back off for 20s
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_MS = 20000;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

let priceCache: { value: number; ts: number } | null = null;
let priceInflight: Promise<number> | null = null;
let nodeStatusCache: { value: KasNodeStatus; ts: number } | null = null;
let nodeStatusInflight: Promise<KasNodeStatus> | null = null;

type NetworkHint = "mainnet" | "testnet" | "unknown";
const PROFILE_NETWORK_HINT: NetworkHint = DEFAULT_NETWORK.startsWith("testnet") ? "testnet" : "mainnet";
const TX_RECEIPT_ENDPOINT_CANDIDATES = [
  (txid: string) => `/transactions/${txid}`,
  (txid: string) => `/txs/${txid}`,
  (txid: string) => `/transaction/${txid}`,
];

function makeUrl(root: string, path: string) {
  return `${root}${path}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number) {
  const jitter = Math.floor(Math.random() * 120);
  return RETRY_BASE_DELAY_MS * (attempt + 1) + jitter;
}

function endpointNetworkHint(root: string): NetworkHint {
  const value = String(root || "").toLowerCase();
  if(value.includes("tn10") || value.includes("tn11") || value.includes("tn12") || value.includes("testnet")) {
    return "testnet";
  }
  if(value.includes("api.kaspa.org") || value.includes("mainnet")) {
    return "mainnet";
  }
  return "unknown";
}

function pathNetworkHint(path: string): NetworkHint {
  const value = String(path || "").toLowerCase();
  if(value.includes("/addresses/kaspatest:") || value.includes("/addresses/kaspatest%3a")) return "testnet";
  if(value.includes("/addresses/kaspa:") || value.includes("/addresses/kaspa%3a")) return "mainnet";
  try {
    const decoded = decodeURIComponent(value);
    if(decoded.includes("/addresses/kaspatest:")) return "testnet";
    if(decoded.includes("/addresses/kaspa:")) return "mainnet";
  } catch {
    // Ignore malformed URI sequences and fall back to unknown.
  }
  return "unknown";
}

function resolveApiRoots(path: string) {
  const roots = getEffectiveApiRoots();
  const pathHint = pathNetworkHint(path);
  const targetHint = pathHint === "unknown" ? PROFILE_NETWORK_HINT : pathHint;
  if(targetHint === "unknown") return roots;

  const preferred = roots.filter((root) => {
    const endpointHint = endpointNetworkHint(root);
    return endpointHint === targetHint || endpointHint === "unknown";
  });

  return preferred.length > 0 ? preferred : roots;
}

async function fetchJson(path: string) {
  const roots = getEffectiveApiRoots();
  if (roots.length === 0) {
    throw new Error("No Kaspa API endpoints configured");
  }

  // Circuit breaker: skip all requests while circuit is open
  const now = Date.now();
  if (now < circuitOpenUntil) {
    throw rpcError(new Error(`Kaspa API circuit open – retrying in ${Math.ceil((circuitOpenUntil - now) / 1000)}s`), { path });
  }

  const requestRoots = resolveApiRoots(path);
  const errors: string[] = [];

  for (const root of requestRoots) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ROOT; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const attemptLabel = `${attempt + 1}/${MAX_ATTEMPTS_PER_ROOT}`;

      try {
        const res = await fetch(makeUrl(root, path), {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: controller.signal,
        });

        if(!res.ok) {
          const status = Number(res.status || 0);
          if (RETRYABLE_STATUSES.has(status) && attempt + 1 < MAX_ATTEMPTS_PER_ROOT) {
            await sleep(retryDelayMs(attempt));
            continue;
          }
          throw new Error(`${status || "request_failed"}`);
        }

        const json = await res.json();
        consecutiveFailures = 0;
        return json;
      } catch(err: any) {
        const isTimeout = err?.name === "AbortError";
        const rawMessage = String(err?.message || "");
        const status = Number(rawMessage || 0);
        const isRetryableStatus = RETRYABLE_STATUSES.has(status);
        const isNetworkError = err?.name === "TypeError" || /failed to fetch|network|load failed/i.test(rawMessage);
        const canRetry = attempt + 1 < MAX_ATTEMPTS_PER_ROOT && (isTimeout || isRetryableStatus || isNetworkError);

        if (canRetry) {
          await sleep(retryDelayMs(attempt));
          continue;
        }

        if(isTimeout) {
          errors.push(`${root} timeout (${REQUEST_TIMEOUT_MS}ms, attempt ${attemptLabel})`);
        } else if (isNetworkError) {
          errors.push(`${root} network_error (${rawMessage || "request_failed"}, attempt ${attemptLabel})`);
        } else {
          errors.push(`${root} ${rawMessage || "request_failed"} (attempt ${attemptLabel})`);
        }
        break;
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
  }
  throw rpcError(new Error(`Kaspa API unavailable for ${path}: ${errors.join(" | ")}`), {
    path,
    roots: requestRoots,
  });
}

function encodeAddress(addr: string) {
  const v = String(addr || "").trim();
  if(!v) throw new Error("Missing Kaspa address");
  return encodeURIComponent(v);
}

function encodeTxid(txid: string) {
  const v = String(txid || "").trim();
  if (!/^[a-fA-F0-9]{64}$/.test(v)) throw new Error("Invalid txid format");
  return v.toLowerCase();
}

function extractSompiBalance(payload: any) {
  const raw =
    payload?.balance ??
    payload?.totalBalance ??
    payload?.availableSompi ??
    payload?.balanceSompi ??
    payload?.balances?.total ??
    0;

  const num = Number(raw);
  return Number.isFinite(num) ? Math.max(0, num) : 0;
}

function extractKasBalance(payload: any, sompi: number) {
  const directKas =
    payload?.balanceKas ??
    payload?.kas ??
    payload?.balance_kas ??
    payload?.balances?.kas;

  if(directKas != null) {
    const num = Number(directKas);
    if(Number.isFinite(num)) return Math.max(0, num);
  }

  return sompi / 1e8;
}

function extractUtxos(payload: any) {
  if(Array.isArray(payload)) return payload;
  if(Array.isArray(payload?.utxos)) return payload.utxos;
  if(Array.isArray(payload?.entries)) return payload.entries;
  return [];
}

function extractDaaScoreFromPayload(payload: any): number {
  const score = Number(
    payload?.blueScore ??
    payload?.virtualDaaScore ??
    payload?.daaScore ??
    payload?.blockdag?.daaScore ??
    payload?.blockDag?.daaScore,
  );
  return Number.isFinite(score) && score > 0 ? Math.round(score) : 0;
}

export type KasTxReceipt = {
  txid: string;
  found: boolean;
  status: "pending" | "confirmed" | "failed";
  confirmations: number;
  accepted?: boolean;
  blockDaaScore?: number;
  blockTime?: number;
  confirmTimeMs?: number;
  feeSompi?: number;
  feeKas?: number;
  mass?: number;
  sourcePath?: string;
  raw?: any;
};

export type KasNodeStatus = {
  isSynced: boolean | null;
  isUtxoIndexed: boolean | null;
  source: "kaspad" | "blockdag" | "unknown";
};

function pickFirstNumber(...values: any[]) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function pickFirstBoolean(...values: any[]) {
  for (const v of values) {
    if (typeof v === "boolean") return v;
  }
  return undefined;
}

function normalizeTimestampMs(value: any) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // Treat values < 1e12 as seconds; Kaspa APIs may return unix seconds.
  if (n < 1_000_000_000_000) return Math.round(n * 1000);
  return Math.round(n);
}

function pickFirstFiniteInt(...values: any[]) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return undefined;
}

function parseKasTxReceipt(txid: string, payload: any, sourcePath?: string): KasTxReceipt {
  const root = payload?.transaction ?? payload?.tx ?? payload;
  const statusRaw = String(
    root?.status ??
    root?.transactionStatus ??
    root?.verboseData?.status ??
    root?.state ??
    ""
  ).toLowerCase();
  const confirmations = Math.max(0, Math.round(pickFirstNumber(
    root?.confirmations,
    root?.numConfirmations,
    root?.confirmationCount,
    root?.verboseData?.confirmations,
    root?.acceptingBlockBlueScore && root?.blockDaaScore ? Number(root.blockDaaScore) - Number(root.acceptingBlockBlueScore) : NaN
  ) || 0));
  const accepted = pickFirstBoolean(
    root?.isAccepted,
    root?.accepted,
    root?.verboseData?.isAccepted,
    root?.verboseData?.accepted,
  );
  const blockDaaScore = pickFirstNumber(
    root?.blockDaaScore,
    root?.acceptingBlockBlueScore,
    root?.verboseData?.blockDaaScore,
    root?.verboseData?.acceptingBlockBlueScore
  );
  const blockTime = pickFirstNumber(
    root?.blockTime,
    root?.blockTimestamp,
    root?.acceptedTime,
    root?.verboseData?.blockTime,
    root?.verboseData?.blockTimestamp
  );
  const feeSompi = pickFirstFiniteInt(
    root?.feeSompi,
    root?.fee_sompi,
    root?.networkFeeSompi,
    root?.verboseData?.feeSompi,
    root?.verboseData?.networkFeeSompi,
  );
  const feeKasExplicit = pickFirstNumber(
    root?.feeKas,
    root?.fee_kas,
    root?.networkFeeKas,
    root?.verboseData?.feeKas,
    root?.verboseData?.networkFeeKas,
  );
  const feeKas = Number.isFinite(feeKasExplicit)
    ? Number(feeKasExplicit)
    : (typeof feeSompi === "number" ? Number((feeSompi / 1e8).toFixed(8)) : undefined);
  const mass = pickFirstFiniteInt(
    root?.mass,
    root?.transactionMass,
    root?.verboseData?.mass,
    root?.verboseData?.transactionMass,
  );
  const confirmTimeMs = normalizeTimestampMs(blockTime);

  let status: KasTxReceipt["status"] = "pending";
  if (
    statusRaw.includes("confirm") ||
    statusRaw.includes("accept") ||
    confirmations > 0 ||
    Number.isFinite(blockDaaScore)
  ) {
    status = "confirmed";
  } else if (
    statusRaw.includes("reject") ||
    statusRaw.includes("invalid") ||
    statusRaw.includes("orphan") ||
    accepted === false
  ) {
    status = "failed";
  }

  return {
    txid,
    found: !!payload,
    status,
    confirmations,
    accepted,
    blockDaaScore: Number.isFinite(blockDaaScore) ? Number(blockDaaScore) : undefined,
    blockTime: Number.isFinite(blockTime) ? Number(blockTime) : undefined,
    confirmTimeMs,
    feeSompi,
    feeKas,
    mass,
    sourcePath,
    raw: payload,
  };
}

async function fetchJsonMaybe(path: string) {
  try {
    return await fetchJson(path);
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (/(^|\s)404(\s|$)|\b404\b/.test(msg)) return null;
    throw e;
  }
}

export async function kasPrice() {
  const now = Date.now();
  if (priceCache && now - priceCache.ts < PRICE_CACHE_TTL_MS) {
    return priceCache.value;
  }
  if (priceInflight) return priceInflight;

  priceInflight = (async () => {
    const payload = await fetchJson("/info/price");
    const price = Number(payload?.price ?? 0);
    if(!Number.isFinite(price)) {
      throw rpcError(new Error("Invalid price payload from Kaspa API"), { endpoint: "/info/price" });
    }
    priceCache = { value: price, ts: Date.now() };
    return price;
  })().finally(() => {
    priceInflight = null;
  });

  return priceInflight;
}

export async function kasBalance(addr: string) {
  const payload = await fetchJson(`/addresses/${encodeAddress(addr)}/balance`);
  const sompi = extractSompiBalance(payload);
  const kas = extractKasBalance(payload, sompi);

  return {
    kas: fmt(kas, 4),
    raw: sompi,
  };
}

export async function kasUtxos(addr: string) {
  const payload = await fetchJson(`/addresses/${encodeAddress(addr)}/utxos`);
  return extractUtxos(payload);
}

export async function kasBlueScore(): Promise<number | null> {
  try {
    const payload = await fetchJson("/info/virtual-chain-blue-score");
    const score = extractDaaScoreFromPayload(payload);
    return score > 0 ? score : null;
  } catch {
    try {
      const payload = await fetchJson("/info/blockdag");
      const info = payload?.blockdag ?? payload?.blockDag ?? payload;
      const score = extractDaaScoreFromPayload(info);
      return score > 0 ? score : null;
    } catch {
      return null;
    }
  }
}

export async function kasBlockdagInfo() {
  const payload = await fetchJson("/info/blockdag");
  return payload?.blockdag ?? payload?.blockDag ?? payload;
}

export async function kasNodeStatus(): Promise<KasNodeStatus> {
  const now = Date.now();
  if (nodeStatusCache && now - nodeStatusCache.ts < NODE_STATUS_CACHE_TTL_MS) {
    return nodeStatusCache.value;
  }
  if (nodeStatusInflight) return nodeStatusInflight;

  nodeStatusInflight = (async () => {
    try {
      const payload = await fetchJson("/info/kaspad");
      const value: KasNodeStatus = {
        isSynced: typeof payload?.isSynced === "boolean" ? payload.isSynced : null,
        isUtxoIndexed: typeof payload?.isUtxoIndexed === "boolean" ? payload.isUtxoIndexed : null,
        source: "kaspad",
      };
      nodeStatusCache = { value, ts: Date.now() };
      return value;
    } catch {
      try {
        const info = await kasBlockdagInfo();
        const fallback: KasNodeStatus = {
          isSynced: null,
          isUtxoIndexed: null,
          source: info ? "blockdag" : "unknown",
        };
        nodeStatusCache = { value: fallback, ts: Date.now() };
        return fallback;
      } catch {
        const unknown: KasNodeStatus = {
          isSynced: null,
          isUtxoIndexed: null,
          source: "unknown",
        };
        nodeStatusCache = { value: unknown, ts: Date.now() };
        return unknown;
      }
    }
  })().finally(() => {
    nodeStatusInflight = null;
  });

  return nodeStatusInflight;
}

export async function kasNetworkInfo() {
  const blueScore = await kasBlueScore();
  const fallback = blueScore == null ? await kasBlockdagInfo() : null;
  const daaScore = blueScore ?? extractDaaScoreFromPayload(fallback);
  return {
    ...(fallback || {}),
    daaScore: daaScore || 0,
  };
}

export async function kasTxReceipt(txidRaw: string): Promise<KasTxReceipt> {
  const txid = encodeTxid(txidRaw);
  const errors: string[] = [];
  for (const makePath of TX_RECEIPT_ENDPOINT_CANDIDATES) {
    const path = makePath(txid);
    try {
      const payload = await fetchJsonMaybe(path);
      if (!payload) continue;
      return parseKasTxReceipt(txid, payload, path);
    } catch (e: any) {
      errors.push(String(e?.message || e || "request_failed"));
    }
  }

  if (errors.length === 0) {
    return {
      txid,
      found: false,
      status: "pending",
      confirmations: 0,
    };
  }

  throw rpcError(new Error(`Kaspa tx receipt lookup failed for ${txid}: ${errors.join(" | ")}`), {
    txid,
  });
}
