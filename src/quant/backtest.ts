/**
 * Forge.OS deterministic backtesting engine.
 *
 * Runs a simplified local-signal strategy over historical QuantSnapshots and
 * returns portfolio performance metrics + an equity curve.  No AI calls —
 * fully reproducible given the same snapshot history.
 *
 * Signal engine:  RSI(14) + EMA-crossover(12/26) + BB-position(20)
 * Risk model:     half-kelly sizing capped by capitalLimit
 * P&L:            KAS-native (tracks KAS balance, marks to USD for charting)
 */

import { clamp, mean, stddev, maxDrawdownPct, logReturns, rsi, ema, bollingerBands } from "./math";
import type { QuantSnapshot } from "./quantCore";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BacktestAction = "ACCUMULATE" | "REDUCE" | "HOLD";

export type BacktestTrade = {
  ts: number;
  priceUsd: number;
  action: BacktestAction;
  kasAmount: number;
  usdValue: number;
  /** true if trade moved P&L in the right direction (judged at next signal) */
  profitable: boolean | null;
};

export type BacktestEquityPoint = {
  ts: number;
  kasBalance: number;
  usdValue: number;
  returnPct: number;
  label: string;
};

export type BacktestResult = {
  /** Total KAS-native return (%) vs initial capital */
  totalReturnPct: number;
  /** Total USD-equivalent return (%) over the window */
  totalReturnUsdPct: number;
  /** Maximum peak-to-trough drawdown on USD equity curve */
  maxDrawdownPct: number;
  /** Annualised Sharpe (daily log-returns, risk-free = 0) */
  sharpeRatio: number;
  /** Sortino ratio (penalise downside only) */
  sortinoRatio: number;
  /** % of ACCUMULATE signals followed by a price increase */
  winRatePct: number;
  tradeCount: number;
  accumulateCount: number;
  reduceCount: number;
  holdCount: number;
  /** KAS balance at end of window */
  finalKasBalance: number;
  /** KAS invested vs KAS held at the end */
  kasInvested: number;
  /** Elapsed days covered by the snapshot window */
  elapsedDays: number;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  /** Signals per snapshot (for diagnostics) */
  signalSeries: Array<{ ts: number; rsi: number; emaBull: boolean; bbPos: number; action: BacktestAction }>;
};

export type BacktestParams = {
  /** Historical price snapshots (same array from useKaspaFeed) */
  snapshots: QuantSnapshot[];
  /** Starting KAS balance to simulate (default 1000) */
  initialKas?: number;
  /** Max % of available KAS to deploy per cycle, acting as half-kelly cap (0–1, default 0.25) */
  cycleCapFraction?: number;
  /** actionMode: 'accumulate_only' blocks REDUCE signals */
  actionMode?: "accumulate_only" | "full";
  /** Risk level affects signal aggressiveness thresholds */
  risk?: "low" | "medium" | "high";
  /** Optional: restrict to last N milliseconds of history */
  windowMs?: number;
};

// ── Signal constants ──────────────────────────────────────────────────────────

const RSI_PERIOD = 14;
const EMA_FAST = 12;
const EMA_SLOW = 26;
const BB_PERIOD = 20;

// Minimum snapshots before we trust the signal
const MIN_SIGNAL_SAMPLES = Math.max(RSI_PERIOD, EMA_SLOW, BB_PERIOD) + 4;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function rsiThresholds(risk: BacktestParams["risk"]): { oversold: number; overbought: number } {
  if (risk === "low")  return { oversold: 36, overbought: 64 };
  if (risk === "high") return { oversold: 28, overbought: 72 };
  return { oversold: 32, overbought: 68 };
}

