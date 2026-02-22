import {
  ALLOWED_ADDRESS_PREFIXES,
  DEFAULT_NETWORK,
  ENFORCE_WALLET_NETWORK,
  KASPIUM_DEEP_LINK_SCHEME,
  NETWORK_LABEL,
} from "../constants";
import { fmt, normalizeKaspaAddress } from "../helpers";
import { isAddressPrefixCompatible, resolveKaspaNetwork } from "../kaspa/network";
import { walletError } from "../runtime/errorTaxonomy";
import { createGhostBridgeRuntime, type GhostProviderInfo } from "./walletAdapterGhostBridge";
import { createKastleRawTxRuntime } from "./walletAdapterKastleRawTx";
export type { GhostProviderInfo } from "./walletAdapterGhostBridge";

export const ALL_KASPA_ADDRESS_PREFIXES = ["kaspa", "kaspatest", "kaspadev", "kaspasim"];
export const WALLET_CALL_TIMEOUT_MS = 15000;
export const WALLET_SEND_TIMEOUT_MS = 45000;
export const GHOST_PROVIDER_SCAN_TIMEOUT_MS = 350;
export const GHOST_CONNECT_TIMEOUT_MS = 45000;
export const KASTLE_RAW_TX_ENABLED = String((import.meta as any)?.env?.VITE_KASTLE_RAW_TX_ENABLED || "false").toLowerCase() === "true";
export const KASTLE_RAW_TX_MANUAL_JSON_PROMPT_ENABLED =
  String((import.meta as any)?.env?.VITE_KASTLE_RAW_TX_MANUAL_JSON_PROMPT_ENABLED || "true").toLowerCase() !== "false";
export const KASTLE_TX_BUILDER_URL = String((import.meta as any)?.env?.VITE_KASTLE_TX_BUILDER_URL || "").trim();
export const KASTLE_TX_BUILDER_TOKEN = String((import.meta as any)?.env?.VITE_KASTLE_TX_BUILDER_TOKEN || "").trim();
export const KASTLE_TX_BUILDER_TIMEOUT_MS = Math.max(
  1000,
  Number((import.meta as any)?.env?.VITE_KASTLE_TX_BUILDER_TIMEOUT_MS || 12000)
);
export const KASTLE_TX_BUILDER_STRICT =
  String((import.meta as any)?.env?.VITE_KASTLE_TX_BUILDER_STRICT || "false").toLowerCase() === "true";
export const KASTLE_ACCOUNT_CACHE_TTL_MS = 60_000;

export { ALLOWED_ADDRESS_PREFIXES, DEFAULT_NETWORK, ENFORCE_WALLET_NETWORK, KASPIUM_DEEP_LINK_SCHEME, NETWORK_LABEL };
export { normalizeKaspaAddress, isAddressPrefixCompatible, resolveKaspaNetwork };

export function toSompi(amountKas: number) {
  return Math.floor(Number(amountKas || 0) * 1e8);
}

export function parseKaswareBalance(payload: any) {
  const totalSompi = Number(payload?.total ?? payload?.confirmed ?? payload?.balance ?? 0);
  if (!Number.isFinite(totalSompi)) return "0.0000";
  return fmt(totalSompi / 1e8, 4);
}

export function parseKaswareTxid(payload: any) {
  if (typeof payload === "string") return payload;
  return payload?.txid || payload?.hash || payload?.transactionId || "";
}

export function isLikelyTxid(value: string) {
  return /^[a-fA-F0-9]{64}$/.test(String(value || "").trim());
}

export function formatKasAmountString(amountKas: number) {
  const fixed = Number(amountKas || 0).toFixed(8);
  return fixed.replace(/\.?0+$/, "") || "0";
}

export function kastleNetworkIdForCurrentProfile(): "mainnet" | "testnet-10" {
  const resolved = resolveKaspaNetwork(DEFAULT_NETWORK);
  return resolved.id === "mainnet" ? "mainnet" : "testnet-10";
}

export function getKastleRawTxJsonBuilderBridge() {
  if (typeof window === "undefined") return null;
  const candidate = (window as any).__FORGEOS_KASTLE_BUILD_TX_JSON__;
  return typeof candidate === "function" ? candidate : null;
}

export function normalizeOutputList(outputs: any[]) {
  if (!Array.isArray(outputs)) return [];
  return outputs
    .map((entry) => ({
      to: normalizeKaspaAddress(String(entry?.to || entry?.address || ""), ALLOWED_ADDRESS_PREFIXES),
      amount_kas: Number(Number(entry?.amount_kas ?? entry?.amount ?? 0).toFixed(8)),
    }))
    .filter((entry) => entry.to && entry.amount_kas > 0);
}

