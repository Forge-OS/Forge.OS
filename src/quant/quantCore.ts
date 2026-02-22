import {
  clamp,
  diff,
  ewmaVolatility,
  last,
  linearSlope,
  logReturns,
  maxDrawdownPct,
  pctChange,
  round,
  sigmoid,
  stddev,
  tail,
  toFinite,
  zScore,
} from "./math";

type QuantAction = "ACCUMULATE" | "REDUCE" | "HOLD" | "REBALANCE";
type QuantPhase = "ENTRY" | "SCALING" | "HOLDING" | "EXIT";
type QuantVol = "LOW" | "MEDIUM" | "HIGH";
type QuantLiq = "MINIMAL" | "MODERATE" | "SIGNIFICANT";

export type QuantSnapshot = {
  ts: number;
  priceUsd: number;
  daaScore: number;
  walletKas: number;
};

export type QuantContext = {
  history?: any[];
  now?: number;
};

export type QuantMetrics = {
  regime: string;
  sample_count: number;
  data_quality_score: number;
  price_usd: number;
  price_return_1_pct: number;
  price_return_5_pct: number;
  price_return_20_pct: number;
  momentum_z: number;
  ewma_volatility: number;
  daa_velocity: number;
  daa_slope: number;
  drawdown_pct: number;
  win_probability_model: number;
  edge_score: number;
  kelly_raw: number;
  kelly_cap: number;
  risk_ceiling: number;
  risk_profile: string;
  exposure_cap_pct: number;
  strategy_template?: string;
  ai_overlay_applied?: boolean;
  ai_action_raw?: string;
  ai_confidence_raw?: number;
};

export type QuantDecisionDraft = {
  action: QuantAction;
  confidence_score: number;
  risk_score: number;
  kelly_fraction: number;
  capital_allocation_kas: number;
  capital_allocation_pct: number;
  expected_value_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  monte_carlo_win_pct: number;
  volatility_estimate: QuantVol;
  liquidity_impact: QuantLiq;
  strategy_phase: QuantPhase;
  rationale: string;
  risk_factors: string[];
  next_review_trigger: string;
  decision_source: string;
  decision_source_detail: string;
  quant_metrics: QuantMetrics;
};

type RiskProfile = {
  label: string;
  kellyCap: number;
  riskCeiling: number;
  exposureCapPct: number;
  drawdownPenaltyStart: number;
};

function riskProfileFor(agent: any): RiskProfile {
  const risk = String(agent?.risk || "medium").toLowerCase();
  const template = String(agent?.strategyTemplate || "").toLowerCase();
  if (risk === "low") {
    const base = {
      label: "low",
      kellyCap: 0.08,
      riskCeiling: 0.42,
      exposureCapPct: 0.12,
      drawdownPenaltyStart: 0.03,
    };
    if (template === "dca_accumulator") {
      return { ...base, kellyCap: 0.06, exposureCapPct: 0.1, drawdownPenaltyStart: 0.025 };
    }
    if (template === "mean_reversion") {
      return { ...base, riskCeiling: 0.38, exposureCapPct: 0.1 };
    }
    return base;
  }
  if (risk === "high") {
    const base = {
      label: "high",
      kellyCap: 0.22,
      riskCeiling: 0.82,
      exposureCapPct: 0.35,
      drawdownPenaltyStart: 0.1,
    };
    if (template === "vol_breakout") {
      return { ...base, kellyCap: 0.2, exposureCapPct: 0.28, riskCeiling: 0.76 };
    }
    return base;
  }
  const base = {
    label: "medium",
    kellyCap: 0.14,
    riskCeiling: 0.65,
    exposureCapPct: 0.22,
    drawdownPenaltyStart: 0.06,
  };
  if (template === "trend") {
    return { ...base, kellyCap: 0.16, exposureCapPct: 0.24 };
  }
  if (template === "dca_accumulator") {
    return { ...base, kellyCap: 0.1, riskCeiling: 0.58, exposureCapPct: 0.16, drawdownPenaltyStart: 0.045 };
  }
  if (template === "mean_reversion") {
    return { ...base, riskCeiling: 0.56, exposureCapPct: 0.18 };
  }
  if (template === "vol_breakout") {
    return { ...base, kellyCap: 0.12, riskCeiling: 0.6, drawdownPenaltyStart: 0.05 };
  }
  return base;
}

