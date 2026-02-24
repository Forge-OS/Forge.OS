import { useEffect, useRef, useState } from "react";
import { C, mono } from "../../tokens";
import { Badge, Btn, Card, Inp } from "../ui";
import {
  PieChart, Pie, Cell,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// ─── helpers ─────────────────────────────────────────────────────────────────

const KasValue = ({ value, color = C.text, fontSize = 14 }: { value: string; color?: string; fontSize?: number }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
    <img src="/kas-icon.png" alt="KAS" width={fontSize + 2} height={fontSize + 2} style={{ borderRadius: "50%" }} />
    <span style={{ fontSize, color, fontWeight: 600, ...mono }}>{value}</span>
  </span>
);

function pct(v: number, digits = 1) { return `${Number(v || 0).toFixed(digits)}%`; }

function fmtTs(ts: number) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

function fmtUsd(v: number, priceUsd: number) {
  if (priceUsd <= 0) return null;
  const usd = v * priceUsd;
  return usd >= 1 ? `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${usd.toFixed(4)}`;
}

// ─── utility components ───────────────────────────────────────────────────────

const ProgressBar = ({ value, max = 100, color = C.accent, height = 6 }: { value: number; max?: number; color?: string; height?: number }) => {
  const fill = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ width: "100%", height, background: "rgba(16,25,35,0.6)", borderRadius: height / 2, overflow: "hidden" }}>
      <div style={{ width: `${fill}%`, height: "100%", background: color, borderRadius: height / 2, transition: "width 0.3s ease" }} />
    </div>
  );
};

const CircularGauge = ({ value, max = 100, color = C.accent, size = 56 }: { value: number; max?: number; color?: string; size?: number }) => {
  const fill = Math.min(100, Math.max(0, (value / max) * 100));
  const sw = size / 8;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(16,25,35,0.7)" strokeWidth={sw} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={circ} strokeDashoffset={circ - (fill / 100) * circ}
        strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.5s ease" }} />
    </svg>
  );
};

function LiveTicker({ value, prev }: { value: number; prev: number }) {
  const up = value > prev;
  const down = value < prev;
  const color = up ? C.ok : down ? C.danger : C.text;
  return (
    <span style={{ fontSize: 11, color, ...mono, transition: "color 0.4s" }}>
      {up ? "▲" : down ? "▼" : "●"} {value.toFixed(4)}
    </span>
  );
}

// ─── colour palette ──────────────────────────────────────────────────────────
const CHART_COLORS = [C.accent, C.ok, C.purple, C.warn, C.danger, "#8884d8", "#82ca9d", "#ffc658"];

// ─── snapshot history ─────────────────────────────────────────────────────────
type BalanceSnap = { ts: number; label: string; [agentName: string]: number | string };
const MAX_SNAPS = 120;

// ─── custom pie label ─────────────────────────────────────────────────────────
const PieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.08) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill={C.text} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 9, ...mono, fontWeight: 600 }}>
      {(percent * 100).toFixed(0)}%
    </text>
  );
};

// ─── main component ───────────────────────────────────────────────────────────
const REGIME_META: Record<string, { color: string; label: string; desc: string }> = {
  TREND_UP:          { color: "#39DDB6", label: "TREND UP",     desc: "Strong upward momentum · agents weighted for accumulation" },
  FLOW_ACCUMULATION: { color: "#39DDB6", label: "ACCUMULATING", desc: "DAG inflow detected · positive for KAS accumulation" },
  NEUTRAL:           { color: "#8FA0B5", label: "NEUTRAL",       desc: "No strong market signal · conservative sizing" },
  RANGE_VOL:         { color: "#F7B267", label: "RANGING VOL",   desc: "High volatility · agents reducing exposure" },
  RISK_OFF:          { color: "#FF5D7A", label: "RISK OFF",      desc: "Drawdown detected · capital preservation mode" },
};

