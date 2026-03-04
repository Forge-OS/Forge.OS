import { describe, expect, it } from "vitest";

import type { WalletAccountRef } from "../../extension/shared/storage";
import { buildTrackedAddressPlan } from "../../extension/tabs/accountSourceAdapter";
import type { AgentViewModel } from "../../extension/tabs/agentsView";

const BASE_AGENT: Omit<AgentViewModel, "id" | "name" | "network" | "walletAddress"> = {
  strategy: "DCA",
  risk: "medium",
  capitalLimitKas: "100",
  execMode: "manual",
  status: "active",
  isBot: false,
  isActive: true,
  pnlUsd: 0,
  updatedAt: Date.now(),
  raw: {},
};

function makeAgent(
  id: string,
  network: AgentViewModel["network"],
  walletAddress: string | null,
): AgentViewModel {
  return {
    ...BASE_AGENT,
    id,
    name: id,
    network,
    walletAddress,
  };
}

describe("accountSourceAdapter", () => {
  it("falls back to agent-derived addresses when canonical accounts are missing", () => {
    const plan = buildTrackedAddressPlan(
      [
        makeAgent("a-main", "mainnet", "kaspa:qmain11111111111111111111111111111111111111111111111111111"),
        makeAgent("a-tn11", "testnet-11", "kaspatest:qtn111111111111111111111111111111111111111111111111111111"),
      ],
      "mainnet",
      [],
    );

    expect(plan.sourceMode).toBe("agent_fallback");
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups[0].rpcNetwork).toBe("mainnet");
    expect(plan.groups[1].rpcNetwork).toBe("testnet-11");
  });

  it("prefers canonical accounts and maps matching agent ids", () => {
    const agents = [
      makeAgent("a-main", "mainnet", "kaspa:qmain11111111111111111111111111111111111111111111111111111"),
      makeAgent("a-tn11", "testnet-11", "kaspatest:qtn111111111111111111111111111111111111111111111111111111"),
    ];
    const canonical: WalletAccountRef[] = [
      {
        accountId: "acc-main",
        address: "kaspa:qmain11111111111111111111111111111111111111111111111111111",
        network: "mainnet",
        updatedAt: Date.now(),
      },
    ];

    const plan = buildTrackedAddressPlan(agents, "testnet-11", canonical);
    expect(plan.sourceMode).toBe("canonical");
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].rpcNetwork).toBe("mainnet");
    expect(plan.groups[0].addressToAgentIds["kaspa:qmain11111111111111111111111111111111111111111111111111111"]).toEqual(["a-main"]);
  });

  it("maps generic canonical testnet to active specific testnet", () => {
    const canonical: WalletAccountRef[] = [
      {
        accountId: "acc-test",
        address: "kaspatest:qtn111111111111111111111111111111111111111111111111111111",
        network: "testnet",
        updatedAt: Date.now(),
      },
    ];

    const plan = buildTrackedAddressPlan([], "testnet-10", canonical);
    expect(plan.sourceMode).toBe("canonical");
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].rpcNetwork).toBe("testnet-10");
  });
});