function sanitizeSnapshotLike(input: any): QuantSnapshot | null {
  if (!input) return null;
  const ts = toFinite(input.ts ?? input.fetched ?? input?.kasData?.fetched ?? input?.kasData?.ts, NaN);
  const priceUsd = toFinite(input.priceUsd ?? input.price ?? input?.kasData?.priceUsd, 0);
  const daaScore = toFinite(
    input.daaScore ?? input?.dag?.daaScore ?? input?.kasData?.daaScore ?? input?.kasData?.dag?.daaScore,
    0
  );
  const walletKas = toFinite(input.walletKas ?? input?.kasData?.walletKas, 0);

  if (!Number.isFinite(ts) || ts <= 0) return null;
  return {
    ts,
    priceUsd: Math.max(0, priceUsd),
    daaScore: Math.max(0, daaScore),
    walletKas: Math.max(0, walletKas),
  };
}

function normalizeSnapshots(kasData: any, context?: QuantContext) {
  const rows: QuantSnapshot[] = [];
  for (const item of Array.isArray(context?.history) ? context!.history : []) {
    const snap = sanitizeSnapshotLike(item);
    if (snap) rows.push(snap);
  }
  const current = sanitizeSnapshotLike(kasData);
  if (current) rows.push(current);

  rows.sort((a, b) => a.ts - b.ts);

  const deduped: QuantSnapshot[] = [];
  for (const row of rows) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      row.ts === prev.ts &&
      row.priceUsd === prev.priceUsd &&
      row.daaScore === prev.daaScore &&
      row.walletKas === prev.walletKas
    ) {
      continue;
    }
    deduped.push(row);
  }

  return deduped.slice(-240);
}

function volatilityBucket(vol: number): QuantVol {
  if (vol < 0.008) return "LOW";
  if (vol < 0.02) return "MEDIUM";
  return "HIGH";
}

function liquidityBucket(allocationKas: number, walletKas: number): QuantLiq {
  if (!(walletKas > 0) || allocationKas <= walletKas * 0.06) return "MINIMAL";
  if (allocationKas <= walletKas * 0.2) return "MODERATE";
  return "SIGNIFICANT";
}

function describeRegime(momentumScore: number, vol: number, drawdownPct: number, daaTrendScore: number) {
  if (momentumScore < -0.45 || (drawdownPct > 0.12 && vol > 0.02)) return "RISK_OFF";
  if (momentumScore > 0.4 && vol < 0.03 && daaTrendScore >= 0) return "TREND_UP";
  if (Math.abs(momentumScore) < 0.15 && vol > 0.015) return "RANGE_VOL";
  if (daaTrendScore > 0.25 && momentumScore >= 0) return "FLOW_ACCUMULATION";
  return "NEUTRAL";
}

function buildRiskFactors(params: {
  dataQualityScore: number;
  volatilityEstimate: QuantVol;
  drawdownPct: number;
  liquidityImpact: QuantLiq;
  regime: string;
}) {
  const factors: string[] = [];
  if (params.dataQualityScore < 0.55) factors.push("Limited local sample history");
  if (params.volatilityEstimate === "HIGH") factors.push("Elevated short-horizon volatility");
  if (params.drawdownPct > 0.08) factors.push("Recent drawdown pressure");
  if (params.liquidityImpact !== "MINIMAL") factors.push("Position size may impact wallet liquidity");
  if (params.regime === "RISK_OFF") factors.push("Risk-off regime detected");
  if (factors.length === 0) factors.push("Normal market conditions");
  return factors.slice(0, 5);
}

function buildRationale(params: {
  action: QuantAction;
  regime: string;
  momentumScore: number;
  ewmaVol: number;
  winProbability: number;
  expectedValuePct: number;
  dataQualityScore: number;
  daaVelocity: number;
}) {
  const momentumText =
    params.momentumScore > 0.2
      ? "positive momentum"
      : params.momentumScore < -0.2
        ? "negative momentum"
        : "mixed momentum";
  const regimeText = params.regime.toLowerCase().replace(/_/g, " ");
  return [
    `${params.action} because the local quant core detects ${regimeText} with ${momentumText}, EWMA volatility ${(params.ewmaVol * 100).toFixed(2)}%, and DAA velocity ${round(params.daaVelocity, 2)}.`,
    `Model win probability is ${(params.winProbability * 100).toFixed(1)}% with expected value ${round(params.expectedValuePct, 2)}%; sizing is capped by risk profile and data-quality score ${round(params.dataQualityScore, 2)}.`,
  ].join(" ");
}

