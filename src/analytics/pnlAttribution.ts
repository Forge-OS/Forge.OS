const n = (v: any, fallback = 0) => {
  const out = Number(v);
  return Number.isFinite(out) ? out : fallback;
};
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function isSortedByTsAsc(history: any[]) {
  for (let i = 1; i < history.length; i += 1) {
    if (n(history[i - 1]?.ts, 0) > n(history[i]?.ts, 0)) return false;
  }
  return true;
}

function nearestSnapshotIndex(history: any[], ts: number) {
  if (!Array.isArray(history) || history.length === 0 || !Number.isFinite(ts)) return -1;

  let lo = 0;
  let hi = history.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midTs = n(history[mid]?.ts, 0);
    if (midTs === ts) return mid;
    if (midTs < ts) lo = mid + 1;
    else hi = mid - 1;
  }

  const left = Math.max(0, hi);
  const right = Math.min(history.length - 1, lo);
  const leftDist = Math.abs(n(history[left]?.ts, 0) - ts);
  const rightDist = Math.abs(n(history[right]?.ts, 0) - ts);
  return leftDist <= rightDist ? left : right;
}

function subsequentPriceMovePct(history: any[], ts: number, lookaheadSteps = 3) {
  const idx = nearestSnapshotIndex(history, ts);
  if (idx < 0) return null;
  const current = n(history[idx]?.priceUsd, 0);
  if (!(current > 0)) return null;
  const nextIdx = Math.min(history.length - 1, idx + Math.max(1, lookaheadSteps));
  const next = n(history[nextIdx]?.priceUsd, 0);
  if (!(next > 0)) return null;
  return ((next - current) / current) * 100;
}

function nearestSnapshotPrice(history: any[], ts: number) {
  const idx = nearestSnapshotIndex(history, ts);
  if (idx < 0) return null;
  const price = n(history[idx]?.priceUsd, 0);
  return price > 0 ? price : null;
}

function slippageBpsForLiquidity(liq: string) {
  const v = String(liq || "MODERATE").toUpperCase();
  if (v === "MINIMAL") return 6;
  if (v === "SIGNIFICANT") return 45;
  return 18;
}

export type PnlAttributionSummary = {
  grossEdgeKas: number;
  netPnlKas: number;
  netPnlMode: "estimated" | "hybrid" | "realized";
  feesKas: number;
  realizedChainFeeKas: number;
  slippageKas: number;
  estimatedSlippageKas: number;
  estimatedNetPnlKas: number;
  realizedExecutionDriftKas: number;
  actionableSignals: number;
  executedSignals: number;
  confirmedSignals: number;
  pendingSignals: number;
  rejectedSignals: number;
  fillRatePct: number;
  receiptCoveragePct: number;
  realizedReceiptCoveragePct: number;
  chainFeeCoveragePct: number;
  realizedMinConfirmations: number;
  confirmationFloorObservedMin: number;
  confirmationFloorObservedMax: number;
  provenanceChainSignals: number;
  provenanceBackendSignals: number;
  provenanceEstimatedSignals: number;
  missedFillKas: number;
  avgSignalConfidence: number;
  avgExpectedValuePct: number;
  signalQualityScore: number;
  confidenceBrierScore: number;
  evCalibrationErrorPct: number;
  realizedVsExpectedEdgeKas: number;
  regimeHitRatePct: number;
  regimeHitSamples: number;
  timingAlphaPct: number;
  timingWins: number;
  timingSamples: number;
  rows: Array<{ label: string; value: number; color?: string; hint?: string }>;
  /** USD equivalent fields — populated when marketHistory contains priceUsd snapshots */
  snapshotPriceUsd: number;
  netPnlUsd: number;
  grossEdgeUsd: number;
  feesUsd: number;
  slippageUsd: number;
  missedFillUsd: number;
};

export type RealizedConfirmationDepthPolicy = {
  base?: number;
  byAction?: Partial<Record<"ACCUMULATE" | "REDUCE" | "REBALANCE" | "HOLD", number>>;
  byRisk?: Partial<Record<"LOW" | "MEDIUM" | "HIGH", number>>;
  amountTiersKas?: Array<{ minAmountKas: number; minConfirmations: number }>;
};

