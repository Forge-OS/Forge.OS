export type ForgeErrorDomain = "wallet" | "rpc" | "ai" | "tx" | "lifecycle" | "system";

export type ForgeErrorCode =
  | "WALLET_UNAVAILABLE"
  | "WALLET_TIMEOUT"
  | "WALLET_USER_REJECTED"
  | "WALLET_PROVIDER_INVALID"
  | "WALLET_NETWORK_MISMATCH"
  | "RPC_UNAVAILABLE"
  | "RPC_TIMEOUT"
  | "RPC_RATE_LIMIT"
  | "RPC_RESPONSE_INVALID"
  | "AI_UNAVAILABLE"
  | "AI_TIMEOUT"
  | "TX_INVALID"
  | "TX_BROADCAST_FAILED"
  | "TX_REJECTED"
  | "LIFECYCLE_INVALID_TRANSITION"
  | "UNKNOWN";

export class ForgeError extends Error {
  domain: ForgeErrorDomain;
  code: ForgeErrorCode;
  retryable: boolean;
  details?: Record<string, any>;
  cause?: unknown;

  constructor(params: {
    message: string;
    domain: ForgeErrorDomain;
    code: ForgeErrorCode;
    retryable?: boolean;
    details?: Record<string, any>;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "ForgeError";
    this.domain = params.domain;
    this.code = params.code;
    this.retryable = Boolean(params.retryable);
    this.details = params.details;
    this.cause = params.cause;
  }
}

export function isForgeError(err: unknown): err is ForgeError {
  return err instanceof ForgeError;
}

export function makeForgeError(params: ConstructorParameters<typeof ForgeError>[0]) {
  return new ForgeError(params);
}

function inferCode(domain: ForgeErrorDomain, message: string): ForgeErrorCode {
  const msg = String(message || "").toLowerCase();
  if (domain === "wallet") {
    if (/timeout/.test(msg)) return "WALLET_TIMEOUT";
    if (/rejected|denied|cancel/.test(msg)) return "WALLET_USER_REJECTED";
    if (/network/.test(msg) && /mismatch|expected|switch/.test(msg)) return "WALLET_NETWORK_MISMATCH";
    if (/not detected|unavailable|not connected|browser wallet apis unavailable/.test(msg)) return "WALLET_UNAVAILABLE";
    if (/provider missing|invalid/.test(msg)) return "WALLET_PROVIDER_INVALID";
  }
  if (domain === "rpc") {
    if (/timeout/.test(msg)) return "RPC_TIMEOUT";
    if (/429|rate/i.test(msg)) return "RPC_RATE_LIMIT";
    if (/invalid/.test(msg)) return "RPC_RESPONSE_INVALID";
    return "RPC_UNAVAILABLE";
  }
  if (domain === "ai") {
    if (/timeout/.test(msg)) return "AI_TIMEOUT";
    return "AI_UNAVAILABLE";
  }
  if (domain === "tx") {
    if (/invalid/.test(msg)) return "TX_INVALID";
    if (/rejected|denied|cancel/.test(msg)) return "TX_REJECTED";
    return "TX_BROADCAST_FAILED";
  }
  if (domain === "lifecycle") return "LIFECYCLE_INVALID_TRANSITION";
  return "UNKNOWN";
}

export function normalizeError(err: unknown, fallback: {
  domain?: ForgeErrorDomain;
  code?: ForgeErrorCode;
  message?: string;
  retryable?: boolean;
  details?: Record<string, any>;
} = {}) {
  if (isForgeError(err)) return err;

  const rawMessage = String((err as any)?.message || err || fallback.message || "Unknown error");
  const domain = fallback.domain || "system";
  const code = fallback.code || inferCode(domain, rawMessage);
  const retryable = typeof fallback.retryable === "boolean"
    ? fallback.retryable
    : /(timeout|network|unavailable|429|503|502|504)/i.test(rawMessage);

  return new ForgeError({
    message: rawMessage,
    domain,
    code,
    retryable,
    details: fallback.details,
    cause: err,
  });
}

export function formatForgeError(err: unknown) {
  const fx = normalizeError(err);
  return `${fx.code}: ${fx.message}`;
}

export function walletError(err: unknown, details?: Record<string, any>) {
  return normalizeError(err, { domain: "wallet", details });
}

export function rpcError(err: unknown, details?: Record<string, any>) {
  return normalizeError(err, { domain: "rpc", details });
}

export function txError(err: unknown, details?: Record<string, any>) {
  return normalizeError(err, { domain: "tx", details });
}
