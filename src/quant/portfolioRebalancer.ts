/**
 * Portfolio Rebalancer — computes trades to restore target asset weights.
 *
 * Pure functions only — no side effects, no storage, no network.
 * Results are RebalanceTrade[] which callers dispatch via the swap/pair layer.
 *
 * Algorithm:
 *   1. Normalise targetWeights to sum = 1.
 *   2. Compute current weight of each asset from currentValues.
 *   3. For each asset where |currentWeight - targetWeight| > driftThreshold:
 *      - Compute USD delta needed to reach target.
 *      - If delta > minTradeUsd: emit BUY or SELL trade.
 *   4. Net out redundant trades when possible (SELL A → BUY B is one swap).
 *
 * Usage:
 *   const trades = computeRebalanceTrades({
 *     targetWeights: { KAS: 0.6, USDC: 0.4 },
 *     currentValues:  { KAS: 800, USDC: 200 },   // USD
 *     prices:         { KAS: 0.12, USDC: 1.0 },
 *   });
 */

export interface AssetWeights {
  [asset: string]: number; // 0–1 fractions; will be normalised
}

export interface RebalanceInput {
  /** Target portfolio weights (will be normalised to sum=1). */
  targetWeights: AssetWeights;
  /** Current USD value of each asset held. Missing assets = 0. */
  currentValues: Record<string, number>;
  /** Current USD price per unit of each asset. */
  prices: Record<string, number>;
  /** Rebalance only when drift exceeds this threshold (default 0.05 = 5%). */
  driftThreshold?: number;
  /** Skip trades below this USD value (default 5.0). */
  minTradeUsd?: number;
}

export interface RebalanceTrade {
  asset: string;
  action: "BUY" | "SELL";
  /** Amount of the asset to buy/sell (in asset units, e.g. KAS). */
  assetAmount: number;
  /** USD value of the trade. */
  usdValue: number;
  /** Current portfolio weight (0–1). */
  currentWeightPct: number;
  /** Target portfolio weight (0–1). */
  targetWeightPct: number;
  /** How far off from target (0–1). */
  driftPct: number;
}

export interface RebalanceResult {
  trades: RebalanceTrade[];
  totalPortfolioUsd: number;
  isBalanced: boolean;
  /** Human-readable one-line summary. */
  summary: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeWeights(weights: AssetWeights): Record<string, number> {
  const entries = Object.entries(weights).filter(([, v]) => Number.isFinite(v) && v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return {};
  return Object.fromEntries(entries.map(([k, v]) => [k, v / total]));
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Computes the minimal set of trades to restore target weights.
 * Returns an empty trades array if the portfolio is already balanced.
 */
export function computeRebalanceTrades(input: RebalanceInput): RebalanceResult {
  const driftThreshold = Math.max(0.001, input.driftThreshold ?? 0.05);
  const minTradeUsd = Math.max(0, input.minTradeUsd ?? 5.0);

  const normalized = normalizeWeights(input.targetWeights);
  const assets = Object.keys(normalized);

  if (assets.length === 0) {
    return { trades: [], totalPortfolioUsd: 0, isBalanced: true, summary: "No target weights defined." };
  }

  // Total portfolio value (include any assets not in targetWeights)
  const allAssets = new Set([
    ...assets,
    ...Object.keys(input.currentValues),
  ]);
  let totalUsd = 0;
  for (const a of allAssets) {
    totalUsd += Math.max(0, input.currentValues[a] ?? 0);
  }

  if (totalUsd <= 0) {
    return { trades: [], totalPortfolioUsd: 0, isBalanced: true, summary: "Portfolio is empty." };
  }

  const trades: RebalanceTrade[] = [];

  for (const asset of assets) {
    const targetWeight = normalized[asset];
    const currentUsd = Math.max(0, input.currentValues[asset] ?? 0);
    const currentWeight = currentUsd / totalUsd;
    const drift = Math.abs(targetWeight - currentWeight);

    if (drift < driftThreshold) continue;

    const targetUsd = targetWeight * totalUsd;
    const deltaUsd = targetUsd - currentUsd; // positive = need more (BUY), negative = have too much (SELL)

    if (Math.abs(deltaUsd) < minTradeUsd) continue;

    const price = Math.max(0, input.prices[asset] ?? 0);
    if (price <= 0) continue;

    const assetAmount = Math.abs(deltaUsd) / price;

    trades.push({
      asset,
      action: deltaUsd > 0 ? "BUY" : "SELL",
      assetAmount: Number(assetAmount.toFixed(6)),
      usdValue: Number(Math.abs(deltaUsd).toFixed(2)),
      currentWeightPct: Number((currentWeight * 100).toFixed(2)),
      targetWeightPct: Number((targetWeight * 100).toFixed(2)),
      driftPct: Number((drift * 100).toFixed(2)),
    });
  }

  // Sort by largest drift first
  trades.sort((a, b) => b.driftPct - a.driftPct);

  const isBalanced = trades.length === 0;
  const totalTradeUsd = trades.reduce((s, t) => s + t.usdValue, 0);
  const summary = isBalanced
    ? `Portfolio balanced (drift < ${(driftThreshold * 100).toFixed(0)}% on all assets).`
    : `${trades.length} trade${trades.length > 1 ? "s" : ""} needed · ~$${totalTradeUsd.toFixed(2)} total`;

  return { trades, totalPortfolioUsd: Number(totalUsd.toFixed(2)), isBalanced, summary };
}

/**
 * Describes the rebalance result in a single log line.
 */
export function formatRebalanceLog(result: RebalanceResult): string {
  if (result.isBalanced) return `REBALANCE · ${result.summary}`;
  const parts = result.trades.map(
    (t) =>
      `${t.action} ${t.assetAmount.toFixed(4)} ${t.asset} ($${t.usdValue.toFixed(2)}, ` +
      `${t.currentWeightPct}% → ${t.targetWeightPct}%)`,
  );
  return `REBALANCE · ${parts.join(" | ")}`;
}

/**
 * Validates that target weights are sane (all positive, ≤ 10 assets).
 * Returns an error string or null if valid.
 */
export function validateTargetWeights(weights: AssetWeights): string | null {
  const entries = Object.entries(weights);
  if (entries.length === 0) return "At least one target weight is required.";
  if (entries.length > 10) return "Maximum 10 assets supported.";
  for (const [asset, w] of entries) {
    if (!Number.isFinite(w) || w <= 0) return `Invalid weight for ${asset}: must be > 0.`;
    if (w > 1000) return `Weight for ${asset} looks unreasonably large.`;
  }
  return null;
}
