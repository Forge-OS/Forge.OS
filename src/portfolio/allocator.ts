const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const n = (v: any, fallback = 0) => {
  const out = Number(v);
  return Number.isFinite(out) ? out : fallback;
};

export type PortfolioAgentInput = {
  agentId: string;
  name: string;
  enabled?: boolean;
  capitalLimitKas?: number;
  targetAllocationPct?: number;
  riskBudgetWeight?: number;
  pendingKas?: number;
  lastDecision?: any;
};

export type PortfolioAllocatorConfigLike = {
  totalBudgetPct?: number;
  reserveKas?: number;
  maxAgentAllocationPct?: number;
  rebalanceThresholdPct?: number;
};

export type PortfolioAllocationRow = {
  agentId: string;
  name: string;
  enabled: boolean;
  targetPct: number;
  riskWeight: number;
  score: number;
  budgetPct: number;
  budgetKas: number;
  cycleCapKas: number;
  queuePressurePct: number;
  regime: string;
  action: string;
  confidence: number;
  risk: number;
  dataQuality: number;
  rebalanceDeltaKas: number;
  notes: string[];
};

export type PortfolioAllocationSummary = {
  walletKas: number;
  reserveKas: number;
  allocatableKas: number;
  targetBudgetKas: number;
  allocatedKas: number;
  utilizationPct: number;
  concentrationPct: number;
  riskWeightedExposurePct: number;
  rows: PortfolioAllocationRow[];
};

function actionMultiplier(action: string) {
  const a = String(action || "HOLD").toUpperCase();
  if (a === "ACCUMULATE") return 1;
  if (a === "REBALANCE") return 0.75;
  if (a === "REDUCE") return 0.35;
  return 0.5;
}

function regimeMultiplier(regime: string) {
  const r = String(regime || "NEUTRAL").toUpperCase();
  if (r === "RISK_OFF") return 0.2;
  if (r === "RANGE_VOL") return 0.6;
  if (r === "TREND_UP" || r === "FLOW_ACCUMULATION") return 1.1;
  return 0.85;
}

function buildNotes(params: {
  enabled: boolean;
  action: string;
  regime: string;
  queuePressurePct: number;
  risk: number;
  confidence: number;
  dataQuality: number;
}) {
  const notes: string[] = [];
  if (!params.enabled) notes.push("disabled in allocator");
  if (params.regime === "RISK_OFF") notes.push("risk-off regime throttle");
  if (params.queuePressurePct > 20) notes.push("queue pressure high");
  if (params.risk > 0.7) notes.push("elevated risk score");
  if (params.confidence < 0.7) notes.push("low confidence");
  if (params.dataQuality < 0.5) notes.push("limited data quality");
  if (params.action === "REDUCE") notes.push("reduce signal active");
  if (!notes.length) notes.push("within shared budget guardrails");
  return notes.slice(0, 4);
}

