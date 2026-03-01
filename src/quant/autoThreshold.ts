import { clamp } from "./math";

type DecisionLike = {
  ts?: number;
  dec?: {
    action?: string;
  };
};

type MarketSnapshotLike = {
  ts?: number;
  priceUsd?: number;
};

export type RollingWinRateSummary = {
  samples: number;
  wins: number;
  losses: number;
  neutral: number;
  winRatePct: number;
};

export type AdaptiveThresholdResult = {
  thresholdKas: number;
  multiplier: number;
  baseThresholdKas: number;
  samplesSufficient: boolean;
  tier: "baseline" | "boosted" | "tightened" | "restricted";
  reason: string;
  rolling: RollingWinRateSummary;
};

const n = (value: any, fallback = 0) => {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
};

function nearestSnapshotIndex(history: MarketSnapshotLike[], ts: number) {
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

function subsequentPriceMovePct(history: MarketSnapshotLike[], ts: number, lookaheadSteps = 3) {
  const idx = nearestSnapshotIndex(history, ts);
  if (idx < 0) return null;
  const current = n(history[idx]?.priceUsd, 0);
  if (!(current > 0)) return null;
  const nextIdx = idx + Math.max(1, lookaheadSteps);
  if (nextIdx >= history.length) return null;
  const next = n(history[nextIdx]?.priceUsd, 0);
  if (!(next > 0)) return null;
  if (n(history[nextIdx]?.ts, 0) <= n(history[idx]?.ts, 0)) return null;
  return ((next - current) / current) * 100;
}

export function computeRollingWinRate(params: {
  decisions: DecisionLike[];
  marketHistory: MarketSnapshotLike[];
  lookaheadSteps?: number;
  maxSamples?: number;
}): RollingWinRateSummary {
  const lookaheadSteps = Math.max(1, Math.round(n(params.lookaheadSteps, 3)));
  const maxSamples = Math.max(4, Math.round(n(params.maxSamples, 40)));
  const history = Array.isArray(params.marketHistory) ? [...params.marketHistory] : [];
  history.sort((a, b) => n(a?.ts, 0) - n(b?.ts, 0));

  const actionable = (Array.isArray(params.decisions) ? params.decisions : [])
    .filter((row) => {
      const action = String(row?.dec?.action || "").toUpperCase();
      return action === "ACCUMULATE" || action === "REDUCE" || action === "REBALANCE";
    })
    .sort((a, b) => n(b?.ts, 0) - n(a?.ts, 0))
    .slice(0, maxSamples);

  let wins = 0;
  let losses = 0;
  let neutral = 0;
  for (const row of actionable) {
    const action = String(row?.dec?.action || "").toUpperCase();
    const movePct = subsequentPriceMovePct(history, n(row?.ts, 0), lookaheadSteps);
    if (!Number.isFinite(movePct)) continue;
    if (action === "ACCUMULATE") {
      if (movePct > 0) wins += 1;
      else losses += 1;
      continue;
    }
    if (action === "REDUCE") {
      if (movePct < 0) wins += 1;
      else losses += 1;
      continue;
    }
    if (Math.abs(movePct) >= 0.7) wins += 1;
    else neutral += 1;
  }

  const samples = wins + losses + neutral;
  const winRatePct = samples > 0 ? (wins / samples) * 100 : 0;
  return {
    samples,
    wins,
    losses,
    neutral,
    winRatePct: Number(winRatePct.toFixed(2)),
  };
}

export function deriveAdaptiveAutoApproveThreshold(params: {
  baseThresholdKas: number;
  decisions: DecisionLike[];
  marketHistory: MarketSnapshotLike[];
  calibrationHealth?: number;
  truthDegraded?: boolean;
  minimumSamples?: number;
  maxSamples?: number;
}): AdaptiveThresholdResult {
  const baseThresholdKas = Math.max(0, n(params.baseThresholdKas, 0));
  const minimumSamples = Math.max(4, Math.round(n(params.minimumSamples, 10)));
  const rolling = computeRollingWinRate({
    decisions: params.decisions,
    marketHistory: params.marketHistory,
    maxSamples: params.maxSamples ?? 40,
  });
  const calibrationHealth = clamp(n(params.calibrationHealth, 1), 0, 1);
  const truthDegraded = Boolean(params.truthDegraded);
  if (baseThresholdKas <= 0) {
    return {
      thresholdKas: 0,
      multiplier: 0,
      baseThresholdKas,
      samplesSufficient: false,
      tier: "baseline",
      reason: "base_threshold_zero",
      rolling,
    };
  }

  if (rolling.samples < minimumSamples) {
    return {
      thresholdKas: Number(baseThresholdKas.toFixed(6)),
      multiplier: 1,
      baseThresholdKas,
      samplesSufficient: false,
      tier: "baseline",
      reason: `insufficient_samples_${rolling.samples}/${minimumSamples}`,
      rolling,
    };
  }

  const performanceEdge = clamp((rolling.winRatePct - 50) / 50, -1, 1);
  let multiplier = clamp(1 + performanceEdge * 0.7, 0.55, 1.45);
  multiplier *= clamp(0.65 + calibrationHealth * 0.55, 0.55, 1.2);
  if (truthDegraded) multiplier *= 0.78;
  multiplier = clamp(multiplier, 0.35, 1.6);

  const thresholdKas = Number((baseThresholdKas * multiplier).toFixed(6));
  let tier: AdaptiveThresholdResult["tier"] = "baseline";
  if (multiplier >= 1.12) tier = "boosted";
  else if (multiplier < 0.88) tier = "tightened";
  if (multiplier < 0.62 || truthDegraded || calibrationHealth < 0.45) tier = "restricted";

  const reasonParts = [
    `rolling_win_rate_${rolling.winRatePct.toFixed(1)}pct`,
    `health_${calibrationHealth.toFixed(3)}`,
  ];
  if (truthDegraded) reasonParts.push("truth_degraded");

  return {
    thresholdKas,
    multiplier: Number(multiplier.toFixed(4)),
    baseThresholdKas,
    samplesSufficient: true,
    tier,
    reason: reasonParts.join(";"),
    rolling,
  };
}
