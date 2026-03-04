/**
 * Stop-Loss + Trailing Stop Engine
 *
 * Tracks entry price (weighted average across ACCUMULATE fills) and peak price
 * since last entry. Evaluates hard stop-loss and trailing stop conditions each cycle.
 *
 * Designed as a PRE-EXECUTION guard in runCycle — fires after the AI/quant decision
 * but before the transaction is dispatched. Prevents uncontrolled drawdown.
 *
 * Stop conditions:
 *   Hard stop    : currentPrice <= entryPriceUsd × (1 - stopLossPct/100)
 *   Trailing stop: currentPrice <= peakPriceUsd  × (1 - trailingStopPct/100)
 *                  (only active after peak has risen >= 2% above entry)
 *
 * Entry price update:
 *   Weighted average: newEntry = (entry × entryKas + fillPrice × fillKas) / (entryKas + fillKas)
 *   Peak is updated to max(peak, currentPrice) every cycle.
 *
 * Storage: localStorage per agentId.
 */

export interface StopLossState {
  agentId: string;
  /** Weighted average entry price in USD. 0 = no position. */
  entryPriceUsd: number;
  /** Highest price seen since last entry (for trailing stop). */
  peakPriceUsd: number;
  /** Total KAS accumulated since last REDUCE (for weighted avg). */
  entryKas: number;
  /** Unix ms of first fill in this position. */
  entryTs: number;
  /**
   * Unix ms until which ACCUMULATE is suppressed after a stop fires.
   * 0 or undefined = no cooldown. Prevents whipsaw re-entry on fast bounces.
   */
  cooldownUntil?: number;
}

export interface StopCheckResult {
  triggered: boolean;
  reason: "hard_stop" | "trailing_stop" | null;
  /** Human-readable label for log/UI. */
  label: string;
  currentPrice: number;
  entryPrice: number;
  peakPrice: number;
  drawdownPct: number;
  dropFromPeakPct: number;
}

