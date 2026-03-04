// In-extension transaction signer — managed wallet path only.
// Derives private key from the in-memory session mnemonic and signs via kaspa-wasm.
// Private key bytes are held only for the duration of this function call;
// references are cleared before returning.

import type { PendingTx } from "./types";
import { getSession, getCachedPrivKey, setCachedPrivKey } from "../vault/vault";
import { buildKaspaWasmTx } from "./builder";
import { loadKaspaWasm } from "../../src/wallet/kaspaWasmLoader";
import { DEFAULT_KASPA_DERIVATION, normalizeKaspaDerivation } from "../../src/wallet/derivation";

/**
 * Sign a pre-built kaspa-wasm Generator pending transaction using an explicit
 * private key hex (not derived from BIP44). Used for escrow claim/refund where
 * the private key is the ephemeral escrow key, not the wallet's BIP44 key.
 *
 * @param privKeyHex  Hex-encoded 32-byte private key (ephemeral, e.g. from EscrowOffer)
 * @param wasmPending The kaspa-wasm pending transaction returned by Generator.next()
 * @returns           Serialized signed transaction JSON string
 * @throws            "SIGN_WITH_EXPLICIT_KEY_FAILED" wrapping the underlying error
 */
export async function signWithExplicitKey(
  privKeyHex: string,
  wasmPending: unknown,
): Promise<string> {
  const kaspa = await loadKaspaWasm();
  const PrivateKey = (kaspa as Record<string, unknown>).PrivateKey as
    | (new (hex: string) => unknown)
    | undefined;
  if (!PrivateKey) throw new Error("KASPA_WASM_PRIVKEY_UNAVAILABLE");

  let keyRef: unknown = null;
  try {
    keyRef = new PrivateKey(privKeyHex);
    const pending = wasmPending as {
      sign: (keys: unknown[]) => Promise<void>;
      serializeToObject?: () => unknown;
      toJSON?: () => string;
    };
    await pending.sign([keyRef]);
    if (typeof pending.serializeToObject === "function") {
      return JSON.stringify({ transaction: pending.serializeToObject() });
    } else if (typeof pending.toJSON === "function") {
      return pending.toJSON();
    }
    return JSON.stringify({ transaction: pending });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`SIGN_WITH_EXPLICIT_KEY_FAILED: ${msg}`);
  } finally {
    keyRef = null;
  }
}

// Lazy-load kaspa-wasm
const loadKaspa = loadKaspaWasm;

/**
 * Sign a built transaction using the managed wallet's in-memory private key.
 *
 * Steps:
 *  1. Assert session is active (wallet unlocked).
 *  2. Derive private key from mnemonic using vault-persisted derivation metadata.
 *  3. Build kaspa-wasm generator pending transaction.
 *  4. Sign all inputs.
 *  5. Serialise the signed transaction for REST broadcast.
 *  6. Clear private key reference.
 *
 * @param tx  PendingTx that has passed dry-run validation.
 * @returns   The tx with signedTxPayload populated and state set to SIGNED.
 * @throws    "WALLET_LOCKED" if session is not active.
 * @throws    "SIGN_FAILED" wrapping the underlying error.
 */
