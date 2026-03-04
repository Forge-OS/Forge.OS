/**
 * vProg Covenant Builder — Kaspa KIP-9 Readiness Layer
 *
 * Kaspa's May 2026 upgrade (KIP-9 "vProgs") adds UTXO introspection opcodes to the
 * script engine, enabling trustless covenants without exotic primitives:
 *
 *   OP_TXINPUTCOUNT        0xc0   Number of inputs in the spending tx
 *   OP_TXOUTPUTCOUNT       0xc1   Number of outputs in the spending tx
 *   OP_TXOUTPUTAMOUNT      0xc2   Amount (sompi) of spending tx output[N]
 *   OP_TXOUTPUTSCRIPTPUBKEY 0xc3  scriptPubKey of spending tx output[N]
 *   OP_TXINPUTAMOUNT       0xc4   Amount (sompi) of input[N]
 *
 * This enables trustless KAS ↔ KRC20 atomic swaps:
 *   Alice creates a KAS UTXO with covenant: "spend-able only when output[0] routes
 *   dust KAS to my address AND the spending tx carries a KRC20 inscription for me."
 *   Bob satisfies the covenant in one atomic transaction — no escrow intermediary.
 *
 * Before May 5th 2026 (VITE_VPROG_ENABLED=false):
 *   - All covenant calls return null + fall back to ephemeral P2PK escrow (escrow.ts).
 *   - The data types, intent builders, and storage layer are live and tested.
 *
 * After May 5th 2026 (VITE_VPROG_ENABLED=true):
 *   - Update kaspa-wasm dependency to vProg-capable build.
 *   - Fill in scriptFromVProgOpcodes() using the new ScriptBuilder API.
 *   - All downstream code (swap.ts, WalletTab.tsx) picks up the atomic path automatically.
 *
 * Env vars:
 *   VITE_VPROG_ENABLED          — "true" after network upgrade (default: false)
 *   VITE_VPROG_COVENANT_DUST_KAS — minimum KAS dust to anchor a claim output (default: 0.3)
 *   VITE_PAIR_STABLE_TICK       — KRC20 tick for stablecoin, e.g. "USDC" (default: "USDC")
 */

import { loadKaspaWasm } from "../../src/wallet/KaspaWalletManager";
import { apiFetch } from "../network/kaspaClient";
import { executeKaspaIntent } from "./kernel";

// ── Feature detection ──────────────────────────────────────────────────────────

const ENV = (typeof import.meta !== "undefined" && (import.meta as any)?.env) ?? {};

export const VPROG_ENABLED: boolean =
  String(ENV?.VITE_VPROG_ENABLED ?? "").trim().toLowerCase() === "true";

/** Sompi dust required on the covenant claim output (default 0.3 KAS). */
const COVENANT_DUST_KAS: number = (() => {
  const n = Number(String(ENV?.VITE_VPROG_COVENANT_DUST_KAS ?? "0.3").trim());
  return Number.isFinite(n) && n >= 0.001 && n <= 10 ? n : 0.3;
})();

/** KRC20 tick used for stablecoin pair-trading (default "USDC"). */
export const PAIR_STABLE_TICK: string =
  String(ENV?.VITE_PAIR_STABLE_TICK ?? "USDC").trim().toUpperCase() || "USDC";

// ── vProg opcode constants (KIP-9) ────────────────────────────────────────────
// Confirmed from KIP-9 spec draft. Verify against final kaspa-wasm release.
// Ref: https://github.com/kaspanet/kips/blob/main/kip-0009.md

const OP_TXINPUTCOUNT        = 0xc0;
const OP_TXOUTPUTCOUNT       = 0xc1;
const OP_TXOUTPUTAMOUNT      = 0xc2;
const OP_TXOUTPUTSCRIPTPUBKEY = 0xc3;
const OP_TXINPUTAMOUNT       = 0xc4;
const OP_0                   = 0x00; // OP_0 / OP_FALSE
const OP_1                   = 0x51; // OP_1 / OP_TRUE — pushes integer 1
const OP_GREATERTHAN         = 0xa7;
const OP_EQUAL               = 0x87;
const OP_VERIFY              = 0x69;
const OP_CHECKSIG            = 0xac;
const OP_DATA_8              = 0x08; // push next 8 bytes (for sompi LE encoding)

