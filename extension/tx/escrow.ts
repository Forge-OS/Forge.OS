// UTXO Escrow — trustless P2PK escrow without exotic opcodes.
//
// Protocol:
//   1. Alice calls createEscrowOffer() → gets an EscrowOffer with an ephemeral
//      private key and its corresponding Kaspa address.
//   2. Alice calls lockEscrow() → sends KAS to offer.escrowAddress.
//   3. Alice shares offer.escrowAddress with Bob so he can verify payment on-chain.
//   4. Once Bob confirms the UTXO, Alice calls revealPrivKey() to share privKeyHex.
//   5. Bob calls claimEscrow() with the revealed key → sweeps to his address.
//   6. If TTL expires before Bob claims, Alice calls refundEscrow() → sweeps back.
//
// Use cases: KAS OTC, KRC20/KRC721 deal settlement, agent trustless escrow.

import { loadKaspaWasm } from "../../src/wallet/kaspaWasmLoader";
import { executeKaspaIntent } from "./kernel";
import { getSession } from "../vault/vault";
import { apiFetch } from "../network/kaspaClient";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EscrowStatus = "pending_lock" | "locked" | "claimed" | "refunded" | "expired";

export interface EscrowOffer {
  id: string;
  amountKas: number;
  ttlMs: number;
  network: string;
  escrowAddress: string;
  privKeyHex: string;      // EPHEMERAL — never the wallet's BIP44 key
  label?: string;
  createdAt: number;
  expiresAt: number;
  status: EscrowStatus;
  lockTxId?: string;
  claimTxId?: string;
}

// ── Storage (chrome.storage.local) ────────────────────────────────────────────

const ESCROW_STORE_KEY = "forgeos.escrow.offers.v1";

export async function loadEscrowOffers(): Promise<EscrowOffer[]> {
  const result = await chrome.storage.local.get(ESCROW_STORE_KEY).catch(() => ({}));
  const raw = result?.[ESCROW_STORE_KEY];
  if (!Array.isArray(raw)) return [];
  return raw as EscrowOffer[];
}

export async function saveEscrowOffers(offers: EscrowOffer[]): Promise<void> {
  await chrome.storage.local.set({ [ESCROW_STORE_KEY]: offers }).catch(() => {});
}

async function upsertEscrowOffer(offer: EscrowOffer): Promise<void> {
  const offers = await loadEscrowOffers();
  const idx = offers.findIndex((o) => o.id === offer.id);
  if (idx >= 0) {
    offers[idx] = offer;
  } else {
    offers.push(offer);
  }
  await saveEscrowOffers(offers);
}

// ── Core primitives ───────────────────────────────────────────────────────────

/**
 * Create a new escrow offer.
 * Generates an ephemeral P2PK key pair; the escrow address is derived from it.
 * The privKeyHex must be kept secret until Alice is ready to release funds to Bob.
 */
export async function createEscrowOffer(
  amountKas: number,
  ttlMs: number,
  network: string,
  label?: string,
): Promise<EscrowOffer> {
  if (amountKas <= 0) throw new Error("ESCROW_INVALID_AMOUNT");
  if (ttlMs <= 0) throw new Error("ESCROW_INVALID_TTL");

  const kaspa = await loadKaspaWasm();
  const PrivateKey = (kaspa as Record<string, unknown>).PrivateKey as
    | (new (hex?: string) => {
        toKeypair?: () => { publicKey: { toAddress: (network: string) => { toString: () => string } } };
        toAddress?: (network: string) => { toString: () => string };
        toString?: (enc?: string) => string;
      })
    | undefined;

  if (!PrivateKey) throw new Error("KASPA_WASM_PRIVKEY_UNAVAILABLE");

  // Generate random ephemeral private key
  const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const ephemeralKey = new PrivateKey(randomHex);

  // Extract address from the ephemeral keypair
  let escrowAddress: string;
  try {
    // Try direct toAddress first (some kaspa-wasm builds expose it on PrivateKey)
    const addr = typeof ephemeralKey.toAddress === "function"
      ? ephemeralKey.toAddress(network)
      : ephemeralKey.toKeypair?.().publicKey.toAddress(network);
    if (!addr) throw new Error("no_address");
    escrowAddress = addr.toString();
  } catch {
    throw new Error(
      "ESCROW_ADDRESS_DERIVATION_FAILED: Could not derive address from ephemeral key. " +
      "Verify kaspa-wasm version compatibility.",
    );
  }

  // Serialize the key hex for storage (we already have it as randomHex)
  const privKeyHex = randomHex;

  const now = Date.now();
  const offer: EscrowOffer = {
    id: crypto.randomUUID(),
    amountKas,
    ttlMs,
    network,
    escrowAddress,
    privKeyHex,
    label,
    createdAt: now,
    expiresAt: now + ttlMs,
    status: "pending_lock",
  };

  await upsertEscrowOffer(offer);
  return offer;
}

