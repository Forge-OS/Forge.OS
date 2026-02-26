// SecurityTab — password-gated phrase reveal, change password, reset wallet.
// The mnemonic is NEVER passed as a prop; it is read from the in-memory
// session (unlockVault) only when the user explicitly authenticates here.

import { useState } from "react";
import { C, mono } from "../../src/tokens";
import { shortAddr } from "../../src/helpers";
import { unlockVault, changePassword, resetWallet, getSession } from "../vault/vault";

interface Props {
  address: string | null;
  network: string;
  isManagedWallet: boolean;
  onLock: () => void;
}

type Panel = "none" | "reveal" | "change_pw" | "reset";

export function SecurityTab({ address, network, isManagedWallet, onLock }: Props) {
  const [panel, setPanel] = useState<Panel>("none");
  const [revealWords, setRevealWords] = useState<string[]>([]);

  // Reveal phrase state
  const [revealPw, setRevealPw] = useState("");
  const [revealErr, setRevealErr] = useState<string | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);

  // Change password state
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changePwErr, setChangePwErr] = useState<string | null>(null);
  const [changePwOk, setChangePwOk] = useState(false);
  const [changePwLoading, setChangePwLoading] = useState(false);

  // Reset state
  const [resetConfirm, setResetConfirm] = useState(false);

  const provider = isManagedWallet ? "managed" : address ? "watch-only" : "none";

  // ── Reveal seed phrase ───────────────────────────────────────────────────────
  const handleReveal = async (e: React.FormEvent) => {
    e.preventDefault();
    setRevealErr(null);
    setRevealLoading(true);
    try {
      // Re-authenticate with password to get fresh session + mnemonic
      const session = await unlockVault(revealPw);
      setRevealWords(session.mnemonic.split(" "));
      setRevealPw("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRevealErr(msg === "INVALID_PASSWORD" ? "Incorrect password." : "Authentication failed.");
      setRevealPw("");
    } finally {
      setRevealLoading(false);
    }
  };

  const handleHidePhrase = () => {
    setRevealWords([]);
    setRevealPw("");
    setRevealErr(null);
    setPanel("none");
  };

  // ── Change password ──────────────────────────────────────────────────────────
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePwErr(null);
    if (newPw.length < 8) { setChangePwErr("New password must be at least 8 characters."); return; }
    if (newPw !== confirmPw) { setChangePwErr("New passwords do not match."); return; }
    if (newPw === oldPw) { setChangePwErr("New password must differ from current password."); return; }
    setChangePwLoading(true);
    try {
      await changePassword(oldPw, newPw);
      setChangePwOk(true);
      setOldPw(""); setNewPw(""); setConfirmPw("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "INVALID_PASSWORD") setChangePwErr("Current password is incorrect.");
      else if (msg === "WEAK_PASSWORD") setChangePwErr("New password is too short (min 8 chars).");
      else setChangePwErr("Failed to change password. Try again.");
    } finally {
      setChangePwLoading(false);
    }
  };

  // ── Reset wallet ─────────────────────────────────────────────────────────────
  const handleReset = async () => {
    if (!resetConfirm) { setResetConfirm(true); return; }
    await resetWallet();
    onLock(); // parent will navigate to first-run on next render
  };

  // ── Input style helper ───────────────────────────────────────────────────────
  const inputStyle = (hasError = false) => ({
    width: "100%", boxSizing: "border-box" as const,
    background: "rgba(8,13,20,0.7)", border: `1px solid ${hasError ? C.danger : C.border}`,
    borderRadius: 6, padding: "7px 10px", color: C.text, fontSize: 9,
    ...mono, outline: "none",
  });

  const closePanel = () => {
    setPanel("none");
    setRevealWords([]);
    setRevealPw(""); setRevealErr(null);
    setOldPw(""); setNewPw(""); setConfirmPw("");
    setChangePwErr(null); setChangePwOk(false);
    setResetConfirm(false);
  };

  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Connection status */}
      <div style={{ background: "rgba(8,13,20,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
        <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.12em", marginBottom: 8 }}>CONNECTION STATUS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={{ fontSize: 7, color: C.dim, marginBottom: 3 }}>PROVIDER</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: address ? C.ok : C.warn }} />
              <span style={{ fontSize: 9, color: C.text, fontWeight: 700 }}>{provider.toUpperCase()}</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 7, color: C.dim, marginBottom: 3 }}>NETWORK</div>
            <span style={{
              fontSize: 8, color: network === "mainnet" ? C.warn : C.ok, fontWeight: 700,
              background: network === "mainnet" ? `${C.warn}15` : `${C.ok}15`,
              border: `1px solid ${network === "mainnet" ? C.warn : C.ok}30`,
              borderRadius: 3, padding: "2px 6px",
            }}>{network.toUpperCase()}</span>
          </div>
          {address && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 7, color: C.dim, marginBottom: 3 }}>ADDRESS</div>
              <div style={{ fontSize: 8, color: C.text }}>{shortAddr(address)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Managed wallet actions */}
      {isManagedWallet && (
        <>
          {/* Action button row */}
          {panel === "none" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <button onClick={() => setPanel("reveal")} style={actionBtn(C.accent)}>
                🔑 REVEAL SEED PHRASE
              </button>
              <button onClick={() => setPanel("change_pw")} style={actionBtn(C.dim)}>
                🔐 CHANGE PASSWORD
              </button>
              <button onClick={() => setPanel("reset")} style={actionBtn(C.danger)}>
                ⚠ RESET WALLET
              </button>
            </div>
          )}

          {/* ── REVEAL PHRASE PANEL ───────────────────────────────────────── */}
          {panel === "reveal" && (
            <div style={{ background: `${C.warn}0A`, border: `1px solid ${C.warn}30`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 9, color: C.warn, fontWeight: 700, letterSpacing: "0.08em" }}>SEED PHRASE</span>
                <button onClick={handleHidePhrase} style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono }}>✕ close</button>
              </div>

              {revealWords.length === 0 ? (
                <form onSubmit={handleReveal}>
                  <div style={{ fontSize: 7, color: C.dim, marginBottom: 6, lineHeight: 1.5 }}>
                    Enter your password to view your seed phrase.
                    Never share it — anyone with this phrase controls your wallet.
                  </div>
                  <input
                    type="password"
                    value={revealPw}
                    onChange={e => setRevealPw(e.target.value)}
                    placeholder="Your password"
                    disabled={revealLoading}
                    style={{ ...inputStyle(Boolean(revealErr)), marginBottom: 6 }}
                  />
                  {revealErr && <div style={{ fontSize: 7, color: C.danger, marginBottom: 6 }}>{revealErr}</div>}
                  <button
                    type="submit"
                    disabled={!revealPw || revealLoading}
                    style={{
                      width: "100%", padding: "7px 0",
                      background: revealPw && !revealLoading ? `${C.warn}25` : "rgba(33,48,67,0.5)",
                      border: `1px solid ${revealPw && !revealLoading ? C.warn : C.border}`,
                      borderRadius: 6, color: revealPw && !revealLoading ? C.warn : C.dim,
                      fontSize: 8, fontWeight: 700, cursor: revealPw && !revealLoading ? "pointer" : "not-allowed", ...mono,
                    }}
                  >{revealLoading ? "AUTHENTICATING…" : "SHOW SEED PHRASE"}</button>
                </form>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 8 }}>
                    {revealWords.map((word, i) => (
                      <div key={i} style={{
                        background: "rgba(5,7,10,0.9)", border: `1px solid ${C.border}`,
                        borderRadius: 4, padding: "5px 4px",
                        display: "flex", alignItems: "center", gap: 3,
                      }}>
                        <span style={{ fontSize: 6, color: C.dim, flexShrink: 0 }}>{i + 1}.</span>
                        <span style={{ fontSize: 7, color: C.text, fontWeight: 600 }}>{word}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 7, color: C.warn, lineHeight: 1.4 }}>
                    ⚠ Store offline. Never photograph or share digitally.
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── CHANGE PASSWORD PANEL ─────────────────────────────────────── */}
          {panel === "change_pw" && (
            <div style={{ background: "rgba(8,13,20,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 9, color: C.text, fontWeight: 700, letterSpacing: "0.08em" }}>CHANGE PASSWORD</span>
                <button onClick={closePanel} style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono }}>✕ close</button>
              </div>

              {changePwOk ? (
                <div style={{ fontSize: 8, color: C.ok, textAlign: "center", padding: "8px 0" }}>
                  ✓ Password updated successfully.
                </div>
              ) : (
                <form onSubmit={handleChangePassword} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)}
                    placeholder="Current password" disabled={changePwLoading} style={inputStyle()} />
                  <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                    placeholder="New password (min 8 chars)" disabled={changePwLoading} style={inputStyle()} />
                  <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                    placeholder="Confirm new password" disabled={changePwLoading} style={inputStyle()} />
                  {changePwErr && <div style={{ fontSize: 7, color: C.danger }}>{changePwErr}</div>}
                  <button
                    type="submit"
                    disabled={!oldPw || !newPw || !confirmPw || changePwLoading}
                    style={{
                      padding: "8px 0", background: oldPw && newPw && confirmPw && !changePwLoading
                        ? `linear-gradient(90deg, ${C.accent}, #7BE9CF)` : `${C.accent}30`,
                      border: "none", borderRadius: 6,
                      color: oldPw && newPw && confirmPw && !changePwLoading ? "#04110E" : C.dim,
                      fontSize: 9, fontWeight: 700,
                      cursor: oldPw && newPw && confirmPw && !changePwLoading ? "pointer" : "not-allowed",
                      ...mono, letterSpacing: "0.08em",
                    }}
                  >{changePwLoading ? "RE-ENCRYPTING…" : "UPDATE PASSWORD"}</button>
                </form>
              )}
            </div>
          )}

          {/* ── RESET WALLET PANEL ────────────────────────────────────────── */}
          {panel === "reset" && (
            <div style={{ background: C.dLow, border: `1px solid ${C.danger}40`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 9, color: C.danger, fontWeight: 700, letterSpacing: "0.08em" }}>⚠ RESET WALLET</span>
                <button onClick={closePanel} style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono }}>✕ cancel</button>
              </div>
              <div style={{ fontSize: 7, color: C.dim, lineHeight: 1.5, marginBottom: 10 }}>
                This will permanently delete your encrypted vault from this extension.
                Your on-chain funds are NOT affected. You can re-import using your seed phrase.
                <strong style={{ color: C.warn }}> Make sure your seed phrase is backed up before proceeding.</strong>
              </div>
              <button
                onClick={handleReset}
                style={{
                  width: "100%", padding: "8px 0",
                  background: resetConfirm ? C.danger : C.dLow,
                  border: `1px solid ${C.danger}${resetConfirm ? "90" : "50"}`,
                  borderRadius: 6, color: resetConfirm ? "#fff" : C.danger,
                  fontSize: 9, fontWeight: 700, cursor: "pointer", ...mono, letterSpacing: "0.08em",
                }}
              >{resetConfirm ? "⚠ CONFIRM — PERMANENTLY DELETE VAULT" : "RESET WALLET"}</button>
              {resetConfirm && (
                <div style={{ fontSize: 7, color: C.danger, marginTop: 5, textAlign: "center" }}>
                  This cannot be undone. Your seed phrase is your only recovery option.
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Security notes */}
      <div style={{ background: "rgba(8,13,20,0.4)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
        <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.1em", marginBottom: 6 }}>SECURITY NOTES</div>
        {[
          "Seed phrase encrypted with AES-256-GCM before storage.",
          "Password derived with PBKDF2-SHA256 (600,000 iterations).",
          "Plaintext secrets never touch chrome.storage.",
          "All signing happens locally — nothing is transmitted to servers.",
        ].map((note, i, arr) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: i < arr.length - 1 ? 4 : 0 }}>
            <span style={{ color: C.ok, fontSize: 8, flexShrink: 0 }}>✓</span>
            <span style={{ fontSize: 7, color: C.dim, lineHeight: 1.5 }}>{note}</span>
          </div>
        ))}
      </div>

      {/* Lock wallet — shortcut (also in header) */}
      {isManagedWallet && panel === "none" && (
        <button
          onClick={onLock}
          style={{
            padding: "8px 0", background: "rgba(8,13,20,0.5)",
            border: `1px solid ${C.border}`, borderRadius: 8,
            color: C.dim, fontSize: 9, cursor: "pointer", ...mono, letterSpacing: "0.08em",
          }}
        >🔒 LOCK WALLET</button>
      )}
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────
function actionBtn(color: string): React.CSSProperties {
  return {
    padding: "9px 12px", background: "rgba(8,13,20,0.6)",
    border: `1px solid ${color}35`, borderRadius: 8,
    color, fontSize: 9, fontWeight: 700, cursor: "pointer",
    textAlign: "left" as const, letterSpacing: "0.08em",
    fontFamily: "'IBM Plex Mono','SFMono-Regular',Menlo,Monaco,monospace",
  };
}
