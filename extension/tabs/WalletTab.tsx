// WalletTab — full send pipeline (Build → DryRun → Confirm → Sign → Broadcast → Poll)
// for managed wallets, and address-display receive for all wallets.
// Stablecoin rows are scaffolded via TokenRegistry; enabled=false shows disabled state.

import { useState } from "react";
import { C, mono } from "../../src/tokens";
import { fmt, isKaspaAddress } from "../../src/helpers";
import { getSession } from "../vault/vault";
import { buildTransaction } from "../tx/builder";
import { dryRunValidate } from "../tx/dryRun";
import { signTransaction } from "../tx/signer";
import { broadcastAndPoll } from "../tx/broadcast";
import { addPendingTx, updatePendingTx } from "../tx/store";
import { sompiToKas } from "../utxo/utxoSync";
import { getAllTokens } from "../tokens/registry";
import type { PendingTx } from "../tx/types";

interface Props {
  address: string | null;
  balance: number | null;
  usdPrice: number;
  network: string;
  onBalanceInvalidated?: () => void;
}

type SendStep =
  | "idle"
  | "form"
  | "building"
  | "dry_run"
  | "confirm"
  | "signing"
  | "broadcast"
  | "done"
  | "error";

const EXPLORER = "https://explorer.kaspa.org";