/** Derive a simple ACCUMULATE/REDUCE/HOLD signal from a price window. */
function computeLocalSignal(
  prices: number[],
  risk: BacktestParams["risk"],
): { action: BacktestAction; rsiVal: number; emaBull: boolean; bbPos: number } {
  const n = prices.length;
  if (n < MIN_SIGNAL_SAMPLES) {
    return { action: "HOLD", rsiVal: 50, emaBull: false, bbPos: 0 };
  }

  const rsiVal = rsi(prices, RSI_PERIOD);
  const emaFast = ema(prices, EMA_FAST);
  const emaSlow = ema(prices, EMA_SLOW);
  const emaBull = emaFast > emaSlow;

  const bb = bollingerBands(prices, BB_PERIOD, 2);
  const current = prices[n - 1];
  const bbRange = bb.upper - bb.lower;
  const bbPos = bbRange > 0 ? clamp((current - bb.middle) / (bbRange / 2), -1, 1) : 0;

  const { oversold, overbought } = rsiThresholds(risk);

  // ACCUMULATE: RSI oversold + BB below middle + EMA showing some support
  const accumScore =
    (rsiVal < oversold ? 2 : rsiVal < oversold + 8 ? 1 : 0) +
    (bbPos < -0.35 ? 2 : bbPos < 0 ? 1 : 0) +
    (emaBull ? 1 : 0);

  // REDUCE: RSI overbought + BB above middle
  const reduceScore =
    (rsiVal > overbought ? 2 : rsiVal > overbought - 8 ? 1 : 0) +
    (bbPos > 0.55 ? 2 : bbPos > 0.25 ? 1 : 0);

  let action: BacktestAction = "HOLD";
  if (accumScore >= 3) action = "ACCUMULATE";
  else if (reduceScore >= 3) action = "REDUCE";

  return { action, rsiVal, emaBull, bbPos };
}

// ── Main engine ───────────────────────────────────────────────────────────────

export function runBacktest(params: BacktestParams): BacktestResult {
  const {
    snapshots,
    initialKas = 1000,
    cycleCapFraction = 0.25,
    actionMode = "full",
    risk = "medium",
    windowMs,
  } = params;

  // Filter + sort snapshots
  const now = Date.now();
  const sinceTs = windowMs ? now - windowMs : 0;
  const pts = snapshots
    .filter((s) => s.priceUsd > 0 && s.ts >= sinceTs)
    .sort((a, b) => a.ts - b.ts);

  if (pts.length < 4) {
    return emptyResult(initialKas);
  }

  const initialPrice = pts[0].priceUsd;
  const finalPrice = pts[pts.length - 1].priceUsd;

  // Portfolio state
  let kasBalance = initialKas;
  let kasInvested = 0;   // cumulative KAS deployed

  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];
  const signalSeries: BacktestResult["signalSeries"] = [];

  let holdCount = 0;
  let accumulateCount = 0;
  let reduceCount = 0;

  // Step through each snapshot, computing signals on the rolling window up to that point
  for (let i = 0; i < pts.length; i++) {
    const snap = pts[i];
    const prices = pts.slice(0, i + 1).map((s) => s.priceUsd);

    const sig = computeLocalSignal(prices, risk);

    // Gate REDUCE if accumulate_only
    const effectiveAction: BacktestAction =
      actionMode === "accumulate_only" && sig.action === "REDUCE" ? "HOLD" : sig.action;

    signalSeries.push({
      ts: snap.ts,
      rsi: sig.rsiVal,
      emaBull: sig.emaBull,
      bbPos: sig.bbPos,
      action: effectiveAction,
    });

    // Execute trade
    if (effectiveAction === "ACCUMULATE" && kasBalance > 0.01) {
      const deploy = kasBalance * clamp(cycleCapFraction, 0.05, 0.5);
      kasBalance -= deploy;
      kasInvested += deploy;
      accumulateCount++;
      trades.push({
        ts: snap.ts,
        priceUsd: snap.priceUsd,
        action: "ACCUMULATE",
        kasAmount: deploy,
        usdValue: deploy * snap.priceUsd,
        profitable: null, // filled retrospectively below
      });
    } else if (effectiveAction === "REDUCE" && kasInvested > 0.01) {
      const release = kasInvested * clamp(cycleCapFraction, 0.05, 0.5);
      kasBalance += release;
      kasInvested -= release;
      reduceCount++;
      trades.push({
        ts: snap.ts,
        priceUsd: snap.priceUsd,
        action: "REDUCE",
        kasAmount: release,
        usdValue: release * snap.priceUsd,
        profitable: null,
      });
    } else {
      holdCount++;
    }

    // Equity = (free KAS + invested KAS) × current price
    const totalKas = kasBalance + kasInvested;
    const usdValue = totalKas * snap.priceUsd;
    const returnPct = initialPrice > 0
      ? ((snap.priceUsd - initialPrice) / initialPrice) * 100
      : 0;

    equityCurve.push({
      ts: snap.ts,
      kasBalance: totalKas,
      usdValue,
      returnPct: parseFloat(returnPct.toFixed(3)),
      label: fmtLabel(snap.ts),
    });
  }

  // Mark trades as profitable/unprofitable with lookahead
  for (let t = 0; t < trades.length; t++) {
    const trade = trades[t];
    const nextIdx = Math.min(t + 3, trades.length - 1);
    if (nextIdx <= t) { trade.profitable = null; continue; }
    const nextPrice = trades[nextIdx].priceUsd;
    if (trade.action === "ACCUMULATE") {
      trade.profitable = nextPrice > trade.priceUsd;
    } else if (trade.action === "REDUCE") {
      trade.profitable = nextPrice < trade.priceUsd;
    }
  }

  // Compute stats
  const judged = trades.filter((t) => t.profitable !== null);
  const wins = judged.filter((t) => t.profitable === true).length;
  const winRatePct = judged.length > 0 ? (wins / judged.length) * 100 : 0;

  const usdValues = equityCurve.map((p) => p.usdValue);
  const logRets = logReturns(usdValues);

  const sharpeRatio = logRets.length >= 2
    ? (mean(logRets) / (stddev(logRets) || 1)) * Math.sqrt(Math.max(1, pts.length))
    : 0;

  const downsideRets = logRets.filter((r) => r < 0);
  const downsideDev = downsideRets.length >= 2 ? stddev(downsideRets) : stddev(logRets);
  const sortinoRatioVal = downsideDev > 0
    ? (mean(logRets) / downsideDev) * Math.sqrt(Math.max(1, pts.length))
    : 0;

  const totalKasFinal = kasBalance + kasInvested;
  const totalKasReturnPct = initialKas > 0
    ? ((totalKasFinal - initialKas) / initialKas) * 100
    : 0;

  const initialUsd = initialKas * initialPrice;
  const finalUsd = totalKasFinal * finalPrice;
  const totalReturnUsdPct = initialUsd > 0
    ? ((finalUsd - initialUsd) / initialUsd) * 100
    : 0;

  const elapsedMs = pts[pts.length - 1].ts - pts[0].ts;
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

  return {
    totalReturnPct: parseFloat(totalKasReturnPct.toFixed(3)),
    totalReturnUsdPct: parseFloat(totalReturnUsdPct.toFixed(3)),
    maxDrawdownPct: parseFloat((maxDrawdownPct(usdValues) * 100).toFixed(3)),
    sharpeRatio: parseFloat(clamp(sharpeRatio, -10, 10).toFixed(3)),
    sortinoRatio: parseFloat(clamp(sortinoRatioVal, -10, 10).toFixed(3)),
    winRatePct: parseFloat(winRatePct.toFixed(1)),
    tradeCount: trades.length,
    accumulateCount,
    reduceCount,
    holdCount,
    finalKasBalance: parseFloat(totalKasFinal.toFixed(4)),
    kasInvested: parseFloat(kasInvested.toFixed(4)),
    elapsedDays: parseFloat(elapsedDays.toFixed(2)),
    trades,
    equityCurve,
    signalSeries,
  };
}

