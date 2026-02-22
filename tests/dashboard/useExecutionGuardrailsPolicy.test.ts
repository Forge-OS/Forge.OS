import { describe, expect, it } from "vitest";
import { deriveExecutionGuardrailsPolicy } from "../../src/components/dashboard/hooks/useExecutionGuardrailsPolicy";

describe("execution guardrails policy", () => {
  it("only disables calibration auto-approve when sizing throttle is active", () => {
    const policy = deriveExecutionGuardrailsPolicy({
      pnlAttribution: {
        confidenceBrierScore: 0.5,
        evCalibrationErrorPct: 10,
        regimeHitRatePct: 30,
        regimeHitSamples: 64,
      },
      receiptConsistencyMetrics: { checked: 0, mismatch: 0, repeatedMismatchItems: 0 },
    });

    expect(policy.calibration.samplesSufficient).toBe(true);
    expect(policy.calibration.sizeMultiplier).toBeLessThan(1);
    expect(policy.calibration.sizingThrottleApplied).toBe(true);
    expect(policy.calibration.sizeReductionPct).toBeGreaterThanOrEqual(policy.calibration.minSizeReductionRequired);
    expect(policy.calibration.autoApproveDisabled).toBe(true);
  });

  it("blocks auto-approve on truth degradation even when calibration is healthy", () => {
    const policy = deriveExecutionGuardrailsPolicy({
      pnlAttribution: {
        confidenceBrierScore: 0.08,
        evCalibrationErrorPct: 0.8,
        regimeHitRatePct: 72,
        regimeHitSamples: 48,
      },
      receiptConsistencyMetrics: { checked: 12, mismatch: 5, repeatedMismatchItems: 3 },
    });

    expect(policy.calibration.tier).toBe("healthy");
    expect(policy.calibration.autoApproveDisabled).toBe(false);
    expect(policy.truth.degraded).toBe(true);
    expect(policy.truth.autoApproveDisabled).toBe(true);
    expect(policy.autoApproveDisabled).toBe(true);
    expect(policy.autoApproveDisableReasons).toContain("truth_degraded");
  });
});

