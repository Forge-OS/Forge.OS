// KaspaWalletManager — in-browser wallet generation & import using kaspa-wasm
// Manages the "managed" provider: no extension required, keys derived from mnemonic.
// Storage key: forgeos.managed.wallet.v1 (plaintext — user is warned in UI)

import {
  COMMON_KASPA_IMPORT_BASE_PATHS,
  DEFAULT_KASPA_DERIVATION,
  derivationChainLabel,
  formatKaspaDerivationPath,
  normalizeKaspaDerivation,
  type KaspaDerivationMeta,
} from "./derivation";
import { loadKaspaWasm } from "./kaspaWasmLoader";

export interface ManagedWalletData {
  phrase: string;
  address: string;
  network: string;
  mnemonicPassphrase?: string;
  derivation?: KaspaDerivationMeta;
}

const STORAGE_KEY = "forgeos.managed.wallet.v1";
const VALID_BIP39_WORD_COUNTS = new Set([12, 15, 18, 21, 24]);

export interface ManagedWalletImportOptions {
  /** Optional BIP39 passphrase ("25th word"). Stored only when caller persists it. */
  mnemonicPassphrase?: string;
  /** Derivation selection. Defaults to standard Kaspa BIP44 m/44'/111'/0'/0/0. */
  derivation?: Partial<KaspaDerivationMeta> | null;
}

export interface ManagedWalletImportCandidate {
  address: string;
  derivation: KaspaDerivationMeta;
  derivationPath: string;
  chainLabel: "receive" | "change";
}

export interface DiscoverManagedWalletImportOptions extends ManagedWalletImportOptions {
  basePaths?: string[];
  accountRange?: [number, number];
  indexRange?: [number, number];
  chains?: Array<0 | 1>;
  limit?: number;
}

type KaspaModule = Record<string, any>;

// Lazy-load kaspa-wasm so the heavy WASM binary only loads when this flow is used.
const loadKaspa = loadKaspaWasm;

function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(" ");
}

function assertValidWordCount(phrase: string): void {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (!VALID_BIP39_WORD_COUNTS.has(words.length)) {
    throw new Error(
      `Seed phrase must be a valid BIP39 length (12/15/18/21/24 words; got ${words.length}).`,
    );
  }
}

async function createMnemonicContext(
  phrase: string,
  options: ManagedWalletImportOptions,
): Promise<{ kaspa: KaspaModule; masterXPrv: any }> {
  const kaspa = await loadKaspa();
  const { Mnemonic, XPrv } = kaspa;
  const mnemonic = new Mnemonic(phrase);
  const seed = mnemonic.toSeed(options.mnemonicPassphrase || undefined);
  const masterXPrv = new XPrv(seed);
  return { kaspa, masterXPrv };
}