function normalizeRealizedConfirmationPolicy(
  policy: RealizedConfirmationDepthPolicy | undefined,
  fallbackBase: number
) {
  const base = Math.max(1, Math.round(n(policy?.base, fallbackBase)));
  const byAction: Record<string, number> = {};
  const byRisk: Record<string, number> = {};
  for (const [k, v] of Object.entries(policy?.byAction || {})) {
    const key = String(k || "").toUpperCase();
    if (!key) continue;
    byAction[key] = Math.max(1, Math.round(n(v, base)));
  }
  for (const [k, v] of Object.entries(policy?.byRisk || {})) {
    const key = String(k || "").toUpperCase();
    if (!key) continue;
    byRisk[key] = Math.max(1, Math.round(n(v, base)));
  }
  const amountTiersKas = Array.isArray(policy?.amountTiersKas)
    ? policy!.amountTiersKas
        .map((t) => ({
          minAmountKas: Math.max(0, n((t as any)?.minAmountKas, 0)),
          minConfirmations: Math.max(1, Math.round(n((t as any)?.minConfirmations, base))),
        }))
        .filter((t) => t.minAmountKas >= 0 && t.minConfirmations >= 1)
        .sort((a, b) => a.minAmountKas - b.minAmountKas)
    : [];
  return { base, byAction, byRisk, amountTiersKas };
}

function inferRiskTierFromQueueItem(item: any): "LOW" | "MEDIUM" | "HIGH" | "" {
  const explicitRisk = String(item?.dec?.risk || item?.dec?.quant_metrics?.risk_profile || "").toUpperCase();
  if (explicitRisk === "LOW" || explicitRisk === "MEDIUM" || explicitRisk === "HIGH") return explicitRisk as any;
  const riskScore = n(item?.dec?.risk_score, NaN);
  if (!Number.isFinite(riskScore)) return "";
  if (riskScore >= 0.7) return "HIGH";
  if (riskScore >= 0.4) return "MEDIUM";
  return "LOW";
}

function requiredRealizedConfirmationsForItem(item: any, policy: ReturnType<typeof normalizeRealizedConfirmationPolicy>) {
  let required = Math.max(1, Number(policy?.base || 1));
  const action = String(item?.type || item?.dec?.action || "").toUpperCase();
  if (action && policy?.byAction?.[action] != null) {
    required = Math.max(required, Math.max(1, Math.round(n(policy.byAction[action], required))));
  }
  const riskTier = inferRiskTierFromQueueItem(item);
  if (riskTier && policy?.byRisk?.[riskTier] != null) {
    required = Math.max(required, Math.max(1, Math.round(n(policy.byRisk[riskTier], required))));
  }
  const amountKas = Math.max(0, n(item?.amount_kas, 0));
  for (const tier of policy?.amountTiersKas || []) {
    if (amountKas >= Math.max(0, n(tier?.minAmountKas, 0))) {
      required = Math.max(required, Math.max(1, Math.round(n(tier?.minConfirmations, required))));
    }
  }
  return required;
}

function regimePredictionHit(regimeRaw: any, movePct: number) {
  const regime = String(regimeRaw || "").toUpperCase();
  if (!regime || !Number.isFinite(movePct)) return null;
  const absMove = Math.abs(movePct);
  if (regime.includes("TREND_UP")) return movePct > 0;
  if (regime.includes("TREND_DOWN")) return movePct < 0;
  if (regime.includes("RISK_OFF")) return movePct <= 0;
  if (regime.includes("RANGE_LOW") || regime === "RANGE") return absMove < 0.8;
  if (regime.includes("RANGE_VOL")) return absMove >= 0.8;
  return null;
}

