import { useEffect, useState, useCallback, useRef } from "react";
import { C, mono } from "../../src/tokens";
import { shortAddr, withKaspaAddressNetwork } from "../../src/helpers";
import { fetchKasBalance, fetchKasUsdPrice } from "../shared/api";
import {
  getWalletMeta,
  getNetwork,
  NETWORK_STORAGE_KEY,
  setNetwork as saveNetwork,
  getAutoLockMinutes,
  setAutoLockMinutes as saveAutoLockMinutes,
  getPersistUnlockSession,
  setPersistUnlockSession,
  getHidePortfolioBalances,
  setHidePortfolioBalances,
  setWalletMeta,
} from "../shared/storage";
import { UI_PATCH_PORT_NAME, isUiPatchEnvelope } from "../shared/messages";
import {
  vaultExists,
  lockWallet,
  getSession,
  extendSession,
  restoreSessionFromCache,
  setSessionPersistence,
} from "../vault/vault";
import { fetchBlueScore, fetchNodeStatus, NETWORK_BPS } from "../network/kaspaClient";
import { connectKaspaWs, disconnectKaspaWs, subscribeUtxosChanged, subscribeDaaScore } from "../network/kaspaWebSocket";
import { loadPendingTxs } from "../tx/store";
import { pollConfirmation } from "../tx/broadcast";
import { recoverPendingSwapSettlements } from "../swap/swap";
import type { UnlockedSession } from "../vault/types";
import { signMessage as signManagedMessage } from "../../src/wallet/KaspaWalletManager";
import { WalletTab } from "../tabs/WalletTab";
import { AgentsTab } from "../tabs/AgentsTab";
import { SecurityTab } from "../tabs/SecurityTab";
import { SwapTab } from "../tabs/SwapTab";
import { LockScreen } from "./screens/LockScreen";
import { FirstRunScreen } from "./screens/FirstRunScreen";
import { ConnectApprovalScreen } from "./screens/ConnectApprovalScreen";
import { SignApprovalScreen } from "./screens/SignApprovalScreen";
import { SendTxApprovalScreen, type PendingTxRequest } from "./screens/SendTxApprovalScreen";
import { executeKaspaIntent } from "../tx/kernel";
import { EXTENSION_POPUP_BASE_MIN_HEIGHT, EXTENSION_POPUP_BASE_WIDTH, EXTENSION_POPUP_UI_SCALE } from "./layout";
import { outlineButton, popupShellBackground } from "./surfaces";
import {
  formatFiatFromUsd,
  type DisplayCurrency,
} from "../shared/fiat";

type Tab = "wallet" | "swap" | "agents" | "security";

// ── Screen state ─────────────────────────────────────────────────────────────
type Screen =
  | { type: "loading" }
  | { type: "first_run" }
  | { type: "locked" }
  | { type: "unlocked" };

const PENDING_CONNECT_KEY = "forgeos.connect.pending";
const PENDING_SIGN_KEY = "forgeos.sign.pending";
const PENDING_TX_KEY = "forgeos.pending.tx.v1";
const SITE_AUTH_SESSION_GRACE_MS = 120_000;
const TRUSTED_SITE_SIGN_HOSTS = new Set([
  "forge-os.xyz",
  "www.forge-os.xyz",
  "forgeos.xyz",
  "www.forgeos.xyz",
  "localhost",
  "127.0.0.1",
]);

type PendingConnectRequest = {
  requestId: string;
  tabId: number;
  origin?: string;
};

type PendingSignRequest = {
  requestId: string;
  tabId: number;
  origin?: string;
  message: string;
};

