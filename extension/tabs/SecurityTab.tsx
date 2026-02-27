// SecurityTab — password-gated phrase reveal, change password, reset wallet.
// The mnemonic is NEVER passed as a prop; it is read from the in-memory
// session (unlockVault) only when the user explicitly authenticates here.

import { useEffect, useState } from "react";
import { C, mono } from "../../src/tokens";
import { shortAddr } from "../../src/helpers";
import { unlockVault, changePassword, resetWallet } from "../vault/vault";
import {
  getCustomKaspaRpc,
  getKaspaRpcProviderPreset,
  setCustomKaspaRpc,
  setKaspaRpcProviderPreset,
  type KaspaRpcProviderPreset,
} from "../shared/storage";
import {
  insetCard,
  monoInput,
  outlineButton,
  popupTabStack,
  primaryButton,
  sectionCard,
  sectionKicker,
  sectionTitle,
} from "../popup/surfaces";

interface Props {
  address: string | null;
  network: string;
  isManagedWallet: boolean;
  autoLockMinutes: number;
  persistUnlockSessionEnabled: boolean;
  onAutoLockMinutesChange: (minutes: number) => Promise<void> | void;
  onPersistUnlockSessionChange: (enabled: boolean) => Promise<void> | void;
  onLock: () => void;
}

type Panel = "none" | "reveal" | "change_pw" | "reset";