export function derivePnlAttribution(params: {
  decisions: any[];
  queue: any[];
  log: any[];
  marketHistory: any[];
  realizedMinConfirmations?: number;
  confirmationDepthPolicy?: RealizedConfirmationDepthPolicy;
}): PnlAttributionSummary {
  const decisions = Array.isArray(params.decisions) ? params.decisions : [];
  const queue = Array.isArray(params.queue) ? params.queue : [];
  const actionQueue = queue.filter((q) => q?.metaKind !== "treasury_fee");
  const log = Array.isArray(params.log) ? params.log : [];
  const marketHistory = Array.isArray(params.marketHistory)
    ? (isSortedByTsAsc(params.marketHistory)
        ? params.marketHistory
        : [...params.marketHistory].sort((a, b) => n(a?.ts, 0) - n(b?.ts, 0)))
    : [];
  const realizedMinConfirmations = Math.max(1, Math.round(n((params as any)?.realizedMinConfirmations, 1)));
  const confirmationPolicy = normalizeRealizedConfirmationPolicy(
    (params as any)?.confirmationDepthPolicy,
    realizedMinConfirmations
  );

  const actionable = decisions.filter((d) => {
    const action = String(d?.dec?.action || "HOLD").toUpperCase();
    return action !== "HOLD";
  });

  const signed = actionQueue.filter((q) => q?.status === "signed");
  const pending = actionQueue.filter((q) => q?.status === "pending");
  const rejected = actionQueue.filter((q) => q?.status === "rejected");

  const feesKasLogged = log.reduce((sum, entry) => sum + Math.max(0, n(entry?.fee, 0)), 0);

  let grossEdgeKas = 0;
  let slippageKasEstimated = 0;
  let confidenceSum = 0;
  let expectedValueSum = 0;
  let timingAlphaAcc = 0;
  let timingSamples = 0;
  let timingWins = 0;
  let qualityScoreAcc = 0;
  let qualitySamples = 0;
  let confidenceBrierAcc = 0;
  let confidenceBrierSamples = 0;
  let regimeHitCount = 0;
  let regimeHitSamples = 0;

  for (const item of decisions) {
    const dec = item?.dec || {};
    const action = String(dec?.action || "HOLD").toUpperCase();
    const amountKas = Math.max(0, n(dec?.capital_allocation_kas, 0));
    const evPct = n(dec?.expected_value_pct, 0);
    const conf = clamp(n(dec?.confidence_score, 0), 0, 1);
    const liq = String(dec?.liquidity_impact || "MODERATE");
    const source = String(dec?.decision_source || item?.source || "ai");

    confidenceSum += conf;
    expectedValueSum += evPct;

    if (action !== "HOLD") {
      grossEdgeKas += amountKas * (evPct / 100);
      slippageKasEstimated += amountKas * (slippageBpsForLiquidity(liq) / 10_000);
    }

    const movePct = subsequentPriceMovePct(marketHistory, n(item?.ts, 0), 3);
    if (movePct != null) {
      timingSamples += 1;
      let signedMove = 0;
      if (action === "ACCUMULATE") signedMove = movePct;
      else if (action === "REDUCE") signedMove = -movePct;
      else signedMove = -Math.abs(movePct) * 0.1;
      timingAlphaAcc += signedMove;
      if (signedMove > 0) timingWins += 1;

      const qm = dec?.quant_metrics || {};
      const modelWin = clamp(n(qm?.win_probability_model, n(dec?.monte_carlo_win_pct, 50) / 100), 0, 1);
      const realizedWin = signedMove > 0 ? 1 : 0;
      const calibrationScore = 1 - Math.abs(modelWin - realizedWin);
      const aiPenalty = source === "quant-core" || source === "fallback" ? 0.03 : 0;
      qualityScoreAcc += clamp(calibrationScore - aiPenalty, 0, 1);
      qualitySamples += 1;

      confidenceBrierAcc += (conf - realizedWin) ** 2;
      confidenceBrierSamples += 1;

      const regimeHit = regimePredictionHit(qm?.regime, movePct);
      if (typeof regimeHit === "boolean") {
        regimeHitSamples += 1;
        if (regimeHit) regimeHitCount += 1;
      }
    }
  }

  let confirmedSignals = 0;
  let receiptTrackedSignals = 0;
  let realizedReceiptSignals = 0;
  let confirmedEstimatedSlippageKas = 0;
  let realizedExecutionDriftKas = 0;
  let realizedChainFeeKas = 0;
  let chainFeeSignals = 0;
  let provenanceChainSignals = 0;
  let provenanceBackendSignals = 0;
  let provenanceEstimatedSignals = 0;
  let confirmationFloorObservedMin = 0;
  let confirmationFloorObservedMax = 0;
  let evCalibrationAbsErrPctAcc = 0;
  let evCalibrationSamples = 0;
  let realizedDirectionalEdgeKas = 0;
  let expectedDirectionalEdgeKas = 0;
  for (const item of signed) {
    const receiptState = String(item?.receipt_lifecycle || "");
    const receiptImportedFrom = String(item?.receipt_imported_from || "").toLowerCase();
    const receiptSourcePath = String(item?.receipt_source_path || "").toLowerCase();
    const confirmSource = String(item?.confirm_ts_source || "").toLowerCase();
    const provenanceIsBackend = receiptImportedFrom === "callback_consumer" || receiptSourcePath.includes("callback-consumer");
    const provenanceIsChain = receiptImportedFrom === "kaspa_api" || confirmSource === "chain";
    const hasTrackedReceipt =
      receiptState === "broadcasted" ||
      receiptState === "pending_confirm" ||
      receiptState === "confirmed" ||
      receiptState === "failed" ||
      receiptState === "timeout";
    if (hasTrackedReceipt) receiptTrackedSignals += 1;
    const confirmations = Math.max(0, n(item?.confirmations, 0));
    const requiredConfirmations = requiredRealizedConfirmationsForItem(item, confirmationPolicy);
    if (confirmationFloorObservedMin === 0 || requiredConfirmations < confirmationFloorObservedMin) {
      confirmationFloorObservedMin = requiredConfirmations;
    }
    if (requiredConfirmations > confirmationFloorObservedMax) {
      confirmationFloorObservedMax = requiredConfirmations;
    }
    const meetsRealizedConfirmationFloor = confirmations >= requiredConfirmations;
    if (receiptState !== "confirmed") {
      provenanceEstimatedSignals += 1;
      continue;
    }
    if (provenanceIsBackend) provenanceBackendSignals += 1;
    else if (provenanceIsChain) provenanceChainSignals += 1;
    else provenanceEstimatedSignals += 1;
    confirmedSignals += 1;
    const amountKas = Math.max(0, n(item?.amount_kas, 0));
    const liq = String(item?.dec?.liquidity_impact || "MODERATE");
    confirmedEstimatedSlippageKas += amountKas * (slippageBpsForLiquidity(liq) / 10_000);

    const feeKas = n(item?.receipt_fee_kas, NaN);
    if (meetsRealizedConfirmationFloor && Number.isFinite(feeKas) && feeKas >= 0) {
      realizedChainFeeKas += feeKas;
      chainFeeSignals += 1;
    }

    const broadcastTs = n(item?.broadcast_ts, 0);
    const confirmTs = n(item?.confirm_ts, 0);
    const hasChainConfirmTs = String(item?.confirm_ts_source || "") === "chain" && confirmTs > 0;
    const p0 = n(item?.broadcast_price_usd, 0) > 0
      ? n(item?.broadcast_price_usd, 0)
      : (nearestSnapshotPrice(marketHistory, broadcastTs) ?? 0);
    const p1 = hasChainConfirmTs
      ? (nearestSnapshotPrice(marketHistory, confirmTs) ?? n(item?.confirm_price_usd, 0))
      : n(item?.confirm_price_usd, 0);
    const backendSlippageKas = n(item?.receipt_slippage_kas, NaN);
    const hasBackendSlippage = Number.isFinite(backendSlippageKas) && backendSlippageKas >= 0;
    if (hasBackendSlippage && meetsRealizedConfirmationFloor) {
      realizedReceiptSignals += 1;
      realizedExecutionDriftKas += backendSlippageKas;
      continue;
    }
    if (meetsRealizedConfirmationFloor && hasChainConfirmTs && p0 > 0 && p1 > 0) {
      realizedReceiptSignals += 1;
    }
    if (meetsRealizedConfirmationFloor && p0 > 0 && p1 > 0 && amountKas > 0) {
      const side = String(item?.type || item?.dec?.action || "").toUpperCase();
      const direction = side === "REDUCE" ? -1 : 1;
      const movePct = (p1 - p0) / p0;
      realizedExecutionDriftKas += amountKas * Math.abs(movePct) * Math.abs(direction);

      const signedMovePct = movePct * direction * 100;
      const expectedValuePct = n(item?.dec?.expected_value_pct, 0);
      realizedDirectionalEdgeKas += amountKas * (signedMovePct / 100);
      expectedDirectionalEdgeKas += amountKas * (expectedValuePct / 100);
      evCalibrationAbsErrPctAcc += Math.abs(signedMovePct - expectedValuePct);
      evCalibrationSamples += 1;
    }
  }

  const hybridSlippageKas = Math.max(
    0,
    slippageKasEstimated - confirmedEstimatedSlippageKas + realizedExecutionDriftKas
  );

  const executedSignals = signed.length;
  const actionableSignals = actionable.length;
  const pendingSignals = pending.length;
  const rejectedSignals = rejected.length;
  const fillRatePct = actionableSignals > 0 ? (executedSignals / actionableSignals) * 100 : 0;
  const receiptCoveragePct = executedSignals > 0 ? (confirmedSignals / executedSignals) * 100 : 0;
  const missedFillKas = [...pending, ...rejected].reduce((sum, item) => sum + Math.max(0, n(item?.amount_kas, 0)), 0);
  const avgSignalConfidence = decisions.length > 0 ? confidenceSum / decisions.length : 0;
  const avgExpectedValuePct = decisions.length > 0 ? expectedValueSum / decisions.length : 0;
  const timingAlphaPct = timingSamples > 0 ? timingAlphaAcc / timingSamples : 0;
  const signalQualityScore = qualitySamples > 0 ? qualityScoreAcc / qualitySamples : 0;
  const confidenceBrierScore = confidenceBrierSamples > 0 ? confidenceBrierAcc / confidenceBrierSamples : 0;
  const regimeHitRatePct = regimeHitSamples > 0 ? (regimeHitCount / regimeHitSamples) * 100 : 0;
  const evCalibrationErrorPct = evCalibrationSamples > 0 ? evCalibrationAbsErrPctAcc / evCalibrationSamples : 0;
  const realizedVsExpectedEdgeKas = realizedDirectionalEdgeKas - expectedDirectionalEdgeKas;
  const estimatedNetPnlKas = grossEdgeKas - feesKasLogged - slippageKasEstimated;
  const allExecutedConfirmed = executedSignals > 0 && confirmedSignals === executedSignals;
  const realizedReceiptCoveragePct = executedSignals > 0 ? (realizedReceiptSignals / executedSignals) * 100 : 0;
  const chainFeeCoveragePct = confirmedSignals > 0 ? (chainFeeSignals / confirmedSignals) * 100 : 0;
  const canCallRealized = allExecutedConfirmed && confirmedSignals > 0 && realizedReceiptSignals === confirmedSignals;
  const netPnlMode: "estimated" | "hybrid" | "realized" =
    confirmedSignals === 0 ? "estimated" : canCallRealized ? "realized" : "hybrid";
  const feesKas = feesKasLogged;
  const netPnlKas = grossEdgeKas - feesKas - hybridSlippageKas;

  // ── USD conversion using latest available market snapshot ────────────────
  const latestSnap = marketHistory.length > 0 ? marketHistory[marketHistory.length - 1] : null;
  const snapshotPriceUsd = latestSnap ? n(latestSnap.priceUsd, 0) : 0;
  const toUsd = (kas: number) =>
    snapshotPriceUsd > 0 ? Number((kas * snapshotPriceUsd).toFixed(4)) : 0;

  return {
    grossEdgeKas: Number(grossEdgeKas.toFixed(6)),
    netPnlKas: Number(netPnlKas.toFixed(6)),
    netPnlMode,
    feesKas: Number(feesKas.toFixed(6)),
    realizedChainFeeKas: Number(realizedChainFeeKas.toFixed(6)),
    slippageKas: Number(hybridSlippageKas.toFixed(6)),
    estimatedSlippageKas: Number(slippageKasEstimated.toFixed(6)),
    estimatedNetPnlKas: Number(estimatedNetPnlKas.toFixed(6)),
    realizedExecutionDriftKas: Number(realizedExecutionDriftKas.toFixed(6)),
    actionableSignals,
    executedSignals,
    confirmedSignals,
    pendingSignals,
    rejectedSignals,
    fillRatePct: Number(fillRatePct.toFixed(2)),
    receiptCoveragePct: Number(receiptCoveragePct.toFixed(2)),
    realizedReceiptCoveragePct: Number(realizedReceiptCoveragePct.toFixed(2)),
    chainFeeCoveragePct: Number(chainFeeCoveragePct.toFixed(2)),
    realizedMinConfirmations,
    confirmationFloorObservedMin: Math.max(0, Math.round(confirmationFloorObservedMin || confirmationPolicy.base)),
    confirmationFloorObservedMax: Math.max(0, Math.round(confirmationFloorObservedMax || confirmationPolicy.base)),
    provenanceChainSignals,
    provenanceBackendSignals,
    provenanceEstimatedSignals,
    missedFillKas: Number(missedFillKas.toFixed(6)),
    avgSignalConfidence: Number(avgSignalConfidence.toFixed(4)),
    avgExpectedValuePct: Number(avgExpectedValuePct.toFixed(4)),
    signalQualityScore: Number(signalQualityScore.toFixed(4)),
    confidenceBrierScore: Number(confidenceBrierScore.toFixed(6)),
    evCalibrationErrorPct: Number(evCalibrationErrorPct.toFixed(6)),
    realizedVsExpectedEdgeKas: Number(realizedVsExpectedEdgeKas.toFixed(6)),
    regimeHitRatePct: Number(regimeHitRatePct.toFixed(2)),
    regimeHitSamples,
    timingAlphaPct: Number(timingAlphaPct.toFixed(4)),
    timingWins,
    timingSamples,
    snapshotPriceUsd,
    netPnlUsd: toUsd(netPnlKas),
    grossEdgeUsd: toUsd(grossEdgeKas),
    feesUsd: toUsd(feesKas),
    slippageUsd: toUsd(hybridSlippageKas),
    missedFillUsd: toUsd(missedFillKas),
    rows: [
      { label: "Gross Edge", value: Number(grossEdgeKas.toFixed(6)), hint: "Expected-value weighted edge from actionable signals" },
      { label: "Fees", value: Number((-feesKas).toFixed(6)), hint: "Protocol + execution fees from runtime logs" },
      {
        label: "Chain Fee (receipts)",
        value: Number((-realizedChainFeeKas).toFixed(6)),
        hint: "On-chain network fee parsed from confirmed receipt payloads (coverage may be partial)",
      },
      {
        label: confirmedSignals > 0 ? "Slippage (hybrid)" : "Slippage (est)",
        value: Number((-hybridSlippageKas).toFixed(6)),
        hint:
          confirmedSignals > 0
            ? "Confirmed receipts use backend slippage when available, otherwise realized execution drift; remaining fills use estimated liquidity impact"
            : "Liquidity-impact estimate from decision liquidity bucket",
      },
      {
        label: confirmedSignals > 0 ? "Realized Drift (receipts)" : "Realized Drift (receipts)",
        value: Number((-realizedExecutionDriftKas).toFixed(6)),
        hint:
          netPnlMode === "realized"
            ? "Backend slippage or observed price drift using chain confirmation timestamps and market snapshots"
            : "Backend slippage or observed price drift between broadcast and confirmation timestamps for confirmed executions",
      },
      {
        label: netPnlMode === "realized" ? "Net PnL (realized)" : confirmedSignals > 0 ? "Net PnL (hybrid)" : "Net PnL (est)",
        value: Number((confirmedSignals > 0 ? netPnlKas : estimatedNetPnlKas).toFixed(6)),
        hint:
          netPnlMode === "realized"
            ? `All executed signals confirmed with receipt-aware drift at >= ${realizedMinConfirmations} confirmation${realizedMinConfirmations === 1 ? "" : "s"}`
            : confirmedSignals > 0
            ? "Gross edge - fees - hybrid slippage (realized where receipts are confirmed)"
            : "Gross edge - fees - estimated slippage",
      },
      { label: "Timing Alpha %", value: Number(timingAlphaPct.toFixed(6)), hint: "Directionally signed follow-through after signals" },
      { label: "Missed Fill KAS", value: Number((-missedFillKas).toFixed(6)), hint: "Pending + rejected queued execution notional" },
    ],
  };
}
