// In-extension transaction signer — managed wallet path only.
// Derives private key from the in-memory session mnemonic and signs via kaspa-wasm.
// Private key bytes are held only for the duration of this function call;
// references are cleared before returning.

import type { PendingTx } from "./types";
import { getSession } from "../vault/vault";
import { buildKaspaWasmTx } from "./builder";

// Lazy-load kaspa-wasm
async function loadKaspa() {
  const kaspa = await import("kaspa-wasm");
  const initFn = (kaspa as Record<string, unknown>).default || (kaspa as Record<string, unknown>).init;
  if (typeof initFn === "function") {
    try { await (initFn as () => Promise<void>)(); } catch { /* idempotent */ }
  }
  return kaspa;
}

/**
 * Sign a built transaction using the managed wallet's in-memory private key.
 *
 * Steps:
 *  1. Assert session is active (wallet unlocked).
 *  2. Derive private key from mnemonic (BIP44 m/44'/111'/0'/0/0).
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

  // ── Key derivation (BIP44 m/44'/111'/0'/0/0) ─────────────────────────────
  const { Mnemonic, XPrv, XPrivateKey } = kaspa as Record<string, unknown> as {
    Mnemonic: new (phrase: string) => { toSeed: () => Uint8Array };
    XPrv: new (seed: Uint8Array) => { intoString: (prefix: string) => string };
    XPrivateKey: new (xprvStr: string, isMultisig: boolean, cosignerIndex: bigint) => {
      receiveKey: (index: number) => {
        toKeypair: () => {
          privateKey?: unknown;
          toPrivateKey?: () => unknown;
        };
      };
    };
  };

  let privKeyRef: unknown = null;

  try {
    const mnemonic = new Mnemonic(session.mnemonic);
    const seed = mnemonic.toSeed();
    const masterXPrv = new XPrv(seed);
    const xprvStr = masterXPrv.intoString("kprv");
    const xprvKey = new XPrivateKey(xprvStr, false, BigInt(0));
    const receiveKey = xprvKey.receiveKey(0);
    const keypair = receiveKey.toKeypair();

    // Get PrivateKey instance for Generator.sign()
    // kaspa-wasm ≥ 0.13.0 exposes it via keypair.privateKey or keypair.toPrivateKey()
    privKeyRef = keypair.privateKey ?? (
      typeof (keypair as Record<string, unknown>).toPrivateKey === "function"
        ? ((keypair as Record<string, unknown>).toPrivateKey as () => unknown)()
        : null
    );

    if (!privKeyRef) {
      // Last resort: construct PrivateKey from the serialised key string if available
      const PrivateKey = (kaspa as Record<string, unknown>).PrivateKey as
        | (new (keyHex: string) => unknown)
        | undefined;
      const rawKeyStr = typeof (receiveKey as Record<string, unknown>).toString === "function"
        ? (receiveKey as Record<string, unknown>).toString("hex")
        : null;
      if (PrivateKey && rawKeyStr) {
        privKeyRef = new PrivateKey(rawKeyStr as string);
      }
    }

    if (!privKeyRef) {
      throw new Error(
        "PRIVKEY_UNAVAILABLE: Could not extract PrivateKey from keypair. " +
        "Verify kaspa-wasm version compatibility.",
      );
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
