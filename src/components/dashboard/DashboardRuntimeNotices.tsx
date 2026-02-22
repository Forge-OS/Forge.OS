import { C, mono } from "../../tokens";
import { Badge, Btn } from "../ui";

type Props = {
  kasDataError?: string | null;
  refreshKasData: () => void;
  kasDataLoading: boolean;
  liveExecutionArmed: boolean;
  liveExecutionReady: boolean;
  executionGuardrails: any;
  pendingCount: number;
  isMobile: boolean;
  setTab: (tab: string) => void;
};

export function DashboardRuntimeNotices(props: Props) {
  const {
    kasDataError,
    refreshKasData,
    kasDataLoading,
    liveExecutionArmed,
    liveExecutionReady,
    executionGuardrails,
    pendingCount,
    isMobile,
    setTab,
  } = props;

  return (
    <>
      {!!kasDataError && (
        <div style={{background:C.dLow,border:`1px solid ${C.danger}40`,borderRadius:6,padding:"11px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
          <span style={{fontSize:12,color:C.danger,...mono}}>Kaspa live feed error (poll fallback): {kasDataError}</span>
          <Btn onClick={refreshKasData} disabled={kasDataLoading} size="sm" variant="ghost">{kasDataLoading?"RECONNECTING...":"RECONNECT FEED"}</Btn>
        </div>
      )}

      {liveExecutionArmed && !liveExecutionReady && (
        <div style={{background:C.wLow, border:`1px solid ${C.warn}40`, borderRadius:6, padding:"11px 16px", marginBottom:14}}>
          <span style={{fontSize:12, color:C.warn, ...mono}}>
            Live execution is armed but not ready. Require DAG live feed and a real wallet provider session (Kasware, Kaspium, Kastle, Ghost, Tangem bridge, or OneKey bridge).
          </span>
        </div>
      )}

      {executionGuardrails?.truth?.degraded && (
        <div style={{background:C.dLow, border:`1px solid ${C.danger}40`, borderRadius:6, padding:"11px 16px", marginBottom:14, display:"flex", justifyContent:"space-between", gap:10, flexWrap:"wrap"}}>
          <span style={{fontSize:12, color:C.danger, ...mono}}>
            Truth degraded: backend vs chain receipt mismatch rate {executionGuardrails.truth.mismatchRatePct}% ({executionGuardrails.truth.mismatches}/{executionGuardrails.truth.checked} checks).
            Realized PnL is downgraded to hybrid while mismatch rate exceeds policy.
          </span>
          {executionGuardrails.truth.autoApproveDisabled && (
            <Badge text="AUTO-APPROVE BLOCKED (TRUTH)" color={C.danger} />
          )}
        </div>
      )}

      {executionGuardrails?.calibration?.enabled &&
        executionGuardrails?.calibration?.samplesSufficient &&
        executionGuardrails?.calibration?.tier !== "healthy" && (
          <div style={{background:C.wLow, border:`1px solid ${executionGuardrails.calibration.tier === "critical" ? C.danger : C.warn}40`, borderRadius:6, padding:"11px 16px", marginBottom:14, display:"flex", justifyContent:"space-between", gap:10, flexWrap:"wrap"}}>
            <span style={{fontSize:12, color:executionGuardrails.calibration.tier === "critical" ? C.danger : C.warn, ...mono}}>
              Calibration guardrail {String(executionGuardrails.calibration.tier).toUpperCase()} · health {executionGuardrails.calibration.health.toFixed(3)} · size multiplier {executionGuardrails.calibration.sizeMultiplier.toFixed(2)}
              {executionGuardrails.calibration.autoApproveDisabled ? " · auto-approve disabled" : ""}
              {executionGuardrails.calibration.autoApproveDisableDeferred ? " · size-first throttle (auto-approve still enabled)" : ""}
            </span>
            <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
              <Badge text={`BRIER ${Number(executionGuardrails.calibration.metrics.brier || 0).toFixed(4)}`} color={C.dim} />
              <Badge text={`EV CAL ${Number(executionGuardrails.calibration.metrics.evCalErrorPct || 0).toFixed(2)}%`} color={C.dim} />
              <Badge text={`REGIME ${Number(executionGuardrails.calibration.metrics.regimeHitRatePct || 0).toFixed(1)}%`} color={C.dim} />
            </div>
          </div>
      )}

      {pendingCount>0 && (
        <div style={{background:C.wLow, border:`1px solid ${C.warn}40`, borderRadius:6, padding:"11px 16px", marginBottom:14, display:"flex", alignItems:isMobile ? "flex-start" : "center", justifyContent:"space-between", flexDirection:isMobile ? "column" : "row", gap:isMobile ? 8 : 0}}>
          <span style={{fontSize:12, color:C.warn, ...mono}}>⚠ {pendingCount} transaction{pendingCount>1?"s":""} awaiting wallet signature</span>
          <Btn onClick={()=>setTab("queue")} size="sm" variant="warn">VIEW QUEUE</Btn>
        </div>
      )}
    </>
  );
}
