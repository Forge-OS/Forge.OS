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
  const summaryCards: Array<[string, string, string, string]> = [
    ["Wallet KAS", `${Number(walletKas || 0).toFixed(4)}`, C.accent, "Current wallet balance seen by the portfolio allocator. This is the funding pool the bot can work from."],
    ["Allocatable", `${Number(summary?.allocatableKas || 0).toFixed(4)} KAS`, C.text, "KAS available for bot allocation after reserves and allocator guards."],
    ["Target Budget", `${Number(summary?.targetBudgetKas || 0).toFixed(4)} KAS`, C.ok, "Allocator target pool for all agents this cycle based on budget settings and wallet size."],
    ["Allocated", `${Number(summary?.allocatedKas || 0).toFixed(4)} KAS`, C.text, "Total KAS currently assigned across agent budgets/cycle caps."],
    ["Utilization", pct(summary?.utilizationPct, 1), (summary?.utilizationPct || 0) >= 95 ? C.ok : C.warn, "How much of the target budget is actually allocated. Low utilization can indicate risk/truth/calibration throttling."],
    ["Concentration", pct(summary?.concentrationPct, 1), (summary?.concentrationPct || 0) > 55 ? C.warn : C.ok, "Largest single-agent share of the allocated budget. High concentration increases single-strategy risk."],
    ["RW Exposure", pct((Number(summary?.riskWeightedExposurePct || 0) * 100), 1), C.warn, "Risk-weighted exposure proxy across all agents (higher means more aggregate aggressiveness)."],
    ["Agents", String(Array.isArray(agents) ? agents.length : 0), C.dim, "Number of agents participating in the shared allocator."],
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 700, ...mono }}>Multi-Agent Portfolio Control</div>
          <div style={{ fontSize: 11, color: C.dim }}>
            Fund the bot in KAS and the allocator distributes cycle caps across agents automatically using calibration, truth quality, and risk controls.
          </div>
        </div>
        <Btn onClick={onRefresh} size="sm" variant="ghost">REFRESH ALLOCATOR</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, marginBottom: 12 }}>
        {[
          ["Capital", "Wallet KAS + Allocatable tell you how much the bot can deploy this cycle."],
          ["Safety", "Concentration + RW Exposure explain portfolio risk concentration across all agents."],
          ["Automation", "Calibration/truth quality can reduce allocations even when balance is available."],
        ].map(([title, text]) => (
          <div key={String(title)} style={{ background: `linear-gradient(180deg, ${C.s2} 0%, ${C.s1} 100%)`, border: `1px solid ${C.border}`, borderRadius: 6, padding: "9px 10px" }}>
            <div style={{ fontSize: 10, color: C.accent, ...mono, marginBottom: 3 }}>{title}</div>
            <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.35 }}>{text}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 12 }}>
        {summaryCards.map(([label, value, color, hint]) => (
          <Card key={String(label)} p={12} title={hint}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 13, color: color as any, fontWeight: 700, ...mono }}>{value}</div>
          </Card>
        ))}
      </div>

      <Card p={14} style={{ marginBottom: 12 }}>
        <details>
          <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div>
              <Label>Allocator Controls (Advanced)</Label>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                Optional tuning for shared portfolio behavior. Default auto settings are fine for most operators.
              </div>
            </div>
            <Badge text="ADVANCED" color={C.dim} />
          </summary>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
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
        </details>
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
                  <Badge text={`CAP ${Number(row.maxShareCapPct || 0).toFixed(1)}%`} color={C.dim} />
                  <Badge text={`ALIGN x${Number(row.templateRegimeMultiplier || 1).toFixed(2)}`} color={Number(row.templateRegimeMultiplier || 1) >= 1 ? C.ok : C.warn} />
                  {row.rebalanceDeltaKas !== 0 && (
                    <Badge text={`REBAL ${row.rebalanceDeltaKas > 0 ? "+" : ""}${row.rebalanceDeltaKas} KAS`} color={row.rebalanceDeltaKas > 0 ? C.ok : C.warn} />
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginBottom: 8 }}>
                <div title="Allocator target share for this agent before risk/calibration/truth penalties and cycle caps." style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>Target Alloc</div>
                  <div style={{ fontSize: 12, color: C.text, ...mono }}>{pct(row.targetPct, 1)}</div>
                </div>
                <div title="Actual budget share assigned after shared portfolio allocator weighting and caps." style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>Budget Share</div>
                  <div style={{ fontSize: 12, color: C.text, ...mono }}>{pct(row.budgetPct, 1)}</div>
                </div>
                <div title="Relative allocator priority for this agent when conditions are favorable. Higher means more share before safety penalties." style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>Allocator Weight</div>
                  <div style={{ fontSize: 12, color: C.text, ...mono }}>{row.riskWeight}</div>
                </div>
                <div title="Backlog pressure from queue items for this agent. Higher pressure can reduce new cycle allocation." style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>Queue Pressure</div>
                  <div style={{ fontSize: 12, color: row.queuePressurePct > 20 ? C.warn : C.dim, ...mono }}>{pct(row.queuePressurePct, 1)}</div>
                </div>
                <div title="Signal confidence and feature data quality feeding the shared allocator quality score for this agent." style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>Confidence / DataQ</div>
                  <div style={{ fontSize: 12, color: C.text, ...mono }}>{row.confidence} / {row.dataQuality}</div>
                </div>
                <div title="Truth quality (receipt consistency/coverage) and calibration health directly affect allocator routing and cycle caps." style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>Truth Quality / Cal</div>
                  <div style={{ fontSize: 12, color: C.text, ...mono }}>{row.truthQualityScore} / {row.calibrationHealth}</div>
                </div>
              </div>

              <details>
                <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.dim, ...mono, marginBottom: 8 }}>
                  <Badge text="ADVANCED AGENT OVERRIDES" color={C.dim} />
                  <span>Enable / allocation / allocator weight</span>
                </summary>
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
                    label="Allocator Weight"
                    value={String(row.riskWeight)}
                    onChange={(v: string) => onAgentOverridePatch?.(row.agentId, { riskWeight: Math.max(0, Math.min(10, Number(v) || 0)) })}
                    type="number"
                    hint="Relative allocator weight when signals are favorable."
                  />
                </div>
              </details>

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
