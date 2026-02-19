import { resolveKaspaNetwork } from "./kaspa/network";

const env = import.meta.env;

function runtimeNetworkOverride() {
  if (typeof window === "undefined") return "";
  const fromQuery = new URLSearchParams(window.location.search).get("network");
  if (fromQuery) return fromQuery;
  try {
    return window.localStorage.getItem("forgeos.network") || "";
  } catch {
    return "";
  }
}

const ACTIVE_NETWORK = runtimeNetworkOverride() || env.VITE_KAS_NETWORK || "kaspa_testnet_10";
export const NETWORK_PROFILE = resolveKaspaNetwork(ACTIVE_NETWORK);
export const DEFAULT_NETWORK = NETWORK_PROFILE.id;
export const NETWORK_LABEL = env.VITE_KAS_NETWORK_LABEL || NETWORK_PROFILE.label;
export const ALLOWED_ADDRESS_PREFIXES = NETWORK_PROFILE.addressPrefixes;

export const KAS_API =
  env.VITE_KAS_API ||
  (DEFAULT_NETWORK.startsWith("testnet") ? "https://api-tn10.kaspa.org" : "https://api.kaspa.org");
export const KAS_API_FALLBACKS = String(env.VITE_KAS_API_FALLBACKS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

export const EXPLORER =
  env.VITE_KAS_EXPLORER ||
  (DEFAULT_NETWORK.startsWith("testnet") ? "https://explorer-tn10.kaspa.org" : "https://explorer.kaspa.org");
export const KAS_WS_URL = env.VITE_KAS_WS_URL || "";
export const KASPIUM_DEEP_LINK_SCHEME = env.VITE_KASPIUM_DEEP_LINK_SCHEME || "kaspium://";
export const ENFORCE_WALLET_NETWORK = String(env.VITE_KAS_ENFORCE_WALLET_NETWORK || "true").toLowerCase() !== "false";
export const ACCUMULATE_ONLY = String(env.VITE_ACCUMULATE_ONLY || "true").toLowerCase() !== "false";

const IS_TESTNET = DEFAULT_NETWORK.startsWith("testnet");
const MAINNET_TREASURY = env.VITE_TREASURY_ADDRESS_MAINNET || "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85";
const TESTNET_TREASURY = env.VITE_TREASURY_ADDRESS_TESTNET || "kaspatest:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85";
const MAINNET_ACCUMULATION = env.VITE_ACCUMULATION_ADDRESS_MAINNET || MAINNET_TREASURY;
const TESTNET_ACCUMULATION = env.VITE_ACCUMULATION_ADDRESS_TESTNET || TESTNET_TREASURY;

export const TREASURY = IS_TESTNET ? TESTNET_TREASURY : MAINNET_TREASURY;
export const ACCUMULATION_VAULT = IS_TESTNET ? TESTNET_ACCUMULATION : MAINNET_ACCUMULATION;
export const FEE_RATE = Number(env.VITE_FEE_RATE || 0.20);       // KAS per execution cycle
export const TREASURY_SPLIT = Number(env.VITE_TREASURY_SPLIT || 0.30); // 30% of fees to treasury
export const AGENT_SPLIT = Number((1 - TREASURY_SPLIT).toFixed(2));    // remaining % to agent pool
export const RESERVE  = 0.50;
export const NET_FEE  = 0.0002;
export const CONF_THRESHOLD = 0.75;

if (!Number.isFinite(FEE_RATE) || FEE_RATE < 0) {
  throw new Error("Invalid VITE_FEE_RATE. Expected a non-negative numeric value.");
}

if (!Number.isFinite(TREASURY_SPLIT) || TREASURY_SPLIT < 0 || TREASURY_SPLIT > 1) {
  throw new Error("Invalid VITE_TREASURY_SPLIT. Expected a value between 0 and 1.");
}
