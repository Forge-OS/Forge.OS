import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACCUMULATE_ONLY,
  ACCUMULATION_VAULT,
  ALLOWED_ADDRESS_PREFIXES,
  AGENT_SPLIT,
  AUTO_CYCLE_SECONDS,
  CONF_THRESHOLD,
  ENFORCE_WALLET_NETWORK,
  EXPLORER,
  FEE_RATE,
  FREE_CYCLES_PER_DAY,
  KAS_API,
  KAS_API_FALLBACKS,
  KAS_WS_URL,
  LIVE_EXECUTION_DEFAULT,
  DEFAULT_NETWORK,
  NETWORK_LABEL,
  NET_FEE,
  RESERVE,
  TREASURY_SPLIT,
  TREASURY,
  TREASURY_FEE_KAS,
  TREASURY_FEE_ONCHAIN_ENABLED,
  PNL_REALIZED_CONFIRMATION_POLICY,
  PNL_REALIZED_MIN_CONFIRMATIONS,
} from "../../constants";
import { fmtT, shortAddr, uid } from "../../helpers";
import { runQuantEngineClient, getQuantEngineClientMode } from "../../quant/runQuantEngineClient";
import { deriveAdaptiveAutoApproveThreshold } from "../../quant/autoThreshold";
import { computeDagSignals, formatDagSignalsLog } from "../../kaspa/dagSignals";
import { LOG_COL, seedLog } from "../../log/seedLog";
import { C, mono } from "../../tokens";
import { consumeUsageCycle, getUsageState } from "../../runtime/usageQuota";
import { derivePnlAttribution } from "../../analytics/pnlAttribution";
import { formatForgeError, normalizeError } from "../../runtime/errorTaxonomy";
import { buildQueueTxItem } from "../../tx/queueTx";
import { WalletAdapter } from "../../wallet/WalletAdapter";
import { getAgentDepositAddress } from "../../runtime/agentDeposit";
import { useAgentLifecycle } from "./hooks/useAgentLifecycle";
import { useAutoCycleLoop } from "./hooks/useAutoCycleLoop";
import { usePriceTrigger } from "./hooks/usePriceTrigger";
import { useAlerts } from "./hooks/useAlerts";
import { useDashboardRuntimePersistence } from "./hooks/useDashboardRuntimePersistence";
import { useDashboardUiSummary } from "./hooks/useDashboardUiSummary";
import { useExecutionGuardrailsPolicy } from "./hooks/useExecutionGuardrailsPolicy";
import { useExecutionQueue } from "./hooks/useExecutionQueue";
import { useKaspaFeed } from "./hooks/useKaspaFeed";
import { usePortfolioAllocator } from "./hooks/usePortfolioAllocator";
import { useTreasuryPayout } from "./hooks/useTreasuryPayout";
import { SigningModal } from "../SigningModal";
import { Badge, Btn, Card, ExtLink, Label, Inp } from "../ui";
import { EXEC_OPTS, STRATEGY_TEMPLATES, PROFESSIONAL_PRESETS, RISK_OPTS } from "../wizard/constants";
import { ActionQueue } from "./ActionQueue";
import { DashboardRuntimeNotices } from "./DashboardRuntimeNotices";
import { WalletPanel } from "./WalletPanel";
import { SwapView } from "../SwapView";
import { buildPairExecutionIntent, describePairMode, formatPairIntentLog } from "../../quant/pairTrading";
import { checkAndTriggerOrders, markOrderExecuted } from "../../quant/limitOrder";
import { checkDcaSchedules, markDcaExecuted } from "../../quant/dcaScheduler";
import {
  loadStopLossState,
  recordAccumulateFill,
  updatePeakPrice,
  resetPositionAfterReduce,
  checkStopConditions,
  formatStopStatus,
  isInStopCooldown,
  enterStopCooldown,
  type StopLossState,
} from "../../quant/stopLoss";
import {
  formatOutcomesForPrompt,
  recordTradeBroadcast,
  confirmPendingOutcomes,
} from "../../quant/tradeOutcomes";
import { fetchOnChainAnalytics, formatOnChainAnalyticsForPrompt } from "../../quant/onChainAnalytics";
import { fetchKrcBalance, invalidateKrcBalanceCache } from "../../quant/krcBalance";
import { executePairIntent, isPairSwapConfigured } from "../../swap/pairSwap";

const IntelligencePanel = lazy(() =>
  import("./IntelligencePanel").then((m) => ({ default: m.IntelligencePanel }))
);
const PortfolioPanel = lazy(() => import("./PortfolioPanel").then((m) => ({ default: m.PortfolioPanel })));
const PnlAttributionPanel = lazy(() =>
  import("./PnlAttributionPanel").then((m) => ({ default: m.PnlAttributionPanel }))
);
const AlertsPanel = lazy(() => import("./AlertsPanel").then((m) => ({ default: m.AlertsPanel })));
const QuantAnalyticsPanel = lazy(() => import("./QuantAnalyticsPanel").then((m) => ({ default: m.QuantAnalyticsPanel })));
const BacktestPanel = lazy(() => import("./BacktestPanel").then((m) => ({ default: m.BacktestPanel })));
const LeaderboardPanel = lazy(() => import("./LeaderboardPanel").then((m) => ({ default: m.LeaderboardPanel })));
const NetworkPanel = lazy(() => import("./NetworkPanel").then((m) => ({ default: m.NetworkPanel })));
const OverviewPanel = lazy(() => import("./OverviewPanel").then((m) => ({ default: m.OverviewPanel })));
import { PanelSkeleton } from "./PanelSkeleton";

const VALID_EXEC_MODES = ["autonomous", "manual", "notify", "paper"];

function normalizeExecMode(value: any) {
  const mode = String(value || "").toLowerCase();
  return VALID_EXEC_MODES.includes(mode) ? mode : "manual";
}

function buildStrategyEditForm(agent: any) {
  return {
    strategyTemplate: String(agent?.strategyTemplate || "dca_accumulator"),
    strategyLabel: String(agent?.strategyLabel || "Steady DCA Builder"),
    risk: String(agent?.risk || "medium"),
    kpiTarget: String(agent?.kpiTarget || "12"),
    capitalLimit: String(agent?.capitalLimit || "5000"),
    horizon: Number(agent?.horizon || 30),
    autoApproveThreshold: String(agent?.autoApproveThreshold || "100"),
    execMode: normalizeExecMode(agent?.execMode),
  };
}

function toNumberString(value: any, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(fallback);
}

