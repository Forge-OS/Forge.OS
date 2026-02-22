import { useEffect, useMemo, useState } from "react";
import { ALLOWED_ADDRESS_PREFIXES, DEFAULT_NETWORK, DEMO_ADDRESS, NETWORK_LABEL } from "../constants";
import { C, mono } from "../tokens";
import { isKaspaAddress, normalizeKaspaAddress, shortAddr } from "../helpers";
import { WalletAdapter } from "../wallet/WalletAdapter";
import {
  FORGEOS_CONNECTABLE_WALLETS,
  FORGEOS_UPCOMING_WALLET_CANDIDATES,
  walletClassLabel,
  walletMultiOutputLabel,
  walletStatusLabel,
} from "../wallet/walletCapabilityRegistry";
import { formatForgeError } from "../runtime/errorTaxonomy";
import { Badge, Btn, Card, Divider, ExtLink } from "./ui";
import { ForgeAtmosphere } from "./chrome/ForgeAtmosphere";

export function WalletGate({onConnect}: any) {
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [err,  setErr]  = useState(null as any);
  const [info, setInfo] = useState("");
  const [kaspiumAddress, setKaspiumAddress] = useState("");
  const [savedKaspiumAddress, setSavedKaspiumAddress] = useState("");
  const [lastProvider, setLastProvider] = useState("");
  const [ghostProviderCount, setGhostProviderCount] = useState<number | null>(null);
  const detected = WalletAdapter.detect();
  const kaspiumStorageKey = useMemo(() => `forgeos.kaspium.address.${DEFAULT_NETWORK}`, []);
  const providerStorageKey = useMemo(() => `forgeos.wallet.lastProvider.${DEFAULT_NETWORK}`, []);
  const activeKaspiumAddress = kaspiumAddress.trim();
  const kaspiumAddressValid = isKaspaAddress(activeKaspiumAddress, ALLOWED_ADDRESS_PREFIXES);
  const busy = Boolean(busyProvider);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(kaspiumStorageKey) || "";
      const normalized = saved.trim();
      if (normalized && isKaspaAddress(normalized, ALLOWED_ADDRESS_PREFIXES)) {
        setSavedKaspiumAddress(normalized);
      }
      const rememberedProvider = (window.localStorage.getItem(providerStorageKey) || "").trim();
      if (rememberedProvider) setLastProvider(rememberedProvider);
    } catch {
      // Ignore storage failures in strict browser contexts.
    }
  }, [kaspiumStorageKey, providerStorageKey]);

  useEffect(() => {
    let disposed = false;
    if (typeof WalletAdapter.probeGhostProviders !== "function") return;
    WalletAdapter.probeGhostProviders(250)
      .then((providers: any[]) => {
        if (!disposed) setGhostProviderCount(Array.isArray(providers) ? providers.length : 0);
      })
      .catch(() => {
        if (!disposed) setGhostProviderCount(0);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const persistKaspiumAddress = (value: string) => {
    const normalized = value.trim();
    if (!normalized || !isKaspaAddress(normalized, ALLOWED_ADDRESS_PREFIXES)) return;
    setSavedKaspiumAddress(normalized);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(kaspiumStorageKey, normalized);
    } catch {
      // Ignore storage failures in strict browser contexts.
    }
  };

  const persistProvider = (provider: string) => {
    setLastProvider(provider);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(providerStorageKey, provider);
    } catch {
      // Ignore storage failures in strict browser contexts.
    }
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
      } catch {
        // Clipboard can fail in strict browser permission modes.
      }
    }

    const raw = window.prompt(
      `Paste your ${NETWORK_LABEL} Kaspium address (${ALLOWED_ADDRESS_PREFIXES.join(", ")}).`
    ) || "";
    const normalized = normalizeKaspaAddress(raw, ALLOWED_ADDRESS_PREFIXES);
    setKaspiumAddress(normalized);
    persistKaspiumAddress(normalized);
    return normalized;
  };

  const resolveManualBridgeAddress = async (walletName: string) => {
    const raw = window.prompt(
      `Paste your ${NETWORK_LABEL} ${walletName} receive address (${ALLOWED_ADDRESS_PREFIXES.join(", ")}).`
    ) || "";
    return normalizeKaspaAddress(raw, ALLOWED_ADDRESS_PREFIXES);
  };

  const connect = async (provider: string) => {
    setBusyProvider(provider);
    setErr(null);
    setInfo("");
    try {
      let session;
      if(provider === "kasware") {
        session = await WalletAdapter.connectKasware();
        setInfo("Kasware session ready. Extension signing is armed.");
      } else if(provider === "kastle") {
        session = await WalletAdapter.connectKastle();
        setInfo("Kastle session ready. Extension signing is armed.");
      } else if(provider === "ghost") {
        session = await WalletAdapter.connectGhost();
        setInfo("Ghost Wallet session ready. Provider bridge is connected.");
      } else if(provider === "tangem" || provider === "onekey") {
        const resolvedAddress = await resolveManualBridgeAddress(provider === "tangem" ? "Tangem" : "OneKey");
        session = await WalletAdapter.connectHardwareBridge(provider as "tangem" | "onekey", resolvedAddress);
        setInfo(`${provider === "tangem" ? "Tangem" : "OneKey"} bridge session ready for ${shortAddr(session.address)}.`);
      } else if(provider === "kaspium") {
        const resolvedAddress = await resolveKaspiumAddress();
        session = WalletAdapter.connectKaspium(resolvedAddress);
        persistKaspiumAddress(session.address);
        setInfo(`Kaspium session ready for ${shortAddr(session.address)}.`);
      } else {
        // Demo mode — no extension
        session = { address: DEMO_ADDRESS, network:DEFAULT_NETWORK, provider:"demo" };
        setInfo("Demo session ready.");
      }
      persistProvider(provider);
      onConnect(session);
    } catch(e: any) {
      setErr(formatForgeError(e) || e?.message || "Wallet connection failed.");
    }
    setBusyProvider(null);
  };

  const wallets = FORGEOS_CONNECTABLE_WALLETS.map((w) => {
    if (w.id === "kasware") {
      return {
        ...w,
        statusText: detected.kasware ? "Detected in this tab" : "Not detected in this tab",
        statusColor: detected.kasware ? C.ok : C.warn,
        cta: "Connect Kasware",
      };
    }
    if (w.id === "kastle") {
      return {
        ...w,
        statusText: detected.kastle ? "Detected in this tab" : "Not detected in this tab",
        statusColor: detected.kastle ? C.ok : C.warn,
        cta: "Connect Kastle",
      };
    }
    if (w.id === "ghost") {
      const detectedGhost = Number(ghostProviderCount || 0) > 0;
      return {
        ...w,
        statusText:
          ghostProviderCount == null
            ? "Scanning provider bridge..."
            : detectedGhost
              ? `Detected ${ghostProviderCount} provider${ghostProviderCount === 1 ? "" : "s"}`
              : "Provider probes on connect",
        statusColor: ghostProviderCount == null ? C.dim : detectedGhost ? C.ok : C.warn,
        cta: "Connect Ghost",
      };
    }
    if (w.id === "kaspium") {
      return {
        ...w,
        statusText: kaspiumAddressValid ? `Address ready · ${shortAddr(activeKaspiumAddress)}` : "Address resolves on connect",
        statusColor: kaspiumAddressValid ? C.ok : C.warn,
        cta: kaspiumAddressValid ? "Connect Kaspium" : "Connect + Pair Address",
      };
    }
    if (w.id === "tangem" || w.id === "onekey") {
      return {
        ...w,
        statusText: "Manual bridge (address + txid handoff)",
        statusColor: C.warn,
        cta: `Connect ${w.name}`,
      };
    }
    return {
      ...w,
      statusText: "No blockchain broadcast",
      statusColor: C.dim,
      cta: "Enter Demo Mode",
    };
  });

  return (
    <div className="forge-shell" style={{display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"clamp(18px, 2vw, 28px)"}}>
      <ForgeAtmosphere />
      <div className="forge-content forge-gate-layout">
        <section className="forge-gate-hero">
          <div>
            <div className="forge-gate-kicker">FORGE.OS // KASPA-NATIVE QUANT STACK</div>
            <h1 className="forge-gate-title">
              <span style={{color:C.accent}}>FORGE</span>.OS TRADING CONTROL SURFACE
            </h1>
            <p className="forge-gate-copy">
              Full-screen command center for wallet-native execution, AI-guided quant cycles, and DAG-aware capital routing.
              Connect a supported wallet to operate the system. Signing remains inside your wallet at all times.
            </p>
            <div style={{display:"flex", gap:8, flexWrap:"wrap", marginTop:16}}>
              <Badge text={`${NETWORK_LABEL} SESSION`} color={C.ok} dot/>
              <Badge text="WALLET-NATIVE AUTHORIZATION" color={C.accent} dot/>
              <Badge text="SESSION CONTINUITY" color={C.purple} dot/>
            </div>
          </div>
          <div className="forge-gate-points">
            <div className="forge-gate-point">
              <div className="forge-gate-point-value">UTXO-Native</div>
              <div className="forge-gate-point-label">Kaspa-first architecture</div>
            </div>
            <div className="forge-gate-point">
              <div className="forge-gate-point-value">Non-Custodial</div>
              <div className="forge-gate-point-label">Private keys stay in wallet</div>
            </div>
            <div className="forge-gate-point">
              <div className="forge-gate-point-value">{NETWORK_LABEL}</div>
              <div className="forge-gate-point-label">Active network profile</div>
            </div>
          </div>
        </section>

        <div style={{display:"flex", flexDirection:"column", justifyContent:"center"}}>
          <div style={{marginBottom:18, textAlign:"center"}}>
            <div style={{fontSize:"clamp(24px, 4vw, 34px)", fontWeight:700, ...mono, letterSpacing:"0.12em", marginBottom:6}}>
              <span style={{color:C.accent}}>FORGE</span><span style={{color:C.text}}>.OS</span>
            </div>
            <div style={{fontSize:11, color:C.dim, letterSpacing:"0.08em", ...mono}}>AI-NATIVE FINANCIAL OPERATING SYSTEM · POWERED BY KASPA</div>
          </div>
          <div className="forge-content" style={{width:"100%", maxWidth:560}}>
            <Card p={32} style={{width:"100%"}}>
              <div style={{fontSize:14, color:C.text, fontWeight:700, ...mono, marginBottom:4}}>Connect Wallet</div>
              <div style={{fontSize:12, color:C.dim, marginBottom:14}}>
                All operations are wallet-native. Forge.OS never stores private keys or signs transactions on your behalf.
              </div>
              <div style={{fontSize:11, color:C.dim, ...mono, marginBottom:14}}>
                Runtime network: {NETWORK_LABEL} · accepted prefixes: {ALLOWED_ADDRESS_PREFIXES.join(", ")}
              </div>

              <div className="forge-wallet-grid">
                {wallets.map(w=> (
                  <div
                    key={w.id}
                    className={`forge-wallet-card ${lastProvider === w.id ? "forge-wallet-card--preferred" : ""}`}
                  >
                    <div style={{display:"flex", alignItems:"center", gap:12}}>
                      {w.logoSrc ? (
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(255,255,255,0.02)",
                            border: `1px solid ${C.border}`,
                            borderRadius: 6,
                            overflow: "hidden",
                            flexShrink: 0,
                          }}
                        >
                          <img src={w.logoSrc} alt={`${w.name} logo`} style={{width: 24, height: 24, objectFit: "contain"}} />
                        </div>
                      ) : (
                        <div style={{fontSize:24, width:34, display:"flex", justifyContent:"center", flexShrink:0}}>{w.uiIcon}</div>
                      )}
                      <div style={{flex:1}}>
                        <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
                          <div style={{fontSize:13, color:C.text, fontWeight:700, ...mono}}>{w.name}</div>
                          {lastProvider === w.id ? <Badge text="LAST USED" color={C.accent}/> : null}
                          <Badge text={walletClassLabel(w.class)} color={C.dim} />
                        </div>
                        <div style={{fontSize:11, color:C.dim, marginTop:2}}>{w.description}</div>
                      </div>
                      <Badge text={w.statusText} color={w.statusColor}/>
                    </div>

                    <div style={{display:"flex", gap:8, marginTop:12, flexWrap:"wrap"}}>
                      <Btn
                        onClick={() => connect(w.id)}
                        disabled={busy && busyProvider !== w.id}
                        variant={w.id === "demo" ? "ghost" : "primary"}
                        size="sm"
                        style={{minWidth:190}}
                      >
                        {busyProvider === w.id ? "CONNECTING..." : w.cta}
                      </Btn>
                      {w.docsUrl ? <ExtLink href={w.docsUrl} label="DOCS ↗" /> : null}
                    </div>
                  </div>
                ))}
              </div>

              {info ? <div style={{marginTop:12, padding:"10px 14px", background:C.oLow, border:`1px solid ${C.ok}44`, borderRadius:4, fontSize:12, color:C.ok, ...mono}}>{info}</div> : null}
              {err && <div style={{marginTop:14, padding:"10px 14px", background:C.dLow, borderRadius:4, fontSize:12, color:C.danger, ...mono}}>{err}</div>}
              <Divider m={18}/>
              <div style={{fontSize:11, color:C.dim, ...mono, lineHeight:1.6}}>
                Forge.OS never requests your private key · All transaction signing happens in your wallet · {NETWORK_LABEL} only
              </div>
            </Card>

            <Card p={18} style={{width:"100%", marginTop:12}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:10, flexWrap:"wrap"}}>
                <div style={{fontSize:12, color:C.text, fontWeight:700, ...mono}}>Wallet Compatibility Roadmap</div>
                <Badge text="CAPABILITY REGISTRY" color={C.accent} />
              </div>
              <div style={{fontSize:11, color:C.dim, marginBottom:10}}>
                Upcoming wallets are grouped by integration class. Cards show likely connection model and current multi-output support status for treasury-combined tx planning.
              </div>
              <div style={{display:"grid", gap:8}}>
                {FORGEOS_UPCOMING_WALLET_CANDIDATES.map((w) => (
                  <div
                    key={w.id}
                    style={{
                      background: C.s2,
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      padding: "10px 12px",
                    }}
                  >
                    <div style={{display:"flex", justifyContent:"space-between", gap:10, alignItems:"flex-start", flexWrap:"wrap"}}>
                      <div style={{display:"flex", gap:10, alignItems:"flex-start"}}>
                        {w.logoSrc ? (
                          <div
                            style={{
                              width: 22,
                              height: 22,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 4,
                              overflow: "hidden",
                              border: `1px solid ${C.border}`,
                              background: "rgba(255,255,255,0.02)",
                            }}
                          >
                            <img src={w.logoSrc} alt={`${w.name} logo`} style={{width: 16, height: 16, objectFit: "contain"}} />
                          </div>
                        ) : (
                          <div style={{fontSize:18, lineHeight:1}}>{w.uiIcon}</div>
                        )}
                        <div>
                          <div style={{display:"flex", gap:6, alignItems:"center", flexWrap:"wrap"}}>
                            <span style={{fontSize:12, color:C.text, fontWeight:700, ...mono}}>{w.name}</span>
                            <Badge text={walletStatusLabel(w.status)} color={w.status === "planned" ? C.warn : C.dim} />
                            <Badge text={walletClassLabel(w.class)} color={C.dim} />
                            <Badge text={walletMultiOutputLabel(w.capabilities.nativeMultiOutputSend)} color={C.text} />
                          </div>
                          <div style={{fontSize:11, color:C.dim, marginTop:3}}>{w.description}</div>
                          {w.notes?.[0] ? (
                            <div style={{fontSize:10, color:C.dim, marginTop:6, ...mono}}>
                              {w.notes[0]}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
                        <Badge text={`MODE ${String(w.connectMode).toUpperCase()}`} color={C.purple} />
                        {w.docsUrl ? <ExtLink href={w.docsUrl} label="DOCS ↗" /> : null}
                        {!w.docsUrl && w.websiteUrl ? <ExtLink href={w.websiteUrl} label="SITE ↗" /> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