export function WalletTab({ address, balance, usdPrice, network, onBalanceInvalidated }: Props) {
  const [sendStep, setSendStep] = useState<SendStep>("idle");
  const [showReceive, setShowReceive] = useState(false);

  const [sendTo, setSendTo] = useState("");
  const [sendAmt, setSendAmt] = useState("");
  const [pendingTx, setPendingTx] = useState<PendingTx | null>(null);
  const [dryRunErrors, setDryRunErrors] = useState<string[]>([]);
  const [resultTxId, setResultTxId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [addrCopied, setAddrCopied] = useState(false);

  const session = getSession();
  const isManaged = Boolean(session?.mnemonic);

  const networkPrefix = network === "mainnet" ? "kaspa:" : "kaspatest:";
  const addressValid = isKaspaAddress(sendTo) && sendTo.toLowerCase().startsWith(networkPrefix);
  const amountNum = parseFloat(sendAmt);
  const amountValid = amountNum > 0 && (balance === null || amountNum <= balance);
  const formReady = addressValid && amountValid;

  // ── Pipeline ─────────────────────────────────────────────────────────────────

  const handleBuildAndValidate = async () => {
    if (!address || !formReady) return;
    setSendStep("building");
    setDryRunErrors([]);
    setErrorMsg(null);

    let built: PendingTx;
    try {
      built = await buildTransaction(address, sendTo.trim(), amountNum, network);
      await addPendingTx(built);
      setPendingTx(built);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg === "INSUFFICIENT_FUNDS" ? "Insufficient balance including fees." : `Build failed: ${msg}`);
      setSendStep("error");
      return;
    }

    setSendStep("dry_run");
    try {
      const result = await dryRunValidate(built);
      if (!result.valid) {
        setDryRunErrors(result.errors);
        setSendStep("error");
        await updatePendingTx({ ...built, state: "DRY_RUN_FAIL", error: result.errors.join("; ") });
        return;
      }
      const validated: PendingTx = { ...built, state: "DRY_RUN_OK", fee: result.estimatedFee };
      setPendingTx(validated);
      await updatePendingTx(validated);
    } catch (err) {
      setErrorMsg(`Validation failed: ${err instanceof Error ? err.message : String(err)}`);
      setSendStep("error");
      return;
    }

    setSendStep("confirm");
  };

  const handleSign = async () => {
    if (!pendingTx || !isManaged) return;
    setSendStep("signing");

    let signed: PendingTx;
    try {
      signed = await signTransaction(pendingTx);
      setPendingTx(signed);
      await updatePendingTx(signed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg === "WALLET_LOCKED" ? "Wallet locked — please unlock first." : `Signing failed: ${msg}`);
      setSendStep("error");
      return;
    }

    setSendStep("broadcast");
    try {
      await broadcastAndPoll(signed, async (updated) => {
        setPendingTx(updated);
        await updatePendingTx(updated);
        if (updated.state === "CONFIRMED") {
          setResultTxId(updated.txId ?? null);
          setSendStep("done");
          onBalanceInvalidated?.();
        }
        if (updated.state === "FAILED") {
          setErrorMsg(updated.error ?? "Transaction failed.");
          setSendStep("error");
        }
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Transaction timed out awaiting confirmation.");
      setSendStep("error");
    }
  };

  const handleCancel = async () => {
    if (pendingTx) await updatePendingTx({ ...pendingTx, state: "CANCELLED" });
    resetSend();
  };

  const resetSend = () => {
    setSendStep("idle");
    setPendingTx(null);
    setDryRunErrors([]);
    setErrorMsg(null);
    setResultTxId(null);
  };

  const copyAddress = async () => {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setAddrCopied(true); setTimeout(() => setAddrCopied(false), 2000); } catch { /* noop */ }
  };

  const stableTokens = getAllTokens().filter((t) => t.id !== "KAS");
  const explorerUrl = address ? `${EXPLORER}/addresses/${address}` : EXPLORER;

  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Stablecoin card */}
      <div style={{ background: "linear-gradient(145deg, rgba(39,117,202,0.08), rgba(8,13,20,0.6))", border: "1px solid rgba(39,117,202,0.2)", borderRadius: 10, padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.12em" }}>STABLECOIN BALANCE</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "rgba(255,176,7,0.1)", border: "1px solid rgba(255,176,7,0.4)", borderRadius: 4, padding: "2px 6px" }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#FFB007", display: "inline-block" }} />
            <span style={{ fontSize: 6, color: "#FFB007", fontWeight: 700, letterSpacing: "0.1em" }}>COMING SOON</span>
          </div>
        </div>

        {stableTokens.map((token, idx) => (
          <div key={token.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: idx > 0 ? 8 : 0, borderTop: idx > 0 ? `1px solid ${C.border}` : "none", marginTop: idx > 0 ? 8 : 0, opacity: token.enabled ? 1 : 0.55 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, background: token.id === "USDC" ? "#2775CA" : "#26A17B", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 9, fontWeight: 900, color: "#fff" }}>$</span>
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: C.text }}>{token.symbol}</div>
                <div style={{ fontSize: 7, color: C.dim }}>{token.name}</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              {token.enabled
                ? <><div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>0.00</div><div style={{ fontSize: 7, color: C.dim }}>≈ $0.00</div></>
                : <div style={{ fontSize: 7, color: C.dim, maxWidth: 100, lineHeight: 1.4 }}>{token.disabledReason}</div>
              }
            </div>
          </div>
        ))}

        {address && (
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${C.border}`, textAlign: "right" }}>
            <button onClick={() => chrome.tabs.create({ url: explorerUrl })} style={{ background: "none", border: "none", color: C.dim, fontSize: 7, cursor: "pointer", ...mono, padding: 0 }}>Explorer ↗</button>
          </div>
        )}
      </div>

      {/* Action row */}
      {sendStep === "idle" && !showReceive && address && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setSendStep("form")} style={tabBtn(false)}>SEND</button>
          <button onClick={() => setShowReceive(true)} style={tabBtn(false)}>RECEIVE</button>
          <button onClick={() => chrome.tabs.create({ url: "https://forgeos.xyz" })} style={tabBtn(false)}>SWAP ↗</button>
        </div>
      )}

      {/* FORM */}
      {sendStep === "form" && (
        <div style={panel()}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 9, color: C.text, fontWeight: 700, letterSpacing: "0.08em" }}>SEND KAS</div>
            <div style={{ display: "flex", gap: 8 }}>
              {balance !== null && <div style={{ fontSize: 7, color: C.dim }}>Bal: {fmt(balance, 2)} KAS{usdPrice > 0 ? ` ≈ $${fmt(balance * usdPrice, 2)}` : ""}</div>}
              <button onClick={() => setSendStep("idle")} style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono }}>✕</button>
            </div>
          </div>
          {!isManaged && <div style={{ fontSize: 7, color: C.dim, background: "rgba(8,13,20,0.5)", borderRadius: 6, padding: "6px 8px", marginBottom: 6, lineHeight: 1.4 }}>External wallet: signing opens in Forge-OS.</div>}
          <input value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder={`Recipient ${networkPrefix}qp…`} style={inputStyle(Boolean(sendTo && !addressValid))} />
          {sendTo && !addressValid && <div style={{ fontSize: 7, color: C.danger }}>{!sendTo.toLowerCase().startsWith(networkPrefix) ? `Must start with "${networkPrefix}" on ${network}` : "Invalid Kaspa address"}</div>}
          <input value={sendAmt} onChange={(e) => setSendAmt(e.target.value)} placeholder="Amount (KAS)" type="number" min="0" style={inputStyle(false)} />
          {amountNum > 0 && usdPrice > 0 && <div style={{ fontSize: 7, color: C.dim }}>≈ ${fmt(amountNum * usdPrice, 2)}</div>}
          <button onClick={isManaged ? handleBuildAndValidate : () => chrome.tabs.create({ url: `https://forgeos.xyz?send=1&to=${encodeURIComponent(sendTo)}&amount=${encodeURIComponent(sendAmt)}` })} disabled={!formReady} style={submitBtn(formReady)}>
            {isManaged ? "PREVIEW SEND →" : "OPEN IN FORGE-OS →"}
          </button>
        </div>
      )}

      {/* Building / Dry-run */}
      {(sendStep === "building" || sendStep === "dry_run") && (
        <StatusCard icon="⚙" title={sendStep === "building" ? "SELECTING INPUTS…" : "VALIDATING…"} sub={sendStep === "building" ? "Fetching UTXOs and estimating network fee." : "Running 5 security checks."} color={C.accent} />
      )}

      {/* Confirm */}
      {sendStep === "confirm" && pendingTx && (
        <ConfirmPanel tx={pendingTx} usdPrice={usdPrice} onConfirm={handleSign} onCancel={handleCancel} />
      )}

      {/* Signing */}
      {sendStep === "signing" && <StatusCard icon="🔑" title="SIGNING…" sub="Deriving key and signing inputs with kaspa-wasm." color={C.warn} />}

      {/* Broadcast */}
      {sendStep === "broadcast" && (
        <StatusCard icon="📡" title="BROADCASTING…" sub={`Polling for confirmation. TxID: ${pendingTx?.txId ? pendingTx.txId.slice(0, 20) + "…" : "pending"}`} color={C.accent} />
      )}

      {/* Done */}
      {sendStep === "done" && (
        <div style={{ ...panel(), background: `${C.ok}0A`, borderColor: `${C.ok}30` }}>
          <div style={{ fontSize: 10, color: C.ok, fontWeight: 700, marginBottom: 6 }}>✓ TRANSACTION CONFIRMED</div>
          {resultTxId && (
            <>
              <div style={{ fontSize: 7, color: C.dim, marginBottom: 3 }}>Transaction ID</div>
              <div style={{ fontSize: 7, color: C.text, wordBreak: "break-all", marginBottom: 8 }}>{resultTxId}</div>
              <button onClick={() => chrome.tabs.create({ url: `${EXPLORER}/txs/${resultTxId}` })} style={{ background: "none", border: "none", color: C.accent, fontSize: 8, cursor: "pointer", ...mono }}>View on Explorer ↗</button>
            </>
          )}
          <button onClick={resetSend} style={{ ...submitBtn(true), marginTop: 10, background: `${C.ok}20`, color: C.ok }}>DONE</button>
        </div>
      )}

      {/* Error */}
      {sendStep === "error" && (
        <div style={{ ...panel(), background: C.dLow, borderColor: `${C.danger}40` }}>
          <div style={{ fontSize: 9, color: C.danger, fontWeight: 700, marginBottom: 6 }}>TRANSACTION FAILED</div>
          {errorMsg && <div style={{ fontSize: 8, color: C.dim, marginBottom: 6, lineHeight: 1.5 }}>{errorMsg}</div>}
          {dryRunErrors.map((e, i) => <div key={i} style={{ fontSize: 7, color: C.danger, marginBottom: 2 }}>• {e}</div>)}
          <button onClick={resetSend} style={{ ...submitBtn(true), marginTop: 8, background: C.dLow, border: `1px solid ${C.danger}50`, color: C.danger }}>TRY AGAIN</button>
        </div>
      )}

      {/* Receive */}
      {showReceive && address && (
        <div style={panel()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 9, color: C.text, fontWeight: 700, letterSpacing: "0.08em" }}>RECEIVE KAS</div>
            <button onClick={() => setShowReceive(false)} style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono }}>✕</button>
          </div>
          <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.6, wordBreak: "break-all", background: "rgba(5,7,10,0.5)", borderRadius: 6, padding: "8px 10px", marginBottom: 6 }}>{address}</div>
          <button onClick={copyAddress} style={{ background: addrCopied ? `${C.ok}20` : "rgba(33,48,67,0.5)", border: `1px solid ${addrCopied ? C.ok : C.border}`, borderRadius: 6, padding: "6px", color: addrCopied ? C.ok : C.dim, fontSize: 9, cursor: "pointer", ...mono, letterSpacing: "0.08em", fontWeight: 700 }}>
            {addrCopied ? "✓ COPIED" : "COPY ADDRESS"}
          </button>
          <div style={{ fontSize: 7, color: C.dim, lineHeight: 1.5, marginTop: 4 }}>Send KAS to this address from any Kaspa wallet. Transactions confirm at BlockDAG speed.</div>
        </div>
      )}
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const panel = (): React.CSSProperties => ({
  background: "rgba(8,13,20,0.7)", border: `1px solid ${C.border}`,
  borderRadius: 10, padding: "12px 14px",
  display: "flex", flexDirection: "column", gap: 7,
});

