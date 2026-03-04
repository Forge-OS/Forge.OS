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
import { computeMultiTimeframeSignals, type MultiTimeframeSignals } from "./multiTimeframe";

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
  /** Optional BlockDAG-native signals from a live feed (see src/kaspa/dagSignals.ts). */
  dagSignals?: {
    bpsVelocity: number;
    bpsDeviation: number;
    networkHealth: "healthy" | "slow" | "surge";
    activitySurge: boolean;
    dagMomentumBias: number;
    cycleMultiplier: number;
    daaScoresSinceLastMove: number;
    expectedBps: number;
  };
  /** Optional extra context forwarded verbatim to the AI overlay prompt. */
  extra?: {
    krcPortfolioTokens?: Array<{ ticker: string; balanceKas?: number; balanceUsd?: number }>;
    utxoCount?: number;
    utxoTotalKas?: number;
    recentDecisions?: Array<{ ts: number; action: string; confidence_score: number; rationale?: string }>;
  };
  /**
   * Number of consecutive cycles in which the current regime has held without change.
   * Used to dampen Kelly sizing during fresh regime transitions (< 3 cycles = transitioning).
   */
  regimeHoldCycles?: number;
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
  strategy_mode?: string;
  strategy_mode_reason?: string;
  mtf_signal_1h?: number;
  mtf_signal_4h?: number;
  mtf_signal_24h?: number;
  mtf_alignment_score?: number;
  mtf_weighted_score?: number;
  mtf_coverage_score?: number;
  mtf_dominant_timeframe?: string;
  adaptive_kelly_cap?: number;
  adaptive_risk_ceiling?: number;
  adaptive_exposure_cap_pct?: number;
  regime_hold_cycles?: number;
  ai_overlay_applied?: boolean;
  ai_action_raw?: string;
  ai_confidence_raw?: number;
  /** Live BlockDAG BPS velocity (scores/sec) from the external feed. */
  bps_velocity?: number;
  /** % deviation of live BPS from the expected network rate. */
  bps_deviation_pct?: number;
  /** DAG-native price momentum bias (1.0 = neutral). */
  dag_momentum_bias?: number;
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