function derivePathSafe(rootXPrv: any, path: string): any {
  try {
    return rootXPrv.derivePath(path);
  } catch (err) {
    if (path.startsWith("m/")) {
      try {
        return rootXPrv.derivePath(path.slice(2));
      } catch {
        // fall through to original error
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`DERIVATION_PATH_INVALID: ${path} (${msg})`);
  }
}

function derivePrivateKeyFromContext(
  ctx: { kaspa: KaspaModule; masterXPrv: any },
  derivationInput?: Partial<KaspaDerivationMeta> | null,
): { privKey: any; derivation: KaspaDerivationMeta } {
  const derivation = normalizeKaspaDerivation(derivationInput);
  const { XPrivateKey } = ctx.kaspa;

  const accountRoot = derivePathSafe(ctx.masterXPrv, derivation.path);
  const xprvStr = accountRoot.intoString("kprv");
  const xprvKey = new XPrivateKey(xprvStr, false, BigInt(derivation.account));
  const privKey =
    derivation.chain === 1
      ? xprvKey.changeKey(derivation.index)
      : xprvKey.receiveKey(derivation.index);

  return { privKey, derivation };
}

function addressFromPrivateKey(privKey: any, networkId: string): string {
  const keypair = privKey.toKeypair();
  const address = keypair.toAddress(networkId);
  return address.toString();
}

/** Derive the selected address for a given mnemonic + network. */
async function deriveAddress(
  phrase: string,
  networkId: string,
  options: ManagedWalletImportOptions = {},
): Promise<{ address: string; derivation: KaspaDerivationMeta }> {
  const ctx = await createMnemonicContext(phrase, options);
  const { privKey, derivation } = derivePrivateKeyFromContext(ctx, options.derivation);
  return { address: addressFromPrivateKey(privKey, networkId), derivation };
}

/**
 * Generate a brand-new wallet. Returns phrase + derived address.
 *
 * Interoperability note:
 *   Default derivation path is m/44'/111'/0'/0/0 (account 0, receive, index 0).
 */
export async function generateWallet(
  networkId: string,
  wordCount: 12 | 24 = 24,
): Promise<ManagedWalletData> {
  const { Mnemonic } = await loadKaspa();
  let mnemonic: any;
  try {
    mnemonic = (Mnemonic as any).random(wordCount);
  } catch {
    mnemonic = Mnemonic.random();
  }
  const phrase = mnemonic.phrase;
  const { address, derivation } = await deriveAddress(phrase, networkId, {
    derivation: DEFAULT_KASPA_DERIVATION,
  });
  return {
    phrase,
    address,
    network: networkId,
    derivation,
  };
}

/** Import a wallet from an existing mnemonic phrase. */
export async function importWallet(
  phrase: string,
  networkId: string,
  options: ManagedWalletImportOptions = {},
): Promise<ManagedWalletData> {
  assertValidWordCount(phrase);
  const normalized = normalizePhrase(phrase);
  const passphrase = options.mnemonicPassphrase || undefined;
  const { address, derivation } = await deriveAddress(normalized, networkId, options);
  return {
    phrase: normalized,
    address,
    network: networkId,
    mnemonicPassphrase: passphrase,
    derivation,
  };
}

/**
 * Scan common derivation candidates and return deduplicated addresses.
 * This powers the extension import discovery wizard for non-default paths.
 */
export async function discoverWalletImportCandidates(
  phrase: string,
  networkId: string,
  options: DiscoverManagedWalletImportOptions = {},
): Promise<ManagedWalletImportCandidate[]> {
  assertValidWordCount(phrase);
  const normalized = normalizePhrase(phrase);

  const basePaths = (options.basePaths?.length ? options.basePaths : [...COMMON_KASPA_IMPORT_BASE_PATHS])
    .map((p) => String(p).trim())
    .filter(Boolean);
  const [accountStart, accountEnd] = options.accountRange ?? [0, 4];
  const [indexStart, indexEnd] = options.indexRange ?? [0, 9];
  const chains = (options.chains?.length ? options.chains : [0, 1]).filter(
    (c): c is 0 | 1 => c === 0 || c === 1,
  );
  const limit = Math.max(1, options.limit ?? 60);

  const ctx = await createMnemonicContext(normalized, options);
  const out: ManagedWalletImportCandidate[] = [];
  const seen = new Set<string>();

  outer:
  for (let account = Math.max(0, accountStart); account <= Math.max(accountStart, accountEnd); account++) {
    for (const chain of chains) {
      for (let index = Math.max(0, indexStart); index <= Math.max(indexStart, indexEnd); index++) {
        for (const basePath of basePaths) {
          const derivation = normalizeKaspaDerivation({ path: basePath, account, chain, index });
          try {
            const { privKey } = derivePrivateKeyFromContext(ctx, derivation);
            const address = addressFromPrivateKey(privKey, networkId);
            const dedupeKey = address.toLowerCase();
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            out.push({
              address,
              derivation,
              derivationPath: formatKaspaDerivationPath(derivation),
              chainLabel: derivationChainLabel(derivation.chain),
            });
            if (out.length >= limit) break outer;
          } catch {
            // Skip invalid/path-incompatible candidates and continue scanning.
          }
        }
      }
    }
  }

  return out;
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
    if (
      parsed?.phrase &&
      parsed?.address &&
      parsed?.network &&
      (parsed?.mnemonicPassphrase === undefined || typeof parsed.mnemonicPassphrase === "string")
    ) {
      return {
        ...parsed,
        derivation: normalizeKaspaDerivation(parsed?.derivation),
      } as ManagedWalletData;
    }
  } catch {}
  return null;
}

/** Remove the managed wallet from localStorage. */
export function clearManagedWallet(): void {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
}

/**
 * Sign a UTF-8 message with the managed wallet's derived private key.
 * Uses the selected derivation metadata (defaults to standard BIP44 Kaspa path).
 */
export async function signMessage(
  phrase: string,
  message: string,
  options: ManagedWalletImportOptions = {},
): Promise<string> {
  assertValidWordCount(phrase);
  const normalized = normalizePhrase(phrase);
  const ctx = await createMnemonicContext(normalized, options);
  const { privKey } = derivePrivateKeyFromContext(ctx, options.derivation);

  const bytes = new TextEncoder().encode(message);

  // receiveKey()/changeKey() returns an HD-derived key object.
  // We need a PrivateKey with .sign() — mirror the signer.ts pattern:
  // 1. toKeypair() → get keypair
  // 2. extract raw private key string → new PrivateKey(raw) → .sign()
  const { PrivateKey } = ctx.kaspa;
  const keypair = privKey.toKeypair();
  let signingKey: any;
  try {
    const raw: unknown = (keypair as any).privateKey ?? (keypair as any).toPrivateKey?.();
    signingKey = new PrivateKey(raw);
  } catch {
    // Fallback: maybe privKey is already a PrivateKey in this wasm build
    signingKey = privKey;
  }

  const sig = signingKey.sign(bytes) as Uint8Array;
  return Array.from(sig, (b: number) => b.toString(16).padStart(2, "0")).join("");
}