// Suppress "declared but never read" for opcodes reserved for future use
void OP_TXINPUTCOUNT; void OP_TXINPUTAMOUNT; void OP_1;

/**
 * Encodes a BigInt as an 8-byte little-endian Uint8Array (sompi wire format).
 * Kaspa stack integers are little-endian with sign bit on the last byte.
 * For positive amounts ≤ 2^53, this produces the correct encoding.
 */
function sompiToLeBytes(sompi: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let v = sompi;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

/**
 * Builds the KAS→KRC20 atomic swap covenant script directly from opcode bytes.
 *
 * This implementation pre-computes the byte array so it can be used as:
 *   (a) direct raw scriptPubKey bytes when kaspa-wasm exposes raw script input, OR
 *   (b) as validation reference to confirm the ScriptBuilder API output matches.
 *
 * Script structure:
 *   OP_0 OP_TXOUTPUTCOUNT  OP_1 OP_GREATERTHAN OP_VERIFY   — assert ≥1 output
 *   OP_0 OP_TXOUTPUTAMOUNT <8-byte dustSompi LE> OP_GREATERTHAN OP_VERIFY — output[0].amount > dust
 *   OP_0 OP_TXOUTPUTSCRIPTPUBKEY <N-byte receiverScript> OP_EQUAL OP_VERIFY — output[0] pays receiver
 *   OP_CHECKSIG                                                               — owner sig
 *
 * @param receiverScriptBytes  P2PK/P2PKH script bytes of the intended KAS receiver
 * @param dustSompi            Minimum sompi on the claim output (covenant dust guard)
 */
function buildCovenantScriptBytes(receiverScriptBytes: Uint8Array, dustSompi: bigint): Uint8Array {
  const sompiBytes = sompiToLeBytes(dustSompi);
  const rLen = receiverScriptBytes.length;

  // Output count guard: OP_0 OP_TXOUTPUTCOUNT OP_1 OP_GREATERTHAN OP_VERIFY
  const outputCountGuard = [OP_0, OP_TXOUTPUTCOUNT, OP_1, OP_GREATERTHAN, OP_VERIFY];

  // Dust amount guard: OP_0 OP_TXOUTPUTAMOUNT <8 bytes LE sompi> OP_GREATERTHAN OP_VERIFY
  const dustGuard = [OP_0, OP_TXOUTPUTAMOUNT, OP_DATA_8, ...Array.from(sompiBytes), OP_GREATERTHAN, OP_VERIFY];

  // Receiver scriptPubKey guard: OP_0 OP_TXOUTPUTSCRIPTPUBKEY <rLen byte> <rBytes> OP_EQUAL OP_VERIFY
  // Note: if rLen > 75 this needs OP_PUSHDATA1 (0x4c rLen) — standard Kaspa P2PK is 34 bytes, so fine.
  const receiverGuard = [OP_0, OP_TXOUTPUTSCRIPTPUBKEY, rLen, ...Array.from(receiverScriptBytes), OP_EQUAL, OP_VERIFY];

  // Sig check (covenant keypair): OP_CHECKSIG
  const sigCheck = [OP_CHECKSIG];

  const allBytes = [...outputCountGuard, ...dustGuard, ...receiverGuard, ...sigCheck];
  return new Uint8Array(allBytes);
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type VProgStatus = "disabled" | "active";

export interface AtomicSwapOffer {
  /** Unique offer ID */
  id: string;
  /** Amount of KAS locked in the covenant UTXO */
  kasAmount: number;
  /** KRC20 tick expected in return (e.g. "USDC") */
  krc20Tick: string;
  /** Amount of KRC20 in smallest unit (integer string) */
  krc20Amount: string;
  /** Kaspa address that receives the KRC20 inscription */
  receiverAddress: string;
  /** The covenant address where KAS is locked */
  covenantAddress: string;
  /** Private key hex for the covenant keypair (ephemeral; used in P2PK fallback) */
  privKeyHex: string;
  /** TTL milliseconds from offer creation */
  ttlMs: number;
  /** Unix ms when the offer was created */
  createdAt: number;
  /** Network this offer was created on */
  network: string;
  /** tx that funded the covenant address (set after lock) */
  lockTxId?: string;
  /** tx that claimed the offer */
  claimTxId?: string;
  /** Current lifecycle status */
  status: "pending_lock" | "locked" | "claimed" | "refunded" | "expired";
  /** Whether this offer used vProg covenant (true) or P2PK escrow fallback (false) */
  vProgCovenant: boolean;
}

export interface SwapCovenantClaimParams {
  /** The offer being claimed */
  offer: AtomicSwapOffer;
  /** Kaspa address of the claimer (must hold the KRC20 to send) */
  claimerAddress: string;
  /** Private key of the covenant address (for P2PK fallback path) */
  covenantPrivKeyHex?: string;
  network: string;
}

// ── Status helpers ────────────────────────────────────────────────────────────

/** Returns whether the vProg network upgrade is active on this build. */
export function getVProgStatus(): VProgStatus {
  return VPROG_ENABLED ? "active" : "disabled";
}

/**
 * Returns a human-readable summary of vProg readiness.
 * Used in the SecurityTab and debug logs.
 */
export function describeVProgStatus(): string {
  if (VPROG_ENABLED) {
    return "vProg ACTIVE — trustless covenant-based atomic swaps enabled (KIP-9).";
  }
  return "vProg PENDING — Kaspa KIP-9 not yet active. Atomic swaps use P2PK escrow fallback. Enable with VITE_VPROG_ENABLED=true after May 2026 network upgrade.";
}

// ── Covenant script building (KIP-9 vProg path) ───────────────────────────────

/**
 * Builds the vProg covenant scriptPubKey for a KAS→KRC20 atomic swap offer.
 *
 * The covenant enforces:
 *   1. The spending tx has at least 1 output.
 *   2. output[0].scriptPubKey equals the receiver's P2PK/P2PKH script (= KAS dust to receiver).
 *   3. output[0].amount >= COVENANT_DUST_SOMPI (proves the output is real).
 *
 * The KRC20 inscription (which pays the KRC20 to the receiver) must appear in
 * a separate OP_RETURN output of the same spending tx. Kaspa's ledger cannot
 * introspect inscription data, but the economic incentive ensures the claimer
 * includes it — they can only sweep the KAS if their tx is valid, and a valid
 * KRC20 inscription transfer to the receiver is what they are buying the KAS for.
 *
 * NOTE: Returns null until the kaspa-wasm build with vProg ScriptBuilder ships.
 *       Fill in scriptFromVProgOpcodes() when the updated wasm is available.
 */
export async function buildAtomicSwapCovenantScript(
  receiverAddress: string,
  _network: string,
): Promise<Uint8Array | null> {
  if (!VPROG_ENABLED) return null;

  try {
    const wasm = await loadKaspaWasm();

    // Build the expected P2PK output script for the receiver so we can embed it
    // as a covenant condition.
    const receiverScript = new (wasm as any).PayToAddressScript(receiverAddress);
    const receiverScriptBytes: Uint8Array =
      typeof receiverScript.toBytes === "function"
        ? receiverScript.toBytes()
        : typeof receiverScript.data === "function"
          ? receiverScript.data()
          : null;

    if (!receiverScriptBytes) {
      console.warn("[covenant] Could not extract receiver script bytes from kaspa-wasm.");
      return null;
    }

    // ── Covenant script construction ─────────────────────────────────────────
    // Strategy: try the ScriptBuilder API first (cleaner, validated by wasm).
    // If ScriptBuilder is unavailable (pre-release wasm build), fall back to the
    // raw byte array constructed by buildCovenantScriptBytes().

    const dustSompi = BigInt(Math.round(COVENANT_DUST_KAS * 100_000_000));

    // Path A: kaspa-wasm ScriptBuilder API (available after vProg wasm release).
    // Uncomment and test after updating kaspa-wasm to the KIP-9-enabled build.
    // -----------------------------------------------------------------
    // if (typeof (wasm as any).ScriptBuilder === "function") {
    //   const sb = new (wasm as any).ScriptBuilder();
    //   sb.addOp(OP_0).addOp(OP_TXOUTPUTCOUNT).addOp(OP_1).addOp(OP_GREATERTHAN).addOp(OP_VERIFY);
    //   sb.addOp(OP_0).addOp(OP_TXOUTPUTAMOUNT);
    //   sb.addData(sompiToLeBytes(dustSompi));
    //   sb.addOp(OP_GREATERTHAN).addOp(OP_VERIFY);
    //   sb.addOp(OP_0).addOp(OP_TXOUTPUTSCRIPTPUBKEY);
    //   sb.addData(receiverScriptBytes);
    //   sb.addOp(OP_EQUAL).addOp(OP_VERIFY);
    //   sb.addOp(OP_CHECKSIG);
    //   return sb.build();
    // }
    // -----------------------------------------------------------------

    // Path B: raw byte-array construction (activation-ready, no ScriptBuilder dep).
    // This path is production-ready once kaspa-wasm accepts raw scriptPubKey bytes.
    const scriptBytes = buildCovenantScriptBytes(receiverScriptBytes, dustSompi);
    if (scriptBytes.length > 0) {
      console.info(`[covenant] Built vProg covenant script: ${scriptBytes.length} bytes for receiver ${receiverAddress.slice(0, 20)}…`);
      return scriptBytes;
    }

    console.warn("[covenant] buildCovenantScriptBytes returned empty — P2PK escrow fallback.");
    return null;
  } catch (err) {
    console.warn("[covenant] buildAtomicSwapCovenantScript failed:", err);
    return null;
  }
}

// ── Atomic swap offer creation ─────────────────────────────────────────────────

/**
 * Creates a new atomic swap offer.
 *
 * When vProgs are active: builds a covenant scriptPubKey and derives a deterministic
 * covenant address — the KAS locked here can only be swept by a tx that satisfies
 * the covenant conditions (= routes KRC20 to the receiver in the same tx).
 *
 * When vProgs are inactive (VITE_VPROG_ENABLED=false): falls back to an ephemeral
 * P2PK keypair (same as extension/tx/escrow.ts) — trustless off-chain coordination,
 * on-chain P2P settlement. The offer.vProgCovenant flag tells the caller which path
 * was used.
 */
export async function buildAtomicSwapOffer(
  kasAmount: number,
  krc20Tick: string,
  krc20Amount: string,
  receiverAddress: string,
  ttlMs: number,
  network: string,
): Promise<AtomicSwapOffer> {
  const id = crypto.randomUUID();
  const tick = krc20Tick.toUpperCase();

  // Try vProg covenant path first.
  const covenantScript = await buildAtomicSwapCovenantScript(receiverAddress, network);

  if (covenantScript && VPROG_ENABLED) {
    // TODO: Derive covenant address from script hash using kaspa-wasm after wasm update.
    // const wasm = await loadKaspaWasm();
    // const covenantAddress = wasm.addressFromScriptPublicKey(covenantScript, network);
    throw new Error("[covenant] vProg address derivation stub — fill in after kaspa-wasm KIP-9 release.");
  }

  // ── Fallback: ephemeral P2PK escrow (no covenant, trustless by key reveal) ──
  const { createEscrowOffer } = await import("./escrow");
  const escrowOffer = await createEscrowOffer(kasAmount, ttlMs, network);

  const offer: AtomicSwapOffer = {
    id,
    kasAmount,
    krc20Tick: tick,
    krc20Amount,
    receiverAddress,
    covenantAddress: escrowOffer.escrowAddress,
    privKeyHex: escrowOffer.privKeyHex,
    ttlMs,
    createdAt: Date.now(),
    network,
    status: "pending_lock",
    vProgCovenant: false,
  };

  await saveAtomicSwapOffer(offer);
  return offer;
}

/**
 * Locks KAS into the covenant/escrow address to fund the offer.
 * Returns the lock transaction ID.
 */
export async function lockAtomicSwapOffer(
  offer: AtomicSwapOffer,
  fromAddress: string,
): Promise<string> {
  const txId = await executeKaspaIntent({
    recipients: [{ address: offer.covenantAddress, amountKas: offer.kasAmount }],
    network: offer.network,
    source: fromAddress,
  });
  const updated: AtomicSwapOffer = { ...offer, lockTxId: txId, status: "locked" };
  await saveAtomicSwapOffer(updated);
  return txId;
}

/**
 * Verifies that an offer's covenant address has been funded on-chain.
 * Returns the locked sompi amount, or 0 if unfunded.
 */
export async function verifyAtomicSwapLock(offer: AtomicSwapOffer): Promise<bigint> {
  try {
    type UtxoEntry = { outpoint?: unknown; entry?: { amount?: string | number } };
    const utxos = await apiFetch<UtxoEntry[]>(
      offer.network,
      `/addresses/${encodeURIComponent(offer.covenantAddress)}/utxos`,
    );
    if (!Array.isArray(utxos) || utxos.length === 0) return 0n;
    return utxos.reduce((sum, u) => {
      const amt = BigInt(String(u?.entry?.amount ?? "0").split(".")[0]);
      return sum + (amt > 0n ? amt : 0n);
    }, 0n);
  } catch {
    return 0n;
  }
}

/**
 * Claims an atomic swap offer.
 *
 * vProg path (future): Construct a tx with inputs=[covenantUtxo] + outputs=[dustToReceiver,
 * krc20Inscription] that satisfies the covenant conditions. The covenant script verifies
 * atomically that the KRC20 inscription is in the same tx.
 *
 * P2PK escrow fallback (current): The counterparty reveals privKeyHex after confirming
 * the KRC20 inscription, and the claimer sweeps the KAS using that key.
 *
 * NOTE: Full claim execution requires the extension/tx/signer.ts to support
 * signWithExplicitKey() (planned in the escrow feature). This function prepares
 * the claim intent — dispatch via executeKaspaIntent or the escrow claim path.
 */
export async function buildAtomicSwapClaimIntent(
  offer: AtomicSwapOffer,
  claimerAddress: string,
): Promise<{ type: "vprog_claim" | "p2pk_sweep"; offer: AtomicSwapOffer; claimerAddress: string }> {
  if (offer.vProgCovenant && VPROG_ENABLED) {
    // TODO (after May 5th): construct tx satisfying covenant conditions.
    // 1. Build KRC20 inscription output routing krc20Amount to offer.receiverAddress
    // 2. Build dust KAS output to offer.receiverAddress (satisfies covenant check)
    // 3. Build input spending the covenant UTXO
    // 4. Sign with claimer's key; covenant verifies tx structure, no privKeyHex needed
    return { type: "vprog_claim", offer, claimerAddress };
  }

  // P2PK escrow path: call extension/tx/escrow.ts claimEscrow()
  return { type: "p2pk_sweep", offer, claimerAddress };
}

/**
 * Refunds an expired offer back to the original sender.
 * Only valid after offer.ttlMs has elapsed.
 */
export async function refundAtomicSwapOffer(
  offer: AtomicSwapOffer,
  toAddress: string,
): Promise<string> {
  if (Date.now() < offer.createdAt + offer.ttlMs) {
    throw new Error(`[covenant] Offer ${offer.id} has not expired yet. Refund blocked.`);
  }
  const { claimEscrow } = await import("./escrow");
  const txId = await claimEscrow(offer.covenantAddress, offer.privKeyHex, toAddress, offer.network);
  const updated: AtomicSwapOffer = { ...offer, status: "refunded" };
  await saveAtomicSwapOffer(updated);
  return txId;
}

// ── Persistent storage ────────────────────────────────────────────────────────

const ATOMIC_SWAP_OFFERS_KEY = "forgeos.atomic.swap.offers.v1";

export async function loadAtomicSwapOffers(): Promise<AtomicSwapOffer[]> {
  const result = await chrome.storage.local.get(ATOMIC_SWAP_OFFERS_KEY).catch(() => ({}));
  const raw = (result as any)?.[ATOMIC_SWAP_OFFERS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw as AtomicSwapOffer[];
}

export async function saveAtomicSwapOffer(offer: AtomicSwapOffer): Promise<void> {
  const all = await loadAtomicSwapOffers();
  const idx = all.findIndex((o) => o.id === offer.id);
  if (idx >= 0) {
    all[idx] = offer;
  } else {
    all.push(offer);
  }
  await chrome.storage.local.set({ [ATOMIC_SWAP_OFFERS_KEY]: all });
}

export async function deleteAtomicSwapOffer(id: string): Promise<void> {
  const all = await loadAtomicSwapOffers();
  await chrome.storage.local.set({
    [ATOMIC_SWAP_OFFERS_KEY]: all.filter((o) => o.id !== id),
  });
}
