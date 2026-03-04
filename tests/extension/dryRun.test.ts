import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingTx } from "../../extension/tx/types";

const mockSyncUtxos = vi.fn();
const mockEstimateFee = vi.fn();

vi.mock("../../extension/utxo/utxoSync", () => ({
  syncUtxos: (...args: unknown[]) => mockSyncUtxos(...args),
}));

vi.mock("../../extension/network/kaspaClient", () => ({
  estimateFee: (...args: unknown[]) => mockEstimateFee(...args),
}));

const TEST_FROM = "kaspatest:qpqz2vxj23kvh0m73ta2jjn2u4cv4tlufqns2eap8mxyyt0rvrxy6ejkful67";
const TEST_TO = "kaspatest:qpqz2vxj23kvh0m73ta2jjn2u4cv4tlufqns2eap8mxyyt0rvrxy6ejkful67";
const MAINNET_TO = "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85";

function baseTx(overrides: Partial<PendingTx> = {}): PendingTx {
  return {
    id: "tx-test",
    state: "BUILDING",
    fromAddress: TEST_FROM,
    network: "testnet-11",
    inputs: [{
      txId: "inputtx",
      outputIndex: 0,
      address: TEST_FROM,
      amount: 100_000_000n,
      scriptPublicKey: "00",
      scriptVersion: 0,
      blockDaaScore: 1n,
      isCoinbase: false,
    }],
    outputs: [{ address: TEST_TO, amount: 50_000_000n }],
    changeOutput: { address: TEST_FROM, amount: 49_999_000n },
    fee: 1_000n,
    builtAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  mockSyncUtxos.mockReset();
  mockEstimateFee.mockReset();
  mockEstimateFee.mockResolvedValue(1_000n);
  mockSyncUtxos.mockResolvedValue({
    address: TEST_FROM,
    utxos: [{
      txId: "inputtx",
      outputIndex: 0,
      address: TEST_FROM,
      amount: 100_000_000n,
      scriptPublicKey: "00",
      scriptVersion: 0,
      blockDaaScore: 1n,
      isCoinbase: false,
    }],
    confirmedBalance: 100_000_000n,
    pendingOutbound: 0n,
    lastSyncAt: Date.now(),
  });
});

describe("dryRunValidate network checks", () => {
  it("passes a valid testnet transaction", async () => {
    const { dryRunValidate } = await import("../../extension/tx/dryRun");
    const result = await dryRunValidate(baseTx());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when output address prefix does not match tx network", async () => {
    const { dryRunValidate } = await import("../../extension/tx/dryRun");
    const result = await dryRunValidate(baseTx({
      outputs: [{ address: MAINNET_TO, amount: 50_000_000n }],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("NETWORK_MISMATCH"))).toBe(true);
  });

  it("fails when change address prefix does not match tx network", async () => {
    const { dryRunValidate } = await import("../../extension/tx/dryRun");
    const result = await dryRunValidate(baseTx({
      changeOutput: { address: MAINNET_TO, amount: 49_999_000n },
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("change address"))).toBe(true);
  });

  it("fails with DUST_OUTPUT when any output is below 20,000 sompi", async () => {
    const { dryRunValidate } = await import("../../extension/tx/dryRun");
    const result = await dryRunValidate(baseTx({
      outputs: [{ address: TEST_TO, amount: 19_999n }],
      changeOutput: { address: TEST_FROM, amount: 99_979_001n },
      fee: 1_000n,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("DUST_OUTPUT"))).toBe(true);
  });

  it("fails with DUST_CHANGE when change is below 20,000 sompi", async () => {
    const { dryRunValidate } = await import("../../extension/tx/dryRun");
    const result = await dryRunValidate(baseTx({
      outputs: [{ address: TEST_TO, amount: 99_980_000n }],
      changeOutput: { address: TEST_FROM, amount: 19_000n },
      fee: 1_000n,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("DUST_CHANGE"))).toBe(true);
  });
});
