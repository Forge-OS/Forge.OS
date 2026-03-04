import { C, mono } from "../../tokens";
import { Badge, Card, Label } from "../ui";

export function PnlAttributionPanel({ summary }: any) {
  const rows = Array.isArray(summary?.rows) ? summary.rows : [];
  const net = Number((summary?.netPnlKas ?? summary?.estimatedNetPnlKas) || 0);
  const netMode = String(summary?.netPnlMode || "estimated");
  const executed = Number(summary?.executedSignals || 0);
  const quality = Number(summary?.signalQualityScore || 0);
  const timing = Number(summary?.timingAlphaPct || 0);
  const realizedMinConfirmations = Math.max(1, Number(summary?.realizedMinConfirmations || 1));
  const truthDegraded = Boolean(summary?.truthDegraded);
  const truthMismatchRatePct = Number(summary?.truthMismatchRatePct || 0);
  const truthCheckedSignals = Number(summary?.truthCheckedSignals || 0);
  const truthMismatchSignals = Number(summary?.truthMismatchSignals || 0);
  const netUsd = Number(summary?.netPnlUsd || 0);
  const snapshotPrice = Number(summary?.snapshotPriceUsd || 0);
  const hasUsd = snapshotPrice > 0;

  const modeLabel = netMode === "realized" ? "Realized" : netMode === "hybrid" ? "Hybrid" : "Estimated";
  const isPositive = net >= 0;

  // Key metrics - simplified for professional look
  const keyMetrics = [
    { label: "Net PnL", value: `${net >= 0 ? "+" : ""}${net.toFixed(4)} KAS`, color: isPositive ? C.ok : C.danger, subtext: modeLabel, usdValue: hasUsd ? `≈ $${netUsd >= 0 ? "+" : ""}${netUsd.toFixed(2)}` : null },
    { label: "Executed", value: executed, color: C.accent, subtext: "signals", usdValue: null },
    { label: "Quality", value: quality.toFixed(2), color: quality >= 0.65 ? C.ok : C.warn, subtext: "score", usdValue: null },
    { label: "Timing", value: `${timing >= 0 ? "+" : ""}${timing.toFixed(1)}%`, color: timing >= 0 ? C.ok : C.warn, subtext: "alpha", usdValue: null },
  ];

  return (
    <div>
      {/* Header Section - Clean & Professional */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, color: C.text, fontWeight: 700, ...mono, marginBottom: 4 }}>
              Performance Attribution
            </div>
            <div style={{ fontSize: 12, color: C.dim }}>
              {netMode === "realized" 
                ? "Fully confirmed with chain timestamps" 
                : netMode === "hybrid" 
                ? "Hybrid: confirmed + estimated costs" 
                : "Estimated from quant EV & execution data"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Badge text={modeLabel.toUpperCase()} color={netMode === "realized" ? C.ok : netMode === "hybrid" ? C.accent : C.warn} />
            <Badge text={`FLOOR ${realizedMinConfirmations} CONF`} color={C.dim} />
            {truthDegraded && <Badge text="DEGRADED" color={C.danger} />}
          </div>
        </div>
        
        {/* Truth Status */}
        {truthDegraded && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: `${C.danger}15`, border: `1px solid ${C.danger}30`, borderRadius: 6 }}>
            <div style={{ fontSize: 11, color: C.danger, ...mono }}>
              ⚠ Receipt Mismatch: {truthMismatchRatePct.toFixed(1)}% ({truthMismatchSignals}/{truthCheckedSignals} checks)
            </div>
          </div>
        )}
      </div>

      {/* Key Metrics Row - Professional Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 20 }}>
        {keyMetrics.map((m) => (
          <Card key={m.label} p={16} style={{ background: `linear-gradient(135deg, ${C.s2} 0%, ${C.s1} 100%)` }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
            <div style={{ fontSize: 22, color: m.color, fontWeight: 700, ...mono, lineHeight: 1.2 }}>{m.value}</div>
            {m.usdValue && <div style={{ fontSize: 11, color: C.accent, ...mono, marginTop: 2 }}>{m.usdValue}</div>}
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginTop: m.usdValue ? 2 : 4 }}>{m.subtext}</div>
          </Card>
        ))}
      </div>

      {/* Provenance Bar */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: C.dim, ...mono, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Data Provenance</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge text={`● Chain ${Number(summary?.provenanceChainSignals || 0)}`} color={Number(summary?.provenanceChainSignals || 0) > 0 ? C.ok : C.dim} />
          <Badge text={`● Backend ${Number(summary?.provenanceBackendSignals || 0)}`} color={Number(summary?.provenanceBackendSignals || 0) > 0 ? C.purple : C.dim} />
          <Badge text={`● Estimated ${Number(summary?.provenanceEstimatedSignals || 0)}`} color={Number(summary?.provenanceEstimatedSignals || 0) > 0 ? C.warn : C.dim} />
        </div>
      </div>

      {/* Attribution Breakdown - Clean Table */}
      <Card p={0} style={{ marginBottom: 20 }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, background: C.s2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: C.text, fontWeight: 600, ...mono }}>PnL Components</span>
          {hasUsd && <span style={{ fontSize: 10, color: C.dim, ...mono }}>@ ${snapshotPrice.toFixed(4)}/KAS</span>}
        </div>
        {rows.length === 0 && (
          <div style={{ padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 14, color: C.dim, marginBottom: 4 }}>No attribution data yet</div>
            <div style={{ fontSize: 12, color: C.dim }}>Run agent cycles to build performance history</div>
          </div>
        )}
        {rows.map((row: any, i: number) => {
          const value = Number(row?.value || 0);
          const rowPositive = value >= 0;
          const isAlpha = String(row?.label || "").includes("Alpha");
          const usdEquiv = hasUsd && !isAlpha ? value * snapshotPrice : null;
          return (
            <div
              key={String(row?.label)}
              style={{
                padding: "12px 18px",
                borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : "none",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: i % 2 === 0 ? "transparent" : `${C.s2}40`
              }}
            >
              <div>
                <div style={{ fontSize: 13, color: C.text, ...mono }}>{row?.label}</div>
                {row?.hint && <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{row.hint}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, color: rowPositive ? C.ok : C.danger, fontWeight: 600, ...mono }}>
                  {rowPositive ? "+" : ""}{value.toFixed(4)}{isAlpha ? "%" : " KAS"}
                </div>
                {usdEquiv != null && (
                  <div style={{ fontSize: 10, color: C.dim, ...mono, marginTop: 1 }}>
                    ≈ ${usdEquiv >= 0 ? "+" : ""}{usdEquiv.toFixed(2)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </Card>

      {/* Execution Funnel - Simplified */}
      <Card p={16}>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 600, ...mono, marginBottom: 12 }}>Execution Funnel</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
          {[
            ["Actionable", summary?.actionableSignals ?? 0, C.text],
            ["Executed", summary?.executedSignals ?? 0, C.ok],
            ["Pending", summary?.pendingSignals ?? 0, C.warn],
            ["Rejected", summary?.rejectedSignals ?? 0, C.danger],
          ].map(([label, value, color]) => (
            <div key={String(label)} style={{ textAlign: "center", padding: "10px 8px", background: C.s2, borderRadius: 6 }}>
              <div style={{ fontSize: 18, color: color as any, fontWeight: 700, ...mono }}>{String(value)}</div>
              <div style={{ fontSize: 10, color: C.dim, ...mono, marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
