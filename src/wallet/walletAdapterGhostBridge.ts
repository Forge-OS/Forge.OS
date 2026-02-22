export type GhostProviderInfo = {
  id: string;
  name: string;
};

type GhostBridgeState = {
  provider: GhostProviderInfo;
  nextRequestId: number;
  connected: boolean;
  onEvent: (event: Event) => void;
  onDisconnect: () => void;
  pending: Map<
    number,
    {
      timer: ReturnType<typeof setTimeout>;
      resolve: (value: any) => void;
      reject: (reason?: any) => void;
    }
  >;
};

function isGhostProviderInfo(value: any): value is GhostProviderInfo {
  return Boolean(value && typeof value.id === "string" && typeof value.name === "string");
}

function ensureGhostBrowserContext() {
  if (typeof window === "undefined") {
    throw new Error("Ghost Wallet is only available in browser environments");
  }
  return window;
}

export function createGhostBridgeRuntime(params: {
  scanTimeoutMs: number;
}) {
  const { scanTimeoutMs } = params;
  let ghostBridgeState: GhostBridgeState | null = null;
  let ghostProviderProbeCache: { ts: number; providers: GhostProviderInfo[] } = { ts: 0, providers: [] };

  function clearGhostBridge(reason = "ghost_bridge_reset") {
    if (typeof window !== "undefined" && ghostBridgeState) {
      try {
        window.removeEventListener("kaspa:event", ghostBridgeState.onEvent as any);
        window.removeEventListener("kaspa:disconnect", ghostBridgeState.onDisconnect as any);
        window.dispatchEvent(new CustomEvent("kaspa:disconnect"));
      } catch {
        // Ignore bridge teardown failures.
      }
    }
    if (ghostBridgeState) {
      for (const pending of ghostBridgeState.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(reason));
      }
    }
    ghostBridgeState = null;
  }

  async function probeGhostProviders(timeoutMs = scanTimeoutMs): Promise<GhostProviderInfo[]> {
    const win = ensureGhostBrowserContext();
    const now = Date.now();
    if (now - ghostProviderProbeCache.ts < 1000 && ghostProviderProbeCache.providers.length) {
      return [...ghostProviderProbeCache.providers];
    }

    const providers = new Map<string, GhostProviderInfo>();
    const onProvider = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      if (!isGhostProviderInfo(detail)) return;
      providers.set(detail.id, { id: detail.id, name: detail.name });
    };
    win.addEventListener("kaspa:provider", onProvider as any);
    try {
      win.dispatchEvent(new CustomEvent("kaspa:requestProviders"));
    } catch {
      // If the event bridge is absent this will no-op.
    }

    await new Promise((resolve) => setTimeout(resolve, Math.max(50, timeoutMs)));
    win.removeEventListener("kaspa:provider", onProvider as any);

    const list = [...providers.values()];
    ghostProviderProbeCache = { ts: Date.now(), providers: list };
    return list;
  }

  function getActiveGhostBridge() {
    return ghostBridgeState;
  }

  async function ensureGhostBridgeConnected(): Promise<GhostBridgeState> {
    const win = ensureGhostBrowserContext();
    const existing = getActiveGhostBridge();
    if (existing?.connected) return existing;

    const providers = await probeGhostProviders();
    const provider = providers.find((p) => /ghost/i.test(String(p.name || ""))) || providers[0];
    if (!provider) {
      throw new Error("Ghost Wallet provider bridge not detected");
    }

    if (ghostBridgeState) clearGhostBridge("ghost_bridge_reconnect");

    const state: GhostBridgeState = {
      provider,
      nextRequestId: 1,
      connected: true,
      pending: new Map(),
      onEvent(event: Event) {
        const detail = (event as CustomEvent<any>).detail;
        if (!detail || typeof detail.id !== "number") return;
        const pending = state.pending.get(detail.id);
        if (!pending) return;
        state.pending.delete(detail.id);
        clearTimeout(pending.timer);
        if (detail.error) {
          pending.reject(new Error(String(detail.error)));
          return;
        }
        if (detail.data === false) {
          pending.reject(new Error("Ghost Wallet request was rejected"));
          return;
        }
        pending.resolve(detail.data);
      },
      onDisconnect() {
        clearGhostBridge("ghost_bridge_disconnected");
      },
    };

    win.addEventListener("kaspa:event", state.onEvent as any);
    win.addEventListener("kaspa:disconnect", state.onDisconnect as any);
    try {
      win.dispatchEvent(new CustomEvent("kaspa:connect", { detail: provider.id }));
    } catch (e) {
      win.removeEventListener("kaspa:event", state.onEvent as any);
      win.removeEventListener("kaspa:disconnect", state.onDisconnect as any);
      throw e;
    }
    ghostBridgeState = state;
    return state;
  }

  async function ghostInvoke(method: "account" | "transact", params: any[], timeoutMs: number) {
    const win = ensureGhostBrowserContext();
    const state = await ensureGhostBridgeConnected();
    const id = state.nextRequestId++;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error(`ghost_${String(method)}_timeout_${timeoutMs}ms`));
      }, timeoutMs);
      state.pending.set(id, { timer, resolve, reject });
      try {
        win.dispatchEvent(
          new CustomEvent("kaspa:invoke", {
            detail: {
              id,
              method,
              params,
            },
          })
        );
      } catch (e) {
        clearTimeout(timer);
        state.pending.delete(id);
        reject(e);
      }
    });
  }

  return {
    probeGhostProviders,
    ghostInvoke,
  };
}