export function extractTxidDeep(value: any, depth = 0): string {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isLikelyTxid(trimmed)) return trimmed;
    const rx =
      /"(?:transactionId|transaction_id|txid|hash|id)"\s*:\s*"([a-fA-F0-9]{64})"/.exec(trimmed) ||
      /([a-fA-F0-9]{64})/.exec(trimmed);
    return rx?.[1] || "";
  }
  if (typeof value !== "object") return "";
  const direct = [
    value.txid,
    value.hash,
    value.transactionId,
    value.transaction_id,
    value.id,
    value?.transaction?.txid,
    value?.transaction?.hash,
    value?.transaction?.transactionId,
    value?.transaction?.id,
  ];
  for (const candidate of direct) {
    const txid = extractTxidDeep(candidate, depth + 1);
    if (txid) return txid;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const txid = extractTxidDeep(item, depth + 1);
      if (txid) return txid;
    }
    return "";
  }
  for (const nested of Object.values(value)) {
    const txid = extractTxidDeep(nested, depth + 1);
    if (txid) return txid;
  }
  return "";
}

export function parseAnyTxid(payload: any) {
  return extractTxidDeep(payload);
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  }) as Promise<T>;
}

export function normalizeWalletError(err: any, context: string) {
  const msg = String(err?.message || err || "wallet_error");
  if (/user rejected|rejected|denied|cancel/i.test(msg)) {
    return walletError(new Error(`${context}: User rejected wallet request`), { context });
  }
  if (/timeout/i.test(msg)) {
    return walletError(new Error(`${context}: Wallet request timed out`), { context });
  }
  if (/not detected|not connected/i.test(msg)) {
    return walletError(new Error(`${context}: Wallet unavailable`), { context });
  }
  return walletError(new Error(`${context}: ${msg}`), { context });
}

export function getKaswareProvider() {
  if (typeof window === "undefined") {
    throw new Error("Browser wallet APIs unavailable outside browser environment");
  }
  const provider = (window as any).kasware;
  if (!provider) throw new Error("Kasware extension not detected. Install from kasware.org");
  return provider;
}

export function getKastleProvider() {
  if (typeof window === "undefined") {
    throw new Error("Browser wallet APIs unavailable outside browser environment");
  }
  const provider = (window as any).kastle;
  if (!provider) throw new Error("Kastle extension not detected. Install from kastle.cc");
  return provider;
}

const kastleRawTxRuntime = createKastleRawTxRuntime({
  allKaspaAddressPrefixes: ALL_KASPA_ADDRESS_PREFIXES,
  walletCallTimeoutMs: WALLET_CALL_TIMEOUT_MS,
  kastleAccountCacheTtlMs: KASTLE_ACCOUNT_CACHE_TTL_MS,
  kastleTxBuilderUrl: KASTLE_TX_BUILDER_URL,
  kastleTxBuilderToken: KASTLE_TX_BUILDER_TOKEN,
  kastleTxBuilderTimeoutMs: KASTLE_TX_BUILDER_TIMEOUT_MS,
  kastleTxBuilderStrict: KASTLE_TX_BUILDER_STRICT,
  kastleRawTxManualJsonPromptEnabled: KASTLE_RAW_TX_MANUAL_JSON_PROMPT_ENABLED,
  getKastleProvider,
  withTimeout,
  normalizeKaspaAddress,
  normalizeOutputList,
  kastleNetworkIdForCurrentProfile,
  getKastleRawTxJsonBuilderBridge,
});

export const getKastleAccountAddress = (...args: Parameters<typeof kastleRawTxRuntime.getKastleAccountAddress>) =>
  kastleRawTxRuntime.getKastleAccountAddress(...args);
export const setKastleAccountCacheAddress = (...args: Parameters<typeof kastleRawTxRuntime.setKastleAccountCacheAddress>) =>
  kastleRawTxRuntime.setKastleAccountCacheAddress(...args);
export const getKastleCachedAccountAddress = (...args: Parameters<typeof kastleRawTxRuntime.getKastleCachedAccountAddress>) =>
  kastleRawTxRuntime.getKastleCachedAccountAddress(...args);
export const buildKastleRawTxJson = (...args: Parameters<typeof kastleRawTxRuntime.buildKastleRawTxJson>) =>
  kastleRawTxRuntime.buildKastleRawTxJson(...args);

const ghostBridgeRuntime = createGhostBridgeRuntime({
  scanTimeoutMs: GHOST_PROVIDER_SCAN_TIMEOUT_MS,
});

export const probeGhostProviders = (...args: Parameters<typeof ghostBridgeRuntime.probeGhostProviders>) =>
  ghostBridgeRuntime.probeGhostProviders(...args);

export const ghostInvoke = (...args: Parameters<typeof ghostBridgeRuntime.ghostInvoke>) =>
  ghostBridgeRuntime.ghostInvoke(...args);

export async function promptForTxidIfNeeded(txid: string, promptLabel: string, rawPayload?: string) {
  if (txid && isLikelyTxid(txid)) return txid;
  if (typeof window === "undefined" || typeof window.prompt !== "function") {
    throw new Error(`${promptLabel} did not return a transaction id`);
  }
  const rawPreview = String(rawPayload || "").slice(0, 600);
  const pasted = window.prompt(
    `${promptLabel} did not return a clear txid. Paste the broadcast txid.\n\nRaw wallet response preview:\n${rawPreview}`
  );
  if (!pasted) throw new Error("Transaction not confirmed. No txid provided.");
  if (!isLikelyTxid(pasted.trim())) {
    throw new Error("Invalid txid format. Expected a 64-char hex transaction id.");
  }
  return pasted.trim();
}