const inputStyle = (hasError: boolean): React.CSSProperties => ({
  background: "rgba(8,13,20,0.8)",
  border: `1px solid ${hasError ? C.danger : C.border}`,
  borderRadius: 6, padding: "7px 10px", color: C.text, fontSize: 9,
  ...mono, outline: "none", width: "100%", boxSizing: "border-box" as const,
});

const tabBtn = (_active: boolean): React.CSSProperties => ({
  flex: 1, background: "rgba(16,25,35,0.5)", border: `1px solid ${C.border}`,
  borderRadius: 8, padding: "7px 0", color: C.dim, fontSize: 9, fontWeight: 700,
  cursor: "pointer", textTransform: "uppercase" as const, letterSpacing: "0.1em",
  fontFamily: "'IBM Plex Mono','SFMono-Regular',Menlo,Monaco,monospace",
});

const submitBtn = (active: boolean): React.CSSProperties => ({
  background: active ? `linear-gradient(90deg, ${C.accent}, #7BE9CF)` : "rgba(33,48,67,0.5)",
  color: active ? "#04110E" : C.dim,
  border: "none", borderRadius: 8, padding: "9px",
  fontSize: 9, fontWeight: 700, cursor: active ? "pointer" : "not-allowed",
  letterSpacing: "0.08em", ...mono, width: "100%",
});

