import { describe, expect, it } from "vitest";

import {
  buildAgentViewModels,
  filterAgentViews,
  networkBadgeLabel,
  normalizeNetworkId,
} from "../../extension/tabs/agentsView";

describe("agentsView network normalization", () => {
  it("normalizes mainnet and testnet aliases", () => {
    expect(normalizeNetworkId("mainnet")).toBe("mainnet");
    expect(normalizeNetworkId("tn10")).toBe("testnet-10");
    expect(normalizeNetworkId("testnet-11")).toBe("testnet-11");
    expect(normalizeNetworkId("testnet")).toBe("testnet");
  });

  it("provides readable network badges", () => {
    expect(networkBadgeLabel("mainnet")).toBe("MAINNET");
    expect(networkBadgeLabel("testnet-10")).toBe("TN10");
    expect(networkBadgeLabel("testnet-11")).toBe("TN11");
    expect(networkBadgeLabel("unknown")).toBe("UNKNOWN");
  });
});

describe("agentsView model mapping", () => {
  it("maps wallet network + bot mode correctly", () => {
    const rows = buildAgentViewModels(
      [
        {
          agentId: "a1",
          name: "Bot One",
          strategyLabel: "DCA",
          execMode: "autonomous",
          status: "active",
          wallet: { network: "testnet-11", address: "kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" },
          pnlUsd: "12.5",
          updatedAt: Date.now(),
        },
      ],
      "mainnet",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].network).toBe("testnet-11");
    expect(rows[0].isBot).toBe(true);
    expect(rows[0].isActive).toBe(true);
    expect(rows[0].pnlUsd).toBe(12.5);
    expect(rows[0].walletAddress).toMatch(/^kaspatest:/);
  });

  it("falls back to current network when legacy agent has no network field", () => {
    const rows = buildAgentViewModels(
      [{ agentId: "a2", name: "Legacy", execMode: "manual" }],
      "testnet-10",
    );
    expect(rows[0].network).toBe("testnet-10");
  });
});

describe("agentsView filters", () => {
  const agents = buildAgentViewModels(
    [
      { agentId: "m1", name: "Main Bot", execMode: "autonomous", wallet: { network: "mainnet" }, updatedAt: Date.now() },
      { agentId: "t10", name: "TN10 Bot", execMode: "autonomous", wallet: { network: "testnet-10" }, updatedAt: Date.now() },
      { agentId: "t11", name: "TN11 Manual", execMode: "manual", wallet: { network: "testnet-11" }, updatedAt: Date.now() },
      { agentId: "tg", name: "Generic Testnet", execMode: "manual", wallet: { address: "kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" }, updatedAt: Date.now() },
    ],
    "mainnet",
  );

  it("filters by current TN11 network", () => {
    const scoped = filterAgentViews(agents, "current", "all", "testnet-11");
    expect(scoped.map((a) => a.id)).toEqual(expect.arrayContaining(["t11", "tg"]));
    expect(scoped.find((a) => a.id === "m1")).toBeUndefined();
  });

  it("filters by explicit TN10 scope", () => {
    const scoped = filterAgentViews(agents, "testnet-10", "all", "mainnet");
    expect(scoped.map((a) => a.id)).toEqual(expect.arrayContaining(["t10", "tg"]));
    expect(scoped.find((a) => a.id === "t11")).toBeUndefined();
  });

  it("filters bot/manual mode", () => {
    const bots = filterAgentViews(agents, "all", "bots", "mainnet");
    const manual = filterAgentViews(agents, "all", "manual", "mainnet");
    expect(bots.every((a) => a.isBot)).toBe(true);
    expect(manual.some((a) => a.isBot)).toBe(false);
  });
});
