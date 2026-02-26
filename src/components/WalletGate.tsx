import { useMemo, useState } from "react";
import { ALLOWED_ADDRESS_PREFIXES, DEFAULT_NETWORK, DEMO_ADDRESS, NETWORK_LABEL } from "../constants";
import { C, mono } from "../tokens";
import { isKaspaAddress, normalizeKaspaAddress, shortAddr } from "../helpers";
import { WalletAdapter } from "../wallet/WalletAdapter";
import {
  FORGEOS_CONNECTABLE_WALLETS,
  walletClassLabel,
} from "../wallet/walletCapabilityRegistry";
import { formatForgeError } from "../runtime/errorTaxonomy";
import { Badge, Btn, Card, Divider, ExtLink } from "./ui";
import { ForgeAtmosphere } from "./chrome/ForgeAtmosphere";
import { WalletCreator } from "./WalletCreator";

// Protocol capability blocks
const PROTOCOL_STACK = [
  {
    status: "LIVE",
    statusColor: "#39DDB6",
    title: "KAS Accumulation",
    desc: "AI agents accumulate KAS now — Kelly-sized entries, regime-aware execution on the BlockDAG.",
    icon: "◆",
    iconColor: "#39DDB6",
  },
  {
    status: "LIVE",
    statusColor: "#39DDB6",
    title: "DAG-Speed Settlement",
    desc: "Transactions confirm at Kaspa BlockDAG speed — parallel block lattice, sub-second finality.",
    icon: "⚡",
    iconColor: "#39DDB6",
  },
  {
    status: "LIVE",
    statusColor: "#39DDB6",
    title: "Stable PnL Tracking",
    desc: "All agent P&L tracked in USD equivalent. KAS/USDC rate computed on every cycle.",
    icon: "$",
    iconColor: "#39DDB6",
  },
  {
    status: "READY",
    statusColor: "#8F7BFF",
    title: "KAS / USDC Profit Trading",
    desc: "When Kaspa stablecoins launch, agents flip from accumulation to active buy/sell — profiting on KAS price swings.",
    icon: "⇄",
    iconColor: "#8F7BFF",
  },
  {
    status: "READY",
    statusColor: "#F7B267",
    title: "KRC-20 Token Support",
    desc: "Engine ready for KRC-20 tokens on Kaspa. Buy the dip, sell the strength — across any KRC-20/KAS pair.",
    icon: "⬡",
    iconColor: "#F7B267",
  },
  {
    status: "READY",
    statusColor: "#F7B267",
    title: "Kaspa 0x Swaps",
    desc: "Built for Kaspa's 0x-style DEX layer. Agents route capital across pools — KAS, kUSD, kBTC and beyond.",
    icon: "⊕",
    iconColor: "#F7B267",
  },
];

