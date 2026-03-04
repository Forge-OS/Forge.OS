/**
 * Runtime network configuration — persists custom Kaspa API/WS endpoint overrides to
 * localStorage so users can point ForgeOS at a local node, private RPC, or testnet
 * without rebuilding the app.
 *
 * Storage key: "forgeos.network.config.v1"
 */

export const NET_CONFIG_KEY = "forgeos.network.config.v1";

export interface NetworkConfig {
  /** Custom REST API root URL. Empty string = use env default (KAS_API). */
  customApiUrl: string;
  /** Custom WebSocket URL. Empty string = use env default (KAS_WS_URL). */
  customWsUrl: string;
  /** Human label for this custom config, e.g. "Local Node" */
  label: string;
  savedAt: number;
}

const DEFAULT: NetworkConfig = {
  customApiUrl: "",
  customWsUrl: "",
  label: "",
  savedAt: 0,
};

export function loadNetworkConfig(): NetworkConfig {
  try {
    const raw = localStorage.getItem(NET_CONFIG_KEY);
    if (!raw) return { ...DEFAULT };
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveNetworkConfig(patch: Partial<NetworkConfig>): void {
  try {
    const current = loadNetworkConfig();
    localStorage.setItem(
      NET_CONFIG_KEY,
      JSON.stringify({ ...current, ...patch, savedAt: Date.now() })
    );
  } catch {
    // storage full — silent
  }
}

export function clearNetworkConfig(): void {
  try {
    localStorage.removeItem(NET_CONFIG_KEY);
  } catch {}
}

/** Returns the effective REST API root (custom if set, otherwise null = use env). */
export function getCustomApiRoot(): string | null {
  try {
    const raw = localStorage.getItem(NET_CONFIG_KEY);
    if (!raw) return null;
    const config = JSON.parse(raw) as Partial<NetworkConfig>;
    const url = String(config?.customApiUrl || "").trim().replace(/\/+$/, "");
    return url || null;
  } catch {
    return null;
  }
}

/** Returns the effective WebSocket URL (custom if set, otherwise null = use env). */
export function getCustomWsUrl(): string | null {
  try {
    const raw = localStorage.getItem(NET_CONFIG_KEY);
    if (!raw) return null;
    const config = JSON.parse(raw) as Partial<NetworkConfig>;
    const url = String(config?.customWsUrl || "").trim().replace(/\/+$/, "");
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Tests a REST endpoint by hitting /info/virtual-chain-blue-score first,
 * with /info/blockdag as a backward-compatible fallback.
 * Returns { ok, latencyMs, daaScore?, error? }.
 */
export async function testEndpoint(url: string): Promise<{
  ok: boolean;
  latencyMs: number;
  daaScore?: number;
  networkName?: string;
  error?: string;
}> {
  const root = url.trim().replace(/\/+$/, "");
  const t0 = Date.now();
  try {
    let res = await fetch(`${root}/info/virtual-chain-blue-score`, {
      signal: AbortSignal.timeout(8000),
    });
    let usedBlockdagFallback = false;
    if (!res.ok && (res.status === 404 || res.status === 501 || res.status === 405)) {
      res = await fetch(`${root}/info/blockdag`, {
        signal: AbortSignal.timeout(8000),
      });
      usedBlockdagFallback = true;
    }
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    }
    const data = await res.json().catch(() => null);
    const info = usedBlockdagFallback ? (data?.blockdag ?? data?.blockDag ?? data) : data;
    const daaScore = Number(
      info?.blueScore ??
      info?.virtualDaaScore ??
      info?.daaScore,
    ) || 0;
    return {
      ok: true,
      latencyMs,
      daaScore: daaScore > 0 ? daaScore : undefined,
      networkName: String(info?.networkName || info?.network || ""),
    };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - t0, error: String(e?.message || "timeout") };
  }
}
