// Lightweight KRC-20 token balance fetcher for the main app (no chrome.storage deps).
//
// Polls the Kasplex REST API to get the balance of a single token tick for an address.
// Used by Dashboard.tsx to populate stableBalanceKrc for pair trading intents.
//
// Endpoint priority:
//   1. VITE_KRC_INDEXER_ENDPOINTS (comma-separated, first entry used)
//   2. Hardcoded Kasplex public API fallback

const _indexerBase = (() => {
  const raw = (import.meta.env.VITE_KRC_INDEXER_ENDPOINTS || "").trim();
  return raw ? raw.split(",")[0].trim().replace(/\/+$/, "") : "https://api.kasplex.org";
})();

const CACHE_TTL_MS = 10_000;

const _cache = new Map<string, { balance: number; at: number }>();

function cacheKey(address: string, tick: string) {
  return `${address.toLowerCase()}:${tick.toUpperCase()}`;
}

/**
 * Fetch the display-unit balance of a KRC-20 token for an address.
 * Returns 0 if the address holds no tokens or the API is unavailable.
 * On transient errors, returns the stale cached value rather than 0 — this prevents
 * the pair trading intent from falsely pausing BUY_KAS signals during API blips.
 */
export async function fetchKrcBalance(
  address: string,
  tick: string,
  timeoutMs = 5_000,
): Promise<number> {
  if (!address || !tick) return 0;
  const key = cacheKey(address, tick);
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.balance;

  const tickUpper = tick.toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Kasplex v1: GET /v1/krc20/address/{addr}/tokenlist
    const url = `${_indexerBase}/v1/krc20/address/${encodeURIComponent(address)}/tokenlist`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`krc_balance_http_${res.status}`);
    const data = await res.json();

    // Response shape: { result: [{ tick, balance, dec, ... }] }
    const tokens: Array<{ tick?: string; balance?: string; dec?: string | number }> =
      Array.isArray(data?.result) ? data.result : [];

    const entry = tokens.find((t) => String(t.tick ?? "").toUpperCase() === tickUpper);
    const decimals = Number(entry?.dec ?? 8);
    const balance = entry ? Number(entry.balance ?? "0") / 10 ** decimals : 0;

    _cache.set(key, { balance, at: Date.now() });
    return balance;
  } catch {
    // Return stale cache on error; fall to 0 only if no prior value exists.
    return cached?.balance ?? 0;
  } finally {
    clearTimeout(timer);
  }
}

/** Invalidate cached balance for an address after a KRC-20 transfer. */
export function invalidateKrcBalanceCache(address: string, tick?: string): void {
  const prefix = address.toLowerCase();
  for (const key of _cache.keys()) {
    if (tick ? key === `${prefix}:${tick.toUpperCase()}` : key.startsWith(`${prefix}:`)) {
      _cache.delete(key);
    }
  }
}
