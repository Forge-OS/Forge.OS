import { useEffect, useState, useCallback } from "react";
import { C, mono } from "../../src/tokens";
import { shortAddr, fmt } from "../../src/helpers";
import { fetchKasBalance, fetchKasUsdPrice } from "../shared/api";
import { getWalletMeta, getNetwork, getAutoLockMinutes } from "../shared/storage";
import { vaultExists, unlockVault, lockWallet, getSession, extendSession } from "../vault/vault";
import type { UnlockedSession } from "../vault/types";
import { WalletTab } from "../tabs/WalletTab";
import { AgentsTab } from "../tabs/AgentsTab";
import { SecurityTab } from "../tabs/SecurityTab";
import { SwapTab } from "../tabs/SwapTab";
import { LockScreen } from "./screens/LockScreen";
import { FirstRunScreen } from "./screens/FirstRunScreen";
import { ConnectApprovalScreen } from "./screens/ConnectApprovalScreen";

type Tab = "wallet" | "agents" | "swap" | "security";

// ── Screen state ─────────────────────────────────────────────────────────────
type Screen =
  | { type: "loading" }
  | { type: "first_run" }
  | { type: "locked" }
  | { type: "unlocked" };

const PENDING_CONNECT_KEY = "forgeos.connect.pending";

export function Popup() {
  const [screen, setScreen] = useState<Screen>({ type: "loading" });
  const [session, setSession] = useState<UnlockedSession | null>(null);
  const [network, setNetwork] = useState("mainnet");
  const [balance, setBalance] = useState<number | null>(null);
  const [usdPrice, setUsdPrice] = useState(0);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab>("wallet");
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);
  const [pendingConnect, setPendingConnect] = useState<{ requestId: string; tabId: number } | null>(null);

  // ── Initialise ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [exists, net, lockMins] = await Promise.all([
        vaultExists(),
        getNetwork(),
        getAutoLockMinutes(),
      ]);
      setNetwork(net);
      setAutoLockMinutes(lockMins);

      if (!exists) {
        // No vault — check for legacy address-only metadata from content bridge
        const meta = await getWalletMeta();
        if (meta?.address) {
          // External wallet (Kasware/Kastle user) — no vault, show balance only
          setSession({ mnemonic: "", address: meta.address, network: net, autoLockAt: Infinity });
          fetchBalances(meta.address);
          setScreen({ type: "unlocked" });
        } else {
          setScreen({ type: "first_run" });
        }
        return;
      }

      // Vault exists — check if session is still active (popup reopened within TTL)
      const existing = getSession();
      if (existing) {
        setSession(existing);
        fetchBalances(existing.address);
        setScreen({ type: "unlocked" });
      } else {
        setScreen({ type: "locked" });
      }
    })();
  }, []);

  // ── Pending site-connect request check ──────────────────────────────────────
  useEffect(() => {
    (chrome.storage as any).session.get(PENDING_CONNECT_KEY).then((result: any) => {
      const pending = result?.[PENDING_CONNECT_KEY];
      if (pending?.requestId) setPendingConnect(pending);
    }).catch(() => {});
  }, []);

  // ── Auto-lock listener ──────────────────────────────────────────────────────
  useEffect(() => {
    const listener = (msg: unknown) => {
      if ((msg as { type?: string })?.type === "AUTOLOCK_FIRED") {
        handleLock();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ── Session TTL check ────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen.type !== "unlocked" || !session) return;
    const interval = setInterval(() => {
      const s = getSession();
      if (!s) handleLock();
    }, 30_000);
    return () => clearInterval(interval);
  }, [screen.type, session]);

  // ── Balance fetch ────────────────────────────────────────────────────────────
  const fetchBalances = useCallback(async (address: string) => {
    try {
      const [bal, price] = await Promise.all([
        fetchKasBalance(address),
        fetchKasUsdPrice(),
      ]);
      setBalance(bal);
      setUsdPrice(price);
    } catch { /* non-fatal */ }
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleUnlock = (s: UnlockedSession) => {
    setSession(s);
    fetchBalances(s.address);
    setScreen({ type: "unlocked" });
  };

  const handleLock = () => {
    lockWallet();
    setSession(null);
    setBalance(null);
    setUsdPrice(0);
    setScreen({ type: "locked" });
  };

  const handleReset = async () => {
    const { resetWallet } = await import("../vault/vault");
    await resetWallet();
    setSession(null);
    setBalance(null);
    setScreen({ type: "first_run" });
  };

  const handleFirstRunComplete = (s: UnlockedSession) => {
    setSession(s);
    fetchBalances(s.address);
    setScreen({ type: "unlocked" });
  };

  const copyAddress = async () => {
    if (!session?.address) return;
    try {
      await navigator.clipboard.writeText(session.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* non-fatal */ }
  };

  // ── User activity → extend session TTL ───────────────────────────────────────
  const onUserActivity = () => {
    if (screen.type === "unlocked") extendSession(autoLockMinutes);
  };

  // ── Screen renders ────────────────────────────────────────────────────────────
  if (screen.type === "loading") {
    return (
      <div style={{ width: 360, height: 560, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", ...mono }}>
        <div style={{ textAlign: "center" }}>
          <img src="../icons/icon48.png" alt="" style={{ width: 32, height: 32, objectFit: "contain", opacity: 0.6 }} />
          <div style={{ fontSize: 8, color: C.dim, marginTop: 8, letterSpacing: "0.1em" }}>LOADING…</div>
        </div>
      </div>
    );
  }

  if (screen.type === "first_run") {
    return <FirstRunScreen network={network} onComplete={handleFirstRunComplete} />;
  }

  if (screen.type === "locked") {
    return <LockScreen onUnlock={handleUnlock} onReset={handleReset} />;
  }

  // ── Pending connect approval (MetaMask-style) ────────────────────────────────
  if (pendingConnect && session?.address) {
    return (
      <ConnectApprovalScreen
        address={session.address}
        network={network}
        onApprove={() => {
          chrome.runtime.sendMessage({
            type: "FORGEOS_CONNECT_APPROVE",
            address: session!.address,
            network,
          }).catch(() => {});
          setPendingConnect(null);
        }}
        onReject={() => {
          chrome.runtime.sendMessage({ type: "FORGEOS_CONNECT_REJECT" }).catch(() => {});
          setPendingConnect(null);
          window.close();
        }}
      />
    );
  }

  // ── UNLOCKED — main popup UI ─────────────────────────────────────────────────
  const address = session?.address ?? null;
  const usdValue = balance !== null && usdPrice > 0 ? balance * usdPrice : null;
  const isMainnet = network === "mainnet";
  const isManagedWallet = Boolean(session?.mnemonic);

  return (
    <div
      onClick={onUserActivity}
      style={{ width: 360, minHeight: 560, background: C.bg, display: "flex", flexDirection: "column", ...mono }}
    >
      {/* Header */}
      <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="../icons/icon48.png" alt="Forge-OS" style={{ width: 22, height: 22, objectFit: "contain", filter: "drop-shadow(0 0 6px rgba(57,221,182,0.5))" }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.1em" }}>
            <span style={{ color: C.accent }}>FORGE</span><span style={{ color: C.text }}>-OS</span>
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 8, color: isMainnet ? C.warn : C.ok, fontWeight: 700, letterSpacing: "0.1em",
            background: isMainnet ? `${C.warn}15` : `${C.ok}15`,
            border: `1px solid ${isMainnet ? C.warn : C.ok}30`,
            borderRadius: 4, padding: "3px 7px",
          }}>{network.toUpperCase()}</span>

          {/* Lock button — only for managed wallets */}
          {isManagedWallet && (
            <button
              onClick={handleLock}
              title="Lock wallet"
              style={{
                background: "rgba(33,48,67,0.5)", border: `1px solid ${C.border}`,
                borderRadius: 4, padding: "3px 7px",
                color: C.dim, fontSize: 9, cursor: "pointer", ...mono,
              }}
            >🔒</button>
          )}
        </div>
      </div>

      {/* Address + balance hero */}
      {address ? (
        <div style={{ padding: "16px 14px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "center" }}>
          {/* Address row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 14 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.ok, flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: C.dim }}>{shortAddr(address)}</span>
            <button
              onClick={copyAddress}
              style={{ background: "none", border: "none", cursor: "pointer", color: copied ? C.ok : C.dim, fontSize: 9, padding: 0 }}
            >{copied ? "✓" : "copy"}</button>
          </div>

          {/* Balance */}
          <>
            {/* USDC / USD equivalent — primary display */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#2775CA", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 0 8px rgba(39,117,202,0.5)" }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: "#fff", lineHeight: 1 }}>$</span>
              </div>
              <div style={{ fontSize: 30, fontWeight: 700, color: C.text, letterSpacing: "0.01em", lineHeight: 1 }}>
                {usdValue !== null ? fmt(usdValue, 2) : "—"}
                <span style={{ fontSize: 12, color: "#2775CA", marginLeft: 5, fontWeight: 700 }}>USDC</span>
              </div>
            </div>
            {/* Kaspa stablecoin readiness badge */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#8F7BFF15", border: "1px solid #8F7BFF40", borderRadius: 4, padding: "2px 8px", marginBottom: 6 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.purple, display: "inline-block" }} />
              <span style={{ fontSize: 7, color: C.purple, fontWeight: 700, letterSpacing: "0.1em" }}>KASPA STABLECOIN · MAY 5 READY</span>
            </div>
            {/* KAS — secondary */}
            {balance !== null && (
              <div style={{ fontSize: 10, color: C.dim, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <img src="../icons/icon16.png" alt="KAS" style={{ width: 11, height: 11, opacity: 0.6 }} />
                {fmt(balance, 2)} KAS
              </div>
            )}
          </>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "center" }}>
            {[
              { label: "SEND",    action: () => setTab("wallet") },
              { label: "RECEIVE", action: () => setTab("wallet") },
              { label: "SWAP ↗",  action: () => chrome.tabs.create({ url: "https://forgeos.xyz" }) },
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
        /* External wallet / no address */
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
        {(["wallet", "agents", "swap", "security"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, background: "none", border: "none",
              borderBottom: `2px solid ${tab === t ? C.accent : "transparent"}`,
              color: tab === t ? C.accent : C.dim,
              fontSize: 9, fontWeight: 700, cursor: "pointer",
              padding: "8px 0", letterSpacing: "0.1em", ...mono,
              textTransform: "uppercase", transition: "color 0.15s, border-color 0.15s",
            }}
          >{t}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "wallet" && (
          <WalletTab address={address} balance={balance} usdPrice={usdPrice} network={network} />
        )}
        {tab === "agents" && <AgentsTab />}
        {tab === "swap" && <SwapTab />}
        {tab === "security" && (
          <SecurityTab
            address={address}
            network={network}
            isManagedWallet={isManagedWallet}
            onLock={handleLock}
          />
        )}
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
