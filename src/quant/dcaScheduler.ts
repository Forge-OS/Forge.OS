/**
 * DCA Scheduler — time-based recurring buy/sell orders for KAS.
 *
 * Schedules are persisted to localStorage under DCA_SCHEDULES_KEY.
 * Execution check runs inside the Dashboard's runCycle via checkDcaSchedules().
 * Actual execution is delegated to the caller via the onExecute callback.
 *
 * Supported frequencies:
 *   hourly   — every N hours (intervalHours)
 *   daily    — every day at hour:minute UTC
 *   weekly   — every week on dayOfWeek at hour:minute UTC
 *   biweekly — every two weeks on dayOfWeek at hour:minute UTC
 *   monthly  — every month on dayOfMonth at hour:minute UTC (capped at 28)
 */

export type DcaFrequency = "hourly" | "daily" | "weekly" | "biweekly" | "monthly";

export interface DcaSchedule {
  id: string;
  enabled: boolean;
  frequency: DcaFrequency;
  /** Interval for hourly frequency (1–24). */
  intervalHours?: number;
  /** 0 = Sun … 6 = Sat (weekly/biweekly). */
  dayOfWeek?: number;
  /** 1–28 (monthly). */
  dayOfMonth?: number;
  /** UTC hour (0–23). */
  hour: number;
  /** UTC minute (0–59). */
  minute: number;
  /** KAS amount to buy per execution. */
  kasAmount: number;
  /** Stablecoin ticker used to pay for purchases. */
  stableTick: string;
  /** Optional hard limit: stop after maxExecutions. 0 = unlimited. */
  maxExecutions: number;
  createdAt: number;
  lastExecutedAt: number;   // 0 = never
  nextExecutionAt: number;
  executionCount: number;
  note?: string;
}