/**
 * Lock KAS to the escrow address.
 * Sends amountKas from the active session wallet to offer.escrowAddress.
 * Uses executeKaspaIntent() (build → dry-run → sign → broadcast → confirm).
 *
 * Returns the txId of the lock transaction.
 */
export async function lockEscrow(offer: EscrowOffer, fromAddress: string): Promise<string> {
  const session = getSession();
  if (!session?.mnemonic) throw new Error("WALLET_LOCKED");

  const result = await executeKaspaIntent({
    fromAddress,
    recipients: [{ address: offer.escrowAddress, amountKas: offer.amountKas }],
    network: offer.network,
  });
  const txId = result.txId ?? result.id;

  const updated: EscrowOffer = { ...offer, status: "locked", lockTxId: txId };
  await upsertEscrowOffer(updated);
  return txId;
}

/**
 * Claim KAS from the escrow address.
 * Fetches the escrow UTXO on-chain, builds a sweep tx signed with the
 * ephemeral private key, and broadcasts it.
 *
 * Returns the txId of the claim transaction.
 */
export async function claimEscrow(
  offer: EscrowOffer,
  toAddress: string,
): Promise<string> {
  const txId = await signAndSweepEscrow(offer.escrowAddress, offer.privKeyHex, toAddress, offer.network);
  const updated: EscrowOffer = { ...offer, status: "claimed", claimTxId: txId };
  await upsertEscrowOffer(updated);
  return txId;
}

/**
 * Refund expired escrow back to the original sender.
 * Only meaningful after offer.expiresAt has passed.
 *
 * Returns the txId of the refund transaction.
 */
export async function refundEscrow(offer: EscrowOffer, toAddress: string): Promise<string> {
  if (Date.now() < offer.expiresAt) {
    throw new Error("ESCROW_NOT_EXPIRED: cannot refund before TTL expires");
  }
  const txId = await signAndSweepEscrow(offer.escrowAddress, offer.privKeyHex, toAddress, offer.network);
  const updated: EscrowOffer = { ...offer, status: "refunded" };
  await upsertEscrowOffer(updated);
  return txId;
}

/**
 * Check whether the escrow address has a UTXO on-chain (i.e. has been funded).
 * Returns the total balance in KAS (0 = not yet funded or already swept).
 */
export async function getEscrowBalance(escrowAddress: string, network: string): Promise<number> {
  try {
    const data = await apiFetch<{ balance?: number }>(
      network,
      `/addresses/${encodeURIComponent(escrowAddress)}/balance`,
    );
    return Number(data?.balance ?? 0) / 1e8;
  } catch {
    return 0;
  }
}

// ── Internal: sweep escrow address using explicit ephemeral key ────────────────

/**
 * Sweep all UTXOs from escrowAddress to toAddress using an explicit private key.
 * Called by both claimEscrow and refundEscrow.
 */
