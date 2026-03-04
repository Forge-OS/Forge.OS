import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PendingTx } from "../../extension/tx/types";
import { probeKaspaReceipt, waitForKaspaConfirmation } from "../../extension/tx/receiptReconciler";
import { fetchTransactionAcceptance, getKaspaBackendSelection } from "../../extension/network/kaspaClient";

vi.mock("../../extension/network/kaspaClient", () => ({
  fetchTransactionAcceptance: vi.fn(),
  getKaspaBackendSelection: vi.fn(),
}));

function makePendingTx(): PendingTx {
  return {
    id: "tx_1",
    state: "CONFIRMING",
    fromAddress: "kaspa:qsender",
    network: "mainnet",
    inputs: [],
    outputs: [{ address: "kaspa:qreceiver", amount: 1000n }],
    changeOutput: null,
    fee: 1000n,
    builtAt: Date.now(),
    txId: "kaspa_txid",
  };
}

describe("receipt reconciler", () => {
  beforeEach(() => {
    vi.mocked(getKaspaBackendSelection).mockResolvedValue({
      network: "mainnet",
      source: "local",
      reason: "local_node_enabled_and_healthy",
      activeEndpoint: "http://127.0.0.1:16110",
      pool: ["http://127.0.0.1:16110", "https://api.kaspa.org"],
    });
  });

  it("probes receipt and returns backend snapshot", async () => {
    vi.mocked(fetchTransactionAcceptance).mockResolvedValue([
      {
        transactionId: "kaspa_txid",
        isAccepted: true,
        acceptingBlockHash: "blockhash",
      },
    ]);

    const probe = await probeKaspaReceipt("kaspa_txid", "mainnet");
    expect(probe.confirmed).toBe(true);
    expect(probe.acceptingBlockHash).toBe("blockhash");
    expect(probe.backend.source).toBe("local");
    expect(probe.backend.activeEndpoint).toBe("http://127.0.0.1:16110");
  });

  it("waits for confirmation and updates pending tx to CONFIRMED", async () => {
    vi.mocked(fetchTransactionAcceptance).mockResolvedValue([
      {
        transactionId: "kaspa_txid",
        isAccepted: true,
        acceptingBlockHash: "blockhash",
      },
    ]);

    const tx = makePendingTx();
    const result = await waitForKaspaConfirmation(tx, {
      timeoutMs: 50,
      pollIntervalMs: 1,
    });

    expect(result.state).toBe("CONFIRMED");
    expect(result.confirmations).toBe(1);
    expect(result.receiptSourceBackend).toBe("local");
    expect(result.receiptSourceEndpoint).toBe("http://127.0.0.1:16110");
  });

  it("times out to FAILED when receipt never confirms", async () => {
    vi.mocked(fetchTransactionAcceptance).mockResolvedValue([
      {
        transactionId: "kaspa_txid",
        isAccepted: false,
        acceptingBlockHash: null,
      },
    ]);

    const tx = makePendingTx();
    const result = await waitForKaspaConfirmation(tx, {
      timeoutMs: 5,
      pollIntervalMs: 1,
    });

    expect(result.state).toBe("FAILED");
    expect(String(result.error || "")).toContain("CONFIRM_TIMEOUT");
  });
});