export function computeSharedRiskBudgetAllocation(params: {
  walletKas: number;
  agents: PortfolioAgentInput[];
  config?: PortfolioAllocatorConfigLike;
}): PortfolioAllocationSummary {
  const walletKas = Math.max(0, n(params.walletKas, 0));
  const reserveKas = Math.max(0, n(params.config?.reserveKas, 5));
  const allocatableKas = Math.max(0, walletKas - reserveKas);
  const totalBudgetPct = clamp(n(params.config?.totalBudgetPct, 0.85), 0.05, 1);
  const maxAgentAllocationPct = clamp(n(params.config?.maxAgentAllocationPct, 0.5), 0.05, 1);
  const rebalanceThresholdPct = clamp(n(params.config?.rebalanceThresholdPct, 0.08), 0.01, 0.5);
  const targetBudgetKas = allocatableKas * totalBudgetPct;
  const agents = Array.isArray(params.agents) ? params.agents : [];

  const enabledRows = agents.map((agent) => {
    const dec = agent?.lastDecision || {};
    const qm = dec?.quant_metrics || {};
    const risk = clamp(n(dec?.risk_score, 0.75), 0, 1);
    const confidence = clamp(n(dec?.confidence_score, 0.55), 0, 1);
    const dataQuality = clamp(n(qm?.data_quality_score, 0.45), 0, 1);
    const action = String(dec?.action || "HOLD").toUpperCase();
    const regime = String(qm?.regime || "NEUTRAL").toUpperCase();
    const riskCeiling = Math.max(0.1, n(qm?.risk_ceiling, 0.65));
    const riskHeadroom = clamp((riskCeiling - risk) / riskCeiling, -1, 1);
    const pendingKas = Math.max(0, n(agent?.pendingKas, 0));
    const capitalLimitKas = Math.max(0, n(agent?.capitalLimitKas, 0));
    const targetPct = clamp(n(agent?.targetAllocationPct, 0), 0, 100);
    const riskWeight = clamp(n(agent?.riskBudgetWeight, 1), 0, 10);
    const enabled = agent?.enabled !== false;
    const queuePressurePct = capitalLimitKas > 0 ? clamp((pendingKas / capitalLimitKas) * 100, 0, 500) : 0;

    const baseTargetWeight = targetPct > 0 ? targetPct / 100 : 0;
    const signalStrength = clamp(0.25 + confidence * 0.45 + Math.max(0, riskHeadroom) * 0.2 + dataQuality * 0.1, 0.05, 1.1);
    const queuePenalty = clamp(1 - queuePressurePct / 160, 0.2, 1);
    const score = enabled
      ? Math.max(
          0,
          (baseTargetWeight > 0 ? baseTargetWeight : riskWeight * 0.2) *
            signalStrength *
            actionMultiplier(action) *
            regimeMultiplier(regime) *
            queuePenalty
        )
      : 0;

    return {
      agentId: String(agent?.agentId || agent?.name || "agent"),
      name: String(agent?.name || agent?.agentId || "Agent"),
      enabled,
      targetPct,
      riskWeight,
      capitalLimitKas,
      pendingKas,
      action,
      regime,
      confidence,
      risk,
      dataQuality,
      score,
      queuePressurePct,
    };
  });

  const totalScore = enabledRows.reduce((sum, row) => sum + row.score, 0);
  const fallbackWeightSum = enabledRows.reduce((sum, row) => sum + (row.enabled ? Math.max(0.1, row.riskWeight) : 0), 0);

  const rows: PortfolioAllocationRow[] = enabledRows.map((row) => {
    const normalizedWeight =
      totalScore > 0
        ? row.score / totalScore
        : (row.enabled ? Math.max(0.1, row.riskWeight) / Math.max(0.1, fallbackWeightSum) : 0);

    const rawBudgetKas = targetBudgetKas * normalizedWeight;
    const budgetKas = Math.min(rawBudgetKas, targetBudgetKas * maxAgentAllocationPct);
    const budgetPct = targetBudgetKas > 0 ? clamp((budgetKas / targetBudgetKas) * 100, 0, 100) : 0;
    const cycleCapKas = Math.min(
      budgetKas,
      row.capitalLimitKas > 0 ? row.capitalLimitKas : budgetKas,
      Math.max(0, targetBudgetKas * maxAgentAllocationPct)
    );
    const rebalanceDeltaKas = budgetKas - row.pendingKas;

    return {
      agentId: row.agentId,
      name: row.name,
      enabled: row.enabled,
      targetPct: row.targetPct,
      riskWeight: row.riskWeight,
      score: Number(row.score.toFixed(6)),
      budgetPct: Number(budgetPct.toFixed(2)),
      budgetKas: Number(budgetKas.toFixed(6)),
      cycleCapKas: Number(Math.max(0, cycleCapKas).toFixed(6)),
      queuePressurePct: Number(row.queuePressurePct.toFixed(2)),
      regime: row.regime,
      action: row.action,
      confidence: Number(row.confidence.toFixed(4)),
      risk: Number(row.risk.toFixed(4)),
      dataQuality: Number(row.dataQuality.toFixed(4)),
      rebalanceDeltaKas:
        Math.abs(rebalanceDeltaKas) >= targetBudgetKas * rebalanceThresholdPct
          ? Number(rebalanceDeltaKas.toFixed(6))
          : 0,
      notes: buildNotes({
        enabled: row.enabled,
        action: row.action,
        regime: row.regime,
        queuePressurePct: row.queuePressurePct,
        risk: row.risk,
        confidence: row.confidence,
        dataQuality: row.dataQuality,
      }),
    };
  });

  const allocatedKas = rows.reduce((sum, row) => sum + row.budgetKas, 0);
  const concentrationPct = rows.length
    ? Math.max(...rows.map((row) => (targetBudgetKas > 0 ? (row.budgetKas / targetBudgetKas) * 100 : 0)))
    : 0;
  const riskWeightedExposurePct = rows.length
    ? rows.reduce((sum, row) => sum + row.budgetPct * row.risk, 0) / 100
    : 0;

  rows.sort((a, b) => b.budgetKas - a.budgetKas || a.name.localeCompare(b.name));

  return {
    walletKas: Number(walletKas.toFixed(6)),
    reserveKas: Number(reserveKas.toFixed(6)),
    allocatableKas: Number(allocatableKas.toFixed(6)),
    targetBudgetKas: Number(targetBudgetKas.toFixed(6)),
    allocatedKas: Number(allocatedKas.toFixed(6)),
    utilizationPct: Number((targetBudgetKas > 0 ? (allocatedKas / targetBudgetKas) * 100 : 0).toFixed(2)),
    concentrationPct: Number(concentrationPct.toFixed(2)),
    riskWeightedExposurePct: Number(riskWeightedExposurePct.toFixed(4)),
    rows,
  };
}