export function SecurityTab({
  address,
  network,
  isManagedWallet,
  autoLockMinutes,
  persistUnlockSessionEnabled,
  onAutoLockMinutesChange,
  onPersistUnlockSessionChange,
  onLock,
}: Props) {
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
  const [sessionPrefsLoading, setSessionPrefsLoading] = useState(false);
  const [rpcPreset, setRpcPreset] = useState<KaspaRpcProviderPreset>("official");
  const [customRpcInput, setCustomRpcInput] = useState("");
  const [customRpcLoading, setCustomRpcLoading] = useState(false);
  const [customRpcError, setCustomRpcError] = useState<string | null>(null);
  const [customRpcSaved, setCustomRpcSaved] = useState(false);

  const rpcPresetLabels: Record<KaspaRpcProviderPreset, string> = {
    official: "OFFICIAL",
    igra: "IGRA",
    kasplex: "KASPLEX",
    custom: "CUSTOM",
  };

  const provider = isManagedWallet ? "managed" : address ? "watch-only" : "none";
  const autoLockOptions: Array<{ label: string; value: number }> = [
    { label: "1m", value: 1 },
    { label: "15m", value: 15 },
    { label: "1h", value: 60 },
    { label: "4h", value: 240 },
    { label: "Never", value: -1 },
  ];

  useEffect(() => {
    let active = true;
    setCustomRpcLoading(true);
    setCustomRpcError(null);
    setCustomRpcSaved(false);

    Promise.all([getCustomKaspaRpc(network), getKaspaRpcProviderPreset(network)])
      .then(([value, preset]) => {
        if (!active) return;
        setCustomRpcInput(value ?? "");
        setRpcPreset(preset);
      })
      .catch(() => {
        if (!active) return;
        setCustomRpcError("Failed to load RPC settings.");
      })
      .finally(() => {
        if (active) setCustomRpcLoading(false);
      });

    return () => {
      active = false;
    };
  }, [network]);

  // ── Reveal seed phrase ───────────────────────────────────────────────────────
  const handleReveal = async (e: React.FormEvent) => {
    e.preventDefault();
    setRevealErr(null);
    setRevealLoading(true);
    try {
      // Re-authenticate with password to get fresh session + mnemonic
      const session = await unlockVault(revealPw, autoLockMinutes, {
        persistSession: persistUnlockSessionEnabled,
      });
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
    ...monoInput(hasError),
  });

  const closePanel = () => {
    setPanel("none");
    setRevealWords([]);
    setRevealPw(""); setRevealErr(null);
    setOldPw(""); setNewPw(""); setConfirmPw("");
    setChangePwErr(null); setChangePwOk(false);
    setResetConfirm(false);
  };

  const applyAutoLockMinutes = async (minutes: number) => {
    setSessionPrefsLoading(true);
    try {
      await onAutoLockMinutesChange(minutes);
    } finally {
      setSessionPrefsLoading(false);
    }
  };

  const togglePersistUnlockSession = async () => {
    setSessionPrefsLoading(true);
    try {
      await onPersistUnlockSessionChange(!persistUnlockSessionEnabled);
    } finally {
      setSessionPrefsLoading(false);
    }
  };

  const applyRpcPreset = async (preset: KaspaRpcProviderPreset) => {
    setCustomRpcLoading(true);
    setCustomRpcError(null);
    setCustomRpcSaved(false);
    try {
      await setKaspaRpcProviderPreset(network, preset);
      setRpcPreset(preset);
      setCustomRpcSaved(true);
    } catch {
      setCustomRpcError("Failed to save RPC provider preset.");
    } finally {
      setCustomRpcLoading(false);
    }
  };

  const saveCustomRpc = async () => {
    setCustomRpcLoading(true);
    setCustomRpcError(null);
    setCustomRpcSaved(false);
    try {
      await setCustomKaspaRpc(network, customRpcInput.trim() || null);
      await setKaspaRpcProviderPreset(network, "custom");
      setRpcPreset("custom");
      setCustomRpcSaved(true);
      if (!customRpcInput.trim()) setCustomRpcInput("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "INVALID_RPC_ENDPOINT") {
        setCustomRpcError("Invalid endpoint URL. Use http(s)://...");
      } else {
        setCustomRpcError("Failed to save custom RPC endpoint.");
      }
    } finally {
      setCustomRpcLoading(false);
    }
  };

  const clearCustomRpc = async () => {
    setCustomRpcLoading(true);
    setCustomRpcError(null);
    setCustomRpcSaved(false);
    try {
      await setCustomKaspaRpc(network, null);
      await setKaspaRpcProviderPreset(network, "official");
      setRpcPreset("official");
      setCustomRpcInput("");
      setCustomRpcSaved(true);
    } catch {
      setCustomRpcError("Failed to clear custom RPC endpoint.");
    } finally {
      setCustomRpcLoading(false);
    }
  };

  return (
    <div style={popupTabStack}>

      {/* Connection status */}
      <div style={sectionCard("default")}>
        <div style={{ ...sectionKicker, marginBottom: 8 }}>CONNECTION STATUS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={{ fontSize: 8, color: C.dim, marginBottom: 3 }}>PROVIDER</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: address ? C.ok : C.warn }} />
              <span style={{ fontSize: 9, color: C.text, fontWeight: 700 }}>{provider.toUpperCase()}</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: C.dim, marginBottom: 3 }}>NETWORK</div>
            <span style={{
              fontSize: 8, color: network === "mainnet" ? C.warn : C.ok, fontWeight: 700,
              background: network === "mainnet" ? `${C.warn}15` : `${C.ok}15`,
              border: `1px solid ${network === "mainnet" ? C.warn : C.ok}30`,
              borderRadius: 3, padding: "2px 6px",
            }}>{network.toUpperCase()}</span>
          </div>
          {address && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 8, color: C.dim, marginBottom: 3 }}>ADDRESS</div>
              <div style={{ ...insetCard(), fontSize: 8, color: C.text, padding: "7px 9px" }}>{shortAddr(address)}</div>
            </div>
          )}
        </div>
      </div>

      <div style={sectionCard("default")}>
        <div style={{ ...sectionKicker, marginBottom: 8 }}>KASPA RPC ENDPOINT</div>
        <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5, marginBottom: 7 }}>
          Active network: <span style={{ color: C.text, fontWeight: 700 }}>{network.toUpperCase()}</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {(Object.keys(rpcPresetLabels) as KaspaRpcProviderPreset[]).map((preset) => {
            const active = rpcPreset === preset;
            return (
              <button
                key={preset}
                onClick={() => { void applyRpcPreset(preset); }}
                disabled={customRpcLoading}
                style={{
                  ...outlineButton(active ? C.accent : C.dim, true),
                  padding: "6px 8px",
                  fontSize: 8,
                  color: active ? C.accent : C.dim,
                  opacity: customRpcLoading ? 0.7 : 1,
                }}
              >
                {rpcPresetLabels[preset]}
              </button>
            );
          })}
        </div>
        <input
          value={customRpcInput}
          onChange={(e) => {
            setCustomRpcInput(e.target.value);
            setCustomRpcSaved(false);
            setCustomRpcError(null);
          }}
          placeholder={network === "mainnet" ? "https://your-mainnet-kaspa-rpc.example" : "https://your-kaspa-rpc.example"}
          disabled={customRpcLoading || rpcPreset !== "custom"}
          style={{ ...inputStyle(Boolean(customRpcError)), marginBottom: 7 }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => { void saveCustomRpc(); }}
            disabled={customRpcLoading || rpcPreset !== "custom"}
            style={{
              ...outlineButton(C.accent, true),
              flex: 1,
              padding: "7px 8px",
              color: C.accent,
              opacity: customRpcLoading ? 0.7 : 1,
            }}
          >
            {customRpcLoading ? "SAVING…" : "SAVE RPC"}
          </button>
          <button
            onClick={() => { void clearCustomRpc(); }}
            disabled={customRpcLoading}
            style={{
              ...outlineButton(C.dim, true),
              flex: 1,
              padding: "7px 8px",
              color: C.dim,
              opacity: customRpcLoading ? 0.7 : 1,
            }}
          >
            CLEAR
          </button>
        </div>
        {customRpcError && (
          <div style={{ fontSize: 8, color: C.danger, marginTop: 6 }}>{customRpcError}</div>
        )}
        {!customRpcError && customRpcSaved && (
          <div style={{ fontSize: 8, color: C.ok, marginTop: 6 }}>Saved RPC settings for this network.</div>
        )}
        <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5, marginTop: 6 }}>
          Presets are stored per network. Igra/Kasplex pools read from env (`VITE_KASPA_IGRA_*` / `VITE_KASPA_KASPLEX_*`) and fall back to Official if unset.
        </div>
      </div>

      {isManagedWallet && (
        <div style={sectionCard("default")}>
          <div style={{ ...sectionKicker, marginBottom: 8 }}>SESSION SETTINGS</div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 8, color: C.dim, marginBottom: 5, letterSpacing: "0.08em" }}>AUTO-LOCK</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {autoLockOptions.map((opt) => (
                <button
                  key={opt.value}
                  disabled={sessionPrefsLoading}
                  onClick={() => { void applyAutoLockMinutes(opt.value); }}
                  style={{
                    ...outlineButton(autoLockMinutes === opt.value ? C.accent : C.dim, true),
                    padding: "6px 8px",
                    fontSize: 8,
                    color: autoLockMinutes === opt.value ? C.accent : C.dim,
                    opacity: sessionPrefsLoading ? 0.7 : 1,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => { void togglePersistUnlockSession(); }}
            disabled={sessionPrefsLoading}
            style={{
              ...outlineButton(persistUnlockSessionEnabled ? C.ok : C.dim, true),
              width: "100%",
              padding: "8px 10px",
              color: persistUnlockSessionEnabled ? C.ok : C.dim,
              textAlign: "left",
              opacity: sessionPrefsLoading ? 0.7 : 1,
            }}
          >
            {persistUnlockSessionEnabled ? "✓ KEEP UNLOCKED WHEN POPUP CLOSES" : "KEEP UNLOCKED WHEN POPUP CLOSES"}
          </button>
          <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5, marginTop: 6 }}>
            Stores an unlocked session only in browser session memory; lock manually on shared devices.
          </div>
        </div>
      )}

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
            <div style={{ ...sectionCard("warn") }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ ...sectionTitle, color: C.warn }}>SEED PHRASE</span>
                <button onClick={handleHidePhrase} style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono }}>✕ close</button>
              </div>

              {revealWords.length === 0 ? (
                <form onSubmit={handleReveal}>
                  <div style={{ fontSize: 8, color: C.dim, marginBottom: 6, lineHeight: 1.5 }}>
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
                  {revealErr && <div style={{ fontSize: 8, color: C.danger, marginBottom: 6 }}>{revealErr}</div>}
                  <button
                    type="submit"
                    disabled={!revealPw || revealLoading}
                    style={{
                      ...outlineButton(revealPw && !revealLoading ? C.warn : C.dim, true),
                      width: "100%",
                      padding: "7px 0",
                      color: revealPw && !revealLoading ? C.warn : C.dim,
                      cursor: revealPw && !revealLoading ? "pointer" : "not-allowed",
                    }}
                  >{revealLoading ? "AUTHENTICATING…" : "SHOW SEED PHRASE"}</button>
                </form>
              ) : (
                <>
                  <div style={{ ...insetCard(), display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 8 }}>
                    {revealWords.map((word, i) => (
                      <div key={i} style={{
                        background: "rgba(5,7,10,0.9)", border: `1px solid ${C.border}`,
                        borderRadius: 4, padding: "5px 4px",
                        display: "flex", alignItems: "center", gap: 3,
                      }}>
                        <span style={{ fontSize: 8, color: C.dim, flexShrink: 0 }}>{i + 1}.</span>
                        <span style={{ fontSize: 8, color: C.text, fontWeight: 600 }}>{word}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 8, color: C.warn, lineHeight: 1.4 }}>
                    ⚠ Store offline. Never photograph or share digitally.
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── CHANGE PASSWORD PANEL ─────────────────────────────────────── */}
          {panel === "change_pw" && (
            <div style={sectionCard("default")}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={sectionTitle}>CHANGE PASSWORD</span>
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
                  {changePwErr && <div style={{ fontSize: 8, color: C.danger }}>{changePwErr}</div>}
                  <button
                    type="submit"
                    disabled={!oldPw || !newPw || !confirmPw || changePwLoading}
                    style={{
                      ...primaryButton(oldPw && newPw && confirmPw && !changePwLoading),
                      padding: "8px 0",
                      cursor: oldPw && newPw && confirmPw && !changePwLoading ? "pointer" : "not-allowed",
                    }}
                  >{changePwLoading ? "RE-ENCRYPTING…" : "UPDATE PASSWORD"}</button>
                </form>
              )}
            </div>
          )}

          {/* ── RESET WALLET PANEL ────────────────────────────────────────── */}
          {panel === "reset" && (
            <div style={{ ...sectionCard("danger"), backgroundColor: C.dLow }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ ...sectionTitle, color: C.danger }}>⚠ RESET WALLET</span>
                <button onClick={closePanel} style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono }}>✕ cancel</button>
              </div>
              <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5, marginBottom: 10 }}>
                This will permanently delete your encrypted vault from this extension.
                Your on-chain funds are NOT affected. You can re-import using your seed phrase.
                <strong style={{ color: C.warn }}> Make sure your seed phrase is backed up before proceeding.</strong>
              </div>
              <button
                onClick={handleReset}
                style={{
                  ...outlineButton(C.danger, true),
                  width: "100%", padding: "8px 0",
                  background: resetConfirm ? C.danger : "rgba(49,21,32,0.65)",
                  border: `1px solid ${C.danger}${resetConfirm ? "90" : "50"}`,
                  color: resetConfirm ? "#fff" : C.danger,
                }}
              >{resetConfirm ? "⚠ CONFIRM — PERMANENTLY DELETE VAULT" : "RESET WALLET"}</button>
              {resetConfirm && (
                <div style={{ fontSize: 8, color: C.danger, marginTop: 5, textAlign: "center" }}>
                  This cannot be undone. Your seed phrase is your only recovery option.
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Security notes */}
      <div style={{ ...insetCard(), padding: "10px 12px" }}>
        <div style={{ ...sectionKicker, marginBottom: 6 }}>SECURITY NOTES</div>
        {[
          "Seed phrase encrypted with AES-256-GCM before storage.",
          "Password derived with PBKDF2-SHA256 (600,000 iterations).",
          "Plaintext secrets never touch chrome.storage.",
          "All signing happens locally — nothing is transmitted to servers.",
        ].map((note, i, arr) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: i < arr.length - 1 ? 4 : 0 }}>
            <span style={{ color: C.ok, fontSize: 8, flexShrink: 0 }}>✓</span>
            <span style={{ fontSize: 8, color: C.dim, lineHeight: 1.5 }}>{note}</span>
          </div>
        ))}
      </div>

      {/* Lock wallet — shortcut (also in header) */}
      {isManagedWallet && panel === "none" && (
        <button
          onClick={onLock}
          style={{
            ...outlineButton(C.dim, true),
            padding: "8px 0",
          }}
        >🔒 LOCK WALLET</button>
      )}
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────
function actionBtn(color: string): React.CSSProperties {
  return {
    ...outlineButton(color, true),
    padding: "10px 12px",
    color,
    textAlign: "left" as const, letterSpacing: "0.08em",
  };
}