export async function signTransaction(tx: PendingTx): Promise<PendingTx> {
  const session = getSession();
  if (!session || !session.mnemonic) throw new Error("WALLET_LOCKED");

  const kaspa = await loadKaspa();

  // ── Key derivation (vault-persisted path/account/chain/index) ─────────────
  const { Mnemonic, XPrv, XPrivateKey } = kaspa as Record<string, unknown> as {
    Mnemonic: new (phrase: string) => { toSeed: (password?: string) => string };
    XPrv: new (seed: string) => {
      derivePath: (path: string) => unknown;
      intoString: (prefix: string) => string;
    };
    XPrivateKey: new (xprvStr: string, isMultisig: boolean, accountIndex: bigint) => {
      receiveKey: (index: number) => {
        toKeypair: () => {
          privateKey?: unknown;
          toPrivateKey?: () => unknown;
        };
        toString?: (encoding?: string) => string;
      };
      changeKey: (index: number) => {
        toKeypair: () => {
          privateKey?: unknown;
          toPrivateKey?: () => unknown;
        };
        toString?: (encoding?: string) => string;
      };
    };
  };

  let privKeyRef: unknown = null;
  const PrivateKey = (kaspa as Record<string, unknown>).PrivateKey as
    | (new (keyHex: string) => unknown)
    | undefined;

  try {
    // B3: Fast path — reuse cached private key if address matches current session
    const cachedHex = getCachedPrivKey(session.address);
    if (cachedHex && PrivateKey) {
      privKeyRef = new PrivateKey(cachedHex);
    } else {
      // Full BIP44 derivation
      const derivation = normalizeKaspaDerivation(session.derivation ?? DEFAULT_KASPA_DERIVATION);
      const mnemonic = new Mnemonic(session.mnemonic);
      const seed = mnemonic.toSeed(session.mnemonicPassphrase || undefined);
      const masterXPrv = new XPrv(seed);
      let accountRootXPrv = masterXPrv;
      try {
        accountRootXPrv = masterXPrv.derivePath(derivation.path) as typeof masterXPrv;
      } catch (err) {
        if (derivation.path.startsWith("m/")) {
          accountRootXPrv = masterXPrv.derivePath(derivation.path.slice(2)) as typeof masterXPrv;
        } else {
          throw err;
        }
      }
      const xprvStr = accountRootXPrv.intoString("kprv");
      const xprvKey = new XPrivateKey(xprvStr, false, BigInt(derivation.account));
      const pathKey = derivation.chain === 1
        ? xprvKey.changeKey(derivation.index)
        : xprvKey.receiveKey(derivation.index);
      const keypair = pathKey.toKeypair();

      // Get PrivateKey instance for Generator.sign()
      // kaspa-wasm ≥ 0.13.0 exposes it via keypair.privateKey or keypair.toPrivateKey()
      privKeyRef = keypair.privateKey ?? (
        typeof (keypair as Record<string, unknown>).toPrivateKey === "function"
          ? ((keypair as Record<string, unknown>).toPrivateKey as () => unknown)()
          : null
      );

      if (!privKeyRef) {
        // Last resort: construct PrivateKey from the serialised key string if available
        const rawKeyStr = typeof (pathKey as Record<string, unknown>).toString === "function"
          ? (pathKey as Record<string, unknown>).toString("hex")
          : null;
        if (PrivateKey && rawKeyStr) {
          privKeyRef = new PrivateKey(rawKeyStr as string);
          // Cache for subsequent signs this session
          setCachedPrivKey(session.address, rawKeyStr as string);
        }
      } else if (PrivateKey) {
        // Cache the raw key hex extracted via toString for future fast path
        const rawKeyStr = typeof (privKeyRef as Record<string, unknown>).toString === "function"
          ? ((privKeyRef as Record<string, unknown>).toString as (enc?: string) => string)("hex")
          : null;
        if (rawKeyStr) setCachedPrivKey(session.address, rawKeyStr);
      }

      if (!privKeyRef) {
        throw new Error(
          "PRIVKEY_UNAVAILABLE: Could not extract PrivateKey from keypair. " +
          "Verify kaspa-wasm version compatibility.",
        );
      }
    }

    // ── Build generator transaction ─────────────────────────────────────────
    const pending = await buildKaspaWasmTx(tx) as {
      sign: (keys: unknown[]) => Promise<void>;
      id?: string;
      transaction?: unknown;
      serializeToObject?: () => unknown;
      toJSON?: () => string;
    };

    // ── Sign all inputs ─────────────────────────────────────────────────────
    await pending.sign([privKeyRef]);

    // ── Serialise for REST broadcast ─────────────────────────────────────────
    let signedPayload: string;
    if (typeof pending.serializeToObject === "function") {
      // Preferred: kaspa-wasm serialisation to object
      signedPayload = JSON.stringify({ transaction: pending.serializeToObject() });
    } else if (typeof pending.toJSON === "function") {
      signedPayload = pending.toJSON();
    } else {
      // Fallback: stringify the pending object directly
      signedPayload = JSON.stringify({ transaction: pending });
    }

    // Extract txId from the generator pending tx
    const txId = (pending as Record<string, unknown>).id as string | undefined;

    return {
      ...tx,
      state: "SIGNED",
      signedTxPayload: signedPayload,
      txId,          // Pre-computed by kaspa-wasm before broadcast
      signedAt: Date.now(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`SIGN_FAILED: ${msg}`);
  } finally {
    // Clear private key reference — allow GC
    privKeyRef = null;
  }
}