export function WalletGate({ onConnect, onSignInClick }: { onConnect: (session: any) => void; onSignInClick?: () => void }) {
  const [showWalletOptions, setShowWalletOptions] = useState(false);
  const [err, setErr] = useState(null as any);
  const [info, setInfo] = useState("");
  const [showCreator, setShowCreator] = useState(false);
  const [kaspiumAddress, setKaspiumAddress] = useState("");
  const [savedKaspiumAddress, setSavedKaspiumAddress] = useState("");
  const [lastProvider, setLastProvider] = useState("");
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const detected = WalletAdapter.detect();
  const kaspiumStorageKey = useMemo(() => `forgeos.kaspium.address.${DEFAULT_NETWORK}`, []);
  const providerStorageKey = useMemo(() => `forgeos.wallet.lastProvider.${DEFAULT_NETWORK}`, []);
  const activeKaspiumAddress = kaspiumAddress.trim();
  const kaspiumAddressValid = isKaspaAddress(activeKaspiumAddress, ALLOWED_ADDRESS_PREFIXES);
  const busy = Boolean(busyProvider);

  const persistKaspiumAddress = (value: string) => {
    const normalized = value.trim();
    if (!normalized || !isKaspaAddress(normalized, ALLOWED_ADDRESS_PREFIXES)) return;
    setSavedKaspiumAddress(normalized);
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(kaspiumStorageKey, normalized); } catch {}
  };

  const persistProvider = (provider: string) => {
    setLastProvider(provider);
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(providerStorageKey, provider); } catch {}
  };

  const resolveKaspiumAddress = async () => {
    const active = (kaspiumAddress.trim() || savedKaspiumAddress.trim()).trim();
    if (active && isKaspaAddress(active, ALLOWED_ADDRESS_PREFIXES)) {
      return normalizeKaspaAddress(active, ALLOWED_ADDRESS_PREFIXES);
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      try {
        const clipboardRaw = await navigator.clipboard.readText();
        const candidate = String(clipboardRaw || "").trim().split(/\s+/)[0] || "";
        if (candidate && isKaspaAddress(candidate, ALLOWED_ADDRESS_PREFIXES)) {
          const normalized = normalizeKaspaAddress(candidate, ALLOWED_ADDRESS_PREFIXES);
          setKaspiumAddress(normalized);
          persistKaspiumAddress(normalized);
          return normalized;
        }
      } catch {}
    }
    const raw = window.prompt(`Paste your ${NETWORK_LABEL} Kaspium address (${ALLOWED_ADDRESS_PREFIXES.join(", ")}).`) || "";
    const normalized = normalizeKaspaAddress(raw, ALLOWED_ADDRESS_PREFIXES);
    setKaspiumAddress(normalized);
    persistKaspiumAddress(normalized);
    return normalized;
  };

  const resolveManualBridgeAddress = async (walletName: string) => {
    const raw = window.prompt(`Paste your ${NETWORK_LABEL} ${walletName} receive address (${ALLOWED_ADDRESS_PREFIXES.join(", ")}).`) || "";
    return normalizeKaspaAddress(raw, ALLOWED_ADDRESS_PREFIXES);
  };

  const connect = async (provider: string) => {
    setBusyProvider(provider);
    setErr(null);
    setInfo("");
    try {
      let session: any;
      if (provider === "kasware") {
        session = await WalletAdapter.connectKasware();
        setInfo("Kasware session ready. Extension signing is armed.");
      } else if (provider === "kastle") {
        session = await WalletAdapter.connectKastle();
        setInfo("Kastle session ready. Extension signing is armed.");
      } else if (provider === "tangem" || provider === "onekey") {
        const resolvedAddress = await resolveManualBridgeAddress(provider === "tangem" ? "Tangem" : "OneKey");
        session = await WalletAdapter.connectHardwareBridge(provider as "tangem" | "onekey", resolvedAddress);
        setInfo(`${provider === "tangem" ? "Tangem" : "OneKey"} bridge session ready for ${shortAddr(session.address)}.`);
      } else if (provider === "kaspium") {
        const resolvedAddress = await resolveKaspiumAddress();
        session = WalletAdapter.connectKaspium(resolvedAddress);
        persistKaspiumAddress(session.address);
        setInfo(`Kaspium session ready for ${shortAddr(session.address)}.`);
      } else {
        session = { address: DEMO_ADDRESS, network: DEFAULT_NETWORK, provider: "demo" };
        setInfo("Demo session ready.");
      }
      persistProvider(provider);
      onConnect(session);
    } catch (e: any) {
      setErr(formatForgeError(e) || e?.message || "Wallet connection failed.");
    }
    setBusyProvider(null);
  };

  const wallets = FORGEOS_CONNECTABLE_WALLETS.filter(w => w.id === "demo").map((w) => {
    return { ...w, statusText: "No blockchain broadcast", statusColor: C.dim, cta: "Enter Demo Mode" };
  });

  const walletSections = useMemo(() => {
    const ordered = Array.isArray(wallets) ? wallets : [];
    const sandbox = ordered.filter((w) => String(w.id) === "demo");
    return [
      { key: "sandbox", title: "Sandbox", subtitle: "UI validation — no on-chain broadcast.", items: sandbox },
    ].filter((section) => section.items.length > 0);
  }, [wallets]);

  return (
    <div className="forge-shell" style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: "100vh", padding: "clamp(8px, 2vw, 12px)" }}>
