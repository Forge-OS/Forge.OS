import { useEffect, useMemo, useState } from "react";
import { ALLOWED_ADDRESS_PREFIXES, DEFAULT_NETWORK, NETWORK_LABEL } from "../constants";
import { C, mono } from "../tokens";
import { isKaspaAddress, normalizeKaspaAddress, shortAddr } from "../helpers";
import { WalletAdapter } from "../wallet/WalletAdapter";
import { Badge, Btn, Card, Divider, ExtLink, Inp } from "./ui";
import { ForgeAtmosphere } from "./chrome/ForgeAtmosphere";

export function WalletGate({onConnect}: any) {
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [err,  setErr]  = useState(null as any);
  const [info, setInfo] = useState("");
  const [kaspiumAddress, setKaspiumAddress] = useState("");
  const [savedKaspiumAddress, setSavedKaspiumAddress] = useState("");
  const [lastProvider, setLastProvider] = useState("");
  const detected = WalletAdapter.detect();
  const kaspiumStorageKey = useMemo(() => `forgeos.kaspium.address.${DEFAULT_NETWORK}`, []);
  const providerStorageKey = useMemo(() => `forgeos.wallet.lastProvider.${DEFAULT_NETWORK}`, []);
  const activeKaspiumAddress = (kaspiumAddress.trim() || savedKaspiumAddress.trim()).trim();
  const kaspiumAddressValid = isKaspaAddress(activeKaspiumAddress, ALLOWED_ADDRESS_PREFIXES);
  const busy = Boolean(busyProvider);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(kaspiumStorageKey) || "";
      const normalized = saved.trim();
      if (normalized && isKaspaAddress(normalized, ALLOWED_ADDRESS_PREFIXES)) {
        setSavedKaspiumAddress(normalized);
        setKaspiumAddress(normalized);
      }
      const rememberedProvider = (window.localStorage.getItem(providerStorageKey) || "").trim();
      if (rememberedProvider) setLastProvider(rememberedProvider);
    } catch {
      // Ignore storage failures in strict browser contexts.
    }
  }, [kaspiumStorageKey, providerStorageKey]);

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
    const active = activeKaspiumAddress.trim();
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

  const connect = async (provider: string) => {
    setBusyProvider(provider);
    setErr(null);
    setInfo("");
    try {
      let session;
      if(provider === "kasware") {
        session = await WalletAdapter.connectKasware();
        setInfo("Kasware session ready. Extension signing is armed.");
      } else if(provider === "kaspium") {
        const resolvedAddress = await resolveKaspiumAddress();
        session = WalletAdapter.connectKaspium(resolvedAddress);
        persistKaspiumAddress(session.address);
        setInfo(`Kaspium session ready for ${shortAddr(session.address)}.`);
      } else {
        // Demo mode — no extension
        const demoPrefix = ALLOWED_ADDRESS_PREFIXES[0] || "kaspatest";
        session = { address:`${demoPrefix}:qp3t6flvhqd4d9jkk8m5v0xelwm6zxx99qx5p8f3j8vcm9y5la2vsnjsklav`, network:DEFAULT_NETWORK, provider:"demo" };
        setInfo("Demo session ready.");
      }
      persistProvider(provider);
      onConnect(session);
    } catch(e: any) {
      setErr(e?.message || "Wallet connection failed.");
    }
    setBusyProvider(null);
  };

  const wallets = [
    {
      k:"kasware",
      l:"Kasware",
      desc:"Injected browser wallet for direct signing.",
      status: detected.kasware ? "Detected in this tab" : "Not detected in this tab",
      statusColor: detected.kasware ? C.ok : C.warn,
      icon:"🦊",
      docsUrl: "https://github.com/kasware-wallet/extension",
      cta:"Connect Kasware",
    },
    {
      k:"kaspium",
      l:"Kaspium",
      desc:"Mobile wallet via deep-link flow.",
      status: kaspiumAddressValid ? `Address ready · ${shortAddr(activeKaspiumAddress)}` : "Address resolves on connect",
      statusColor: kaspiumAddressValid ? C.ok : C.warn,
      icon:"📱",
      docsUrl: "https://github.com/azbuky/kaspium_wallet",
      cta: kaspiumAddressValid ? "Connect Kaspium" : "Connect + Pair Address",
    },
    {
      k:"demo",
      l:"Demo Mode",
      desc:"Simulated signer for UI testing.",
      status:"No blockchain broadcast",
      statusColor:C.dim,
      icon:"🧪",
      docsUrl: "",
      cta:"Enter Demo Mode",
    },
  ];

  return (
    <div className="forge-shell" style={{display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"clamp(18px, 2vw, 28px)"}}>
      <ForgeAtmosphere />
      <div className="forge-content forge-gate-layout">
        <section className="forge-gate-hero">
          <div>
            <div className="forge-gate-kicker">FORGEOS // KASPA-NATIVE QUANT STACK</div>
            <h1 className="forge-gate-title">
              <span style={{color:C.accent}}>FORGE</span>OS TRADING CONTROL SURFACE
            </h1>
            <p className="forge-gate-copy">
              Full-screen command center for wallet-native execution, AI-guided quant cycles, and DAG-aware capital routing.
              Wallets are treated as installed and ready. Connect instantly and keep signing strictly in-wallet.
            </p>
            <div style={{display:"flex", gap:8, flexWrap:"wrap", marginTop:16}}>
              <Badge text={`${NETWORK_LABEL} PROFILE`} color={C.ok} dot/>
              <Badge text="NON-CUSTODIAL SIGNING" color={C.accent} dot/>
              <Badge text="SESSION REUSE ENABLED" color={C.purple} dot/>
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
              <span style={{color:C.accent}}>FORGE</span><span style={{color:C.text}}>OS</span>
            </div>
            <div style={{fontSize:11, color:C.dim, letterSpacing:"0.08em", ...mono}}>AI-NATIVE FINANCIAL OPERATING SYSTEM · POWERED BY KASPA</div>
          </div>
          <div className="forge-content" style={{width:"100%", maxWidth:560}}>
            <Card p={32} style={{width:"100%"}}>
              <div style={{fontSize:14, color:C.text, fontWeight:700, ...mono, marginBottom:4}}>Connect Wallet</div>
              <div style={{fontSize:12, color:C.dim, marginBottom:14}}>
                All operations are wallet-native. No custodial infrastructure. No private keys stored server-side.
              </div>
              <div style={{fontSize:11, color:C.dim, ...mono, marginBottom:14}}>
                Session profile: {NETWORK_LABEL} · allowed prefixes: {ALLOWED_ADDRESS_PREFIXES.join(", ")}
              </div>

              <div className="forge-wallet-grid">
                {wallets.map(w=> (
                  <div
                    key={w.k}
                    className={`forge-wallet-card ${lastProvider === w.k ? "forge-wallet-card--preferred" : ""}`}
                  >
                    <div style={{display:"flex", alignItems:"center", gap:12}}>
                      <div style={{fontSize:24, width:34, display:"flex", justifyContent:"center"}}>{w.icon}</div>
                      <div style={{flex:1}}>
                        <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
                          <div style={{fontSize:13, color:C.text, fontWeight:700, ...mono}}>{w.l}</div>
                          {lastProvider === w.k ? <Badge text="LAST USED" color={C.accent}/> : null}
                        </div>
                        <div style={{fontSize:11, color:C.dim, marginTop:2}}>{w.desc}</div>
                      </div>
                      <Badge text={w.status} color={w.statusColor}/>
                    </div>

                    <div style={{display:"flex", gap:8, marginTop:12, flexWrap:"wrap"}}>
                      <Btn
                        onClick={() => connect(w.k)}
                        disabled={busy && busyProvider !== w.k}
                        variant={w.k === "demo" ? "ghost" : "primary"}
                        size="sm"
                        style={{minWidth:190}}
                      >
                        {busyProvider === w.k ? "CONNECTING..." : w.cta}
                      </Btn>
                      {w.docsUrl ? <ExtLink href={w.docsUrl} label="DOCS ↗" /> : null}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{marginTop:14}}>
                <Inp
                  label="Kaspium Address (Optional Prefill)"
                  value={kaspiumAddress}
                  onChange={(value: string) => {
                    setKaspiumAddress(value);
                    if (err) setErr(null);
                  }}
                  placeholder={`${ALLOWED_ADDRESS_PREFIXES[0]}:...`}
                  hint={savedKaspiumAddress ? `Saved for ${NETWORK_LABEL}: ${savedKaspiumAddress}` : "Leave blank to auto-pair at connect time"}
                />
                <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
                  {savedKaspiumAddress && savedKaspiumAddress !== kaspiumAddress ? (
                    <Btn onClick={() => setKaspiumAddress(savedKaspiumAddress)} variant="ghost" size="sm">
                      USE SAVED ADDRESS
                    </Btn>
                  ) : null}
                  <Btn
                    onClick={() => {
                      if (!kaspiumAddressValid) {
                        setErr(`Invalid Kaspium address. Use: ${ALLOWED_ADDRESS_PREFIXES.join(", ")}`);
                        return;
                      }
                      persistKaspiumAddress(normalizeKaspaAddress(kaspiumAddress, ALLOWED_ADDRESS_PREFIXES));
                      setErr(null);
                      setInfo("Kaspium address saved for faster reconnects.");
                    }}
                    disabled={!kaspiumAddressValid}
                    variant="ghost"
                    size="sm"
                  >
                    SAVE ADDRESS
                  </Btn>
                </div>
              </div>

              {info ? <div style={{marginTop:12, padding:"10px 14px", background:C.oLow, border:`1px solid ${C.ok}44`, borderRadius:4, fontSize:12, color:C.ok, ...mono}}>{info}</div> : null}
              {err && <div style={{marginTop:14, padding:"10px 14px", background:C.dLow, borderRadius:4, fontSize:12, color:C.danger, ...mono}}>{err}</div>}
              <Divider m={18}/>
              <div style={{fontSize:11, color:C.dim, ...mono, lineHeight:1.6}}>
                forge.os never requests your private key · All transaction signing happens in your wallet · {NETWORK_LABEL} only
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
