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

const STORAGE_KEY_PREFIX = "forgeos.usage.v2";
const LEGACY_STORAGE_KEY = "forgeos.usage.v1";

function normalizeScope(scope?: string) {
  const raw = String(scope || "global").trim().toLowerCase();
  return raw.replace(/[^a-z0-9:_-]/g, "_").slice(0, 128) || "global";
}

function storageKey(scope?: string) {
  return `${STORAGE_KEY_PREFIX}:${normalizeScope(scope)}`;
}

function getDayStamp(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function safeRead(scope?: string): UsageRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UsageRecord;
    if (!parsed || typeof parsed.day !== "string" || !Number.isFinite(parsed.used)) return null;
    return { day: parsed.day, used: Math.max(0, Math.floor(parsed.used)) };
  } catch {
    return null;
  }
}

function safeWrite(record: UsageRecord, scope?: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(record));
  } catch {
    // Ignore storage write failures.
  }
}

function readLegacyRecordIfPresent(): UsageRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UsageRecord;
    if (!parsed || typeof parsed.day !== "string" || !Number.isFinite(parsed.used)) return null;
    return { day: parsed.day, used: Math.max(0, Math.floor(parsed.used)) };
  } catch {
    return null;
  }
}

function normalizeRecord(limit: number, scope?: string): UsageRecord {
  const today = getDayStamp();
  const existing = safeRead(scope) || (scope ? null : readLegacyRecordIfPresent());
  if (!existing || existing.day !== today) {
    const reset = { day: today, used: 0 };
    safeWrite(reset, scope);
    return reset;
  }
  const clamped = { day: today, used: Math.min(existing.used, Math.max(0, Math.floor(limit))) };
  if (clamped.day !== existing.day || clamped.used !== existing.used) {
    safeWrite(clamped, scope);
  }
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

export function getScopedUsageState(limit: number, scope?: string): UsageState {
  return toState(normalizeRecord(limit, scope), limit);
}

export function consumeUsageCycle(limit: number, scope?: string): UsageState {
  const record = normalizeRecord(limit, scope);
  const safeLimit = Math.max(1, Math.floor(limit));
  if (record.used >= safeLimit) {
    return toState(record, safeLimit);
  }
  const next = { ...record, used: record.used + 1 };
  safeWrite(next, scope);
  return toState(next, safeLimit);
}

export function getUsageState(limit: number, scope?: string): UsageState {
  return getScopedUsageState(limit, scope);
}
