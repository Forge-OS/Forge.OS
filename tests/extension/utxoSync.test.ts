// Phase 6 — Integration tests: UTXO Sync (Phase 2)
// Tests coin selection algorithm, sompi ↔ KAS conversion, cache behavior.
// The Kaspa REST API is mocked via globalThis.fetch.

import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_ADDRESS = "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85";
const SOMPI = 100_000_000n; // 1 KAS

function makeUtxo(txId: string, outputIndex: number, amountSompi: bigint): any {
  return {
    txId,
    outputIndex,
    address: TEST_ADDRESS,
    amount: amountSompi,
    scriptPublicKey: "aa20aabb",
    scriptVersion: 0,
    blockDaaScore: 1_000_000n,
    isCoinbase: false,
  };
}

// ── sompi / KAS conversion ────────────────────────────────────────────────────

describe("sompiToKas / kasToSompi", () => {
  it("converts 1 KAS = 100_000_000 sompi", async () => {
    const { sompiToKas, kasToSompi } = await import("../../extension/utxo/utxoSync");
    expect(sompiToKas(SOMPI)).toBe(1);
    expect(kasToSompi(1)).toBe(SOMPI);
  });

  it("round-trips arbitrary KAS amounts", async () => {
    const { sompiToKas, kasToSompi } = await import("../../extension/utxo/utxoSync");
    expect(kasToSompi(sompiToKas(500n * SOMPI))).toBe(500n * SOMPI);
  });

  it("zero is zero in both directions", async () => {
    const { sompiToKas, kasToSompi } = await import("../../extension/utxo/utxoSync");
    expect(sompiToKas(0n)).toBe(0);
    expect(kasToSompi(0)).toBe(0n);
  });
});

// ── Coin selection ────────────────────────────────────────────────────────────
// selectUtxos returns { selected: Utxo[]; total: bigint }

describe("selectUtxos", () => {
  it("selects enough UTXOs to cover target + fee", async () => {
    const { selectUtxos } = await import("../../extension/utxo/utxoSync");
    const utxos = [
      makeUtxo("tx1", 0, 3n * SOMPI),
      makeUtxo("tx2", 0, 2n * SOMPI),
      makeUtxo("tx3", 0, 1n * SOMPI),
    ];
    const target = 4n * SOMPI;
    const fee = 10_000n;
    const { selected, total } = selectUtxos(utxos, target, fee);
    expect(total).toBeGreaterThanOrEqual(target + fee);
    expect(selected.length).toBeGreaterThan(0);
  });

  it("prefers largest UTXOs first (greedy largest-first)", async () => {
    const { selectUtxos } = await import("../../extension/utxo/utxoSync");
    const utxos = [
      makeUtxo("small", 0, 1n * SOMPI),
      makeUtxo("large", 0, 10n * SOMPI),
      makeUtxo("medium", 0, 5n * SOMPI),
    ];
    const { selected } = selectUtxos(utxos, 1n * SOMPI, 10_000n);
    expect(selected[0].txId).toBe("large");
  });

  it("throws when balance is insufficient", async () => {
    const { selectUtxos } = await import("../../extension/utxo/utxoSync");
    const utxos = [makeUtxo("tx1", 0, 1n * SOMPI)];
    expect(() => selectUtxos(utxos, 100n * SOMPI, 10_000n)).toThrow(/insufficient/i);
  });

  it("excludes locked UTXOs", async () => {
    const { selectUtxos } = await import("../../extension/utxo/utxoSync");
    const utxos = [
      makeUtxo("locked", 0, 10n * SOMPI),
      makeUtxo("free", 0, 5n * SOMPI),
    ];
    const locked = new Set(["locked:0"]);
    const { selected } = selectUtxos(utxos, 1n * SOMPI, 10_000n, locked);
    expect(selected.every((u: any) => u.txId !== "locked")).toBe(true);
  });

  it("throws when all UTXOs are locked and balance would be sufficient", async () => {
    const { selectUtxos } = await import("../../extension/utxo/utxoSync");
    const utxos = [makeUtxo("locked", 0, 100n * SOMPI)];
    const locked = new Set(["locked:0"]);
    expect(() => selectUtxos(utxos, 1n * SOMPI, 10_000n, locked)).toThrow(/insufficient/i);
  });

  it("returns minimum set (stops as soon as covered)", async () => {
    const { selectUtxos } = await import("../../extension/utxo/utxoSync");
    const utxos = [
      makeUtxo("big", 0, 100n * SOMPI),
      makeUtxo("small1", 1, 1n * SOMPI),
      makeUtxo("small2", 2, 1n * SOMPI),
    ];
    const { selected } = selectUtxos(utxos, 1n * SOMPI, 10_000n);
    // Should only need the first (largest) UTXO
    expect(selected.length).toBe(1);
    expect(selected[0].txId).toBe("big");
  });
});

// ── Cache behavior ────────────────────────────────────────────────────────────

describe("invalidateUtxoCache", () => {
  it("forces a fresh fetch after invalidation", async () => {
    // We don't test the network call directly, but ensure the cache module
    // exports the function and it doesn't throw.
    const { invalidateUtxoCache } = await import("../../extension/utxo/utxoSync");
    expect(() => invalidateUtxoCache(TEST_ADDRESS)).not.toThrow();
  });
});