<ForgeAtmosphere />
      <div className="forge-content forge-gate-responsive" style={{ width: "100%", maxWidth: 1380, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(300px,480px)", gap: "clamp(16px, 3vw, 32px)", alignItems: "center" }}>

        {/* ── HERO COLUMN ── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>

          {/* Kicker + title */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, ...mono, letterSpacing: "0.2em", marginBottom: 4 }}>
              FORGE-OS // KASPA-NATIVE QUANT STACK
            </div>
            <h1 style={{ font: `700 clamp(20px,3.5vw,40px)/1.1 'IBM Plex Mono',monospace`, letterSpacing: "0.03em", margin: "0 0 4px", color: C.text, textWrap: "balance" as any }}>
              <span style={{ color: C.accent, textShadow: "0 0 25px rgba(57,221,182,0.5)" }}>KAS / USDC</span><br />
              <span style={{ color: C.text, fontWeight: 800 }}>AI TRADING</span><br />
              <span style={{ color: C.dim, fontWeight: 500, fontSize: "0.85em" }}>⚡ BLOCKDAG SPEED</span>
            </h1>
            <p style={{ font: `500 12px/1.4 'Space Grotesk','Segoe UI',sans-serif`, color: "#9db0c6", maxWidth: "48ch", margin: "0 0 6px" }}>
              Full-stack DeFi for Kaspa. Agents accumulate KAS today — and flip to active profit trading the moment stablecoins, KRC-20, and Kaspa 0x swaps go live.
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
              <Badge text={`${NETWORK_LABEL}`} color={C.ok} dot />
              <Badge text="KRC-20 READY" color={C.purple} dot />
              <Badge text="NON-CUSTODIAL" color={C.warn} dot />
              <Badge text="DAG-SPEED EXECUTION" color={C.accent} dot />
            </div>
          </div>

          {/* Protocol stack grid */}
          <div>
            <div style={{ fontSize: 9, color: C.dim, ...mono, letterSpacing: "0.16em", marginBottom: 6 }}>PROTOCOL CAPABILITIES</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4 }}>
              {PROTOCOL_STACK.map((item) => (
                <div key={item.title}
                  style={{
                    background: `linear-gradient(145deg, ${item.iconColor}10 0%, rgba(8,13,20,0.55) 100%)`,
                    border: `1px solid ${item.iconColor}22`,
                    borderRadius: 6, padding: "8px 10px",
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                    <span style={{ fontSize: 14, color: item.iconColor, lineHeight: 1 }}>{item.icon}</span>
                    <span style={{
                      fontSize: 7, color: item.statusColor, fontWeight: 700, ...mono,
                      background: `${item.statusColor}15`, padding: "2px 4px", borderRadius: 2,
                      border: `1px solid ${item.statusColor}30`,
                    }}>{item.status}</span>
                  </div>
                  <div style={{ fontSize: 9, color: C.text, fontWeight: 700, ...mono, marginBottom: 2 }}>{item.title}</div>
                  <div style={{ fontSize: 7, color: C.dim, lineHeight: 1.3 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Architecture strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
            {[
              ["EXECUTION", "Wallet-native signing + queue lifecycle management"],
              ["TRUTH", "Receipt-aware P&L attribution + consistency checks"],
              ["ROUTING", "DAG-aware capital allocation + Kelly-fraction sizing"],
            ].map(([k, v]) => (
              <div key={k} style={{ border: `1px solid rgba(33,48,67,0.72)`, borderRadius: 8, background: "linear-gradient(180deg, rgba(11,20,30,0.78) 0%, rgba(9,15,23,0.7) 100%)", padding: "8px 10px" }}>
                <div style={{ font: `700 9px/1.2 'IBM Plex Mono',monospace`, color: C.accent, letterSpacing: "0.1em", marginBottom: 2 }}>{k}</div>
                <div style={{ font: `500 8px/1.3 'IBM Plex Mono',monospace`, color: C.dim }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Key numbers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
            {[
              { v: "BlockDAG", l: "Settlement speed" },
              { v: "Non-Custodial", l: "Keys stay in wallet" },
              { v: "KAS/USDC", l: "Pair architecture" },
            ].map(item => (
              <div key={item.v} style={{ border: `1px solid rgba(33,48,67,0.82)`, borderRadius: 10, background: "rgba(10,17,24,0.72)", padding: "8px" }}>
                <div style={{ font: `700 14px/1.2 'IBM Plex Mono',monospace`, color: C.accent, marginBottom: 2 }}>{item.v}</div>
                <div style={{ font: `500 9px/1.3 'IBM Plex Mono',monospace`, letterSpacing: "0.08em", color: C.dim }}>{item.l}</div>
              </div>
            ))}
          </div>

          {/* Social links */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { href: "https://x.com/ForgeOSxyz", icon: "𝕏", label: "@ForgeOSxyz", c: C.text },
              { href: "https://github.com/Forge-OS", icon: "⌘", label: "GitHub", c: C.dim },
              { href: "https://t.me/ForgeOSDefi", icon: "✈", label: "Telegram", c: C.dim },
            ].map(item => (
              <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "6px 10px", borderRadius: 6,
                  background: "rgba(16,25,35,0.5)", border: `1px solid rgba(33,48,67,0.7)`,
                  color: item.c, textDecoration: "none", fontSize: 10, fontWeight: 600, ...mono,
                }}>
                <span style={{ fontSize: 12 }}>{item.icon}</span>
                <span>{item.label}</span>
              </a>
            ))}
          </div>
        </section>

        {/* ── CONNECT COLUMN ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Branding lockup */}
          <div style={{ textAlign: "center", marginBottom: 4 }}>
            <div style={{ fontSize: "clamp(18px,3vw,24px)", fontWeight: 700, ...mono, letterSpacing: "0.12em", lineHeight: 1.2 }}>
              <span style={{ color: C.accent }}>FORGE</span><span style={{ color: C.text }}>-OS</span>
            </div>
            <div style={{ fontSize: 9, color: C.dim, letterSpacing: "0.1em", ...mono }}>AI-NATIVE FINANCIAL OPERATING SYSTEM · POWERED BY KASPA</div>
          </div>

          {/* Connect card */}
          <Card p={16} style={{ border: `1px solid rgba(57,221,182,0.14)` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 700, ...mono }}>Connect Wallet</div>
              <Badge text={NETWORK_LABEL} color={C.ok} dot />
            </div>
            <div style={{ fontSize: 10, color: C.dim, marginBottom: 12 }}>
              All operations are wallet-native. Forge-OS never stores private keys or signs on your behalf.
            </div>

            {/* Primary CTA — Sign In / Connect opens extension popup + wallet list */}
            <button
              onClick={onSignInClick}
              disabled={busy}
              style={{
                width: "100%",
                background: `linear-gradient(90deg, ${C.accent}, #7BE9CF)`,
                border: "none",
                borderRadius: 8,
                cursor: busy ? "not-allowed" : "pointer",
                color: "#04110E",
                fontSize: 12,
                ...mono,
                fontWeight: 700,
                letterSpacing: "0.08em",
                padding: "12px 0",
                boxShadow: "0 4px 20px rgba(57,221,182,0.28)",
                marginBottom: 8,
                opacity: busy ? 0.6 : 1,
                transition: "opacity 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => { if (!busy) (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 28px rgba(57,221,182,0.44)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 20px rgba(57,221,182,0.28)"; }}
            >
              CONNECT WALLET →
            </button>

            {/* Secondary option — create / import wallet */}
            <button
              onClick={() => setShowCreator(true)}
              style={{
                width: "100%",
                background: "linear-gradient(135deg, rgba(57,221,182,0.06) 0%, rgba(8,13,20,0.55) 100%)",
                border: `1px solid ${C.accent}28`,
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                marginBottom: 12,
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = `${C.accent}55`; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = `${C.accent}28`; }}
            >
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 9, color: C.text, ...mono, fontWeight: 700, marginBottom: 1 }}>New to Kaspa?</div>
                <div style={{ fontSize: 8, color: C.dim }}>Create or import a wallet</div>
              </div>
              <span style={{ fontSize: 9, color: C.accent, ...mono, fontWeight: 700, letterSpacing: "0.06em", flexShrink: 0, marginLeft: 8 }}>
                CREATE ›
              </span>
            </button>

            {info && <div style={{ marginTop: 10, padding: "8px 12px", background: `${C.ok}12`, border: `1px solid ${C.ok}44`, borderRadius: 6, fontSize: 10, color: C.ok, ...mono }}>{info}</div>}
            {err && <div style={{ marginTop: 10, padding: "8px 12px", background: C.dLow, border: `1px solid ${C.danger}40`, borderRadius: 6, fontSize: 10, color: C.danger, ...mono }}>{err}</div>}

            <Divider m={12} />
            <div style={{ fontSize: 8, color: C.dim, ...mono, lineHeight: 1.5 }}>
              Forge-OS never requests your private key · All signing happens inside your wallet · {NETWORK_LABEL}
            </div>
          </Card>

          {/* KAS/USDC readiness notice */}
          <div style={{
            background: `linear-gradient(135deg, ${C.purple}10 0%, rgba(8,13,20,0.5) 100%)`,
            border: `1px solid ${C.purple}28`,
            borderRadius: 8, padding: "10px 14px",
          }}>
            <div style={{ fontSize: 8, color: C.purple, fontWeight: 700, ...mono, letterSpacing: "0.12em", marginBottom: 4 }}>KASPA STABLECOIN UPGRADE · READY</div>
            <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.4 }}>
              Agents accumulate KAS now. When Kaspa stablecoins launch at L1, agents automatically
              switch to active buy/sell — buying dips, selling strength, and booking profit in USD.
              KRC-20 tokens and Kaspa 0x swaps are already in the engine. No migration, no downtime.
            </div>
          </div>
        </div>
      </div>

      {/* Responsive override */}
      <style>{`
        @media (max-width: 1080px) {
          .forge-gate-responsive { grid-template-columns: 1fr !important; max-width: 720px; }
        }
      `}</style>

      {showCreator && (
        <WalletCreator
          onConnect={(session) => { setShowCreator(false); onConnect(session); }}
          onClose={() => setShowCreator(false)}
        />
      )}
    </div>
  );
}
