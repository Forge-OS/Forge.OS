// Kaspa REST API client — typed, retry-capable, circuit-broken.
// Used by UTXO sync, fee estimation, and transaction broadcast.
// Does NOT use kaspa-wasm's WebSocket RPC — the extension uses REST only.

// ── Config ────────────────────────────────────────────────────────────────────

export const ENDPOINTS: Record<string, string> = {
  mainnet: "https://api.kaspa.org",
  "testnet-10": "https://api-tn10.kaspa.org",
};

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_BASE_MS = 600;

// ── Circuit breaker ───────────────────────────────────────────────────────────

const CB_TRIP_THRESHOLD = 4;  // consecutive failures before open
const CB_RECOVER_MS = 30_000; // half-open after 30 s

type CBState = "closed" | "open" | "half-open";
const _cb: Record<string, { state: CBState; failures: number; openAt: number }> = {};

function getCircuitBreaker(base: string) {
  if (!_cb[base]) _cb[base] = { state: "closed", failures: 0, openAt: 0 };
  const cb = _cb[base];
  if (cb.state === "open" && Date.now() - cb.openAt > CB_RECOVER_MS) {
    cb.state = "half-open";
  }
  return cb;
}

function onSuccess(base: string) {
  const cb = _cb[base];
  if (!cb) return;
  cb.failures = 0;
  cb.state = "closed";
}

function onFailure(base: string) {
  const cb = _cb[base];
  if (!cb) return;
  cb.failures++;
  if (cb.failures >= CB_TRIP_THRESHOLD) {
    cb.state = "open";
    cb.openAt = Date.now();
  }
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function apiFetch<T>(
  network: string,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const base = ENDPOINTS[network] ?? ENDPOINTS["mainnet"];
  const cb = getCircuitBreaker(base);

  if (cb.state === "open") {
    throw new KaspaApiError(`Circuit open for ${base} — backing off`, 503);
  }

  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_BASE_MS * 2 ** (attempt - 1)));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${base}${path}`, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new KaspaApiError(`HTTP ${res.status}: ${body.slice(0, 120)}`, res.status);
      }

      const data = (await res.json()) as T;
      onSuccess(base);
      return data;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof KaspaApiError && err.status < 500) throw err; // 4xx — don't retry
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  onFailure(base);
  throw lastErr ?? new KaspaApiError("Unknown API error", 0);
}

// ── Error type ────────────────────────────────────────────────────────────────

export class KaspaApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "KaspaApiError";
  }
}

// ── Typed API shapes ──────────────────────────────────────────────────────────

export interface KaspaUtxoResponse {
  address: string;
  outpoint: { transactionId: string; index: number };
  utxoEntry: {
    amount: string;           // bigint as string
    scriptPublicKey: { version: number; scriptPublicKey: string };
    blockDaaScore: string;    // bigint as string
    isCoinbase: boolean;
  };
}

export interface KaspaTransactionResponse {
  transactionId: string;
  acceptingBlockHash: string | null;
  inputs: unknown[];
  outputs: unknown[];
}

export interface KaspaFeeEstimate {
  priorityBucket: { feerate: number; estimatedSeconds: number };
  normalBuckets: Array<{ feerate: number; estimatedSeconds: number }>;
  lowBuckets: Array<{ feerate: number; estimatedSeconds: number }>;
}

// ── Public methods ────────────────────────────────────────────────────────────

/** Fetch all UTXOs for an address. */
export async function fetchUtxos(
  address: string,
  network = "mainnet",
): Promise<KaspaUtxoResponse[]> {
  return apiFetch<KaspaUtxoResponse[]>(
    network,
    `/addresses/${encodeURIComponent(address)}/utxos`,
  );
}

/** Fetch confirmed KAS balance in sompi. */
export async function fetchBalance(
  address: string,
  network = "mainnet",
): Promise<bigint> {
  const data = await apiFetch<{ balance: string | number }>(
    network,
    `/addresses/${encodeURIComponent(address)}/balance`,
  );
  return BigInt(data?.balance ?? 0);
}

/** Fetch current KAS/USD price. Returns 0 on failure (non-critical). */
export async function fetchKasPrice(network = "mainnet"): Promise<number> {
  try {
    const data = await apiFetch<{ price: number }>(
      network,
      `/info/price?stringOnly=false`,
    );
    return data?.price ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch fee estimate from the network.
 * Returns feerate in sompi/gram (mass unit).
 * Kaspa's minimum feerate is ~1 sompi/gram.
 */
export async function fetchFeeEstimate(network = "mainnet"): Promise<number> {
  try {
    const data = await apiFetch<KaspaFeeEstimate>(network, `/info/fee-estimate`);
    return data?.priorityBucket?.feerate ?? 1;
  } catch {
    return 1; // fallback to minimum
  }
}

/**
 * Estimate transaction fee given input/output counts.
 * Uses the network's current feerate multiplied by estimated mass.
 * Kaspa mass ≈ 239 + 142 * inputs + 51 * outputs (simplified Rust formula).
 */
export async function estimateFee(
  inputCount: number,
  outputCount: number,
  network = "mainnet",
): Promise<bigint> {
  const feerate = await fetchFeeEstimate(network);
  const mass = 239 + 142 * inputCount + 51 * outputCount;
  // Minimum fee = mass * feerate, but always at least 1000 sompi (safety floor)
  return BigInt(Math.max(Math.ceil(mass * feerate), 1_000));
}

/**
 * Broadcast a signed transaction.
 * Expects the Kaspa REST API format: { "transaction": { ... } }
 * Returns the transaction ID.
 */
export async function broadcastTx(
  txPayload: object,
  network = "mainnet",
): Promise<string> {
  const data = await apiFetch<{ transactionId?: string; txid?: string }>(
    network,
    `/transactions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(txPayload),
    },
  );
  const txId = data?.transactionId ?? data?.txid ?? "";
  if (!txId) throw new KaspaApiError("Broadcast succeeded but no txId returned", 200);
  return txId;
}

/**
 * Fetch a transaction by ID. Returns null if not found.
 * Used for confirmation polling.
 */
export async function fetchTransaction(
  txId: string,
  network = "mainnet",
): Promise<KaspaTransactionResponse | null> {
  try {
    return await apiFetch<KaspaTransactionResponse>(
      network,
      `/transactions/${txId}`,
    );
  } catch (err) {
    if (err instanceof KaspaApiError && err.status === 404) return null;
    throw err;
  }
}
