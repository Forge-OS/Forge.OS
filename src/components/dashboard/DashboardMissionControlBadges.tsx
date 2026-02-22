import { C } from "../../tokens";
import { Badge } from "../ui";

type Props = {
  networkLabel: string;
  status: string;
  execMode: string;
  liveExecutionArmed: boolean;
  autoCycleCountdownLabel: string;
  lastDecisionSource: string;
  usage: { used: number; limit: number; locked?: boolean };
  executionGuardrails: any;
  receiptConsistencyMetrics: any;
};

function decisionSourceBadgeColor(source: string) {
  const normalized = String(source || "").toLowerCase();
  if (normalized === "hybrid-ai") return C.accent;
  if (normalized === "quant-core") return C.text;
  if (normalized === "fallback") return C.warn;
  return C.purple;
}

function defaultBadgeColor(networkLabel: string) {
  return String(networkLabel || "").toLowerCase().includes("mainnet") ? C.warn : C.ok;
}

export function DashboardMissionControlBadges(props: Props) {
  const {
    networkLabel,
    status,
    execMode,
    liveExecutionArmed,
    autoCycleCountdownLabel,
    lastDecisionSource,
    usage,
    executionGuardrails,
    receiptConsistencyMetrics,
  } = props;

  return (
    <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
      <Badge text={networkLabel.toUpperCase()} color={defaultBadgeColor(networkLabel)} />
      <Badge text={status} color={status==="RUNNING"?C.ok:C.warn} dot />
      <Badge text={execMode.toUpperCase()} color={C.accent} />
      <Badge text={liveExecutionArmed ? "EXEC ARMED" : "EXEC SAFE"} color={liveExecutionArmed ? C.ok : C.warn} dot />
      <Badge text={`AUTO ${autoCycleCountdownLabel}`} color={status==="RUNNING" ? C.ok : C.dim} />
      <Badge text={`SOURCE ${lastDecisionSource.toUpperCase()}`} color={decisionSourceBadgeColor(lastDecisionSource)} />
      <Badge text={`CYCLES ${usage.used}`} color={C.dim} />
      <Badge
        text={`CAL ${String(executionGuardrails?.calibration?.tier || "healthy").toUpperCase()} ${Number(executionGuardrails?.calibration?.health || 1).toFixed(2)}`}
        color={
          executionGuardrails?.calibration?.tier === "critical"
            ? C.danger
            : executionGuardrails?.calibration?.tier === "degraded" || executionGuardrails?.calibration?.tier === "warn"
              ? C.warn
              : C.ok
        }
      />
      <Badge
        text={
          executionGuardrails?.truth?.degraded
            ? `TRUTH DEGRADED ${Number(executionGuardrails?.truth?.mismatchRatePct || 0).toFixed(1)}%`
            : `TRUTH OK ${Number(receiptConsistencyMetrics?.mismatchRatePct || 0).toFixed(1)}%`
        }
        color={executionGuardrails?.truth?.degraded ? C.danger : C.ok}
      />
    </div>
  );
}
