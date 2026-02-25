import { useEffect, useState } from "react";
import { C, mono } from "../../src/tokens";
import { shortAddr, fmt } from "../../src/helpers";
import { fetchKasBalance, fetchKasUsdPrice } from "../shared/api";
import { getManagedWallet, getNetwork, type ManagedWallet } from "../shared/storage";
import { WalletTab } from "../tabs/WalletTab";
import { AgentsTab } from "../tabs/AgentsTab";
import { SecurityTab } from "../tabs/SecurityTab";

type Tab = "wallet" | "agents" | "security";

export function Popup() {
  const [tab, setTab] = useState<Tab>("wallet");
  const [wallet, setWallet] = useState<ManagedWallet | null>(null);
  const [network, setNetwork] = useState("mainnet");
  const [balance, setBalance] = useState<number | null>(null);
  const [usdPrice, setUsdPrice] = useState(0);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [w, net] = await Promise.all([getManagedWallet(), getNetwork()]);
      setWallet(w);
      setNetwork(net);
      if (w?.address) {
        try {
          const [bal, price] = await Promise.all([
            fetchKasBalance(w.address),
            fetchKasUsdPrice(),
          ]);
          setBalance(bal);
          setUsdPrice(price);
        } catch {}
      }
      setLoading(false);
    })();
  }, []);

  const copyAddress = async () => {
    if (!wallet?.address) return;
    try { await navigator.clipboard.writeText(wallet.address); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const usdValue = balance !== null && usdPrice > 0 ? balance * usdPrice : null;
  const isMainnet = network === "mainnet";

  return (
    <div style={{ width: 360, minHeight: 560, background: C.bg, display: "flex", flexDirection: "column", ...mono }}>

      {/* Header */}
      <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="../icons/icon48.png" alt="Forge-OS" style={{ width: 22, height: 22, objectFit: "contain", filter: "drop-shadow(0 0 6px rgba(57,221,182,0.5))" }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.1em" }}>
            <span style={{ color: C.accent }}>FORGE</span><span style={{ color: C.text }}>-OS</span>
          </span>
        </div>
        <span style={{
          fontSize: 8, color: isMainnet ? C.warn : C.ok, fontWeight: 700, letterSpacing: "0.1em",
          background: isMainnet ? `${C.warn}15` : `${C.ok}15`,
          border: `1px solid ${isMainnet ? C.warn : C.ok}30`,
          borderRadius: 4, padding: "3px 7px",
        }}>{network.toUpperCase()}</span>
      </div>

      {/* Address + balance hero */}
      {wallet ? (
        <div style={{ padding: "16px 14px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "center" }}>
          {/* Address row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 14 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.ok, flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: C.dim }}>{shortAddr(wallet.address)}</span>
            <button
              onClick={copyAddress}
              style={{ background: "none", border: "none", cursor: "pointer", color: copied ? C.ok : C.dim, fontSize: 9, padding: 0 }}
            >{copied ? "✓" : "copy"}</button>
          </div>

          {/* Balance — USDC equivalent is primary, KAS is secondary */}
          {loading ? (
            <div style={{ fontSize: 10, color: C.dim }}>Loading…</div>
          ) : (
            <>
              {/* USDC primary */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
                {/* USDC circle logo */}
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#2775CA", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 0 8px rgba(39,117,202,0.5)" }}>
                  <span style={{ fontSize: 11, fontWeight: 900, color: "#fff", lineHeight: 1 }}>$</span>
                </div>
                <div style={{ fontSize: 30, fontWeight: 700, color: C.text, letterSpacing: "0.01em", lineHeight: 1 }}>
                  {usdValue !== null ? fmt(usdValue, 2) : "—"}
                  <span style={{ fontSize: 12, color: "#2775CA", marginLeft: 5, fontWeight: 700 }}>USDC</span>
                </div>
              </div>
              {/* May 5 readiness badge */}
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#8F7BFF15", border: "1px solid #8F7BFF40", borderRadius: 4, padding: "2px 8px", marginBottom: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.purple, display: "inline-block" }} />
                <span style={{ fontSize: 7, color: C.purple, fontWeight: 700, letterSpacing: "0.1em" }}>KASPA STABLECOIN · MAY 5 READY</span>
              </div>
              {/* KAS secondary */}
              {balance !== null && (
                <div style={{ fontSize: 10, color: C.dim, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  <img src="../icons/icon16.png" alt="KAS" style={{ width: 11, height: 11, opacity: 0.6 }} />
                  {fmt(balance, 2)} KAS
                </div>
              )}
            </>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "center" }}>
            {[
              { label: "SEND", tab: "wallet" as Tab, action: () => setTab("wallet") },
              { label: "RECEIVE", tab: "wallet" as Tab, action: () => setTab("wallet") },
              { label: "SWAP ↗", tab: null, action: () => chrome.tabs.create({ url: "https://forgeos.xyz" }) },
            ].map(btn => (
              <button
                key={btn.label}
                onClick={btn.action}
                style={{
                  flex: 1, background: `linear-gradient(145deg, ${C.accent}18, rgba(8,13,20,0.6))`,
                  border: `1px solid ${C.accent}35`, borderRadius: 8, padding: "7px 0",
                  color: C.accent, fontSize: 9, fontWeight: 700, cursor: "pointer", ...mono,
                  letterSpacing: "0.08em",
                }}
              >{btn.label}</button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: "24px 14px", textAlign: "center", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.dim, marginBottom: 10 }}>No wallet connected</div>
          <button
            onClick={() => chrome.tabs.create({ url: "https://forgeos.xyz" })}
            style={{
              background: `linear-gradient(90deg, ${C.accent}, #7BE9CF)`, color: "#04110E",
              border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 10,
              fontWeight: 700, cursor: "pointer", ...mono, letterSpacing: "0.08em",
            }}
          >OPEN FORGE-OS →</button>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
        {(["wallet", "agents", "security"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, background: "none", border: "none", borderBottom: `2px solid ${tab === t ? C.accent : "transparent"}`,
              color: tab === t ? C.accent : C.dim, fontSize: 9, fontWeight: 700, cursor: "pointer",
              padding: "8px 0", letterSpacing: "0.1em", ...mono, textTransform: "uppercase",
              transition: "color 0.15s, border-color 0.15s",
            }}
          >{t}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "wallet" && <WalletTab wallet={wallet} balance={balance} usdPrice={usdPrice} network={network} />}
        {tab === "agents" && <AgentsTab />}
        {tab === "security" && <SecurityTab wallet={wallet} network={network} />}
      </div>

      {/* Footer */}
      <div style={{ padding: "6px 14px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 7, color: C.muted, letterSpacing: "0.08em" }}>FORGE-OS · KASPA</span>
        <button
          onClick={() => chrome.tabs.create({ url: "https://forgeos.xyz" })}
          style={{ background: "none", border: "none", color: C.accent, fontSize: 7, cursor: "pointer", ...mono, letterSpacing: "0.06em" }}
        >OPEN SITE ↗</button>
      </div>
    </div>
  );
}
