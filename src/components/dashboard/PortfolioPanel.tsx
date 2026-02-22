import { C, mono } from "../../tokens";
import { Badge, Btn, Card, Inp, Label } from "../ui";

function pct(v: number, digits = 1) {
  return `${Number(v || 0).toFixed(digits)}%`;
}

export function PortfolioPanel({
  agents,
  activeAgentId,
  walletKas,
  summary,
  config,
  onConfigPatch,
  onAgentOverridePatch,
  onSelectAgent,
  onRefresh,
}: any) {
  const rows = Array.isArray(summary?.rows) ? summary.rows : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 700, ...mono }}>Multi-Agent Portfolio Control</div>
          <div style={{ fontSize: 11, color: C.dim }}>
            Shared risk budget allocator across agents using quant signals, queue pressure, and configured weights.
          </div>
        </div>
        <Btn onClick={onRefresh} size="sm" variant="ghost">REFRESH ALLOCATOR</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 12 }}>
        {[
          ["Wallet KAS", `${Number(walletKas || 0).toFixed(4)}`, C.accent],
          ["Allocatable", `${Number(summary?.allocatableKas || 0).toFixed(4)} KAS`, C.text],
          ["Target Budget", `${Number(summary?.targetBudgetKas || 0).toFixed(4)} KAS`, C.ok],
          ["Allocated", `${Number(summary?.allocatedKas || 0).toFixed(4)} KAS`, C.text],
          ["Utilization", pct(summary?.utilizationPct, 1), (summary?.utilizationPct || 0) >= 95 ? C.ok : C.warn],
          ["Concentration", pct(summary?.concentrationPct, 1), (summary?.concentrationPct || 0) > 55 ? C.warn : C.ok],
          ["RW Exposure", pct((Number(summary?.riskWeightedExposurePct || 0) * 100), 1), C.warn],
          ["Agents", String(Array.isArray(agents) ? agents.length : 0), C.dim],
        ].map(([label, value, color]) => (
          <Card key={String(label)} p={12}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 13, color: color as any, fontWeight: 700, ...mono }}>{value}</div>
          </Card>
        ))}
      </div>

      <Card p={14} style={{ marginBottom: 12 }}>
        <Label>Shared Budget Settings</Label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <Inp
            label="Total Budget %"
            value={String(Math.round(Number(config?.totalBudgetPct || 0) * 10000) / 100)}
            onChange={(v: string) => onConfigPatch({ totalBudgetPct: Math.max(5, Math.min(100, Number(v) || 0)) / 100 })}
            type="number"
            suffix="%"
            hint="Share of wallet balance allocator can assign."
          />
          <Inp
            label="Reserve"
            value={String(config?.reserveKas ?? 0)}
            onChange={(v: string) => onConfigPatch({ reserveKas: Math.max(0, Number(v) || 0) })}
            type="number"
            suffix="KAS"
            hint="Hard reserve before shared budget allocation."
          />
          <Inp
            label="Max Agent Share %"
            value={String(Math.round(Number(config?.maxAgentAllocationPct || 0) * 10000) / 100)}
            onChange={(v: string) => onConfigPatch({ maxAgentAllocationPct: Math.max(5, Math.min(100, Number(v) || 0)) / 100 })}
            type="number"
            suffix="%"
            hint="Concentration cap per agent in shared budget."
          />
          <Inp
            label="Rebalance Threshold %"
            value={String(Math.round(Number(config?.rebalanceThresholdPct || 0) * 10000) / 100)}
            onChange={(v: string) => onConfigPatch({ rebalanceThresholdPct: Math.max(1, Math.min(50, Number(v) || 0)) / 100 })}
            type="number"
            suffix="%"
            hint="Only surface rebalance deltas above this threshold."
          />
        </div>
      </Card>

      <Card p={0}>
        <div style={{ padding: "11px 16px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 11, color: C.dim, ...mono }}>PORTFOLIO AGENTS — SHARED RISK BUDGET + CAPITAL ALLOCATOR</span>
        </div>
        {rows.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: C.dim }}>No agents available for allocation.</div>
        )}
        {rows.map((row: any) => {
          const isActive = row.agentId === activeAgentId;
          const riskColor = row.risk <= 0.4 ? C.ok : row.risk <= 0.7 ? C.warn : C.danger;
          const actionColor = row.action === "ACCUMULATE" ? C.ok : row.action === "REDUCE" ? C.danger : C.warn;
          return (
            <div key={row.agentId} style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => onSelectAgent?.(row.agentId)}
                    style={{
                      background: isActive ? C.aLow : "transparent",
                      border: `1px solid ${isActive ? C.accent : C.border}`,
                      color: isActive ? C.accent : C.text,
                      borderRadius: 6,
                      padding: "4px 8px",
                      cursor: "pointer",
                      fontSize: 11,
                      ...mono,
                    }}
                  >
                    {row.name}
                  </button>
                  <Badge text={row.enabled ? "ENABLED" : "DISABLED"} color={row.enabled ? C.ok : C.dim} />
                  <Badge text={`TPL ${String(row.strategyTemplate || "custom").toUpperCase()}`} color={C.dim} />
                  <Badge text={row.action} color={actionColor} />
                  <Badge text={String(row.regime).replace(/_/g, " ")} color={C.accent} />
                  <Badge text={`RISK ${row.risk}`} color={riskColor} />
                  <Badge
                    text={`CAL ${String(row.calibrationTier || "healthy").toUpperCase()} ${Number(row.calibrationHealth || 0).toFixed(2)}`}
                    color={
                      row.calibrationTier === "critical"
                        ? C.danger
                        : row.calibrationTier === "degraded" || row.calibrationTier === "watch"
                        ? C.warn
                        : C.ok
                    }
                  />
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Badge text={`BUDGET ${row.budgetKas} KAS`} color={C.text} />
                  <Badge text={`CYCLE CAP ${row.cycleCapKas} KAS`} color={C.ok} />
                  {row.rebalanceDeltaKas !== 0 && (
                    <Badge text={`REBAL ${row.rebalanceDeltaKas > 0 ? "+" : ""}${row.rebalanceDeltaKas} KAS`} color={row.rebalanceDeltaKas > 0 ? C.ok : C.warn} />
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginBottom: 8 }}>
                <div style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>Target Alloc</div>
                  <div style={{ fontSize: 12, color: C.text, ...mono }}>{pct(row.targetPct, 1)}</div>
                </div>
                <div style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>Budget Share</div>
                  <div style={{ fontSize: 12, color: C.text, ...mono }}>{pct(row.budgetPct, 1)}</div>
                </div>
                <div style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>Risk Weight</div>
                  <div style={{ fontSize: 12, color: C.text, ...mono }}>{row.riskWeight}</div>
                </div>
                <div style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>Queue Pressure</div>
                  <div style={{ fontSize: 12, color: row.queuePressurePct > 20 ? C.warn : C.dim, ...mono }}>{pct(row.queuePressurePct, 1)}</div>
                </div>
                <div style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>Confidence / DataQ</div>
                  <div style={{ fontSize: 12, color: C.text, ...mono }}>{row.confidence} / {row.dataQuality}</div>
                </div>
                <div style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>Truth Quality / Cal</div>
                  <div style={{ fontSize: 12, color: C.text, ...mono }}>{row.truthQualityScore} / {row.calibrationHealth}</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.dim, ...mono }}>
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) => onAgentOverridePatch?.(row.agentId, { enabled: e.target.checked })}
                    />
                    ENABLED
                  </label>
                </div>
                <Inp
                  label="Target Allocation %"
                  value={String(row.targetPct)}
                  onChange={(v: string) => onAgentOverridePatch?.(row.agentId, { targetAllocationPct: Math.max(0, Math.min(100, Number(v) || 0)) })}
                  type="number"
                  suffix="%"
                  hint="Portfolio target share for this agent."
                />
                <Inp
                  label="Risk Weight"
                  value={String(row.riskWeight)}
                  onChange={(v: string) => onAgentOverridePatch?.(row.agentId, { riskWeight: Math.max(0, Math.min(10, Number(v) || 0)) })}
                  type="number"
                  hint="Relative allocator weight when signals are favorable."
                />
              </div>

              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(row.notes || []).map((note: string) => (
                  <Badge key={`${row.agentId}:${note}`} text={note.toUpperCase()} color={C.warn} />
                ))}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