export interface StopLossConfig {
  /** Hard stop: trigger REDUCE when price drops this % below entry. 0 = disabled. */
  stopLossPct: number;
  /** Trailing stop: trigger REDUCE when price drops this % below peak. 0 = disabled. */
  trailingStopPct: number;
  /** Min peak rise above entry (%) before trailing stop activates. Default 2. */
  trailingActivationPct?: number;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STATE_KEY_PREFIX = "forgeos.stoploss.v1.";

function stateKey(agentId: string): string {
  return `${STATE_KEY_PREFIX}${agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function loadStopLossState(agentId: string): StopLossState {
  try {
    const raw = localStorage.getItem(stateKey(agentId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.entryPriceUsd === "number") return parsed as StopLossState;
    }
  } catch {
    // corrupt storage — reset
  }
  return { agentId, entryPriceUsd: 0, peakPriceUsd: 0, entryKas: 0, entryTs: 0 };
}

function saveStopLossState(state: StopLossState): void {
  try {
    localStorage.setItem(stateKey(state.agentId), JSON.stringify(state));
  } catch {
    // storage full — silent fail
  }
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Updates entry state after a successful ACCUMULATE fill.
 * Call this AFTER a transaction is confirmed (or immediately after auto-approve).
 *
 * @param fillKas   KAS amount that was purchased
 * @param fillPrice USD price at which it was purchased
 */
export function recordAccumulateFill(agentId: string, fillKas: number, fillPrice: number): StopLossState {
  if (fillKas <= 0 || fillPrice <= 0) return loadStopLossState(agentId);
  const s = loadStopLossState(agentId);
  const totalKas = s.entryKas + fillKas;
  const weightedEntry =
    s.entryKas > 0 && s.entryPriceUsd > 0
      ? (s.entryPriceUsd * s.entryKas + fillPrice * fillKas) / totalKas
      : fillPrice;
  const updated: StopLossState = {
    agentId,
    entryPriceUsd: Number(weightedEntry.toFixed(8)),
    peakPriceUsd: Math.max(s.peakPriceUsd, fillPrice),
    entryKas: Number(totalKas.toFixed(6)),
    entryTs: s.entryTs > 0 ? s.entryTs : Date.now(),
  };
  saveStopLossState(updated);
  return updated;
}

/**
 * Updates the peak price tracker.
 * Call this every cycle with current price (even without a trade).
 */
export function updatePeakPrice(agentId: string, currentPrice: number): StopLossState {
  if (currentPrice <= 0) return loadStopLossState(agentId);
  const s = loadStopLossState(agentId);
  if (currentPrice <= s.peakPriceUsd) return s;
  const updated = { ...s, peakPriceUsd: currentPrice };
  saveStopLossState(updated);
  return updated;
}

/**
 * Resets entry state after a REDUCE execution (position closed).
 * Preserves cooldownUntil so a stop-triggered REDUCE still blocks re-entry.
 * Call this after a successful REDUCE transaction.
 */
export function resetPositionAfterReduce(agentId: string): void {
  const existing = loadStopLossState(agentId);
  saveStopLossState({
    agentId,
    entryPriceUsd: 0,
    peakPriceUsd: 0,
    entryKas: 0,
    entryTs: 0,
    cooldownUntil: existing.cooldownUntil, // preserve cooldown through position reset
  });
}

/**
 * Enter re-entry cooldown after a stop fires.
 * Blocks ACCUMULATE decisions until cooldown expires.
 * Default: 4 hours — enough to confirm whether the bounce is real or a dead-cat.
 */
export function enterStopCooldown(agentId: string, durationMs = 4 * 60 * 60 * 1000): void {
  const s = loadStopLossState(agentId);
  saveStopLossState({ ...s, cooldownUntil: Date.now() + durationMs });
}

/** Clear cooldown early (e.g. user manually resumes agent). */
export function clearStopCooldown(agentId: string): void {
  const s = loadStopLossState(agentId);
  saveStopLossState({ ...s, cooldownUntil: 0 });
}

/** Returns true if the agent is in stop cooldown — ACCUMULATE should be blocked. */
export function isInStopCooldown(agentId: string): boolean {
  const s = loadStopLossState(agentId);
  return typeof s.cooldownUntil === "number" && s.cooldownUntil > Date.now();
}

/** Milliseconds remaining in cooldown, or 0 if not in cooldown. */
export function stopCooldownRemainingMs(agentId: string): number {
  const s = loadStopLossState(agentId);
  if (!s.cooldownUntil) return 0;
  return Math.max(0, s.cooldownUntil - Date.now());
}

/**
 * Evaluates stop-loss and trailing stop conditions.
 * Returns triggered=true if execution should be overridden to REDUCE.
 *
 * Returns null if there is no position (entryPriceUsd = 0) or stop is disabled.
 */
export function checkStopConditions(
  currentPrice: number,
  state: StopLossState,
  config: StopLossConfig,
): StopCheckResult {
  const { stopLossPct, trailingStopPct, trailingActivationPct = 2.0 } = config;
  const entry = state.entryPriceUsd;
  const peak = state.peakPriceUsd;

  const drawdownPct = entry > 0 ? ((entry - currentPrice) / entry) * 100 : 0;
  const dropFromPeakPct = peak > 0 ? ((peak - currentPrice) / peak) * 100 : 0;
  const peakRisePct = entry > 0 && peak > entry ? ((peak - entry) / entry) * 100 : 0;

  const noPosition = entry <= 0;

  // Hard stop-loss
  const hardStopEnabled = stopLossPct > 0 && !noPosition;
  const hardStopHit = hardStopEnabled && drawdownPct >= stopLossPct;

  // Trailing stop (only active once peak has risen enough above entry)
  const trailingEnabled = trailingStopPct > 0 && !noPosition && peakRisePct >= trailingActivationPct;
  const trailingHit = trailingEnabled && dropFromPeakPct >= trailingStopPct;

  const triggered = hardStopHit || trailingHit;
  const reason = hardStopHit ? "hard_stop" : trailingHit ? "trailing_stop" : null;

  const label = triggered
    ? reason === "hard_stop"
      ? `HARD STOP: ${drawdownPct.toFixed(1)}% drawdown from entry $${entry.toFixed(4)} (limit: ${stopLossPct}%)`
      : `TRAILING STOP: ${dropFromPeakPct.toFixed(1)}% drop from peak $${peak.toFixed(4)} (limit: ${trailingStopPct}%)`
    : "No stop triggered";

  return {
    triggered,
    reason,
    label,
    currentPrice,
    entryPrice: entry,
    peakPrice: peak,
    drawdownPct: Number(drawdownPct.toFixed(2)),
    dropFromPeakPct: Number(dropFromPeakPct.toFixed(2)),
  };
}

/** Unrealized P&L as a percentage of entry. Positive = gain. */
export function unrealizedPnlPct(currentPrice: number, entryPrice: number): number {
  if (entryPrice <= 0 || currentPrice <= 0) return 0;
  return Number((((currentPrice - entryPrice) / entryPrice) * 100).toFixed(2));
}

/** Formats a compact stop-loss status line for the dashboard. */
export function formatStopStatus(state: StopLossState, currentPrice: number, config: StopLossConfig): string {
  if (state.entryPriceUsd <= 0) return "No position tracked";
  const pnlPct = unrealizedPnlPct(currentPrice, state.entryPriceUsd);
  const sign = pnlPct >= 0 ? "+" : "";
  const hardLevel = config.stopLossPct > 0
    ? `$${(state.entryPriceUsd * (1 - config.stopLossPct / 100)).toFixed(4)}`
    : "—";
  const trailLevel = config.trailingStopPct > 0 && state.peakPriceUsd > 0
    ? `$${(state.peakPriceUsd * (1 - config.trailingStopPct / 100)).toFixed(4)}`
    : "—";
  return (
    `Entry $${state.entryPriceUsd.toFixed(4)} · Unrealized ${sign}${pnlPct}% · ` +
    `Hard stop ${hardLevel} · Trail stop ${trailLevel}`
  );
}
