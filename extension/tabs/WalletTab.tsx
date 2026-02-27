// WalletTab — full send pipeline (Build → DryRun → Confirm → Sign → Broadcast → Poll)
// for managed wallets, and address-display receive for all wallets.
// Stablecoin rows are scaffolded via TokenRegistry; enabled=false shows disabled state.

import { useState, useEffect } from "react";
import { C, mono } from "../../src/tokens";
import { fmt, isKaspaAddress } from "../../src/helpers";
import { getSession } from "../vault/vault";
import { buildTransaction } from "../tx/builder";
import { dryRunValidate } from "../tx/dryRun";
import { signTransaction } from "../tx/signer";
import { broadcastAndPoll } from "../tx/broadcast";
import { addPendingTx, updatePendingTx } from "../tx/store";
import { getOrSyncUtxos, sompiToKas, syncUtxos } from "../utxo/utxoSync";
import { getAllTokens } from "../tokens/registry";
import type { PendingTx } from "../tx/types";
import type { TokenId } from "../tokens/types";
import type { Utxo } from "../utxo/types";
import {
  divider,
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
  balance: number | null;
  usdPrice: number;
  network: string;
  hideBalances?: boolean;
  onOpenSwap?: () => void;
  /** When set, immediately opens the send or receive panel */
  mode?: "send" | "receive";
  onModeConsumed?: () => void;
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

const EXPLORERS: Record<string, string> = {
  mainnet:      "https://explorer.kaspa.org",
  "testnet-10": "https://explorer-tn10.kaspa.org",
  "testnet-11": "https://explorer-tn11.kaspa.org",
  "testnet-12": "https://explorer-tn12.kaspa.org",
};

export function WalletTab({
  address,
  balance,
  usdPrice,
  network,
  hideBalances = false,
  onOpenSwap,
  mode,
  onModeConsumed,
  onBalanceInvalidated,
}: Props) {
  const [sendStep, setSendStep] = useState<SendStep>("idle");
  const [showReceive, setShowReceive] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [sendAmt, setSendAmt] = useState("");
  const [pendingTx, setPendingTx] = useState<PendingTx | null>(null);
  const [dryRunErrors, setDryRunErrors] = useState<string[]>([]);
  const [resultTxId, setResultTxId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [addrCopied, setAddrCopied] = useState(false);
  const [utxos, setUtxos] = useState<Utxo[]>([]);
  const [utxoLoading, setUtxoLoading] = useState(false);
  const [utxoError, setUtxoError] = useState<string | null>(null);
  const [utxoUpdatedAt, setUtxoUpdatedAt] = useState<number | null>(null);
  const [utxoReloadNonce, setUtxoReloadNonce] = useState(0);

  // Open send/receive panel when triggered from parent (hero buttons)
  useEffect(() => {
    if (mode === "send") { setSendStep("form"); setShowReceive(false); onModeConsumed?.(); }
    if (mode === "receive") { setShowReceive(true); setSendStep("idle"); onModeConsumed?.(); }
  }, [mode]);

  useEffect(() => {
    let alive = true;

    const loadUtxos = async (force = false) => {
      if (!address) {
        if (!alive) return;
        setUtxos([]);
        setUtxoError(null);
        setUtxoUpdatedAt(null);
        setUtxoLoading(false);
        return;
      }

      if (!alive) return;
      setUtxoLoading(true);
      if (force) setUtxoError(null);

      try {
        const utxoSet = force
          ? await syncUtxos(address, network)
          : await getOrSyncUtxos(address, network);
        if (!alive) return;

        const sorted = [...utxoSet.utxos].sort((a, b) => {
          if (a.amount === b.amount) return 0;
          return a.amount > b.amount ? -1 : 1;
        });

        setUtxos(sorted);
        setUtxoUpdatedAt(Date.now());
        setUtxoError(null);
      } catch (err) {
        if (!alive) return;
        setUtxoError(err instanceof Error ? err.message : "Failed to load UTXOs.");
      } finally {
        if (alive) setUtxoLoading(false);
      }
    };

    loadUtxos(true).catch(() => {});
    const pollId = window.setInterval(() => {
      loadUtxos(false).catch(() => {});
    }, 25_000);

    return () => {
      alive = false;
      clearInterval(pollId);
    };
  }, [address, network, utxoReloadNonce]);

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
      setErrorMsg(
        msg === "INSUFFICIENT_FUNDS"
          ? "Insufficient balance including fees."
          : msg === "COVENANT_ONLY_FUNDS"
            ? "Funds are currently locked in covenant outputs. Standard send only spends standard UTXOs."
            : `Build failed: ${msg}`,
      );
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
          setUtxoReloadNonce((v) => v + 1);
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

  const displayTokens = [...getAllTokens()].sort((a, b) => {
    if (a.id === "KAS") return -1;
    if (b.id === "KAS") return 1;
    return 0;
  });
  const tokenLogoById: Record<string, string> = {
    KAS: "../icons/kaspa-logo.png",
    USDT: "../icons/usdt.png",
    USDC: "../icons/usdc.png",
  };
  const tokenBalanceById: Partial<Record<TokenId, number>> = {
    KAS: balance ?? 0,
    USDT: 0,
    USDC: 0,
    ZRX: 0,
  };
  const explorerBase = EXPLORERS[network] ?? EXPLORERS.mainnet;
  const explorerUrl = address ? `${explorerBase}/addresses/${address}` : explorerBase;
  const utxoTotalSompi = utxos.reduce((acc, u) => acc + u.amount, 0n);
  const utxoTotalKas = sompiToKas(utxoTotalSompi);
  const utxoLargestKas = utxos.length ? sompiToKas(utxos[0].amount) : 0;
  const covenantUtxoCount = utxos.filter((u) => (u.scriptClass ?? "standard") === "covenant").length;
  const standardUtxoCount = utxos.length - covenantUtxoCount;
  const utxoUpdatedLabel = utxoUpdatedAt
    ? new Date(utxoUpdatedAt).toLocaleTimeString([], { hour12: false })
    : "—";
  const masked = (value: string) => (hideBalances ? "••••" : value);
  const maskedKas = (amount: number, digits: number) => (hideBalances ? "•••• KAS" : `${fmt(amount, digits)} KAS`);
  const maskedUsd = (amount: number, digits: number) => (hideBalances ? "$••••" : `$${fmt(amount, digits)}`);

  return (
    <div style={popupTabStack}>

      {/* Token card */}
      <div style={{
        ...sectionCard("purple"),
        background: "linear-gradient(165deg, rgba(10,18,28,0.96) 0%, rgba(7,13,22,0.93) 52%, rgba(5,10,18,0.94) 100%)",
        border: `1px solid ${C.accent}3A`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 26px rgba(0,0,0,0.28), 0 0 24px rgba(57,221,182,0.09)",
      }}>
        <div
          style={{
            position: "absolute",
            top: -32,
            right: -26,
            width: 130,
            height: 130,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(57,221,182,0.26) 0%, rgba(57,221,182,0.05) 48%, transparent 75%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent 0px, transparent 23px, rgba(57,221,182,0.05) 24px), repeating-linear-gradient(90deg, transparent 0px, transparent 23px, rgba(57,221,182,0.04) 24px)",
            opacity: 0.45,
          }}
        />

        <div style={{ marginBottom: 11, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, position: "relative" }}>
          <div style={sectionKicker}>TOKEN BALANCES</div>
        </div>

        {displayTokens.map((token, idx) => {
          const tokenLogo = tokenLogoById[token.id] ?? tokenLogoById.KAS;
          const isKasToken = token.id === "KAS";
          const logoBadgeSize = isKasToken ? 48 : 30;
          const logoSize = isKasToken ? 40 : 20;
          const tokenBalanceUnits = tokenBalanceById[token.id as TokenId] ?? 0;
          const tokenAmountLabelRaw = token.id === "KAS" ? fmt(tokenBalanceUnits, 4) : fmt(tokenBalanceUnits, 2);
          const tokenAmountLabel = masked(tokenAmountLabelRaw);
          return (
          <div key={token.id} style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(160deg, rgba(15,24,36,0.86), rgba(8,14,22,0.88))",
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: "10px 11px",
            marginTop: idx > 0 ? 8 : 0,
            opacity: isKasToken ? 1 : token.enabled ? 1 : 0.58,
            position: "relative",
            zIndex: 1,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: logoBadgeSize,
                height: logoBadgeSize,
                borderRadius: "50%",
                flexShrink: 0,
                background: "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                boxShadow: "none",
                overflow: "hidden",
              }}>
                <img
                  src={tokenLogo}
                  alt={`${token.symbol} logo`}
                  style={{
                    width: logoSize,
                    height: logoSize,
                    objectFit: "contain",
                    borderRadius: "50%",
                    filter: "none",
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.text, letterSpacing: "0.05em", ...mono }}>{token.symbol}</div>
                <div style={{ fontSize: 9, color: C.dim, letterSpacing: "0.03em" }}>{token.name}</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
                {tokenAmountLabel}
              </div>
              {!token.enabled && token.disabledReason && (
                <div style={{ fontSize: 8, color: C.dim, maxWidth: 140, lineHeight: 1.35, marginTop: 3 }}>
                  {token.disabledReason}
                </div>
              )}
            </div>
          </div>
        )})}

        {address && (
          <div style={{ marginTop: 11, textAlign: "right", position: "relative", zIndex: 1 }}>
            <button
              onClick={() => chrome.tabs.create({ url: explorerUrl })}
              style={{ ...outlineButton(C.accent, true), padding: "6px 9px", fontSize: 9, color: C.accent }}
            >
              EXPLORER ↗
            </button>
          </div>
        )}
      </div>

      {/* UTXO card */}
      <div style={sectionCard("default")}>
        <div style={{ marginBottom: 9, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={sectionKicker}>UTXO SET</div>
          <button
            onClick={() => setUtxoReloadNonce((v) => v + 1)}
            disabled={utxoLoading}
            style={{ ...outlineButton(C.accent, true), padding: "5px 8px", fontSize: 8, color: C.accent }}
          >
            {utxoLoading ? "SYNC…" : "REFRESH"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 9 }}>
          <div style={{ ...insetCard(), flex: 1, padding: "6px 7px" }}>
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.08em" }}>COUNT</div>
            <div style={{ fontSize: 11, color: C.text, fontWeight: 700, ...mono }}>{utxos.length}</div>
          </div>
          <div style={{ ...insetCard(), flex: 1, padding: "6px 7px" }}>
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.08em" }}>TOTAL</div>
            <div style={{ fontSize: 11, color: C.text, fontWeight: 700, ...mono }}>{maskedKas(utxoTotalKas, 4)}</div>
          </div>
          <div style={{ ...insetCard(), flex: 1, padding: "6px 7px" }}>
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.08em" }}>LARGEST</div>
            <div style={{ fontSize: 11, color: C.text, fontWeight: 700, ...mono }}>{maskedKas(utxoLargestKas, 4)}</div>
          </div>
        </div>

        {covenantUtxoCount > 0 && (
          <div style={{ ...insetCard(), fontSize: 8, color: C.warn, padding: "8px 10px", marginBottom: 8, lineHeight: 1.45 }}>
            Covenant outputs detected: {covenantUtxoCount}. Standard send currently uses spendable UTXOs only ({standardUtxoCount} available).
          </div>
        )}

        {utxoLoading && utxos.length === 0 && (
          <div style={{ ...insetCard(), fontSize: 8, color: C.dim, padding: "9px 10px" }}>
            Fetching UTXOs from {network}…
          </div>
        )}

        {!utxoLoading && utxos.length === 0 && !utxoError && (
          <div style={{ ...insetCard(), fontSize: 8, color: C.dim, padding: "9px 10px" }}>
            No UTXOs found for this wallet on {network}.
          </div>
        )}

        {utxoError && (
          <div style={{ ...insetCard(), fontSize: 8, color: C.danger, padding: "9px 10px", marginBottom: utxos.length ? 8 : 0 }}>
            {utxoError}
          </div>
        )}

        {utxos.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {utxos.slice(0, 6).map((u, idx) => {
              const utxoKas = sompiToKas(u.amount);
              return (
                <div key={`${u.txId}:${u.outputIndex}`} style={{ ...insetCard(), padding: "8px 9px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 8, color: C.dim, ...mono, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        #{idx + 1} {u.txId.slice(0, 16)}…:{u.outputIndex}
                      </div>
                      <div style={{ fontSize: 8, color: C.muted, marginTop: 2 }}>
                        DAA {u.blockDaaScore.toString()} {u.isCoinbase ? "· COINBASE" : ""} {(u.scriptClass ?? "standard") === "covenant" ? "· COVENANT" : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, ...mono }}>
                      {maskedKas(utxoKas, 4)}
                    </div>
                  </div>
                </div>
              );
            })}

            {utxos.length > 6 && (
              <div style={{ fontSize: 8, color: C.dim, textAlign: "right", paddingTop: 1 }}>
                +{utxos.length - 6} more UTXOs
              </div>
            )}
          </div>
        )}

        <div style={{ ...divider(), margin: "9px 0 6px" }} />
        <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.06em", textAlign: "right" }}>
          UPDATED {utxoUpdatedLabel}
        </div>
      </div>

      {/* Action row */}
      {sendStep === "idle" && !showReceive && address && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setSendStep("form")} style={tabBtn(false)}>SEND</button>
          <button onClick={() => setShowReceive(true)} style={tabBtn(false)}>RECEIVE</button>
          <button onClick={() => onOpenSwap ? onOpenSwap() : chrome.tabs.create({ url: "https://forge-os.xyz" })} style={tabBtn(false)}>SWAP</button>
        </div>
      )}

      {/* FORM */}
      {sendStep === "form" && (
        <div style={panel()}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={sectionTitle}>SEND KAS</div>
            <div style={{ display: "flex", gap: 8 }}>
              {balance !== null && (
                <div style={{ fontSize: 8, color: C.dim }}>
                  Bal: {maskedKas(balance, 2)}
                  {usdPrice > 0 ? ` ≈ ${maskedUsd(balance * usdPrice, 2)}` : ""}
                </div>
              )}
              <button onClick={() => setSendStep("idle")} style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono }}>✕</button>
            </div>
          </div>
          {!isManaged && <div style={{ ...insetCard(), fontSize: 8, color: C.dim, marginBottom: 6, lineHeight: 1.4 }}>External wallet: signing opens in Forge-OS.</div>}
          <input value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder={`Recipient ${networkPrefix}qp…`} style={inputStyle(Boolean(sendTo && !addressValid))} />
          {sendTo && !addressValid && <div style={{ fontSize: 8, color: C.danger }}>{!sendTo.toLowerCase().startsWith(networkPrefix) ? `Must start with "${networkPrefix}" on ${network}` : "Invalid Kaspa address"}</div>}
          {/* Amount input + MAX button */}
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <input
              value={sendAmt}
              onChange={(e) => setSendAmt(e.target.value)}
              placeholder="Amount (KAS)"
              type="number"
              min="0"
              style={{ ...inputStyle(false), paddingRight: 48 }}
            />
            {balance !== null && balance > 0 && (
              <button
                onClick={() => {
                  // Reserve ~0.01 KAS buffer for network fee
                  const maxAmt = Math.max(0, balance - 0.01);
                  setSendAmt(maxAmt > 0 ? String(parseFloat(maxAmt.toFixed(4))) : "");
                }}
                style={{
                  position: "absolute", right: 6, background: `${C.accent}20`,
                  border: `1px solid ${C.accent}50`, borderRadius: 4, padding: "2px 6px",
                  color: C.accent, fontSize: 8, fontWeight: 700, cursor: "pointer", ...mono,
                  letterSpacing: "0.06em",
                }}
              >MAX</button>
            )}
          </div>
          {amountNum > 0 && usdPrice > 0 && (
            <div style={{ fontSize: 8, color: C.dim }}>
              ≈ {maskedUsd(amountNum * usdPrice, 2)}
            </div>
          )}
          <button onClick={isManaged ? handleBuildAndValidate : () => chrome.tabs.create({ url: `https://forge-os.xyz?send=1&to=${encodeURIComponent(sendTo)}&amount=${encodeURIComponent(sendAmt)}` })} disabled={!formReady} style={submitBtn(formReady)}>
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
              <div style={{ fontSize: 8, color: C.dim, marginBottom: 3 }}>Transaction ID</div>
              <div style={{ fontSize: 8, color: C.text, wordBreak: "break-all", marginBottom: 8 }}>{resultTxId}</div>
              <button onClick={() => chrome.tabs.create({ url: `${explorerBase}/txs/${resultTxId}` })} style={{ background: "none", border: "none", color: C.accent, fontSize: 8, cursor: "pointer", ...mono }}>View on Explorer ↗</button>
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
          {dryRunErrors.map((e, i) => <div key={i} style={{ fontSize: 8, color: C.danger, marginBottom: 2 }}>• {e}</div>)}
          <button onClick={resetSend} style={{ ...submitBtn(true), marginTop: 8, background: C.dLow, border: `1px solid ${C.danger}50`, color: C.danger }}>TRY AGAIN</button>
        </div>
      )}

      {/* Receive */}
      {showReceive && address && (
        <div style={panel()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={sectionTitle}>RECEIVE KAS</div>
            <button onClick={() => setShowReceive(false)} style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono }}>✕</button>
          </div>
          <div style={{ ...insetCard(), fontSize: 8, color: C.dim, lineHeight: 1.6, wordBreak: "break-all", marginBottom: 6 }}>{address}</div>
          <button onClick={copyAddress} style={{ ...outlineButton(addrCopied ? C.ok : C.dim, true), padding: "7px 8px", color: addrCopied ? C.ok : C.dim, width: "100%" }}>
            {addrCopied ? "✓ COPIED" : "COPY ADDRESS"}
          </button>
          <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5, marginTop: 4 }}>Send KAS to this address from any Kaspa wallet. Transactions confirm at BlockDAG speed.</div>
        </div>
      )}
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const panel = (): React.CSSProperties => ({
  ...sectionCard("default"),
  display: "flex", flexDirection: "column", gap: 7,
});