function StatusCard({ icon, title, sub, color }: { icon: string; title: string; sub: string; color: string }) {
  return (
    <div style={{ ...panel(), textAlign: "center" as const }}>
      <div style={{ fontSize: 20 }}>{icon}</div>
      <div style={{ fontSize: 9, color, fontWeight: 700, letterSpacing: "0.1em" }}>{title}</div>
      <div style={{ fontSize: 7, color: C.dim, lineHeight: 1.5 }}>{sub}</div>
    </div>
  );
}

function ConfirmPanel({ tx, usdPrice, onConfirm, onCancel }: { tx: PendingTx; usdPrice: number; onConfirm: () => void; onCancel: () => void }) {
  const toAmt = tx.outputs[0];
  const toKas = toAmt ? sompiToKas(toAmt.amount) : 0;
  const feeKas = sompiToKas(tx.fee);
  const changeKas = tx.changeOutput ? sompiToKas(tx.changeOutput.amount) : 0;

  const row = (label: string, value: string, color = C.text) => (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
      <span style={{ fontSize: 7, color: C.dim }}>{label}</span>
      <span style={{ fontSize: 8, color, fontWeight: 700 }}>{value}</span>
    </div>
  );

  return (
    <div style={{ ...panel(), borderColor: `${C.accent}30` }}>
      <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, letterSpacing: "0.08em" }}>CONFIRM TRANSACTION</div>
      <div style={{ background: "rgba(5,7,10,0.5)", borderRadius: 8, padding: "10px 12px" }}>
        {row("TO", tx.outputs[0]?.address ? tx.outputs[0].address.slice(0, 22) + "…" : "—")}
        {row("AMOUNT", `${fmt(toKas, 4)} KAS${usdPrice > 0 ? ` ≈ $${fmt(toKas * usdPrice, 2)}` : ""}`)}
        {row("NETWORK FEE", `${fmt(feeKas, 8)} KAS`, C.warn)}
        {changeKas > 0 && row("CHANGE", `${fmt(changeKas, 4)} KAS`, C.dim)}
        <div style={{ height: 1, background: C.border, margin: "6px 0" }} />
        {row("TOTAL COST", `${fmt(toKas + feeKas, 4)} KAS`, C.accent)}
      </div>
      <div style={{ fontSize: 7, color: C.warn, lineHeight: 1.5 }}>⚠ Kaspa transactions are irreversible once confirmed.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: "8px 0", background: "rgba(33,48,67,0.5)", border: `1px solid ${C.border}`, borderRadius: 8, color: C.dim, fontSize: 9, cursor: "pointer", ...mono }}>CANCEL</button>
        <button onClick={onConfirm} style={{ flex: 2, padding: "8px 0", background: `linear-gradient(90deg, ${C.accent}, #7BE9CF)`, border: "none", borderRadius: 8, color: "#04110E", fontSize: 9, fontWeight: 700, cursor: "pointer", letterSpacing: "0.08em", ...mono }}>SIGN & SEND →</button>
      </div>
    </div>
  );
}
