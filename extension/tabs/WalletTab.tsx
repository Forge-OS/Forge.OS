// WalletTab — full send pipeline (Build → DryRun → Confirm → Sign → Broadcast → Poll)
// for managed wallets, and address-display receive for all wallets.
// Stablecoin rows are scaffolded via TokenRegistry; enabled=false shows disabled state.

import { useState, useEffect } from "react";
import QRCode from "qrcode";
import { C, mono } from "../../src/tokens";
import { fmt, isKaspaAddress } from "../../src/helpers";
import { fetchKasUsdPrice } from "../shared/api";
import { fetchBlueScore, NETWORK_BPS, fetchTransactionHistory } from "../network/kaspaClient";
import type { KaspaHistoricalTx } from "../network/kaspaClient";
import { getSession } from "../vault/vault";
import { createExecutionRunId } from "../tx/executionTelemetry";
import { updatePendingTx } from "../tx/store";
import { getOrSyncUtxos, sompiToKas, syncUtxos } from "../utxo/utxoSync";
import { getAllTokens } from "../tokens/registry";
import {
  fetchKrcPortfolio,
  getKrcPortfolioDiagnostics,
  loadPrefetchedKrcPortfolio,
  savePrefetchedKrcPortfolio,
} from "../portfolio/krcPortfolio";
import { downsampleChartPoints } from "../portfolio/chartDownsample";
import type { KrcPortfolioToken } from "../portfolio/types";
import { resolveTokenFromAddress, resolveTokenFromQuery } from "../swap/tokenResolver";
import type { KaspaTokenStandard, SwapCustomToken } from "../swap/types";
import type { PendingTx } from "../tx/types";
import type { Utxo } from "../utxo/types";
import type { EscrowOffer } from "../tx/escrow";
import type { AddressContact } from "../shared/storage";
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
  /** When set, immediately opens the send or receive panel */
  mode?: "send" | "receive";
  modeRequestId?: number;
  onModeConsumed?: () => void;
  onBalanceInvalidated?: () => void;
  /** Called whenever the KRC portfolio USD total changes so Popup can include it in the hero value */
  onKrcPortfolioUpdate?: (totalUsd: number) => void;
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

const KAS_CHART_MAX_POINTS = 900; // ~15m at 1s cadence
const KAS_FEED_POLL_MS = 1_000;
const EXT_ENV = (import.meta as any)?.env ?? {};