type StrategyAdaptation = {
  mode: string;
  reason: string;
  kellyCapMultiplier: number;
  riskCeilingMultiplier: number;
  exposureCapMultiplier: number;
  actionBias: number;
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
    // dca_bot: designed for autonomous high-threshold execution — slightly more
    // liberal sizing than dca_accumulator to justify the higher auto-approve limit.
    if (template === "dca_bot") {
      return { ...base, kellyCap: 0.07, exposureCapPct: 0.11, drawdownPenaltyStart: 0.028 };
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

function strategyTemplateKind(agent: any) {
  const template = String(agent?.strategyTemplate || agent?.strategyLabel || "custom").toLowerCase();
  if (template.includes("mean")) return "mean_reversion";
  if (template.includes("trend")) return "trend";
  if (template.includes("breakout") || template.includes("vol")) return "vol_breakout";
  if (template.includes("dca") || template.includes("accum")) return "dca";
  return "custom";
}

function resolveStrategyAdaptation(
  agent: any,
  regime: string,
  volBucket: QuantVol,
  mtf: MultiTimeframeSignals,
): StrategyAdaptation {
  const kind = strategyTemplateKind(agent);
  const reasonParts = [`template:${kind}`, `regime:${regime}`];
  let adaptation: StrategyAdaptation = {
    mode: "BASELINE",
    reason: "",
    kellyCapMultiplier: 1,
    riskCeilingMultiplier: 1,
    exposureCapMultiplier: 1,
    actionBias: 0,
  };

  if (regime === "RISK_OFF") {
    adaptation = {
      mode: "CAPITAL_PRESERVATION",
      reason: "risk_off",
      kellyCapMultiplier: 0.55,
      riskCeilingMultiplier: 0.78,
      exposureCapMultiplier: 0.62,
      actionBias: -0.14,
    };
  } else if (kind === "trend") {
    if (regime === "RANGE_VOL") {
      adaptation = {
        mode: "TREND_TO_RANGE_DEFENSE",
        reason: "trend_template_range_vol",
        kellyCapMultiplier: 0.74,
        riskCeilingMultiplier: 0.86,
        exposureCapMultiplier: 0.78,
        actionBias: -0.08,
      };
    } else if (regime === "TREND_UP" || regime === "FLOW_ACCUMULATION") {
      adaptation = {
        mode: "TREND_CAPTURE",
        reason: "trend_template_aligned",
        kellyCapMultiplier: 1.12,
        riskCeilingMultiplier: 1.06,
        exposureCapMultiplier: 1.1,
        actionBias: 0.06,
      };
    }
  } else if (kind === "mean_reversion") {
    if (regime === "RANGE_VOL") {
      adaptation = {
        mode: "MEAN_REVERSION_ATTACK",
        reason: "mean_reversion_template_aligned",
        kellyCapMultiplier: 1.1,
        riskCeilingMultiplier: 1.04,
        exposureCapMultiplier: 1.08,
        actionBias: 0.04,
      };
    } else if (regime === "TREND_UP") {
      adaptation = {
        mode: "MEAN_REVERSION_TO_TREND_GUARD",
        reason: "mean_reversion_template_misaligned",
        kellyCapMultiplier: 0.86,
        riskCeilingMultiplier: 0.92,
        exposureCapMultiplier: 0.9,
        actionBias: -0.03,
      };
    }
  } else if (kind === "dca" && (regime === "FLOW_ACCUMULATION" || regime === "TREND_UP")) {
    adaptation = {
      mode: "FLOW_DCA_SCALING",
      reason: "dca_template_flow_alignment",
      kellyCapMultiplier: 1.08,
      riskCeilingMultiplier: 1.02,
      exposureCapMultiplier: 1.16,
      actionBias: 0.05,
    };
  } else if (kind === "vol_breakout" && regime === "RANGE_VOL") {
    adaptation = {
      mode: "BREAKOUT_PREP",
      reason: "vol_breakout_template_aligned",
      kellyCapMultiplier: 1.05,
      riskCeilingMultiplier: 1.03,
      exposureCapMultiplier: 1.03,
      actionBias: 0.03,
    };
  }

  // Multi-timeframe disagreements dampen aggressiveness regardless of template.
  if (mtf.coverage > 0.2 && mtf.alignment < 0.45) {
    adaptation.kellyCapMultiplier *= 0.84;
    adaptation.exposureCapMultiplier *= 0.88;
    adaptation.actionBias -= 0.04;
    reasonParts.push("mtf_alignment_low");
  } else if (mtf.weightedScore > 0.35) {
    adaptation.actionBias += 0.03;
    reasonParts.push("mtf_bullish");
  } else if (mtf.weightedScore < -0.35) {
    adaptation.actionBias -= 0.06;
    reasonParts.push("mtf_bearish");
  }

  if (volBucket === "HIGH" && kind !== "vol_breakout") {
    adaptation.kellyCapMultiplier *= 0.9;
    adaptation.exposureCapMultiplier *= 0.92;
    reasonParts.push("high_volatility_damping");
  }

  adaptation.kellyCapMultiplier = clamp(adaptation.kellyCapMultiplier, 0.45, 1.22);
  adaptation.riskCeilingMultiplier = clamp(adaptation.riskCeilingMultiplier, 0.7, 1.12);
  adaptation.exposureCapMultiplier = clamp(adaptation.exposureCapMultiplier, 0.55, 1.28);
  adaptation.actionBias = clamp(adaptation.actionBias, -0.2, 0.16);
  adaptation.reason = [adaptation.reason, ...reasonParts].filter(Boolean).join(";");
  return adaptation;
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

function describeRegime(
  momentumScore: number,
  vol: number,
  drawdownPct: number,
  daaTrendScore: number,
  mtfScore: number,
  mtfAlignment: number,
) {
  if (momentumScore < -0.45 || (drawdownPct > 0.12 && vol > 0.02)) return "RISK_OFF";
  if (momentumScore > 0.35 && vol < 0.03 && daaTrendScore >= 0 && mtfScore >= 0.1) return "TREND_UP";
  if (momentumScore < -0.25 && mtfScore < -0.18 && mtfAlignment >= 0.45) return "TREND_DOWN";
  if (Math.abs(momentumScore) < 0.15 && vol > 0.015 && mtfAlignment < 0.65) return "RANGE_VOL";
  if (daaTrendScore > 0.25 && momentumScore >= 0 && mtfScore >= -0.05) return "FLOW_ACCUMULATION";
  return "NEUTRAL";
}

function buildRiskFactors(params: {
  dataQualityScore: number;
  volatilityEstimate: QuantVol;
  drawdownPct: number;
  liquidityImpact: QuantLiq;
  regime: string;
  mtfAlignment?: number;
  strategyMode?: string;
}) {
  const factors: string[] = [];
  if (params.dataQualityScore < 0.55) factors.push("Limited local sample history");
  if (params.volatilityEstimate === "HIGH") factors.push("Elevated short-horizon volatility");
  if (params.drawdownPct > 0.08) factors.push("Recent drawdown pressure");
  if (params.liquidityImpact !== "MINIMAL") factors.push("Position size may impact wallet liquidity");
  if (params.regime === "RISK_OFF") factors.push("Risk-off regime detected");
  if (typeof params.mtfAlignment === "number" && params.mtfAlignment < 0.45) factors.push("Timeframe trend alignment is weak");
  if (params.strategyMode && params.strategyMode !== "BASELINE") factors.push(`Regime-adaptive mode: ${params.strategyMode.toLowerCase().replace(/_/g, " ")}`);
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
  strategyMode: string;
  mtfScore: number;
  mtfDominant: string;
}) {
  const momentumText =
    params.momentumScore > 0.2
      ? "positive momentum"
      : params.momentumScore < -0.2
        ? "negative momentum"
        : "mixed momentum";
  const regimeText = params.regime.toLowerCase().replace(/_/g, " ");
  const mtfText =
    params.mtfScore > 0.2
      ? "bullish"
      : params.mtfScore < -0.2
        ? "bearish"
        : "mixed";
  return [
    `${params.action} because the local quant core detects ${regimeText} with ${momentumText}, EWMA volatility ${(params.ewmaVol * 100).toFixed(2)}%, and DAA velocity ${round(params.daaVelocity, 2)}.`,
    `Regime-adaptive mode ${params.strategyMode.toLowerCase().replace(/_/g, " ")} is active; multi-timeframe (${params.mtfDominant}) signal is ${mtfText}.`,
    `Model win probability is ${(params.winProbability * 100).toFixed(1)}% with expected value ${round(params.expectedValuePct, 2)}%; sizing is capped by risk profile and data-quality score ${round(params.dataQualityScore, 2)}.`,
  ].join(" ");
}

export function buildQuantCoreDecision(agent: any, kasData: any, context?: QuantContext): QuantDecisionDraft {
  const snapshots = normalizeSnapshots(kasData, context);
  const profile = riskProfileFor(agent);

  // WARM-UP GATE: require 32+ snapshots before issuing any non-HOLD recommendation.
  // With fewer samples the quant model's volatility/momentum estimates are unreliable.
  if (snapshots.length < 32) {
    return {
      action: "HOLD",
      confidence_score: 0,
      risk_score: 0.5,
      kelly_fraction: 0,
      capital_allocation_kas: 0,
      capital_allocation_pct: 0,
      expected_value_pct: 0,
      stop_loss_pct: 0,
      take_profit_pct: 0,
      monte_carlo_win_pct: 0,
      volatility_estimate: "MEDIUM",
      liquidity_impact: "MINIMAL",
      strategy_phase: "HOLDING",
      rationale: `Warm-up phase: ${snapshots.length}/32 snapshots collected. Holding until sufficient price history is available for reliable quantitative analysis.`,
      risk_factors: ["Insufficient sample history — quant model warming up"],
      next_review_trigger: `Continue accumulating price history (${snapshots.length}/32 samples required).`,
      decision_source: "quant-core",
      decision_source_detail: `warmup:${snapshots.length}_of_32`,
      quant_metrics: {
        regime: "NEUTRAL",
        sample_count: snapshots.length,
        data_quality_score: round(snapshots.length / 32, 4),
        price_usd: 0,
        price_return_1_pct: 0,
        price_return_5_pct: 0,
        price_return_20_pct: 0,
        momentum_z: 0,
        ewma_volatility: 0,
        daa_velocity: 0,
        daa_slope: 0,
        drawdown_pct: 0,
        win_probability_model: 0,
        edge_score: 0,
        kelly_raw: 0,
        kelly_cap: 0,
        risk_ceiling: 0,
        risk_profile: profile.label,
        exposure_cap_pct: 0,
      },
    };
  }

  const capitalLimit = Math.max(0, toFinite(agent?.capitalLimit, 0));
  const latestSnapshot = snapshots[snapshots.length - 1];
  const now = toFinite(context?.now, Date.now());
  const mtf = computeMultiTimeframeSignals(snapshots, now);

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
  const momentumScoreRaw =
    priceReturn1 * 1.4 +
    priceReturn5 * 0.9 +
    priceReturn20 * 0.6 +
    mtf.weightedScore * 0.45 +
    mtf.signals["1h"].score * 0.2;
  const momentumScore = clamp(momentumScoreRaw * 12, -2, 2);
  const momentumZ = clamp(zScore(lastReturn, recentReturns), -4, 4);

  const daaDiffs = diff(daaSeries);
  const daaVelocity = daaDiffs.length ? last(daaDiffs) : 0;
  const daaSlope = linearSlope(tail(daaSeries, 16));
  const daaVol = stddev(tail(daaDiffs, 16));
  const daaTrendScoreBase = clamp((daaSlope / Math.max(1, Math.abs(daaVelocity) || 1)) * 0.25 + (daaVelocity > 0 ? 0.15 : -0.1), -1, 1);

  // Blend live BlockDAG BPS deviation into daaTrendScore.
  // Cap at ±0.20 so external data augments but never overrides local calc.
  // activitySurge adds a small positive push (high demand = bullish flow signal).
  const extBps = context?.dagSignals;
  const bpsBoost = extBps
    ? clamp(extBps.bpsDeviation / 200, -0.12, 0.12) + (extBps.activitySurge ? 0.08 : 0)
    : 0;
  const daaTrendScore = clamp(daaTrendScoreBase + bpsBoost, -1, 1);

  const drawdownPct = maxDrawdownPct(tail(priceSeries, 48));
  const priceCoverage = clamp(priceSeries.length / 32, 0, 1);
  const dagCoverage = clamp(daaSeries.length / 32, 0, 1);
  const sampleCoverage = clamp(snapshots.length / 48, 0, 1);
  const dataQualityScore = clamp(0.15 + sampleCoverage * 0.45 + priceCoverage * 0.3 + dagCoverage * 0.1, 0.15, 1);
  const regime = describeRegime(
    momentumScore,
    ewmaVol,
    drawdownPct,
    daaTrendScore,
    mtf.weightedScore,
    mtf.alignment,
  );

  // CIRCUIT BREAKER: hard stop when recent drawdown exceeds agent-configured or absolute limit.
  // Prevents the engine from issuing any allocation during severe capital impairment.
  const maxDdPct = Math.max(0.05, Math.min(0.5, toFinite((agent as any)?.maxDrawdownPct, 0.20)));
  if (drawdownPct > maxDdPct) {
    return {
      action: "HOLD",
      confidence_score: 0.1,
      risk_score: 0.92,
      kelly_fraction: 0,
      capital_allocation_kas: 0,
      capital_allocation_pct: 0,
      expected_value_pct: 0,
      stop_loss_pct: round(drawdownPct * 100, 2),
      take_profit_pct: 0,
      monte_carlo_win_pct: 0,
      volatility_estimate: volBucket,
      liquidity_impact: "MINIMAL",
      strategy_phase: "HOLDING",
      rationale: `Circuit breaker: ${(drawdownPct * 100).toFixed(1)}% drawdown exceeds the ${(maxDdPct * 100).toFixed(1)}% limit — all new allocations suspended until recovery.`,
      risk_factors: [
        `Drawdown circuit breaker triggered (${(drawdownPct * 100).toFixed(1)}% > ${(maxDdPct * 100).toFixed(1)}%)`,
        "All capital allocation suspended until drawdown recovers",
      ],
      next_review_trigger: `Monitor for drawdown recovery below ${(maxDdPct * 100).toFixed(1)}%.`,
      decision_source: "quant-core",
      decision_source_detail: `circuit_breaker:dd_${(drawdownPct * 100).toFixed(1)}pct`,
      quant_metrics: {
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
        win_probability_model: 0,
        edge_score: 0,
        kelly_raw: 0,
        kelly_cap: 0,
        risk_ceiling: round(profile.riskCeiling, 4),
        risk_profile: profile.label,
        exposure_cap_pct: round(profile.exposureCapPct * 100, 4),
      },
    };
  }

  const strategyAdaptation = resolveStrategyAdaptation(agent, regime, volBucket, mtf);

  // REGIME HOLD (item 5): dampen Kelly by 25% when regime is transitioning (< 3 stable cycles).
  // Prevents over-sizing on fresh regime signals that may be noise.
  const regimeHoldCycles = Math.max(0, Math.round(toFinite(context?.regimeHoldCycles, 0)));
  const regimeTransitioning = regimeHoldCycles < 3;
  if (regimeTransitioning) {
    strategyAdaptation.kellyCapMultiplier = clamp(strategyAdaptation.kellyCapMultiplier * 0.75, 0.45, 1.22);
  }

  // BEAR TRAP (item 6): short-term bullish signal against bearish macro trend = divergence risk.
  // Deflate action bias to prevent chasing a likely false breakout.
  const score1h = toFinite(mtf.signals["1h"]?.score, 0);
  const score24h = toFinite(mtf.signals["24h"]?.score, 0);
  const bearTrapDetected = score1h > 0.3 && score24h < -0.2;
  if (bearTrapDetected) {
    strategyAdaptation.actionBias = clamp(strategyAdaptation.actionBias * 0.5, -0.2, 0.16);
  }

  const effectiveRiskCeiling = clamp(profile.riskCeiling * strategyAdaptation.riskCeilingMultiplier, 0.18, 0.94);
  const effectiveExposureCapPct = clamp(profile.exposureCapPct * strategyAdaptation.exposureCapMultiplier, 0.04, 0.55);

  const volatilityPenalty = clamp(ewmaVol / 0.03, 0, 2);
  const drawdownPenalty = clamp(
    (drawdownPct - profile.drawdownPenaltyStart) / Math.max(0.01, 0.2 - profile.drawdownPenaltyStart),
    0,
    1.2
  );
  const dataPenalty = 1 - dataQualityScore;
  const momentumBoost = clamp((momentumScore + strategyAdaptation.actionBias) / 2, -1, 1);

  const winProbabilityRaw = sigmoid(
    0.1 +
      momentumBoost * 1.2 +
      daaTrendScore * 0.55 +
      mtf.weightedScore * 0.48 +
      strategyAdaptation.actionBias * 0.45 -
      volatilityPenalty * 0.55 -
      drawdownPenalty * 0.6
  );
  const winProbability = clamp(0.5 + (winProbabilityRaw - 0.5) * (0.4 + dataQualityScore * 0.6), 0.35, 0.82);
  const monteCarloWinPct = round(winProbability * 100, 2);

  const rewardRiskRatio =
    momentumScore + strategyAdaptation.actionBias > 0.35
      ? 2.1
      : momentumScore + strategyAdaptation.actionBias < -0.35
        ? 1.1
        : volBucket === "HIGH"
          ? 1.3
          : 1.7;
  const stopLossPct = round(clamp(ewmaVol * 100 * 2.2 + 1.4, 1.2, 12), 2);
  const takeProfitPct = round(clamp(stopLossPct * rewardRiskRatio, 2.2, 22), 2);
  const expectedValuePct = round(winProbability * takeProfitPct - (1 - winProbability) * stopLossPct, 2);

  const b = Math.max(0.01, rewardRiskRatio);
  const kellyRaw = Math.max(0, winProbability - (1 - winProbability) / b);
  // DRAWDOWN-AWARE KELLY (item 3): linearly reduce Kelly cap as drawdown exceeds 8%.
  // At 23%+ drawdown the cap is cut by 60%, protecting capital during impairment phases.
  const ddPenalty = clamp(Math.max(0, (drawdownPct - 0.08) / 0.15), 0, 1) * 0.6;
  const kellyCap = clamp(
    profile.kellyCap * strategyAdaptation.kellyCapMultiplier * (0.55 + 0.45 * dataQualityScore) * (1 - ddPenalty),
    0.015,
    Math.max(0.02, profile.kellyCap * 1.25)
  );
  const kellyFraction = round(clamp(kellyRaw, 0, kellyCap), 4);

  const riskScore = round(
    clamp(
      0.18 +
        volatilityPenalty * 0.26 +
        drawdownPenalty * 0.28 +
        (momentumScore < -0.35 ? 0.16 : 0) +
        (volBucket === "HIGH" && daaVol > 15 ? 0.1 : 0) +
        dataPenalty * 0.18 -
        (momentumScore > 0.35 ? 0.06 : 0) -
        (mtf.weightedScore > 0.25 && mtf.alignment > 0.55 ? 0.04 : 0) +
        (regime === "RISK_OFF" ? 0.08 : 0),
      0.04,
      0.98
    ),
    4
  );

  const edgeScore = round(expectedValuePct / Math.max(1, stopLossPct), 4);
  const latestWalletKas = Math.max(0, toFinite(latestSnapshot?.walletKas ?? kasData?.walletKas, 0));
  const walletDepth = latestWalletKas > 0 ? latestWalletKas : Math.max(0, last(walletSeries) || 0);
  const actionMomentum = momentumScore + strategyAdaptation.actionBias * 1.3 + mtf.weightedScore * 0.4;
  const accumulateEvFloor = clamp(0.35 - strategyAdaptation.actionBias * 0.8 - mtf.weightedScore * 0.1, 0.16, 0.52);
  const reduceTriggerMomentum = -0.2 - strategyAdaptation.actionBias * 0.5;

  let action: QuantAction = "HOLD";
  if (riskScore > effectiveRiskCeiling + 0.08 && actionMomentum < reduceTriggerMomentum && walletDepth > 0.5) {
    action = "REDUCE";
  } else if (expectedValuePct > accumulateEvFloor && kellyFraction > 0.008 && riskScore <= effectiveRiskCeiling) {
    action = "ACCUMULATE";
  } else if (Math.abs(actionMomentum) < 0.12 && volBucket === "HIGH") {
    action = "REBALANCE";
  }

  const rawAllocationFromKelly =
    capitalLimit *
    kellyFraction *
    (1 + clamp(expectedValuePct / 6, 0, 0.65)) *
    clamp(1 + strategyAdaptation.actionBias, 0.75, 1.25);
  const exposureCapKas = capitalLimit * effectiveExposureCapPct;
  const walletExecutionCap = walletDepth > 0 ? walletDepth * Math.max(0.08, effectiveExposureCapPct) : capitalLimit;
  let allocationKas = Math.min(capitalLimit, Math.max(0, rawAllocationFromKelly), exposureCapKas, walletExecutionCap);
  if (action === "HOLD") allocationKas = 0;
  if (action === "REDUCE") allocationKas = Math.min(Math.max(capitalLimit * 0.05, rawAllocationFromKelly), walletDepth * 0.25 || capitalLimit);
  if (action === "REBALANCE") allocationKas = Math.min(Math.max(capitalLimit * 0.03, rawAllocationFromKelly * 0.7), walletExecutionCap);
  allocationKas = round(Math.max(0, allocationKas), 6);
  const allocationPct = capitalLimit > 0 ? round(clamp((allocationKas / capitalLimit) * 100, 0, 100), 2) : 0;

  const liquidityImpact = liquidityBucket(allocationKas, walletDepth || capitalLimit || 1);
  const strategyPhase: QuantPhase =
    action === "ACCUMULATE"
      ? (regime === "TREND_UP" || regime === "FLOW_ACCUMULATION" ? "ENTRY" : "SCALING")
      : action === "REDUCE"
        ? "EXIT"
        : action === "REBALANCE"
          ? "HOLDING"
          : "HOLDING";

  const confidenceScore = round(
    clamp(
      0.52 +
        clamp(Math.abs(expectedValuePct) / 5, 0, 0.2) +
        dataQualityScore * 0.14 +
        mtf.alignment * 0.06 +
        Math.abs(mtf.weightedScore) * 0.05 -
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
    mtfAlignment: mtf.alignment,
    strategyMode: strategyAdaptation.mode,
  });
  if (bearTrapDetected && riskFactors.length < 6) {
    riskFactors.push("Bear trap: short-term bullish vs bearish macro divergence");
  }
  if (regimeTransitioning && riskFactors.length < 6) {
    riskFactors.push("Regime recently changed — transitional Kelly sizing applied");
  }

  const rationale = buildRationale({
    action,
    regime,
    momentumScore,
    ewmaVol,
    winProbability,
    expectedValuePct,
    dataQualityScore,
    daaVelocity,
    strategyMode: strategyAdaptation.mode,
    mtfScore: mtf.weightedScore,
    mtfDominant: mtf.dominantTimeframe,
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
    bps_velocity: extBps ? round(extBps.bpsVelocity, 2) : undefined,
    bps_deviation_pct: extBps ? round(extBps.bpsDeviation, 2) : undefined,
    dag_momentum_bias: extBps ? round(extBps.dagMomentumBias, 4) : undefined,
    drawdown_pct: round(drawdownPct * 100, 4),
    win_probability_model: round(winProbability, 4),
    edge_score: round(edgeScore, 4),
    kelly_raw: round(kellyRaw, 4),
    kelly_cap: round(kellyCap, 4),
    risk_ceiling: round(effectiveRiskCeiling, 4),
    risk_profile: profile.label,
    exposure_cap_pct: round(effectiveExposureCapPct * 100, 4),
    strategy_template: String(agent?.strategyTemplate || "custom"),
    strategy_mode: strategyAdaptation.mode,
    strategy_mode_reason: strategyAdaptation.reason,
    mtf_signal_1h: round(mtf.signals["1h"].score, 4),
    mtf_signal_4h: round(mtf.signals["4h"].score, 4),
    mtf_signal_24h: round(mtf.signals["24h"].score, 4),
    mtf_alignment_score: round(mtf.alignment, 4),
    mtf_weighted_score: round(mtf.weightedScore, 4),
    mtf_coverage_score: round(mtf.coverage, 4),
    mtf_dominant_timeframe: mtf.dominantTimeframe,
    adaptive_kelly_cap: round(kellyCap, 4),
    adaptive_risk_ceiling: round(effectiveRiskCeiling, 4),
    adaptive_exposure_cap_pct: round(effectiveExposureCapPct * 100, 4),
    regime_hold_cycles: regimeHoldCycles,
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
    decision_source_detail: `regime:${regime};mode:${strategyAdaptation.mode};samples:${snapshots.length};mtf:${round(mtf.weightedScore, 3)}`,
    quant_metrics: quantMetrics,
  };
}
