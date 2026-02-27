import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...(import.meta as any).env };
const originalFetch = (globalThis as any).fetch;

function okJson(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

describe("token metadata resolver cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    (import.meta as any).env = { ...originalEnv };
    if (originalFetch) (globalThis as any).fetch = originalFetch;
    else delete (globalThis as any).fetch;
  });

  it("reuses cached token metadata within TTL", async () => {
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_ENDPOINTS", "https://metadata.example");
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_CACHE_TTL_MS", "2000");
    (globalThis as any).fetch = vi.fn().mockResolvedValue(okJson({
      token: {
        address: "krc20:abc123",
        symbol: "ABC",
        name: "Alpha Beta Coin",
        decimals: 8,
      },
    }));

    const { resolveTokenFromAddress, __clearTokenMetadataCacheForTests } = await import("../../extension/swap/tokenResolver");
    __clearTokenMetadataCacheForTests();

    const first = await resolveTokenFromAddress("krc20:abc123", "krc20", "mainnet");
    const second = await resolveTokenFromAddress("krc20:abc123", "krc20", "mainnet");

    expect(first.symbol).toBe("ABC");
    expect(second.symbol).toBe("ABC");
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes metadata after TTL expiry", async () => {
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_ENDPOINTS", "https://metadata.example");
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_CACHE_TTL_MS", "1000");

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({
        token: {
          address: "krc721:nft1",
          symbol: "OLD",
          name: "Old Collection",
          decimals: 0,
        },
      }))
      .mockResolvedValueOnce(okJson({
        token: {
          address: "krc721:nft1",
          symbol: "NEW",
          name: "New Collection",
          decimals: 0,
        },
      }));
    (globalThis as any).fetch = fetchMock;

    const { resolveTokenFromAddress, __clearTokenMetadataCacheForTests } = await import("../../extension/swap/tokenResolver");
    __clearTokenMetadataCacheForTests();

    const first = await resolveTokenFromAddress("krc721:nft1", "krc721", "testnet-12");
    const cached = await resolveTokenFromAddress("krc721:nft1", "krc721", "testnet-12");
    vi.setSystemTime(Date.now() + 1001);
    const refreshed = await resolveTokenFromAddress("krc721:nft1", "krc721", "testnet-12");

    expect(first.symbol).toBe("OLD");
    expect(cached.symbol).toBe("OLD");
    expect(refreshed.symbol).toBe("NEW");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
