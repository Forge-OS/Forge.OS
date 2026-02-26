import { useState, useRef, useEffect } from "react";
import { C, mono } from "../../../src/tokens";
import { unlockVault } from "../../vault/vault";
import type { UnlockedSession } from "../../vault/types";

interface Props {
  onUnlock: (session: UnlockedSession) => void;
  onReset: () => void;
}

export function LockScreen({ onUnlock, onReset }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || loading) return;

    setLoading(true);
    setError(null);

    try {
      const session = await unlockVault(password);
      onUnlock(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg === "INVALID_PASSWORD" ? "Incorrect password." : "Failed to unlock. Try again.");
      setPassword("");
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      width: 360, minHeight: 560, background: C.bg, display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "0 28px", ...mono,
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 28, textAlign: "center" }}>
        <img
          src="../icons/icon48.png"
          alt="Forge-OS"
          style={{ width: 40, height: 40, objectFit: "contain", filter: "drop-shadow(0 0 10px rgba(57,221,182,0.6))", marginBottom: 10 }}
        />
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.12em" }}>
          <span style={{ color: C.accent }}>FORGE</span>
          <span style={{ color: C.text }}>-OS</span>
        </div>
        <div style={{ fontSize: 8, color: C.dim, marginTop: 4, letterSpacing: "0.08em" }}>
          WALLET LOCKED
        </div>
      </div>

      {/* Lock icon */}
      <div style={{
        width: 44, height: 44, borderRadius: "50%",
        background: `${C.accent}15`, border: `1px solid ${C.accent}30`,
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 24,
      }}>
        <span style={{ fontSize: 20 }}>🔒</span>
      </div>

      {/* Unlock form */}
      <form onSubmit={handleUnlock} style={{ width: "100%" }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 7, color: C.dim, letterSpacing: "0.1em", marginBottom: 6 }}>
            PASSWORD
          </div>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            disabled={loading}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "rgba(8,13,20,0.7)", border: `1px solid ${error ? C.danger : C.border}`,
              borderRadius: 8, padding: "10px 12px",
              color: C.text, fontSize: 11, ...mono,
              outline: "none",
            }}
          />
        </div>

        {error && (
          <div style={{ fontSize: 8, color: C.danger, marginBottom: 10, textAlign: "center" }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!password || loading}
          style={{
            width: "100%", padding: "10px 0",
            background: password && !loading
              ? `linear-gradient(90deg, ${C.accent}, #7BE9CF)`
              : `${C.accent}30`,
            border: "none", borderRadius: 8,
            color: password && !loading ? "#04110E" : C.dim,
            fontSize: 10, fontWeight: 700, cursor: password && !loading ? "pointer" : "not-allowed",
            letterSpacing: "0.1em", ...mono,
            transition: "background 0.15s, color 0.15s",
          }}
        >
          {loading ? "UNLOCKING…" : "UNLOCK WALLET"}
        </button>
      </form>

      {/* Forgot password / reset */}
      <div style={{ marginTop: 20, textAlign: "center" }}>
        {!showReset ? (
          <button
            onClick={() => setShowReset(true)}
            style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono }}
          >
            Forgot password?
          </button>
        ) : (
          <div style={{
            background: C.dLow, border: `1px solid ${C.danger}40`,
            borderRadius: 8, padding: "12px 14px", marginTop: 4,
          }}>
            <div style={{ fontSize: 8, color: C.warn, fontWeight: 700, marginBottom: 6, letterSpacing: "0.08em" }}>
              ⚠ RESET WALLET
            </div>
            <div style={{ fontSize: 7, color: C.dim, lineHeight: 1.5, marginBottom: 10 }}>
              This will permanently delete your encrypted vault. Make sure you have your seed phrase backed up before proceeding.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setShowReset(false)}
                style={{
                  flex: 1, padding: "7px 0", background: "rgba(33,48,67,0.5)",
                  border: `1px solid ${C.border}`, borderRadius: 6,
                  color: C.dim, fontSize: 8, cursor: "pointer", ...mono,
                }}
              >CANCEL</button>
              <button
                onClick={onReset}
                style={{
                  flex: 1, padding: "7px 0", background: C.dLow,
                  border: `1px solid ${C.danger}60`, borderRadius: 6,
                  color: C.danger, fontSize: 8, fontWeight: 700, cursor: "pointer", ...mono,
                }}
              >RESET WALLET</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
