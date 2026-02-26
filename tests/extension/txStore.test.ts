// Phase 6 — Integration tests: Transaction store (Phase 3)
// Tests BigInt round-tripping, CRUD operations, pruning, and locked-UTXO key derivation.
// serialiseTx/deserialiseTx are private — BigInt behavior is tested indirectly via add+load.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── chrome.storage.local mock ─────────────────────────────────────────────────
let chromeStorageData: Record<string, any> = {};

function setupChromeMock() {
  chromeStorageData = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: string | string[], cb?: (r: any) => void) => {
          const ks = Array.isArray(keys) ? keys : [keys];
          const result: any = {};
          ks.forEach((k) => { if (chromeStorageData[k] !== undefined) result[k] = chromeStorageData[k]; });
          if (cb) cb(result);
          return Promise.resolve(result);
        },
        set: (items: Record<string, any>, cb?: () => void) => {
          Object.assign(chromeStorageData, items);
          if (cb) cb();
          return Promise.resolve();
        },
        remove: (keys: string | string[], cb?: () => void) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete chromeStorageData[k]);
          if (cb) cb();
          return Promise.resolve();
        },
      },
    },
    runtime: { lastError: undefined },
  };
}

beforeEach(() => {
  vi.resetModules();
  setupChromeMock();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal valid Utxo input for PendingTx.inputs. */
function makeUtxoInput(txId = "deadbeef", outputIndex = 0) {
  return {
    txId,
    outputIndex,
    address: "kaspa:qfrom",
    amount: BigInt("110000000"),      // 1.1 KAS in sompi
    scriptPublicKey: "aa20aabb",
    scriptVersion: 0,
    blockDaaScore: BigInt("1000000"),
    isCoinbase: false,
  };
}

/** Build a fully valid PendingTx (all required BigInt fields included). */
function makeTx(overrides: Record<string, any> = {}): any {
  return {
    id: `tx-${Math.random().toString(36).slice(2)}`,
    state: "BUILDING",
    fee: BigInt("10000"),
    network: "mainnet",
    fromAddress: "kaspa:qfrom",
    builtAt: Date.now(),
    inputs: [makeUtxoInput()],
    outputs: [{ address: "kaspa:qto", amount: BigInt("100000000") }],
    changeOutput: { address: "kaspa:qfrom", amount: BigInt("9990000") },
    ...overrides,
  };
}

// ── BigInt round-trip (via add + load) ────────────────────────────────────────
// serialiseTx / deserialiseTx are private; we test their effect through the public API.

describe("BigInt round-trip via add + load", () => {
  it("all BigInt fields survive JSON serialization to chrome.storage and back", async () => {
    const { addPendingTx, loadPendingTxs } = await import("../../extension/tx/store");
    const tx = makeTx();
    await addPendingTx(tx);
    const loaded = await loadPendingTxs();
    const found = loaded.find((t: any) => t.id === tx.id)!;
    expect(found).not.toBeUndefined();
    expect(found.fee).toBe(BigInt("10000"));
    expect(found.inputs[0].amount).toBe(BigInt("110000000"));
    expect(found.inputs[0].blockDaaScore).toBe(BigInt("1000000"));
    expect(found.outputs[0].amount).toBe(BigInt("100000000"));
    expect(found.changeOutput!.amount).toBe(BigInt("9990000"));
  });

  it("null changeOutput is preserved (no TypeError on null .amount access)", async () => {
    const { addPendingTx, loadPendingTxs } = await import("../../extension/tx/store");
    const tx = makeTx({ changeOutput: null });
    await addPendingTx(tx);
    const loaded = await loadPendingTxs();
    expect(loaded.find((t: any) => t.id === tx.id)!.changeOutput).toBeNull();
  });
});

// ── Store CRUD ────────────────────────────────────────────────────────────────

describe("addPendingTx + loadPendingTxs", () => {
  it("persists a tx and retrieves it with BigInt fee intact", async () => {
    const { addPendingTx, loadPendingTxs } = await import("../../extension/tx/store");
    const tx = makeTx();
    await addPendingTx(tx);
    const loaded = await loadPendingTxs();
    const found = loaded.find((t: any) => t.id === tx.id);
    expect(found).not.toBeUndefined();
    expect(found!.fee).toBe(BigInt("10000"));
  });

  it("load returns empty array when storage has no key", async () => {
    const { loadPendingTxs } = await import("../../extension/tx/store");
    expect(await loadPendingTxs()).toEqual([]);
  });

  it("multiple txs are all persisted and retrievable", async () => {
    const { addPendingTx, loadPendingTxs } = await import("../../extension/tx/store");
    const tx1 = makeTx();
    const tx2 = makeTx();
    await addPendingTx(tx1);
    await addPendingTx(tx2);
    const ids = (await loadPendingTxs()).map((t: any) => t.id);
    expect(ids).toContain(tx1.id);
    expect(ids).toContain(tx2.id);
  });
});

describe("updatePendingTx", () => {
  it("updates state of an existing tx", async () => {
    const { addPendingTx, updatePendingTx, loadPendingTxs } = await import("../../extension/tx/store");
    const tx = makeTx({ state: "BUILDING" });
    await addPendingTx(tx);
    await updatePendingTx({ ...tx, state: "SIGNED" });
    const found = (await loadPendingTxs()).find((t: any) => t.id === tx.id);
    expect(found!.state).toBe("SIGNED");
  });
});

describe("getPendingTxById", () => {
  it("retrieves tx by id", async () => {
    const { addPendingTx, getPendingTxById } = await import("../../extension/tx/store");
    const tx = makeTx();
    await addPendingTx(tx);
    const found = await getPendingTxById(tx.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(tx.id);
  });

  it("returns null for non-existent id", async () => {
    const { getPendingTxById } = await import("../../extension/tx/store");
    expect(await getPendingTxById("no-such-id")).toBeNull();
  });
});

describe("getLockedUtxoKeys", () => {
  it("returns locked utxo keys for active (non-terminal) txs", async () => {
    const { addPendingTx, getLockedUtxoKeys } = await import("../../extension/tx/store");
    const tx = makeTx({
      fromAddress: "kaspa:qfrom",
      state: "SIGNED",
      inputs: [makeUtxoInput("abc123", 0)],
    });
    await addPendingTx(tx);
    const locked = await getLockedUtxoKeys("kaspa:qfrom");
    expect(locked.has("abc123:0")).toBe(true);
  });

  it("does not lock UTXOs for terminal state txs (CONFIRMED)", async () => {
    const { addPendingTx, getLockedUtxoKeys } = await import("../../extension/tx/store");
    const tx = makeTx({
      fromAddress: "kaspa:qfrom",
      state: "CONFIRMED",
      inputs: [makeUtxoInput("deadbeef", 0)],
    });
    await addPendingTx(tx);
    const locked = await getLockedUtxoKeys("kaspa:qfrom");
    expect(locked.has("deadbeef:0")).toBe(false);
  });

  it("returns empty set when no active txs exist for address", async () => {
    const { getLockedUtxoKeys } = await import("../../extension/tx/store");
    expect((await getLockedUtxoKeys("kaspa:qfrom")).size).toBe(0);
  });
});

// ── Pruning ───────────────────────────────────────────────────────────────────
// Pruning runs on the FIRST load from storage. We pre-populate chromeStorageData
// directly (bypassing addPendingTx) so the fresh module's first loadPendingTxs()
// hits the prune path rather than returning already-cached in-memory data.

const PENDING_TX_STORAGE_KEY = "forgeos.pending.txs.v1";

/** Mimic serialiseTx so we can write directly to mock storage. */
function serialiseMock(txs: any[]): string {
  return JSON.stringify(txs.map((tx) => ({
    ...tx,
    fee: tx.fee.toString(),
    changeOutput: tx.changeOutput
      ? { ...tx.changeOutput, amount: tx.changeOutput.amount.toString() }
      : null,
    outputs: tx.outputs.map((o: any) => ({ ...o, amount: o.amount.toString() })),
    inputs: tx.inputs.map((i: any) => ({
      ...i,
      amount: i.amount.toString(),
      blockDaaScore: i.blockDaaScore.toString(),
    })),
  })));
}

describe("loadPendingTxs — pruning", () => {
  it("prunes terminal txs older than 7 days on first load from storage", async () => {
    const oldConfirmed = makeTx({
      state: "CONFIRMED",
      builtAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days — past prune window
    });
    const freshBuilding = makeTx({ state: "BUILDING" });

    // Pre-populate chrome storage so the fresh module load reads and prunes it
    chromeStorageData[PENDING_TX_STORAGE_KEY] = serialiseMock([oldConfirmed, freshBuilding]);

    const { loadPendingTxs } = await import("../../extension/tx/store");
    const loaded = await loadPendingTxs();
    expect(loaded.find((t: any) => t.id === oldConfirmed.id)).toBeUndefined();
    expect(loaded.find((t: any) => t.id === freshBuilding.id)).not.toBeUndefined();
  });

  it("keeps terminal txs within 7-day window", async () => {
    const recentConfirmed = makeTx({
      state: "CONFIRMED",
      builtAt: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days — within window
    });

    chromeStorageData[PENDING_TX_STORAGE_KEY] = serialiseMock([recentConfirmed]);

    const { loadPendingTxs } = await import("../../extension/tx/store");
    const loaded = await loadPendingTxs();
    expect(loaded.find((t: any) => t.id === recentConfirmed.id)).not.toBeUndefined();
  });
});