export function PortfolioPanel({
  agents, activeAgentId, walletKas, kasPriceUsd = 0, lastDecision, summary, config,
  onConfigPatch, onAgentOverridePatch, onSelectAgent, onRefresh, onDeleteAgent, onEditAgent,
}: any) {
  const rows: any[] = Array.isArray(summary?.rows) ? summary.rows : [];
  const priceUsd = Number(kasPriceUsd || 0);

  // quant regime
  const dec = lastDecision?.dec;
  const qm = dec?.quant_metrics;
  const regime = String(qm?.regime || "");
  const regimeMeta = REGIME_META[regime] || null;
  const daaVelocity = Number(qm?.daa_velocity || 0);
  const kellyFraction = Number(dec?.kelly_fraction || 0);
  const confidenceScore = Number(dec?.confidence_score || 0);
  const ewmaVol = Number(qm?.ewma_volatility || 0);
  const sampleCount = Number(qm?.sample_count || 0);

  // ── Real-time balance/PnL tracking ─────────────────────────────────────────
  const prevBalance = useRef<Record<string, number>>({});
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [balanceHistory, setBalanceHistory] = useState<BalanceSnap[]>([]);
  const [pnlHistory, setPnlHistory] = useState<BalanceSnap[]>([]);

  useEffect(() => {
    if (!rows.length) return;
    const now = Date.now();
    setLastUpdated(now);
    prevBalance.current = Object.fromEntries(
      rows.map((r: any) => [r.agentId, Number(r.balanceKas || r.budgetKas || 0)])
    );
    const snap: BalanceSnap = { ts: now, label: fmtTs(now) };
    const pnlSnap: BalanceSnap = { ts: now, label: fmtTs(now) };
    for (const r of rows) {
      snap[r.name] = Number(r.balanceKas || r.budgetKas || 0);
      pnlSnap[r.name] = Number(r.pnlKas || 0);
    }
    setBalanceHistory(h => [...h, snap].slice(-MAX_SNAPS));
    setPnlHistory(h => [...h, pnlSnap].slice(-MAX_SNAPS));
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Portfolio health ────────────────────────────────────────────────────────
  const health = Math.min(100,
    ((summary?.utilizationPct || 0) * 0.3) +
    (100 - (summary?.concentrationPct || 0)) * 0.3 +
    ((summary?.allocatedKas || 0) / Math.max(1, summary?.targetBudgetKas || 1)) * 40
  );
  const healthColor = health >= 70 ? C.ok : health >= 40 ? C.warn : C.danger;
  const healthLabel = health >= 70 ? "Healthy" : health >= 40 ? "Moderate" : "Needs Attention";

  const totalPnl = rows.reduce((s: number, r: any) => s + Number(r.pnlKas || 0), 0);
  const totalDeployed = Number(summary?.allocatedKas || 0);
  const totalBudget = Number(summary?.targetBudgetKas || 0);
  const walletUsd = fmtUsd(Number(walletKas || 0), priceUsd);

  // ── Chart data ──────────────────────────────────────────────────────────────
  const allocationData = rows
    .map((r: any, i: number) => ({ name: r.name, value: Number(r.budgetKas) || 0, color: CHART_COLORS[i % CHART_COLORS.length] }))
    .filter((d: any) => d.value > 0);

  const pnlChartData = rows.map((r: any) => ({
    name: r.name.substring(0, 12),
    PnL: Number(r.pnlKas || 0),
    Balance: Number(r.balanceKas || r.budgetKas || 0),
  }));

  const agentNames: string[] = rows.map((r: any) => r.name);
  const showCompareChart = balanceHistory.length >= 2 && agentNames.length > 0;
  const showPnlHistory = pnlHistory.length >= 2 && agentNames.length > 0;

  const kasTooltipFormatter = (v: number) => [`${Number(v).toFixed(4)} KAS`, ""];
  const tooltipStyle = { background: "rgba(11,17,24,0.95)", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 };

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 700, ...mono }}>Portfolio</div>
          <div style={{ fontSize: 11, color: C.dim }}>
            Real-time balance &amp; PnL across all deployed agents
            {lastUpdated > 0 && (
              <span style={{ marginLeft: 8, color: C.accent }}>· updated {fmtTs(lastUpdated)}</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 10, color: C.dim, ...mono, background: "rgba(16,25,35,0.5)", padding: "4px 10px", borderRadius: 4, border: `1px solid rgba(33,48,67,0.6)` }}>
            {rows.length} agent{rows.length !== 1 ? "s" : ""} live
          </div>
          <Btn onClick={onRefresh} size="sm" variant="ghost">Refresh</Btn>
        </div>
      </div>

      {/* ── Market Intelligence Strip ── */}
      <Card p={0} style={{ marginBottom: 14, overflow: "hidden", border: `1px solid ${regimeMeta ? regimeMeta.color + "28" : "rgba(33,48,67,0.5)"}` }}>
        <div style={{ height: 2, background: regimeMeta ? `linear-gradient(90deg, ${regimeMeta.color}, ${C.purple})` : `linear-gradient(90deg, ${C.border}, ${C.border})` }} />
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 0, alignItems: "stretch" }}>
          {/* Regime block */}
          <div style={{ padding: "12px 16px", background: regimeMeta ? `linear-gradient(135deg, ${regimeMeta.color}12 0%, rgba(8,13,20,0.6) 100%)` : "rgba(8,13,20,0.5)", borderRight: `1px solid rgba(33,48,67,0.4)` }}>
            <div style={{ fontSize: 8, color: C.dim, ...mono, letterSpacing: "0.12em", marginBottom: 4 }}>MARKET REGIME</div>
            <div style={{ fontSize: 13, color: regimeMeta?.color || C.dim, fontWeight: 700, ...mono }}>{regimeMeta?.label || "AWAITING CYCLE"}</div>
            <div style={{ fontSize: 9, color: C.dim, marginTop: 2, maxWidth: 160 }}>{regimeMeta?.desc || "Run a cycle to get market intelligence"}</div>
          </div>

          {/* Live quant metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", padding: "12px 16px", gap: 12 }}>
            {[
              { k: "DAA Velocity", v: qm ? `${daaVelocity >= 0 ? "+" : ""}${daaVelocity.toFixed(1)}` : "—", c: daaVelocity > 0 ? C.ok : daaVelocity < 0 ? C.danger : C.dim },
              { k: "EWMA Vol", v: qm ? `${(ewmaVol * 100).toFixed(3)}%` : "—", c: ewmaVol > 0.02 ? C.warn : C.ok },
              { k: "Kelly Size", v: dec ? `${(kellyFraction * 100).toFixed(1)}%` : "—", c: C.accent },
              { k: "Samples", v: qm ? String(sampleCount) : "—", c: sampleCount >= 32 ? C.ok : C.warn },
            ].map(item => (
              <div key={item.k}>
                <div style={{ fontSize: 8, color: C.dim, ...mono, letterSpacing: "0.08em", marginBottom: 3 }}>{item.k}</div>
                <div style={{ fontSize: 12, color: item.c, fontWeight: 700, ...mono }}>{item.v}</div>
              </div>
            ))}
          </div>

          {/* Confidence gauge */}
          <div style={{ padding: "12px 16px", borderLeft: `1px solid rgba(33,48,67,0.4)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 80 }}>
            <div style={{ fontSize: 8, color: C.dim, ...mono, letterSpacing: "0.1em", marginBottom: 6 }}>CONFIDENCE</div>
            <div style={{ fontSize: 20, color: confidenceScore >= 0.7 ? C.ok : confidenceScore >= 0.5 ? C.warn : C.dim, fontWeight: 700, ...mono }}>
              {dec ? `${(confidenceScore * 100).toFixed(0)}%` : "—"}
            </div>
            {dec && (
              <div style={{ width: 48, height: 3, background: "rgba(16,25,35,0.7)", borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
                <div style={{ width: `${confidenceScore * 100}%`, height: "100%", background: confidenceScore >= 0.7 ? C.ok : confidenceScore >= 0.5 ? C.warn : C.danger, transition: "width 0.4s" }} />
              </div>
            )}
          </div>
        </div>

        {/* KAS/USDC price strip */}
        {priceUsd > 0 && (
          <div style={{ padding: "8px 16px", borderTop: `1px solid rgba(33,48,67,0.4)`, background: "rgba(8,13,20,0.4)", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <img src="/kas-icon.png" alt="KAS" width={14} height={14} style={{ borderRadius: "50%" }} />
              <span style={{ fontSize: 10, color: C.accent, fontWeight: 700, ...mono }}>KAS / USDC</span>
              <span style={{ fontSize: 12, color: C.text, fontWeight: 700, ...mono }}>${priceUsd.toFixed(4)}</span>
            </div>
            <span style={{ fontSize: 9, color: C.dim, ...mono }}>·</span>
            <span style={{ fontSize: 9, color: C.dim, ...mono }}>
              Wallet: <span style={{ color: C.text }}>{Number(walletKas || 0).toFixed(2)} KAS</span>
              {walletUsd && <span style={{ color: C.dim }}> ({walletUsd})</span>}
            </span>
            <span style={{ fontSize: 9, color: C.dim, ...mono }}>·</span>
            <span style={{ fontSize: 9, color: C.dim, ...mono }}>
              P&amp;L: <span style={{ color: totalPnl >= 0 ? C.ok : C.danger, fontWeight: 600 }}>{totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(4)} KAS</span>
            </span>
            {lastDecision?.dec?.action && (
              <>
                <span style={{ fontSize: 9, color: C.dim, ...mono }}>·</span>
                <span style={{ fontSize: 9, color: C.accent, fontWeight: 700, ...mono }}>
                  SIGNAL: {lastDecision.dec.action}
                </span>
              </>
            )}
          </div>
        )}
      </Card>

      {/* ── Portfolio Health Card ── */}
      <Card p={16} style={{ marginBottom: 14, background: `linear-gradient(135deg, ${healthColor}08 0%, rgba(8,13,20,0.5) 100%)`, border: `1px solid ${healthColor}22` }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignItems: "center", marginBottom: 14 }}>
          <CircularGauge value={health} color={healthColor} size={72} />
          <div>
            <div style={{ fontSize: 9, color: C.dim, ...mono, marginBottom: 4, letterSpacing: "0.12em" }}>OVERALL HEALTH</div>
            <div style={{ fontSize: 20, color: healthColor, fontWeight: 700, ...mono, marginBottom: 6 }}>{healthLabel}</div>
            <ProgressBar value={health} color={healthColor} height={6} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
          {[
            {
              label: "Wallet Balance", color: C.accent,
              value: <KasValue value={Number(walletKas || 0).toFixed(2)} color={C.accent} />,
              sub: walletUsd ? walletUsd : null,
            },
            {
              label: "Deployable", color: C.ok,
              value: <KasValue value={Number(summary?.allocatableKas || 0).toFixed(2)} />,
              sub: fmtUsd(Number(summary?.allocatableKas || 0), priceUsd),
            },
            {
              label: "Target Budget", color: C.ok,
              value: <KasValue value={Number(summary?.targetBudgetKas || 0).toFixed(2)} color={C.ok} />,
              sub: fmtUsd(totalBudget, priceUsd),
            },
            {
              label: "Deployed", color: C.purple,
              value: <KasValue value={Number(summary?.allocatedKas || 0).toFixed(2)} />,
              sub: fmtUsd(totalDeployed, priceUsd),
            },
            {
              label: "Total P&L", color: totalPnl >= 0 ? C.ok : C.danger,
              value: <span style={{ fontSize: 14, color: totalPnl >= 0 ? C.ok : C.danger, fontWeight: 700, ...mono }}>{totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(4)} KAS</span>,
              sub: fmtUsd(Math.abs(totalPnl), priceUsd) ? `${totalPnl >= 0 ? "+" : "-"}${fmtUsd(Math.abs(totalPnl), priceUsd)}` : null,
            },
          ].map(({ label, value, sub, color }) => (
            <div key={label} style={{ background: `linear-gradient(135deg, ${color}10 0%, rgba(8,13,20,0.55) 100%)`, borderRadius: 8, padding: "10px 12px", border: `1px solid ${color}18` }}>
              <div style={{ fontSize: 9, color: C.dim, ...mono, marginBottom: 4, letterSpacing: "0.08em" }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, ...mono }}>{value}</div>
              {sub && <div style={{ fontSize: 9, color: C.dim, ...mono, marginTop: 2 }}>{sub}</div>}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Allocation by Agent ── */}
      {rows.length > 0 && (
        <Card p={14} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: C.dim, ...mono, marginBottom: 14, letterSpacing: "0.12em" }}>ALLOCATION BY AGENT</div>

          <div style={{ display: "grid", gridTemplateColumns: allocationData.length > 0 ? "1fr auto" : "1fr", gap: 16, alignItems: "center" }}>
            {/* Bar list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map((r: any, i: number) => {
                const allocation = Number(r.budgetKas || 0);
                const totalBgt = rows.reduce((s: number, row: any) => s + Number(row.budgetKas || 0), 0);
                const sharePct = totalBgt > 0 ? (allocation / totalBgt) * 100 : 0;
                const agentColor = CHART_COLORS[i % CHART_COLORS.length];
                const usdVal = fmtUsd(allocation, priceUsd);
                return (
                  <div key={r.agentId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: agentColor, flexShrink: 0, boxShadow: `0 0 6px ${agentColor}60` }} />
                    <div style={{ flex: 1, minWidth: 100 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: C.text, ...mono }}>{r.name}</span>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontSize: 11, color: agentColor, ...mono }}>{allocation.toFixed(2)} KAS</span>
                          {usdVal && <span style={{ fontSize: 9, color: C.dim, ...mono, marginLeft: 4 }}>({usdVal})</span>}
                        </div>
                      </div>
                      <ProgressBar value={sharePct} color={agentColor} height={5} />
                    </div>
                    <span style={{ fontSize: 11, color: C.dim, ...mono, minWidth: 36, textAlign: "right" }}>{sharePct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>

            {/* Donut chart */}
            {allocationData.length > 0 && (
              <div style={{ flexShrink: 0 }}>
                <PieChart width={130} height={130}>
                  <Pie
                    data={allocationData}
                    cx={60} cy={60}
                    innerRadius={32} outerRadius={58}
                    dataKey="value"
                    labelLine={false}
                    label={PieLabel}
                  >
                    {allocationData.map((entry: any, i: number) => (
                      <Cell key={i} fill={entry.color} opacity={0.88} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => [`${v.toFixed(2)} KAS`, ""]}
                    contentStyle={tooltipStyle}
                  />
                </PieChart>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── P&L Comparison ── */}
      {rows.length > 0 && (
        <Card p={14} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: C.dim, ...mono, marginBottom: 12, letterSpacing: "0.12em" }}>P&L COMPARISON</div>
          {pnlChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={pnlChartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(33,48,67,0.4)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: C.dim }} />
                <YAxis tick={{ fontSize: 10, fill: C.dim }} />
                <Tooltip formatter={(v: number, n: string) => [`${v.toFixed(4)} KAS`, n === "PnL" ? "P&L" : "Balance"]} contentStyle={tooltipStyle} />
                <Bar dataKey="PnL" radius={[4, 4, 0, 0]}>
                  {pnlChartData.map((_: any, i: number) => (
                    <Cell key={i} fill={(pnlChartData[i].PnL ?? 0) >= 0 ? C.ok : C.danger} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: C.dim, fontSize: 12 }}>No P&L data yet</div>
          )}
        </Card>
      )}

      {/* ── Live Balance Compare ── */}
      {showCompareChart && (
        <Card p={14} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, ...mono, letterSpacing: "0.1em" }}>⚡ LIVE BALANCE COMPARE</div>
            <span style={{ fontSize: 9, color: C.dim, ...mono }}>{balanceHistory.length} snapshots</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={balanceHistory} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(33,48,67,0.4)" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.dim }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: C.dim }} width={55} tickFormatter={(v: number) => `${v.toFixed(1)}`} />
              <Tooltip formatter={kasTooltipFormatter as any} contentStyle={tooltipStyle} labelStyle={{ color: C.dim, fontSize: 10 }} />
              <Legend wrapperStyle={{ fontSize: 10, color: C.dim }} />
              {agentNames.map((name, i) => (
                <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {showPnlHistory && (
        <Card p={14} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: C.ok, fontWeight: 700, ...mono, letterSpacing: "0.1em" }}>📈 LIVE P&L HISTORY</div>
            <span style={{ fontSize: 9, color: C.dim, ...mono }}>{pnlHistory.length} snapshots</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={pnlHistory} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(33,48,67,0.4)" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.dim }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: C.dim }} width={60} tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(3)}`} />
              <Tooltip formatter={kasTooltipFormatter as any} contentStyle={tooltipStyle} labelStyle={{ color: C.dim, fontSize: 10 }} />
              <Legend wrapperStyle={{ fontSize: 10, color: C.dim }} />
              {agentNames.map((name, i) => (
                <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Stats Row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 14 }}>
        {[
          { label: "Budget Utilization", value: pct(summary?.utilizationPct, 1), color: (summary?.utilizationPct || 0) >= 80 ? C.ok : C.warn, sub: "target 80%+" },
          { label: "Concentration", value: pct(summary?.concentrationPct, 1), color: (summary?.concentrationPct || 0) > 55 ? C.warn : C.ok, sub: "lower = diversified" },
          { label: "Active Agents", value: String(Array.isArray(agents) ? agents.length : 0), color: C.text, sub: "in pool" },
        ].map(({ label, value, color, sub }) => (
          <Card key={label} p={14} style={{ background: `linear-gradient(135deg, ${color}10 0%, rgba(8,13,20,0.5) 100%)`, border: `1px solid ${color}20` }}>
            <div style={{ fontSize: 9, color: C.dim, ...mono, marginBottom: 4, letterSpacing: "0.08em" }}>{label}</div>
            <div style={{ fontSize: 20, color, fontWeight: 700, ...mono }}>{value}</div>
            <div style={{ fontSize: 9, color: C.dim, marginTop: 4 }}>{sub}</div>
          </Card>
        ))}
      </div>

      {/* ── Allocator Settings (collapsed) ── */}
      <Card p={14} style={{ marginBottom: 14 }}>
        <details>
          <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: C.dim, ...mono }}>Advanced Allocator Settings</span>
            <span style={{ fontSize: 10, color: C.dim }}>▼</span>
          </summary>
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
            <Inp label="Total Budget % of Wallet"
              value={String(Math.round(Number(config?.totalBudgetPct || 0) * 10000) / 100)}
              onChange={(v: string) => onConfigPatch({ totalBudgetPct: Math.max(5, Math.min(100, Number(v) || 0)) / 100 })}
              type="number" suffix="%" hint="What percentage of your wallet balance agents can use" />
            <Inp label="Reserve (always keep)"
              value={String(config?.reserveKas ?? 0)}
              onChange={(v: string) => onConfigPatch({ reserveKas: Math.max(0, Number(v) || 0) })}
              type="number" suffix="KAS" hint="KAS to always keep untouched" />
            <Inp label="Max Per Agent %"
              value={String(Math.round(Number(config?.maxAgentAllocationPct || 0) * 10000) / 100)}
              onChange={(v: string) => onConfigPatch({ maxAgentAllocationPct: Math.max(5, Math.min(100, Number(v) || 0)) / 100 })}
              type="number" suffix="%" hint="No single agent can get more than this share" />
            <Inp label="Rebalance Threshold %"
              value={String(Math.round(Number(config?.rebalanceThresholdPct || 0) * 10000) / 100)}
              onChange={(v: string) => onConfigPatch({ rebalanceThresholdPct: Math.max(1, Math.min(50, Number(v) || 0)) / 100 })}
              type="number" suffix="%" hint="Only trigger rebalance when drift exceeds this" />
          </div>
        </details>
      </Card>

      {/* ── Per-Agent Cards ── */}
      <Card p={0}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid rgba(33,48,67,0.5)`, background: "rgba(8,13,20,0.5)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: C.dim, ...mono, letterSpacing: "0.12em" }}>AGENTS · REAL-TIME</span>
          <span style={{ fontSize: 9, color: C.dim, ...mono }}>{rows.length} in pool</span>
        </div>

        {rows.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", fontSize: 12, color: C.dim }}>No agents deployed yet.</div>
        )}

        {rows.map((row: any, idx: number) => {
          const isActive = row.agentId === activeAgentId;
          const riskC = row.risk <= 0.4 ? C.ok : row.risk <= 0.7 ? C.warn : C.danger;
          const pnl = Number(row.pnlKas || 0);
          const bal = Number(row.balanceKas || row.budgetKas || 0);
          const prevBal = prevBalance.current[row.agentId] ?? bal;
          const agentColor = CHART_COLORS[idx % CHART_COLORS.length];
          const balUsd = fmtUsd(bal, priceUsd);
          const pnlUsd = fmtUsd(Math.abs(pnl), priceUsd);

          return (
            <div key={row.agentId}
              style={{
                padding: "14px 16px",
                borderBottom: `1px solid rgba(33,48,67,0.4)`,
                background: isActive
                  ? `linear-gradient(135deg, ${agentColor}08 0%, rgba(8,13,20,0.3) 100%)`
                  : "transparent",
                borderLeft: isActive ? `2px solid ${agentColor}` : "2px solid transparent",
              }}>

              {/* Name row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: agentColor, display: "inline-block", flexShrink: 0, boxShadow: `0 0 8px ${agentColor}80` }} />
                  <button
                    onClick={() => onSelectAgent?.(row.agentId)}
                    style={{
                      background: isActive ? `${agentColor}18` : "rgba(16,25,35,0.4)",
                      border: `1px solid ${isActive ? agentColor : "rgba(33,48,67,0.6)"}`,
                      color: isActive ? agentColor : C.text,
                      borderRadius: 6, padding: "6px 12px", cursor: "pointer",
                      fontSize: 12, fontWeight: 600, ...mono,
                    }}
                  >
                    {row.name}
                  </button>
                  <Badge text={row.enabled ? "Active" : "Disabled"} color={row.enabled ? C.ok : C.dim} />
                  <LiveTicker value={bal} prev={prevBal} />
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: pnl >= 0 ? C.ok : C.danger, fontWeight: 700, ...mono }}>
                    {pnl >= 0 ? "▲ +" : "▼ "}{pnl.toFixed(4)} KAS
                    {pnlUsd && <span style={{ fontSize: 9, color: C.dim, marginLeft: 4 }}>({pnl >= 0 ? "+" : "-"}{pnlUsd})</span>}
                  </span>
                  <Badge text={`Risk: ${row.risk <= 0.4 ? "Low" : row.risk <= 0.7 ? "Med" : "High"}`} color={riskC} />
                  <button onClick={() => onEditAgent?.(row)} title="Edit agent"
                    style={{ background: "rgba(16,25,35,0.5)", border: `1px solid rgba(57,221,182,0.12)`, color: C.dim, borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 11, ...mono }}>
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => { if (window.confirm(`Delete agent "${row.name}"? This cannot be undone.`)) { onDeleteAgent?.(row.agentId); } }}
                    title="Delete agent"
                    style={{ background: C.dLow, border: `1px solid ${C.danger}50`, color: C.danger, borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 11, ...mono }}>
                    🗑️ Delete
                  </button>
                </div>
              </div>

              {/* Key numbers grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: 8, marginBottom: 10 }}>
                {[
                  { label: "Cycle Budget", value: <KasValue value={row.cycleCapKas} color={C.ok} />, hint: "Max KAS this agent can trade per cycle", c: C.ok },
                  { label: "Total Budget", value: <KasValue value={row.budgetKas} />, hint: "Total KAS allocated", c: C.dim },
                  {
                    label: "Live Balance", c: agentColor,
                    value: (
                      <div>
                        <KasValue value={bal.toFixed(4)} color={agentColor} />
                        {balUsd && <div style={{ fontSize: 9, color: C.dim, ...mono, marginTop: 1 }}>{balUsd}</div>}
                      </div>
                    ),
                    hint: "Current balance for this agent",
                  },
                  {
                    label: "P&L", c: pnl >= 0 ? C.ok : C.danger,
                    value: (
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600, ...mono, color: pnl >= 0 ? C.ok : C.danger }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(4)} KAS</span>
                        {pnlUsd && <div style={{ fontSize: 9, color: C.dim, ...mono, marginTop: 1 }}>{pnl >= 0 ? "+" : "-"}{pnlUsd}</div>}
                      </div>
                    ),
                    hint: `PnL (${row.pnlMode || "estimated"})`,
                  },
                  { label: "Portfolio Share", value: pct(row.targetPct, 1), hint: "Target % of total portfolio", c: C.purple },
                  { label: "Queue Pressure", value: pct(row.queuePressurePct, 1), hint: "How busy the execution queue is", c: C.dim },
                ].map(({ label, value, hint, c }) => (
                  <div key={label} title={hint}
                    style={{ background: `linear-gradient(135deg, ${c}08 0%, rgba(8,13,20,0.5) 100%)`, borderRadius: 6, padding: "8px 10px", border: `1px solid ${c}14` }}>
                    <div style={{ fontSize: 9, color: C.dim, ...mono, marginBottom: 2, letterSpacing: "0.08em" }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, ...mono }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Balance vs Budget bar */}
              {bal > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 9, color: C.dim, ...mono }}>Balance vs Budget</span>
                    <span style={{ fontSize: 9, color: agentColor, ...mono }}>{((bal / Math.max(1, Number(row.budgetKas))) * 100).toFixed(1)}%</span>
                  </div>
                  <ProgressBar value={(bal / Math.max(1, Number(row.budgetKas))) * 100} color={agentColor} height={4} />
                </div>
              )}

              {/* Notes */}
              {(row.notes || []).length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {(row.notes || []).map((note: string) => (
                    <Badge key={note} text={note.replace(/_/g, " ")} color={C.warn} />
                  ))}
                </div>
              )}

              {/* Override settings */}
              <details>
                <summary style={{ cursor: "pointer", listStyle: "none" }}>
                  <span style={{ fontSize: 9, color: C.dim, ...mono }}>Override settings ▼</span>
                </summary>
                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(16,25,35,0.5)", padding: "10px 12px", borderRadius: 6, cursor: "pointer", border: `1px solid rgba(33,48,67,0.5)` }}>
                    <input type="checkbox" checked={row.enabled}
                      onChange={(e) => onAgentOverridePatch?.(row.agentId, { enabled: e.target.checked })}
                      style={{ width: 16, height: 16, accentColor: C.accent }} />
                    <span style={{ fontSize: 11, color: C.text, ...mono }}>Enabled</span>
                  </label>
                  <Inp label="Target Allocation %"
                    value={String(row.targetPct)}
                    onChange={(v: string) => onAgentOverridePatch?.(row.agentId, { targetAllocationPct: Math.max(0, Math.min(100, Number(v) || 0)) })}
                    type="number" suffix="%" hint="Desired portfolio share for this agent" />
                  <Inp label="Risk Weight"
                    value={String(row.riskWeight)}
                    onChange={(v: string) => onAgentOverridePatch?.(row.agentId, { riskWeight: Math.max(0, Math.min(10, Number(v) || 0)) })}
                    type="number" hint="Allocator weight multiplier" />
                </div>
              </details>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