const inputStyle = (hasError: boolean): React.CSSProperties => ({
  ...monoInput(hasError),
});

const tabBtn = (_active: boolean): React.CSSProperties => ({
  ...outlineButton(C.dim, true),
  flex: 1,
  padding: "8px 0",
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
});

const submitBtn = (active: boolean): React.CSSProperties => ({
  ...primaryButton(active),
  padding: "9px",
  width: "100%",
});

function StatusCard({ icon, title, sub, color }: { icon: string; title: string; sub: string; color: string }) {
  return (
    <div style={{ ...panel(), textAlign: "center" as const }}>
      <div style={{ fontSize: 20 }}>{icon}</div>
      <div style={{ fontSize: 9, color, fontWeight: 700, letterSpacing: "0.1em" }}>{title}</div>
      <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5 }}>{sub}</div>
    </div>
  );
}

function ConfirmPanel({ tx, usdPrice, onConfirm, onCancel }: { tx: PendingTx; usdPrice: number; onConfirm: () => void; onCancel: () => void }) {
  const toAmt = tx.outputs[0];
  const toKas = toAmt ? sompiToKas(toAmt.amount) : 0;
  const feeKas = sompiToKas(tx.fee);
  const platformFeeKas = tx.platformFee ? sompiToKas(tx.platformFee) : 0;
  const changeKas = tx.changeOutput ? sompiToKas(tx.changeOutput.amount) : 0;
  const totalCost = toKas + feeKas + platformFeeKas;

  const row = (label: string, value: string, color = C.text, sub?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
      <span style={{ fontSize: 8, color: C.dim }}>
        {label}
        {sub && <span style={{ fontSize: 8, color: C.muted, marginLeft: 4 }}>{sub}</span>}
      </span>
      <span style={{ fontSize: 9, color, fontWeight: 700 }}>{value}</span>
    </div>
  );

  return (
    <div style={{ ...panel(), borderColor: `${C.accent}30` }}>
      <div style={{ ...sectionTitle, color: C.accent }}>CONFIRM TRANSACTION</div>
      <div style={insetCard()}>
        {row("TO", tx.outputs[0]?.address ? tx.outputs[0].address.slice(0, 22) + "…" : "—")}
        {row("AMOUNT", `${fmt(toKas, 4)} KAS${usdPrice > 0 ? ` ≈ $${fmt(toKas * usdPrice, 2)}` : ""}`)}
        {row("NETWORK FEE", `${fmt(feeKas, 8)} KAS`, C.warn, "→ miners")}
        {platformFeeKas > 0 && row("PLATFORM FEE", `${fmt(platformFeeKas, 6)} KAS`, C.dim, "→ treasury")}
        {changeKas > 0 && row("CHANGE", `${fmt(changeKas, 4)} KAS`, C.dim)}
        <div style={{ ...divider(), margin: "6px 0" }} />
        {row("TOTAL COST", `${fmt(totalCost, 4)} KAS`, C.accent)}
      </div>
      <div style={{ fontSize: 8, color: C.warn, lineHeight: 1.5 }}>⚠ Kaspa transactions are irreversible once confirmed.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ ...outlineButton(C.dim, true), flex: 1, padding: "8px 0" }}>CANCEL</button>
        <button onClick={onConfirm} style={{ ...primaryButton(true), flex: 2, padding: "8px 0" }}>SIGN & SEND →</button>
      </div>
    </div>
  );
}