export function Dashboard({agent, wallet, agents = [], activeAgentId, onSelectAgent, onDeleteAgent, onEditAgent, onPatchAgent}: any) {
  const LIVE_POLL_MS = 2000;           // 2 s – faster wallet-balance refresh
  const STREAM_RECONNECT_MAX_DELAY_MS = 8000;
  const RECEIPT_RETRY_BASE_MS = 2000;
  const RECEIPT_RETRY_MAX_MS = 30000;
  const RECEIPT_TIMEOUT_MS = 8 * 60 * 1000;
  const RECEIPT_MAX_ATTEMPTS = 18;
  const RECEIPT_POLL_INTERVAL_MS = 1200;
  const RECEIPT_POLL_BATCH_SIZE = 3;
  const MAX_QUEUE_ENTRIES = 160;
  const MAX_LOG_ENTRIES = 320;
  const MAX_DECISION_ENTRIES = 120;
  const MAX_MARKET_SNAPSHOTS = 240;
  const cycleIntervalMs = AUTO_CYCLE_SECONDS * 1000;
  const usageScope = `${DEFAULT_NETWORK}:${String(wallet?.address || "unknown").toLowerCase()}`;
  const portfolioScope = usageScope;
  const alertScope = usageScope;
  const runtimeScope = `${DEFAULT_NETWORK}:${String(wallet?.address || "unknown").toLowerCase()}:${String(agent?.agentId || agent?.name || "default").toLowerCase()}`;
  const cycleLockRef = useRef(false);
  const lastRegimeRef = useRef("");
  const lastAdaptiveThresholdReasonRef = useRef("");
  // Execution backoff refs: exponential delay after consecutive RPC/execution failures.
  const consecutiveExecutionFailuresRef = useRef(0);
  const executionBackoffUntilRef = useRef(0);
  // Regime hold tracking: count of consecutive cycles in which the current regime held.
  const regimeHoldCyclesRef = useRef(0);
  const lastRegimeForHoldRef = useRef("");
  const [runtimeHydrated, setRuntimeHydrated] = useState(false);
  const [tab, setTab] = useState("overview");
  // Helper to read persisted state from localStorage
  const readPersistedState = (scope: string) => {
    if (typeof window === "undefined") return null;
    try {
      const key = `forgeos_dashboard_${scope}`;
      const stored = window.localStorage.getItem(key);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  };

  // Get persisted values if available
  const persistedState = runtimeScope ? readPersistedState(runtimeScope) : null;
  
  const { status, setStatus, transitionAgentStatus } = useAgentLifecycle(
    persistedState?.status || (agent?.name ? "RUNNING" : "PAUSED")
  );
  const [log, setLog] = useState(()=>seedLog(agent.name));
  const [decisions, setDecisions] = useState([] as any[]);
  const [loading, setLoading] = useState(false);
  // Get persisted execMode value if available (validate it's a valid option)
  const initialExecMode = persistedState?.execMode && VALID_EXEC_MODES.includes(String(persistedState.execMode))
    ? String(persistedState.execMode)
    : normalizeExecMode(agent.execMode);
  const [execMode, setExecMode] = useState(initialExecMode);
  const baseAutoThresh = useMemo(() => parseFloat(agent.autoApproveThreshold) || 50, [agent.autoApproveThreshold]);
  const [usage, setUsage] = useState(() => getUsageState(FREE_CYCLES_PER_DAY, usageScope));
  // Get persisted liveExecutionArmed value if available
  const initialLiveExecutionArmed = persistedState?.liveExecutionArmed !== undefined 
    ? persistedState.liveExecutionArmed 
    : LIVE_EXECUTION_DEFAULT;
  const [liveExecutionArmed, setLiveExecutionArmed] = useState(initialLiveExecutionArmed);
  const [paperPnlKas, setPaperPnlKas] = useState(0); // simulated P&L for paper mode
  // Stablecoin balance used for pair trading (USDC/USDT KRC20). Populated by KRC portfolio
  // hook when agent.pairMode === "kas-usdc". Defaults to 0 (no USDC = pair mode pauses BUY_KAS).
  const [stableBalanceKrc, setStableBalanceKrc] = useState(0);
  // Poll KRC-20 stablecoin balance when pair trading is active.
  const agentPairMode = String(agent?.pairMode || "accumulation");
  useEffect(() => {
    if (!wallet?.address || agentPairMode === "accumulation") return;
    const stableTick = (import.meta.env.VITE_PAIR_STABLE_TICK || "USDC").trim().toUpperCase();
    let cancelled = false;
    const refresh = async () => {
      const balance = await fetchKrcBalance(wallet.address!, stableTick).catch(() => 0);
      if (!cancelled) setStableBalanceKrc(balance);
    };
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [wallet?.address, agentPairMode]);
  const [stopLossState, setStopLossState] = useState<StopLossState>(() =>
    loadStopLossState(agent?.agentId || "default")
  );
  const [nextAutoCycleAt, setNextAutoCycleAt] = useState(() => Date.now() + cycleIntervalMs);
const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  const [editingStrategy, setEditingStrategy] = useState(false);
  const [editForm, setEditForm] = useState(() => buildStrategyEditForm(agent));
  const allStrategies = useMemo(
    () => [...STRATEGY_TEMPLATES, ...PROFESSIONAL_PRESETS.filter((p) => p.id !== "custom")],
    []
  );
  const strategyOptions = useMemo(() => [...STRATEGY_TEMPLATES, ...PROFESSIONAL_PRESETS], []);
  const strategyById = useMemo(
    () => new Map(strategyOptions.map((strategy: any) => [String(strategy.id), strategy])),
    [strategyOptions]
  );
  const quantClientMode = useMemo(() => getQuantEngineClientMode(), []);

  const {
    kasData,
    marketHistory,
    setMarketHistory,
    kasDataLoading,
    kasDataError,
    liveConnected,
    streamConnected,
    streamRetryCount,
    streamPulse,
    lastStreamEvent,
    refreshKasData,
  } = useKaspaFeed({
    walletAddress: wallet?.address,
    wsUrl: KAS_WS_URL,
    livePollMs: LIVE_POLL_MS,
    streamReconnectMaxDelayMs: STREAM_RECONNECT_MAX_DELAY_MS,
    maxMarketSnapshots: MAX_MARKET_SNAPSHOTS,
  });

  const addLog = useCallback(
    (e: any) => setLog((p: any) => [{ ts: Date.now(), ...e }, ...p].slice(0, MAX_LOG_ENTRIES)),
    [MAX_LOG_ENTRIES]
  );
  const applyAgentPatch = useCallback(
    (targetAgentId: string, patch: Record<string, any>, logMessage?: string) => {
      const id = String(targetAgentId || "").trim();
      if (!id || !patch || Object.keys(patch).length === 0) return;
      onPatchAgent?.(id, patch);

      if (String(agent?.agentId || agent?.name || "") === id && typeof patch.execMode === "string") {
        setExecMode(normalizeExecMode(patch.execMode));
      }
      if (logMessage) {
        addLog({ type: "SYSTEM", msg: logMessage, fee: null });
      }
    },
    [addLog, agent?.agentId, agent?.name, onPatchAgent]
  );

  const updateActiveExecMode = useCallback(
    (nextMode: string) => {
      const normalizedMode = normalizeExecMode(nextMode);
      setExecMode(normalizedMode);
      const id = String(agent?.agentId || agent?.name || "").trim();
      if (id) {
        onPatchAgent?.(id, { execMode: normalizedMode });
      }
    },
    [agent?.agentId, agent?.name, onPatchAgent]
  );

  const handleStrategySelect = useCallback((strategy: any) => {
    if (!strategy) return;
    setEditForm((prev: any) => ({
      ...prev,
      strategyTemplate: String(strategy.id),
      strategyLabel: String(strategy.name || prev.strategyLabel || "Custom"),
      risk: String(strategy?.defaults?.risk || prev.risk || "medium"),
      kpiTarget: toNumberString(strategy?.defaults?.kpiTarget ?? prev.kpiTarget, 12),
      capitalLimit: toNumberString(prev.capitalLimit, 5000),
      horizon: Number(strategy?.defaults?.horizon || prev.horizon || 30),
      autoApproveThreshold: toNumberString(strategy?.defaults?.autoApproveThreshold ?? prev.autoApproveThreshold, 50),
      execMode: normalizeExecMode(strategy?.defaults?.execMode || prev.execMode || "manual"),
    }));
  }, []);

  const handleSaveStrategy = useCallback(() => {
    const id = String(agent?.agentId || agent?.name || "").trim();
    if (!id) return;
    const strategy = strategyById.get(String(editForm.strategyTemplate || ""));
    const patch = {
      strategyTemplate: String(editForm.strategyTemplate || "custom"),
      strategyLabel: String(editForm.strategyLabel || strategy?.name || "Custom"),
      strategyClass: String(strategy?.class || agent?.strategyClass || "custom"),
      risk: String(editForm.risk || "medium"),
      kpiTarget: toNumberString(editForm.kpiTarget, 12),
      capitalLimit: toNumberString(editForm.capitalLimit, 5000),
      horizon: Number(editForm.horizon || 30),
      autoApproveThreshold: toNumberString(editForm.autoApproveThreshold, 50),
      execMode: normalizeExecMode(editForm.execMode),
    };

    applyAgentPatch(id, patch, `Strategy updated to ${patch.strategyLabel} · mode ${String(patch.execMode).toUpperCase()}.`);
    setEditingStrategy(false);
  }, [agent?.agentId, agent?.name, agent?.strategyClass, applyAgentPatch, editForm, strategyById]);

  const handleAgentStrategyQuickChange = useCallback(
    (targetAgent: any, strategyId: string) => {
      const id = String(targetAgent?.agentId || targetAgent?.name || "").trim();
      if (!id) return;
      const strategy = strategyById.get(String(strategyId || ""));
      if (!strategy) return;

      const patch = {
        strategyTemplate: String(strategy.id),
        strategyLabel: String(strategy.name || targetAgent?.strategyLabel || "Custom"),
        strategyClass: String(strategy.class || targetAgent?.strategyClass || "custom"),
        risk: String(strategy?.defaults?.risk || targetAgent?.risk || "medium"),
        kpiTarget: toNumberString(strategy?.defaults?.kpiTarget ?? targetAgent?.kpiTarget, 12),
        capitalLimit: toNumberString(targetAgent?.capitalLimit, 5000),
        horizon: Number(strategy?.defaults?.horizon || targetAgent?.horizon || 30),
        autoApproveThreshold: toNumberString(strategy?.defaults?.autoApproveThreshold ?? targetAgent?.autoApproveThreshold, 50),
        execMode: normalizeExecMode(strategy?.defaults?.execMode || targetAgent?.execMode || "manual"),
      };

      applyAgentPatch(
        id,
        patch,
        `${String(targetAgent?.name || "Agent")} strategy set to ${patch.strategyLabel} · mode ${String(patch.execMode).toUpperCase()}.`
      );
      if (String(agent?.agentId || agent?.name || "") === id) {
        setEditForm(buildStrategyEditForm({ ...targetAgent, ...patch }));
      }
    },
    [agent?.agentId, agent?.name, applyAgentPatch, strategyById]
  );

  const handleAgentExecModeQuickChange = useCallback(
    (targetAgent: any, nextMode: string) => {
      const id = String(targetAgent?.agentId || targetAgent?.name || "").trim();
      if (!id) return;
      const normalizedMode = normalizeExecMode(nextMode);
      applyAgentPatch(
        id,
        { execMode: normalizedMode },
        `${String(targetAgent?.name || "Agent")} execution mode set to ${normalizedMode.toUpperCase()}.`
      );
    },
    [applyAgentPatch]
  );

  useEffect(() => {
    setEditForm(buildStrategyEditForm(agent));
    setEditingStrategy(false);
  }, [
    agent?.agentId,
    agent?.name,
    agent?.strategyTemplate,
    agent?.strategyLabel,
    agent?.risk,
    agent?.kpiTarget,
    agent?.capitalLimit,
    agent?.horizon,
    agent?.autoApproveThreshold,
    agent?.execMode,
  ]);

  const activeStrategyLabel = String(agent?.strategyLabel || agent?.strategyTemplate || "Custom");
  const {
    alertConfig,
    alertSaveBusy,
    lastAlertResult,
    sendAlertEvent,
    patchAlertConfig,
    toggleAlertType,
    saveAlertConfig,
    sendTestAlert,
  } = useAlerts({
    alertScope,
    agentName: agent?.name,
    agentId: agent?.agentId,
    activeStrategyLabel,
  });
  const {
    queue,
    setQueue,
    signingItem,
    pendingCount,
    sendWalletTransfer,
    receiptBackoffMs,
    prependQueueItem,
    prependSignedBroadcastedQueueItem,
    handleQueueSign,
    handleQueueReject,
    handleSigningReject,
    handleSigned: handleSignedBase,
    rejectAllPending,
    receiptConsistencyMetrics,
  } = useExecutionQueue({
    wallet,
    maxQueueEntries: MAX_QUEUE_ENTRIES,
    addLog,
    kasPriceUsd: Number(kasData?.priceUsd || 0),
    setTab,
    receiptRetryBaseMs: RECEIPT_RETRY_BASE_MS,
    receiptRetryMaxMs: RECEIPT_RETRY_MAX_MS,
    receiptTimeoutMs: RECEIPT_TIMEOUT_MS,
    receiptMaxAttempts: RECEIPT_MAX_ATTEMPTS,
    receiptPollIntervalMs: RECEIPT_POLL_INTERVAL_MS,
    receiptPollBatchSize: RECEIPT_POLL_BATCH_SIZE,
    sendAlertEvent,
    agentName: agent?.name,
    agentId: agent?.agentId,
  });

  const { settleTreasuryFeePayout, attachCombinedTreasuryOutput } = useTreasuryPayout({
    enabled: TREASURY_FEE_ONCHAIN_ENABLED,
    treasuryFeeKas: TREASURY_FEE_KAS,
    treasuryAddress: TREASURY,
    walletAddress: wallet?.address,
    walletProvider: wallet?.provider,
    kasPriceUsd: Number(kasData?.priceUsd || 0),
    maxQueueEntries: MAX_QUEUE_ENTRIES,
    addLog,
    setQueue,
    sendWalletTransfer,
    receiptBackoffMs,
  });

  useEffect(() => {
    setUsage(getUsageState(FREE_CYCLES_PER_DAY, usageScope));
  }, [usageScope]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (status === "RUNNING") {
      setNextAutoCycleAt(Date.now() + cycleIntervalMs);
    }
  }, [status, cycleIntervalMs]);

  useEffect(() => {
    // Migrate legacy persisted tab value after billing/paywall UI removal.
    if (tab === "billing") setTab("treasury");
  }, [tab]);

  // ── Regime hold persistence ──────────────────────────────────────────────────
  // Hydrate on mount so adaptive Kelly dampening survives page reloads.
  useEffect(() => {
    if (!runtimeScope) return;
    try {
      const stored = JSON.parse(localStorage.getItem(`forgeos.regime.hold.${runtimeScope}`) || "{}");
      if (Number.isFinite(stored.cycles)) regimeHoldCyclesRef.current = Number(stored.cycles);
      if (typeof stored.regime === "string")  lastRegimeForHoldRef.current = stored.regime;
    } catch { /* ignore */ }
  }, [runtimeScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist after every new decision (refs are always up-to-date by that point).
  useEffect(() => {
    if (!runtimeScope) return;
    try {
      localStorage.setItem(
        `forgeos.regime.hold.${runtimeScope}`,
        JSON.stringify({ cycles: regimeHoldCyclesRef.current, regime: lastRegimeForHoldRef.current })
      );
    } catch { /* ignore */ }
  }, [decisions.length, runtimeScope]); // eslint-disable-line react-hooks/exhaustive-deps

  const riskThresh = agent?.risk==="low"?0.4:agent?.risk==="medium"?0.65:0.85;
  const allAgents = useMemo(() => {
    const source = Array.isArray(agents) && agents.length > 0 ? agents : [agent];
    const deduped = new Map<string, any>();
    for (const row of source) {
      const id = String(row?.agentId || row?.name || "").trim();
      if (!id) continue;
      deduped.set(id, row);
    }
    return Array.from(deduped.values());
  }, [agent, agents]);

  const pnlAttributionBase = useMemo(
    () =>
      derivePnlAttribution({
        decisions,
        queue,
        log,
        marketHistory,
        realizedMinConfirmations: PNL_REALIZED_MIN_CONFIRMATIONS,
        confirmationDepthPolicy: PNL_REALIZED_CONFIRMATION_POLICY as any,
      }),
    [decisions, queue, log, marketHistory]
  );
  const executionGuardrails = useExecutionGuardrailsPolicy({
    pnlAttribution: pnlAttributionBase,
    receiptConsistencyMetrics,
  });
  const adaptiveAutoThreshold = useMemo(
    () =>
      deriveAdaptiveAutoApproveThreshold({
        baseThresholdKas: baseAutoThresh,
        decisions,
        marketHistory,
        calibrationHealth: executionGuardrails?.calibration?.health,
        truthDegraded: executionGuardrails?.truth?.degraded,
        minimumSamples: 10,
        maxSamples: 48,
      }),
    [
      baseAutoThresh,
      decisions,
      executionGuardrails?.calibration?.health,
      executionGuardrails?.truth?.degraded,
      marketHistory,
    ]
  );
  const pnlAttribution = useMemo(() => {
    const truth = executionGuardrails.truth;
    const base = pnlAttributionBase as any;
    const downgradedMode =
      truth.degraded && String(base?.netPnlMode || "") === "realized"
        ? "hybrid"
        : base?.netPnlMode;
    return {
      ...base,
      netPnlMode: downgradedMode,
      truthDegraded: truth.degraded,
      truthDegradedReason: truth.reasons?.[0] || "",
      truthMismatchRatePct: truth.mismatchRatePct,
      truthCheckedSignals: truth.checked,
      truthMismatchSignals: truth.mismatches,
    };
  }, [executionGuardrails.truth, pnlAttributionBase]);

  useDashboardRuntimePersistence({
    agent,
    cycleIntervalMs,
    runtimeScope,
    maxDecisionEntries: MAX_DECISION_ENTRIES,
    maxLogEntries: MAX_LOG_ENTRIES,
    maxQueueEntries: MAX_QUEUE_ENTRIES,
    maxMarketSnapshots: MAX_MARKET_SNAPSHOTS,
    runtimeHydrated,
    setRuntimeHydrated,
    status,
    execMode,
    liveExecutionArmed,
    queue,
    log,
    decisions,
    marketHistory,
    attributionSummary: pnlAttribution,
    nextAutoCycleAt,
    setStatus,
    setExecMode,
    setLiveExecutionArmed,
    setQueue,
    setLog,
    setDecisions,
    setMarketHistory,
    setNextAutoCycleAt,
    liveExecutionDefault: LIVE_EXECUTION_DEFAULT,
  });

  const {
    portfolioConfig,
    portfolioSummary,
    activePortfolioRow,
    patchPortfolioConfig,
    patchPortfolioAgentOverride,
    refreshPortfolioPeers,
  } = usePortfolioAllocator({
    portfolioScope,
    allAgents,
    activeAgentId: agent?.agentId,
    walletAddress: wallet?.address,
    walletKas: Number(kasData?.walletKas || 0),
    activeDecisions: decisions,
    activeQueue: queue,
    activeAttributionSummary: pnlAttribution,
  });

  // Price-reactive early cycle: fire immediately when KAS/USD moves ≥ 1%
  // instead of waiting for the next blind heartbeat interval.
  // Declared before runCycle so resetPriceTrigger is in scope for the finally block.
  const priceTriggerResetRef = useRef<() => void>(() => {});
  const { resetPriceTrigger } = usePriceTrigger({
    priceUsd: kasData?.priceUsd,
    enabled: status === "RUNNING" && liveExecutionArmed && liveConnected && runtimeHydrated,
    triggerThresholdPct: 1.0,
    onTrigger: (reason: string) => {
      addLog({ type: "DATA", msg: `Price trigger fired (${reason}) — accelerating next cycle.`, fee: null });
      setNextAutoCycleAt(Date.now() - 1);
    },
  });
  // Keep a stable ref so runCycle's finally block can call it without adding
  // resetPriceTrigger to the dep array (which would recreate runCycle on every tick).
  useEffect(() => { priceTriggerResetRef.current = resetPriceTrigger; }, [resetPriceTrigger]);

  const runCycle = useCallback(async()=>{
    if (cycleLockRef.current || status!=="RUNNING" || !runtimeHydrated) return;
    // EXECUTION BACKOFF (item 4): skip cycle if in exponential back-off window after failures.
    if (Date.now() < executionBackoffUntilRef.current) return;
    cycleLockRef.current = true;
    setLoading(true);
    let _cycleOk = false;
    try{
      if(!kasData){
        addLog({type:"ERROR", msg:"No live Kaspa data available. Reconnect feed before running cycle.", fee:null});
        return;
      }

      const dagSignals = computeDagSignals(marketHistory, DEFAULT_NETWORK);
      setNextAutoCycleAt(Date.now() + Math.round(cycleIntervalMs * dagSignals.cycleMultiplier));
      addLog({type:"DATA", msg:`Kaspa DAG snapshot: DAA ${kasData?.dag?.daaScore||"—"} · Wallet ${kasData?.walletKas||"—"} KAS`, fee:null});
      addLog({type:"DATA", msg:formatDagSignalsLog(dagSignals), fee:null});
      setUsage(consumeUsageCycle(FREE_CYCLES_PER_DAY, usageScope));

      const _onChainAnalytics = await fetchOnChainAnalytics(DEFAULT_NETWORK).catch(() => null);
      const rawDec = await runQuantEngineClient(agent, kasData||{}, {
        history: marketHistory,
        dagSignals,
        regimeHoldCycles: regimeHoldCyclesRef.current,
        extra: {
          utxoTotalKas: Number(kasData?.walletKas || 0),
          recentDecisions: decisions.slice(0, 5).map((d: any) => ({
            ts: d.ts,
            action: String(d?.dec?.action || "HOLD"),
            confidence_score: Number(d?.dec?.confidence_score || 0),
            rationale: String(d?.dec?.rationale || "").slice(0, 80),
          })),
          tradeOutcomesBlock: formatOutcomesForPrompt(agent?.agentId || "default", 5),
          onChainAnalyticsBlock: _onChainAnalytics ? formatOnChainAnalyticsForPrompt(_onChainAnalytics) : undefined,
        },
      });
      // Clone before any mutation so the original audit record is preserved.
      const dec = { ...rawDec };
      const decSource = String(dec?.decision_source || "ai");
      const quantRegime = String(dec?.quant_metrics?.regime || "NA");
      // REGIME HOLD TRACKING (item 5): count consecutive cycles in the same regime.
      if (quantRegime === lastRegimeForHoldRef.current) {
        regimeHoldCyclesRef.current += 1;
      } else {
        regimeHoldCyclesRef.current = 0;
        lastRegimeForHoldRef.current = quantRegime;
      }
      // Per-agent accumulate-only gate: falls back to global env flag when agent has no actionMode set.
      const agentActionMode = String(agent?.actionMode || "").toLowerCase();
      const effectiveAccumulateOnly =
        agentActionMode === "accumulate_only" || (agentActionMode === "" && ACCUMULATE_ONLY);
      if (effectiveAccumulateOnly && !["ACCUMULATE", "HOLD"].includes(dec.action)) {
        dec.action = "HOLD";
        dec.rationale = `${String(dec.rationale || "")} Execution constrained by accumulate-only mode.`.trim();
      }

      // PAIR TRADING INTENT: compute for "kas-usdc" and "dual" pair modes.
      // The intent is logged and queued; actual DEX/covenant dispatch happens via swap layer
      // once VITE_SWAP_DEX_ENDPOINT is live and (optionally) VITE_VPROG_ENABLED=true post May 2026.
      const pairIntent = buildPairExecutionIntent(
        dec.action,
        dec.kelly_fraction,
        Number(kasData?.priceUsd || 0),
        Number(kasData?.walletKas || 0),
        stableBalanceKrc,
        {
          pairMode: String(agent?.pairMode || "accumulation"),
          stableEntryBias: String(agent?.stableEntryBias || "0.6"),
          stableExitBias: String(agent?.stableExitBias || "0.4"),
          usdcSlippageTolerance: String(agent?.usdcSlippageTolerance || "0.5"),
          capitalLimit: Number(agent?.capitalLimit || 0),
        },
      );

      const decisionTs = Date.now();
      setDecisions((p: any)=>[{ts:decisionTs, dec, kasData, source:decSource}, ...p].slice(0, MAX_DECISION_ENTRIES));

      addLog({
        type:"AI",
        msg:`${dec.action} · Conf ${dec.confidence_score} · Kelly ${(dec.kelly_fraction*100).toFixed(1)}% · Monte Carlo ${dec.monte_carlo_win_pct}% win · regime:${quantRegime} · source:${decSource} · ${dec?.engine_latency_ms || 0}ms`,
        fee:0.12,
      });
      if (dec?.quant_metrics) {
        addLog({
          type:"DATA",
          msg:`Quant core → samples ${dec.quant_metrics.sample_count ?? "—"} · edge ${dec.quant_metrics.edge_score ?? "—"} · vol ${dec.quant_metrics.ewma_volatility ?? "—"} · dataQ ${dec.quant_metrics.data_quality_score ?? "—"}`,
          fee:null,
        });
      }
      if (decSource === "fallback" || decSource === "quant-core") {
        addLog({
          type:"SYSTEM",
          msg:`Local quant decision active (${dec?.decision_source_detail || "ai endpoint unavailable"}). Auto-approve uses same guardrails; AI overlay unavailable or bypassed.`,
          fee:null,
        });
        if (/ai_|timeout|endpoint|transport|request/i.test(String(dec?.decision_source_detail || ""))) {
          void sendAlertEvent({
            type: "ai_outage",
            key: `ai_outage:${String(agent?.agentId || agent?.name || "agent")}`,
            title: `${agent?.name || "Agent"} AI overlay unavailable`,
            message: `Quant core fallback active. detail=${String(dec?.decision_source_detail || "n/a")}`,
            severity: "warn",
            meta: { decision_source: decSource, regime: quantRegime },
          });
        }
      }

      const confOk = dec.confidence_score>=CONF_THRESHOLD;
      const riskOk = dec.risk_score<=riskThresh;
      const calibrationSizeMultiplier = Math.max(
        0,
        Math.min(1, Number(executionGuardrails?.effectiveSizingMultiplier || 1))
      );
      const autoApproveGuardrailDisabled = Boolean(executionGuardrails?.autoApproveDisabled);
      const autoApproveGuardrailReasons = Array.isArray(executionGuardrails?.autoApproveDisableReasons)
        ? executionGuardrails.autoApproveDisableReasons
        : [];
      const liveKas = Number(kasData?.walletKas || 0);
      const walletSupportsCombinedTreasury =
        TREASURY_FEE_ONCHAIN_ENABLED &&
        wallet?.provider !== "demo" &&
        TREASURY_FEE_KAS > 0 &&
        WalletAdapter.supportsNativeMultiOutput(String(wallet?.provider || ""));
      const treasuryPayoutReserveKas =
        TREASURY_FEE_ONCHAIN_ENABLED && wallet?.provider !== "demo" && TREASURY_FEE_KAS > 0
          ? (walletSupportsCombinedTreasury ? TREASURY_FEE_KAS : (TREASURY_FEE_KAS + NET_FEE))
          : 0;
      const availableToSpend = Math.max(0, liveKas - RESERVE - NET_FEE - treasuryPayoutReserveKas);
      const executionReady = liveConnected && !kasDataError && wallet?.provider !== "demo";
      const currentPrice = Number(kasData?.priceUsd || 0);

      // Close any pending trade outcomes that are old enough to be confirmed.
      if (currentPrice > 0) {
        confirmPendingOutcomes(agent.agentId || "default", currentPrice);
      }

      if(!riskOk){
        addLog({type:"VALID", msg:`Risk gate FAILED — score ${dec.risk_score} > ${riskThresh} ceiling`, fee:null});
        addLog({type:"EXEC", msg:"BLOCKED by risk gate", fee:0.03});
        void sendAlertEvent({
          type: "risk_event",
          key: `risk_gate:${String(agent?.agentId || agent?.name || "agent")}`,
          title: `${agent?.name || "Agent"} risk gate blocked cycle`,
          message: `Risk score ${dec.risk_score} exceeded ceiling ${riskThresh}. action=${dec.action} regime=${quantRegime}`,
          severity: "warn",
          meta: { risk_score: dec.risk_score, risk_ceiling: riskThresh, regime: quantRegime },
        });
      } else if(!confOk){
        addLog({type:"VALID", msg:`Confidence ${dec.confidence_score} < ${CONF_THRESHOLD} threshold`, fee:null});
        addLog({type:"EXEC", msg:"HOLD — confidence gate enforced", fee:0.08});
      } else if (dec.action === "ACCUMULATE" && availableToSpend <= 0) {
        addLog({
          type:"VALID",
          msg:`Insufficient spendable balance after reserve (${RESERVE} KAS), network fee (${NET_FEE} KAS), and treasury payout reserve (${treasuryPayoutReserveKas.toFixed(4)} KAS).`,
          fee:null
        });
        addLog({type:"EXEC", msg:"HOLD — waiting for available balance", fee:0.03});
      } else {
        addLog({type:"VALID", msg:`Risk OK (${dec.risk_score}) · Conf OK (${dec.confidence_score}) · Kelly ${(dec.kelly_fraction*100).toFixed(1)}%`, fee:null});

        // ── STOP-LOSS / TRAILING STOP GUARD ──────────────────────────────────────
        const _slState = updatePeakPrice(agent.agentId || "default", currentPrice);
        setStopLossState(_slState);
        const _slCheck = checkStopConditions(currentPrice, _slState, {
          stopLossPct: Number(agent?.stopLossPct || 0),
          trailingStopPct: Number(agent?.trailingStopPct || 0),
        });
        if (_slCheck.triggered && dec.action !== "REDUCE") {
          addLog({ type: "EXEC", msg: `STOP-LOSS TRIGGERED — ${_slCheck.label}`, fee: null });
          // Enter 4-hour re-entry cooldown to prevent whipsaw after a stop-loss exit.
          enterStopCooldown(agent.agentId || "default");
        }
        // effectiveAction may override ACCUMULATE/HOLD → REDUCE when stop fires.
        // Also gate ACCUMULATE if we're in a post-stop cooldown window.
        const inCooldown = isInStopCooldown(agent.agentId || "default");
        if (inCooldown && !_slCheck.triggered) {
          addLog({ type: "EXEC", msg: "Post-stop cooldown active — ACCUMULATE gated, holding.", fee: null });
        }
        const effectiveAction = _slCheck.triggered ? "REDUCE" : (inCooldown && dec.action === "ACCUMULATE" ? "HOLD" : dec.action);

        if (execMode === "notify") {
          addLog({type:"EXEC", msg:`NOTIFY mode active — ${dec.action} signal recorded, no transaction broadcast.`, fee:0.01});
        } else if (!liveExecutionArmed || !executionReady) {
          const reason = !liveExecutionArmed
            ? "live execution is disarmed"
            : "network feed or wallet provider is not execution-ready";
          addLog({
            type:"EXEC",
            msg:`Signal generated (${dec.action}) but no transaction broadcast because ${reason}.`,
            fee:0.01,
          });
        } else if(effectiveAction === "REDUCE"){
          // REDUCE = take-profit signal.
          if (pairIntent) {
            // Pair mode: sell KAS for stablecoin via DEX (or vProg covenant post KIP-9).
            addLog({ type:"EXEC", msg: formatPairIntentLog(pairIntent), fee:0.01 });
            if (isPairSwapConfigured() && execMode === "autonomous") {
              // DEX configured + autonomous mode → auto-execute swap.
              executePairIntent(pairIntent, wallet!.address!).then((result) => {
                addLog({
                  type:"EXEC",
                  msg:`PAIR SWAP: ${pairIntent.kasAmount.toFixed(4)} KAS → ${pairIntent.stableAmount.toFixed(2)} ${pairIntent.stableTick} · txid: ${result.txId.slice(0,16)}...`,
                  fee:0.01,
                });
                invalidateKrcBalanceCache(wallet!.address!, pairIntent.stableTick);
              }).catch((e: any) => {
                addLog({ type:"EXEC", msg:`Pair swap failed: ${e?.message || "unknown"} — position unchanged.`, fee:null });
              });
            } else {
              addLog({
                type:"SYSTEM",
                msg: isPairSwapConfigured()
                  ? `Pair swap ready — set exec mode to AUTONOMOUS for auto-execution.`
                  : `Set VITE_SWAP_DEX_ENDPOINT to auto-execute, or dispatch manually.${pairIntent.preferCovenant ? " vProg covenant path active post KIP-9." : ""}`,
                fee:null,
              });
            }
          } else {
            // Accumulation mode: no automated REDUCE execution; manual exchange transfer required.
            addLog({
              type:"EXEC",
              msg: _slCheck.triggered
                ? `STOP-LOSS EXIT — ${_slCheck.label}. Move KAS to exchange to realise exit.`
                : `REDUCE signal — take-profit opportunity. Move KAS from your accumulation address to an exchange to realise gains. Agent will hold accumulation until signal clears.`,
              fee:0.01,
            });
          }
          // Reset position tracking after REDUCE (stop or take-profit)
          const _resetState = resetPositionAfterReduce(agent.agentId || "default") as unknown;
          void _resetState;
          setStopLossState(loadStopLossState(agent.agentId || "default"));
        } else if(effectiveAction !== "HOLD"){
          const requested = Number(dec.capital_allocation_kas || 0);
          const calibrationScaledRequested =
            effectiveAction === "ACCUMULATE"
              ? Number((Math.max(0, requested) * calibrationSizeMultiplier).toFixed(6))
              : requested;
          if (effectiveAction === "ACCUMULATE" && calibrationScaledRequested < requested) {
            addLog({
              type:"SYSTEM",
              msg:
                `Calibration guardrail scaled execution from ${requested} to ${calibrationScaledRequested.toFixed(6)} KAS ` +
                `(health ${Number(executionGuardrails?.calibration?.health || 1).toFixed(3)} · ` +
                `tier ${String(executionGuardrails?.calibration?.tier || "healthy").toUpperCase()}).`,
              fee:null
            });
          }
          const sharedCapKas = Number(activePortfolioRow?.cycleCapKas || 0);
          const portfolioCapped =
            effectiveAction === "ACCUMULATE" && sharedCapKas > 0 ? Math.min(calibrationScaledRequested, sharedCapKas) : calibrationScaledRequested;
          const amountKas = effectiveAction === "ACCUMULATE" ? Math.min(portfolioCapped, availableToSpend) : calibrationScaledRequested;
          if (effectiveAction === "ACCUMULATE" && sharedCapKas > 0 && calibrationScaledRequested > portfolioCapped) {
            addLog({
              type:"SYSTEM",
              msg:`Shared portfolio allocator capped ${agent.name} cycle from ${calibrationScaledRequested} to ${portfolioCapped.toFixed(4)} KAS.`,
              fee:null
            });
          }
          if (calibrationScaledRequested > amountKas) {
            addLog({type:"SYSTEM", msg:`Clamped execution amount from ${calibrationScaledRequested} to ${amountKas.toFixed(4)} KAS (available balance guardrail).`, fee:null});
          }
          if (!(amountKas > 0)) {
            addLog({type:"EXEC", msg:"HOLD — computed execution amount is zero", fee:0.03});
            return;
          }
          // PAIR MODE: execute BUY_KAS alongside the regular KAS vault transfer.
          if (pairIntent && pairIntent.direction === "BUY_KAS") {
            addLog({ type:"EXEC", msg: formatPairIntentLog(pairIntent), fee:0.01 });
            if (isPairSwapConfigured() && execMode === "autonomous" && stableBalanceKrc > 0) {
              // Fire-and-forget alongside the KAS transfer below.
              executePairIntent(pairIntent, wallet!.address!).then((result) => {
                addLog({
                  type:"EXEC",
                  msg:`PAIR BUY: ${pairIntent.stableAmount.toFixed(2)} ${pairIntent.stableTick} → KAS · txid: ${result.txId.slice(0,16)}...`,
                  fee:0.01,
                });
                invalidateKrcBalanceCache(wallet!.address!, pairIntent.stableTick);
              }).catch((e: any) => {
                addLog({ type:"EXEC", msg:`Pair BUY failed: ${e?.message || "unknown"}`, fee:null });
              });
            } else {
              addLog({
                type:"SYSTEM",
                msg: stableBalanceKrc <= 0
                  ? `Pair BUY paused — no ${pairIntent.stableTick} balance detected.`
                  : isPairSwapConfigured()
                    ? `Pair BUY ready — set exec mode to AUTONOMOUS for auto-execution.`
                    : `Set VITE_SWAP_DEX_ENDPOINT to auto-execute ${pairIntent.stableTick}→KAS swap.`,
                fee:null,
              });
            }
          }
          // Get agent deposit address for this wallet session
          const agentDepositAddr = getAgentDepositAddress(wallet?.address);
          const baseTxItem = buildQueueTxItem({
            id:uid(),
            type:dec.action,
            metaKind: "action",
            from:wallet?.address,
            to:agentDepositAddr || ACCUMULATION_VAULT,
            amount_kas:Number(amountKas.toFixed(6)),
            purpose:dec.rationale.slice(0,60),
            status:"pending",
            ts:Date.now(),
            dec,
            agentDepositAddress: agentDepositAddr,
          });
          const txItem = attachCombinedTreasuryOutput(baseTxItem);
          if (txItem?.treasuryCombined) {
            addLog({
              type:"TREASURY",
              msg:`Using combined treasury routing in primary transaction (${String(wallet?.provider || "wallet")}) · treasury ${Number(txItem?.treasuryCombinedFeeKas || TREASURY_FEE_KAS).toFixed(6)} KAS`,
              fee:null,
            });
          }
          // All decision sources (ai, hybrid-ai, quant-core, fallback) are eligible for
          // auto-approve — the calibration guardrail, risk gate, and confidence gate are
          // the real safety net. Blocking on source alone was over-conservative.
          // During a DAG activity surge the effective threshold is lifted 1.5× so the bot
          // can execute larger accumulation tranches when on-chain demand is elevated.
          const surgeBoost = dagSignals.activitySurge && effectiveAction === "ACCUMULATE" ? 1.5 : 1.0;
          const effectiveAutoThresh = adaptiveAutoThreshold.thresholdKas * surgeBoost;
          if (adaptiveAutoThreshold.samplesSufficient && Math.abs(adaptiveAutoThreshold.multiplier - 1) >= 0.08) {
            const adaptiveReasonKey =
              `${adaptiveAutoThreshold.tier}|${adaptiveAutoThreshold.reason}|${adaptiveAutoThreshold.thresholdKas.toFixed(4)}`;
            if (lastAdaptiveThresholdReasonRef.current !== adaptiveReasonKey) {
              addLog({
                type: "SYSTEM",
                msg:
                  `Adaptive auto-threshold ${adaptiveAutoThreshold.tier.toUpperCase()} ` +
                  `(${adaptiveAutoThreshold.rolling.wins}/${adaptiveAutoThreshold.rolling.samples} wins) ` +
                  `→ ${adaptiveAutoThreshold.thresholdKas.toFixed(4)} KAS base ` +
                  `(${adaptiveAutoThreshold.reason}).`,
                fee: null,
              });
              lastAdaptiveThresholdReasonRef.current = adaptiveReasonKey;
            }
          }
          const autoApproveCandidate =
            execMode === "autonomous" &&
            txItem.amount_kas <= effectiveAutoThresh;
          const isAutoApprove = autoApproveCandidate && !autoApproveGuardrailDisabled;
          if (autoApproveCandidate && !isAutoApprove) {
            addLog({
              type:"SIGN",
              msg:`Auto-approve blocked by guardrail (${autoApproveGuardrailReasons.join(",") || "policy"}). Action routed to manual queue.`,
              fee:null
            });
          }
          if(isAutoApprove){
            try {
              const txid = await sendWalletTransfer(txItem);
              const isPaperTx = txid.startsWith("paper_");

              // Track simulated P&L for paper mode
              if (isPaperTx) {
                const sign = effectiveAction === "REDUCE" ? -1 : 1;
                setPaperPnlKas((prev) => prev + sign * (txItem.amount_kas ?? 0));
              }
              // Track entry price for stop-loss after real ACCUMULATE fill
              if (!isPaperTx && effectiveAction === "ACCUMULATE" && currentPrice > 0) {
                const newSlState = recordAccumulateFill(
                  agent.agentId || "default",
                  txItem.amount_kas ?? 0,
                  currentPrice,
                );
                setStopLossState(newSlState);
              }
              // Record trade for Claude outcome feedback loop
              if (!isPaperTx) {
                recordTradeBroadcast({
                  agentId: agent.agentId || "default",
                  txId: txid,
                  action: effectiveAction,
                  decisionSource: decSource,
                  entryPriceUsd: currentPrice,
                  amountKas: txItem.amount_kas ?? 0,
                  regime: quantRegime,
                  confidenceScore: Number(dec.confidence_score || 0),
                });
              }

              addLog({
                type:"EXEC",
                msg: isPaperTx
                  ? `PAPER: ${dec.action} · ${txItem.amount_kas} KAS · simulated`
                  : `AUTO-APPROVED: ${dec.action} · ${txItem.amount_kas} KAS · txid: ${txid.slice(0,16)}...`,
                fee:0.08,
                truthLabel: isPaperTx ? "PAPER" : "BROADCASTED",
                receiptProvenance: isPaperTx ? "PAPER" : "ESTIMATED",
              });
              if (!isPaperTx) addLog({type:"TREASURY", msg:`Fee split → Pool: ${(FEE_RATE*AGENT_SPLIT).toFixed(4)} KAS / Treasury: ${(FEE_RATE*TREASURY_SPLIT).toFixed(4)} KAS`, fee:FEE_RATE});
              const signedItem = prependSignedBroadcastedQueueItem(txItem, txid);
              if (!isPaperTx) await settleTreasuryFeePayout(signedItem, "auto");
            } catch (e: any) {
              prependQueueItem(txItem);
              addLog({type:"SIGN", msg:`Auto-approve fallback to manual queue: ${e?.message || "wallet broadcast failed"}`, fee:null});
            }
          } else {
            addLog({type:"SIGN", msg:`Action queued for wallet signature: ${dec.action} · ${txItem.amount_kas} KAS`, fee:null});
            prependQueueItem(txItem);
          }
        } else {
          addLog({type:"EXEC", msg:"HOLD — no action taken", fee:0.08});
        }
      }
      // ── LIMIT ORDER CHECK ─────────────────────────────────────────────────
      if (currentPrice > 0) {
        checkAndTriggerOrders(currentPrice, (order) => {
          addLog({
            type: "EXEC",
            msg: `LIMIT ORDER TRIGGERED · ${order.type} ${order.kasAmount.toFixed(4)} KAS @ $${order.triggerPrice.toFixed(4)} (current $${currentPrice.toFixed(4)})`,
            fee: null,
          });
          // Wire to execution queue: create a queue item so user can approve or it
          // auto-executes if conditions match (autonomous mode + under auto-approve thresh).
          const _execReady = liveConnected && !kasDataError && liveExecutionArmed && wallet?.address && wallet?.provider !== "demo";
          if (_execReady) {
            const loTxItem = buildQueueTxItem({
              id: `lo_${crypto.randomUUID()}`,
              type: order.type === "BUY" ? "ACCUMULATE" : "REDUCE",
              metaKind: "action",
              from: wallet!.address,
              to: getAgentDepositAddress(wallet!.address) || ACCUMULATION_VAULT,
              amount_kas: order.kasAmount,
              purpose: `Limit order ${order.type} @ $${order.triggerPrice.toFixed(4)}`,
              status: "pending",
              ts: Date.now(),
              dec: { action: order.type === "BUY" ? "ACCUMULATE" : "REDUCE", rationale: `Limit order triggered at $${currentPrice.toFixed(4)}` },
            });
            prependQueueItem(loTxItem);
            markOrderExecuted(order.id);
            addLog({ type: "SIGN", msg: `Limit order queued for wallet: ${order.kasAmount.toFixed(4)} KAS`, fee: null });
          } else {
            addLog({ type: "SYSTEM", msg: `Limit order ready — connect wallet + arm live execution to auto-queue.`, fee: null });
          }
        });

        // ── DCA CHECK ─────────────────────────────────────────────────────
        checkDcaSchedules((schedule) => {
          addLog({
            type: "EXEC",
            msg: `DCA · Buying ${schedule.kasAmount.toFixed(4)} KAS · "${schedule.note || schedule.frequency}" · run #${schedule.executionCount + 1}`,
            fee: null,
          });
          // Wire DCA to execution queue (same path as ACCUMULATE signal)
          if (liveConnected && !kasDataError && liveExecutionArmed && wallet?.address && wallet?.provider !== "demo") {
            const dcaTxItem = buildQueueTxItem({
              id: `dca_${crypto.randomUUID()}`,
              type: "ACCUMULATE",
              metaKind: "action",
              from: wallet.address,
              to: getAgentDepositAddress(wallet.address) || ACCUMULATION_VAULT,
              amount_kas: schedule.kasAmount,
              purpose: `DCA ${schedule.frequency} · run #${schedule.executionCount + 1}`,
              status: "pending",
              ts: Date.now(),
              dec: { action: "ACCUMULATE", rationale: `DCA schedule: ${schedule.note || schedule.frequency}` },
            });
            prependQueueItem(dcaTxItem);
            markDcaExecuted(schedule.id);
            addLog({ type: "SIGN", msg: `DCA queued: ${schedule.kasAmount.toFixed(4)} KAS`, fee: null });
          } else {
            markDcaExecuted(schedule.id); // advance schedule even without execution to prevent re-fire
            addLog({ type: "SYSTEM", msg: `DCA schedule advanced — connect wallet to auto-execute.`, fee: null });
          }
        });
      }

      _cycleOk = true;
    }catch(e: any){
      const fx = normalizeError(e, { domain: "system" });
      addLog({type:"ERROR", msg:formatForgeError(fx), fee:null});
      if (fx.domain === "tx" && fx.code === "TX_BROADCAST_FAILED") {
        transitionAgentStatus({ type: "FAIL", reason: fx.message });
      }
      // EXECUTION BACKOFF (item 4): exponential delay after consecutive failures (2s, 4s, 8s … 30s cap).
      consecutiveExecutionFailuresRef.current += 1;
      const backoffMs = Math.min(30_000, 2_000 * Math.pow(2, consecutiveExecutionFailuresRef.current - 1));
      executionBackoffUntilRef.current = Date.now() + backoffMs;
      if (consecutiveExecutionFailuresRef.current >= 2) {
        addLog({
          type: "SYSTEM",
          msg: `Execution backoff: ${consecutiveExecutionFailuresRef.current} consecutive failures — pausing ${Math.round(backoffMs / 1000)}s before next cycle.`,
          fee: null,
        });
      }
    }
    finally {
      if (_cycleOk) consecutiveExecutionFailuresRef.current = 0;
      setLoading(false);
      cycleLockRef.current = false;
      priceTriggerResetRef.current();   // re-anchor price baseline after each cycle
    }
  }, [
    MAX_DECISION_ENTRIES,
    activePortfolioRow,
    addLog,
    agent,
    adaptiveAutoThreshold,
    cycleIntervalMs,
    execMode,
    kasData,
    liveExecutionArmed,
    liveConnected,
    marketHistory,
    kasDataError,
    prependQueueItem,
    prependSignedBroadcastedQueueItem,
    riskThresh,
    runtimeHydrated,
    sendWalletTransfer,
    settleTreasuryFeePayout,
    sendAlertEvent,
    status,
    transitionAgentStatus,
    usageScope,
    wallet,
  ]);

  useAutoCycleLoop({
    status,
    runtimeHydrated,
    loading,
    liveConnected,
    kasDataError,
    nextAutoCycleAt,
    cycleIntervalMs,
    cycleLockRef,
    setNextAutoCycleAt,
    runCycle,
  });

  const lastStreamKickRef = useRef(0);
  const lastStreamKickLogRef = useRef(0);
  useEffect(() => {
    if (!streamPulse || status !== "RUNNING" || !runtimeHydrated || !liveExecutionArmed) return;
    const event = lastStreamEvent;
    if (!event || event.kind === "unknown") return;
    const now = Date.now();
    const minKickIntervalMs = event.kind === "utxo" ? 1_500 : 2_500;
    if (now - lastStreamKickRef.current < minKickIntervalMs) return;
    lastStreamKickRef.current = now;
    setNextAutoCycleAt((prev: any) => Math.min(Number(prev || now), now - 1));
    if (now - lastStreamKickLogRef.current >= 15_000) {
      const msg = event.kind === "daa"
        ? `DAA push detected (${event.daaScore || "n/a"}) — accelerating quant cycle.`
        : `UTXO push detected${event.affectsWallet ? " for active wallet" : ""} — accelerating quant cycle.`;
      addLog({ type: "DATA", msg, fee: null });
      lastStreamKickLogRef.current = now;
    }
  }, [
    addLog,
    lastStreamEvent,
    liveExecutionArmed,
    runtimeHydrated,
    status,
    streamPulse,
  ]);

  useEffect(() => {
    const latestRegime = String(decisions[0]?.dec?.quant_metrics?.regime || "");
    if (!latestRegime) return;
    if (!lastRegimeRef.current) {
      lastRegimeRef.current = latestRegime;
      return;
    }
    if (lastRegimeRef.current === latestRegime) return;
    const previousRegime = lastRegimeRef.current;
    lastRegimeRef.current = latestRegime;
    void sendAlertEvent({
      type: "regime_shift",
      key: `regime_shift:${String(agent?.agentId || agent?.name || "agent")}:${previousRegime}->${latestRegime}`,
      title: `${agent?.name || "Agent"} regime shift`,
      message: `Regime changed from ${previousRegime} to ${latestRegime}.`,
      severity: latestRegime === "RISK_OFF" ? "warn" : "info",
      meta: { previous_regime: previousRegime, regime: latestRegime },
    });
  }, [agent?.agentId, agent?.name, decisions, sendAlertEvent]);

  const handleSigned = useCallback(async (tx: any) => {
    const currentSigningItem = signingItem ? { ...signingItem } : null;
    await handleSignedBase(tx);
    if (!currentSigningItem || currentSigningItem?.metaKind === "treasury_fee") return;
    const signedQueueItem = { ...currentSigningItem, status: "signed", txid: tx?.txid };
    await settleTreasuryFeePayout(signedQueueItem, "post-sign");
  }, [handleSignedBase, settleTreasuryFeePayout, signingItem]);

  /** Download the full agent config as a JSON backup file. */
  const exportAgentConfig = () => {
    try {
      const exportPayload = {
        exportedAt: new Date().toISOString(),
        forgeosVersion: "1",
        agent: {
          ...agent,
          _runtimeSnapshot: {
            execMode,
            liveExecutionArmed,
            status,
            totalDecisions: decisions.length,
            totalQueueEntries: queue.length,
          },
        },
      };
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `forgeos-agent-${String(agent?.name || "config").replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addLog({ type: "SYSTEM", msg: `Agent config exported to JSON backup.`, fee: null });
    } catch {
      addLog({ type: "ERROR", msg: "Export failed — could not create download.", fee: null });
    }
  };

  const killSwitch = () => {
    transitionAgentStatus({ type: "KILL" });
    addLog({type:"SYSTEM", msg:"KILL-SWITCH activated — agent suspended. All pending actions cancelled.", fee:null});
    void sendAlertEvent({
      type: "risk_event",
      key: `kill_switch:${String(agent?.agentId || agent?.name || "agent")}`,
      title: `${agent?.name || "Agent"} kill-switch activated`,
      message: "Agent suspended and pending queue rejected.",
      severity: "danger",
      meta: { pending_rejected: queue.filter((q: any) => q.status === "pending").length },
    });
    rejectAllPending();
  };
  const totalFees = parseFloat(log.filter((l: any)=>l.fee).reduce((s: number, l: any)=>s+(l.fee||0),0).toFixed(4));
  const liveKasNum = Number(kasData?.walletKas || 0);
  const walletSupportsCombinedTreasuryUi =
    TREASURY_FEE_ONCHAIN_ENABLED &&
    wallet?.provider !== "demo" &&
    TREASURY_FEE_KAS > 0 &&
    WalletAdapter.supportsNativeMultiOutput(String(wallet?.provider || ""));
  const treasuryPayoutReserveKasUi =
    TREASURY_FEE_ONCHAIN_ENABLED && wallet?.provider !== "demo" && TREASURY_FEE_KAS > 0
      ? (walletSupportsCombinedTreasuryUi ? TREASURY_FEE_KAS : (TREASURY_FEE_KAS + NET_FEE))
      : 0;
  const uiSummary = useDashboardUiSummary({
    viewportWidth,
    nextAutoCycleAt,
    status,
    totalFees,
    queue,
    decisions,
    liveConnected,
    kasDataError,
    wallet,
    kasData,
    reserveKas: RESERVE,
    netFeeKas: NET_FEE,
    treasuryReserveKas: treasuryPayoutReserveKasUi,
    wsUrl: KAS_WS_URL,
    streamConnected,
    streamRetryCount,
  });
  const {
    isMobile,
    isTablet,
    summaryGridCols,
    splitGridCols,
    controlsGridCols,
    pendingCount: pendingCountUi,
    spendableKas,
    liveExecutionReady,
    autoCycleCountdownLabel,
    lastDecision,
    lastDecisionSource,
    streamBadgeText,
    streamBadgeColor,
  } = uiSummary;
  const isNarrowPhone = isMobile && viewportWidth < 430;
  const TABS = [
    {k:"overview",l:"OVERVIEW"},
    {k:"portfolio",l:"PORTFOLIO"},
    {k:"wallet",l:"WALLET"},
    {k:"swap",l:"SWAP"},
    {k:"intelligence",l:"INTELLIGENCE"},
    {k:"analytics",l:"ANALYTICS"},
    {k:"controls",l:"CONTROLS"},
    {k:"backtest",l:"BACKTEST"},
    {k:"leaderboard",l:"LEADERBOARD"},
    {k:"attribution",l:"ATTRIBUTION"},
    {k:"alerts",l:"ALERTS"},
    {k:"queue",l:`QUEUE${pendingCount>0?` (${pendingCount})`:""}`},
    {k:"log",l:"LOG"},
    {k:"network",l:"NETWORK"},
  ];
  const rpcFailoverMode = KAS_API_FALLBACKS.length > 0 ? "MULTI-ENDPOINT" : "PRIMARY ONLY";
  const streamHeartbeatAgeMs = streamPulse > 0 ? Math.max(0, Date.now() - streamPulse) : null;
  const streamHeartbeatLabel =
    streamHeartbeatAgeMs == null
      ? "NO EVENTS"
      : streamHeartbeatAgeMs < 1000
        ? `${streamHeartbeatAgeMs} ms`
        : `${(streamHeartbeatAgeMs / 1000).toFixed(1)} s`;
  const lastStreamKindLabel = lastStreamEvent?.kind ? String(lastStreamEvent.kind).toUpperCase() : "NONE";
  const wsKickMinIntervalMs = lastStreamEvent?.kind === "utxo" ? 1500 : 2500;
  const nodeSyncState = kasData?.nodeStatus?.isSynced;
  const nodeIndexState = kasData?.nodeStatus?.isUtxoIndexed;
  const nodeHealthText =
    nodeSyncState === true && nodeIndexState === true
      ? "NODE READY"
      : nodeSyncState === false
        ? "NODE SYNCING"
        : nodeIndexState === false
          ? "NODE INDEXING"
          : "NODE UNKNOWN";
  const nodeHealthColor =
    nodeSyncState === true && nodeIndexState === true
      ? C.ok
      : nodeSyncState === false || nodeIndexState === false
        ? C.warn
        : C.dim;
  const expectedNetworkId = String(DEFAULT_NETWORK || "").toLowerCase();
  const walletNetworkId = String(wallet?.network || "").toLowerCase();
  const walletNetworkMismatch = !!walletNetworkId && walletNetworkId !== expectedNetworkId;

  // Track previous pending count to detect state changes
  const lastPendingCountRef = useRef(0);
  
  useEffect(() => {
    const threshold = alertConfig?.queuePendingThreshold || 3;
    const prevCount = lastPendingCountRef.current;
    const currentCount = pendingCount;
    
    // Only alert when:
    // 1. pendingCount exceeds threshold AND
    // 2. Either it's a new threshold breach (count went from below to above threshold)
    //    OR count increased significantly since last alert
    const wasBelowThreshold = prevCount < threshold;
    const isAboveThreshold = currentCount >= threshold;
    const increasedSignificantly = currentCount > prevCount && (currentCount - prevCount) >= Math.max(1, Math.floor(threshold / 2));
    
    // Update the ref
    lastPendingCountRef.current = currentCount;
    
    // Don't alert if below threshold or count decreased
    if (!isAboveThreshold || currentCount <= prevCount) return;
    
    // Only alert on significant state changes
    if (wasBelowThreshold || increasedSignificantly) {
      void sendAlertEvent({
        type: "queue_pending",
        key: `queue_pending_count:${String(agent?.agentId || agent?.name || "agent")}:${String(threshold)}`,
        title: `${agent?.name || "Agent"} queue backlog alert`,
        message: `${currentCount} transaction${currentCount > 1 ? "s" : ""} awaiting wallet approval (threshold: ${threshold}).`,
        severity: currentCount >= threshold * 2 ? "danger" : currentCount >= threshold ? "warn" : "info",
        meta: { 
          pending_count: currentCount,
          threshold: threshold,
          prev_count: prevCount,
        },
      });
    }
  }, [agent?.agentId, agent?.name, pendingCount, alertConfig?.queuePendingThreshold, sendAlertEvent]);

  // Low balance alert
  const lastBalanceAlertRef = useRef(0);
  
  useEffect(() => {
    const threshold = alertConfig?.lowBalanceThreshold || 100;
    const currentBalance = Number(kasData?.walletKas || 0);
    const now = Date.now();
    
    // Only alert if balance is below threshold
    if (currentBalance >= threshold || currentBalance <= 0) return;
    
    // Don't alert too frequently (at most once per hour for low balance)
    if (now - lastBalanceAlertRef.current < 3600000) return;
    
    lastBalanceAlertRef.current = now;
    
    void sendAlertEvent({
      type: "low_balance",
      key: `low_balance:${String(agent?.agentId || agent?.name || "agent")}:${String(threshold)}`,
      title: `${agent?.name || "Agent"} low balance warning`,
      message: `Wallet balance ${currentBalance.toFixed(2)} KAS is below threshold ${threshold} KAS.`,
      severity: currentBalance < threshold * 0.5 ? "danger" : "warn",
      meta: { 
        balance_kas: currentBalance,
        threshold_kas: threshold,
      },
    });
  }, [agent?.agentId, agent?.name, kasData?.walletKas, alertConfig?.lowBalanceThreshold, sendAlertEvent]);

  // Track tx failures and confirmation timeouts
  const lastTxFailureAlertRef = useRef<Record<string, number>>({});
  
  useEffect(() => {
    if (!queue || !Array.isArray(queue)) return;
    
    const now = Date.now();
    const alertCooldownMs = 300000; // 5 minutes between alerts for same tx
    
    for (const item of queue) {
      if (!item?.txid) continue;
      
      const txid = String(item.txid);
      const failureReason = item?.failure_reason;
      const receiptLifecycle = item?.receipt_lifecycle;
      
      // Check for confirmation timeout
      if (receiptLifecycle === "timeout" && failureReason === "confirmation_timeout") {
        const lastAlert = lastTxFailureAlertRef.current[`${txid}:timeout`] || 0;
        if (now - lastAlert < alertCooldownMs) continue;
        
        lastTxFailureAlertRef.current[`${txid}:timeout`] = now;
        
        void sendAlertEvent({
          type: "confirmation_timeout",
          key: `confirmation_timeout:${String(agent?.agentId || agent?.name || "agent")}:${txid}`,
          title: `${agent?.name || "Agent"} transaction confirmation timeout`,
          message: `Transaction ${txid.slice(0, 16)}... failed to confirm within expected time (${item?.receipt_attempts || 0} attempts).`,
          severity: "warn",
          meta: { 
            txid: txid,
            attempts: item?.receipt_attempts || 0,
            amount_kas: item?.amount_kas,
          },
        });
      }
      
      // Check for chain rejection
      if (receiptLifecycle === "failed" && (failureReason === "chain_rejected" || failureReason === "backend_receipt_failed")) {
        const lastAlert = lastTxFailureAlertRef.current[`${txid}:failed`] || 0;
        if (now - lastAlert < alertCooldownMs) continue;
        
        lastTxFailureAlertRef.current[`${txid}:failed`] = now;
        
        void sendAlertEvent({
          type: "tx_failure",
          key: `tx_failure:${String(agent?.agentId || agent?.name || "agent")}:${txid}`,
          title: `${agent?.name || "Agent"} transaction failed`,
          message: `Transaction ${txid.slice(0, 16)}... was rejected (reason: ${failureReason || "unknown"}).`,
          severity: "danger",
          meta: { 
            txid: txid,
            failure_reason: failureReason,
            amount_kas: item?.amount_kas,
            metaKind: item?.metaKind,
          },
        });
      }
    }
  }, [agent?.agentId, agent?.name, queue, sendAlertEvent]);

  // Network disconnect alert
  const lastNetworkAlertRef = useRef(0);
  
  useEffect(() => {
    // Alert when network goes from connected to disconnected
    const wasConnected = lastNetworkAlertRef.current > 0;
    const isDisconnected = !liveConnected;
    
    if (wasConnected && isDisconnected) {
      const now = Date.now();
      // Only alert once per disconnect event
      if (now - lastNetworkAlertRef.current < 60000) return;
      
      lastNetworkAlertRef.current = now;
      
      void sendAlertEvent({
        type: "system",
        key: `network_disconnect:${String(agent?.agentId || agent?.name || "agent")}`,
        title: `${agent?.name || "Agent"} network disconnected`,
        message: `Kaspa DAG feed disconnected. Live execution may be affected.`,
        severity: "warn",
        meta: { 
          network: DEFAULT_NETWORK,
          wasConnected: true,
        },
      });
    } else if (liveConnected) {
      // Reset when connected again
      lastNetworkAlertRef.current = 1;
    }
  }, [agent?.agentId, agent?.name, liveConnected, sendAlertEvent]);

  return(
    <div style={{maxWidth:1460, margin:"0 auto", padding:isMobile ? "14px 14px 22px" : "22px 24px 34px"}}>
      {signingItem && <SigningModal tx={signingItem} wallet={wallet} onSign={handleSigned} onReject={handleSigningReject}/>}

      {/* Header */}
      <div style={{display:"flex", flexDirection:isMobile ? "column" : "row", justifyContent:"space-between", alignItems:isMobile ? "stretch" : "flex-start", marginBottom:16, gap:isMobile ? 10 : 0}}>
        <div>
          <div style={{fontSize:11, color:C.dim, letterSpacing:"0.1em", ...mono, marginBottom:2}}>Forge-OS / AGENT / {agent.name}</div>
          <div style={{fontSize:18, color:C.text, fontWeight:700, ...mono}}>{agent.name}</div>
        </div>
        <div style={{display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", justifyContent:isMobile ? "flex-start" : "flex-end"}}>
          {/* Status: show only when not default-paused */}
          {(status && status !== "PAUSED") && <Badge text={status} color={status==="RUNNING"?C.ok:status==="PAUSED"?C.warn:C.dim} dot/>}
          {/* AUTONOMOUS — only when autonomous mode is active (hide when manual/notify) */}
          {execMode === "autonomous" && <Badge text="AUTONOMOUS" color={C.accent}/>}
          {/* Show non-autonomous exec modes more subtly */}
          {execMode && execMode !== "autonomous" && <Badge text={execMode.toUpperCase()} color={C.dim}/>}
          {/* Strategy label */}
          {activeStrategyLabel && activeStrategyLabel !== "Custom" && <Badge text={String(activeStrategyLabel).toUpperCase()} color={C.text}/>}
          {/* LIVE EXEC ON — only when armed */}
          {liveExecutionArmed === true && <Badge text="LIVE EXEC ON" color={C.ok} dot/>}
          {/* ACCUMULATE-ONLY — per-agent mode or global env fallback */}
          {(String(agent?.actionMode || "").toLowerCase() === "accumulate_only" || (String(agent?.actionMode || "") === "" && ACCUMULATE_ONLY)) && <Badge text="ACCUMULATE-ONLY" color={C.ok}/>}
          {/* PAPER TRADING — simulation mode, no real txs */}
          {execMode === "paper" && <Badge text="PAPER TRADING" color={C.warn} dot/>}
          {/* Wallet provider (e.g. KASWARE) — always show when connected */}
          {wallet?.provider && <Badge text={wallet?.provider?.toUpperCase()} color={C.purple} dot/>}
          {/* ENGINE WORKER — only when quant engine is in worker mode */}
          {quantClientMode === "worker" && <Badge text="ENGINE WORKER" color={C.ok}/>}
          {adaptiveAutoThreshold.samplesSufficient && (
            <Badge
              text={`AUTO THR ${adaptiveAutoThreshold.thresholdKas.toFixed(2)}K`}
              color={
                adaptiveAutoThreshold.tier === "boosted"
                  ? C.ok
                  : adaptiveAutoThreshold.tier === "restricted"
                    ? C.danger
                    : adaptiveAutoThreshold.tier === "tightened"
                      ? C.warn
                      : C.dim
              }
            />
          )}
          {/* Auto cycle countdown */}
          {autoCycleCountdownLabel && <Badge text={`AUTO ${autoCycleCountdownLabel}`} color={status==="RUNNING"?C.text:C.dim}/>}
          {/* Live feed badges */}
          {liveConnected && <Badge text="DAG LIVE" color={C.ok} dot/>}
          <Badge text={nodeHealthText} color={nodeHealthColor} dot={nodeSyncState === true && nodeIndexState === true}/>
          {streamConnected && streamBadgeText && <Badge text={streamBadgeText} color={streamBadgeColor} dot/>}
          {lastStreamEvent?.kind === "daa" && <Badge text="WS DAA PUSH" color={C.ok} dot/>}
          {lastStreamEvent?.kind === "utxo" && lastStreamEvent?.affectsWallet && <Badge text="WS UTXO PUSH" color={C.warn} dot/>}
        </div>
      </div>

<DashboardRuntimeNotices kasDataError={kasDataError} refreshKasData={refreshKasData} kasDataLoading={kasDataLoading} liveExecutionArmed={liveExecutionArmed} liveExecutionReady={liveExecutionReady} executionGuardrails={executionGuardrails} pendingCount={pendingCount} isMobile={isMobile} setTab={setTab} />

      {/* Tabs */}
      <div style={{display:"flex", borderBottom:`1px solid ${C.border}`, marginBottom:18, overflowX:"auto"}}>
        {TABS.map(t=> (
          <button
            key={t.k}
            data-testid={`dashboard-tab-${t.k}`}
            onClick={()=>setTab(t.k)}
            className={`forge-tab-btn${tab===t.k?" active":""}`}
            style={{color:tab===t.k?C.accent:C.dim, padding:"8px 14px", fontSize:11, letterSpacing:"0.08em", ...mono}}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab==="overview" && (
        <Suspense fallback={<PanelSkeleton label="Overview" lines={8}/>}>
          <OverviewPanel
            kasData={kasData}
            agent={agent}
            decisions={decisions}
            queue={queue}
            loading={loading}
            status={status}
            spendableKas={spendableKas}
            totalFees={totalFees}
            pendingCount={pendingCount}
            paperPnlKas={paperPnlKas}
            execMode={execMode}
            liveConnected={liveConnected}
            liveExecutionArmed={liveExecutionArmed}
            onToggleAutoTrade={() => setLiveExecutionArmed((v: boolean) => !v)}
            onRunCycle={runCycle}
            onPauseResume={() => transitionAgentStatus({ type: status === "RUNNING" ? "PAUSE" : "RESUME" })}
            onExport={exportAgentConfig}
            onKillSwitch={killSwitch}
            onNavigate={setTab}
            lastDecision={lastDecision}
            lastDecisionSource={lastDecisionSource}
            pnlAttribution={pnlAttribution}
            executionGuardrails={executionGuardrails}
            adaptiveAutoThreshold={adaptiveAutoThreshold}
            stopLossState={stopLossState}
            activePortfolioRow={activePortfolioRow}
            activeStrategyLabel={activeStrategyLabel}
            isMobile={isMobile}
            isNarrowPhone={isNarrowPhone}
            isTablet={isTablet}
            summaryGridCols={summaryGridCols}
            splitGridCols={splitGridCols}
          />
        </Suspense>
      )}

      {tab==="portfolio" && (
        <Suspense fallback={<PanelSkeleton label="Portfolio" lines={5}/>}>
          <PortfolioPanel
            agents={allAgents}
            activeAgentId={activeAgentId || agent?.agentId}
            walletKas={kasData?.walletKas || 0}
            kasPriceUsd={kasData?.priceUsd || 0}
            lastDecision={decisions[0] || null}
            summary={portfolioSummary}
            config={portfolioConfig}
            onConfigPatch={patchPortfolioConfig}
            onAgentOverridePatch={patchPortfolioAgentOverride}
            onSelectAgent={onSelectAgent}
            onRefresh={refreshPortfolioPeers}
            onDeleteAgent={onDeleteAgent}
            onEditAgent={onEditAgent}
          />
        </Suspense>
      )}

      {tab==="intelligence" && (
        <Suspense fallback={<PanelSkeleton label="Intelligence" lines={4}/>}>
          <IntelligencePanel decisions={decisions} queue={queue} loading={loading} onRun={runCycle}/>
        </Suspense>
      )}
      
      {tab==="analytics" && (
        <Suspense fallback={<PanelSkeleton label="Analytics" lines={4}/>}>
          <QuantAnalyticsPanel decisions={decisions} queue={queue} />
        </Suspense>
      )}

      {tab==="backtest" && (
        <Suspense fallback={<PanelSkeleton label="Backtest" lines={5}/>}>
          <BacktestPanel marketHistory={marketHistory} agent={agent} />
        </Suspense>
      )}

      {tab==="leaderboard" && (
        <Suspense fallback={<PanelSkeleton label="Leaderboard" lines={4}/>}>
          <LeaderboardPanel
            onUseConfig={(cfg) => {
              if (agent?.agentId && onPatchAgent) {
                onPatchAgent(agent.agentId, {
                  strategy:   cfg.strategy   || agent.strategy,
                  risk:       cfg.risk       || agent.risk,
                  actionMode: cfg.actionMode || agent.actionMode,
                });
              }
            }}
          />
        </Suspense>
      )}


      {tab==="attribution" && (
        <Suspense fallback={<PanelSkeleton label="Attribution" lines={4}/>}>
          <PnlAttributionPanel summary={pnlAttribution} />
        </Suspense>
      )}
      {tab==="alerts" && (
        <Suspense fallback={<PanelSkeleton label="Alerts" lines={3}/>}>
          <AlertsPanel
            config={alertConfig}
            onPatch={patchAlertConfig}
            onToggleType={toggleAlertType}
            onSave={saveAlertConfig}
            onTest={sendTestAlert}
            saving={alertSaveBusy}
            lastResult={lastAlertResult}
          />
        </Suspense>
      )}
      {tab==="queue" && (
        <ActionQueue
          queue={queue}
          wallet={wallet}
          onSign={handleQueueSign}
          onReject={handleQueueReject}
          receiptConsistencyMetrics={receiptConsistencyMetrics}
        />
      )}
      {tab==="wallet" && <WalletPanel agent={agent} wallet={wallet} kasData={kasData} marketHistory={marketHistory} lastDecision={decisions[0] || null}/>}
      {tab==="swap" && (
        <div style={{ padding: "clamp(12px, 2vw, 22px) 0 0" }}>
          <SwapView />
        </div>
      )}

      {/* ── LOG ── */}
      {tab==="log" && (
        <Card p={0}>
          <div style={{padding:"12px 18px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <span style={{fontSize:11, color:C.dim, ...mono}}>{log.length} entries · {totalFees} KAS fees</span>
            <Btn onClick={runCycle} disabled={loading||status!=="RUNNING"} size="sm">{loading?"...":"RUN CYCLE"}</Btn>
          </div>
          <div style={{maxHeight:520, overflowY:"auto"}}>
            {log.map((e: any, i: number)=>(
              <div key={i} style={{display:"grid", gridTemplateColumns:isMobile ? "74px 58px 1fr" : "92px 72px 1fr 80px", gap:10, padding:"8px 18px", borderBottom:`1px solid ${C.border}`, alignItems:"center"}}>
                <span style={{fontSize:11, color:C.dim, ...mono}}>{fmtT(e.ts)}</span>
                <span style={{fontSize:11, color:LOG_COL[e.type]||C.dim, fontWeight:700, ...mono}}>{e.type}</span>
                <div style={{display:"flex", flexDirection:"column", gap:5}}>
                  <div style={{fontSize:12, color:C.text, ...mono, lineHeight:1.4}}>{e.msg}</div>
                  {(e?.truthLabel || e?.receiptProvenance) && (
                    <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
                      {e?.truthLabel && (
                        <Badge
                          text={String(e.truthLabel)}
                          color={
                            String(e.truthLabel).includes("CHAIN CONFIRMED")
                              ? C.ok
                              : String(e.truthLabel).includes("BACKEND CONFIRMED")
                                ? C.purple
                                : String(e.truthLabel).includes("BROADCASTED")
                                  ? C.warn
                                  : C.dim
                          }
                        />
                      )}
                      {e?.receiptProvenance && (
                        <Badge
                          text={String(e.receiptProvenance)}
                          color={
                            String(e.receiptProvenance).toUpperCase() === "CHAIN"
                              ? C.ok
                              : String(e.receiptProvenance).toUpperCase() === "BACKEND"
                                ? C.purple
                                : C.warn
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
                {!isMobile && <span style={{fontSize:11, color:C.dim, textAlign:"right", ...mono}}>{e.fee!=null?`${e.fee} KAS`:"—"}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── NETWORK ── */}
      {tab==="network" && (
        <Suspense fallback={<PanelSkeleton label="Network" lines={6}/>}>
          <NetworkPanel
            kasData={kasData}
            liveConnected={liveConnected}
            streamConnected={streamConnected}
            streamRetryCount={streamRetryCount}
            streamHeartbeatLabel={streamHeartbeatLabel}
            lastStreamKindLabel={lastStreamKindLabel}
            kasDataLoading={kasDataLoading}
            kasDataError={kasDataError}
            refreshKasData={refreshKasData}
            alertConfig={alertConfig}
            patchAlertConfig={patchAlertConfig}
            saveAlertConfig={saveAlertConfig}
            alertSaveBusy={alertSaveBusy}
            isTablet={isTablet}
            walletNetworkMismatch={walletNetworkMismatch}
          />
        </Suspense>
      )}

      {/* ── CONTROLS ── */}
      {tab==="controls" && (
        <div style={{display:"grid", gridTemplateColumns:controlsGridCols, gap:14}}>
          {/* Strategy Management Card */}
          <Card p={20} style={{gridColumn: "1 / -1"}}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16}}>
              <Label>Strategy Configuration</Label>
              <Btn onClick={()=>setEditingStrategy(!editingStrategy)} variant={editingStrategy ? "warn" : "primary"} size="sm">
                {editingStrategy ? "Cancel" : "Edit Strategy"}
              </Btn>
            </div>
            
            {/* Current Strategy Display */}
            {!editingStrategy && (
              <div>
                <div style={{display:"flex", gap:8, flexWrap:"wrap", marginBottom:16}}>
                  <Badge text={agent?.strategyLabel || "Custom"} color={C.accent}/>
                  <Badge text={agent?.strategyClass?.toUpperCase() || "CUSTOM"} color={C.text}/>
                  <Badge text={`RISK: ${agent?.risk?.toUpperCase() || "MEDIUM"}`} color={agent?.risk === "low" ? C.ok : agent?.risk === "medium" ? C.warn : C.danger}/>
                </div>
                <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12}}>
                  {[
                    ["ROI Target", `${agent?.kpiTarget || 12}%`],
                    ["Capital / Cycle", `${agent?.capitalLimit || 5000} KAS`],
                    ["Horizon", `${agent?.horizon || 30} days`],
                    ["Auto-Approve ≤", `${agent?.autoApproveThreshold || 50} KAS`],
                  ].map(([k,v])=> (
                    <div key={k as any} style={{background:C.s2, padding:"10px 14px", borderRadius:6}}>
                      <div style={{fontSize:10, color:C.dim, ...mono, marginBottom:4}}>{k}</div>
                      <div style={{fontSize:14, color:C.text, fontWeight:600, ...mono}}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Edit Mode */}
            {editingStrategy && (
              <div>
                <div style={{fontSize:11, color:C.dim, ...mono, marginBottom:10}}>SELECT STRATEGY PRESET</div>
                <div style={{display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap:12, marginBottom:16}}>
                  {allStrategies.map((strategy: any) => {
                    const isSelected = editForm.strategyTemplate === strategy.id;
                    return (
                      <div 
                        key={strategy.id}
                        onClick={()=>handleStrategySelect(strategy)}
                        style={{
                          padding:"16px 18px", 
                          borderRadius:10, 
                          cursor:"pointer", 
                          border:`2px solid ${isSelected ? C.accent : C.border}`,
                          background:isSelected ? `${C.accent}15` : C.s2,
                          transition:"all 0.2s",
                          boxShadow: isSelected ? `0 4px 12px ${C.accent}30` : "none"
                        }}
                      >
                        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
                          <span style={{fontSize:14, color:isSelected ? C.accent : C.text, fontWeight:700, ...mono}}>{strategy.name}</span>
                          <Badge text={strategy.tag} color={strategy.tagColor || C.purple} size="sm"/>
                        </div>
                        <div style={{fontSize:11, color:C.dim, lineHeight:1.4}}>{strategy.purpose?.slice(0, 80)}...</div>
                      </div>
                    );
                  })}
                </div>
                
                <div style={{fontSize:11, color:C.dim, ...mono, marginBottom:10, marginTop:16}}>CONFIGURE PARAMETERS</div>
                <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12, marginBottom:16}}>
                  <Inp 
                    label="ROI Target" 
                    value={editForm.kpiTarget} 
                    onChange={(v: string)=>setEditForm((prev: any)=>({ ...prev, kpiTarget: v }))} 
                    type="number" 
                    suffix="%"
                  />
                  <Inp 
                    label="Capital / Cycle" 
                    value={editForm.capitalLimit} 
                    onChange={(v: string)=>setEditForm((prev: any)=>({ ...prev, capitalLimit: v }))} 
                    type="number" 
                    suffix="KAS"
                  />
                  <Inp 
                    label="Horizon (days)" 
                    value={editForm.horizon} 
                    onChange={(v: string)=>setEditForm((prev: any)=>({ ...prev, horizon: Number(v) }))} 
                    type="number"
                  />
                  <Inp 
                    label="Auto-Approve ≤" 
                    value={editForm.autoApproveThreshold} 
                    onChange={(v: string)=>setEditForm((prev: any)=>({ ...prev, autoApproveThreshold: v }))} 
                    type="number" 
                    suffix="KAS"
                  />
                </div>
                
                <div style={{fontSize:11, color:C.dim, ...mono, marginBottom:10}}>RISK TOLERANCE</div>
                <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:16}}>
                  {RISK_OPTS.map(r=>{const on = editForm.risk === r.v; return (
                    <div 
                      key={r.v} 
                      onClick={()=>setEditForm((prev: any)=>({ ...prev, risk: r.v }))}
                      style={{
                        padding:"12px 10px", 
                        borderRadius:4, 
                        cursor:"pointer", 
                        border:`1px solid ${on?C.accent:C.border}`, 
                        background:on?C.aLow:C.s2, 
                        textAlign:"center", 
                        transition:"all 0.15s"
                      }}
                    >
                      <div style={{fontSize:12, color:on?C.accent:C.text, fontWeight:600, ...mono}}>{r.l}</div>
                    </div>
                  );})}
                </div>
                
                <div style={{fontSize:11, color:C.dim, ...mono, marginBottom:10}}>EXECUTION MODE</div>
                <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:16}}>
                  {EXEC_OPTS.map(r=>{const on = editForm.execMode === r.v; return (
                    <div 
                      key={r.v} 
                      onClick={()=>setEditForm((prev: any)=>({ ...prev, execMode: r.v }))}
                      style={{
                        padding:"12px 10px", 
                        borderRadius:4, 
                        cursor:"pointer", 
                        border:`1px solid ${on?C.accent:C.border}`, 
                        background:on?C.aLow:C.s2, 
                        textAlign:"center", 
                        transition:"all 0.15s"
                      }}
                    >
                      <div style={{fontSize:11, color:on?C.accent:C.text, fontWeight:600, ...mono}}>{r.l}</div>
                    </div>
                  );})}
                </div>
                
                <div style={{display:"flex", gap:10, justifyContent:"flex-end"}}>
                  <Btn onClick={()=>setEditingStrategy(false)} variant="ghost">Cancel</Btn>
                  <Btn onClick={handleSaveStrategy}>Save Changes</Btn>
                </div>
              </div>
            )}
          </Card>

          <Card p={18} style={{gridColumn:"1 / -1"}}>
            <Label>Per-Agent Execution Profiles</Label>
            <div style={{fontSize:11, color:C.dim, marginTop:8, marginBottom:10, lineHeight:1.5}}>
              Every deployed agent can run a distinct strategy template and execution mode. Use this matrix when spinning up new agents so autonomous/manual/notify behavior stays isolated per agent.
            </div>
            <div style={{display:"flex", flexDirection:"column", gap:10}}>
              {allAgents.map((row: any) => {
                const rowId = String(row?.agentId || row?.name || "").trim();
                if (!rowId) return null;
                const isActive = String(agent?.agentId || agent?.name || "") === rowId;
                const rowStrategy = String(row?.strategyTemplate || "dca_accumulator");
                const rowExecMode = normalizeExecMode(row?.execMode);
                return (
                  <div key={rowId} style={{border:`1px solid ${isActive ? C.accent : C.border}`, borderRadius:8, background:C.s2, padding:"12px 12px 10px"}}>
                    <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:10, flexWrap:"wrap"}}>
                      <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
                        <span style={{fontSize:12, color:C.text, fontWeight:700, ...mono}}>{String(row?.name || "Agent")}</span>
                        {isActive && <Badge text="ACTIVE" color={C.accent} size="sm"/>}
                        <Badge text={String(row?.strategyClass || "custom").toUpperCase()} color={C.text} size="sm"/>
                      </div>
                      {!isActive && (
                        <Btn onClick={() => onSelectAgent?.(rowId)} size="sm" variant="ghost">
                          OPEN
                        </Btn>
                      )}
                    </div>
                    <div style={{display:"grid", gridTemplateColumns:isTablet ? "1fr" : "1.25fr 1fr", gap:10}}>
                      <div>
                        <div style={{fontSize:10, color:C.dim, marginBottom:5, ...mono}}>STRATEGY TEMPLATE</div>
                        <select
                          value={rowStrategy}
                          onChange={(event) => handleAgentStrategyQuickChange(row, event.target.value)}
                          style={{
                            width:"100%",
                            background:C.s1,
                            color:C.text,
                            border:`1px solid ${C.border}`,
                            borderRadius:6,
                            padding:"8px 10px",
                            fontSize:12,
                            ...mono,
                          }}
                        >
                          {strategyOptions.map((strategy: any) => (
                            <option key={String(strategy.id)} value={String(strategy.id)} style={{background:C.s1, color:C.text}}>
                              {String(strategy.name)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div style={{fontSize:10, color:C.dim, marginBottom:5, ...mono}}>EXECUTION MODE</div>
                        <div style={{display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:6}}>
                          {EXEC_OPTS.map((mode) => {
                            const on = rowExecMode === mode.v;
                            return (
                              <button
                                key={mode.v}
                                onClick={() => handleAgentExecModeQuickChange(row, mode.v)}
                                style={{
                                  border:`1px solid ${on ? C.accent : C.border}`,
                                  borderRadius:6,
                                  background:on ? C.aLow : C.s1,
                                  color:on ? C.accent : C.text,
                                  padding:"7px 8px",
                                  cursor:"pointer",
                                  fontSize:11,
                                  fontWeight:600,
                                  ...mono,
                                }}
                                title={mode.desc}
                              >
                                {mode.v.toUpperCase()}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          
          {/* Execution Mode Card */}
          <Card p={18}>
            <Label>Execution Mode</Label>
            {EXEC_OPTS.map(m=>{const on=execMode===m.v; return(
              <div key={m.v} onClick={()=>updateActiveExecMode(m.v)} style={{padding:"12px 14px", borderRadius:4, marginBottom:8, cursor:"pointer", border:`1px solid ${on?C.accent:C.border}`, background:on?C.aLow:C.s2, transition:"all 0.15s"}}>
                <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:3}}>
                  <div style={{width:10, height:10, borderRadius:"50%", background:on?C.accent:C.muted, flexShrink:0}}/>
                  <span style={{fontSize:12, color:on?C.accent:C.text, fontWeight:700, ...mono}}>{m.l}</span>
                </div>
                <div style={{fontSize:11, color:C.dim, marginLeft:20}}>{m.desc}</div>
              </div>
            );})}
          </Card>
          <div style={{display:"flex", flexDirection:"column", gap:12}}>
            <Card p={18}>
              <Label>⚡ Quick Actions</Label>
              <div style={{fontSize:11, color:C.dim, ...mono, marginBottom:10}}>
                Auto cycle cadence: every {AUTO_CYCLE_SECONDS}s · Next cycle in {autoCycleCountdownLabel}
              </div>
              <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
                <Btn onClick={runCycle} disabled={loading||status!=="RUNNING"} size="sm">
                  {loading ? "⏳" : "🚀"} {loading ? "RUNNING" : "RUN CYCLE"}
                </Btn>
                <Btn
                  onClick={()=>setLiveExecutionArmed((v: boolean)=>!v)}
                  variant={liveExecutionArmed ? "warn" : "primary"}
                  size="sm"
                >
                  {liveExecutionArmed ? "🟢 AUTO-TRADE ON" : "🔴 AUTO-TRADE OFF"}
                </Btn>
                <Btn onClick={()=>transitionAgentStatus({ type: status==="RUNNING" ? "PAUSE" : "RESUME" })} variant="ghost" size="sm">
                  {status==="RUNNING" ? "⏸ PAUSE AGENT" : "▶️ RESUME AGENT"}
                </Btn>
                <Btn onClick={exportAgentConfig} variant="ghost" size="sm" title="Download agent config as JSON backup">
                  EXPORT
                </Btn>
                <Btn onClick={killSwitch} variant="danger" size="sm">
                  🛑 KILL-SWITCH
                </Btn>
              </div>
            </Card>
            <Card p={18}>
              <Label>Active Risk Limits — {agent?.risk?.toUpperCase() || "MEDIUM"}</Label>
              {[["Max Single Exposure",agent?.risk==="low"?"5%":agent?.risk==="medium"?"10%":"20%",C.warn],["Drawdown Halt",agent?.risk==="low"?"-8%":agent?.risk==="medium"?"-15%":"-25%",C.danger],["Confidence Floor","0.75",C.dim],["Kelly Cap",agent?.risk==="low"?"10%":agent?.risk==="medium"?"20%":"40%",C.warn],["Auto-Approve ≤",`${adaptiveAutoThreshold.thresholdKas.toFixed(2)} KAS`,C.accent]].map(([k,v,c])=> (
                <div key={k as any} style={{display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${C.border}`}}>
                  <span style={{fontSize:12, color:C.dim, ...mono}}>{k}</span>
                  <span style={{fontSize:12, color:c as any, fontWeight:700, ...mono}}>{v}</span>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