async function signAndSweepEscrow(
  escrowAddress: string,
  privKeyHex: string,
  toAddress: string,
  network: string,
): Promise<string> {
  const kaspa = await loadKaspaWasm();

  // ── Fetch UTXOs for the escrow address ──────────────────────────────────────
  let utxosRaw: Array<{
    outpoint: { transactionId: string; index: number };
    utxoEntry: {
      amount: string | number;
      scriptPublicKey: { version: number; scriptPublicKey: string };
      blockDaaScore: string | number;
      isCoinbase: boolean;
    };
  }>;
  try {
    utxosRaw = await apiFetch<typeof utxosRaw>(
      network,
      `/addresses/${encodeURIComponent(escrowAddress)}/utxos`,
    );
  } catch (err) {
    throw new Error(`ESCROW_UTXO_FETCH_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!utxosRaw?.length) throw new Error("ESCROW_NO_UTXOS: escrow address has no UTXOs to sweep");

  // ── Build entries for kaspa-wasm Generator ────────────────────────────────────
  const entries = utxosRaw.map((raw) => ({
    address: escrowAddress,
    outpoint: { transactionId: raw.outpoint.transactionId, index: raw.outpoint.index },
    amount: BigInt(raw.utxoEntry.amount),
    scriptPublicKey: {
      version: raw.utxoEntry.scriptPublicKey.version,
      scriptPublicKey: raw.utxoEntry.scriptPublicKey.scriptPublicKey,
    },
    blockDaaScore: BigInt(raw.utxoEntry.blockDaaScore),
    isCoinbase: raw.utxoEntry.isCoinbase,
  }));

  const totalSompi = entries.reduce((s, e) => s + e.amount, 0n);

  // Estimate network fee (1 input, 1 output, no platform fee for escrow sweeps)
  const FEE_SOMPI = 2_000n; // conservative flat fee for a 1-in-1-out sweep
  const sendSompi = totalSompi - FEE_SOMPI;
  if (sendSompi <= 0n) throw new Error("ESCROW_INSUFFICIENT_BALANCE: UTXO balance too small to cover fee");

  // ── kaspa-wasm Generator ───────────────────────────────────────────────────
  const Generator = (kaspa as Record<string, unknown>).Generator as
    | (new (config: unknown) => { next: () => unknown | null })
    | undefined;

  if (!Generator) throw new Error("WASM_GENERATOR_UNAVAILABLE");

  const generatorConfig = {
    entries,
    outputs: [{ address: toAddress, amount: sendSompi }],
    changeAddress: toAddress,
    priorityFee: { sompi: FEE_SOMPI },
    networkId: network,
  };

  const generator = new Generator(generatorConfig);
  const pending = generator.next() as {
    sign: (keys: unknown[]) => Promise<void>;
    id?: string;
    serializeToObject?: () => unknown;
    toJSON?: () => string;
  } | null;

  if (!pending) throw new Error("GENERATOR_EMPTY");

  // ── Sign with the ephemeral key ─────────────────────────────────────────────
  const PrivateKey = (kaspa as Record<string, unknown>).PrivateKey as
    | (new (hex: string) => unknown)
    | undefined;
  if (!PrivateKey) throw new Error("KASPA_WASM_PRIVKEY_UNAVAILABLE");

  // Wipe the key reference in finally — mirrors the pattern in signer.ts
  let ephemeralKeyObj: unknown = null;
  try {
    ephemeralKeyObj = new PrivateKey(privKeyHex);
    await pending.sign([ephemeralKeyObj]);
  } finally {
    ephemeralKeyObj = null;
  }

  // ── Serialize and broadcast ────────────────────────────────────────────────
  let signedPayload: object;
  if (typeof pending.serializeToObject === "function") {
    signedPayload = { transaction: pending.serializeToObject() };
  } else if (typeof pending.toJSON === "function") {
    // toJSON() may return a string or an already-parsed object depending on wasm version
    const jsonResult = pending.toJSON();
    signedPayload = typeof jsonResult === "string" ? JSON.parse(jsonResult) : jsonResult as object;
  } else {
    signedPayload = { transaction: pending };
  }

  const { broadcastTx } = await import("../network/kaspaClient");
  const txId = await broadcastTx(signedPayload, network);
  return txId;
}
