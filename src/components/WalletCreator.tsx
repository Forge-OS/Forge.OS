import { useState } from "react";
import { DEFAULT_NETWORK } from "../constants";
import { shortAddr } from "../helpers";
import { C, mono } from "../tokens";
import { Btn, Card, Divider } from "./ui";
import {
  generateWallet,
  importWallet,
  saveManagedWallet,
  type ManagedWalletData,
} from "../wallet/KaspaWalletManager";

type Step = "choose" | "backup" | "import" | "ready";

interface Props {
  onConnect: (session: any) => void;
  onClose: () => void;
}

export function WalletCreator({ onConnect, onClose }: Props) {
  const [step, setStep] = useState<Step>("choose");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [wallet, setWallet] = useState<ManagedWalletData | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [importPhrase, setImportPhrase] = useState("");
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setBusy(true);
    setErr("");
    try {
      const data = await generateWallet(DEFAULT_NETWORK);
      setWallet(data);
      setStep("backup");
    } catch (e: any) {
      setErr(e?.message || "Wallet generation failed.");
    }
    setBusy(false);
  };

  const handleImport = async () => {
    setBusy(true);
    setErr("");
    try {
      const data = await importWallet(importPhrase, DEFAULT_NETWORK);
      setWallet(data);
      setStep("ready");
    } catch (e: any) {
      setErr(e?.message || "Invalid seed phrase.");
    }
    setBusy(false);
  };

  const handleConnect = () => {
    if (!wallet) return;
    saveManagedWallet(wallet);
    onConnect({ address: wallet.address, network: wallet.network, provider: "managed" });
  };

  const copyAddress = async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const words = wallet?.phrase?.split(" ") ?? [];

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.88)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 20,
    }}>
      <Card p={28} style={{ maxWidth: 560, width: "100%", position: "relative" }}>
        {/* Close */}
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 14, right: 16, background: "none", border: "none", color: C.dim, fontSize: 18, cursor: "pointer", lineHeight: 1 }}
        >×</button>

        {/* ── CHOOSE ── */}
        {step === "choose" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, ...mono, marginBottom: 4 }}>Kaspa Wallet Setup</div>
              <div style={{ fontSize: 10, color: C.dim }}>Create a new wallet or import an existing one using your seed phrase.</div>
            </div>
            <Divider m={4} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button
                onClick={handleGenerate}
                disabled={busy}
                style={{
                  background: `linear-gradient(145deg, ${C.accent}18 0%, rgba(8,13,20,0.6) 100%)`,
                  border: `1px solid ${C.accent}40`,
                  borderRadius: 10, padding: "18px 14px",
                  cursor: busy ? "wait" : "pointer", textAlign: "left",
                  color: C.text, transition: "border-color 0.15s",
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 8 }}>✦</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, ...mono, marginBottom: 4 }}>GENERATE NEW</div>
                <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.5 }}>Create a fresh Kaspa wallet with a new 24-word seed phrase.</div>
              </button>
              <button
                onClick={() => setStep("import")}
                style={{
                  background: "linear-gradient(145deg, rgba(16,25,35,0.7) 0%, rgba(8,13,20,0.5) 100%)",
                  border: `1px solid rgba(33,48,67,0.7)`,
                  borderRadius: 10, padding: "18px 14px",
                  cursor: "pointer", textAlign: "left",
                  color: C.text, transition: "border-color 0.15s",
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 8 }}>↓</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.text, ...mono, marginBottom: 4 }}>IMPORT EXISTING</div>
                <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.5 }}>Paste your 12 or 24-word seed phrase to restore a wallet.</div>
              </button>
            </div>
            {busy && <div style={{ fontSize: 10, color: C.accent, ...mono, textAlign: "center" }}>Generating wallet…</div>}
            {err && <div style={{ fontSize: 10, color: C.danger, padding: "8px 12px", background: `${C.danger}12`, border: `1px solid ${C.danger}30`, borderRadius: 6 }}>{err}</div>}
          </div>
        )}

        {/* ── BACKUP (seed phrase) ── */}
        {step === "backup" && wallet && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, ...mono, marginBottom: 4 }}>Back Up Your Seed Phrase</div>
              <div style={{ fontSize: 10, color: C.dim }}>This is your wallet recovery key. Forge-OS cannot recover it for you.</div>
            </div>

            {/* Warning banner */}
            <div style={{ background: `${C.warn}12`, border: `1px solid ${C.warn}40`, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: C.warn, fontWeight: 700, ...mono, marginBottom: 3 }}>⚠ WRITE THESE WORDS DOWN OFFLINE</div>
              <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.5 }}>
                Anyone with this phrase can access your funds. Never share it. Store it somewhere safe and offline.
              </div>
            </div>

            {/* Mnemonic grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
              {words.map((word, i) => (
                <div key={i} style={{
                  background: "rgba(8,13,20,0.7)", border: `1px solid ${C.border}`,
                  borderRadius: 6, padding: "6px 8px",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  <span style={{ fontSize: 7, color: C.dim, ...mono, minWidth: 14 }}>{i + 1}.</span>
                  <span style={{ fontSize: 10, color: C.text, ...mono, fontWeight: 600 }}>{word}</span>
                </div>
              ))}
            </div>

            {/* Confirm checkbox */}
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
                style={{ marginTop: 2, accentColor: C.accent }}
              />
              <span style={{ fontSize: 10, color: C.dim, lineHeight: 1.5 }}>
                I have written down my seed phrase and understand Forge-OS cannot recover it.
              </span>
            </label>

            <Btn
              onClick={() => setStep("ready")}
              disabled={!confirmed}
              variant="primary"
              size="sm"
            >
              CONTINUE →
            </Btn>
          </div>
        )}

        {/* ── IMPORT ── */}
        {step === "import" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, ...mono, marginBottom: 4 }}>Import Seed Phrase</div>
              <div style={{ fontSize: 10, color: C.dim }}>Paste your 12 or 24-word Kaspa seed phrase to derive your address.</div>
            </div>
            <textarea
              value={importPhrase}
              onChange={e => { setImportPhrase(e.target.value); setErr(""); }}
              placeholder="word1 word2 word3 … word24"
              rows={4}
              style={{
                background: "rgba(8,13,20,0.8)", border: `1px solid ${C.border}`,
                borderRadius: 8, padding: "10px 12px",
                color: C.text, fontSize: 11, ...mono,
                resize: "vertical", lineHeight: 1.6, outline: "none",
                width: "100%", boxSizing: "border-box",
              }}
            />
            {/* word count indicator */}
            {importPhrase.trim() && (
              <div style={{ fontSize: 9, color: (() => { const n = importPhrase.trim().split(/\s+/).length; return n === 12 || n === 24 ? C.ok : C.warn; })(), ...mono }}>
                {importPhrase.trim().split(/\s+/).length} words {(() => { const n = importPhrase.trim().split(/\s+/).length; return n === 12 || n === 24 ? "✓" : "(need 12 or 24)"; })()}
              </div>
            )}
            {err && <div style={{ fontSize: 10, color: C.danger, padding: "8px 12px", background: `${C.danger}12`, border: `1px solid ${C.danger}30`, borderRadius: 6 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={() => setStep("choose")} variant="ghost" size="sm" style={{ flex: 1 }}>← BACK</Btn>
              <Btn
                onClick={handleImport}
                disabled={busy || !(importPhrase.trim().split(/\s+/).length === 12 || importPhrase.trim().split(/\s+/).length === 24)}
                variant="primary"
                size="sm"
                style={{ flex: 2 }}
              >
                {busy ? "IMPORTING…" : "IMPORT WALLET →"}
              </Btn>
            </div>
          </div>
        )}

        {/* ── READY (deposit address) ── */}
        {step === "ready" && wallet && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, ...mono, marginBottom: 4 }}>✓ Wallet Ready</div>
              <div style={{ fontSize: 10, color: C.dim }}>Your Kaspa address is ready. Send KAS here to fund your agent.</div>
            </div>

            {/* Address block */}
            <div style={{ background: "rgba(8,13,20,0.8)", border: `1px solid ${C.accent}30`, borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 8, color: C.dim, ...mono, letterSpacing: "0.1em", marginBottom: 6 }}>DEPOSIT ADDRESS · KASPA {wallet.network.toUpperCase()}</div>
              <div style={{ fontSize: 10, color: C.text, ...mono, wordBreak: "break-all", lineHeight: 1.6, marginBottom: 10 }}>
                {wallet.address}
              </div>
              <button
                onClick={copyAddress}
                style={{
                  background: copied ? `${C.ok}20` : "rgba(33,48,67,0.5)",
                  border: `1px solid ${copied ? C.ok : C.border}`,
                  borderRadius: 6, padding: "5px 14px",
                  color: copied ? C.ok : C.dim, fontSize: 10, cursor: "pointer",
                  ...mono, transition: "all 0.15s",
                }}
              >
                {copied ? "✓ COPIED" : "COPY ADDRESS"}
              </button>
            </div>

            {/* Deposit instructions */}
            <div style={{ background: `${C.purple}0D`, border: `1px solid ${C.purple}28`, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 9, color: C.purple, fontWeight: 700, ...mono, marginBottom: 4 }}>HOW TO DEPOSIT</div>
              <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.6 }}>
                1. Copy the address above.<br />
                2. Open Kasware, Kastle, Kaspium, or any Kaspa wallet.<br />
                3. Send KAS to this address.<br />
                4. Connect below — your balance will appear once confirmed.
              </div>
            </div>

            {/* Show address short in a badge row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 9, color: C.dim, ...mono }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.ok, flexShrink: 0 }} />
              {shortAddr(wallet.address)} · {wallet.network}
            </div>

            <Btn onClick={handleConnect} variant="primary" size="sm">CONNECT WALLET →</Btn>

            <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5 }}>
              This wallet connects in read-only mode. To sign transactions, import your seed phrase into Kasware or Kastle.
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