function parseIntEnv(name: string, fallback: number): number {
  const value = Number(EXT_ENV?.[name]);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function parseWindowEnv(name: string, fallback: number[]): number[] {
  const raw = String(EXT_ENV?.[name] ?? "").trim();
  if (!raw) return fallback;
  const values = [...new Set(
    raw
      .split(/[,\s]+/)
      .map((entry) => Number(entry))
      .filter((entry) => Number.isInteger(entry) && entry >= 2)
      .map((entry) => Math.floor(entry)),
  )];
  return values.length > 0 ? values : fallback;
}

const KRC721_CHART_WINDOWS = parseWindowEnv("VITE_KRC721_CHART_WINDOWS", [120, 360, 720]);
const KRC721_CHART_DEFAULT_WINDOW = (() => {
  const configured = parseIntEnv("VITE_KRC721_CHART_DEFAULT_WINDOW", KRC721_CHART_WINDOWS[0]);
  const sorted = [...KRC721_CHART_WINDOWS].sort((a, b) => a - b);
  for (const windowSize of sorted) {
    if (windowSize >= configured) return windowSize;
  }
  return sorted[sorted.length - 1];
})();
const KRC721_CHART_RENDER_MAX_POINTS = Math.min(
  1_200,
  Math.max(40, parseIntEnv("VITE_KRC721_CHART_RENDER_MAX_POINTS", 220)),
);

type PricePoint = { ts: number; price: number };

type TxKernelModule = typeof import("../tx/kernel");
let txKernelPromise: Promise<TxKernelModule> | null = null;

function loadTxKernel(): Promise<TxKernelModule> {
  if (!txKernelPromise) {
    txKernelPromise = import("../tx/kernel");
  }
  return txKernelPromise;
}

export function WalletTab({
  address,
  balance,
  usdPrice,
  network,
  hideBalances = false,
  mode,
  modeRequestId,
  onModeConsumed,
  onBalanceInvalidated,
  onKrcPortfolioUpdate,
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
  const [receiveQrDataUrl, setReceiveQrDataUrl] = useState<string | null>(null);
  const [receiveQrError, setReceiveQrError] = useState<string | null>(null);
  const [utxos, setUtxos] = useState<Utxo[]>([]);
  const [utxoLoading, setUtxoLoading] = useState(false);
  const [utxoError, setUtxoError] = useState<string | null>(null);
  const [utxoUpdatedAt, setUtxoUpdatedAt] = useState<number | null>(null);
  const [utxoReloadNonce, setUtxoReloadNonce] = useState(0);
  const [selectedTokenId, setSelectedTokenId] = useState<"KAS" | null>(null);
  const [liveKasPrice, setLiveKasPrice] = useState(usdPrice);
  const [kasPriceSeries, setKasPriceSeries] = useState<PricePoint[]>([]);
  const [kasFeedUpdatedAt, setKasFeedUpdatedAt] = useState<number | null>(null);
  const [kasFeedError, setKasFeedError] = useState<string | null>(null);
  const [kasChartWindow, setKasChartWindow] = useState<number>(300);
  const [kasFeedRefreshNonce, setKasFeedRefreshNonce] = useState(0);
  const [networkDaaScore, setNetworkDaaScore] = useState<string | null>(null);
  const [metadataAddressInput, setMetadataAddressInput] = useState("");
  const [metadataStandard, setMetadataStandard] = useState<KaspaTokenStandard>("krc20");
  const [resolvedMetadata, setResolvedMetadata] = useState<SwapCustomToken | null>(null);
  const [metadataResolveBusy, setMetadataResolveBusy] = useState(false);
  const [metadataResolveError, setMetadataResolveError] = useState<string | null>(null);
  const [krcPortfolioTokens, setKrcPortfolioTokens] = useState<KrcPortfolioToken[]>([]);
  const [krcPortfolioLoading, setKrcPortfolioLoading] = useState(false);
  const [krcPortfolioError, setKrcPortfolioError] = useState<string | null>(null);
  const [selectedKrcToken, setSelectedKrcToken] = useState<KrcPortfolioToken | null>(null);
  const [krc721ChartMode, setKrc721ChartMode] = useState<"floor" | "volume">("floor");
  const [krc721ChartWindow, setKrc721ChartWindow] = useState<number>(KRC721_CHART_DEFAULT_WINDOW);
  const [sendExecutionRunId, setSendExecutionRunId] = useState<string | null>(null);

  // ── OTC Escrow state ──────────────────────────────────────────────────────
  const [escrowMode, setEscrowMode] = useState<"none" | "create" | "claim">("none");
  const [escrowOffers, setEscrowOffers] = useState<EscrowOffer[]>([]);
  const [escrowAmount, setEscrowAmount] = useState("");
  const [escrowTtl, setEscrowTtl] = useState(3_600_000); // 1 hour default
  const [escrowLabel, setEscrowLabel] = useState("");
  const [escrowClaimOfferAddress, setEscrowClaimOfferAddress] = useState("");
  const [escrowClaimPrivKey, setEscrowClaimPrivKey] = useState("");
  const [escrowClaimToAddress, setEscrowClaimToAddress] = useState("");
  const [escrowBusy, setEscrowBusy] = useState(false);
  const [escrowError, setEscrowError] = useState<string | null>(null);
  const [escrowSuccessTxId, setEscrowSuccessTxId] = useState<string | null>(null);
  const [createdOffer, setCreatedOffer] = useState<EscrowOffer | null>(null);
  const [privKeyRevealed, setPrivKeyRevealed] = useState(false);

  // ── KRC-20 send state ─────────────────────────────────────────────────────
  const [krc20SendMode, setKrc20SendMode] = useState(false);
  const [krc20SendTo, setKrc20SendTo] = useState("");
  const [krc20SendAmt, setKrc20SendAmt] = useState("");
  const [krc20Busy, setKrc20Busy] = useState(false);
  const [krc20Error, setKrc20Error] = useState<string | null>(null);
  const [krc20TxId, setKrc20TxId] = useState<string | null>(null);

  // ── Transaction history state ─────────────────────────────────────────────
  const [txHistory, setTxHistory] = useState<KaspaHistoricalTx[]>([]);
  const [txHistoryLoading, setTxHistoryLoading] = useState(false);
  const [txHistoryLoaded, setTxHistoryLoaded] = useState(false);
  const [txHistoryError, setTxHistoryError] = useState<string | null>(null);

  // ── Batch send state ──────────────────────────────────────────────────────
  const [batchMode, setBatchMode] = useState(false);
  const [batchRecipients, setBatchRecipients] = useState<Array<{ address: string; amountKas: string }>>([
    { address: "", amountKas: "" },
  ]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchTxId, setBatchTxId] = useState<string | null>(null);

  // ── Address book state ────────────────────────────────────────────────────
  const [contacts, setContacts] = useState<AddressContact[]>([]);
  const [showContacts, setShowContacts] = useState(false);
  const [saveContactLabel, setSaveContactLabel] = useState("");
  const [showSaveContact, setShowSaveContact] = useState(false);

  // ── UTXO consolidation state ──────────────────────────────────────────────
  const [consolidateBusy, setConsolidateBusy] = useState(false);
  const [consolidateError, setConsolidateError] = useState<string | null>(null);
  const [consolidateTxId, setConsolidateTxId] = useState<string | null>(null);

  // Open send/receive panel when triggered from parent (hero buttons)
  useEffect(() => {
    if (!mode) return;
    setSelectedTokenId(null);
    setSelectedKrcToken(null);
    if (mode === "send") {
      setShowReceive(false);
      setSendStep("form");
      setPendingTx(null);
      setDryRunErrors([]);
      setErrorMsg(null);
      setResultTxId(null);
    } else {
      setShowReceive(true);
      setSendStep("idle");
    }
    onModeConsumed?.();
  }, [mode, modeRequestId, onModeConsumed]);

  useEffect(() => {
    let cancelled = false;

    const makeReceiveQr = async () => {
      if (!showReceive || !address) {
        setReceiveQrDataUrl(null);
        setReceiveQrError(null);
        return;
      }
      setReceiveQrError(null);
      try {
        const dataUrl = await QRCode.toDataURL(address, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 220,
          color: {
            dark: "#39DDB6",
            light: "#0A1118",
          },
        });
        if (cancelled) return;
        setReceiveQrDataUrl(dataUrl);
      } catch (err) {
        if (cancelled) return;
        setReceiveQrDataUrl(null);
        setReceiveQrError(err instanceof Error ? err.message : "Failed to generate QR code.");
      }
    };

    makeReceiveQr().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [showReceive, address]);

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

  useEffect(() => {
    if (usdPrice <= 0) return;
    setLiveKasPrice(usdPrice);
    setKasPriceSeries((prev) => {
      const now = Date.now();
      const next = [...prev, { ts: now, price: usdPrice }];
      return next.slice(-KAS_CHART_MAX_POINTS);
    });
    setKasFeedUpdatedAt(Date.now());
  }, [usdPrice]);

  useEffect(() => {
    if (selectedTokenId !== "KAS") return;
    let alive = true;

    const pollKasFeed = async () => {
      try {
        const [price, blueScore] = await Promise.all([
          fetchKasUsdPrice(network),
          fetchBlueScore(network),
        ]);
        if (!alive) return;
        const now = Date.now();
        if (price > 0) {
          setLiveKasPrice(price);
        }
        setKasPriceSeries((prev) => {
          const fallbackPrice = prev.length > 0 ? prev[prev.length - 1].price : 0;
          const plotPrice = price > 0 ? price : fallbackPrice;
          if (plotPrice <= 0) return prev;
          const next = [...prev, { ts: now, price: plotPrice }];
          return next.slice(-KAS_CHART_MAX_POINTS);
        });
        setKasFeedUpdatedAt(now);
        setKasFeedError(price > 0 ? null : "Price endpoint stale — plotting last known value.");
        if (blueScore != null && Number.isFinite(blueScore) && blueScore > 0) {
          setNetworkDaaScore(String(Math.trunc(blueScore)));
        }
      } catch (err) {
        if (!alive) return;
        setKasFeedError(err instanceof Error ? err.message : "Live feed unavailable.");
      }
    };

    pollKasFeed().catch(() => {});
    const pollId = window.setInterval(() => {
      pollKasFeed().catch(() => {});
    }, KAS_FEED_POLL_MS);

    return () => {
      alive = false;
      clearInterval(pollId);
    };
  }, [network, selectedTokenId, kasFeedRefreshNonce]);

  useEffect(() => {
    if (!selectedTokenId) return;
    setMetadataAddressInput("");
    setResolvedMetadata(null);
    setMetadataResolveError(null);
  }, [selectedTokenId, network]);

  useEffect(() => {
    let alive = true;
    const owner = String(address || "").trim();
    if (!owner) {
      setKrcPortfolioTokens([]);
      setKrcPortfolioError(null);
      setKrcPortfolioLoading(false);
      return;
    }

    chrome.runtime.sendMessage({ type: "FORGEOS_PREFETCH_KRC" }).catch(() => {});

    const syncPortfolio = async (allowStale = true) => {
      if (!alive) return;
      setKrcPortfolioLoading(true);
      if (!allowStale) setKrcPortfolioError(null);
      try {
        if (allowStale) {
          const prefetched = await loadPrefetchedKrcPortfolio(owner, network);
          if (alive && prefetched && prefetched.length > 0) {
            setKrcPortfolioTokens(prefetched);
          }
        }
        const entries = await fetchKrcPortfolio(owner, network);
        if (!alive) return;
        setKrcPortfolioTokens(entries);
        setKrcPortfolioError(null);
        await savePrefetchedKrcPortfolio(owner, network, entries);
      } catch (err) {
        if (!alive) return;
        setKrcPortfolioError(err instanceof Error ? err.message : "Failed to sync KRC portfolio.");
      } finally {
        if (alive) setKrcPortfolioLoading(false);
      }
    };

    syncPortfolio(true).catch(() => {});
    const pollId = window.setInterval(() => {
      syncPortfolio(false).catch(() => {});
    }, 2_500);

    return () => {
      alive = false;
      clearInterval(pollId);
    };
  }, [address, network]);

  useEffect(() => {
    setSelectedKrcToken((prev) => {
      if (!prev) return null;
      const refreshed = krcPortfolioTokens.find((item) => item.key === prev.key);
      return refreshed ?? null;
    });
  }, [krcPortfolioTokens]);

  // Propagate KRC USD total up to Popup so the hero balance includes it
  useEffect(() => {
    if (!onKrcPortfolioUpdate) return;
    const total = krcPortfolioTokens.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0);
    onKrcPortfolioUpdate(total);
  }, [krcPortfolioTokens, onKrcPortfolioUpdate]);

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
    const runId = createExecutionRunId("manual_send");
    setSendExecutionRunId(runId);

    let kernel: TxKernelModule | null = null;
    try {
      kernel = await loadTxKernel();
      const validated = await kernel.buildAndValidateKaspaIntent({
        fromAddress: address,
        network,
        recipients: [{ address: sendTo.trim(), amountKas: amountNum }],
      }, {
        onUpdate: ({ stage }) => {
          if (stage === "validate") {
            setSendStep("dry_run");
          }
        },
        telemetry: {
          channel: "manual",
          runId,
          context: {
            surface: "wallet_tab_send",
            to: sendTo.trim(),
            amountKas: amountNum,
          },
        },
      });
      setPendingTx(validated);
      setSendStep("confirm");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (kernel && err instanceof kernel.DeterministicExecutionError && err.stage === "validate") {
        if (err.details.length > 0) setDryRunErrors(err.details);
      }
      setErrorMsg(
        msg === "INSUFFICIENT_FUNDS"
          ? "Insufficient balance including fees."
          : msg === "COVENANT_ONLY_FUNDS"
            ? "Funds are currently locked in covenant outputs. Standard send only spends standard UTXOs."
            : `Build failed: ${msg}`,
      );
      setSendStep("error");
    }
  };

  const handleSign = async () => {
    if (!pendingTx || !isManaged) return;
    setSendStep("signing");

    try {
      const kernel = await loadTxKernel();
      await kernel.signBroadcastAndReconcileKaspaTx(pendingTx, {
        awaitConfirmation: true,
        telemetry: {
          channel: "manual",
          runId: sendExecutionRunId || createExecutionRunId("manual_send"),
          context: {
            surface: "wallet_tab_send",
            to: sendTo.trim(),
            amountKas: amountNum,
          },
        },
        onUpdate: async ({ stage, tx: updated }) => {
          setPendingTx(updated);
          await updatePendingTx(updated);
          if (stage === "broadcast" || stage === "reconcile") {
            setSendStep("broadcast");
          }
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
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction timed out awaiting confirmation.";
      setErrorMsg(msg);
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
    setSendExecutionRunId(null);
  };

  const copyAddress = async () => {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setAddrCopied(true); setTimeout(() => setAddrCopied(false), 2000); } catch { /* noop */ }
  };

  const openTokenDetails = (tokenId: "KAS") => {
    setSelectedKrcToken(null);
    setSelectedTokenId(tokenId);
  };

  const openKrcTokenDetails = (token: KrcPortfolioToken) => {
    setSelectedTokenId(null);
    setSelectedKrcToken(token);
    setKrc721ChartMode("floor");
    setKrc721ChartWindow(KRC721_CHART_DEFAULT_WINDOW);
  };

  const closeTokenDetails = () => {
    setSelectedTokenId(null);
    setSelectedKrcToken(null);
    setKrc721ChartMode("floor");
    setKrc721ChartWindow(KRC721_CHART_DEFAULT_WINDOW);
  };

  const resolveMetadataToken = async () => {
    const candidate = metadataAddressInput.trim();
    if (!candidate) {
      setMetadataResolveError("Paste a token address or search by symbol.");
      return;
    }
    setMetadataResolveBusy(true);
    setMetadataResolveError(null);
    try {
      const queryHit = await resolveTokenFromQuery(candidate, metadataStandard, network);
      const resolved = queryHit ?? await resolveTokenFromAddress(candidate, metadataStandard, network);
      setResolvedMetadata(resolved);
    } catch (err) {
      setResolvedMetadata(null);
      setMetadataResolveError(err instanceof Error ? err.message : "Metadata lookup failed.");
    } finally {
      setMetadataResolveBusy(false);
    }
  };

  const pasteTokenAddress = async () => {
    if (!navigator?.clipboard?.readText) {
      setMetadataResolveError("Clipboard read is unavailable in this browser.");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed) {
        setMetadataResolveError("Clipboard is empty.");
        return;
      }
      setMetadataAddressInput(trimmed);
      setMetadataResolveError(null);
      setResolvedMetadata(null);
    } catch {
      setMetadataResolveError("Failed to read clipboard.");
    }
  };

  // ── Escrow handlers ────────────────────────────────────────────────────────

  // Load persisted offers on mount and after any mutation
  useEffect(() => {
    import("../tx/escrow").then(({ loadEscrowOffers }) => {
      loadEscrowOffers().then(setEscrowOffers).catch(() => {});
    });
  }, [escrowSuccessTxId, createdOffer]);

  const handleCreateEscrow = async () => {
    const amountNum = parseFloat(escrowAmount);
    if (!amountNum || amountNum <= 0) { setEscrowError("Enter a valid KAS amount."); return; }
    if (!address) { setEscrowError("No wallet connected."); return; }
    setEscrowBusy(true);
    setEscrowError(null);
    setEscrowSuccessTxId(null);
    setCreatedOffer(null);
    setPrivKeyRevealed(false);
    try {
      const { createEscrowOffer, lockEscrow } = await import("../tx/escrow");
      const offer = await createEscrowOffer(amountNum, escrowTtl, network, escrowLabel || undefined);
      setCreatedOffer(offer);
      const txId = await lockEscrow(offer, address);
      setEscrowSuccessTxId(txId);
      setEscrowAmount("");
      setEscrowLabel("");
    } catch (err) {
      setEscrowError(err instanceof Error ? err.message : "Escrow creation failed.");
    } finally {
      setEscrowBusy(false);
    }
  };

  const handleClaimEscrow = async () => {
    if (!escrowClaimOfferAddress.trim()) { setEscrowError("Enter the escrow address."); return; }
    if (!escrowClaimPrivKey.trim()) { setEscrowError("Paste the revealed private key."); return; }
    const recipient = escrowClaimToAddress.trim() || address || "";
    if (!recipient) { setEscrowError("No recipient address available."); return; }
    setEscrowBusy(true);
    setEscrowError(null);
    setEscrowSuccessTxId(null);
    try {
      const { claimEscrow, loadEscrowOffers } = await import("../tx/escrow");
      const offers = await loadEscrowOffers();
      const match = offers.find((o) => o.escrowAddress === escrowClaimOfferAddress.trim());
      if (!match) {
        // Manual claim: build a synthetic offer from the form inputs
        const syntheticOffer = {
          id: crypto.randomUUID(),
          amountKas: 0,
          ttlMs: 0,
          network,
          escrowAddress: escrowClaimOfferAddress.trim(),
          privKeyHex: escrowClaimPrivKey.trim(),
          createdAt: 0,
          expiresAt: 0,
          status: "locked" as const,
        };
        const txId = await claimEscrow(syntheticOffer, recipient);
        setEscrowSuccessTxId(txId);
      } else {
        const withKey = { ...match, privKeyHex: escrowClaimPrivKey.trim() };
        const txId = await claimEscrow(withKey, recipient);
        setEscrowSuccessTxId(txId);
      }
      setEscrowClaimOfferAddress("");
      setEscrowClaimPrivKey("");
      setEscrowClaimToAddress("");
    } catch (err) {
      setEscrowError(err instanceof Error ? err.message : "Claim failed.");
    } finally {
      setEscrowBusy(false);
    }
  };

  const handleRefundEscrow = async (offer: EscrowOffer) => {
    if (!address) return;
    setEscrowBusy(true);
    setEscrowError(null);
    try {
      const { refundEscrow } = await import("../tx/escrow");
      const txId = await refundEscrow(offer, address);
      setEscrowSuccessTxId(txId);
    } catch (err) {
      setEscrowError(err instanceof Error ? err.message : "Refund failed.");
    } finally {
      setEscrowBusy(false);
    }
  };

  const TTL_OPTIONS = [
    { label: "1 H",  ms: 3_600_000 },
    { label: "4 H",  ms: 14_400_000 },
    { label: "24 H", ms: 86_400_000 },
    { label: "72 H", ms: 259_200_000 },
  ];

  // ── KRC-20 send handler ───────────────────────────────────────────────────

  const handleKrc20Send = async () => {
    if (!selectedKrcToken || !address) return;
    const amtNum = parseFloat(krc20SendAmt);
    if (!Number.isFinite(amtNum) || amtNum <= 0) { setKrc20Error("Enter a valid amount."); return; }
    if (!krc20SendTo.trim()) { setKrc20Error("Enter a recipient address."); return; }
    setKrc20Busy(true);
    setKrc20Error(null);
    setKrc20TxId(null);
    try {
      const { buildKrc20Transfer } = await import("../tx/krc20");
      const kernel = await loadTxKernel();
      const tx = await buildKrc20Transfer({
        fromAddress: address,
        toAddress: krc20SendTo.trim(),
        tick: selectedKrcToken.token.symbol,
        amountDisplay: amtNum,
        decimals: selectedKrcToken.token.decimals,
        network,
      });
      const result = await kernel.signBroadcastAndReconcileKaspaTx(tx);
      setKrc20TxId(result.txId ?? "broadcast-ok");
      setKrc20SendAmt("");
      setKrc20SendTo("");
    } catch (err) {
      setKrc20Error(err instanceof Error ? err.message : "KRC-20 send failed.");
    } finally {
      setKrc20Busy(false);
    }
  };

  // ── TX history handler ────────────────────────────────────────────────────

  const loadTxHistory = async () => {
    if (!address || txHistoryLoading) return;
    setTxHistoryLoading(true);
    setTxHistoryError(null);
    try {
      const history = await fetchTransactionHistory(address, network, 20);
      setTxHistory(history);
      setTxHistoryLoaded(true);
    } catch (err) {
      setTxHistoryError(err instanceof Error ? err.message : "Failed to load history.");
    } finally {
      setTxHistoryLoading(false);
    }
  };

  // ── Batch send handler ────────────────────────────────────────────────────

  const handleBatchSend = async () => {
    if (!address) return;
    const validRecipients = batchRecipients.filter((r) => r.address.trim() && parseFloat(r.amountKas) > 0);
    if (!validRecipients.length) { setBatchError("Add at least one valid recipient."); return; }
    setBatchBusy(true);
    setBatchError(null);
    setBatchTxId(null);
    try {
      const kernel = await loadTxKernel();
      const result = await kernel.executeKaspaIntent({
        fromAddress: address,
        recipients: validRecipients.map((r) => ({ address: r.address.trim(), amountKas: parseFloat(r.amountKas) })),
        network,
      });
      setBatchTxId(result.txId ?? "broadcast-ok");
      setBatchRecipients([{ address: "", amountKas: "" }]);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Batch send failed.");
    } finally {
      setBatchBusy(false);
    }
  };

  // ── Address book handlers ─────────────────────────────────────────────────

  useEffect(() => {
    import("../shared/storage").then(({ getAddressBook }) => {
      getAddressBook().then(setContacts).catch(() => {});
    });
  }, [showSaveContact]);

  const handleSaveContact = async () => {
    if (!saveContactLabel.trim() || !sendTo.trim()) return;
    const { addContact } = await import("../shared/storage");
    await addContact(saveContactLabel, sendTo);
    setSaveContactLabel("");
    setShowSaveContact(false);
  };

  const handleDeleteContact = async (id: string) => {
    const { removeContact } = await import("../shared/storage");
    await removeContact(id);
    const { getAddressBook } = await import("../shared/storage");
    setContacts(await getAddressBook());
  };

  // ── UTXO consolidation handler ────────────────────────────────────────────

  const handleConsolidate = async () => {
    if (!address || !isManaged || utxos.length < 2) return;
    setConsolidateBusy(true);
    setConsolidateError(null);
    setConsolidateTxId(null);
    try {
      const kernel = await loadTxKernel();
      // Send slightly less than full balance to self — builder selects all UTXOs to cover
      const sweepAmount = Math.max(0.001, utxoTotalKas - 0.002);
      const result = await kernel.executeKaspaIntent({
        fromAddress: address,
        network,
        recipients: [{ address, amountKas: sweepAmount }],
      });
      setConsolidateTxId(result.txId ?? "broadcast-ok");
      setUtxoReloadNonce((v) => v + 1);
    } catch (err) {
      setConsolidateError(err instanceof Error ? err.message : "Consolidation failed.");
    } finally {
      setConsolidateBusy(false);
    }
  };

  const displayTokens = getAllTokens().filter((token) => token.id === "KAS");
  const tokenLogoById: Record<string, string> = {
    KAS: "../icons/kaspa-logo.png",
  };
  const canonicalKasBalance = (utxoUpdatedAt !== null && utxoTotalKas > 0) ? utxoTotalKas : (balance ?? 0);
  const tokenBalanceById = {
    KAS: canonicalKasBalance,
  };
  const explorerBase = EXPLORERS[network] ?? EXPLORERS.mainnet;
  const explorerUrl = address ? `${explorerBase}/addresses/${address}` : explorerBase;
  const utxoTotalSompi = utxos.reduce((acc, u) => acc + u.amount, 0n);
  const utxoTotalKas = sompiToKas(utxoTotalSompi);
  const utxoLargestKas = utxos.length ? sompiToKas(utxos[0].amount) : 0;
  const utxoAverageKas = utxos.length ? utxoTotalKas / utxos.length : 0;
  const covenantUtxoCount = utxos.filter((u) => (u.scriptClass ?? "standard") === "covenant").length;
  const standardUtxoCount = utxos.length - covenantUtxoCount;
  const utxoUpdatedLabel = utxoUpdatedAt
    ? new Date(utxoUpdatedAt).toLocaleTimeString([], { hour12: false })
    : "—";
  const onChainVerified = Boolean(address && !utxoLoading && !utxoError && utxoUpdatedAt !== null);
  const verificationLabel = onChainVerified
    ? `ON-CHAIN VERIFIED · ${network.toUpperCase()} · ${utxoUpdatedLabel}`
    : utxoLoading
      ? "VERIFYING ON-CHAIN STATE…"
      : "ON-CHAIN VERIFICATION PENDING";
  const masked = (value: string) => (hideBalances ? "••••" : value);
  const maskedKas = (amount: number, digits: number) => (hideBalances ? "•••• KAS" : `${fmt(amount, digits)} KAS`);
  const maskedUsd = (amount: number, digits: number) => (hideBalances ? "$••••" : `$${fmt(amount, digits)}`);
  const selectedToken = selectedTokenId ? displayTokens.find((t) => t.id === selectedTokenId) ?? null : null;
  const selectedPortfolioToken = selectedKrcToken;
  const krcDiagnostics = getKrcPortfolioDiagnostics(network);
  const krc20HoldingsCount = krcPortfolioTokens.filter((row) => row.standard === "krc20").length;
  const krc721HoldingsCount = krcPortfolioTokens.filter((row) => row.standard === "krc721").length;
  const isStableSelectedToken = selectedToken?.id === "USDT" || selectedToken?.id === "USDC";
  const showTokenOverlay = Boolean(selectedToken || selectedPortfolioToken);
  const showActionOverlay = sendStep !== "idle" || showReceive;
  const kasSeries = kasPriceSeries.length > 0
    ? kasPriceSeries
    : liveKasPrice > 0
      ? [{ ts: Date.now(), price: liveKasPrice }]
      : [];
  const displayedKasSeries = kasSeries.slice(-Math.max(2, kasChartWindow));
  const kasWalletBalance = canonicalKasBalance;
  const kasWalletUsdValue = kasWalletBalance * (liveKasPrice > 0 ? liveKasPrice : 0);
  const selectedTokenBalance = selectedToken ? tokenBalanceById[selectedToken.id as keyof typeof tokenBalanceById] ?? 0 : 0;
  const selectedPortfolioTokenPriceUsd = selectedPortfolioToken?.market?.priceUsd
    ?? selectedPortfolioToken?.chain?.floorPriceUsd
    ?? null;
  const selectedPortfolioTokenValueUsd = selectedPortfolioToken?.valueUsd ?? null;
  const selectedPortfolioSessionChangePct = selectedPortfolioToken?.market?.change24hPct
    ?? selectedPortfolioToken?.chain?.floorChange24hPct
    ?? null;
  const selectedPortfolioRawChartPoints = selectedPortfolioToken
    ? selectedPortfolioToken.candles.map((point) => ({
      ts: point.ts,
      price: selectedPortfolioToken.standard === "krc721" && krc721ChartMode === "volume"
        ? Math.max(0, point.volumeUsd ?? 0)
        : point.valueUsd,
    }))
    : [];
  const selectedPortfolioWindowedChartPoints = selectedPortfolioToken?.standard === "krc721"
    ? selectedPortfolioRawChartPoints.slice(-Math.max(2, krc721ChartWindow))
    : selectedPortfolioRawChartPoints;
  const selectedPortfolioChartPoints = downsampleChartPoints(
    selectedPortfolioWindowedChartPoints,
    KRC721_CHART_RENDER_MAX_POINTS,
  );
  const selectedPortfolioChartLabel = selectedPortfolioToken?.standard === "krc721"
    ? (krc721ChartMode === "volume" ? "24H VOLUME TREND" : "FLOOR PRICE TREND")
    : "PRICE TREND";
  const selectedPortfolioChartUnit = selectedPortfolioToken?.standard === "krc721" && krc721ChartMode === "volume"
    ? "USD VOL"
    : "USD";
  const selectedPortfolioChartHigh = selectedPortfolioChartPoints.length > 0
    ? Math.max(...selectedPortfolioChartPoints.map((point) => point.price))
    : null;
  const selectedPortfolioChartLow = selectedPortfolioChartPoints.length > 0
    ? Math.min(...selectedPortfolioChartPoints.map((point) => point.price))
    : null;
  const chartSeries = isStableSelectedToken
    ? (displayedKasSeries.length > 0
      ? displayedKasSeries.map((point) => ({ ...point, price: 1 }))
      : [{ ts: Date.now() - 60_000, price: 1 }, { ts: Date.now(), price: 1 }])
    : displayedKasSeries;
  const chartFirstPrice = chartSeries.length > 0 ? chartSeries[0].price : 0;
  const chartLastPrice = chartSeries.length > 0 ? chartSeries[chartSeries.length - 1].price : 0;
  const chartPriceDeltaPct = chartFirstPrice > 0
    ? ((chartLastPrice - chartFirstPrice) / chartFirstPrice) * 100
    : 0;
  const chartSeriesHigh = chartSeries.length > 0 ? Math.max(...chartSeries.map((point) => point.price)) : 0;
  const chartSeriesLow = chartSeries.length > 0 ? Math.min(...chartSeries.map((point) => point.price)) : 0;
  const selectedTokenPriceUsd = isStableSelectedToken ? 1 : (liveKasPrice || usdPrice || 0);
  const selectedTokenUsdValue = selectedTokenBalance * selectedTokenPriceUsd;
  const canDismissSendOverlay = sendStep === "form" || sendStep === "error" || sendStep === "done";
  const canDismissOverlay = showTokenOverlay || showReceive || canDismissSendOverlay;
  const dismissOverlay = () => {
    if (showTokenOverlay) {
      closeTokenDetails();
      return;
    }
    if (showReceive) setShowReceive(false);
    if (sendStep !== "idle" && canDismissSendOverlay) resetSend();
  };
  const actionPanels = (
    <>
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
          <div style={{ position: "relative" }}>
            <input value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder={`Recipient ${networkPrefix}qp…`} style={{ ...inputStyle(Boolean(sendTo && !addressValid)), paddingRight: contacts.length > 0 ? 70 : undefined }} />
            {contacts.length > 0 && (
              <button
                onClick={() => setShowContacts((v) => !v)}
                style={{ position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)", background: `${C.accent}18`, border: `1px solid ${C.accent}40`, borderRadius: 4, padding: "2px 6px", color: C.accent, fontSize: 7, fontWeight: 700, cursor: "pointer", ...mono }}
              >
                CONTACTS
              </button>
            )}
          </div>
          {showContacts && contacts.length > 0 && (
            <div style={{ background: C.s2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
              {contacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setSendTo(c.address); setShowContacts(false); }}
                  style={{ background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: "3px 0", display: "flex", flexDirection: "column", gap: 1 }}
                >
                  <span style={{ fontSize: 9, color: C.accent, fontWeight: 700, ...mono }}>{c.label}</span>
                  <span style={{ fontSize: 7, color: C.dim, ...mono, wordBreak: "break-all" }}>{c.address.slice(0, 32)}…</span>
                </button>
              ))}
            </div>
          )}
          {sendTo && !addressValid && <div style={{ fontSize: 8, color: C.danger }}>{!sendTo.toLowerCase().startsWith(networkPrefix) ? `Must start with "${networkPrefix}" on ${network}` : "Invalid Kaspa address"}</div>}
          {addressValid && sendTo && !contacts.find((c) => c.address === sendTo) && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              {!showSaveContact ? (
                <button onClick={() => setShowSaveContact(true)} style={{ background: "none", border: "none", color: C.dim, fontSize: 7, cursor: "pointer", ...mono, textDecoration: "underline" }}>
                  + save to contacts
                </button>
              ) : (
                <>
                  <input value={saveContactLabel} onChange={(e) => setSaveContactLabel(e.target.value)} placeholder="Contact label" style={{ ...inputStyle(false), flex: 1, fontSize: 8, padding: "3px 6px" }} />
                  <button onClick={handleSaveContact} style={{ ...outlineButton(C.ok, true), padding: "3px 7px", fontSize: 7, color: C.ok }}>SAVE</button>
                  <button onClick={() => { setShowSaveContact(false); setSaveContactLabel(""); }} style={{ background: "none", border: "none", color: C.dim, fontSize: 7, cursor: "pointer", ...mono }}>✕</button>
                </>
              )}
            </div>
          )}
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
          <div style={{ ...insetCard(), display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 8, color: onChainVerified ? C.ok : C.warn, fontWeight: 700, letterSpacing: "0.06em" }}>
              {verificationLabel}
            </div>
            <button
              onClick={() => chrome.tabs.create({ url: explorerUrl })}
              style={{ ...outlineButton(C.accent, true), padding: "4px 7px", fontSize: 8, color: C.accent, flexShrink: 0 }}
            >
              EXPLORER ↗
            </button>
          </div>
          <div style={{ ...insetCard(), display: "flex", justifyContent: "center", alignItems: "center", minHeight: 140, marginBottom: 6 }}>
            {receiveQrDataUrl ? (
              <img
                src={receiveQrDataUrl}
                alt="Wallet receive QR"
                style={{ width: 138, height: 138, borderRadius: 8, border: `1px solid ${C.border}` }}
              />
            ) : (
              <div style={{ fontSize: 8, color: receiveQrError ? C.danger : C.dim }}>
                {receiveQrError ? "QR ERROR" : "GENERATING QR…"}
              </div>
            )}
          </div>
          <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.08em" }}>CONNECTED WALLET ADDRESS</div>
          <div style={{ ...insetCard(), fontSize: 8, color: C.dim, lineHeight: 1.6, wordBreak: "break-all", marginBottom: 6 }}>{address}</div>
          <button onClick={copyAddress} style={{ ...outlineButton(addrCopied ? C.ok : C.dim, true), padding: "7px 8px", color: addrCopied ? C.ok : C.dim, width: "100%" }}>
            {addrCopied ? "✓ COPIED" : "COPY ADDRESS"}
          </button>
          <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5, marginTop: 4 }}>
            Send KAS to this address from any Kaspa wallet. Funds and UTXO state are verified against live on-chain data.
          </div>
        </div>
      )}
    </>
  );

  const tokenDetailsPanel = selectedToken ? (
    <div style={panel()}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={sectionTitle}>TOKEN ANALYTICS</div>
        <button
          onClick={closeTokenDetails}
          style={{ background: "none", border: "none", color: C.dim, fontSize: 9, cursor: "pointer", ...mono }}
        >
          ✕
        </button>
      </div>

      <div style={{ ...insetCard(), display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img
            src={tokenLogoById[selectedToken.id] ?? tokenLogoById.KAS}
            alt={`${selectedToken.symbol} logo`}
            style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "contain" }}
          />
          <div>
            <div style={{ fontSize: 11, color: C.text, fontWeight: 700, letterSpacing: "0.05em", ...mono }}>
              {selectedToken.symbol}
            </div>
            <div style={{ fontSize: 8, color: C.dim }}>
              {selectedToken.name} · {network.toUpperCase()}
            </div>
          </div>
        </div>
        <div
          style={{
            ...outlineButton(selectedToken.id === "KAS" || isStableSelectedToken ? C.ok : C.warn, true),
            padding: "4px 7px",
            fontSize: 8,
            color: selectedToken.id === "KAS" || isStableSelectedToken ? C.ok : C.warn,
          }}
        >
          {selectedToken.id === "KAS" ? "LIVE FEED" : isStableSelectedToken ? "STABLE PEG" : "METADATA FEED"}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
        <MetricTile
          label={selectedToken.id === "KAS" || isStableSelectedToken ? "LIVE PRICE" : "TOKEN STATUS"}
          value={selectedToken.id === "KAS" || isStableSelectedToken
            ? maskedUsd(selectedTokenPriceUsd, 4)
            : (selectedToken.enabled ? "ENABLED" : "READ-ONLY")}
          tone={selectedToken.id === "KAS" || isStableSelectedToken ? C.accent : selectedToken.enabled ? C.ok : C.warn}
        />
        <MetricTile
          label={selectedToken.id === "KAS" || isStableSelectedToken ? "SESSION Δ" : "DECIMALS"}
          value={selectedToken.id === "KAS" || isStableSelectedToken
            ? `${hideBalances ? "••••" : isStableSelectedToken ? "0.00%" : `${chartPriceDeltaPct >= 0 ? "+" : ""}${fmt(chartPriceDeltaPct, 2)}%`}`
            : String(selectedToken.decimals)}
          tone={selectedToken.id === "KAS" || isStableSelectedToken ? (chartPriceDeltaPct >= 0 ? C.ok : C.danger) : C.text}
        />
        <MetricTile
          label={selectedToken.id === "KAS" || isStableSelectedToken ? "BALANCE" : "TOKEN ID"}
          value={selectedToken.id === "KAS"
            ? maskedKas(kasWalletBalance, 4)
            : isStableSelectedToken
              ? `${masked(fmt(selectedTokenBalance, 2))} ${selectedToken.symbol}`
              : selectedToken.id}
          tone={C.text}
        />
        <MetricTile
          label={selectedToken.id === "KAS" || isStableSelectedToken ? "USD VALUE" : "FEED UPDATE"}
          value={selectedToken.id === "KAS" || isStableSelectedToken
            ? maskedUsd(selectedToken.id === "KAS" ? kasWalletUsdValue : selectedTokenUsdValue, 2)
            : (kasFeedUpdatedAt ? new Date(kasFeedUpdatedAt).toLocaleTimeString([], { hour12: false }) : "—")}
          tone={selectedToken.id === "KAS" || isStableSelectedToken ? C.accent : C.dim}
        />
      </div>

      <div style={insetCard()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: kasFeedError ? C.danger : C.ok,
                boxShadow: kasFeedError ? `0 0 6px ${C.danger}` : `0 0 6px ${C.ok}`,
              }}
            />
            {selectedToken.id === "KAS" ? "REAL-TIME KAS/USD CHART" : isStableSelectedToken ? "STABLECOIN PEG CHART" : "BASE LAYER LIVE CHART"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {([60, 300, KAS_CHART_MAX_POINTS] as const).map((windowSize) => (
              <button
                key={windowSize}
                onClick={() => setKasChartWindow(windowSize)}
                style={{
                  ...outlineButton(kasChartWindow === windowSize ? C.accent : C.dim, true),
                  padding: "3px 6px",
                  fontSize: 8,
                  color: kasChartWindow === windowSize ? C.accent : C.dim,
                }}
              >
                {windowSize === 60 ? "1M" : windowSize === 300 ? "5M" : "15M"}
              </button>
            ))}
            <button
              onClick={() => setKasFeedRefreshNonce((value) => value + 1)}
              style={{ ...outlineButton(C.dim, true), padding: "3px 6px", fontSize: 8, color: C.dim }}
            >
              REFRESH
            </button>
          </div>
        </div>
        <LiveLineChart points={chartSeries} color={C.accent} />
        <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", fontSize: 8, color: C.dim }}>
          <span>LOW {maskedUsd(chartSeriesLow, 4)}</span>
          <span>HIGH {maskedUsd(chartSeriesHigh, 4)}</span>
        </div>
        <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", fontSize: 8, color: C.muted }}>
          <span>{kasFeedUpdatedAt ? "live stream active" : "connecting to live stream…"}</span>
          <span>{chartSeries.length} live points</span>
        </div>
        {selectedToken.id !== "KAS" && (
          <div style={{ marginTop: 6, fontSize: 8, color: C.dim, lineHeight: 1.45 }}>
            {isStableSelectedToken
              ? "Stablecoin chart is pegged to $1.00 in-wallet by design for USDT/USDC analytics."
              : "Spot chart reflects live Kaspa base feed. Token-specific pricing requires a trusted market route."}
          </div>
        )}
      </div>

      <div style={insetCard()}>
        <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.08em", marginBottom: 5 }}>ON-CHAIN TECHNICALS</div>
        <div style={{ fontSize: 8, color: C.text, lineHeight: 1.55 }}>
          Network BPS: <span style={{ color: C.accent }}>{NETWORK_BPS[network] ?? 10}</span>
        </div>
        <div style={{ fontSize: 8, color: C.text, lineHeight: 1.55 }}>
          Virtual DAA: <span style={{ color: C.accent }}>{networkDaaScore ?? "—"}</span>
        </div>
        <div style={{ fontSize: 8, color: C.text, lineHeight: 1.55 }}>
          Spendable UTXOs: <span style={{ color: C.ok }}>{standardUtxoCount}</span> · Covenant UTXOs:{" "}
          <span style={{ color: covenantUtxoCount > 0 ? C.warn : C.dim }}>{covenantUtxoCount}</span>
        </div>
        <div style={{ fontSize: 8, color: C.text, lineHeight: 1.55 }}>
          Largest UTXO: <span style={{ color: C.accent }}>{maskedKas(utxoLargestKas, 4)}</span> · Avg UTXO:{" "}
          <span style={{ color: C.accent }}>{maskedKas(utxoAverageKas, 4)}</span>
        </div>
        {kasFeedError && (
          <div style={{ fontSize: 8, color: C.danger, marginTop: 5, lineHeight: 1.45 }}>
            Feed warning: {kasFeedError}
          </div>
        )}
      </div>

      {selectedToken.id !== "KAS" && (
        <div style={insetCard()}>
          <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.08em", marginBottom: 6 }}>
            KRC TOKEN ADDRESS LOOKUP
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input
              value={metadataAddressInput}
              onChange={(event) => setMetadataAddressInput(event.target.value)}
              placeholder="Search symbol/name or paste token address…"
              style={{ ...inputStyle(Boolean(metadataResolveError)), flex: 1, marginBottom: 0 }}
            />
            <button
              onClick={pasteTokenAddress}
              style={{ ...outlineButton(C.dim, true), padding: "7px 8px", color: C.dim, fontSize: 8 }}
            >
              PASTE
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {(["krc20", "krc721"] as KaspaTokenStandard[]).map((standard) => (
              <button
                key={standard}
                onClick={() => setMetadataStandard(standard)}
                style={{
                  ...outlineButton(metadataStandard === standard ? C.accent : C.dim, true),
                  padding: "6px 8px",
                  color: metadataStandard === standard ? C.accent : C.dim,
                  fontSize: 8,
                  flex: 1,
                }}
              >
                {standard.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={resolveMetadataToken}
            disabled={metadataResolveBusy || !metadataAddressInput.trim()}
            style={{ ...submitBtn(Boolean(metadataAddressInput.trim()) && !metadataResolveBusy), marginTop: 0 }}
          >
            {metadataResolveBusy ? "RESOLVING…" : "RESOLVE TOKEN METADATA"}
          </button>
          {metadataResolveError && (
            <div style={{ fontSize: 8, color: C.danger, marginTop: 6, lineHeight: 1.45 }}>
              {metadataResolveError}
            </div>
          )}
          {resolvedMetadata && (
            <div style={{ ...insetCard(), marginTop: 7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <img
                  src={resolvedMetadata.logoUri}
                  alt={`${resolvedMetadata.symbol} logo`}
                  style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", border: `1px solid ${C.border}` }}
                />
                <div>
                  <div style={{ fontSize: 10, color: C.text, fontWeight: 700, ...mono }}>{resolvedMetadata.symbol}</div>
                  <div style={{ fontSize: 8, color: C.dim }}>{resolvedMetadata.name}</div>
                </div>
              </div>
              <div style={{ fontSize: 8, color: C.text, lineHeight: 1.5, wordBreak: "break-all" }}>
                {resolvedMetadata.address}
              </div>
              <div style={{ fontSize: 8, color: C.dim, marginTop: 4 }}>
                Standard: {resolvedMetadata.standard.toUpperCase()} · Decimals: {resolvedMetadata.decimals}
              </div>
            </div>
          )}
          <div style={{ fontSize: 7, color: C.muted, lineHeight: 1.45, marginTop: 6 }}>
            Resolver is env-driven with bounded LRU + endpoint health scoring for low-latency repeated lookups.
          </div>
        </div>
      )}
    </div>
  ) : null;

  const krcTokenDetailsPanel = selectedPortfolioToken ? (
    <div style={panel()}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={sectionTitle}>KRC TOKEN ANALYTICS</div>
        <button
          onClick={closeTokenDetails}
          style={{ background: "none", border: "none", color: C.dim, fontSize: 9, cursor: "pointer", ...mono }}
        >
          ✕
        </button>
      </div>

      <div style={{ ...insetCard(), display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <img
            src={selectedPortfolioToken.token.logoUri}
            alt={`${selectedPortfolioToken.token.symbol} logo`}
            style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", border: `1px solid ${C.border}` }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: C.text, fontWeight: 700, letterSpacing: "0.05em", ...mono }}>
              {selectedPortfolioToken.token.symbol}
            </div>
            <div style={{ fontSize: 8, color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>
              {selectedPortfolioToken.token.name} · {selectedPortfolioToken.standard.toUpperCase()} · {network.toUpperCase()}
            </div>
          </div>
        </div>
        <div style={{ ...outlineButton(C.ok, true), padding: "4px 7px", fontSize: 8, color: C.ok }}>
          LIVE
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
        <MetricTile
          label="PRICE USD"
          value={selectedPortfolioTokenPriceUsd != null ? maskedUsd(selectedPortfolioTokenPriceUsd, 6) : "—"}
          tone={selectedPortfolioTokenPriceUsd != null ? C.accent : C.dim}
        />
        <MetricTile
          label="SESSION Δ"
          value={
            selectedPortfolioSessionChangePct != null
              ? `${hideBalances ? "••••" : `${selectedPortfolioSessionChangePct >= 0 ? "+" : ""}${fmt(selectedPortfolioSessionChangePct, 2)}%`}`
              : "—"
          }
          tone={selectedPortfolioSessionChangePct != null
            ? (selectedPortfolioSessionChangePct >= 0 ? C.ok : C.danger)
            : C.dim}
        />
        <MetricTile
          label="BALANCE"
          value={`${masked(selectedPortfolioToken.balanceDisplay)} ${selectedPortfolioToken.token.symbol}`}
          tone={C.text}
        />
        <MetricTile
          label="USD VALUE"
          value={selectedPortfolioTokenValueUsd != null ? maskedUsd(selectedPortfolioTokenValueUsd, 2) : "—"}
          tone={selectedPortfolioTokenValueUsd != null ? C.accent : C.dim}
        />
      </div>

      <div style={insetCard()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.08em" }}>
            {selectedPortfolioChartLabel}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {selectedPortfolioToken.standard === "krc721" && (
              <>
                <button
                  onClick={() => setKrc721ChartMode("floor")}
                  style={{
                    ...outlineButton(krc721ChartMode === "floor" ? C.accent : C.dim, true),
                    padding: "3px 6px",
                    fontSize: 8,
                    color: krc721ChartMode === "floor" ? C.accent : C.dim,
                  }}
                >
                  FLOOR
                </button>
                <button
                  onClick={() => setKrc721ChartMode("volume")}
                  style={{
                    ...outlineButton(krc721ChartMode === "volume" ? C.accent : C.dim, true),
                    padding: "3px 6px",
                    fontSize: 8,
                    color: krc721ChartMode === "volume" ? C.accent : C.dim,
                  }}
                >
                  VOLUME
                </button>
              </>
            )}
            <div style={{ fontSize: 8, color: C.muted }}>
              {selectedPortfolioWindowedChartPoints.length} pts
            </div>
          </div>
        </div>
        {selectedPortfolioToken.standard === "krc721" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {KRC721_CHART_WINDOWS.map((windowSize) => (
                <button
                  key={windowSize}
                  onClick={() => setKrc721ChartWindow(windowSize)}
                  style={{
                    ...outlineButton(krc721ChartWindow === windowSize ? C.accent : C.dim, true),
                    padding: "3px 6px",
                    fontSize: 8,
                    color: krc721ChartWindow === windowSize ? C.accent : C.dim,
                  }}
                >
                  {formatKrc721WindowLabel(windowSize)}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 8, color: C.muted }}>
              render {selectedPortfolioChartPoints.length}
            </div>
          </div>
        )}
        <LiveLineChart points={selectedPortfolioChartPoints} color={C.accent} />
        <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", fontSize: 8, color: C.dim }}>
          <span>LOW {selectedPortfolioChartLow != null ? maskedUsd(selectedPortfolioChartLow, 4) : "—"}</span>
          <span>HIGH {selectedPortfolioChartHigh != null ? maskedUsd(selectedPortfolioChartHigh, 4) : "—"}</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 8, color: C.muted }}>
          UNIT: {selectedPortfolioChartUnit}
        </div>
      </div>

      <div style={insetCard()}>
        <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.08em", marginBottom: 5 }}>CHAIN INFO</div>
        <div style={{ fontSize: 8, color: C.text, lineHeight: 1.55, wordBreak: "break-all" }}>
          Address: <span style={{ color: C.accent }}>{selectedPortfolioToken.token.address}</span>
        </div>
        <div style={{ fontSize: 8, color: C.text, lineHeight: 1.55 }}>
          Holders: <span style={{ color: C.accent }}>{selectedPortfolioToken.chain?.holders ?? "—"}</span>
        </div>
        <div style={{ fontSize: 8, color: C.text, lineHeight: 1.55 }}>
          Owners: <span style={{ color: C.accent }}>{selectedPortfolioToken.chain?.owners ?? "—"}</span> · Listed:{" "}
          <span style={{ color: C.accent }}>{selectedPortfolioToken.chain?.listedCount ?? "—"}</span>
        </div>
        <div style={{ fontSize: 8, color: C.text, lineHeight: 1.55 }}>
          Supply: <span style={{ color: C.accent }}>{selectedPortfolioToken.chain?.supply ?? "—"}</span>
        </div>
        <div style={{ fontSize: 8, color: C.text, lineHeight: 1.55 }}>
          Collection Items: <span style={{ color: C.accent }}>{selectedPortfolioToken.chain?.collectionItems ?? "—"}</span> · 24h Sales:{" "}
          <span style={{ color: C.accent }}>{selectedPortfolioToken.chain?.sales24h ?? "—"}</span>
        </div>
        <div style={{ fontSize: 8, color: C.text, lineHeight: 1.55 }}>
          24h Tx: <span style={{ color: C.accent }}>{selectedPortfolioToken.chain?.txCount24h ?? "—"}</span> · 24h Volume USD:{" "}
          <span style={{ color: C.accent }}>
            {selectedPortfolioToken.chain?.volume24hUsd != null ? fmt(selectedPortfolioToken.chain.volume24hUsd, 2) : "—"}
          </span>
        </div>
        <div style={{ fontSize: 8, color: C.text, lineHeight: 1.55 }}>
          Floor USD:{" "}
          <span style={{ color: C.accent }}>
            {selectedPortfolioToken.chain?.floorPriceUsd != null ? fmt(selectedPortfolioToken.chain.floorPriceUsd, 4) : "—"}
          </span>
          {" "}· Floor Δ 24h:{" "}
          <span
            style={{
              color: selectedPortfolioToken.chain?.floorChange24hPct == null
                ? C.accent
                : selectedPortfolioToken.chain.floorChange24hPct >= 0 ? C.ok : C.danger,
            }}
          >
            {selectedPortfolioToken.chain?.floorChange24hPct != null
              ? `${selectedPortfolioToken.chain.floorChange24hPct >= 0 ? "+" : ""}${fmt(selectedPortfolioToken.chain.floorChange24hPct, 2)}%`
              : "—"}
          </span>
        </div>
        <div style={{ fontSize: 8, color: C.text, lineHeight: 1.55 }}>
          Market Cap USD:{" "}
          <span style={{ color: C.accent }}>
            {selectedPortfolioToken.chain?.marketCapUsd != null ? fmt(selectedPortfolioToken.chain.marketCapUsd, 2) : "—"}
          </span>
        </div>
      </div>

      {/* KRC-20 send */}
      {selectedPortfolioToken.standard === "krc20" && isManaged && (
        <div>
          {!krc20SendMode ? (
            <button
              onClick={() => { setKrc20SendMode(true); setKrc20Error(null); setKrc20TxId(null); }}
              style={{ ...outlineButton(C.accent, true), width: "100%", padding: "8px", fontSize: 9, color: C.accent, fontWeight: 700, letterSpacing: "0.06em" }}
            >
              SEND {selectedPortfolioToken.token.symbol} →
            </button>
          ) : (
            <div style={insetCard()}>
              <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.08em", marginBottom: 7 }}>
                SEND {selectedPortfolioToken.token.symbol} · bal: {masked(selectedPortfolioToken.balanceDisplay)}
              </div>
              <input
                type="text"
                placeholder={`Recipient ${networkPrefix}q…`}
                value={krc20SendTo}
                onChange={(e) => setKrc20SendTo(e.target.value)}
                style={{ ...inputStyle(Boolean(krc20Error && !krc20TxId)), marginBottom: 5, fontSize: 9 }}
              />
              <input
                type="number"
                placeholder={`Amount (${selectedPortfolioToken.token.symbol})`}
                value={krc20SendAmt}
                onChange={(e) => setKrc20SendAmt(e.target.value)}
                style={{ ...inputStyle(false), marginBottom: 5, fontSize: 9 }}
              />
              {krc20Error && <div style={{ fontSize: 8, color: C.danger, marginBottom: 4, lineHeight: 1.4 }}>{krc20Error}</div>}
              {krc20TxId && (
                <div style={{ fontSize: 8, color: C.ok, marginBottom: 4, wordBreak: "break-all", lineHeight: 1.4 }}>
                  ✓ Sent! TX: {krc20TxId.slice(0, 20)}…
                  <button
                    onClick={() => chrome.tabs.create({ url: `${explorerBase}/txs/${krc20TxId}` })}
                    style={{ background: "none", border: "none", color: C.accent, fontSize: 8, cursor: "pointer", ...mono, marginLeft: 5 }}
                  >
                    View ↗
                  </button>
                </div>
              )}
              <div style={{ display: "flex", gap: 5 }}>
                <button
                  onClick={handleKrc20Send}
                  disabled={krc20Busy}
                  style={{ ...submitBtn(!krc20Busy), flex: 1, padding: "7px", fontSize: 9 }}
                >
                  {krc20Busy ? "SENDING…" : "CONFIRM SEND"}
                </button>
                <button
                  onClick={() => { setKrc20SendMode(false); setKrc20Error(null); setKrc20TxId(null); setKrc20SendAmt(""); setKrc20SendTo(""); }}
                  style={{ ...outlineButton(C.muted, true), padding: "7px 10px", fontSize: 9, color: C.muted }}
                >
                  CANCEL
                </button>
              </div>
              <div style={{ fontSize: 7, color: C.dim, marginTop: 5, lineHeight: 1.4 }}>
                Sends a KRC-20 inscription (+0.3 KAS dust) to the recipient address.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div style={{ ...popupTabStack, position: "relative" }}>
      {(showActionOverlay || showTokenOverlay) && (
        <div
          style={overlayBackdrop}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            if (!canDismissOverlay) return;
            dismissOverlay();
          }}
        >
          <div style={overlayCard}>
            {showTokenOverlay ? (selectedPortfolioToken ? krcTokenDetailsPanel : tokenDetailsPanel) : actionPanels}
          </div>
        </div>
      )}

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
          <div style={sectionKicker}>ALL HOLDINGS</div>
        </div>

        {displayTokens.map((token, idx) => {
          const tokenLogo = tokenLogoById[token.id] ?? tokenLogoById.KAS;
          const isKasToken = token.id === "KAS";
          const tokenBalanceUnits = tokenBalanceById[token.id as TokenId] ?? 0;
          const tokenAmountLabelRaw = token.id === "KAS" ? fmt(tokenBalanceUnits, 4) : fmt(tokenBalanceUnits, 2);
          const tokenAmountLabel = masked(tokenAmountLabelRaw);
          const tokenUsdValue = isKasToken ? tokenBalanceUnits * (liveKasPrice > 0 ? liveKasPrice : 0) : 0;
          return (
          <button
            key={token.id}
            onClick={() => openTokenDetails("KAS")}
            style={{
              width: "100%",
              border: "none",
              textAlign: "left",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "linear-gradient(160deg, rgba(15,24,36,0.86), rgba(8,14,22,0.88))",
              borderRadius: 12,
              padding: "10px 11px",
              marginTop: idx > 0 ? 8 : 0,
              opacity: isKasToken ? 1 : token.enabled ? 1 : 0.58,
              position: "relative",
              zIndex: 1,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                border: `1px solid ${selectedTokenId === token.id ? `${C.accent}75` : C.border}`,
                borderRadius: 12,
                pointerEvents: "none",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                flexShrink: 0,
                background: "rgba(57,221,182,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1px solid ${C.border}`,
                overflow: "hidden",
              }}>
                <img
                  src={tokenLogo}
                  alt={`${token.symbol} logo`}
                  style={{
                    width: 24,
                    height: 24,
                    objectFit: "contain",
                    borderRadius: "50%",
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.text, letterSpacing: "0.05em", ...mono }}>{token.symbol}</div>
                <div style={{ fontSize: 9, color: C.dim, letterSpacing: "0.03em" }}>{token.name}</div>
              </div>
            </div>
            <div style={{ textAlign: "right", paddingRight: 12, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, ...mono }}>
                {tokenAmountLabel}
              </div>
              {isKasToken && tokenUsdValue > 0 && (
                <div style={{ fontSize: 10, color: C.dim, marginTop: 1, ...mono }}>
                  {maskedUsd(tokenUsdValue, 2)}
                </div>
              )}
              {!token.enabled && token.disabledReason && (
                <div style={{ fontSize: 8, color: C.dim, maxWidth: 140, lineHeight: 1.35, marginTop: 3 }}>
                  {token.disabledReason}
                </div>
              )}
            </div>
            <div style={{ fontSize: 10, color: C.dim, ...mono }}>→</div>
          </button>
        )})}

        {krcPortfolioLoading && (
          <div style={{ ...insetCard(), marginTop: 8, fontSize: 8, color: C.dim }}>
            Syncing KRC holdings…
          </div>
        )}

        {krcPortfolioError && (
          <div style={{ ...insetCard(), marginTop: 8, fontSize: 8, color: C.warn, lineHeight: 1.45 }}>
            KRC feed warning: {krcPortfolioError}
          </div>
        )}

        <div style={{ ...insetCard(), marginTop: 8, fontSize: 8, lineHeight: 1.45 }}>
          <div style={{ color: C.dim, letterSpacing: "0.08em", marginBottom: 4 }}>KRC HOLDINGS SUPPORT</div>
          <div style={{ color: C.text }}>
            KRC20: <span style={{ color: C.accent, ...mono }}>{krc20HoldingsCount}</span> · KRC721:{" "}
            <span style={{ color: C.accent, ...mono }}>{krc721HoldingsCount}</span> held
          </div>
          <div style={{ color: krcDiagnostics.holdingsDiscoveryReady ? C.dim : C.warn }}>
            Discovery endpoints — indexer {krcDiagnostics.indexerEndpoints}, market {krcDiagnostics.marketEndpoints}, candles {krcDiagnostics.candlesEndpoints}
          </div>
          {!krcDiagnostics.holdingsDiscoveryReady && (
            <div style={{ color: C.warn, marginTop: 3 }}>
              Configure `VITE_KASPA_KASPLEX_*_API_ENDPOINTS` or `VITE_KRC_INDEXER_*_ENDPOINTS` to discover held KRC20/KRC721 assets.
            </div>
          )}
        </div>

        {krcPortfolioTokens.map((token, idx) => {
          const krcChange = token.market?.change24hPct ?? token.chain?.floorChange24hPct ?? null;
          const krcChangeColor = krcChange == null ? C.dim : krcChange >= 0 ? C.ok : C.danger;
          return (
          <button
            key={token.key}
            onClick={() => openKrcTokenDetails(token)}
            style={{
              width: "100%",
              border: "none",
              textAlign: "left",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "linear-gradient(160deg, rgba(13,22,34,0.9), rgba(7,12,20,0.9))",
              borderRadius: 12,
              padding: "10px 11px",
              marginTop: idx > 0 || displayTokens.length > 0 ? 8 : 0,
              position: "relative",
              zIndex: 1,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                border: `1px solid ${selectedKrcToken?.key === token.key ? `${C.accent}75` : C.border}`,
                borderRadius: 12,
                pointerEvents: "none",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                flexShrink: 0,
                background: "rgba(255,255,255,0.04)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1px solid ${C.border}`,
                overflow: "hidden",
              }}>
                <img
                  src={token.token.logoUri}
                  alt={`${token.token.symbol} logo`}
                  style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }}
                />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.text, letterSpacing: "0.05em", ...mono }}>
                  {token.token.symbol}
                </div>
                <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.03em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>
                  {token.token.name} · {token.standard.toUpperCase()}
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right", paddingRight: 12, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, ...mono }}>
                {masked(token.balanceDisplay)}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5, marginTop: 2 }}>
                <span style={{ fontSize: 10, color: token.valueUsd != null ? C.accent : C.dim, ...mono }}>
                  {token.valueUsd != null ? maskedUsd(token.valueUsd, 2) : "no spot"}
                </span>
                {krcChange != null && (
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: krcChangeColor,
                    background: `${krcChangeColor}18`,
                    borderRadius: 4,
                    padding: "1px 5px",
                    ...mono,
                  }}>
                    {krcChange >= 0 ? "+" : ""}{krcChange.toFixed(2)}%
                  </span>
                )}
              </div>
            </div>
            <div style={{ fontSize: 10, color: C.dim, ...mono }}>→</div>
          </button>
        );})}


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

      {/* OTC ESCROW */}
      <div style={sectionCard("default")}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: escrowMode !== "none" ? 9 : 0 }}>
          <div>
            <div style={sectionKicker}>OTC ESCROW</div>
            {escrowMode === "none" && (
              <div style={{ fontSize: 8, color: C.dim, marginTop: 2, lineHeight: 1.4 }}>
                Trustless P2PK escrow — no smart contracts needed.
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            <button
              onClick={() => { setEscrowMode(escrowMode === "create" ? "none" : "create"); setEscrowError(null); setEscrowSuccessTxId(null); setCreatedOffer(null); }}
              style={{ ...outlineButton(escrowMode === "create" ? C.accent : C.dim, true), padding: "5px 8px", fontSize: 8, color: escrowMode === "create" ? C.accent : C.dim }}
            >
              CREATE
            </button>
            <button
              onClick={() => { setEscrowMode(escrowMode === "claim" ? "none" : "claim"); setEscrowError(null); setEscrowSuccessTxId(null); }}
              style={{ ...outlineButton(escrowMode === "claim" ? C.ok : C.dim, true), padding: "5px 8px", fontSize: 8, color: escrowMode === "claim" ? C.ok : C.dim }}
            >
              CLAIM
            </button>
          </div>
        </div>

        {/* CREATE OFFER form */}
        {escrowMode === "create" && !createdOffer && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.45 }}>
              Locks KAS into a disposable address. Share the address for on-chain verification, then reveal the private key to release funds.
            </div>
            <input
              value={escrowAmount}
              onChange={(e) => setEscrowAmount(e.target.value)}
              placeholder="Amount (KAS)"
              type="number"
              min="0"
              style={inputStyle(false)}
            />
            <div style={{ display: "flex", gap: 5 }}>
              {TTL_OPTIONS.map((opt) => (
                <button
                  key={opt.ms}
                  onClick={() => setEscrowTtl(opt.ms)}
                  style={{
                    ...outlineButton(escrowTtl === opt.ms ? C.accent : C.dim, true),
                    flex: 1, padding: "5px 0", fontSize: 8,
                    color: escrowTtl === opt.ms ? C.accent : C.dim,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <input
              value={escrowLabel}
              onChange={(e) => setEscrowLabel(e.target.value)}
              placeholder="Label (optional — e.g. KRC20 deal)"
              style={inputStyle(false)}
            />
            <button
              onClick={handleCreateEscrow}
              disabled={escrowBusy || !escrowAmount}
              style={submitBtn(Boolean(escrowAmount) && !escrowBusy)}
            >
              {escrowBusy ? "CREATING…" : "LOCK KAS INTO ESCROW →"}
            </button>
          </div>
        )}

        {/* Show created offer details */}
        {escrowMode === "create" && createdOffer && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {escrowSuccessTxId ? (
              <div style={{ ...insetCard(), background: `${C.ok}0A`, borderColor: `${C.ok}30` }}>
                <div style={{ fontSize: 9, color: C.ok, fontWeight: 700, marginBottom: 4 }}>✓ ESCROW LOCKED</div>
                <div style={{ fontSize: 8, color: C.dim, marginBottom: 2 }}>Lock TX: {escrowSuccessTxId.slice(0, 20)}…</div>
              </div>
            ) : (
              <div style={{ ...insetCard(), background: `${C.warn}0A`, borderColor: `${C.warn}30` }}>
                <div style={{ fontSize: 8, color: C.warn }}>Locking in progress…</div>
              </div>
            )}
            <div style={{ ...insetCard() }}>
              <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.06em", marginBottom: 3 }}>ESCROW ADDRESS</div>
              <div style={{ fontSize: 8, color: C.text, wordBreak: "break-all", lineHeight: 1.5, marginBottom: 6 }}>
                {createdOffer.escrowAddress}
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(createdOffer.escrowAddress).catch(() => {})}
                style={{ ...outlineButton(C.dim, true), padding: "4px 7px", fontSize: 8, color: C.dim }}
              >
                COPY ADDRESS
              </button>
            </div>
            <div style={{ ...insetCard(), borderColor: `${C.warn}40`, background: `${C.warn}08` }}>
              <div style={{ fontSize: 8, color: C.warn, fontWeight: 700, marginBottom: 4 }}>
                ⚠ PRIVATE KEY (release to buyer after payment confirmed)
              </div>
              {privKeyRevealed ? (
                <>
                  <div style={{ fontSize: 8, color: C.text, wordBreak: "break-all", lineHeight: 1.5, marginBottom: 6, ...mono }}>
                    {createdOffer.privKeyHex}
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(createdOffer.privKeyHex).catch(() => {})}
                    style={{ ...outlineButton(C.warn, true), padding: "4px 7px", fontSize: 8, color: C.warn }}
                  >
                    COPY KEY
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setPrivKeyRevealed(true)}
                  style={{ ...outlineButton(C.warn, true), padding: "5px 8px", fontSize: 8, color: C.warn, width: "100%" }}
                >
                  REVEAL PRIVATE KEY
                </button>
              )}
            </div>
            <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.45 }}>
              Share the escrow address with the buyer. Once they confirm payment on-chain, share the private key to release funds. Expires: {new Date(createdOffer.expiresAt).toLocaleString()}.
            </div>
            <button
              onClick={() => { setCreatedOffer(null); setEscrowMode("none"); setPrivKeyRevealed(false); setEscrowSuccessTxId(null); }}
              style={{ ...outlineButton(C.dim, true), padding: "6px 8px", fontSize: 8, color: C.dim }}
            >
              DONE
            </button>
          </div>
        )}

        {/* CLAIM OFFER form */}
        {escrowMode === "claim" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.45 }}>
              Enter the escrow address and the private key revealed by the seller to sweep funds to your wallet.
            </div>
            {escrowSuccessTxId ? (
              <div style={{ ...insetCard(), background: `${C.ok}0A`, borderColor: `${C.ok}30` }}>
                <div style={{ fontSize: 9, color: C.ok, fontWeight: 700, marginBottom: 4 }}>✓ CLAIMED</div>
                <div style={{ fontSize: 8, color: C.dim }}>TX: {escrowSuccessTxId.slice(0, 20)}…</div>
                <button onClick={() => { setEscrowSuccessTxId(null); }} style={{ ...outlineButton(C.dim, true), padding: "4px 7px", fontSize: 8, color: C.dim, marginTop: 6 }}>CLAIM ANOTHER</button>
              </div>
            ) : (
              <>
                <input
                  value={escrowClaimOfferAddress}
                  onChange={(e) => setEscrowClaimOfferAddress(e.target.value)}
                  placeholder="Escrow address (kaspa:q…)"
                  style={inputStyle(false)}
                />
                <input
                  value={escrowClaimPrivKey}
                  onChange={(e) => setEscrowClaimPrivKey(e.target.value)}
                  placeholder="Revealed private key (hex)"
                  style={inputStyle(false)}
                />
                <input
                  value={escrowClaimToAddress}
                  onChange={(e) => setEscrowClaimToAddress(e.target.value)}
                  placeholder={`Receive address (default: ${address ? address.slice(0, 18) + "…" : "your wallet"})`}
                  style={inputStyle(false)}
                />
                <button
                  onClick={handleClaimEscrow}
                  disabled={escrowBusy || !escrowClaimOfferAddress || !escrowClaimPrivKey}
                  style={submitBtn(Boolean(escrowClaimOfferAddress && escrowClaimPrivKey) && !escrowBusy)}
                >
                  {escrowBusy ? "CLAIMING…" : "SWEEP ESCROW →"}
                </button>
              </>
            )}
          </div>
        )}

        {/* Active offers list */}
        {escrowMode !== "create" && escrowOffers.filter((o) => o.status === "locked" || o.status === "pending_lock").length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.06em", marginBottom: 6 }}>ACTIVE OFFERS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {escrowOffers
                .filter((o) => o.status === "locked" || o.status === "pending_lock")
                .map((offer) => {
                  const expired = Date.now() > offer.expiresAt;
                  const remaining = Math.max(0, offer.expiresAt - Date.now());
                  const hRemain = Math.floor(remaining / 3_600_000);
                  const mRemain = Math.floor((remaining % 3_600_000) / 60_000);
                  return (
                    <div key={offer.id} style={{ ...insetCard(), padding: "8px 9px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <div style={{ fontSize: 9, color: offer.status === "locked" ? C.ok : C.warn, fontWeight: 700 }}>
                          {offer.status === "locked" ? "LOCKED" : "PENDING"}
                        </div>
                        <div style={{ fontSize: 8, color: expired ? C.danger : C.dim }}>
                          {expired ? "EXPIRED" : `${hRemain}h ${mRemain}m left`}
                        </div>
                      </div>
                      <div style={{ fontSize: 8, color: C.text, marginBottom: 2 }}>
                        {offer.amountKas} KAS{offer.label ? ` · ${offer.label}` : ""}
                      </div>
                      <div style={{ fontSize: 8, color: C.dim, ...mono, wordBreak: "break-all", marginBottom: 5 }}>
                        {offer.escrowAddress.slice(0, 30)}…
                      </div>
                      {expired && address && (
                        <button
                          onClick={() => handleRefundEscrow(offer)}
                          disabled={escrowBusy}
                          style={{ ...outlineButton(C.warn, true), padding: "4px 7px", fontSize: 8, color: C.warn }}
                        >
                          {escrowBusy ? "REFUNDING…" : "REFUND →"}
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {escrowError && (
          <div style={{ fontSize: 8, color: C.danger, padding: "6px 0", lineHeight: 1.4 }}>{escrowError}</div>
        )}
      </div>

      {/* ── TRANSACTION HISTORY ─────────────────────────────────────── */}
      <div style={sectionCard("default")}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: txHistoryLoaded ? 9 : 0 }}>
          <div>
            <div style={sectionKicker}>TX HISTORY</div>
            {!txHistoryLoaded && <div style={{ fontSize: 8, color: C.dim, marginTop: 2 }}>Last 20 transactions</div>}
          </div>
          <button
            onClick={loadTxHistory}
            disabled={txHistoryLoading}
            style={{ ...outlineButton(C.accent, !txHistoryLoading), padding: "4px 10px", fontSize: 9, color: txHistoryLoading ? C.dim : C.accent }}
          >
            {txHistoryLoading ? "LOADING…" : txHistoryLoaded ? "REFRESH" : "LOAD"}
          </button>
        </div>
        {txHistoryError && <div style={{ fontSize: 8, color: C.danger, lineHeight: 1.4 }}>{txHistoryError}</div>}
        {txHistoryLoaded && txHistory.length === 0 && (
          <div style={{ fontSize: 8, color: C.dim, textAlign: "center", padding: "10px 0" }}>No transactions found.</div>
        )}
        {txHistory.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {txHistory.map((tx) => {
              const isIn = tx.outputs.some((o) => o.scriptPublicKey?.address === address);
              const isOut = tx.inputs.some((i) => i.previousOutpoint?.address === address);
              const direction = isOut ? "OUT" : "IN";
              const dirColor = isOut ? C.danger : C.ok;
              const totalOut = tx.outputs
                .filter((o) => isOut ? o.scriptPublicKey?.address !== address : o.scriptPublicKey?.address === address)
                .reduce((s, o) => s + Number(o.amount ?? 0), 0);
              const amtKas = (totalOut / 1e8).toFixed(4);
              const ts = tx.blockTime ? new Date(tx.blockTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
              return (
                <div key={tx.transactionId} style={{ ...insetCard(), padding: "7px 9px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 8, fontWeight: 700, color: dirColor, background: `${dirColor}18`, borderRadius: 3, padding: "1px 5px", ...mono }}>{direction}</span>
                    <div>
                      <div style={{ fontSize: 9, color: C.text, fontWeight: 700, ...mono }}>{amtKas} KAS</div>
                      <div style={{ fontSize: 7, color: C.dim, ...mono }}>{tx.transactionId.slice(0, 16)}…</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    <div style={{ fontSize: 7, color: C.dim }}>{ts}</div>
                    <button
                      onClick={() => chrome.tabs.create({ url: `${explorerBase}/txs/${tx.transactionId}` })}
                      style={{ background: "none", border: "none", color: C.accent, fontSize: 7, cursor: "pointer", ...mono }}
                    >
                      ↗
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── BATCH SEND ──────────────────────────────────────────────── */}
      {isManaged && (
        <div style={sectionCard("default")}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: batchMode ? 9 : 0 }}>
            <div>
              <div style={sectionKicker}>BATCH SEND</div>
              {!batchMode && <div style={{ fontSize: 8, color: C.dim, marginTop: 2 }}>Send KAS to multiple recipients in one TX</div>}
            </div>
            <button
              onClick={() => { setBatchMode((v) => !v); setBatchError(null); setBatchTxId(null); }}
              style={{ ...outlineButton(C.accent, true), padding: "4px 10px", fontSize: 9, color: C.accent }}
            >
              {batchMode ? "CANCEL" : "OPEN →"}
            </button>
          </div>
          {batchMode && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {batchRecipients.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                    <input
                      placeholder={`${networkPrefix}q… address`}
                      value={r.address}
                      onChange={(e) => {
                        const next = [...batchRecipients];
                        next[i] = { ...next[i], address: e.target.value };
                        setBatchRecipients(next);
                      }}
                      style={{ ...inputStyle(false), flex: 2, fontSize: 8 }}
                    />
                    <input
                      type="number"
                      placeholder="KAS"
                      value={r.amountKas}
                      onChange={(e) => {
                        const next = [...batchRecipients];
                        next[i] = { ...next[i], amountKas: e.target.value };
                        setBatchRecipients(next);
                      }}
                      style={{ ...inputStyle(false), flex: 1, fontSize: 8 }}
                    />
                    {batchRecipients.length > 1 && (
                      <button
                        onClick={() => setBatchRecipients((prev) => prev.filter((_, j) => j !== i))}
                        style={{ background: "none", border: "none", color: C.dim, fontSize: 10, cursor: "pointer", ...mono, padding: "0 3px" }}
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
                <button
                  onClick={() => setBatchRecipients((prev) => [...prev, { address: "", amountKas: "" }])}
                  style={{ ...outlineButton(C.dim, true), padding: "5px 8px", fontSize: 8, color: C.dim, flex: 1 }}
                >
                  + ADD RECIPIENT
                </button>
                <button
                  onClick={handleBatchSend}
                  disabled={batchBusy}
                  style={{ ...submitBtn(!batchBusy), flex: 2, padding: "5px", fontSize: 9 }}
                >
                  {batchBusy ? "SENDING…" : `SEND TO ${batchRecipients.filter((r) => r.address.trim()).length} →`}
                </button>
              </div>
              {batchError && <div style={{ fontSize: 8, color: C.danger, lineHeight: 1.4 }}>{batchError}</div>}
              {batchTxId && (
                <div style={{ fontSize: 8, color: C.ok, lineHeight: 1.4 }}>
                  ✓ Sent! TX: {batchTxId.slice(0, 20)}…
                  <button
                    onClick={() => chrome.tabs.create({ url: `${explorerBase}/txs/${batchTxId}` })}
                    style={{ background: "none", border: "none", color: C.accent, fontSize: 8, cursor: "pointer", ...mono, marginLeft: 5 }}
                  >View ↗</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ADDRESS BOOK ────────────────────────────────────────────── */}
      <div style={sectionCard("default")}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: contacts.length > 0 ? 9 : 0 }}>
          <div>
            <div style={sectionKicker}>ADDRESS BOOK</div>
            {contacts.length === 0 && <div style={{ fontSize: 8, color: C.dim, marginTop: 2 }}>Save recipients via the send form</div>}
          </div>
          <div style={{ fontSize: 9, color: C.dim, ...mono }}>{contacts.length} saved</div>
        </div>
        {contacts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {contacts.map((c) => (
              <div key={c.id} style={{ ...insetCard(), padding: "7px 9px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: C.text, fontWeight: 700, ...mono }}>{c.label}</div>
                  <div style={{ fontSize: 7, color: C.dim, ...mono, wordBreak: "break-all" }}>{c.address.slice(0, 32)}…</div>
                </div>
                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  <button
                    onClick={() => { setSendTo(c.address); setSendStep("form"); }}
                    style={{ ...outlineButton(C.accent, true), padding: "3px 7px", fontSize: 7, color: C.accent }}
                  >
                    SEND →
                  </button>
                  <button
                    onClick={() => handleDeleteContact(c.id)}
                    style={{ background: "none", border: "none", color: C.dim, fontSize: 8, cursor: "pointer", ...mono }}
                  >✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── UTXO CONSOLIDATION ──────────────────────────────────────── */}
      {isManaged && utxos.length >= 2 && (
        <div style={sectionCard("default")}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={sectionKicker}>UTXO CONSOLIDATION</div>
              <div style={{ fontSize: 8, color: C.dim, marginTop: 2 }}>
                {utxos.length} UTXOs · {utxoTotalKas.toFixed(4)} KAS — merge into one output
              </div>
            </div>
            <button
              onClick={handleConsolidate}
              disabled={consolidateBusy}
              style={{ ...outlineButton(consolidateBusy ? C.dim : C.warn, !consolidateBusy), padding: "5px 10px", fontSize: 9, color: consolidateBusy ? C.dim : C.warn }}
            >
              {consolidateBusy ? "CONSOLIDATING…" : "CONSOLIDATE →"}
            </button>
          </div>
          {consolidateError && <div style={{ fontSize: 8, color: C.danger, marginTop: 6, lineHeight: 1.4 }}>{consolidateError}</div>}
          {consolidateTxId && (
            <div style={{ fontSize: 8, color: C.ok, marginTop: 6, lineHeight: 1.4 }}>
              ✓ Done! TX: {consolidateTxId.slice(0, 20)}…
              <button
                onClick={() => chrome.tabs.create({ url: `${explorerBase}/txs/${consolidateTxId}` })}
                style={{ background: "none", border: "none", color: C.accent, fontSize: 8, cursor: "pointer", ...mono, marginLeft: 5 }}
              >View ↗</button>
            </div>
          )}
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

const submitBtn = (active: boolean): React.CSSProperties => ({
  ...primaryButton(active),
  padding: "9px",
  width: "100%",
});

const overlayBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  background: "rgba(3, 7, 12, 0.78)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "12px 10px 14px",
  backdropFilter: "blur(1px)",
};

const overlayCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxHeight: "calc(100vh - 26px)",
  overflowY: "auto",
};

function formatKrc721WindowLabel(points: number): string {
  if (points % 60 === 0) {
    const hours = points / 60;
    return `${hours}H`;
  }
  return `${points}M`;
}

function MetricTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={{ ...insetCard(), padding: "8px 10px" }}>
      <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontSize: 11,
          color: tone,
          fontWeight: 700,
          ...mono,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.2,
          minHeight: 13,
          display: "flex",
          alignItems: "center",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function LiveLineChart({ points, color }: { points: PricePoint[]; color: string }) {
  const width = 340;
  const height = 118;
  const pad = 10;
  if (points.length < 2) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: C.dim, fontSize: 8 }}>
        Waiting for enough live points…
      </div>
    );
  }

  const min = Math.min(...points.map((point) => point.price));
  const max = Math.max(...points.map((point) => point.price));
  const range = Math.max(1e-9, max - min);
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;
  const stepX = usableW / Math.max(1, points.length - 1);

  const line = points
    .map((point, index) => {
      const x = pad + stepX * index;
      const y = pad + (max - point.price) / range * usableH;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const area = `${line} L ${pad + usableW} ${height - pad} L ${pad} ${height - pad} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Live token chart">
      <defs>
        <linearGradient id="wallet-chart-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#wallet-chart-fill)" />
      <path d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
