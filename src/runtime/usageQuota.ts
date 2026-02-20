type UsageRecord = {
  day: string;
  used: number;
};

export type UsageState = {
  day: string;
  used: number;
  limit: number;
  remaining: number;
  locked: boolean;
};

const STORAGE_KEY = "forgeos.usage.v1";

function getDayStamp(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function safeRead(): UsageRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UsageRecord;
    if (!parsed || typeof parsed.day !== "string" || !Number.isFinite(parsed.used)) return null;
    return { day: parsed.day, used: Math.max(0, Math.floor(parsed.used)) };
  } catch {
    return null;
  }
}

function safeWrite(record: UsageRecord) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Ignore storage write failures.
  }
}

function normalizeRecord(limit: number): UsageRecord {
  const today = getDayStamp();
  const existing = safeRead();
  if (!existing || existing.day !== today) {
    const reset = { day: today, used: 0 };
    safeWrite(reset);
    return reset;
  }
  const clamped = { day: today, used: Math.min(existing.used, Math.max(0, Math.floor(limit))) };
  safeWrite(clamped);
  return clamped;
}

function toState(record: UsageRecord, limit: number): UsageState {
  const safeLimit = Math.max(1, Math.floor(limit));
  const used = Math.min(record.used, safeLimit);
  const remaining = Math.max(0, safeLimit - used);
  return {
    day: record.day,
    used,
    limit: safeLimit,
    remaining,
    locked: remaining <= 0,
  };
}

export function getUsageState(limit: number): UsageState {
  return toState(normalizeRecord(limit), limit);
}

export function consumeUsageCycle(limit: number): UsageState {
  const record = normalizeRecord(limit);
  const safeLimit = Math.max(1, Math.floor(limit));
  if (record.used >= safeLimit) {
    return toState(record, safeLimit);
  }
  const next = { ...record, used: record.used + 1 };
  safeWrite(next);
  return toState(next, safeLimit);
}

