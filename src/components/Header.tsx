// Forge.OS top navigation header.
// Shown on the landing page (WalletGate) for unauthenticated users.
// Sign In button checks for existing session and reconnects via extension if available.
// After sign-in, shows a compact address chip with a disconnect dropdown.

import { useState, useRef, useEffect } from "react";
import { C, mono } from "../tokens";
import { shortAddr } from "../helpers";
import { loadSession, type ForgeSession } from "../auth/siwa";

interface Props {
  /** Wallet session when authenticated, null when not. */
  wallet: { address: string; network: string; provider: string } | null;
  /** Called when user clicks Sign In - attempts extension reconnect if has existing session */
  onSignInClick: () => void;
  /** Called to reconnect via extension (for returning users with existing session) */
  onReconnect?: () => void;
  onDisconnect: () => void;
}

export function Header({ wallet, onSignInClick, onReconnect, onDisconnect }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  // Check for existing session on mount
  const [existingSession, setExistingSession] = useState<ForgeSession | null>(() => loadSession());

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Handle Sign In click - if has existing session with extension, try to reconnect
  const handleSignInClick = () => {
    if (existingSession && (existingSession.provider === "kasware" || existingSession.provider === "kastle" || existingSession.provider === "forgeos")) {
      // User has existing session with extension - try to reconnect via extension
      if (onReconnect) {
        onReconnect();
      } else {
        onSignInClick();
      }
    } else {
      // No existing session or non-extension provider - show SignInModal
      onSignInClick();
    }
  };

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 200,
        background: "transparent",
        padding: "10px clamp(16px, 3vw, 36px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img
          src="/forge-os-icon3.png"
          alt="Forge-OS"
          style={{
            width: 44,
            height: 44,
            objectFit: "contain",
            filter: "drop-shadow(0 0 8px rgba(57,221,182,0.5))",
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", ...mono }}>
          <span style={{ color: C.accent }}>FORGE</span>
          <span style={{ color: C.text }}>-OS</span>
        </span>
        <span
          style={{
            fontSize: 9,
            color: C.dim,
            letterSpacing: "0.08em",
            ...mono,
            marginLeft: 4,
            display: "none",
            // visible above ~520px
          }}
          className="header-tagline"
        >
          AI-NATIVE FINANCIAL OS
        </span>
      </div>

      {/* Right side: Sign In button OR address chip */}
      {wallet ? (
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(33,48,67,0.5)",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "5px 10px 5px 8px",
              cursor: "pointer",
              ...mono,
              transition: "border-color 0.15s",
            }}
          >
            {/* Status dot */}
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: wallet.provider === "demo" ? C.warn : C.ok,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 10, color: C.dim }}>{shortAddr(wallet.address)}</span>
            <span style={{ fontSize: 9, color: C.muted }}>▾</span>
          </button>

          {/* Dropdown */}
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                background: C.s2,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: "10px 0",
                minWidth: 220,
                zIndex: 300,
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              {/* Session info */}
              <div style={{ padding: "4px 14px 10px" }}>
                <div
                  style={{
                    fontSize: 7,
                    color: C.dim,
                    ...mono,
                    letterSpacing: "0.1em",
                    marginBottom: 4,
                  }}
                >
                  {wallet.network.toUpperCase()} · {wallet.provider.toUpperCase()}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: C.text,
                    ...mono,
                    wordBreak: "break-all",
                    lineHeight: 1.5,
                    background: "rgba(8,13,20,0.6)",
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    padding: "6px 8px",
                  }}
                >
                  {wallet.address}
                </div>
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: C.border, margin: "2px 0 6px" }} />

              {/* Disconnect */}
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDisconnect();
                }}
                style={{
                  width: "100%",
                  background: "none",
                  border: "none",
                  borderRadius: 0,
                  padding: "7px 14px",
                  color: C.danger,
                  fontSize: 9,
                  cursor: "pointer",
                  ...mono,
                  textAlign: "left",
                  letterSpacing: "0.08em",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background = `${C.danger}10`)
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.background = "none")
                }
              >
                DISCONNECT
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={handleSignInClick}
          style={{
            background: `linear-gradient(90deg, ${C.accent}, #7BE9CF)`,
            border: "none",
            borderRadius: 6,
            padding: "7px 18px",
            color: "#04110E",
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
            letterSpacing: "0.1em",
            ...mono,
            boxShadow: `0 0 18px ${C.accent}40`,
            transition: "box-shadow 0.15s, opacity 0.15s",
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 28px ${C.accent}70`)
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 18px ${C.accent}40`)
          }
        >
          SIGN IN
        </button>
      )}
    </header>
  );
}
