import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchBatchUtxos = vi.fn();

vi.mock("../../extension/network/kaspaClient", () => ({
  fetchBatchUtxos: (...args: unknown[]) => mockFetchBatchUtxos(...args),
}));

const A = "kaspa:qaaaa111111111111111111111111111111111111111111111111111111";
const B = "kaspa:qbbbb222222222222222222222222222222222222222222222222222222";

function rawUtxo(address: string, txId: string, index: number, amount: string) {
  return {
    address,
    outpoint: { transactionId: txId, index },
    utxoEntry: {
      amount,
      scriptPublicKey: {
        version: 0,
        scriptPublicKey: "20" + "aa".repeat(32) + "ac",
      },
      blockDaaScore: "1",
      isCoinbase: false,
    },
  };
}

describe("utxoSync batch", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetchBatchUtxos.mockReset();
  });

  it("syncUtxosBatch fetches once and groups sets by address", async () => {
    mockFetchBatchUtxos.mockResolvedValue([
      rawUtxo(A, "a".repeat(64), 0, "1000"),
      rawUtxo(B, "b".repeat(64), 1, "2500"),
      rawUtxo(A, "c".repeat(64), 2, "3000"),
    ]);

    const { syncUtxosBatch } = await import("../../extension/utxo/utxoSync");
    const result = await syncUtxosBatch([A, B], "mainnet");

    expect(mockFetchBatchUtxos).toHaveBeenCalledTimes(1);
    expect(mockFetchBatchUtxos).toHaveBeenCalledWith([A.toLowerCase(), B.toLowerCase()], "mainnet");

    const setA = result[A.toLowerCase()];
    const setB = result[B.toLowerCase()];
    expect(setA).toBeDefined();
    expect(setB).toBeDefined();
    expect(setA.utxos).toHaveLength(2);
    expect(setB.utxos).toHaveLength(1);
    expect(setA.confirmedBalance).toBe(4000n);
    expect(setB.confirmedBalance).toBe(2500n);
  });

  it("getOrSyncUtxosBatch fetches only stale/missing addresses", async () => {
    mockFetchBatchUtxos.mockResolvedValue([
      rawUtxo(A, "d".repeat(64), 0, "5000"),
    ]);

    const { syncUtxosBatch, getOrSyncUtxosBatch } = await import("../../extension/utxo/utxoSync");

    await syncUtxosBatch([B], "mainnet");
    mockFetchBatchUtxos.mockClear();

    const result = await getOrSyncUtxosBatch([A, B], "mainnet");
    expect(mockFetchBatchUtxos).toHaveBeenCalledTimes(1);
    expect(mockFetchBatchUtxos).toHaveBeenCalledWith([A.toLowerCase()], "mainnet");
    expect(result[A.toLowerCase()].confirmedBalance).toBe(5000n);
    expect(result[B.toLowerCase()]).toBeDefined();
  });

  it("keeps per-network cache isolation for the same address", async () => {
    mockFetchBatchUtxos.mockImplementation(async (addresses: string[], network: string) => {
      const addr = addresses[0];
      if (network === "mainnet") {
        return [rawUtxo(addr, "e".repeat(64), 0, "1111")];
      }
      return [rawUtxo(addr, "f".repeat(64), 0, "2222")];
    });

    const { syncUtxos, getOrSyncUtxos } = await import("../../extension/utxo/utxoSync");
    await syncUtxos(A, "mainnet");
    await syncUtxos(A, "testnet-11");

    mockFetchBatchUtxos.mockClear();
    const mainnetSet = await getOrSyncUtxos(A, "mainnet");
    const testnetSet = await getOrSyncUtxos(A, "testnet-11");

    expect(mockFetchBatchUtxos).toHaveBeenCalledTimes(0);
    expect(mainnetSet.confirmedBalance).toBe(1111n);
    expect(testnetSet.confirmedBalance).toBe(2222n);
  });
});