export interface BuildDcaScheduleParams {
  frequency: DcaFrequency;
  intervalHours?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  hour?: number;
  minute?: number;
  kasAmount: number;
  stableTick?: string;
  maxExecutions?: number;
  note?: string;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const DCA_SCHEDULES_KEY = "forgeos.dca.schedules.v1";

function loadSchedules(): DcaSchedule[] {
  try {
    const raw = localStorage.getItem(DCA_SCHEDULES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSchedules(schedules: DcaSchedule[]): void {
  try {
    localStorage.setItem(DCA_SCHEDULES_KEY, JSON.stringify(schedules));
  } catch {
    // storage full — silent fail
  }
}

// ── Next-execution computation ────────────────────────────────────────────────

/**
 * Returns the next UTC timestamp (ms) for a schedule, starting from `afterMs`.
 * Used both on creation and after each execution.
 */
export function nextExecutionTime(
  params: Pick<DcaSchedule, "frequency" | "intervalHours" | "dayOfWeek" | "dayOfMonth" | "hour" | "minute">,
  afterMs = Date.now(),
): number {
  const d = new Date(afterMs);
  const h = params.hour ?? 0;
  const m = params.minute ?? 0;

  switch (params.frequency) {
    case "hourly": {
      const iv = Math.max(1, Math.min(24, params.intervalHours ?? 1));
      // Next occurrence at the same minute, N hours from now
      const next = new Date(afterMs);
      next.setUTCMinutes(m, 0, 0);
      next.setUTCHours(next.getUTCHours() + iv);
      return next.getTime();
    }
    case "daily": {
      const candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0);
      return candidate > afterMs ? candidate : candidate + 86_400_000;
    }
    case "weekly":
    case "biweekly": {
      const target = params.dayOfWeek ?? 1; // Mon
      const current = d.getUTCDay();
      let daysAhead = (target - current + 7) % 7;
      if (daysAhead === 0) daysAhead = 7; // always go to next week if same day
      const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysAhead, h, m, 0);
      return params.frequency === "biweekly" ? base + 7 * 86_400_000 : base;
    }
    case "monthly": {
      const dom = Math.max(1, Math.min(28, params.dayOfMonth ?? 1));
      let year = d.getUTCFullYear();
      let month = d.getUTCMonth();
      const candidate = Date.UTC(year, month, dom, h, m, 0);
      if (candidate > afterMs) return candidate;
      month++;
      if (month > 11) { month = 0; year++; }
      return Date.UTC(year, month, dom, h, m, 0);
    }
  }
}

// ── Core API ──────────────────────────────────────────────────────────────────

/** Creates and persists a new DCA schedule. Returns null if params invalid. */
export function buildDcaSchedule(params: BuildDcaScheduleParams): DcaSchedule | null {
  if (!Number.isFinite(params.kasAmount) || params.kasAmount <= 0) return null;

  const now = Date.now();
  const schedule: DcaSchedule = {
    id: `dca_${crypto.randomUUID()}`,
    enabled: true,
    frequency: params.frequency,
    intervalHours: params.intervalHours,
    dayOfWeek: params.dayOfWeek,
    dayOfMonth: params.dayOfMonth,
    hour: Math.max(0, Math.min(23, params.hour ?? 9)),
    minute: Math.max(0, Math.min(59, params.minute ?? 0)),
    kasAmount: params.kasAmount,
    stableTick: String(params.stableTick ?? "USDC").toUpperCase(),
    maxExecutions: Math.max(0, params.maxExecutions ?? 0),
    createdAt: now,
    lastExecutedAt: 0,
    nextExecutionAt: 0, // filled below
    executionCount: 0,
    note: params.note,
  };
  schedule.nextExecutionAt = nextExecutionTime(schedule, now);

  const schedules = loadSchedules();
  schedules.push(schedule);
  saveSchedules(schedules);
  return schedule;
}

/** Enable / disable a schedule without deleting it. */
export function setDcaEnabled(id: string, enabled: boolean): boolean {
  const schedules = loadSchedules();
  const idx = schedules.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  schedules[idx] = { ...schedules[idx], enabled };
  saveSchedules(schedules);
  return true;
}

/** Permanently removes a schedule. */
export function deleteDcaSchedule(id: string): boolean {
  const schedules = loadSchedules();
  const filtered = schedules.filter((s) => s.id !== id);
  if (filtered.length === schedules.length) return false;
  saveSchedules(filtered);
  return true;
}

/** Returns all stored schedules. */
export function getAllSchedules(): DcaSchedule[] {
  return loadSchedules();
}

/** Returns enabled schedules only. */
export function getActiveSchedules(): DcaSchedule[] {
  return loadSchedules().filter((s) => s.enabled);
}

/**
 * Advances a schedule after a successful execution:
 * - increments executionCount
 * - sets lastExecutedAt
 * - computes next nextExecutionAt
 * - disables if maxExecutions reached
 */
export function markDcaExecuted(id: string, now = Date.now()): DcaSchedule | null {
  const schedules = loadSchedules();
  const idx = schedules.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const s = schedules[idx];
  const newCount = s.executionCount + 1;
  const reachedMax = s.maxExecutions > 0 && newCount >= s.maxExecutions;
  const updated: DcaSchedule = {
    ...s,
    executionCount: newCount,
    lastExecutedAt: now,
    nextExecutionAt: reachedMax ? 0 : nextExecutionTime(s, now),
    enabled: reachedMax ? false : s.enabled,
  };
  schedules[idx] = updated;
  saveSchedules(schedules);
  return updated;
}

/**
 * Checks all enabled schedules against nowMs.
 * Calls onExecute(schedule) for each due schedule.
 * Does NOT advance the schedule — caller must call markDcaExecuted() on success.
 *
 * Returns the list of schedules that are due.
 */
export function checkDcaSchedules(
  onExecute: (schedule: DcaSchedule) => void,
  nowMs = Date.now(),
): DcaSchedule[] {
  const due: DcaSchedule[] = [];
  for (const s of getActiveSchedules()) {
    if (s.nextExecutionAt > 0 && nowMs >= s.nextExecutionAt) {
      due.push(s);
      onExecute(s);
    }
  }
  return due;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Human-readable schedule label for UI display. */
export function describeDcaSchedule(s: DcaSchedule): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const timeStr = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")} UTC`;
  switch (s.frequency) {
    case "hourly":    return `Every ${s.intervalHours ?? 1}h · ${s.kasAmount} KAS`;
    case "daily":     return `Daily @ ${timeStr} · ${s.kasAmount} KAS`;
    case "weekly":    return `Weekly ${days[s.dayOfWeek ?? 1]} @ ${timeStr} · ${s.kasAmount} KAS`;
    case "biweekly":  return `Bi-weekly ${days[s.dayOfWeek ?? 1]} @ ${timeStr} · ${s.kasAmount} KAS`;
    case "monthly":   return `Monthly on day ${s.dayOfMonth ?? 1} @ ${timeStr} · ${s.kasAmount} KAS`;
  }
}

/** Short countdown string to next execution. */
export function formatCountdown(nextAt: number, now = Date.now()): string {
  const ms = Math.max(0, nextAt - now);
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