export function Popup() {
  const [screen, setScreen] = useState<Screen>({ type: "loading" });
  const [session, setSession] = useState<UnlockedSession | null>(null);
  const [network, setNetwork] = useState("mainnet");
  const [balance, setBalance] = useState<number | null>(null);
  const [krcPortfolioUsdTotal, setKrcPortfolioUsdTotal] = useState(0);
  const [usdPrice, setUsdPrice] = useState(0);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab>("wallet");
  const [walletMode, setWalletMode] = useState<"send" | "receive" | undefined>();
  const [walletModeRequestId, setWalletModeRequestId] = useState(0);
  const [showSwapOverlay, setShowSwapOverlay] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);
  const [persistUnlockSessionEnabled, setPersistUnlockSessionEnabled] = useState(false);
  const [hidePortfolioBalances, setHidePortfolioBalancesState] = useState(false);
  const [pendingConnect, setPendingConnect] = useState<PendingConnectRequest | null>(null);
  const [pendingSign, setPendingSign] = useState<PendingSignRequest | null>(null);
  const [pendingTx, setPendingTx] = useState<PendingTxRequest | null>(null);
  const [signingSiteRequest, setSigningSiteRequest] = useState(false);
  const [siteSignError, setSiteSignError] = useState<string | null>(null);
  const autoSignedRequestIds = useRef(new Set<string>());
  const transientSessionCleanupTimer = useRef<number | null>(null);
  const networkRef = useRef("mainnet");
  const [lockedAddress, setLockedAddress] = useState<string | null>(null);
  const [dagScore, setDagScore] = useState<string | null>(null);
  const [nodeSynced, setNodeSynced] = useState<boolean | null>(null);
  const [nodeUtxoIndexed, setNodeUtxoIndexed] = useState<boolean | null>(null);
  const [balanceUpdatedAt, setBalanceUpdatedAt] = useState<number | null>(null);
  const [priceUpdatedAt, setPriceUpdatedAt] = useState<number | null>(null);
  const [dagUpdatedAt, setDagUpdatedAt] = useState<number | null>(null);
  const [nodeStatusUpdatedAt, setNodeStatusUpdatedAt] = useState<number | null>(null);
  const [feedStatusMessage, setFeedStatusMessage] = useState<string | null>(null);

  const NETWORKS = ["mainnet", "testnet-10", "testnet-11", "testnet-12"] as const;
  const NETWORK_LABELS: Record<string, string> = {
    mainnet: "MAINNET",
    "testnet-10": "TN10",
    "testnet-11": "TN11",
    "testnet-12": "TN12",
  };
  const BALANCE_FEED_STALE_MS = 45_000;
  const PRICE_FEED_STALE_MS = 45_000;
  const DAG_FEED_STALE_MS = 60_000;
  const NODE_STATUS_STALE_MS = 90_000;

  useEffect(() => {
    networkRef.current = network;
  }, [network]);

  const isAutoSignEligibleRequest = useCallback((request: PendingSignRequest | null) => {
    if (!request) return false;
    let host = "";
    try {
      host = request.origin ? new URL(request.origin).hostname.toLowerCase() : "";
    } catch {
      host = "";
    }
    const trustedOrigin = TRUSTED_SITE_SIGN_HOSTS.has(host);
    const isSiwaMessage =
      request.message.includes("Sign in to Forge.OS")
      && request.message.includes("Domain: forge-os.xyz");
    return trustedOrigin && isSiwaMessage;
  }, []);

  // ── Initialise ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [exists, net, lockMins, persistUnlock, hideBalances] = await Promise.all([
          vaultExists(),
          getNetwork(),
          getAutoLockMinutes(),
          getPersistUnlockSession(),
          getHidePortfolioBalances(),
        ]);
        setNetwork(net);
        setAutoLockMinutes(lockMins);
        setPersistUnlockSessionEnabled(persistUnlock === true);
        setHidePortfolioBalancesState(hideBalances === true);

        if (!exists) {
          // No vault — check for legacy address-only metadata from content bridge
          const meta = await getWalletMeta();
          if (meta?.address) {
            // External wallet (Kasware/Kastle user) — no vault, show balance only
            setSession({ mnemonic: "", address: meta.address, network: net, autoLockAt: Infinity });
            fetchBalances(meta.address, net);
            setScreen({ type: "unlocked" });
          } else {
            setScreen({ type: "first_run" });
          }
          return;
        }

        // Vault exists — check if session is still active (popup reopened within TTL)
        const existing = getSession() ?? await restoreSessionFromCache();
        if (existing) {
          setSession(existing);
          fetchBalances(existing.address, net);
          setScreen({ type: "unlocked" });
          // B4: Resume any in-flight tx confirmation loops
          loadPendingTxs().then((txs) => {
            txs
              .filter((tx) => (tx.state === "CONFIRMING" || tx.state === "BROADCASTING") && tx.txId)
              .forEach((tx) =>
                pollConfirmation(tx, (updated) => {
                  if (updated.state === "CONFIRMED" || updated.state === "FAILED") {
                    fetchBalances(existing.address, net);
                  }
                }).catch(() => {}),
              );
          }).catch(() => {});
          // B5: Resume any pending swap settlements
          recoverPendingSwapSettlements().catch(() => {});
        } else {
          // Show the wallet address on the lock screen so the user knows whose account they're signing into
          const meta = await getWalletMeta();
          setLockedAddress(meta?.address ?? null);
          setScreen({ type: "locked" });
        }
      } catch {
        // If init fails for any reason, fall through to first_run so the popup
        // is never stuck on the black loading screen.
        setScreen({ type: "first_run" });
      }
    })();
  }, []);

  // ── Pending site approval request sync ─────────────────────────────────────
  const readPendingApprovals = useCallback(() => {
    const sessionStore = (chrome.storage as any)?.session;
    if (!sessionStore?.get) return;
    sessionStore.get([PENDING_CONNECT_KEY, PENDING_SIGN_KEY, PENDING_TX_KEY]).then((result: any) => {
      const pendingConnectReq = result?.[PENDING_CONNECT_KEY];
      const pendingSignReq = result?.[PENDING_SIGN_KEY];
      const pendingTxReq = result?.[PENDING_TX_KEY];
      setPendingConnect(pendingConnectReq?.requestId ? pendingConnectReq : null);
      setPendingSign(
        pendingSignReq?.requestId && typeof pendingSignReq?.message === "string"
          ? pendingSignReq
          : null,
      );
      setPendingTx(
        pendingTxReq?.requestId && typeof pendingTxReq?.to === "string" && pendingTxReq?.amountKas > 0
          ? pendingTxReq
          : null,
      );
    }).catch(() => {});
  }, []);

  useEffect(() => {
    readPendingApprovals();
  }, [readPendingApprovals]);

  useEffect(() => {
    const onChanged = (_changes: unknown, areaName: string) => {
      if (areaName !== "session") return;
      readPendingApprovals();
    };
    chrome.storage.onChanged.addListener(onChanged as any);
    return () => chrome.storage.onChanged.removeListener(onChanged as any);
  }, [readPendingApprovals]);

  useEffect(() => {
    setSiteSignError(null);
  }, [pendingSign?.requestId]);

  // When unlock-session persistence is disabled, still keep a short-lived
  // cached session for connect->sign website auth handshakes so users do not
  // get prompted twice if the popup closes/reopens between requests.
  useEffect(() => {
    const clearTransientCleanupTimer = () => {
      if (transientSessionCleanupTimer.current !== null) {
        window.clearTimeout(transientSessionCleanupTimer.current);
        transientSessionCleanupTimer.current = null;
      }
    };

    if (screen.type !== "unlocked" || persistUnlockSessionEnabled) {
      clearTransientCleanupTimer();
      return;
    }

    const hasPendingSiteApproval = Boolean(pendingConnect || pendingSign);
    if (hasPendingSiteApproval) {
      clearTransientCleanupTimer();
      return;
    }

    clearTransientCleanupTimer();
    transientSessionCleanupTimer.current = window.setTimeout(() => {
      transientSessionCleanupTimer.current = null;
      void setSessionPersistence(false);
    }, SITE_AUTH_SESSION_GRACE_MS);

    return clearTransientCleanupTimer;
  }, [screen.type, persistUnlockSessionEnabled, pendingConnect?.requestId, pendingSign?.requestId]);

  useEffect(() => {
    return () => {
      if (transientSessionCleanupTimer.current !== null) {
        window.clearTimeout(transientSessionCleanupTimer.current);
        transientSessionCleanupTimer.current = null;
      }
    };
  }, []);

  // ── Auto-lock listener ──────────────────────────────────────────────────────
  useEffect(() => {
    const listener = (msg: unknown) => {
      if ((msg as { type?: string })?.type === "AUTOLOCK_FIRED") {
        handleLock();
      }
      if ((msg as { type?: string })?.type === "FORGEOS_TX_PENDING") {
        readPendingApprovals();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [readPendingApprovals]);

  // ── Session TTL check + auto-extend on confirmed active session ──────────────
  useEffect(() => {
    if (screen.type !== "unlocked" || !session) return;
    const interval = setInterval(() => {
      const s = getSession();
      if (!s) { handleLock(); return; }
      extendSession(autoLockMinutes, { persistSession: persistUnlockSessionEnabled });
    }, 30_000);
    return () => clearInterval(interval);
  }, [screen.type, session, autoLockMinutes, persistUnlockSessionEnabled]);

  // ── Live DAG score ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen.type !== "unlocked") return;
    const poll = async () => {
      // Use lightweight blue-score + node-status endpoints instead of full /info/blockdag.
      const [scoreResult, nodeStatusResult] = await Promise.allSettled([
        fetchBlueScore(network),
        fetchNodeStatus(network),
      ]);

      if (scoreResult.status === "fulfilled" && scoreResult.value != null) {
        setDagScore(String(scoreResult.value));
        setDagUpdatedAt(Date.now());
        setFeedStatusMessage((prev) => (prev?.startsWith("Live BlockDAG feed") ? null : prev));
      } else {
        setFeedStatusMessage("Live BlockDAG feed unavailable — retrying…");
      }

      if (nodeStatusResult.status === "fulfilled" && nodeStatusResult.value) {
        setNodeSynced(typeof nodeStatusResult.value.isSynced === "boolean" ? nodeStatusResult.value.isSynced : null);
        setNodeUtxoIndexed(typeof nodeStatusResult.value.isUtxoIndexed === "boolean" ? nodeStatusResult.value.isUtxoIndexed : null);
        setNodeStatusUpdatedAt(Date.now());
      } else {
        setNodeSynced(null);
        setNodeUtxoIndexed(null);
        setNodeStatusUpdatedAt(null);
      }
    };
    poll();
    const id = setInterval(poll, 20_000); // refresh every 20 s
    return () => clearInterval(id);
  }, [screen.type, network]);

  // ── Balance fetch ────────────────────────────────────────────────────────────
  const fetchBalances = useCallback(async (address: string, targetNetwork: string) => {
    try {
      const networkAddress = withKaspaAddressNetwork(address, targetNetwork);
      const [balanceResult, priceResult] = await Promise.allSettled([
        fetchKasBalance(networkAddress, targetNetwork),
        fetchKasUsdPrice(targetNetwork),
      ]);

      const now = Date.now();
      let degraded = false;

      if (balanceResult.status === "fulfilled") {
        setBalance(balanceResult.value);
        setBalanceUpdatedAt(now);
      } else {
        degraded = true;
      }

      if (priceResult.status === "fulfilled") {
        setUsdPrice(priceResult.value);
        setPriceUpdatedAt(now);
      } else {
        degraded = true;
      }

      setFeedStatusMessage((prev) => {
        if (degraded) return "Live balance/price feed degraded — retrying…";
        return prev?.startsWith("Live balance/price feed") ? null : prev;
      });
    } catch { /* non-fatal */ }
  }, []);

  const applyNetworkPatch = useCallback((nextNetwork: string) => {
    const normalized = String(nextNetwork || "").trim();
    if (!normalized || networkRef.current === normalized) return;
    networkRef.current = normalized;
    setNetwork(normalized);
    setBalance(null);
    setDagScore(null);
    setNodeSynced(null);
    setNodeUtxoIndexed(null);
    setBalanceUpdatedAt(null);
    setPriceUpdatedAt(null);
    setDagUpdatedAt(null);
    setNodeStatusUpdatedAt(null);
    setFeedStatusMessage(null);
    if (session?.address) {
      fetchBalances(session.address, normalized);
    }
  }, [fetchBalances, session?.address]);

  useEffect(() => {
    const onChanged = (changes: Record<string, any>, areaName: string) => {
      if (areaName !== "local") return;
      const networkChange = changes?.[NETWORK_STORAGE_KEY];
      if (!networkChange || typeof networkChange.newValue !== "string") return;
      applyNetworkPatch(networkChange.newValue);
    };
    chrome.storage.onChanged.addListener(onChanged as any);
    return () => chrome.storage.onChanged.removeListener(onChanged as any);
  }, [applyNetworkPatch]);

  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    try {
      port = chrome.runtime.connect({ name: UI_PATCH_PORT_NAME });
    } catch {
      return;
    }
    const onMessage = (payload: unknown) => {
      if (!isUiPatchEnvelope(payload)) return;
      for (const patch of payload.patches) {
        if (patch?.type === "network" && typeof patch.network === "string") {
          applyNetworkPatch(patch.network);
        }
      }
    };
    port.onMessage.addListener(onMessage as any);
    return () => {
      try {
        port?.onMessage.removeListener(onMessage as any);
        port?.disconnect();
      } catch {
        // ignore cleanup failures from disconnected ports
      }
    };
  }, [applyNetworkPatch]);

  // ── Live balance + price polling ───────────────────────────────────────────
  useEffect(() => {
    if (screen.type !== "unlocked" || !session?.address) return;
    const poll = () => {
      fetchBalances(session.address, network);
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, [screen.type, session?.address, network, fetchBalances]);

  // ── WebSocket real-time subscriptions (C2) ───────────────────────────────────
  useEffect(() => {
    if (screen.type !== "unlocked" || !session?.address) return;
    connectKaspaWs(network).catch(() => {});
    const unsubUtxo = subscribeUtxosChanged(session.address, () => {
      fetchBalances(session.address, network);
    });
    const unsubDaa = subscribeDaaScore((score) => {
      setDagScore(score);
      setDagUpdatedAt(Date.now());
    });
    return () => {
      unsubUtxo();
      unsubDaa();
      disconnectKaspaWs().catch(() => {});
    };
  }, [screen.type, session?.address, network, fetchBalances]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleUnlock = (s: UnlockedSession) => {
    setLockedAddress(null);
    setSession(s);
    fetchBalances(s.address, network);
    setScreen({ type: "unlocked" });
  };

  const handleLock = () => {
    // Persist the address so the lock screen shows "Welcome back, kaspa:qp…"
    setLockedAddress(session?.address ?? null);
    lockWallet();
    setSession(null);
    setBalance(null);
    setUsdPrice(0);
    setDagScore(null);
    setNodeSynced(null);
    setNodeUtxoIndexed(null);
    setBalanceUpdatedAt(null);
    setPriceUpdatedAt(null);
    setDagUpdatedAt(null);
    setNodeStatusUpdatedAt(null);
    setFeedStatusMessage(null);
    setScreen({ type: "locked" });
  };

  const handleReset = async () => {
    const { resetWallet } = await import("../vault/vault");
    await resetWallet();
    setSession(null);
    setBalance(null);
    setUsdPrice(0);
    setDagScore(null);
    setNodeSynced(null);
    setNodeUtxoIndexed(null);
    setBalanceUpdatedAt(null);
    setPriceUpdatedAt(null);
    setDagUpdatedAt(null);
    setNodeStatusUpdatedAt(null);
    setFeedStatusMessage(null);
    setScreen({ type: "first_run" });
  };

  const handleFirstRunComplete = (s: UnlockedSession) => {
    setSession(s);
    fetchBalances(s.address, network);
    setScreen({ type: "unlocked" });
  };

  const activeAddress = (() => {
    if (!session?.address) return null;
    try {
      return withKaspaAddressNetwork(session.address, network);
    } catch {
      return session.address;
    }
  })();

  const copyAddress = async () => {
    if (!activeAddress) return;
    try {
      await navigator.clipboard.writeText(activeAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* non-fatal */ }
  };

  // ── Network cycling ──────────────────────────────────────────────────────────
  const handleCycleNetwork = async () => {
    const idx = NETWORKS.indexOf(network as typeof NETWORKS[number]);
    const next = NETWORKS[(idx + 1) % NETWORKS.length];
    applyNetworkPatch(next);
    await saveNetwork(next);
    if (session?.address) {
      try {
        await setWalletMeta({ address: withKaspaAddressNetwork(session.address, next), network: next });
      } catch { /* non-fatal */ }
    }
  };

  // ── User activity → extend session TTL ───────────────────────────────────────
  const onUserActivity = () => {
    if (screen.type === "unlocked") {
      extendSession(autoLockMinutes, { persistSession: persistUnlockSessionEnabled });
    }
  };

  const handleAutoLockMinutesChanged = async (minutes: number) => {
    setAutoLockMinutes(minutes);
    await saveAutoLockMinutes(minutes);
    if (screen.type === "unlocked") {
      extendSession(minutes, { persistSession: persistUnlockSessionEnabled });
    }
  };

  const handlePersistUnlockSessionChanged = async (enabled: boolean) => {
    setPersistUnlockSessionEnabled(enabled);
    await setPersistUnlockSession(enabled);
    await setSessionPersistence(enabled);
    if (screen.type === "unlocked") {
      extendSession(autoLockMinutes, { persistSession: enabled });
    }
  };

  const handleToggleHidePortfolioBalances = async () => {
    const next = !hidePortfolioBalances;
    setHidePortfolioBalancesState(next);
    try {
      await setHidePortfolioBalances(next);
    } catch {
      // Keep local state optimistic; storage write can retry on next toggle.
    }
  };

  // If a site asks to sign but the active account is external (no vault mnemonic),
  // reject immediately because only managed vault accounts can sign here.
  useEffect(() => {
    if (screen.type !== "unlocked" || !pendingSign) return;
    if (session?.mnemonic) return;
    chrome.runtime.sendMessage({
      type: "FORGEOS_SIGN_REJECT",
      requestId: pendingSign.requestId,
      error: "Managed wallet is required for site signing",
    }).catch(() => {});
    setPendingSign(null);
  }, [screen.type, pendingSign, session?.mnemonic]);

  const handleApproveSiteSign = async () => {
    const request = pendingSign;
    if (!request) return;
    if (!session?.mnemonic) {
      setSiteSignError("Wallet is locked. Unlock to sign.");
      return;
    }

    setSigningSiteRequest(true);
    setSiteSignError(null);

    try {
      const signature = await signManagedMessage(session.mnemonic, request.message, {
        mnemonicPassphrase: session.mnemonicPassphrase,
        derivation: session.derivation,
      });
      await chrome.runtime.sendMessage({
        type: "FORGEOS_SIGN_APPROVE",
        requestId: request.requestId,
        signature,
      });
      setPendingSign(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSiteSignError(msg || "Signing failed");
    } finally {
      setSigningSiteRequest(false);
    }
  };

  const handleRejectSiteSign = () => {
    if (!pendingSign) return;
    chrome.runtime.sendMessage({
      type: "FORGEOS_SIGN_REJECT",
      requestId: pendingSign.requestId,
      error: "Signing rejected by user",
    }).catch(() => {});
    // Close the popup immediately — avoids a flash of the wallet UI before the window closes.
    window.close();
  };

  // Auto-approve only the canonical Forge-OS SIWA message to avoid showing an
  // extra signature screen right after connect-to-site approval.
  useEffect(() => {
    if (screen.type !== "unlocked" || !pendingSign || signingSiteRequest) return;
    if (!session?.mnemonic) return;

    const requestId = pendingSign.requestId;
    if (!requestId || autoSignedRequestIds.current.has(requestId)) return;

    if (!isAutoSignEligibleRequest(pendingSign)) return;

    autoSignedRequestIds.current.add(requestId);
    void handleApproveSiteSign();
  }, [screen.type, pendingSign, session?.mnemonic, signingSiteRequest, isAutoSignEligibleRequest]);

  // ── Agent send-tx: auto-approve (silent) or show approval screen ────────────
  const handleSendTxApprove = async () => {
    if (!pendingTx || !session?.address) return;
    const txResult = await executeKaspaIntent(
      {
        fromAddress: session.address,
        network,
        recipients: [{ address: pendingTx.to, amountKas: pendingTx.amountKas }],
        agentJobId: pendingTx.agentId,
      },
      { awaitConfirmation: false },
    );
    chrome.runtime.sendMessage({
      type: "FORGEOS_SEND_TX_APPROVE",
      requestId: pendingTx.requestId,
      tabId: pendingTx.tabId,
      txid: txResult.txId || "",
      amountKas: pendingTx.amountKas,
      agentId: pendingTx.agentId,
    }).catch(() => {});
    setPendingTx(null);
    window.close();
  };

  const handleSendTxReject = () => {
    if (!pendingTx) return;
    chrome.runtime.sendMessage({
      type: "FORGEOS_SEND_TX_REJECT",
      requestId: pendingTx.requestId,
      tabId: pendingTx.tabId,
      error: "Transaction rejected by user",
    }).catch(() => {});
    setPendingTx(null);
    window.close();
  };

  // Auto-approve: silent sign when session active + amount within threshold
  useEffect(() => {
    if (screen.type !== "unlocked" || !pendingTx || !session?.mnemonic) return;
    const { amountKas, autoApproveKas } = pendingTx;
    if (!(autoApproveKas > 0) || !(amountKas <= autoApproveKas)) return;
    void handleSendTxApprove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.type, pendingTx?.requestId, session?.mnemonic]);

  // ── Screen renders ────────────────────────────────────────────────────────────
  if (screen.type === "loading") {
    return (
      <div style={{
        width: EXTENSION_POPUP_BASE_WIDTH,
        height: EXTENSION_POPUP_BASE_MIN_HEIGHT,
        ...popupShellBackground(),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...mono,
        position: "relative",
        overflowX: "hidden",
        overflowY: "auto",
        zoom: EXTENSION_POPUP_UI_SCALE,
      }}>
        {/* Atmospheric blob */}
        <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translate(-50%,-50%)", width: 260, height: 260, borderRadius: "50%", background: `radial-gradient(ellipse, ${C.accent}12 0%, transparent 70%)`, pointerEvents: "none" }} />
        <div style={{ textAlign: "center", position: "relative" }}>
          <img src="../icons/icon48.png" alt="" style={{ width: 36, height: 36, objectFit: "contain", opacity: 0.7, filter: "drop-shadow(0 0 10px rgba(57,221,182,0.5))" }} />
          <div style={{ fontSize: 9, color: C.dim, marginTop: 10, letterSpacing: "0.14em" }}>LOADING…</div>
        </div>
      </div>
    );
  }

  if (screen.type === "first_run") {
    return <FirstRunScreen network={network} onComplete={handleFirstRunComplete} />;
  }

  if (screen.type === "locked") {
    const shouldPersistUnlockSession =
      persistUnlockSessionEnabled || Boolean(pendingConnect || pendingSign);
    return (
      <LockScreen
        walletAddress={lockedAddress}
        autoLockMinutes={autoLockMinutes}
        persistSession={shouldPersistUnlockSession}
        onUnlock={handleUnlock}
        onReset={handleReset}
      />
    );
  }

  const isManagedWallet = Boolean(session?.mnemonic);

  // ── Pending sign approval (MetaMask-style) ───────────────────────────────────
  if (pendingSign && activeAddress && isManagedWallet && !isAutoSignEligibleRequest(pendingSign)) {
    return (
      <SignApprovalScreen
        address={activeAddress}
        network={network}
        origin={pendingSign.origin}
        message={pendingSign.message}
        loading={signingSiteRequest}
        error={siteSignError}
        onApprove={handleApproveSiteSign}
        onReject={handleRejectSiteSign}
      />
    );
  }

  // ── Pending send-tx approval (agent transaction) ────────────────────────────
  if (pendingTx && activeAddress && session?.mnemonic && !(pendingTx.autoApproveKas > 0 && pendingTx.amountKas <= pendingTx.autoApproveKas)) {
    return (
      <SendTxApprovalScreen
        request={pendingTx}
        fromAddress={activeAddress}
        kasUsdPrice={usdPrice}
        onApprove={handleSendTxApprove}
        onReject={handleSendTxReject}
      />
    );
  }

  // ── Pending connect approval (MetaMask-style) ────────────────────────────────
  if (pendingConnect && activeAddress) {
    return (
      <ConnectApprovalScreen
        address={activeAddress}
        network={network}
        origin={pendingConnect.origin}
        onApprove={() => {
          chrome.runtime.sendMessage({
            type: "FORGEOS_CONNECT_APPROVE",
            requestId: pendingConnect.requestId,
            address: activeAddress,
            network,
          }).catch(() => {});
          setPendingConnect(null);
        }}
        onReject={() => {
          chrome.runtime.sendMessage({
            type: "FORGEOS_CONNECT_REJECT",
            requestId: pendingConnect.requestId,
          }).catch(() => {});
          window.close();
        }}
      />
    );
  }

  // ── UNLOCKED — main popup UI ─────────────────────────────────────────────────
  const address = activeAddress;
  const displayCurrency: DisplayCurrency = "USD";
  const kasUsdValue = balance !== null && usdPrice > 0 ? balance * usdPrice : 0;
  const portfolioUsdValue = balance !== null && usdPrice > 0
    ? kasUsdValue + krcPortfolioUsdTotal
    : null;
  const portfolioDisplayValue =
    portfolioUsdValue !== null ? formatFiatFromUsd(portfolioUsdValue, displayCurrency) : "—";
  const maskedPortfolioDisplayValue = hidePortfolioBalances ? "••••••" : portfolioDisplayValue;
  const isMainnet = network === "mainnet";
  const now = Date.now();

  const isFeedFresh = (updatedAt: number | null, staleMs: number) =>
    updatedAt !== null && now - updatedAt <= staleMs;
  const balanceLive = isFeedFresh(balanceUpdatedAt, BALANCE_FEED_STALE_MS);
  const priceLive = isFeedFresh(priceUpdatedAt, PRICE_FEED_STALE_MS);
  const dagLive = isFeedFresh(dagUpdatedAt, DAG_FEED_STALE_MS);
  const nodeStatusLive = isFeedFresh(nodeStatusUpdatedAt, NODE_STATUS_STALE_MS);
  const nodeSyncState = nodeStatusLive ? nodeSynced : null;
  const nodeIndexState = nodeStatusLive ? nodeUtxoIndexed : null;
  const nodeReady = nodeSyncState === true && nodeIndexState === true;
  const nodeHealthLabel = nodeReady
    ? "NODE READY"
    : nodeSyncState === false
      ? "NODE SYNCING"
      : nodeIndexState === false
        ? "NODE INDEXING"
        : "NODE UNKNOWN";
  const nodeHealthColor = nodeReady
    ? C.ok
    : nodeSyncState === false || nodeIndexState === false
      ? C.warn
      : C.dim;
  const allFeedsLive = balanceLive && priceLive && dagLive;
  const anyFeedLive = balanceLive || priceLive || dagLive;
  const feedLabel = allFeedsLive ? "LIVE FEED" : anyFeedLive ? "PARTIAL FEED" : "FEED OFFLINE";
  const feedColor = allFeedsLive ? C.ok : anyFeedLive ? C.warn : C.danger;

  // Network badge: mainnet = green (ok), testnets = amber (warn)
  const netColor = isMainnet ? C.ok : C.warn;

  return (
    <div
      onClick={onUserActivity}
      style={{
        width: EXTENSION_POPUP_BASE_WIDTH,
        minHeight: EXTENSION_POPUP_BASE_MIN_HEIGHT,
        ...popupShellBackground(),
        display: "flex",
        flexDirection: "column",
        ...mono,
        position: "relative",
        overflowX: "hidden",
        overflowY: "auto",
        zoom: EXTENSION_POPUP_UI_SCALE,
      }}
    >
      {/* Atmospheric background blobs */}
      <div style={{ position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)", width: 320, height: 320, borderRadius: "50%", background: `radial-gradient(ellipse, ${C.accent}0D 0%, transparent 70%)`, pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "absolute", bottom: 40, right: -60, width: 200, height: 200, borderRadius: "50%", background: `radial-gradient(ellipse, ${C.accent}07 0%, transparent 70%)`, pointerEvents: "none", zIndex: 0 }} />

      {/* Header */}
      <div
        style={{
          padding: "12px 16px 11px",
          borderBottom: `1px solid rgba(44,61,82,0.85)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 1,
          background: "linear-gradient(180deg, rgba(8,14,20,0.72), rgba(8,14,20,0.42))",
          backdropFilter: "blur(3px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <img src="../icons/icon48.png" alt="Forge-OS" style={{ width: 24, height: 24, objectFit: "contain", filter: "drop-shadow(0 0 8px rgba(57,221,182,0.55))" }} />
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.1em" }}>
            <span style={{ color: C.accent }}>FORGE</span><span style={{ color: C.text }}>-OS</span>
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={handleCycleNetwork}
            title="Click to switch network"
            style={{
              fontSize: 9,
              color: netColor,
              fontWeight: 700,
              letterSpacing: "0.1em",
              background: `${netColor}18`,
              border: `1px solid ${netColor}3A`,
              borderRadius: 999,
              padding: "4px 10px",
              cursor: "pointer",
              ...mono,
              transition: "all 180ms ease",
            }}
          >{NETWORK_LABELS[network] ?? network.toUpperCase()}</button>

          <span
            title="Node sync/index status"
            style={{
              fontSize: 8,
              color: nodeHealthColor,
              fontWeight: 700,
              letterSpacing: "0.08em",
              background: `${nodeHealthColor}18`,
              border: `1px solid ${nodeHealthColor}3A`,
              borderRadius: 999,
              padding: "4px 8px",
              ...mono,
            }}
          >
            {nodeHealthLabel}
          </span>

          {isManagedWallet && (
            <button
              onClick={handleLock}
              title="Lock wallet"
              style={{
                background: "rgba(33,48,67,0.48)",
                border: `1px solid rgba(44,61,82,0.86)`,
                borderRadius: 999,
                padding: "4px 9px",
                color: C.dim,
                fontSize: 10,
                cursor: "pointer",
                ...mono,
                transition: "all 180ms ease",
              }}
            >🔒</button>
          )}
        </div>
      </div>

      {/* Address + balance hero */}
      {address ? (
        <div
          style={{
            margin: "12px 12px 10px",
            padding: "18px 14px 14px",
            border: `1px solid rgba(44,61,82,0.88)`,
            borderRadius: 16,
            textAlign: "center",
            position: "relative",
            zIndex: 1,
            background: "linear-gradient(160deg, rgba(14,22,31,0.86) 0%, rgba(9,14,21,0.86) 100%)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 14px 26px rgba(0,0,0,0.24)",
          }}
        >
          {/* Address row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 16 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.ok, flexShrink: 0, boxShadow: `0 0 6px ${C.ok}` }} />
            <span style={{ fontSize: 10, color: C.dim, letterSpacing: "0.04em" }}>{shortAddr(address)}</span>
            <button
              onClick={copyAddress}
              style={{
                ...outlineButton(copied ? C.ok : C.dim, true),
                padding: "3px 8px",
                fontSize: 9,
                letterSpacing: "0.08em",
                color: copied ? C.ok : C.dim,
                minWidth: 56,
              }}
            >{copied ? "COPIED" : "COPY"}</button>
          </div>

          {/* Portfolio value (fiat primary) */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 8, color: C.dim, letterSpacing: "0.1em" }}>
                TOTAL PORTFOLIO VALUE
              </span>
              <button
                onClick={handleToggleHidePortfolioBalances}
                aria-label={hidePortfolioBalances ? "Show portfolio balances" : "Hide portfolio balances"}
                title={hidePortfolioBalances ? "Show portfolio balances" : "Hide portfolio balances"}
                style={{
                  ...outlineButton(hidePortfolioBalances ? C.warn : C.dim, true),
                  padding: "3px 0",
                  fontSize: 9,
                  letterSpacing: "0.08em",
                  color: hidePortfolioBalances ? C.warn : C.dim,
                  minWidth: 34,
                  width: 34,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                  style={{ flexShrink: 0 }}
                >
                  <path
                    d="M1 6C1 6 2.8 3.4 6 3.4C9.2 3.4 11 6 11 6C11 6 9.2 8.6 6 8.6C2.8 8.6 1 6 1 6Z"
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                  <circle cx="6" cy="6" r="1.3" fill="currentColor" />
                  {hidePortfolioBalances && (
                    <path d="M1.3 1.3L10.7 10.7" stroke="currentColor" strokeWidth="1.2" />
                  )}
                </svg>
              </button>
            </div>
            <div
              style={{
                fontSize: 40,
                fontWeight: 700,
                color: C.text,
                letterSpacing: "0.01em",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {maskedPortfolioDisplayValue}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            {[
              {
                label: "SEND",
                action: () => {
                  setTab("wallet");
                  setWalletMode("send");
                  setWalletModeRequestId((id) => id + 1);
                },
              },
              {
                label: "RECEIVE",
                action: () => {
                  setTab("wallet");
                  setWalletMode("receive");
                  setWalletModeRequestId((id) => id + 1);
                },
              },
              { label: "SWAP",  action: () => setShowSwapOverlay(true) },
            ].map(btn => (
              <button
                key={btn.label}
                onClick={btn.action}
                style={{
                  flex: 1,
                  background: `linear-gradient(145deg, ${C.accent}1A, rgba(8,13,20,0.7))`,
                  border: `1px solid ${C.accent}40`,
                  borderRadius: 12, padding: "9px 0",
                  color: C.accent, fontSize: 10, fontWeight: 700, cursor: "pointer", ...mono,
                  letterSpacing: "0.1em",
                  transition: "all 180ms ease",
                }}
              >{btn.label}</button>
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            margin: "12px 12px 10px",
            padding: "26px 14px",
            textAlign: "center",
            border: `1px solid rgba(44,61,82,0.88)`,
            borderRadius: 16,
            position: "relative",
            zIndex: 1,
            background: "linear-gradient(160deg, rgba(14,22,31,0.86) 0%, rgba(9,14,21,0.86) 100%)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 14px 26px rgba(0,0,0,0.24)",
          }}
        >
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 12 }}>No wallet connected</div>
          <button
            onClick={() => chrome.tabs.create({ url: "https://forge-os.xyz" })}
            style={{
              background: `linear-gradient(90deg, ${C.accent}, #7BE9CF)`, color: "#04110E",
              border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 11,
              fontWeight: 700, cursor: "pointer", ...mono, letterSpacing: "0.08em",
            }}
          >OPEN FORGE-OS →</button>
        </div>
      )}

      {/* Swap overlay (hero action) */}
      {showSwapOverlay && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 40,
            background: "rgba(3,7,12,0.78)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "10px 8px 12px",
            backdropFilter: "blur(1px)",
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            setShowSwapOverlay(false);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: EXTENSION_POPUP_BASE_WIDTH - 10,
              maxHeight: "100%",
              borderRadius: 14,
              border: `1px solid ${C.border}`,
              background: "linear-gradient(165deg, rgba(8,13,20,0.98) 0%, rgba(5,9,15,0.98) 100%)",
              boxShadow: "0 18px 34px rgba(0,0,0,0.45)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, letterSpacing: "0.1em", ...mono }}>
                SWAP
              </div>
              <button
                onClick={() => setShowSwapOverlay(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: C.dim,
                  fontSize: 14,
                  cursor: "pointer",
                  ...mono,
                }}
                aria-label="Close swap overlay"
                title="Close swap overlay"
              >
                ✕
              </button>
            </div>
            <div style={{ overflowY: "auto", padding: "8px 8px 10px", flex: 1 }}>
              <SwapTab />
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "0 12px 10px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {(["wallet", "swap", "agents", "security"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              background: tab === t ? `${C.accent}14` : "rgba(14,21,30,0.6)",
              border: `1px solid ${tab === t ? `${C.accent}4A` : "rgba(44,61,82,0.8)"}`,
              borderRadius: 10,
              color: tab === t ? C.accent : C.dim,
              fontSize: 10, fontWeight: 700, cursor: "pointer",
              padding: "9px 0", letterSpacing: "0.1em", ...mono,
              textTransform: "uppercase", transition: "all 180ms ease",
              boxShadow: tab === t ? `0 6px 14px ${C.accent}25` : "none",
            }}
          >{t}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto", position: "relative", zIndex: 1 }}>
        {tab === "wallet" && (
          <WalletTab
            address={address}
            balance={balance}
            usdPrice={usdPrice}
            network={network}
            mode={walletMode}
            modeRequestId={walletModeRequestId}
            onModeConsumed={() => setWalletMode(undefined)}
            onBalanceInvalidated={() => session?.address && fetchBalances(session.address, network)}
            hideBalances={hidePortfolioBalances}
            onKrcPortfolioUpdate={setKrcPortfolioUsdTotal}
          />
        )}
        {tab === "swap" && <SwapTab />}
        {tab === "agents" && <AgentsTab network={network} />}
        {tab === "security" && (
          <SecurityTab
            address={address}
            network={network}
            isManagedWallet={isManagedWallet}
            autoLockMinutes={autoLockMinutes}
            persistUnlockSessionEnabled={persistUnlockSessionEnabled}
            onAutoLockMinutesChange={handleAutoLockMinutesChanged}
            onPersistUnlockSessionChange={handlePersistUnlockSessionChanged}
            onLock={handleLock}
          />
        )}
      </div>

      {/* Footer — live DAG info */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: `1px solid rgba(44,61,82,0.82)`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          position: "relative",
          zIndex: 1,
          background: "linear-gradient(180deg, rgba(8,14,20,0.32), rgba(8,14,20,0.56))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 8, color: C.muted, letterSpacing: "0.06em" }}>FORGE-OS</span>
          <span style={{ fontSize: 8, color: feedColor, letterSpacing: "0.05em", fontWeight: 700 }}>
            · {feedLabel}
          </span>
          <span style={{ fontSize: 8, color: nodeHealthColor, letterSpacing: "0.05em", fontWeight: 700 }}>
            · {nodeHealthLabel}
          </span>
          {dagScore && (
            <span style={{ fontSize: 8, color: C.dim, letterSpacing: "0.04em" }}>
              · {NETWORK_BPS[network] ?? 10} BPS · DAA {(parseInt(dagScore, 10) / 1_000_000).toFixed(1)}M
            </span>
          )}
        </div>
        <button
          onClick={() => chrome.tabs.create({ url: "https://forge-os.xyz" })}
          style={{ background: "none", border: "none", color: C.accent, fontSize: 8, cursor: "pointer", ...mono, letterSpacing: "0.06em" }}
        >OPEN SITE ↗</button>
      </div>
      {feedStatusMessage && (
        <div style={{ padding: "0 16px 7px", fontSize: 8, color: C.warn, letterSpacing: "0.03em", position: "relative", zIndex: 1 }}>
          {feedStatusMessage}
        </div>
      )}
    </div>
  );
}
