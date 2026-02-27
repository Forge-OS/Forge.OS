import type { KaspaTokenStandard, SwapCustomToken } from "./types";

const ENV = (import.meta as any)?.env ?? {};
const METADATA_TIMEOUT_MS = 3_500;
const METADATA_CACHE_TTL_DEFAULT_MS = 20_000;
const METADATA_CACHE_MAX_ENTRIES = 512;
const tokenMetadataCache = new Map<string, { token: SwapCustomToken; expiresAt: number }>();

function parseCsvEnv(name: string): string[] {
  const raw = String(ENV?.[name] ?? "").trim();
  if (!raw) return [];
  const out = raw
    .split(/[,\s]+/)
    .map((v) => v.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return [...new Set(out)];
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = String(ENV?.[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function metadataCacheTtlMs(): number {
  return parsePositiveIntEnv("VITE_SWAP_KRC_TOKEN_METADATA_CACHE_TTL_MS", METADATA_CACHE_TTL_DEFAULT_MS);
}

function toNetworkBucket(network: string): "MAINNET" | "TN10" | "TN11" | "TN12" {
  if (network === "testnet-10") return "TN10";
  if (network === "testnet-11") return "TN11";
  if (network === "testnet-12") return "TN12";
  return "MAINNET";
}

function metadataEndpointsForNetwork(network: string): string[] {
  const bucket = toNetworkBucket(network);
  const explicit = parseCsvEnv("VITE_SWAP_KRC_TOKEN_METADATA_ENDPOINTS");
  const kasplexScoped = parseCsvEnv(`VITE_KASPA_KASPLEX_${bucket}_API_ENDPOINTS`);
  const generic = parseCsvEnv("VITE_KASPA_KASPLEX_API_ENDPOINTS");
  return [...new Set([...explicit, ...kasplexScoped, ...generic])];
}

function withTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = METADATA_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getNestedObject(raw: Record<string, unknown>): Record<string, unknown> | null {
  const keys = ["token", "data", "result", "item", "collection", "metadata"];
  for (const key of keys) {
    const nested = asObject(raw[key]);
    if (nested) return nested;
  }
  return null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key];
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeAddress(address: string): string {
  return String(address || "").trim().toLowerCase();
}

function cacheKey(address: string, standard: KaspaTokenStandard, network: string): string {
  return `${network}|${standard}|${normalizeAddress(address)}`;
}

function cloneToken(token: SwapCustomToken): SwapCustomToken {
  return { ...token };
}

function readMetadataCache(key: string): SwapCustomToken | null {
  const entry = tokenMetadataCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    tokenMetadataCache.delete(key);
    return null;
  }
  return cloneToken(entry.token);
}

function writeMetadataCache(key: string, token: SwapCustomToken): void {
  const ttlMs = metadataCacheTtlMs();
  if (ttlMs <= 0) return;
  tokenMetadataCache.set(key, {
    token: cloneToken(token),
    expiresAt: Date.now() + ttlMs,
  });
  while (tokenMetadataCache.size > METADATA_CACHE_MAX_ENTRIES) {
    const firstKey = tokenMetadataCache.keys().next().value;
    if (typeof firstKey !== "string") break;
    tokenMetadataCache.delete(firstKey);
  }
}

function clampDecimals(value: number, standard: KaspaTokenStandard): number {
  const fallback = standard === "krc721" ? 0 : 8;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(18, Math.floor(value)));
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslColor(seed: number, sat = 64, light = 52): string {
  return `hsl(${seed % 360} ${sat}% ${light}%)`;
}

function buildFallbackLogo(address: string, standard: KaspaTokenStandard): string {
  const normalized = normalizeAddress(address);
  const hash = hashString(`${standard}:${normalized}`);
  const c1 = hslColor(hash);
  const c2 = hslColor(hash >> 3);
  const label = standard === "krc721" ? "721" : "20";
  const short = normalized.slice(0, 6).toUpperCase();
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0%' stop-color='${c1}'/><stop offset='100%' stop-color='${c2}'/>` +
    `</linearGradient></defs>` +
    `<rect width='120' height='120' rx='24' fill='url(#g)'/>` +
    `<text x='60' y='56' text-anchor='middle' font-family='IBM Plex Mono, monospace' font-size='18' fill='white'>${label}</text>` +
    `<text x='60' y='78' text-anchor='middle' font-family='IBM Plex Mono, monospace' font-size='10' fill='white'>${short}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function normalizeStandard(raw: unknown, fallback: KaspaTokenStandard): KaspaTokenStandard {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value.includes("721")) return "krc721";
  if (value.includes("20")) return "krc20";
  if (value === "nft") return "krc721";
  if (value === "ft") return "krc20";
  return fallback;
}

function normalizeMetadata(
  obj: Record<string, unknown>,
  requestedAddress: string,
  requestedStandard: KaspaTokenStandard,
): SwapCustomToken {
  const rawAddress = pickString(obj, [
    "address",
    "tokenAddress",
    "contractAddress",
    "contract",
    "id",
    "assetId",
  ]);
  const address = rawAddress || requestedAddress;
  const standard = normalizeStandard(
    pickString(obj, ["standard", "type", "tokenType", "protocol"]),
    requestedStandard,
  );
  const symbol = pickString(obj, ["symbol", "ticker", "tick", "tokenSymbol"]) || address.slice(0, 6).toUpperCase();
  const name = pickString(obj, ["name", "collectionName", "tokenName", "title"]) || symbol;
  const decimalsRaw = pickNumber(obj, ["decimals", "decimal", "precision"]);
  const decimals = clampDecimals(decimalsRaw ?? (standard === "krc721" ? 0 : 8), standard);
  const logoUri = pickString(obj, ["logo", "logoUrl", "image", "imageUrl", "icon", "iconUrl"]) || buildFallbackLogo(address, standard);

  return {
    address,
    standard,
    symbol,
    name,
    decimals,
    logoUri,
  };
}

function extractObjectCandidates(raw: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const root = asObject(raw);
  if (!root) return out;
  out.push(root);

  const nested = getNestedObject(root);
  if (nested) out.push(nested);

  for (const key of ["tokens", "items", "results", "data"]) {
    const arr = root[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const obj = asObject(item);
      if (obj) out.push(obj);
    }
  }
  return out;
}

function findMatchingCandidate(
  candidates: Record<string, unknown>[],
  requestedAddress: string,
): Record<string, unknown> | null {
  const target = normalizeAddress(requestedAddress);
  if (!target) return candidates[0] ?? null;
  for (const candidate of candidates) {
    const candidateAddress = normalizeAddress(
      pickString(candidate, ["address", "tokenAddress", "contractAddress", "contract", "id", "assetId"]),
    );
    if (candidateAddress && candidateAddress === target) return candidate;
  }
  return candidates[0] ?? null;
}

function quotePathCandidates(address: string, standard: KaspaTokenStandard): string[] {
  const encoded = encodeURIComponent(address);
  if (standard === "krc721") {
    return [
      `/krc721/tokens/${encoded}`,
      `/krc721/collections/${encoded}`,
      `/krc721/${encoded}`,
      `/tokens/${encoded}`,
      `/token/${encoded}`,
      `/v1/krc721/${encoded}`,
    ];
  }
  return [
    `/krc20/tokens/${encoded}`,
    `/krc20/token/${encoded}`,
    `/krc20/${encoded}`,
    `/tokens/${encoded}`,
    `/token/${encoded}`,
    `/v1/krc20/${encoded}`,
  ];
}

async function fetchRemoteMetadata(
  endpoint: string,
  address: string,
  standard: KaspaTokenStandard,
): Promise<SwapCustomToken | null> {
  const base = endpoint.replace(/\/+$/, "");
  const paths = quotePathCandidates(address, standard);

  for (const path of paths) {
    try {
      const res = await withTimeout(`${base}${path}`, { method: "GET" });
      if (!res.ok) continue;
      const raw = await res.json().catch(() => null);
      if (!raw) continue;
      const candidates = extractObjectCandidates(raw);
      if (candidates.length === 0) continue;
      const candidate = findMatchingCandidate(candidates, address);
      if (!candidate) continue;
      return normalizeMetadata(candidate, address, standard);
    } catch {
      // try next candidate path/endpoint
    }
  }
  return null;
}

export async function resolveTokenFromAddress(
  addressInput: string,
  standard: KaspaTokenStandard,
  network: string,
): Promise<SwapCustomToken> {
  const address = String(addressInput || "").trim();
  if (!address) throw new Error("Token address is required.");

  const key = cacheKey(address, standard, network);
  const cached = readMetadataCache(key);
  if (cached) return cached;

  const endpoints = metadataEndpointsForNetwork(network);
  for (const endpoint of endpoints) {
    const resolved = await fetchRemoteMetadata(endpoint, address, standard);
    if (resolved) {
      writeMetadataCache(key, resolved);
      return cloneToken(resolved);
    }
  }

  // Fail-open for UI preview (logo + address always shown) while swaps still fail-closed on quote validation.
  const fallback: SwapCustomToken = {
    address,
    standard,
    symbol: address.slice(0, 6).toUpperCase(),
    name: standard === "krc721" ? "KRC721 Token" : "KRC20 Token",
    decimals: standard === "krc721" ? 0 : 8,
    logoUri: buildFallbackLogo(address, standard),
  };
  writeMetadataCache(key, fallback);
  return cloneToken(fallback);
}

export function __clearTokenMetadataCacheForTests(): void {
  tokenMetadataCache.clear();
}
