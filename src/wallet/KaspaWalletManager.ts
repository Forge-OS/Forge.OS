// KaspaWalletManager — in-browser wallet generation & import using kaspa-wasm
// Manages the "managed" provider: no extension required, keys derived from mnemonic.
// Storage key: forgeos.managed.wallet.v1 (plaintext — user is warned in UI)

export interface ManagedWalletData {
  phrase: string;
  address: string;
  network: string;
}

const STORAGE_KEY = "forgeos.managed.wallet.v1";

// Lazy-load kaspa-wasm so the heavy WASM binary only loads when this flow is used.
async function loadKaspa() {
  // @ts-ignore — kaspa-wasm ships a flat ES module
  const kaspa = await import("kaspa-wasm");
  // Some builds require an explicit init call; call it if present and idempotent.
  const initFn = (kaspa as any).default || (kaspa as any).init;
  if (typeof initFn === "function") {
    try { await initFn(); } catch {}
  }
  return kaspa;
}

/** Derive the receive address at index 0 for a given mnemonic + network. */
async function deriveAddress(phrase: string, networkId: string): Promise<string> {
  const { Mnemonic, XPrv, XPrivateKey } = await loadKaspa();
  const mnemonic = new Mnemonic(phrase);
  const seed = mnemonic.toSeed();
  const masterXPrv = new XPrv(seed);
  const xprvStr = masterXPrv.intoString("kprv");
  const xprvKey = new XPrivateKey(xprvStr, false, BigInt(0));
  const privKey = xprvKey.receiveKey(0);
  const keypair = privKey.toKeypair();
  const address = keypair.toAddress(networkId);
  return address.toString();
}

/**
 * Generate a brand-new wallet. Returns phrase + derived address.
 *
 * @param networkId  Kaspa network ID ("mainnet" | "testnet-10" etc.)
 * @param wordCount  Mnemonic length: 12 (128-bit entropy) or 24 (256-bit, default).
 *                   Both are standard BIP39 and importable into all Kaspa wallets
 *                   using derivation path m/44'/111'/0'/0/0.
 *
 * Interoperability note:
 *   The derived address matches what Kasware, Kastle, Kaspium and other BIP44
 *   wallets derive for the same mnemonic on the same network.
 *   Derivation path: m/44'/111'/0'/0/0 (account 0, receive chain, index 0).
 */
export async function generateWallet(
  networkId: string,
  wordCount: 12 | 24 = 24,
): Promise<ManagedWalletData> {
  const { Mnemonic } = await loadKaspa();
  // kaspa-wasm Mnemonic.random() accepts an optional word count in newer builds.
  // The published typings only declare the 0-arg overload, so we cast to any
  // to pass wordCount and fall back to the 24-word default if the runtime rejects it.
  let mnemonic: any;
  try {
    mnemonic = (Mnemonic as any).random(wordCount);
  } catch {
    mnemonic = Mnemonic.random();
  }
  const phrase = mnemonic.phrase;
  const address = await deriveAddress(phrase, networkId);
  return { phrase, address, network: networkId };
}

/** Import a wallet from an existing mnemonic phrase. */
export async function importWallet(phrase: string, networkId: string): Promise<ManagedWalletData> {
  const words = phrase.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) {
    throw new Error(`Seed phrase must be 12 or 24 words (got ${words.length}).`);
  }
  const normalized = words.join(" ");
  const address = await deriveAddress(normalized, networkId);
  return { phrase: normalized, address, network: networkId };
}

/** Persist wallet to localStorage. */
export function saveManagedWallet(data: ManagedWalletData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

/** Load a previously saved managed wallet, or null if none. */
export function loadManagedWallet(): ManagedWalletData | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.phrase && parsed?.address && parsed?.network) return parsed as ManagedWalletData;
  } catch {}
  return null;
}

/** Remove the managed wallet from localStorage. */
export function clearManagedWallet(): void {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
}

/**
 * Sign a UTF-8 message with the managed wallet's derived private key.
 * Derivation path: m/44'/111'/0'/0/0 — same as Kasware, Kastle, Kaspium.
 * Returns a hex-encoded Schnorr signature.
 */
export async function signMessage(phrase: string, message: string): Promise<string> {
  const { Mnemonic, XPrv, XPrivateKey } = await loadKaspa();
  const mnemonic  = new Mnemonic(phrase);
  const seed      = mnemonic.toSeed();
  const masterXPrv = new XPrv(seed);
  const xprvStr   = masterXPrv.intoString("kprv");
  const xprvKey   = new XPrivateKey(xprvStr, false, BigInt(0));
  const privKey   = xprvKey.receiveKey(0);

  const bytes = new TextEncoder().encode(message);
  // kaspa-wasm PrivateKey.sign() is present at runtime but not in the published types
  const sig   = (privKey as any).sign(bytes) as Uint8Array;
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
