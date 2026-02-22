import { describe, expect, it } from "vitest";
import { computeSharedRiskBudgetAllocation } from "../../src/portfolio/allocator";

function makeDecision({
  action = "ACCUMULATE",
  regime = "TREND_UP",
  confidence = 0.86,
  risk = 0.35,
  dataQuality = 0.9,
}: any = {}) {
  return {
    action,
    confidence_score: confidence,
    risk_score: risk,
    quant_metrics: {
      regime,
      data_quality_score: dataQuality,
      sample_count: 48,
      edge_score: 0.42,
      risk_ceiling: 0.7,
    },
  };
}

function makeAttribution({
  brier = 0.08,
  evCalibrationErrorPct = 4,
  regimeHitRatePct = 72,
  regimeHitSamples = 32,
  truthDegraded = false,
  truthMismatchRatePct = 0,
  realizedReceiptCoveragePct = 90,
}: any = {}) {
  return {
    confidenceBrierScore: brier,
    evCalibrationErrorPct,
    regimeHitRatePct,
    regimeHitSamples,
    truthDegraded,
    truthMismatchRatePct,
    realizedReceiptCoveragePct,
  };
}

describe("portfolio allocator calibration routing", () => {
  it("routes more budget to strategy/regime-aligned and calibrated agents", () => {
    const summary = computeSharedRiskBudgetAllocation({
      walletKas: 100,
      agents: [
        {
          agentId: "trend-good",
          name: "Trend Good",
          targetAllocationPct: 50,
          riskBudgetWeight: 1,
          strategyTemplate: "trend",
          pendingKas: 0,
          lastDecision: makeDecision({ regime: "TREND_UP" }),
          attributionSummary: makeAttribution(),
        },
        {
          agentId: "range-bad",
          name: "Range Bad",
          targetAllocationPct: 50,
          riskBudgetWeight: 1,
          strategyTemplate: "mean_reversion",
          pendingKas: 0,
          lastDecision: makeDecision({ regime: "TREND_UP" }),
          attributionSummary: makeAttribution({
            brier: 0.32,
            evCalibrationErrorPct: 18,
            regimeHitRatePct: 38,
            regimeHitSamples: 40,
            truthDegraded: true,
            truthMismatchRatePct: 35,
            realizedReceiptCoveragePct: 40,
          }),
        },
      ],
      config: { totalBudgetPct: 0.8, reserveKas: 5, maxAgentAllocationPct: 0.8 },
    });

    const good = summary.rows.find((r) => r.agentId === "trend-good");
    const bad = summary.rows.find((r) => r.agentId === "range-bad");
    expect(good).toBeTruthy();
    expect(bad).toBeTruthy();
    expect(good!.budgetKas).toBeGreaterThan(bad!.budgetKas);
    expect(["healthy", "watch"]).toContain(good!.calibrationTier);
    expect(["degraded", "critical", "watch"]).toContain(bad!.calibrationTier);
    expect(good!.truthQualityScore).toBeGreaterThan(bad!.truthQualityScore);
    expect(good!.calibrationHealth).toBeGreaterThan(bad!.calibrationHealth);
  });
});
