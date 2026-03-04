/**
 * Trade Outcome Tracker — Claude feedback loop.
 *
 * Records the outcome of every executed trade so that the next Claude invocation
 * can see whether its previous recommendations were profitable.
 *
 * This creates a genuine in-context learning signal:
 *   - Claude made an ACCUMULATE decision at $X
 *   - Price moved to $Y after confirmation
 *   - Next prompt includes: "Previous ACCUMULATE +8.3% [correct]"
 *   - Claude calibrates confidence based on recent accuracy
 *
 * Storage: localStorage per agentId, max 50 outcomes kept.
 */

export interface TradeOutcome {
  /** Unique trade reference (txid or generated UUID) */
  id: string;
  agentId: string;
  /** ACCUMULATE | REDUCE | STOP_LOSS */
  action: string;
  /** Decision source: "ai" | "quant-core" | "fallback" */
  decisionSource: string;
  /** USD price at broadcast time */
  entryPriceUsd: number;
  /** USD price at confirmation time (0 = not yet confirmed) */
  exitPriceUsd: number;
  /** (exitPrice - entryPrice) / entryPrice × 100 */
  pnlPct: number;
  /** KAS amount executed */
  amountKas: number;
  /** Unix ms when trade was broadcast */
  broadcastAt: number;
  /** Unix ms when trade was confirmed (0 = pending) */
  confirmedAt: number;
  /** Was the decision correct? ACCUMULATE correct if price went up, REDUCE if went down */
  correct: boolean | null;
  /** Market regime at decision time (e.g. TREND_UP, RISK_OFF, RANGING) */
  regime?: string;
  /** AI confidence score at decision time (0–1), if provided */
  confidenceScore?: number;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const OUTCOMES_KEY_PREFIX = "forgeos.outcomes.v1.";
const MAX_OUTCOMES = 50;

function outcomesKey(agentId: string): string {
  return `${OUTCOMES_KEY_PREFIX}${agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function loadOutcomes(agentId: string): TradeOutcome[] {
  try {
    const raw = localStorage.getItem(outcomesKey(agentId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveOutcomes(agentId: string, outcomes: TradeOutcome[]): void {
  try {
    const trimmed = outcomes.slice(-MAX_OUTCOMES); // keep newest MAX_OUTCOMES
    localStorage.setItem(outcomesKey(agentId), JSON.stringify(trimmed));
  } catch {
    // storage full — silent fail
  }
}

// ── Core API ──────────────────────────────────────────────────────────────────

/** Records a new trade (pending confirmation). Call immediately after broadcast. */
export function recordTradeBroadcast(params: {
  agentId: string;
  txId: string;
  action: string;
  decisionSource: string;
  entryPriceUsd: number;
  amountKas: number;
  regime?: string;
  confidenceScore?: number;
}): TradeOutcome {
  const outcome: TradeOutcome = {
    id: params.txId || `trade_${crypto.randomUUID()}`,
    agentId: params.agentId,
    action: params.action,
    decisionSource: params.decisionSource,
    entryPriceUsd: params.entryPriceUsd,
    exitPriceUsd: 0,
    pnlPct: 0,
    amountKas: params.amountKas,
    broadcastAt: Date.now(),
    confirmedAt: 0,
    correct: null,
    ...(params.regime !== undefined && { regime: params.regime }),
    ...(params.confidenceScore !== undefined && { confidenceScore: params.confidenceScore }),
  };
  const outcomes = loadOutcomes(params.agentId);
  outcomes.push(outcome);
  saveOutcomes(params.agentId, outcomes);
  return outcome;
}

/**
 * Updates an outcome with the confirmation price and computes P&L.
 * Call after chain confirmation is received.
 */
export function recordTradeConfirmation(params: {
  agentId: string;
  txId: string;
  exitPriceUsd: number;
}): TradeOutcome | null {
  const outcomes = loadOutcomes(params.agentId);
  const idx = outcomes.findIndex((o) => o.id === params.txId);
  if (idx < 0) return null;

  const o = outcomes[idx];
  if (o.entryPriceUsd <= 0 || params.exitPriceUsd <= 0) return null;

  const pnlPct = Number(
    (((params.exitPriceUsd - o.entryPriceUsd) / o.entryPriceUsd) * 100).toFixed(2)
  );

  // Correct = ACCUMULATE AND price went up, OR REDUCE/STOP_LOSS AND price went down
  const correct =
    o.action === "ACCUMULATE" ? pnlPct > 0 :
    (o.action === "REDUCE" || o.action === "STOP_LOSS") ? pnlPct < 0 :
    null;

  const updated: TradeOutcome = {
    ...o,
    exitPriceUsd: params.exitPriceUsd,
    pnlPct,
    confirmedAt: Date.now(),
    correct,
  };
  outcomes[idx] = updated;
  saveOutcomes(params.agentId, outcomes);
  return updated;
}

/** Returns the N most recent outcomes for an agent. */
export function getRecentOutcomes(agentId: string, n = 10): TradeOutcome[] {
  return loadOutcomes(agentId).slice(-n);
}

/**
 * Close the feedback loop for pending trades.
 *
 * Kaspa confirms in < 1 second at 10 BPS. Any trade broadcast > MIN_AGE_MS ago
 * is confirmed. We close it now with the current live price as the exit price.
 * Call this at the top of each runCycle.
 *
 * @returns number of outcomes closed in this call
 */
const CONFIRM_MIN_AGE_MS = 60_000; // 60 s — well past any realistic confirmation delay

export function confirmPendingOutcomes(agentId: string, currentPriceUsd: number): number {
  if (currentPriceUsd <= 0) return 0;
  const outcomes = loadOutcomes(agentId);
  let changed = 0;
  const now = Date.now();
  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i];
    if (o.confirmedAt > 0 || o.entryPriceUsd <= 0) continue;
    if (now - o.broadcastAt < CONFIRM_MIN_AGE_MS) continue;

    const pnlPct = Number(
      (((currentPriceUsd - o.entryPriceUsd) / o.entryPriceUsd) * 100).toFixed(2),
    );
    const correct =
      o.action === "ACCUMULATE" ? pnlPct > 0 :
      (o.action === "REDUCE" || o.action === "STOP_LOSS") ? pnlPct < 0 :
      null;

    outcomes[i] = { ...o, exitPriceUsd: currentPriceUsd, pnlPct, confirmedAt: now, correct };
    changed++;
  }
  if (changed > 0) saveOutcomes(agentId, outcomes);
  return changed;
}

/**
 * Computes a calibration score over the last N confirmed outcomes.
 * Score = fraction of trades where the decision direction was correct.
 * Returns null if fewer than 3 confirmed outcomes exist.
 */
export function computeCalibrationScore(agentId: string, n = 10): {
  score: number;
  correct: number;
  total: number;
} | null {
  const recent = getRecentOutcomes(agentId, n).filter((o) => o.confirmedAt > 0 && o.correct !== null);
  if (recent.length < 3) return null;
  const correct = recent.filter((o) => o.correct === true).length;
  return {
    score: Number((correct / recent.length).toFixed(3)),
    correct,
    total: recent.length,
  };
}

/**
 * Breaks down calibration accuracy per market regime.
 * Returns a map of regime → { score, correct, total }.
 * Only includes regimes with at least 2 confirmed outcomes.
 */
export function getRegimeCalibration(agentId: string, n = 50): Record<string, { score: number; correct: number; total: number }> {
  const confirmed = loadOutcomes(agentId)
    .slice(-n)
    .filter((o) => o.confirmedAt > 0 && o.correct !== null && o.regime);

  const byRegime: Record<string, { correct: number; total: number }> = {};
  for (const o of confirmed) {
    const r = o.regime!;
    if (!byRegime[r]) byRegime[r] = { correct: 0, total: 0 };
    byRegime[r].total += 1;
    if (o.correct === true) byRegime[r].correct += 1;
  }

  const result: Record<string, { score: number; correct: number; total: number }> = {};
  for (const [regime, counts] of Object.entries(byRegime)) {
    if (counts.total >= 2) {
      result[regime] = {
        score: Number((counts.correct / counts.total).toFixed(3)),
        correct: counts.correct,
        total: counts.total,
      };
    }
  }
  return result;
}

/**
 * Formats the recent outcomes for injection into the Claude prompt.
 * Returns an empty string if no confirmed outcomes.
 */
export function formatOutcomesForPrompt(agentId: string, n = 5): string {
  const outcomes = getRecentOutcomes(agentId, n * 2)
    .filter((o) => o.confirmedAt > 0) // only confirmed
    .slice(-n);

  if (outcomes.length === 0) return "";

  const calib = computeCalibrationScore(agentId, 20);

  const lines = outcomes.map((o, i) => {
    const sign = o.pnlPct >= 0 ? "+" : "";
    const verdict = o.correct === true ? "[correct]" : o.correct === false ? "[wrong]" : "[pending]";
    const ts = new Date(o.confirmedAt || o.broadcastAt).toISOString().slice(11, 19);
    const regimePart = o.regime ? ` [${o.regime}]` : "";
    const confPart = o.confidenceScore !== undefined ? ` conf=${(o.confidenceScore * 100).toFixed(0)}%` : "";
    return `${i + 1}. [${ts} UTC] ${o.action}${regimePart}${confPart} $${o.entryPriceUsd.toFixed(4)} → $${o.exitPriceUsd > 0 ? o.exitPriceUsd.toFixed(4) : "?"} (${sign}${o.pnlPct.toFixed(2)}%) ${verdict}`;
  });

  const calibLine = calib
    ? `Calibration: ${(calib.score * 100).toFixed(0)}% correct (${calib.correct}/${calib.total} trades)`
    : "";

  // Regime-level calibration breakdown (shows Claude where it over/under-performs)
  const regimeCalib = getRegimeCalibration(agentId, 50);
  const regimeLines = Object.entries(regimeCalib)
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([regime, r]) => `  ${regime}: ${(r.score * 100).toFixed(0)}% (${r.correct}/${r.total})`);
  const regimeBlock = regimeLines.length > 0
    ? `By regime:\n${regimeLines.join("\n")}`
    : "";

  return [
    `TRADE OUTCOMES (last ${outcomes.length} confirmed):`,
    ...lines,
    calibLine,
    regimeBlock,
  ].filter(Boolean).join("\n");
}
