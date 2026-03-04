/**
 * Classic technical indicators for Kaspa quant engine.
 * All functions operate on plain number[] (close prices unless noted).
 * No external dependencies — pure TypeScript arithmetic.
 */

import { clamp } from "./math";

// ── RSI ────────────────────────────────────────────────────────────────────────

/**
 * Relative Strength Index (Wilder's smoothing, period 14).
 * Returns 0–100. <30 oversold, >70 overbought.
 */
export function rsi(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change >= 0) gains += change;
    else losses += -change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return clamp(100 - 100 / (1 + rs), 0, 100);
}

// ── EMA ────────────────────────────────────────────────────────────────────────

/**
 * Exponential Moving Average.
 */
export function ema(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let val = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    val = prices[i] * k + val * (1 - k);
  }
  return val;
}

// ── Bollinger Bands ────────────────────────────────────────────────────────────

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  /** -1 (at lower band) to +1 (at upper band) */
  position: number;
  /** Bandwidth as fraction of middle price */
  bandwidth: number;
}

/**
 * Bollinger Bands (SMA ± k×σ).
 */
export function bollingerBands(prices: number[], period = 20, k = 2): BollingerBands {
  if (prices.length < period) {
    const p = prices[prices.length - 1] ?? 0;
    return { upper: p, middle: p, lower: p, position: 0, bandwidth: 0 };
  }
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, v) => acc + (v - middle) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = middle + k * std;
  const lower = middle - k * std;
  const current = prices[prices.length - 1];
  const range = upper - lower;
  const position = range > 0 ? clamp((current - middle) / (range / 2), -1, 1) : 0;
  const bandwidth = middle > 0 ? range / middle : 0;
  return { upper, middle, lower, position, bandwidth };
}

// ── MACD ───────────────────────────────────────────────────────────────────────

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
  crossover: "bullish" | "bearish" | "none";
}

/**
 * MACD (12/26/9 by default).
 */
export function macd(prices: number[], fast = 12, slow = 26, signal = 9): MacdResult {
  if (prices.length < slow + signal) {
    return { macd: 0, signal: 0, histogram: 0, crossover: "none" };
  }
  const macdLine = ema(prices, fast) - ema(prices, slow);
  // Build macd series for signal line
  const macdSeries: number[] = [];
  for (let i = slow; i <= prices.length; i++) {
    const slice = prices.slice(0, i);
    macdSeries.push(ema(slice, fast) - ema(slice, slow));
  }
  const signalLine = ema(macdSeries, signal);
  const prevMacd = macdSeries[macdSeries.length - 2] ?? 0;
  const prevSignal = macdSeries.length >= signal + 1
    ? ema(macdSeries.slice(0, -1), signal)
    : signalLine;
  let crossover: MacdResult["crossover"] = "none";
  if (macdLine > signalLine && prevMacd <= prevSignal) crossover = "bullish";
  else if (macdLine < signalLine && prevMacd >= prevSignal) crossover = "bearish";
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine, crossover };
}

// ── ADX ────────────────────────────────────────────────────────────────────────

/**
 * Average Directional Index — measures trend strength (not direction).
 * >25 = strong trend, <20 = weak/no trend.
 * Requires high and low series in addition to close.
 */
