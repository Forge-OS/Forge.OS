// First-run wallet setup screen.
// Supports three flows: Create New, Import Existing, Use External Wallet.
// Mnemonic is only ever held in React state during the setup flow and
// immediately discarded after vault creation.

import { useState, useRef } from "react";
import { C, mono } from "../../../src/tokens";
import { generateWallet, importWallet } from "../../../src/wallet/KaspaWalletManager";
import { createVault, unlockVault } from "../../vault/vault";
import { setWalletMeta } from "../../shared/storage";
import type { UnlockedSession } from "../../vault/types";

type Step =
  | "choose"           // Entry: pick Create / Import / External
  | "create_view"      // Show the generated 24 words
  | "create_confirm"   // Confirm backup checkbox
  | "create_password"  // Set password
  | "import_phrase"    // Enter existing phrase
  | "import_password"  // Set password for import
  | "working";         // Encrypting / deriving

interface Props {
  network: string;
  onComplete: (session: UnlockedSession) => void;
}

// Shared password form used by both create and import flows
function PasswordForm({
  onSubmit,
  loading,
  submitLabel,
}: {
  onSubmit: (password: string) => void;
  loading: boolean;
  submitLabel: string;
}) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (pw !== confirm) { setErr("Passwords do not match."); return; }
    onSubmit(pw);
  };

  const inputStyle = {
    width: "100%", boxSizing: "border-box" as const,
    background: "rgba(8,13,20,0.7)", border: `1px solid ${C.border}`,
    borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 11,
    ...mono, outline: "none", marginBottom: 8,
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ fontSize: 7, color: C.dim, letterSpacing: "0.1em", marginBottom: 6 }}>
        CREATE PASSWORD
      </div>
      <input
        type="password"
        placeholder="Password (min 8 characters)"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        disabled={loading}
        style={inputStyle}
      />
      <input
        type="password"
        placeholder="Confirm password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        disabled={loading}
        style={{ ...inputStyle, marginBottom: 0 }}
      />
      {err && (
        <div style={{ fontSize: 8, color: C.danger, marginTop: 6 }}>{err}</div>
      )}
      <button
        type="submit"
        disabled={!pw || !confirm || loading}
        style={{
          width: "100%", marginTop: 12, padding: "10px 0",
          background: pw && confirm && !loading
            ? `linear-gradient(90deg, ${C.accent}, #7BE9CF)`
            : `${C.accent}30`,
          border: "none", borderRadius: 8,
          color: pw && confirm && !loading ? "#04110E" : C.dim,
          fontSize: 10, fontWeight: 700,
          cursor: pw && confirm && !loading ? "pointer" : "not-allowed",
          letterSpacing: "0.1em", ...mono,
        }}
      >
        {loading ? "ENCRYPTING…" : submitLabel}
      </button>
    </form>
  );
}

