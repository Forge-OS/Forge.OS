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

function slippageBpsForLiquidity(liq: string) {
  const v = String(liq || "MODERATE").toUpperCase();
  if (v === "MINIMAL") return 6;
  if (v === "SIGNIFICANT") return 45;
  return 18;
}

export type PnlAttributionSummary = {
  grossEdgeKas: number;
  netPnlKas: number;
  netPnlMode: "estimated" | "hybrid";
  feesKas: number;
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
  missedFillKas: number;
  avgSignalConfidence: number;
  avgExpectedValuePct: number;
  signalQualityScore: number;
  timingAlphaPct: number;
  timingWins: number;
  timingSamples: number;
  rows: Array<{ label: string; value: number; color?: string; hint?: string }>;
};

export function derivePnlAttribution(params: {
  decisions: any[];
  queue: any[];
  log: any[];
  marketHistory: any[];
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

  const actionable = decisions.filter((d) => {
    const action = String(d?.dec?.action || "HOLD").toUpperCase();
    return action !== "HOLD";
  });

  const signed = actionQueue.filter((q) => q?.status === "signed");
  const pending = actionQueue.filter((q) => q?.status === "pending");
  const rejected = actionQueue.filter((q) => q?.status === "rejected");

  const feesKas = log.reduce((sum, entry) => sum + Math.max(0, n(entry?.fee, 0)), 0);

  let grossEdgeKas = 0;
  let slippageKasEstimated = 0;
  let confidenceSum = 0;
  let expectedValueSum = 0;
  let timingAlphaAcc = 0;
  let timingSamples = 0;
  let timingWins = 0;
  let qualityScoreAcc = 0;
  let qualitySamples = 0;

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
    }
  }

  let confirmedSignals = 0;
  let receiptTrackedSignals = 0;
  let confirmedEstimatedSlippageKas = 0;
  let realizedExecutionDriftKas = 0;
  for (const item of signed) {
    const receiptState = String(item?.receipt_lifecycle || "");
    const hasTrackedReceipt =
      receiptState === "broadcasted" ||
      receiptState === "pending_confirm" ||
      receiptState === "confirmed" ||
      receiptState === "failed" ||
      receiptState === "timeout";
    if (hasTrackedReceipt) receiptTrackedSignals += 1;
    if (receiptState !== "confirmed") continue;
    confirmedSignals += 1;
    const amountKas = Math.max(0, n(item?.amount_kas, 0));
    const liq = String(item?.dec?.liquidity_impact || "MODERATE");
    confirmedEstimatedSlippageKas += amountKas * (slippageBpsForLiquidity(liq) / 10_000);

    const p0 = n(item?.broadcast_price_usd, 0);
    const p1 = n(item?.confirm_price_usd, 0);
    if (p0 > 0 && p1 > 0 && amountKas > 0) {
      const side = String(item?.type || item?.dec?.action || "").toUpperCase();
      const direction = side === "REDUCE" ? -1 : 1;
      const movePct = (p1 - p0) / p0;
      realizedExecutionDriftKas += amountKas * Math.abs(movePct) * Math.abs(direction);
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
  const estimatedNetPnlKas = grossEdgeKas - feesKas - slippageKasEstimated;
  const netPnlMode: "estimated" | "hybrid" = confirmedSignals > 0 ? "hybrid" : "estimated";
  const netPnlKas = grossEdgeKas - feesKas - hybridSlippageKas;

  return {
    grossEdgeKas: Number(grossEdgeKas.toFixed(6)),
    netPnlKas: Number(netPnlKas.toFixed(6)),
    netPnlMode,
    feesKas: Number(feesKas.toFixed(6)),
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
    missedFillKas: Number(missedFillKas.toFixed(6)),
    avgSignalConfidence: Number(avgSignalConfidence.toFixed(4)),
    avgExpectedValuePct: Number(avgExpectedValuePct.toFixed(4)),
    signalQualityScore: Number(signalQualityScore.toFixed(4)),
    timingAlphaPct: Number(timingAlphaPct.toFixed(4)),
    timingWins,
    timingSamples,
    rows: [
      { label: "Gross Edge", value: Number(grossEdgeKas.toFixed(6)), hint: "Expected-value weighted edge from actionable signals" },
      { label: "Fees", value: Number((-feesKas).toFixed(6)), hint: "Protocol + execution fees from runtime logs" },
      {
        label: confirmedSignals > 0 ? "Slippage (hybrid)" : "Slippage (est)",
        value: Number((-hybridSlippageKas).toFixed(6)),
        hint:
          confirmedSignals > 0
            ? "Confirmed receipts use realized execution drift; remaining fills use estimated liquidity impact"
            : "Liquidity-impact estimate from decision liquidity bucket",
      },
      {
        label: confirmedSignals > 0 ? "Realized Drift (receipts)" : "Realized Drift (receipts)",
        value: Number((-realizedExecutionDriftKas).toFixed(6)),
        hint: "Observed price drift between broadcast and confirmation timestamps for confirmed executions",
      },
      {
        label: confirmedSignals > 0 ? "Net PnL (hybrid)" : "Net PnL (est)",
        value: Number((confirmedSignals > 0 ? netPnlKas : estimatedNetPnlKas).toFixed(6)),
        hint:
          confirmedSignals > 0
            ? "Gross edge - fees - hybrid slippage (realized where receipts are confirmed)"
            : "Gross edge - fees - estimated slippage",
      },
      { label: "Timing Alpha %", value: Number(timingAlphaPct.toFixed(6)), hint: "Directionally signed follow-through after signals" },
      { label: "Missed Fill KAS", value: Number((-missedFillKas).toFixed(6)), hint: "Pending + rejected queued execution notional" },
    ],
  };
}
