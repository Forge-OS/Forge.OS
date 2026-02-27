// First-run wallet setup screen.
// Two flows only: Create New, Import Existing.
// External wallet option removed — use forge-os.xyz for third-party wallet connection.

import { useState } from "react";
import { C, mono } from "../../../src/tokens";
import {
  discoverWalletImportCandidates,
  generateWallet,
  importWallet,
  type ManagedWalletImportCandidate,
} from "../../../src/wallet/KaspaWalletManager";
import {
  COMMON_KASPA_IMPORT_BASE_PATHS,
  DEFAULT_KASPA_DERIVATION,
  formatKaspaDerivationPath,
  normalizeKaspaDerivation,
  parseKaspaDerivationPath,
  type KaspaDerivationMeta,
} from "../../../src/wallet/derivation";
import {
  loadRememberedImportCandidates,
  rememberImportCandidates,
  rememberSelectedImportCandidate,
} from "../../shared/importAddressBook";
import { createVault, unlockVault } from "../../vault/vault";
import { setWalletMeta } from "../../shared/storage";
import type { UnlockedSession } from "../../vault/types";
import { EXTENSION_POPUP_BASE_MIN_HEIGHT, EXTENSION_POPUP_BASE_WIDTH, EXTENSION_POPUP_UI_SCALE } from "../layout";
import { popupShellBackground } from "../surfaces";

const W = EXTENSION_POPUP_BASE_WIDTH;

type Step =
  | "choose"
  | "create_view"
  | "create_password"
  | "import_phrase"
  | "import_discover"
  | "import_password"
  | "working";

interface Props {
  network: string;
  onComplete: (session: UnlockedSession) => void;
}

const DEFAULT_SCAN_ACCOUNT_RANGE: [number, number] = [0, 4];
const DEFAULT_SCAN_INDEX_RANGE: [number, number] = [0, 9];
const DEFAULT_SCAN_LIMIT = 80;
const MAX_SCAN_LIMIT = 320;
const DEFAULT_SCAN_BASE_PATHS_TEXT = [...COMMON_KASPA_IMPORT_BASE_PATHS].join("\n");

function toCandidateKey(candidate: Pick<ManagedWalletImportCandidate, "address" | "derivationPath">): string {
  return `${candidate.address.toLowerCase()}|${candidate.derivationPath}`;
}

