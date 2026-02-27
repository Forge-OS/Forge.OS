import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...(import.meta as any).env };
const originalFetch = (globalThis as any).fetch;

function okJson(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

function notOk(status: number) {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as Response;
}

function hostOf(input: unknown): string {
  return new URL(String(input)).host;
}

function addressFromRequest(input: unknown): string {
  const path = new URL(String(input)).pathname;
  const pieces = path.split("/");
  const encodedAddress = pieces[pieces.length - 1] || "";
  return decodeURIComponent(encodedAddress);
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

  it("uses true LRU eviction when cache max entries is reached", async () => {
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_ENDPOINTS", "https://metadata.example");
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_CACHE_TTL_MS", "120000");
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_CACHE_MAX_ENTRIES", "2");

    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const addr = addressFromRequest(input);
      return okJson({
        token: {
          address: addr,
          symbol: addr.slice(-2).toUpperCase(),
          name: `Token ${addr.slice(-2).toUpperCase()}`,
          decimals: 8,
        },
      });
    });
    (globalThis as any).fetch = fetchMock;

    const { resolveTokenFromAddress, __clearTokenMetadataCacheForTests } = await import("../../extension/swap/tokenResolver");
    __clearTokenMetadataCacheForTests();

    const a1 = "krc20:addr-a1";
    const a2 = "krc20:addr-a2";
    const a3 = "krc20:addr-a3";

    await resolveTokenFromAddress(a1, "krc20", "mainnet"); // fetch
    await resolveTokenFromAddress(a2, "krc20", "mainnet"); // fetch
    await resolveTokenFromAddress(a1, "krc20", "mainnet"); // cache hit + LRU touch
    await resolveTokenFromAddress(a3, "krc20", "mainnet"); // fetch + evict a2
    await resolveTokenFromAddress(a1, "krc20", "mainnet"); // cache hit
    await resolveTokenFromAddress(a2, "krc20", "mainnet"); // fetch (evicted)

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("backs off failing endpoints and routes follow-up lookups to healthier endpoints", async () => {
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_ENDPOINTS", "https://a.example,https://b.example");
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_CACHE_TTL_MS", "0");
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_ENDPOINT_BACKOFF_BASE_MS", "60000");
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_ENDPOINT_BACKOFF_MAX_MS", "60000");

    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const host = hostOf(input);
      if (host === "a.example") return notOk(503);
      const addr = addressFromRequest(input);
      return okJson({
        token: {
          address: addr,
          symbol: "BOK",
          name: "Healthy Endpoint Token",
          decimals: 8,
        },
      });
    });
    (globalThis as any).fetch = fetchMock;

    const {
      resolveTokenFromAddress,
      __clearTokenMetadataCacheForTests,
      __getTokenMetadataEndpointHealthForTests,
    } = await import("../../extension/swap/tokenResolver");
    __clearTokenMetadataCacheForTests();

    const addr1 = "krc20:score-a1";
    const addr2 = "krc20:score-a2";

    await resolveTokenFromAddress(addr1, "krc20", "mainnet");
    await resolveTokenFromAddress(addr2, "krc20", "mainnet");

    const secondLookupHosts = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => addressFromRequest(url) === addr2)
      .map((url) => hostOf(url));

    expect(secondLookupHosts.length).toBeGreaterThan(0);
    expect(secondLookupHosts.every((host) => host === "b.example")).toBe(true);

    const health = __getTokenMetadataEndpointHealthForTests();
    expect(health["https://a.example"].consecutiveFailures).toBeGreaterThan(0);
    expect(health["https://a.example"].backoffUntil).toBeGreaterThan(Date.now());
  });

  it("applies score decay toward baseline over time", async () => {
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_ENDPOINTS", "https://a.example,https://b.example");
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_CACHE_TTL_MS", "0");
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_ENDPOINT_BACKOFF_BASE_MS", "10");
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_ENDPOINT_BACKOFF_MAX_MS", "10");
    vi.stubEnv("VITE_SWAP_KRC_TOKEN_METADATA_ENDPOINT_DECAY_TAU_MS", "1000");

    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const host = hostOf(input);
      if (host === "a.example") return notOk(503);
      const addr = addressFromRequest(input);
      return okJson({
        token: {
          address: addr,
          symbol: "BOK",
          name: "Healthy Endpoint Token",
          decimals: 8,
        },
      });
    });
    (globalThis as any).fetch = fetchMock;

    const {
      resolveTokenFromAddress,
      __clearTokenMetadataCacheForTests,
      __getTokenMetadataEndpointHealthForTests,
    } = await import("../../extension/swap/tokenResolver");
    __clearTokenMetadataCacheForTests();

    await resolveTokenFromAddress("krc20:decay-1", "krc20", "mainnet");
    const before = __getTokenMetadataEndpointHealthForTests()["https://a.example"].score;

    vi.setSystemTime(Date.now() + 5000);
    await resolveTokenFromAddress("krc20:decay-2", "krc20", "mainnet");
    const after = __getTokenMetadataEndpointHealthForTests()["https://a.example"].score;

    expect(before).toBeLessThan(100);
    expect(after).toBeGreaterThan(before);
  });
});