export function buildQuantCoreDecision(agent: any, kasData: any, context?: QuantContext): QuantDecisionDraft {
  const snapshots = normalizeSnapshots(kasData, context);
  const profile = riskProfileFor(agent);
  const capitalLimit = Math.max(0, toFinite(agent?.capitalLimit, 0));
  const latestSnapshot = snapshots[snapshots.length - 1];
  const now = toFinite(context?.now, Date.now());

  const priceSeries = snapshots.map((row) => row.priceUsd).filter((value) => value > 0);
  const daaSeries = snapshots.map((row) => row.daaScore).filter((value) => value > 0);
  const walletSeries = snapshots.map((row) => row.walletKas).filter((value) => value >= 0);
  const returns = logReturns(priceSeries);
  const recentReturns = tail(returns, 24);
  const lastReturn = returns.length ? last(returns) : 0;
  const ewmaVol = ewmaVolatility(recentReturns, 0.92);
  const volBucket = volatilityBucket(ewmaVol);

  const priceReturn1 = pctChange(priceSeries, 1);
  const priceReturn5 = pctChange(priceSeries, 5);
  const priceReturn20 = pctChange(priceSeries, 20);
  const momentumScoreRaw = priceReturn1 * 1.4 + priceReturn5 * 0.9 + priceReturn20 * 0.6;
  const momentumScore = clamp(momentumScoreRaw * 12, -2, 2);
  const momentumZ = clamp(zScore(lastReturn, recentReturns), -4, 4);

  const daaDiffs = diff(daaSeries);
  const daaVelocity = daaDiffs.length ? last(daaDiffs) : 0;
  const daaSlope = linearSlope(tail(daaSeries, 16));
  const daaVol = stddev(tail(daaDiffs, 16));
  const daaTrendScore = clamp((daaSlope / Math.max(1, Math.abs(daaVelocity) || 1)) * 0.25 + (daaVelocity > 0 ? 0.15 : -0.1), -1, 1);

  const drawdownPct = maxDrawdownPct(tail(priceSeries, 48));
  const priceCoverage = clamp(priceSeries.length / 32, 0, 1);
  const dagCoverage = clamp(daaSeries.length / 32, 0, 1);
  const sampleCoverage = clamp(snapshots.length / 48, 0, 1);
  const dataQualityScore = clamp(0.15 + sampleCoverage * 0.45 + priceCoverage * 0.3 + dagCoverage * 0.1, 0.15, 1);

  const volatilityPenalty = clamp(ewmaVol / 0.03, 0, 2);
  const drawdownPenalty = clamp(
    (drawdownPct - profile.drawdownPenaltyStart) / Math.max(0.01, 0.2 - profile.drawdownPenaltyStart),
    0,
    1.2
  );
  const dataPenalty = 1 - dataQualityScore;
  const momentumBoost = clamp(momentumScore / 2, -1, 1);

  const winProbabilityRaw = sigmoid(0.1 + momentumBoost * 1.25 + daaTrendScore * 0.55 - volatilityPenalty * 0.55 - drawdownPenalty * 0.6);
  const winProbability = clamp(0.5 + (winProbabilityRaw - 0.5) * (0.4 + dataQualityScore * 0.6), 0.35, 0.82);
  const monteCarloWinPct = round(winProbability * 100, 2);

  const rewardRiskRatio =
    momentumScore > 0.35 ? 2.1 : momentumScore < -0.35 ? 1.1 : volBucket === "HIGH" ? 1.3 : 1.7;
  const stopLossPct = round(clamp(ewmaVol * 100 * 2.2 + 1.4, 1.2, 12), 2);
  const takeProfitPct = round(clamp(stopLossPct * rewardRiskRatio, 2.2, 22), 2);
  const expectedValuePct = round(winProbability * takeProfitPct - (1 - winProbability) * stopLossPct, 2);

  const b = Math.max(0.01, rewardRiskRatio);
  const kellyRaw = Math.max(0, winProbability - (1 - winProbability) / b);
  const kellyCap = clamp(profile.kellyCap * (0.55 + 0.45 * dataQualityScore), 0.02, profile.kellyCap);
  const kellyFraction = round(clamp(kellyRaw, 0, kellyCap), 4);

  const riskScore = round(
    clamp(
      0.18 +
        volatilityPenalty * 0.26 +
        drawdownPenalty * 0.28 +
        (momentumScore < -0.35 ? 0.16 : 0) +
        (volBucket === "HIGH" && daaVol > 15 ? 0.1 : 0) +
        dataPenalty * 0.18 -
        (momentumScore > 0.35 ? 0.06 : 0),
      0.04,
      0.98
    ),
    4
  );

  const regime = describeRegime(momentumScore, ewmaVol, drawdownPct, daaTrendScore);
  const edgeScore = round(expectedValuePct / Math.max(1, stopLossPct), 4);
  const latestWalletKas = Math.max(0, toFinite(latestSnapshot?.walletKas ?? kasData?.walletKas, 0));
  const walletDepth = latestWalletKas > 0 ? latestWalletKas : Math.max(0, last(walletSeries) || 0);

  let action: QuantAction = "HOLD";
  if (riskScore > profile.riskCeiling + 0.08 && momentumScore < -0.2 && walletDepth > 0.5) {
    action = "REDUCE";
  } else if (expectedValuePct > 0.35 && kellyFraction > 0.01 && riskScore <= profile.riskCeiling) {
    action = "ACCUMULATE";
  } else if (Math.abs(momentumScore) < 0.12 && volBucket === "HIGH") {
    action = "REBALANCE";
  }

  const rawAllocationFromKelly = capitalLimit * kellyFraction * (1 + clamp(expectedValuePct / 6, 0, 0.65));
  const exposureCapKas = capitalLimit * profile.exposureCapPct;
  const walletExecutionCap = walletDepth > 0 ? walletDepth * Math.max(0.08, profile.exposureCapPct) : capitalLimit;
  let allocationKas = Math.min(capitalLimit, Math.max(0, rawAllocationFromKelly), exposureCapKas, walletExecutionCap);
  if (action === "HOLD") allocationKas = 0;
  if (action === "REDUCE") allocationKas = Math.min(Math.max(capitalLimit * 0.05, rawAllocationFromKelly), walletDepth * 0.25 || capitalLimit);
  if (action === "REBALANCE") allocationKas = Math.min(Math.max(capitalLimit * 0.03, rawAllocationFromKelly * 0.7), walletExecutionCap);
  allocationKas = round(Math.max(0, allocationKas), 6);
  const allocationPct = capitalLimit > 0 ? round(clamp((allocationKas / capitalLimit) * 100, 0, 100), 2) : 0;

  const liquidityImpact = liquidityBucket(allocationKas, walletDepth || capitalLimit || 1);
  const strategyPhase: QuantPhase =
    action === "ACCUMULATE"
      ? (regime === "TREND_UP" ? "ENTRY" : "SCALING")
      : action === "REDUCE"
        ? "EXIT"
        : action === "REBALANCE"
          ? "HOLDING"
          : "HOLDING";

  const confidenceScore = round(
    clamp(
      0.52 +
        clamp(Math.abs(expectedValuePct) / 5, 0, 0.2) +
        dataQualityScore * 0.15 -
        riskScore * 0.12 +
        (action === "HOLD" ? 0.02 : 0),
      0.45,
      0.97
    ),
    4
  );

  const riskFactors = buildRiskFactors({
    dataQualityScore,
    volatilityEstimate: volBucket,
    drawdownPct,
    liquidityImpact,
    regime,
  });

  const rationale = buildRationale({
    action,
    regime,
    momentumScore,
    ewmaVol,
    winProbability,
    expectedValuePct,
    dataQualityScore,
    daaVelocity,
  });

  const reviewSeconds = clamp(Math.round(45 + riskScore * 120 + (volBucket === "HIGH" ? 45 : 0)), 45, 240);
  const reviewAt = new Date(now + reviewSeconds * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const quantMetrics: QuantMetrics = {
    regime,
    sample_count: snapshots.length,
    data_quality_score: round(dataQualityScore, 4),
    price_usd: round(toFinite(last(priceSeries), toFinite(kasData?.priceUsd, 0)), 6),
    price_return_1_pct: round(priceReturn1 * 100, 4),
    price_return_5_pct: round(priceReturn5 * 100, 4),
    price_return_20_pct: round(priceReturn20 * 100, 4),
    momentum_z: round(momentumZ, 4),
    ewma_volatility: round(ewmaVol, 6),
    daa_velocity: round(daaVelocity, 4),
    daa_slope: round(daaSlope, 4),
    drawdown_pct: round(drawdownPct * 100, 4),
    win_probability_model: round(winProbability, 4),
    edge_score: round(edgeScore, 4),
    kelly_raw: round(kellyRaw, 4),
    kelly_cap: round(kellyCap, 4),
    risk_ceiling: round(profile.riskCeiling, 4),
    risk_profile: profile.label,
    exposure_cap_pct: round(profile.exposureCapPct * 100, 4),
    strategy_template: String(agent?.strategyTemplate || "custom"),
  };

  return {
    action,
    confidence_score: confidenceScore,
    risk_score: riskScore,
    kelly_fraction: kellyFraction,
    capital_allocation_kas: allocationKas,
    capital_allocation_pct: allocationPct,
    expected_value_pct: expectedValuePct,
    stop_loss_pct: stopLossPct,
    take_profit_pct: takeProfitPct,
    monte_carlo_win_pct: monteCarloWinPct,
    volatility_estimate: volBucket,
    liquidity_impact: liquidityImpact,
    strategy_phase: strategyPhase,
    rationale,
    risk_factors: riskFactors,
    next_review_trigger: `Re-evaluate in ~${reviewSeconds}s (around ${reviewAt}) or on >${round(stopLossPct / 2, 2)}% price move / regime change.`,
    decision_source: "quant-core",
    decision_source_detail: `regime:${regime};samples:${snapshots.length}`,
    quant_metrics: quantMetrics,
  };
}