function parseNonNegativeInt(value: string, fallback: number): number {
  const parsed = Number(String(value || "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function parseScanRange(startRaw: string, endRaw: string, fallback: [number, number]): [number, number] {
  const start = parseNonNegativeInt(startRaw, fallback[0]);
  const end = parseNonNegativeInt(endRaw, fallback[1]);
  return [Math.min(start, end), Math.max(start, end)];
}

function parseScanLimit(raw: string): number {
  const parsed = parseNonNegativeInt(raw, DEFAULT_SCAN_LIMIT);
  return Math.max(1, Math.min(MAX_SCAN_LIMIT, parsed || DEFAULT_SCAN_LIMIT));
}

function parseBasePaths(raw: string): string[] {
  const parsed = String(raw || "")
    .split(/[,\n]+/)
    .map((v) => v.trim())
    .filter(Boolean);
  return parsed.length ? parsed : [...COMMON_KASPA_IMPORT_BASE_PATHS];
}

// ── Shared password form ──────────────────────────────────────────────────────
function PasswordForm({
  onSubmit, loading, submitLabel,
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

  const inp = (hasErr = false): React.CSSProperties => ({
    width: "100%", boxSizing: "border-box" as const,
    background: "rgba(8,13,20,0.8)", border: `1px solid ${hasErr ? C.danger : C.border}`,
    borderRadius: 8, padding: "10px 12px", color: C.text, fontSize: 11,
    ...mono, outline: "none", marginBottom: 8,
  });

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.1em", marginBottom: 8 }}>CREATE PASSWORD</div>
      <input type="password" placeholder="Password (min 8 characters)" value={pw}
        onChange={e => setPw(e.target.value)} disabled={loading} style={inp()} />
      <input type="password" placeholder="Confirm password" value={confirm}
        onChange={e => setConfirm(e.target.value)} disabled={loading}
        style={{ ...inp(), marginBottom: 0 }} />
      {err && <div style={{ fontSize: 8, color: C.danger, marginTop: 6 }}>{err}</div>}
      <button type="submit" disabled={!pw || !confirm || loading} style={{
        width: "100%", marginTop: 12, padding: "11px 0",
        background: pw && confirm && !loading
          ? `linear-gradient(90deg, ${C.accent}, #7BE9CF)` : `${C.accent}25`,
        border: "none", borderRadius: 8,
        color: pw && confirm && !loading ? "#04110E" : C.dim,
        fontSize: 10, fontWeight: 700,
        cursor: pw && confirm && !loading ? "pointer" : "not-allowed",
        letterSpacing: "0.1em", ...mono,
      }}>
        {loading ? "ENCRYPTING…" : submitLabel}
      </button>
    </form>
  );
}

// ── Shared section wrapper ────────────────────────────────────────────────────
function Section({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: W, minHeight: EXTENSION_POPUP_BASE_MIN_HEIGHT, ...popupShellBackground(), display: "flex",
      flexDirection: "column", padding: "22px 22px 18px", ...mono,
      overflowX: "hidden", overflowY: "auto", position: "relative",
      zoom: EXTENSION_POPUP_UI_SCALE,
    }}>
      {/* Atmospheric glow */}
      <div style={{ position: "absolute", top: -80, right: -50, width: 240, height: 240, background: `radial-gradient(ellipse, ${C.accent}14 0%, transparent 70%)`, borderRadius: "50%", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: -60, left: -50, width: 180, height: 180, background: "radial-gradient(ellipse, rgba(57,221,182,0.10) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

// ── Shared header ─────────────────────────────────────────────────────────────
function Header({ title, sub, onBack }: { title: string; sub?: string; onBack?: () => void }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {onBack && (
        <button onClick={onBack} style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono, marginBottom: 10, padding: 0 }}>← back</button>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <img src="../icons/icon48.png" alt="" style={{ width: 30, height: 30, objectFit: "contain", filter: "drop-shadow(0 0 10px rgba(57,221,182,0.65))" }} />
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.11em" }}>
          <span style={{ color: C.accent }}>FORGE</span><span style={{ color: C.text }}>-OS</span>
        </span>
      </div>
      <div style={{ fontSize: 13, color: C.text, fontWeight: 700, letterSpacing: "0.05em" }}>{title}</div>
      {sub && <div style={{ fontSize: 8, color: C.dim, marginTop: 5, lineHeight: 1.6 }}>{sub}</div>}
    </div>
  );
}

export function FirstRunScreen({ network: _defaultNetwork, onComplete }: Props) {
  const [step, setStep] = useState<Step>("choose");
  const selectedNetwork = "mainnet";
  const [generatedMnemonic, setGeneratedMnemonic] = useState("");
  const [generatedAddress, setGeneratedAddress] = useState("");
  const [generatedDerivation, setGeneratedDerivation] = useState<KaspaDerivationMeta>(DEFAULT_KASPA_DERIVATION);
  const [importPhrase, setImportPhrase] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [importAddress, setImportAddress] = useState("");
  const [importDerivation, setImportDerivation] = useState<KaspaDerivationMeta>(DEFAULT_KASPA_DERIVATION);
  const [importCandidates, setImportCandidates] = useState<ManagedWalletImportCandidate[]>([]);
  const [rememberedKeys, setRememberedKeys] = useState<string[]>([]);
  const [scanBasePathsText, setScanBasePathsText] = useState(DEFAULT_SCAN_BASE_PATHS_TEXT);
  const [scanAccountStart, setScanAccountStart] = useState(String(DEFAULT_SCAN_ACCOUNT_RANGE[0]));
  const [scanAccountEnd, setScanAccountEnd] = useState(String(DEFAULT_SCAN_ACCOUNT_RANGE[1]));
  const [scanIndexStart, setScanIndexStart] = useState(String(DEFAULT_SCAN_INDEX_RANGE[0]));
  const [scanIndexEnd, setScanIndexEnd] = useState(String(DEFAULT_SCAN_INDEX_RANGE[1]));
  const [scanIncludeReceive, setScanIncludeReceive] = useState(true);
  const [scanIncludeChange, setScanIncludeChange] = useState(true);
  const [scanLimit, setScanLimit] = useState(String(DEFAULT_SCAN_LIMIT));
  const [manualDerivationPath, setManualDerivationPath] = useState(
    formatKaspaDerivationPath(DEFAULT_KASPA_DERIVATION),
  );
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mergeCandidates = (
    primary: ManagedWalletImportCandidate[],
    secondary: ManagedWalletImportCandidate[],
  ): ManagedWalletImportCandidate[] => {
    const map = new Map<string, ManagedWalletImportCandidate>();
    for (const candidate of [...primary, ...secondary]) {
      const key = toCandidateKey(candidate);
      if (map.has(key)) continue;
      map.set(key, candidate);
    }
    return [...map.values()];
  };

  const currentScanChains = (): Array<0 | 1> => {
    const chains: Array<0 | 1> = [];
    if (scanIncludeReceive) chains.push(0);
    if (scanIncludeChange) chains.push(1);
    return chains.length ? chains : [0];
  };

  const loadRememberedCandidates = async (): Promise<ManagedWalletImportCandidate[]> => {
    const remembered = await loadRememberedImportCandidates(
      importPhrase,
      importPassphrase || undefined,
      selectedNetwork,
    );
    setRememberedKeys(remembered.map((candidate) => toCandidateKey(candidate)));
    return remembered;
  };

  const handleLoadRemembered = async () => {
    setLoading(true);
    setError(null);
    try {
      const remembered = await loadRememberedCandidates();
      if (!remembered.length) {
        throw new Error("No remembered candidates found for this phrase/passphrase.");
      }
      setImportCandidates(remembered);
      const first = remembered[0];
      setImportAddress(first.address);
      setImportDerivation(first.derivation);
      setManualDerivationPath(first.derivationPath);
      setStep("import_discover");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to load remembered candidates.");
    } finally {
      setLoading(false);
    }
  };

  const handleManualPathValidate = async () => {
    setLoading(true);
    setError(null);
    try {
      const parsedDerivation = parseKaspaDerivationPath(manualDerivationPath);
      const wallet = await importWallet(importPhrase, selectedNetwork, {
        mnemonicPassphrase: importPassphrase || undefined,
        derivation: parsedDerivation,
      });
      const candidate: ManagedWalletImportCandidate = {
        address: wallet.address,
        derivation: normalizeKaspaDerivation(wallet.derivation ?? parsedDerivation),
        derivationPath: formatKaspaDerivationPath(wallet.derivation ?? parsedDerivation),
        chainLabel: wallet.derivation?.chain === 1 ? "change" : "receive",
      };
      setImportAddress(candidate.address);
      setImportDerivation(candidate.derivation);
      setImportCandidates((prev) => mergeCandidates([candidate], prev));
      await rememberImportCandidates(
        importPhrase,
        importPassphrase || undefined,
        selectedNetwork,
        [candidate],
      );
      setRememberedKeys((prev) => {
        const next = new Set(prev);
        next.add(toCandidateKey(candidate));
        return [...next];
      });
      setStep("import_password");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to validate derivation path.");
    } finally {
      setLoading(false);
    }
  };

  // ── Create flow ─────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      const wallet = await generateWallet(selectedNetwork);
      setGeneratedMnemonic(wallet.phrase);
      setGeneratedAddress(wallet.address);
      setGeneratedDerivation(normalizeKaspaDerivation(wallet.derivation ?? DEFAULT_KASPA_DERIVATION));
      setStep("create_view");
    } catch {
      setError("Failed to generate wallet. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePassword = async (password: string) => {
    setLoading(true);
    setError(null);
    try {
      await createVault(generatedMnemonic, password, generatedAddress, selectedNetwork, {
        derivation: generatedDerivation,
      });
      await setWalletMeta({ address: generatedAddress, network: selectedNetwork });
      const session = await unlockVault(password);
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
      const wallet = await importWallet(importPhrase, selectedNetwork, {
        mnemonicPassphrase: importPassphrase || undefined,
      });
      const derivation = normalizeKaspaDerivation(wallet.derivation ?? DEFAULT_KASPA_DERIVATION);
      const candidate: ManagedWalletImportCandidate = {
        address: wallet.address,
        derivation,
        derivationPath: formatKaspaDerivationPath(derivation),
        chainLabel: derivation.chain === 1 ? "change" : "receive",
      };
      setImportAddress(wallet.address);
      setImportDerivation(derivation);
      setImportCandidates([candidate]);
      setManualDerivationPath(candidate.derivationPath);
      setStep("import_password");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.toLowerCase().includes("bip39") || msg.toLowerCase().includes("checksum")
        ? "Invalid BIP39 phrase. Check word count, spelling, and passphrase."
        : "Failed to validate phrase.");
    } finally {
      setLoading(false);
    }
  };

  const handleImportDiscover = async () => {
    setLoading(true);
    setError(null);
    let remembered: ManagedWalletImportCandidate[] = [];
    let scanned: ManagedWalletImportCandidate[] = [];
    let scanErrorMessage = "";
    try {
      try {
        remembered = await loadRememberedCandidates();
      } catch {
        remembered = [];
      }

      const accountRange = parseScanRange(
        scanAccountStart,
        scanAccountEnd,
        DEFAULT_SCAN_ACCOUNT_RANGE,
      );
      const indexRange = parseScanRange(
        scanIndexStart,
        scanIndexEnd,
        DEFAULT_SCAN_INDEX_RANGE,
      );
      const chains = currentScanChains();
      const basePaths = parseBasePaths(scanBasePathsText);
      const limit = parseScanLimit(scanLimit);

      try {
        scanned = await discoverWalletImportCandidates(importPhrase, selectedNetwork, {
          mnemonicPassphrase: importPassphrase || undefined,
          basePaths,
          accountRange,
          indexRange,
          chains,
          limit,
        });
      } catch (e) {
        scanErrorMessage = e instanceof Error ? e.message : String(e);
      }

      const merged = mergeCandidates(scanned, remembered);
      if (!merged.length) {
        throw new Error(scanErrorMessage || "No derivation candidates found for the configured scan window.");
      }

      if (scanned.length) {
        await rememberImportCandidates(
          importPhrase,
          importPassphrase || undefined,
          selectedNetwork,
          scanned,
        );
      }

      if (scanErrorMessage && remembered.length) {
        setError(`${scanErrorMessage} Showing remembered candidates only.`);
      }

      setImportCandidates(merged);
      setRememberedKeys(merged.map((candidate) => toCandidateKey(candidate)));
      const first = merged[0];
      if (!importAddress) {
        setImportAddress(first.address);
        setImportDerivation(first.derivation);
      }
      setManualDerivationPath(first.derivationPath);
      setStep("import_discover");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to scan import paths.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectImportCandidate = (candidate: ManagedWalletImportCandidate) => {
    setImportAddress(candidate.address);
    setImportDerivation(normalizeKaspaDerivation(candidate.derivation));
    setManualDerivationPath(candidate.derivationPath);
    setStep("import_password");
  };

  const handleImportPassword = async (password: string) => {
    setLoading(true);
    setError(null);
    try {
      const normalised = importPhrase.trim().toLowerCase().split(/\s+/).join(" ");
      await createVault(normalised, password, importAddress, selectedNetwork, {
        mnemonicPassphrase: importPassphrase || undefined,
        derivation: importDerivation,
      });
      await setWalletMeta({ address: importAddress, network: selectedNetwork });
      try {
        await rememberSelectedImportCandidate(
          normalised,
          importPassphrase || undefined,
          selectedNetwork,
          {
            address: importAddress,
            derivation: importDerivation,
            derivationPath: formatKaspaDerivationPath(importDerivation),
            chainLabel: importDerivation.chain === 1 ? "change" : "receive",
          },
        );
      } catch {
        // Do not block unlock flow on metadata persistence failures.
      }
      const session = await unlockVault(password);
      setImportPhrase("");
      setImportPassphrase("");
      setImportCandidates([]);
      setRememberedKeys([]);
      onComplete(session);
    } catch {
      setError("Failed to encrypt vault. Please try again.");
      setLoading(false);
    }
  };

  const words = generatedMnemonic.split(" ");

  // ── CHOOSE ──────────────────────────────────────────────────────────────────
  if (step === "choose") {
    return (
      <Section>
        <Header
          title="SET UP YOUR WALLET"
          sub="Non-custodial · Your keys never leave your device"
        />

        {/* Protocol feature badges */}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" as const, marginBottom: 14 }}>
          {["KASPA L1 · L2", "NON-CUSTODIAL", "BIP44"].map(badge => (
            <span key={badge} style={{
              fontSize: 8, color: C.accent, fontWeight: 700, letterSpacing: "0.08em",
              background: `${C.accent}10`, border: `1px solid ${C.accent}22`,
              borderRadius: 4, padding: "3px 7px",
            }}>{badge}</span>
          ))}
        </div>

        {/* Mainnet indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, padding: "7px 12px", background: `${C.accent}08`, border: `1px solid ${C.accent}20`, borderRadius: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.ok, flexShrink: 0 }} />
          <span style={{ fontSize: 8, color: C.accent, fontWeight: 700, letterSpacing: "0.08em" }}>MAINNET</span>
        </div>

        {error && <div style={{ fontSize: 8, color: C.danger, marginBottom: 10 }}>{error}</div>}

        {/* CREATE NEW WALLET — primary CTA */}
        <button onClick={handleCreate} disabled={loading} style={{
          width: "100%", padding: "18px 16px", textAlign: "left" as const,
          background: `linear-gradient(145deg, ${C.accent}1A, rgba(11,17,24,0.95))`,
          border: `1px solid ${C.accent}45`, borderRadius: 12, marginBottom: 10,
          cursor: loading ? "not-allowed" : "pointer", ...mono,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
              background: `${C.accent}18`, border: `1px solid ${C.accent}40`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ color: C.accent, fontSize: 18 }}>✦</span>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, marginBottom: 4, letterSpacing: "0.06em" }}>
                {loading ? "GENERATING…" : "CREATE NEW WALLET"}
              </div>
              <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.6 }}>
                Generate a new wallet · 24-word seed phrase · fully encrypted locally
              </div>
            </div>
          </div>
        </button>

        {/* IMPORT EXISTING WALLET */}
        <button onClick={() => {
          setError(null);
          setImportPhrase("");
          setImportPassphrase("");
          setImportAddress("");
          setImportCandidates([]);
          setRememberedKeys([]);
          setImportDerivation(DEFAULT_KASPA_DERIVATION);
          setManualDerivationPath(formatKaspaDerivationPath(DEFAULT_KASPA_DERIVATION));
          setStep("import_phrase");
        }} style={{
          width: "100%", padding: "18px 16px", textAlign: "left" as const,
          background: "rgba(11,17,24,0.85)", border: `1px solid ${C.border}`,
          borderRadius: 12, marginBottom: 18, cursor: "pointer", ...mono,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
              background: "rgba(33,48,67,0.5)", border: `1px solid ${C.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ color: C.dim, fontSize: 18 }}>↓</span>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 4, letterSpacing: "0.06em" }}>IMPORT WALLET</div>
              <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.6 }}>
                Restore from a BIP39 seed phrase · supports 12/15/18/21/24 words
              </div>
            </div>
          </div>
        </button>

        {/* Security footer */}
        <div style={{ marginTop: "auto", padding: "10px 12px", background: "rgba(5,7,10,0.5)", border: `1px solid ${C.border}`, borderRadius: 8 }}>
          {[
            "Your keys never leave your device.",
            "Non-custodial — Forge-OS has zero access to your funds.",
          ].map((note, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: i === 0 ? 4 : 0 }}>
              <span style={{ color: C.ok, fontSize: 8, flexShrink: 0 }}>✓</span>
              <span style={{ fontSize: 8, color: C.dim, lineHeight: 1.5 }}>{note}</span>
            </div>
          ))}
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
          onBack={() => {
            setStep("choose");
            setGeneratedMnemonic("");
            setGeneratedAddress("");
            setGeneratedDerivation(DEFAULT_KASPA_DERIVATION);
          }}
        />

        <div style={{ background: C.wLow, border: `1px solid ${C.warn}40`, borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
          <div style={{ fontSize: 8, color: C.warn, fontWeight: 700 }}>
            ⚠ NEVER share this phrase. Forge-OS will never ask for it.
          </div>
        </div>

        {/* 4-column word grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 14 }}>
          {words.map((word, i) => (
            <div key={i} style={{
              background: "rgba(5,7,10,0.9)", border: `1px solid ${C.border}`,
              borderRadius: 5, padding: "5px 4px",
              display: "flex", alignItems: "center", gap: 3,
            }}>
              <span style={{ fontSize: 8, color: C.dim, flexShrink: 0 }}>{i + 1}.</span>
              <span style={{ fontSize: 8, color: C.text, fontWeight: 600 }}>{word}</span>
            </div>
          ))}
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginBottom: 14 }}>
          <input type="checkbox" checked={backupConfirmed} onChange={e => setBackupConfirmed(e.target.checked)}
            style={{ marginTop: 2, accentColor: C.accent, flexShrink: 0 }} />
          <span style={{ fontSize: 8, color: C.dim, lineHeight: 1.5 }}>
            I have written down my 24-word seed phrase and stored it securely offline.
          </span>
        </label>

        <button onClick={() => setStep("create_password")} disabled={!backupConfirmed} style={{
          width: "100%", padding: "11px 0",
          background: backupConfirmed ? `linear-gradient(90deg, ${C.accent}, #7BE9CF)` : `${C.accent}25`,
          border: "none", borderRadius: 8,
          color: backupConfirmed ? "#04110E" : C.dim,
          fontSize: 10, fontWeight: 700,
          cursor: backupConfirmed ? "pointer" : "not-allowed",
          letterSpacing: "0.1em", ...mono,
        }}>
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
          sub="Your seed phrase will be encrypted and stored locally. You'll need this password to unlock your wallet."
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
          sub="Enter a BIP39 seed phrase (12/15/18/21/24 words). Optional BIP39 passphrase supported."
          onBack={() => setStep("choose")}
        />
        {error && <div style={{ fontSize: 8, color: C.danger, marginBottom: 10 }}>{error}</div>}

        <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.1em", marginBottom: 7 }}>SEED PHRASE</div>
        <textarea
          value={importPhrase}
          onChange={e => {
            setImportPhrase(e.target.value);
            setImportCandidates([]);
            setRememberedKeys([]);
            setImportAddress("");
            setError(null);
          }}
          placeholder="word1 word2 word3 … (space-separated)"
          rows={4}
          style={{
            width: "100%", boxSizing: "border-box" as const,
            background: "rgba(8,13,20,0.8)", border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "10px 12px", color: C.text, fontSize: 10,
            resize: "vertical" as const, ...mono, outline: "none", marginBottom: 10,
          }}
        />

        <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.1em", marginBottom: 7 }}>BIP39 PASSPHRASE (OPTIONAL)</div>
        <input
          type="password"
          value={importPassphrase}
          onChange={e => {
            setImportPassphrase(e.target.value);
            setImportCandidates([]);
            setRememberedKeys([]);
            setImportAddress("");
            setError(null);
          }}
          placeholder="Optional passphrase / 25th word"
          style={{
            width: "100%", boxSizing: "border-box" as const,
            background: "rgba(8,13,20,0.8)", border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "10px 12px", color: C.text, fontSize: 10,
            ...mono, outline: "none", marginBottom: 10,
          }}
        />

        {importPhrase.trim() && (() => {
          const wc = importPhrase.trim().split(/\s+/).filter(Boolean).length;
          const valid = [12, 15, 18, 21, 24].includes(wc);
          return (
            <div style={{ fontSize: 8, color: valid ? C.ok : C.warn, marginBottom: 8 }}>
              {wc} words {valid ? "✓" : "(need 12/15/18/21/24)"}
            </div>
          );
        })()}

        <div style={{
          background: "rgba(8,13,20,0.65)",
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "9px 10px",
          marginBottom: 10,
        }}>
          <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.08em", marginBottom: 6 }}>
            DISCOVERY SCAN OPTIONS
          </div>

          <div style={{ fontSize: 8, color: C.dim, marginBottom: 5 }}>BASE PATH ROOTS (ONE PER LINE)</div>
          <textarea
            value={scanBasePathsText}
            onChange={(e) => setScanBasePathsText(e.target.value)}
            rows={2}
            style={{
              width: "100%", boxSizing: "border-box" as const,
              background: "rgba(5,7,10,0.8)", border: `1px solid ${C.border}`,
              borderRadius: 8, padding: "8px 10px", color: C.text, fontSize: 8,
              resize: "vertical" as const, ...mono, outline: "none", marginBottom: 8,
            }}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 8, color: C.dim, marginBottom: 4 }}>ACCOUNT RANGE</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <input
                  type="number"
                  min={0}
                  value={scanAccountStart}
                  onChange={(e) => setScanAccountStart(e.target.value)}
                  placeholder="start"
                  style={{
                    width: "100%", boxSizing: "border-box" as const,
                    background: "rgba(5,7,10,0.8)", border: `1px solid ${C.border}`,
                    borderRadius: 7, padding: "7px 8px", color: C.text, fontSize: 8,
                    ...mono, outline: "none",
                  }}
                />
                <input
                  type="number"
                  min={0}
                  value={scanAccountEnd}
                  onChange={(e) => setScanAccountEnd(e.target.value)}
                  placeholder="end"
                  style={{
                    width: "100%", boxSizing: "border-box" as const,
                    background: "rgba(5,7,10,0.8)", border: `1px solid ${C.border}`,
                    borderRadius: 7, padding: "7px 8px", color: C.text, fontSize: 8,
                    ...mono, outline: "none",
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 8, color: C.dim, marginBottom: 4 }}>INDEX RANGE</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <input
                  type="number"
                  min={0}
                  value={scanIndexStart}
                  onChange={(e) => setScanIndexStart(e.target.value)}
                  placeholder="start"
                  style={{
                    width: "100%", boxSizing: "border-box" as const,
                    background: "rgba(5,7,10,0.8)", border: `1px solid ${C.border}`,
                    borderRadius: 7, padding: "7px 8px", color: C.text, fontSize: 8,
                    ...mono, outline: "none",
                  }}
                />
                <input
                  type="number"
                  min={0}
                  value={scanIndexEnd}
                  onChange={(e) => setScanIndexEnd(e.target.value)}
                  placeholder="end"
                  style={{
                    width: "100%", boxSizing: "border-box" as const,
                    background: "rgba(5,7,10,0.8)", border: `1px solid ${C.border}`,
                    borderRadius: 7, padding: "7px 8px", color: C.text, fontSize: 8,
                    ...mono, outline: "none",
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={{ fontSize: 8, color: C.dim, marginBottom: 5 }}>CHAINS</div>
              <div style={{ display: "flex", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 8, color: C.dim, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={scanIncludeReceive}
                    onChange={(e) => setScanIncludeReceive(e.target.checked)}
                    style={{ accentColor: C.accent }}
                  />
                  RECEIVE (0)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 8, color: C.dim, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={scanIncludeChange}
                    onChange={(e) => setScanIncludeChange(e.target.checked)}
                    style={{ accentColor: C.accent }}
                  />
                  CHANGE (1)
                </label>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 8, color: C.dim, marginBottom: 4 }}>RESULT LIMIT</div>
              <input
                type="number"
                min={1}
                max={MAX_SCAN_LIMIT}
                value={scanLimit}
                onChange={(e) => setScanLimit(e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box" as const,
                  background: "rgba(5,7,10,0.8)", border: `1px solid ${C.border}`,
                  borderRadius: 7, padding: "7px 8px", color: C.text, fontSize: 8,
                  ...mono, outline: "none",
                }}
              />
            </div>
          </div>
        </div>

        <div style={{
          background: "rgba(8,13,20,0.65)",
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "9px 10px",
          marginBottom: 10,
        }}>
          <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.08em", marginBottom: 6 }}>
            MANUAL DERIVATION PATH
          </div>
          <input
            value={manualDerivationPath}
            onChange={(e) => setManualDerivationPath(e.target.value)}
            placeholder="m/44'/111'/0'/0/0"
            style={{
              width: "100%", boxSizing: "border-box" as const,
              background: "rgba(5,7,10,0.8)", border: `1px solid ${C.border}`,
              borderRadius: 8, padding: "9px 10px", color: C.text, fontSize: 8,
              ...mono, outline: "none", marginBottom: 8,
            }}
          />
          <button
            onClick={handleManualPathValidate}
            disabled={!importPhrase.trim() || loading}
            style={{
              width: "100%", padding: "9px 0",
              background: "rgba(11,17,24,0.85)",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              color: importPhrase.trim() && !loading ? C.text : C.dim,
              fontSize: 8, fontWeight: 700,
              cursor: importPhrase.trim() && !loading ? "pointer" : "not-allowed",
              letterSpacing: "0.08em", ...mono,
            }}
          >
            {loading ? "VALIDATING…" : "USE MANUAL PATH"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button onClick={handleImportValidate} disabled={!importPhrase.trim() || loading} style={{
          width: "100%", padding: "11px 0",
          background: importPhrase.trim() && !loading
            ? `linear-gradient(90deg, ${C.accent}, #7BE9CF)` : `${C.accent}25`,
          border: "none", borderRadius: 8,
          color: importPhrase.trim() && !loading ? "#04110E" : C.dim,
          fontSize: 10, fontWeight: 700,
          cursor: importPhrase.trim() && !loading ? "pointer" : "not-allowed",
          letterSpacing: "0.1em", ...mono,
        }}>
          {loading ? "VALIDATING…" : "VALIDATE PHRASE →"}
          </button>

          <button onClick={handleImportDiscover} disabled={!importPhrase.trim() || loading} style={{
            width: "100%", padding: "11px 0",
            background: "rgba(11,17,24,0.85)",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: importPhrase.trim() && !loading ? C.text : C.dim,
            fontSize: 9, fontWeight: 700,
            cursor: importPhrase.trim() && !loading ? "pointer" : "not-allowed",
            letterSpacing: "0.08em", ...mono,
          }}>
            {loading ? "SCANNING…" : "SCAN PATHS"}
          </button>
        </div>

        <button
          onClick={handleLoadRemembered}
          disabled={!importPhrase.trim() || loading}
          style={{
            width: "100%", padding: "10px 0", marginTop: 8,
            background: "rgba(11,17,24,0.85)",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: importPhrase.trim() && !loading ? C.text : C.dim,
            fontSize: 8, fontWeight: 700,
            cursor: importPhrase.trim() && !loading ? "pointer" : "not-allowed",
            letterSpacing: "0.08em", ...mono,
          }}
        >
          {loading ? "LOADING…" : "LOAD REMEMBERED CANDIDATES"}
        </button>
      </Section>
    );
  }

  // ── IMPORT: DISCOVERY WIZARD ───────────────────────────────────────────────
  if (step === "import_discover") {
    return (
      <Section>
        <Header
          title="SELECT DERIVATION"
          sub="Choose the address/path that matches your existing wallet. This choice will be saved for signing."
          onBack={() => setStep("import_phrase")}
        />
        {error && <div style={{ fontSize: 8, color: C.danger, marginBottom: 10 }}>{error}</div>}

        <div style={{
          background: "rgba(11,17,24,0.65)",
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "8px 10px",
          marginBottom: 10,
        }}>
          <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5 }}>
            Showing common derivation candidates for your phrase/passphrase. If unsure, compare with the
            address shown in your current wallet app and select the exact match.
          </div>
          <div style={{ fontSize: 8, color: C.dim, marginTop: 6 }}>
            Remembered candidates for this mnemonic fingerprint: {rememberedKeys.length}
          </div>
        </div>

        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxHeight: 300,
          overflowY: "auto",
          paddingRight: 2,
          marginBottom: 12,
        }}>
          {importCandidates.map((candidate, idx) => {
            const selected =
              candidate.address.toLowerCase() === importAddress.toLowerCase() &&
              formatKaspaDerivationPath(candidate.derivation) === formatKaspaDerivationPath(importDerivation);
            const remembered = rememberedKeys.includes(toCandidateKey(candidate));
            return (
              <button
                key={`${candidate.address}-${candidate.derivationPath}`}
                onClick={() => handleSelectImportCandidate(candidate)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: selected ? `${C.accent}10` : "rgba(8,13,20,0.8)",
                  border: `1px solid ${selected ? `${C.accent}55` : C.border}`,
                  borderRadius: 8,
                  padding: "9px 10px",
                  cursor: "pointer",
                  ...mono,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 8, color: selected ? C.accent : C.text, fontWeight: 700 }}>
                    #{idx + 1} · {candidate.chainLabel.toUpperCase()}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {remembered && (
                      <span style={{
                        fontSize: 8,
                        color: C.accent,
                        border: `1px solid ${C.accent}44`,
                        background: `${C.accent}14`,
                        borderRadius: 4,
                        padding: "2px 4px",
                        letterSpacing: "0.06em",
                      }}>
                        REMEMBERED
                      </span>
                    )}
                    <span style={{ fontSize: 8, color: C.dim }}>
                      {candidate.derivation.account === 0 ? "acct 0" : `acct ${candidate.derivation.account}`}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 8, color: C.text, lineHeight: 1.45, wordBreak: "break-all", marginBottom: 4 }}>
                  {candidate.address}
                </div>
                <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.4, wordBreak: "break-all" }}>
                  {candidate.derivationPath}
                </div>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => handleImportDiscover()}
          disabled={loading}
          style={{
            width: "100%", padding: "10px 0",
            background: "rgba(11,17,24,0.85)",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: loading ? C.dim : C.text,
            fontSize: 9, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            letterSpacing: "0.08em", ...mono,
          }}
        >
          {loading ? "SCANNING…" : "RESCAN CANDIDATES"}
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
          sub="Your imported phrase will be encrypted and stored locally. Choose a strong password."
          onBack={() => setStep(importCandidates.length ? "import_discover" : "import_phrase")}
        />
        <div style={{
          background: "rgba(8,13,20,0.8)",
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "8px 10px",
          marginBottom: 10,
        }}>
          <div style={{ fontSize: 8, color: C.dim, marginBottom: 4, letterSpacing: "0.08em" }}>SELECTED ADDRESS</div>
          <div style={{ fontSize: 8, color: C.text, lineHeight: 1.4, wordBreak: "break-all", marginBottom: 4 }}>
            {importAddress}
          </div>
          <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.4, wordBreak: "break-all" }}>
            {formatKaspaDerivationPath(importDerivation)}
          </div>
        </div>
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
          <img src="../icons/icon48.png" alt="" style={{ width: 36, height: 36, objectFit: "contain", filter: "drop-shadow(0 0 12px rgba(57,221,182,0.7))", marginBottom: 14 }} />
          <div style={{ fontSize: 10, color: C.accent, marginBottom: 6, letterSpacing: "0.1em", fontWeight: 700 }}>ENCRYPTING VAULT…</div>
          <div style={{ fontSize: 8, color: C.dim }}>Deriving key · This may take a moment</div>
        </div>
      </div>
    </Section>
  );
}
