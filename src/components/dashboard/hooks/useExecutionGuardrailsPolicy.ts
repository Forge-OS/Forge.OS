import { useMemo } from "react";
import {
  CALIBRATION_AUTO_APPROVE_DISABLE_MIN_SIZE_REDUCTION_PCT,
  CALIBRATION_AUTO_APPROVE_DISABLE_HEALTH_BELOW,
  CALIBRATION_BRIER_CRITICAL,
  CALIBRATION_BRIER_WARN,
  CALIBRATION_EV_CAL_ERROR_CRITICAL_PCT,
  CALIBRATION_EV_CAL_ERROR_WARN_PCT,
  CALIBRATION_GUARDRAILS_ENABLED,
  CALIBRATION_MIN_SAMPLES,
  CALIBRATION_REGIME_HIT_CRITICAL_PCT,
  CALIBRATION_REGIME_HIT_MIN_PCT,
  CALIBRATION_SIZE_MULTIPLIER_CRITICAL,
  CALIBRATION_SIZE_MULTIPLIER_DEGRADED,
  CALIBRATION_SIZE_MULTIPLIER_WARN,
  RECEIPT_CONSISTENCY_BLOCK_AUTO_APPROVE_ON_DEGRADED,
  RECEIPT_CONSISTENCY_DEGRADE_MIN_CHECKS,
  RECEIPT_CONSISTENCY_DEGRADE_MISMATCH_RATE_PCT,
} from "../../../constants";

type Params = {
  pnlAttribution: any;
  receiptConsistencyMetrics: any;
};

