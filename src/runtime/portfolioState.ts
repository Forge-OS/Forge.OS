export type PortfolioAgentOverride = {
  enabled?: boolean;
  targetAllocationPct?: number;
  riskWeight?: number;
};

export type PortfolioAllocatorConfig = {
  version: number;
  updatedAt: number;
  totalBudgetPct: number;
  reserveKas: number;
  maxAgentAllocationPct: number;
  rebalanceThresholdPct: number;
  agentOverrides: Record<string, PortfolioAgentOverride>;
};

const STORAGE_PREFIX = "forgeos.portfolio.v1";

const DEFAULT_CONFIG: PortfolioAllocatorConfig = {
  version: 1,
  updatedAt: 0,
  totalBudgetPct: 0.85,
  reserveKas: 5,
  maxAgentAllocationPct: 0.5,
  rebalanceThresholdPct: 0.08,
  agentOverrides: {},
};

function normalizeScope(scope: string) {
  return String(scope || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "_")
    .slice(0, 180);
}

function storageKey(scope: string) {
  return `${STORAGE_PREFIX}:${normalizeScope(scope) || "default"}`;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function finite(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeOverride(value: any): PortfolioAgentOverride {
  if (!value || typeof value !== "object") return {};
  const out: PortfolioAgentOverride = {};
  if (typeof value.enabled === "boolean") out.enabled = value.enabled;
  if (Number.isFinite(Number(value.targetAllocationPct))) {
    out.targetAllocationPct = clamp(Number(value.targetAllocationPct), 0, 100);
  }
  if (Number.isFinite(Number(value.riskWeight))) {
    out.riskWeight = clamp(Number(value.riskWeight), 0, 10);
  }
  return out;
}

function sanitizeConfig(raw: any): PortfolioAllocatorConfig {
  const agentOverrides: Record<string, PortfolioAgentOverride> = {};
  if (raw?.agentOverrides && typeof raw.agentOverrides === "object") {
    for (const [key, value] of Object.entries(raw.agentOverrides)) {
      const k = String(key || "").trim().toLowerCase().slice(0, 120);
      if (!k) continue;
      agentOverrides[k] = sanitizeOverride(value);
    }
  }

  return {
    version: 1,
    updatedAt: Date.now(),
    totalBudgetPct: clamp(finite(raw?.totalBudgetPct, DEFAULT_CONFIG.totalBudgetPct), 0.05, 1),
    reserveKas: clamp(finite(raw?.reserveKas, DEFAULT_CONFIG.reserveKas), 0, 1_000_000),
    maxAgentAllocationPct: clamp(
      finite(raw?.maxAgentAllocationPct, DEFAULT_CONFIG.maxAgentAllocationPct),
      0.05,
      1
    ),
    rebalanceThresholdPct: clamp(
      finite(raw?.rebalanceThresholdPct, DEFAULT_CONFIG.rebalanceThresholdPct),
      0.01,
      0.5
    ),
    agentOverrides,
  };
}

export function portfolioDefaultConfig() {
  return { ...DEFAULT_CONFIG, updatedAt: Date.now(), agentOverrides: {} };
}

export function readPortfolioAllocatorConfig(scope: string): PortfolioAllocatorConfig {
  if (typeof window === "undefined") return portfolioDefaultConfig();
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return portfolioDefaultConfig();
    return sanitizeConfig(JSON.parse(raw));
  } catch {
    return portfolioDefaultConfig();
  }
}

export function writePortfolioAllocatorConfig(scope: string, config: PortfolioAllocatorConfig) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(sanitizeConfig(config)));
  } catch {
    // Ignore storage failures.
  }
}