export function FirstRunScreen({ network, onComplete }: Props) {
  const [step, setStep] = useState<Step>("choose");
  const [generatedMnemonic, setGeneratedMnemonic] = useState("");
  const [generatedAddress, setGeneratedAddress] = useState("");
  const [importPhrase, setImportPhrase] = useState("");
  const [importAddress, setImportAddress] = useState("");
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Create flow ─────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      const wallet = await generateWallet(network);
      setGeneratedMnemonic(wallet.phrase);
      setGeneratedAddress(wallet.address);
      setStep("create_view");
    } catch (e) {
      setError("Failed to generate wallet. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePassword = async (password: string) => {
    setLoading(true);
    setError(null);
    try {
      await createVault(generatedMnemonic, password, generatedAddress, network);
      await setWalletMeta({ address: generatedAddress, network });
      const session = await unlockVault(password);
      // Clear sensitive data from React state before handing off
      setGeneratedMnemonic("");
      onComplete(session);
    } catch {
      setError("Failed to encrypt vault. Please try again.");
      setLoading(false);
    }
  };

  // ── Import flow ─────────────────────────────────────────────────────────────

  const handleImportValidate = async () => {
    setLoading(true);
    setError(null);
    try {
      const wallet = await importWallet(importPhrase, network);
      setImportAddress(wallet.address);
      setStep("import_password");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("24") || msg.includes("12") || msg.includes("checksum")
        ? "Invalid seed phrase. Check word count and spelling."
        : "Failed to validate phrase.");
    } finally {
      setLoading(false);
    }
  };

  const handleImportPassword = async (password: string) => {
    setLoading(true);
    setError(null);
    try {
      const normalised = importPhrase.trim().toLowerCase().split(/\s+/).join(" ");
      await createVault(normalised, password, importAddress, network);
      await setWalletMeta({ address: importAddress, network });
      const session = await unlockVault(password);
      setImportPhrase("");
      onComplete(session);
    } catch {
      setError("Failed to encrypt vault. Please try again.");
      setLoading(false);
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────────

  const words = generatedMnemonic.split(" ");

  const Section = ({ children }: { children: React.ReactNode }) => (
    <div style={{
      width: 360, minHeight: 560, background: C.bg, display: "flex",
      flexDirection: "column", padding: "20px 20px 16px", ...mono, overflowY: "auto",
    }}>
      {children}
    </div>
  );

  const Header = ({ title, sub, onBack }: { title: string; sub?: string; onBack?: () => void }) => (
    <div style={{ marginBottom: 18 }}>
      {onBack && (
        <button
          onClick={onBack}
          style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono, marginBottom: 8, padding: 0 }}
        >← back</button>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img src="../icons/icon48.png" alt="" style={{ width: 20, height: 20, objectFit: "contain", filter: "drop-shadow(0 0 6px rgba(57,221,182,0.5))" }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em" }}>
          <span style={{ color: C.accent }}>FORGE</span><span style={{ color: C.text }}>-OS</span>
        </span>
      </div>
      <div style={{ fontSize: 11, color: C.text, fontWeight: 700, letterSpacing: "0.06em", marginTop: 10 }}>{title}</div>
      {sub && <div style={{ fontSize: 8, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  );

  // ── CHOOSE ──────────────────────────────────────────────────────────────────
  if (step === "choose") {
    return (
      <Section>
        <Header title="SET UP YOUR WALLET" sub="This wallet is non-custodial. Your keys never leave your device." />

        {error && <div style={{ fontSize: 8, color: C.danger, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={handleCreate}
            disabled={loading}
            style={{
              padding: "14px 16px", textAlign: "left",
              background: `linear-gradient(145deg, ${C.accent}18, rgba(8,13,20,0.6))`,
              border: `1px solid ${C.accent}35`, borderRadius: 10,
              color: C.text, cursor: "pointer", ...mono,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: C.accent, marginBottom: 4 }}>
              {loading ? "GENERATING…" : "+ CREATE NEW WALLET"}
            </div>
            <div style={{ fontSize: 7, color: C.dim, lineHeight: 1.4 }}>
              Generate a new 24-word seed phrase and encrypt it with your password.
            </div>
          </button>

          <button
            onClick={() => setStep("import_phrase")}
            style={{
              padding: "14px 16px", textAlign: "left",
              background: "rgba(8,13,20,0.6)", border: `1px solid ${C.border}`,
              borderRadius: 10, color: C.text, cursor: "pointer", ...mono,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4 }}>↓ IMPORT EXISTING WALLET</div>
            <div style={{ fontSize: 7, color: C.dim, lineHeight: 1.4 }}>
              Enter your 12 or 24-word seed phrase to restore your wallet.
            </div>
          </button>

          <button
            onClick={() => chrome.tabs.create({ url: "https://forgeos.xyz" })}
            style={{
              padding: "14px 16px", textAlign: "left",
              background: "rgba(8,13,20,0.4)", border: `1px solid ${C.border}`,
              borderRadius: 10, color: C.text, cursor: "pointer", ...mono,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4 }}>⇗ USE EXTERNAL WALLET</div>
            <div style={{ fontSize: 7, color: C.dim, lineHeight: 1.4 }}>
              Connect Kasware, Kastle, or Kaspium on Forge-OS.
            </div>
          </button>
        </div>
      </Section>
    );
  }

  // ── CREATE: VIEW PHRASE ─────────────────────────────────────────────────────
  if (step === "create_view") {
    return (
      <Section>
        <Header
          title="YOUR SEED PHRASE"
          sub="Write these 24 words down in order and store them offline. Anyone with this phrase controls your wallet."
          onBack={() => { setStep("choose"); setGeneratedMnemonic(""); setGeneratedAddress(""); }}
        />

        <div style={{ background: C.wLow, border: `1px solid ${C.warn}40`, borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
          <div style={{ fontSize: 7, color: C.warn, fontWeight: 700 }}>
            ⚠ NEVER share this phrase with anyone. Forge-OS will never ask for it.
          </div>
        </div>

        {/* 4-column word grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 14 }}>
          {words.map((word, i) => (
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

        {/* Backup confirmation */}
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={backupConfirmed}
            onChange={(e) => setBackupConfirmed(e.target.checked)}
            style={{ marginTop: 2, accentColor: C.accent, flexShrink: 0 }}
          />
          <span style={{ fontSize: 8, color: C.dim, lineHeight: 1.5 }}>
            I have written down my 24-word seed phrase and stored it securely offline.
          </span>
        </label>

        <button
          onClick={() => setStep("create_password")}
          disabled={!backupConfirmed}
          style={{
            width: "100%", padding: "10px 0",
            background: backupConfirmed ? `linear-gradient(90deg, ${C.accent}, #7BE9CF)` : `${C.accent}30`,
            border: "none", borderRadius: 8,
            color: backupConfirmed ? "#04110E" : C.dim,
            fontSize: 10, fontWeight: 700,
            cursor: backupConfirmed ? "pointer" : "not-allowed",
            letterSpacing: "0.1em", ...mono,
          }}
        >
          I'VE SAVED MY PHRASE →
        </button>
      </Section>
    );
  }

  // ── CREATE: SET PASSWORD ────────────────────────────────────────────────────
  if (step === "create_password") {
    return (
      <Section>
        <Header
          title="ENCRYPT YOUR WALLET"
          sub="Your seed phrase will be encrypted with this password using AES-256-GCM. You'll need it to unlock the wallet."
          onBack={() => setStep("create_view")}
        />
        {error && <div style={{ fontSize: 8, color: C.danger, marginBottom: 10 }}>{error}</div>}
        <PasswordForm onSubmit={handleCreatePassword} loading={loading} submitLabel="CREATE WALLET" />
      </Section>
    );
  }

  // ── IMPORT: ENTER PHRASE ────────────────────────────────────────────────────
  if (step === "import_phrase") {
    return (
      <Section>
        <Header
          title="IMPORT SEED PHRASE"
          sub="Enter your 12 or 24-word BIP39 seed phrase. It will be validated and encrypted immediately."
          onBack={() => setStep("choose")}
        />
        {error && <div style={{ fontSize: 8, color: C.danger, marginBottom: 10 }}>{error}</div>}

        <div style={{ fontSize: 7, color: C.dim, letterSpacing: "0.1em", marginBottom: 6 }}>
          SEED PHRASE
        </div>
        <textarea
          value={importPhrase}
          onChange={(e) => setImportPhrase(e.target.value)}
          placeholder="word1 word2 word3 … (space-separated)"
          rows={4}
          style={{
            width: "100%", boxSizing: "border-box",
            background: "rgba(8,13,20,0.7)", border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "10px 12px", color: C.text, fontSize: 10,
            resize: "vertical", ...mono, outline: "none", marginBottom: 10,
          }}
        />

        <button
          onClick={handleImportValidate}
          disabled={!importPhrase.trim() || loading}
          style={{
            width: "100%", padding: "10px 0",
            background: importPhrase.trim() && !loading
              ? `linear-gradient(90deg, ${C.accent}, #7BE9CF)`
              : `${C.accent}30`,
            border: "none", borderRadius: 8,
            color: importPhrase.trim() && !loading ? "#04110E" : C.dim,
            fontSize: 10, fontWeight: 700,
            cursor: importPhrase.trim() && !loading ? "pointer" : "not-allowed",
            letterSpacing: "0.1em", ...mono,
          }}
        >
          {loading ? "VALIDATING…" : "VALIDATE PHRASE →"}
        </button>
      </Section>
    );
  }

  // ── IMPORT: SET PASSWORD ────────────────────────────────────────────────────
  if (step === "import_password") {
    return (
      <Section>
        <Header
          title="ENCRYPT YOUR WALLET"
          sub="Your imported phrase will be encrypted with this password. Make it strong."
          onBack={() => setStep("import_phrase")}
        />
        {error && <div style={{ fontSize: 8, color: C.danger, marginBottom: 10 }}>{error}</div>}
        <PasswordForm onSubmit={handleImportPassword} loading={loading} submitLabel="IMPORT WALLET" />
      </Section>
    );
  }

  // ── WORKING ─────────────────────────────────────────────────────────────────
  return (
    <Section>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: C.accent, marginBottom: 8 }}>ENCRYPTING VAULT…</div>
          <div style={{ fontSize: 8, color: C.dim }}>Deriving key (this may take a moment)</div>
        </div>
      </div>
    </Section>
  );
}