function pct(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function num(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function deriveExecutionGuardrailsPolicy(params: Params) {
  const { pnlAttribution, receiptConsistencyMetrics } = params;

  const checked = Math.max(0, num(receiptConsistencyMetrics?.checked));
  const mismatches = Math.max(0, num(receiptConsistencyMetrics?.mismatch));
  const mismatchRatePct = checked > 0 ? (mismatches / checked) * 100 : 0;
  const repeatedMismatchItems = Math.max(0, num(receiptConsistencyMetrics?.repeatedMismatchItems));
  const truthDegraded =
    checked >= RECEIPT_CONSISTENCY_DEGRADE_MIN_CHECKS &&
    mismatchRatePct >= RECEIPT_CONSISTENCY_DEGRADE_MISMATCH_RATE_PCT;
  const truthReasons: string[] = [];
  if (truthDegraded) {
    truthReasons.push(
      `receipt_mismatch_rate_${mismatchRatePct.toFixed(1)}pct>=${RECEIPT_CONSISTENCY_DEGRADE_MISMATCH_RATE_PCT.toFixed(1)}pct`
    );
  }
  const truthPolicy = {
    degraded: truthDegraded,
    checked,
    mismatches,
    mismatchRatePct: Number(mismatchRatePct.toFixed(2)),
    repeatedMismatchItems,
    autoApproveDisabled: truthDegraded && RECEIPT_CONSISTENCY_BLOCK_AUTO_APPROVE_ON_DEGRADED,
    reasons: truthReasons,
  };

  const brier = Math.max(0, num(pnlAttribution?.confidenceBrierScore));
  const evCalErrorPct = Math.max(0, num(pnlAttribution?.evCalibrationErrorPct));
  const regimeHitRatePct = Math.max(0, pct(pnlAttribution?.regimeHitRatePct));
  const regimeHitSamples = Math.max(0, num(pnlAttribution?.regimeHitSamples));

  let health = 1;
  const reasons: string[] = [];
  const samplesSufficient = regimeHitSamples >= CALIBRATION_MIN_SAMPLES;

  if (CALIBRATION_GUARDRAILS_ENABLED && samplesSufficient) {
    if (brier >= CALIBRATION_BRIER_CRITICAL) {
      health -= 0.4;
      reasons.push(`brier_${brier.toFixed(4)}>=${CALIBRATION_BRIER_CRITICAL}`);
    } else if (brier >= CALIBRATION_BRIER_WARN) {
      health -= 0.18;
      reasons.push(`brier_${brier.toFixed(4)}>=${CALIBRATION_BRIER_WARN}`);
    }

    if (evCalErrorPct >= CALIBRATION_EV_CAL_ERROR_CRITICAL_PCT) {
      health -= 0.35;
      reasons.push(`ev_cal_${evCalErrorPct.toFixed(3)}>=${CALIBRATION_EV_CAL_ERROR_CRITICAL_PCT}`);
    } else if (evCalErrorPct >= CALIBRATION_EV_CAL_ERROR_WARN_PCT) {
      health -= 0.15;
      reasons.push(`ev_cal_${evCalErrorPct.toFixed(3)}>=${CALIBRATION_EV_CAL_ERROR_WARN_PCT}`);
    }

    if (regimeHitRatePct <= CALIBRATION_REGIME_HIT_CRITICAL_PCT) {
      health -= 0.35;
      reasons.push(`regime_hit_${regimeHitRatePct.toFixed(1)}<=${CALIBRATION_REGIME_HIT_CRITICAL_PCT}`);
    } else if (regimeHitRatePct <= CALIBRATION_REGIME_HIT_MIN_PCT) {
      health -= 0.15;
      reasons.push(`regime_hit_${regimeHitRatePct.toFixed(1)}<=${CALIBRATION_REGIME_HIT_MIN_PCT}`);
    }
  } else if (CALIBRATION_GUARDRAILS_ENABLED) {
    reasons.push(`insufficient_calibration_samples_${regimeHitSamples}/${CALIBRATION_MIN_SAMPLES}`);
  }

  health = Math.max(0, Math.min(1, Number(health.toFixed(3))));
  let tier: "healthy" | "warn" | "degraded" | "critical" = "healthy";
  let sizeMultiplier = 1;
  if (CALIBRATION_GUARDRAILS_ENABLED && samplesSufficient) {
    if (health < 0.35) {
      tier = "critical";
      sizeMultiplier = CALIBRATION_SIZE_MULTIPLIER_CRITICAL;
    } else if (health < 0.6) {
      tier = "degraded";
      sizeMultiplier = CALIBRATION_SIZE_MULTIPLIER_DEGRADED;
    } else if (health < 0.85) {
      tier = "warn";
      sizeMultiplier = CALIBRATION_SIZE_MULTIPLIER_WARN;
    }
  }

  const normalizedSizeMultiplier = Number(Math.max(0, Math.min(1, sizeMultiplier)).toFixed(4));
  const sizeReductionPct = Number((1 - normalizedSizeMultiplier).toFixed(4));
  const sizingThrottleApplied = normalizedSizeMultiplier < 0.9999;
  const minSizeReductionRequired = Number(
    Math.max(0, Math.min(0.95, CALIBRATION_AUTO_APPROVE_DISABLE_MIN_SIZE_REDUCTION_PCT)).toFixed(4)
  );
  const canDisableAutoApproveForCalibration =
    sizingThrottleApplied && sizeReductionPct >= minSizeReductionRequired;
  const calibrationAutoApproveDisabled =
    CALIBRATION_GUARDRAILS_ENABLED &&
    samplesSufficient &&
    health <= CALIBRATION_AUTO_APPROVE_DISABLE_HEALTH_BELOW &&
    canDisableAutoApproveForCalibration;

  const calibrationPolicy = {
    enabled: CALIBRATION_GUARDRAILS_ENABLED,
    samplesSufficient,
    health,
    tier,
    sizeMultiplier: normalizedSizeMultiplier,
    sizeReductionPct,
    sizingThrottleApplied,
    minSizeReductionRequired,
    autoApproveDisabled: calibrationAutoApproveDisabled,
    autoApproveDisableDeferred:
      CALIBRATION_GUARDRAILS_ENABLED &&
      samplesSufficient &&
      health <= CALIBRATION_AUTO_APPROVE_DISABLE_HEALTH_BELOW &&
      !canDisableAutoApproveForCalibration,
    reasons,
    metrics: {
      brier,
      evCalErrorPct,
      regimeHitRatePct,
      regimeHitSamples,
    },
  };

  const combinedAutoApproveDisabled = calibrationPolicy.autoApproveDisabled || truthPolicy.autoApproveDisabled;
  const combinedReasons = [
    ...(calibrationPolicy.autoApproveDisabled ? ["calibration_guardrail"] : []),
    ...(truthPolicy.autoApproveDisabled ? ["truth_degraded"] : []),
  ];

  return {
    calibration: calibrationPolicy,
    truth: truthPolicy,
    effectiveSizingMultiplier: calibrationPolicy.sizeMultiplier,
    autoApproveDisabled: combinedAutoApproveDisabled,
    autoApproveDisableReasons: combinedReasons,
  };
}

export function useExecutionGuardrailsPolicy(params: Params) {
  return useMemo(
    () => deriveExecutionGuardrailsPolicy(params),
    [params.pnlAttribution, params.receiptConsistencyMetrics]
  );
}
