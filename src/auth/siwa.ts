// SIWA — Sign-In With (Kaspa) Address.
// Client-only authentication: wallet connection + message signature proves address ownership.
// Anti-phishing: domain name is embedded in the signed message.
// Replay protection: cryptographic nonce + expiry timestamp.
// No secrets stored — session contains only public wallet identity + timestamps.

const SESSION_KEY = "forgeos.signin.session.v1";
const SESSION_TTL_MS = 24 * 60 * 60 * 1_000; // 24 hours

export interface ForgeSession {
  address: string;
  network: string;
  provider: string;
  nonce: string;
  signedAt: number;
  expiresAt: number;
  /**
   * true when the wallet provider does not support signMessage
   * (e.g. Kaspium, hardware bridges). Treated as weaker proof-of-ownership
   * (connection = proof) rather than cryptographic signature.
   */
  skipSigning?: boolean;
}

// ── Nonce ─────────────────────────────────────────────────────────────────────

/** 16 random bytes → 32-char hex string. Used as replay-protection nonce. */
export function generateNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Message ───────────────────────────────────────────────────────────────────

/**
 * Build the canonical SIWA message.
 *
 * Anti-phishing: "Domain: forgeos.xyz" binds the signature to this site.
 * A malicious page cannot replay this message because the domain would differ.
 *
 * Nonce: randomly generated per sign-in attempt; prevents replay attacks.
 * Expires At: limits the window in which a captured message could be reused.
 */
export function buildSignInMessage(
  address: string,
  network: string,
  nonce: string,
): string {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + SESSION_TTL_MS);
  return [
    "Sign in to Forge.OS",
    "",
    "Domain: forgeos.xyz",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expires At: ${expiresAt.toISOString()}`,
    `Network: ${network}`,
    "",
    "This request will not trigger a blockchain transaction or cost any fees.",
  ].join("\n");
}

// ── Session ───────────────────────────────────────────────────────────────────

/** Create a session record. No private keys or signature bytes are stored. */
export function createSession(
  address: string,
  network: string,
  provider: string,
  nonce: string,
  skipSigning = false,
): ForgeSession {
  const now = Date.now();
  return {
    address,
    network,
    provider,
    nonce,
    signedAt: now,
    expiresAt: now + SESSION_TTL_MS,
    skipSigning,
  };
}

/** Persist session to localStorage. Safe to store — contains no secrets. */
export function saveSession(session: ForgeSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { /* storage unavailable — non-fatal */ }
}

/**
 * Load and validate session from localStorage.
 * Returns null if session is missing, malformed, or expired.
 */
export function loadSession(): ForgeSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s: ForgeSession = JSON.parse(raw);
    if (!s?.address || !s?.nonce || !s?.expiresAt) return null;
    if (Date.now() > s.expiresAt) {
      clearSession();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

/** Remove session from localStorage (disconnect / sign-out). */
export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch { /* non-fatal */ }
}
