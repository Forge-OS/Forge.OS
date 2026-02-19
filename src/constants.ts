const env = import.meta.env;

export const KAS_API  = env.VITE_KAS_API || "https://api.kaspa.org";
export const EXPLORER = env.VITE_KAS_EXPLORER || "https://explorer.kaspa.org";
export const DEFAULT_NETWORK = env.VITE_KAS_NETWORK || "kaspa_testnet_10";
export const NETWORK_LABEL = env.VITE_KAS_NETWORK_LABEL || "Kaspa Testnet 10";
export const KAS_WS_URL = env.VITE_KAS_WS_URL || "";
export const KASPIUM_DEEP_LINK_SCHEME = env.VITE_KASPIUM_DEEP_LINK_SCHEME || "kaspium://";

export const TREASURY = "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85";
export const FEE_RATE = 0.20;           // KAS per execution cycle
export const TREASURY_SPLIT = 0.30;     // 30% of fees to treasury
export const AGENT_SPLIT    = 0.70;     // 70% of fees to agent pool
export const RESERVE  = 0.50;
export const NET_FEE  = 0.0002;
export const CONF_THRESHOLD = 0.75;
