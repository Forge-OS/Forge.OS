import { beforeEach, describe, expect, it, vi } from "vitest";

function createChromeStorageMock() {
  const data = new Map<string, any>();
  const local = {
    get: (keys: any, cb: (result: Record<string, any>) => void) => {
      const out: Record<string, any> = {};
      if (typeof keys === "string") {
        out[keys] = data.get(keys);
      } else if (Array.isArray(keys)) {
        for (const key of keys) out[key] = data.get(key);
      } else if (keys && typeof keys === "object") {
        for (const key of Object.keys(keys)) out[key] = data.get(key) ?? keys[key];
      } else {
        for (const [key, value] of data.entries()) out[key] = value;
      }
      cb(out);
    },
    set: (payload: Record<string, any>, cb?: () => void) => {
      for (const [key, value] of Object.entries(payload)) data.set(key, value);
      cb?.();
    },
    remove: (keys: string | string[], cb?: () => void) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) data.delete(key);
      cb?.();
    },
  };
  return { storage: { local } };
}

describe("local node storage config", () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as any).chrome = createChromeStorageMock();
  });

  it("persists local node enabled + profile + data dir", async () => {
    const storage = await import("../../extension/shared/storage");

    await storage.setLocalNodeEnabled(true);
    await storage.setLocalNodeNetworkProfile("tn12");
    await storage.setLocalNodeDataDir("~/ForgeOS/kaspad");

    expect(await storage.getLocalNodeEnabled()).toBe(true);
    expect(await storage.getLocalNodeNetworkProfile()).toBe("testnet-12");
    expect(await storage.getLocalNodeDataDir()).toBe("~/ForgeOS/kaspad");
  });

  it("supports local rpc preset and clearing data dir", async () => {
    const storage = await import("../../extension/shared/storage");

    await storage.setKaspaRpcProviderPreset("mainnet", "local");
    expect(await storage.getKaspaRpcProviderPreset("mainnet")).toBe("local");

    await storage.setLocalNodeDataDir("   ");
    expect(await storage.getLocalNodeDataDir()).toBeNull();
  });

  it("persists fee estimate tier per network", async () => {
    const storage = await import("../../extension/shared/storage");

    await storage.setKaspaFeeEstimateTier("mainnet", "priority");
    await storage.setKaspaFeeEstimateTier("testnet-11", "low");

    expect(await storage.getKaspaFeeEstimateTier("mainnet")).toBe("priority");
    expect(await storage.getKaspaFeeEstimateTier("testnet-11")).toBe("low");
    expect(await storage.getKaspaFeeEstimateTier("testnet-10")).toBe("normal");
  });

  it("normalizes canonical wallet account list entries", async () => {
    const storage = await import("../../extension/shared/storage");

    await storage.setWalletAccountList([
      {
        accountId: "acc-main",
        address: " KASPA:QMAIN11111111111111111111111111111111111111111111111111111 ",
        network: "main",
        updatedAt: 100,
      },
      {
        accountId: "acc-main-dup",
        address: "kaspa:qmain11111111111111111111111111111111111111111111111111111",
        network: "mainnet",
        updatedAt: 200,
      },
      {
        accountId: "acc-tn11",
        address: "kaspatest:qtn111111111111111111111111111111111111111111111111111111",
        network: "tn11",
        updatedAt: 300,
      },
    ] as any);

    const list = await storage.getWalletAccountList();
    expect(list).toHaveLength(2);
    expect(list[0].network).toBe("testnet-11");
    expect(list[1].network).toBe("mainnet");
    expect(list[1].address).toMatch(/^kaspa:/);
  });
});
