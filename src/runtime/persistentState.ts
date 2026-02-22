type PersistedDashboardState = {
  status?: "RUNNING" | "PAUSED" | "SUSPENDED";
  execMode?: "autonomous" | "manual" | "notify";
  liveExecutionArmed?: boolean;
  queue?: any[];
  log?: any[];
  decisions?: any[];
  marketHistory?: any[];
  attributionSummary?: any;
  nextAutoCycleAt?: number;
  updatedAt?: number;
  version?: number;
};

const STORAGE_PREFIX = "forgeos.dashboard.v1";
const MAX_QUEUE_ENTRIES = 160;
const MAX_LOG_ENTRIES = 320;
const MAX_DECISION_ENTRIES = 120;
const MAX_MARKET_HISTORY_ENTRIES = 240;

function normalizeScope(scope: string) {
  return String(scope || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "_")
    .slice(0, 180);
}

function storageKey(scope: string) {
  const normalized = normalizeScope(scope);
  return `${STORAGE_PREFIX}:${normalized || "default"}`;
}

function truncateList<T>(value: unknown, maxItems: number): T[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems);
}

function truncateTail<T>(value: unknown, maxItems: number): T[] {
  if (!Array.isArray(value)) return [];
  return value.slice(Math.max(0, value.length - maxItems));
}

function sanitize(state: PersistedDashboardState): PersistedDashboardState {
  const attributionSummary =
    state.attributionSummary && typeof state.attributionSummary === "object"
      ? {
          netPnlMode: String((state.attributionSummary as any).netPnlMode || "").slice(0, 24) || undefined,
          truthDegraded: Boolean((state.attributionSummary as any).truthDegraded),
          truthMismatchRatePct: Number.isFinite(Number((state.attributionSummary as any).truthMismatchRatePct))
            ? Number((state.attributionSummary as any).truthMismatchRatePct)
            : undefined,
          receiptCoveragePct: Number.isFinite(Number((state.attributionSummary as any).receiptCoveragePct))
            ? Number((state.attributionSummary as any).receiptCoveragePct)
            : undefined,
          realizedReceiptCoveragePct: Number.isFinite(Number((state.attributionSummary as any).realizedReceiptCoveragePct))
            ? Number((state.attributionSummary as any).realizedReceiptCoveragePct)
            : undefined,
          confidenceBrierScore: Number.isFinite(Number((state.attributionSummary as any).confidenceBrierScore))
            ? Number((state.attributionSummary as any).confidenceBrierScore)
            : undefined,
          evCalibrationErrorPct: Number.isFinite(Number((state.attributionSummary as any).evCalibrationErrorPct))
            ? Number((state.attributionSummary as any).evCalibrationErrorPct)
            : undefined,
          regimeHitRatePct: Number.isFinite(Number((state.attributionSummary as any).regimeHitRatePct))
            ? Number((state.attributionSummary as any).regimeHitRatePct)
            : undefined,
          regimeHitSamples: Number.isFinite(Number((state.attributionSummary as any).regimeHitSamples))
            ? Number((state.attributionSummary as any).regimeHitSamples)
            : undefined,
          realizedVsExpectedEdgeKas: Number.isFinite(Number((state.attributionSummary as any).realizedVsExpectedEdgeKas))
            ? Number((state.attributionSummary as any).realizedVsExpectedEdgeKas)
            : undefined,
          updatedAt: Date.now(),
        }
      : undefined;
  return {
    version: 1,
    updatedAt: Date.now(),
    status:
      state.status === "RUNNING" || state.status === "PAUSED" || state.status === "SUSPENDED"
        ? state.status
        : "RUNNING",
    execMode:
      state.execMode === "autonomous" || state.execMode === "manual" || state.execMode === "notify"
        ? state.execMode
        : "manual",
    liveExecutionArmed: Boolean(state.liveExecutionArmed),
    nextAutoCycleAt:
      Number.isFinite(state.nextAutoCycleAt) && Number(state.nextAutoCycleAt) > 0
        ? Number(state.nextAutoCycleAt)
        : undefined,
    queue: truncateList(state.queue, MAX_QUEUE_ENTRIES),
    log: truncateList(state.log, MAX_LOG_ENTRIES),
    decisions: truncateList(state.decisions, MAX_DECISION_ENTRIES),
    // marketHistory is append-ordered (oldest -> newest), so keep the tail to preserve the latest samples.
    marketHistory: truncateTail(state.marketHistory, MAX_MARKET_HISTORY_ENTRIES),
    attributionSummary,
  };
}

export function readPersistedDashboardState(scope: string): PersistedDashboardState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDashboardState;
    return sanitize(parsed);
  } catch {
    return null;
  }
}

export function writePersistedDashboardState(scope: string, state: PersistedDashboardState) {
  if (typeof window === "undefined") return;
  try {
    const payload = sanitize(state);
    window.localStorage.setItem(storageKey(scope), JSON.stringify(payload));
  } catch {
    // Ignore storage failures to avoid blocking runtime logic.
  }
}

export function clearPersistedDashboardState(scope: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(scope));
  } catch {
    // Ignore storage failures.
  }
}
