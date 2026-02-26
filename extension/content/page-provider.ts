// Forge-OS Page Provider — content script running in MAIN world on forgeos.xyz
//
// Injects window.forgeos so page JavaScript can call connect() / signMessage().
// Communicates with site-bridge.ts (isolated world) via window.postMessage.
//
// SECURITY: phrase is read from localStorage only within this script's scope
// and is used only for local signing — it is never sent over postMessage or
// to any external service.

const WALLET_KEY = "forgeos.managed.wallet.v1";

// Sentinel field prevents collision with other postMessage traffic.
const S = "__forgeos__" as const;

type BridgeMsg = { [key: string]: unknown; __forgeos__: true; type: string; requestId?: string };
type Pending   = { resolve(v: any): void; reject(e: any): void; timer: ReturnType<typeof setTimeout> };

const pending = new Map<string, Pending>();

// ── Response listener ────────────────────────────────────────────────────────

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const msg = ev.data as BridgeMsg;
  if (!msg?.[S]) return;

  const req = pending.get(msg.requestId ?? "");
  if (!req) return;

  clearTimeout(req.timer);
  pending.delete(msg.requestId!);

  if (msg.error) {
    req.reject(new Error(String(msg.error)));
  } else {
    req.resolve(msg.result);
  }
});

// ── Request helper ───────────────────────────────────────────────────────────

function bridgeRequest(type: string, extra?: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("Forge-OS: request timed out"));
    }, 120_000);
    pending.set(requestId, { resolve, reject, timer });
    window.postMessage({ [S]: true, type, requestId, ...extra }, "*");
  });
}

// ── kaspa-wasm signing ───────────────────────────────────────────────────────

async function signWithKaspa(phrase: string, message: string): Promise<string> {
  // kaspa-wasm is bundled with the extension — safe to import dynamically.
  const kaspa = await import("kaspa-wasm");
  const initFn = (kaspa as any).default ?? (kaspa as any).init;
  if (typeof initFn === "function") { try { await initFn(); } catch {} }

  const { Mnemonic, XPrv, XPrivateKey } = kaspa;
  const mnemonic  = new Mnemonic(phrase);
  const seed      = mnemonic.toSeed();
  const masterXPrv = new XPrv(seed);
  const xprvStr   = masterXPrv.intoString("kprv");
  const xprvKey   = new XPrivateKey(xprvStr, false, BigInt(0));
  const privKey   = xprvKey.receiveKey(0); // m/44'/111'/0'/0/0

  const bytes = new TextEncoder().encode(message);
  const sig   = privKey.sign(bytes);
  return Array.from(sig as Uint8Array, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Provider factory ─────────────────────────────────────────────────────────

function createProvider() {
  return {
    isForgeOS: true as const,
    version: "1.0.0",

    /** Connect: fast-path from localStorage managed wallet; fallback via extension popup. */
    async connect(): Promise<{ address: string; network: string } | null> {
      try {
        const raw = localStorage.getItem(WALLET_KEY);
        if (raw) {
          const w = JSON.parse(raw);
          if (w?.address && w?.network) return { address: w.address, network: w.network };
        }
      } catch {}
      // Extension vault path — opens popup for password entry / approval
      return bridgeRequest("FORGEOS_CONNECT");
    },

    /** Sign a message. Uses local key derivation for managed wallets. */
    async signMessage(message: string): Promise<string> {
      try {
        const raw = localStorage.getItem(WALLET_KEY);
        if (raw) {
          const w = JSON.parse(raw);
          if (w?.phrase) return signWithKaspa(w.phrase, message);
        }
      } catch {}
      // Extension vault signing path
      return bridgeRequest("FORGEOS_SIGN", { message });
    },

    /** Request the extension popup to open (MetaMask-style). */
    openExtension(): void {
      window.postMessage({ [S]: true, type: "FORGEOS_OPEN_POPUP" }, "*");
    },

    disconnect(): void { /* managed wallet — nothing to tear down */ },
  };
}

// ── Inject ───────────────────────────────────────────────────────────────────

if (!(window as any).forgeos?.isForgeOS) {
  (window as any).forgeos = createProvider();
  // Notify any listener that the provider is ready.
  window.dispatchEvent(new CustomEvent("forgeos#initialized"));
}