export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number {
  const n = Math.min(highs.length, lows.length, closes.length);
  if (n < period + 1) return 20; // neutral default
  let plusDm = 0, minusDm = 0, tr = 0;
  for (let i = n - period; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDm += upMove > 0 && upMove > downMove ? upMove : 0;
    minusDm += downMove > 0 && downMove > upMove ? downMove : 0;
    const h = highs[i], l = lows[i], pc = closes[i - 1];
    tr += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  if (tr === 0) return 0;
  const plusDi = (plusDm / tr) * 100;
  const minusDi = (minusDm / tr) * 100;
  const diSum = plusDi + minusDi;
  if (diSum === 0) return 0;
  const dx = (Math.abs(plusDi - minusDi) / diSum) * 100;
  return clamp(dx, 0, 100);
}

// ── Support / Resistance ───────────────────────────────────────────────────────

export interface SRLevel {
  price: number;
  type: "support" | "resistance";
  strength: number;
  touches: number;
}

/**
 * Detect local swing highs/lows and cluster them into S/R levels.
 * Works well with 60–240 samples.
 */
export function findSupportResistance(
  prices: number[],
  tolerance = 0.025,
  lookback = 3,
): SRLevel[] {
  if (prices.length < lookback * 2 + 1) return [];
  const raw: SRLevel[] = [];
  for (let i = lookback; i < prices.length - lookback; i++) {
    const win = prices.slice(i - lookback, i + lookback + 1);
    const c = prices[i];
    if (win.every((v) => v <= c)) raw.push({ price: c, type: "resistance", strength: 0.5, touches: 1 });
    if (win.every((v) => v >= c)) raw.push({ price: c, type: "support", strength: 0.5, touches: 1 });
  }
  // Cluster
  const clusters: SRLevel[] = [];
  for (const lvl of raw) {
    const existing = clusters.find(
      (c) => c.type === lvl.type && Math.abs(c.price - lvl.price) / lvl.price < tolerance,
    );
    if (existing) {
      existing.touches += 1;
      existing.price = (existing.price * (existing.touches - 1) + lvl.price) / existing.touches;
    } else {
      clusters.push({ ...lvl });
    }
  }
  return clusters
    .map((c) => ({ ...c, strength: clamp(c.touches / 5, 0, 1) }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 6);
}

// ── Mean Reversion ─────────────────────────────────────────────────────────────

export interface MeanReversionSignal {
  is_oversold: boolean;
  is_overbought: boolean;
  reversion_strength: number;
  bb_position: number;
  rsi_level: number;
  /** Suggested action bias from reversion: 1=accumulate, -1=reduce, 0=neutral */
  bias: number;
}

/**
 * Combine RSI + Bollinger Bands into a single mean-reversion signal.
 */
export function detectMeanReversion(prices: number[], period = 20): MeanReversionSignal {
  const rsiLevel = rsi(prices, 14);
  const bb = bollingerBands(prices, period, 2);
  const isOversold = rsiLevel < 32 && bb.position < -0.65;
  const isOverbought = rsiLevel > 68 && bb.position > 0.65;
  const reversionStrength = clamp(
    Math.abs(bb.position) * 0.6 + (Math.abs(rsiLevel - 50) / 50) * 0.4,
    0,
    1,
  );
  const bias = isOversold ? 1 : isOverbought ? -1 : 0;
  return { is_oversold: isOversold, is_overbought: isOverbought, reversion_strength: reversionStrength, bb_position: bb.position, rsi_level: rsiLevel, bias };
}

// ── Trend Strength ─────────────────────────────────────────────────────────────

export interface TrendStrengthSignal {
  adx_value: number;
  trend_direction: "up" | "down" | "none";
  ema_crossover: "bullish" | "bearish" | "none";
  macd_crossover: "bullish" | "bearish" | "none";
  /** 0 = no trend, 1 = strong trend */
  trend_score: number;
}

/**
 * Composite trend strength: ADX + EMA crossover + MACD crossover.
 * Pass price-only; highs/lows derived by ±0.5% approximation if not provided.
 */
export function analyzeTrendStrength(
  prices: number[],
  highs?: number[],
  lows?: number[],
): TrendStrengthSignal {
  if (prices.length < 30) {
    return { adx_value: 20, trend_direction: "none", ema_crossover: "none", macd_crossover: "none", trend_score: 0 };
  }
  const h = highs ?? prices.map((p) => p * 1.005);
  const l = lows ?? prices.map((p) => p * 0.995);
  const adxVal = adx(h, l, prices, 14);
  const ema12 = ema(prices, 12);
  const ema26 = ema(prices, 26);
  const ema12Prev = ema(prices.slice(0, -1), 12);
  const ema26Prev = ema(prices.slice(0, -1), 26);
  let emaCrossover: TrendStrengthSignal["ema_crossover"] = "none";
  if (ema12 > ema26 && ema12Prev <= ema26Prev) emaCrossover = "bullish";
  else if (ema12 < ema26 && ema12Prev >= ema26Prev) emaCrossover = "bearish";
  const macdResult = macd(prices);
  const trendDirection: TrendStrengthSignal["trend_direction"] =
    ema12 > ema26 * 1.002 ? "up" : ema12 < ema26 * 0.998 ? "down" : "none";
  const trendScore = clamp(
    (adxVal / 50) * 0.5 +
      (trendDirection !== "none" ? 0.25 : 0) +
      (emaCrossover !== "none" ? 0.15 : 0) +
      (macdResult.crossover !== "none" ? 0.1 : 0),
    0,
    1,
  );
  return {
    adx_value: adxVal,
    trend_direction: trendDirection,
    ema_crossover: emaCrossover,
    macd_crossover: macdResult.crossover,
    trend_score: trendScore,
  };
}
