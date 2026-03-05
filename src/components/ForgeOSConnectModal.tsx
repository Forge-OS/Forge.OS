// ForgeOS-only connect modal — triggered by the header "SIGN IN" button.
// Immediately attempts to connect the user's Forge-OS wallet:
//   1. Extension installed (window.forgeos) → extension popup opens, user enters password
//   2. (Optional) managed-wallet local fallback, when enabled by env policy
//   3. Neither found                       → shows recovery + create/import prompt

import { useEffect, useState } from "react";
import { C, mono } from "../tokens";
import { WalletAdapter, type ForgeOSBridgeStatus } from "../wallet/WalletAdapter";
import {
  generateNonce,
  createSession,
  saveSession,
  type ForgeSession,
} from "../auth/siwa";
import { DEFAULT_NETWORK } from "../constants";

type Step = "connecting" | "waiting_extension" | "not_found";

interface Props {
  onSignIn: (
    session: ForgeSession,
    wallet: { address: string; network: string; provider: string },
  ) => void;
  onOpenFullModal: () => void; // fallback: open full wallet picker
  onClose: () => void;
}

export function ForgeOSConnectModal({ onSignIn, onOpenFullModal, onClose }: Props) {
  const [step, setStep] = useState<Step>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<ForgeOSBridgeStatus | null>(null);
  const [bridgeChecking, setBridgeChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    let reprobeTimer: ReturnType<typeof setInterval> | undefined;
    let probingInFlight = false;

    const probeBridgeStatus = async (markChecking: boolean) => {
      if (probingInFlight) return;
      probingInFlight = true;
      if (markChecking) setBridgeChecking(true);
      const status = await WalletAdapter.probeForgeOSBridgeStatus(900).catch(() => null);
      if (cancelled) return;
      if (status) setBridgeStatus(status);
      if (markChecking) setBridgeChecking(false);
      probingInFlight = false;
    };

    const tryConnect = async () => {
      // Always attempt adapter connect first. Policy for managed fallback is
      // controlled in WalletAdapter via VITE_FORGEOS_STRICT_EXTENSION_AUTH_CONNECT.
      setStep("connecting");
      setError(null);
      const extensionWaitHint = window.setTimeout(() => {
        if (!cancelled) setStep("waiting_extension");
      }, 420);
      checkTimer = extensionWaitHint;

      try {
        const result = await WalletAdapter.connectForgeOS();
        clearTimeout(extensionWaitHint);
        if (cancelled) return;
        if (result?.address) {
          finalize(result.address, result.network ?? DEFAULT_NETWORK);
        } else {
          setError("No Forge-OS wallet found.");
          setStep("not_found");
        }
      } catch (e: any) {
        clearTimeout(extensionWaitHint);
        if (cancelled) return;
        const msg = String(e?.message ?? e ?? "Auto-connect failed.");
        const lower = msg.toLowerCase();
        if (lower.includes("cancel") || lower.includes("reject")) {
          onClose();
          return;
        }
        if (
          lower.includes("extension-auth connect is required") ||
          lower.includes("no forge-os wallet") ||
          lower.includes("wallet bridge detected") ||
          lower.includes("bridge detected") ||
          lower.includes("bridge unavailable") ||
          lower.includes("not found") ||
          lower.includes("timed out")
        ) {
          setError(
            "Forge-OS extension bridge was not detected on this tab. Reload the extension, refresh forge-os.xyz, and set Site access to allow this domain.",
          );
        } else {
          setError(msg);
        }
        setStep("not_found");
      }
    };

    (async () => {
      await probeBridgeStatus(true);
      if (cancelled) return;
      reprobeTimer = setInterval(() => {
        probeBridgeStatus(false).catch(() => {});
      }, 2_500);
      tryConnect();
    })();
    return () => {
      cancelled = true;
      if (checkTimer) clearTimeout(checkTimer);
      if (reprobeTimer) clearInterval(reprobeTimer);
    };
  }, []);

  const finalize = (address: string, network: string) => {
    const nonce = generateNonce();
    const session = createSession(address, network, "forgeos", nonce, true);
    saveSession(session);
    onSignIn(session, { address, network, provider: "forgeos" });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const backdrop: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 500,
    padding: 20,
  };

  const card: React.CSSProperties = {
    background: "linear-gradient(160deg, rgba(14,22,32,0.98) 0%, rgba(8,13,20,0.98) 100%)",
    border: `1px solid ${C.accent}22`,
    borderRadius: 14,
    padding: "28px 28px 24px",
    maxWidth: 360,
    width: "100%",
    boxShadow: `0 0 48px rgba(57,221,182,0.08), 0 16px 48px rgba(0,0,0,0.6)`,
    position: "relative",
  };

  return (
    <div style={backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={card}>
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 12, right: 14,
            background: "none", border: "none",
            color: C.dim, fontSize: 18, cursor: "pointer", lineHeight: 1,
          }}
        >×</button>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <img
            src="/forge-os-icon3.png"
            width={36} height={36}
            style={{ objectFit: "contain", filter: "drop-shadow(0 0 8px rgba(57,221,182,0.5))" }}
            alt=""
          />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, ...mono, letterSpacing: "0.1em" }}>
              <span style={{ color: C.accent }}>FORGE</span>
              <span style={{ color: C.text }}>-OS</span>
            </div>
            <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.06em" }}>Wallet Authentication</div>
          </div>
        </div>

        {/* Bridge status */}
        <div
          style={{
            marginBottom: 14,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            background: "rgba(6,10,16,0.66)",
            padding: "9px 10px",
          }}
        >
          <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.08em", ...mono, marginBottom: 8 }}>
            EXTENSION BRIDGE STATUS
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 8, color: C.dim, letterSpacing: "0.06em", ...mono }}>Provider Injected</span>
            <span style={{ fontSize: 8, color: bridgeStatus?.providerInjected ? C.ok : C.dim, ...mono }}>
              {bridgeStatus?.providerInjected ? "READY" : bridgeChecking ? "CHECKING" : "NOT FOUND"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 8, color: C.dim, letterSpacing: "0.06em", ...mono }}>Content Bridge</span>
            <span style={{ fontSize: 8, color: bridgeStatus?.bridgeReachable ? C.ok : C.dim, ...mono }}>
              {bridgeStatus?.bridgeReachable ? "READY" : bridgeChecking ? "CHECKING" : "NOT REACHABLE"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 8, color: C.dim, letterSpacing: "0.06em", ...mono }}>Managed Wallet Cache</span>
            <span style={{ fontSize: 8, color: bridgeStatus?.managedWalletPresent ? C.ok : C.dim, ...mono }}>
              {bridgeStatus?.managedWalletPresent ? "FOUND" : bridgeChecking ? "CHECKING" : "EMPTY"}
            </span>
          </div>
          {!bridgeChecking && bridgeStatus?.transport === "none" && (
            <div style={{ marginTop: 8, fontSize: 8, color: C.warn, lineHeight: 1.4 }}>
              No active extension transport on this tab. Check Chrome extension site access for `forge-os.xyz`.
            </div>
          )}
        </div>

        {/* ── CONNECTING spinner ──────────────────────────────────── */}
        {(step === "connecting" || step === "waiting_extension") && (
          <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
            <div style={{
              width: 38, height: 38,
              borderRadius: "50%",
              border: `2px solid ${C.border}`,
              borderTopColor: C.accent,
              animation: "spin 0.8s linear infinite",
              margin: "0 auto 16px",
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ fontSize: 11, color: C.text, fontWeight: 700, ...mono, marginBottom: 6 }}>
              {step === "waiting_extension"
                ? "Waiting for extension"
                : "Connecting…"}
            </div>
            <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.6 }}>
              {step === "waiting_extension"
                ? "If popup appears, enter your password to continue."
                : "Detecting your Forge-OS wallet…"}
            </div>
            <button
              onClick={() => WalletAdapter.openForgeOSExtensionPopup()}
              style={{
                marginTop: 10,
                background: "rgba(8,13,20,0.75)",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                color: C.text,
                fontSize: 9,
                ...mono,
                letterSpacing: "0.06em",
                fontWeight: 700,
                padding: "8px 12px",
                cursor: "pointer",
              }}
            >
              OPEN FORGE-OS EXTENSION
            </button>
          </div>
        )}

        {/* ── NOT FOUND ───────────────────────────────────────────── */}
        {step === "not_found" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {error ? (
              <div style={{
                background: `${C.danger}10`, border: `1px solid ${C.danger}35`,
                borderRadius: 8, padding: "10px 12px",
                fontSize: 9, color: C.danger, lineHeight: 1.5,
              }}>
                {error}
              </div>
            ) : (
              <div style={{
                background: `${C.accent}08`, border: `1px solid ${C.accent}20`,
                borderRadius: 8, padding: "12px 14px",
              }}>
                <div style={{ fontSize: 10, color: C.text, fontWeight: 700, ...mono, marginBottom: 4 }}>
                  No Forge-OS wallet found
                </div>
                <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.6 }}>
                  Reload the extension, refresh forge-os.xyz, and ensure extension site access is enabled for this domain.
                </div>
              </div>
            )}

            {/* Primary: create wallet */}
            <button
              onClick={onOpenFullModal}
              style={{
                width: "100%",
                background: `linear-gradient(90deg, ${C.accent}, #7BE9CF)`,
                border: "none", borderRadius: 8,
                padding: "11px 0", cursor: "pointer",
                color: "#04110E", fontSize: 11, fontWeight: 700,
                ...mono, letterSpacing: "0.08em",
                boxShadow: "0 4px 16px rgba(57,221,182,0.25)",
              }}
            >
              CREATE / IMPORT WALLET →
            </button>

            {/* Secondary: other wallets */}
            <button
              onClick={onOpenFullModal}
              style={{
                width: "100%",
                background: "transparent",
                border: `1px solid ${C.border}`,
                borderRadius: 8, padding: "9px 0",
                cursor: "pointer", color: C.dim,
                fontSize: 9, ...mono, letterSpacing: "0.06em",
              }}
            >
              Use another wallet
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