function emptyResult(initialKas: number): BacktestResult {
  return {
    totalReturnPct: 0,
    totalReturnUsdPct: 0,
    maxDrawdownPct: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    winRatePct: 0,
    tradeCount: 0,
    accumulateCount: 0,
    reduceCount: 0,
    holdCount: 0,
    finalKasBalance: initialKas,
    kasInvested: 0,
    elapsedDays: 0,
    trades: [],
    equityCurve: [],
    signalSeries: [],
  };
}

// ── Leaderboard helpers ───────────────────────────────────────────────────────

/**
 * Deterministic SHA-256 hash of the agent's strategy config.
 * Only strategy, risk, actionMode, kpiTarget, and capitalLimit are hashed —
 * never wallet data, balances, or identity fields.
 * Returns a 16-char hex prefix safe for public leaderboard use.
 */
export async function hashAgentConfig(agent: {
  strategy?: string;
  risk?: string;
  actionMode?: string;
  kpiTarget?: string;
  capitalLimit?: number;
}): Promise<string> {
  const canonical = JSON.stringify({
    strategy:     String(agent?.strategy || ""),
    risk:         String(agent?.risk || "medium"),
    actionMode:   String(agent?.actionMode || "full"),
    kpiTarget:    String(agent?.kpiTarget || ""),
    capitalLimit: Math.round(Number(agent?.capitalLimit || 0)),
  });
  const data = new TextEncoder().encode(canonical);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
