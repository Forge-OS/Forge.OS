/**
 * BacktestPanel — runs the local quant backtest engine over the live
 * market-history snapshots and displays key performance metrics +
 * equity curve. No AI calls; fully deterministic.
 */

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { runBacktest, hashAgentConfig } from "../../quant/backtest";
import { C, mono } from "../../tokens";
import { Badge, Card, Label } from "../ui";

const LEADERBOARD_URL = (import.meta as any)?.env?.VITE_LEADERBOARD_URL || "";

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 90 }}>
      <span style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2, letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, color: color || C.text, ...mono }}>
        {value}
      </span>
    </div>
  );
}

const WINDOW_OPTIONS = [
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "7d",  ms: 7  * 24 * 60 * 60 * 1000 },
  { label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { label: "All", ms: 0 },
] as const;

type WindowOption = (typeof WINDOW_OPTIONS)[number];

// ── Chart tooltip ─────────────────────────────────────────────────────────────

function BtTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload;
  const ret = pt?.returnPct ?? 0;
  return (
    <div style={{ background: C.s2, border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 12px" }}>
      <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 3 }}>{pt?.label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: ret >= 0 ? C.ok : C.danger, ...mono }}>
        {ret >= 0 ? "+" : ""}{ret.toFixed(2)}%
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BacktestPanel({ marketHistory, agent }: { marketHistory: any[]; agent: any }) {
  const [windowIdx, setWindowIdx] = useState(1); // default 7d
  const [shareStatus, setShareStatus] = useState<"idle" | "sharing" | "shared" | "error">("idle");
  const [shareError, setShareError] = useState<string | null>(null);

  const windowOpt: WindowOption = WINDOW_OPTIONS[windowIdx];

  // Convert dashboard marketHistory to QuantSnapshot[]
  const snapshots = useMemo(
    () =>
      (Array.isArray(marketHistory) ? marketHistory : [])
        .filter((s) => s?.priceUsd > 0)
        .map((s) => ({
          ts:       Number(s.ts || 0),
          priceUsd: Number(s.priceUsd || 0),
          daaScore: Number(s.daaScore || 0),
          walletKas: Number(s.walletKas || 0),
        })),
    [marketHistory],
  );

  const result = useMemo(
    () =>
      runBacktest({
        snapshots,
        initialKas:      Math.max(100, Number(agent?.capitalLimit || 1000)),
        cycleCapFraction: agent?.risk === "high" ? 0.35 : agent?.risk === "low" ? 0.15 : 0.25,
        actionMode:      String(agent?.actionMode || "full") as any,
        risk:            (agent?.risk || "medium") as any,
        windowMs:        windowOpt.ms || undefined,
      }),
    [snapshots, agent?.capitalLimit, agent?.risk, agent?.actionMode, windowOpt.ms],
  );

  const hasData = result.equityCurve.length >= 3;
  const ret = result.totalReturnUsdPct;
  const retColor = ret > 0 ? C.ok : ret < 0 ? C.danger : C.dim;

  // Downsample equity curve for chart performance (max 120 pts)
  const chartData = useMemo(() => {
    const curve = result.equityCurve;
    if (curve.length <= 120) return curve;
    const step = Math.ceil(curve.length / 120);
    return curve.filter((_, i) => i % step === 0 || i === curve.length - 1);
  }, [result.equityCurve]);

  return (
    <Card p={18}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <Label>Backtest — Local Signal Engine</Label>
          <span style={{ fontSize: 10, color: C.dim, ...mono }}>
            RSI(14) + EMA(12/26) + BB(20) · {result.tradeCount} trades over {result.elapsedDays.toFixed(1)}d
          </span>
        </div>

        {/* Window selector */}
        <div style={{ display: "flex", gap: 4 }}>
          {WINDOW_OPTIONS.map((opt, i) => (
            <button
              key={opt.label}
              onClick={() => setWindowIdx(i)}
              style={{
                background: i === windowIdx ? C.accent : C.s2,
                color: i === windowIdx ? C.bg : C.dim,
                border: "none",
                borderRadius: 4,
                padding: "3px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                ...mono,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      {hasData ? (
        <>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
            <StatCell
              label="USD RETURN"
              value={`${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%`}
              color={retColor}
            />
            <StatCell
              label="MAX DD"
              value={`-${result.maxDrawdownPct.toFixed(2)}%`}
              color={result.maxDrawdownPct > 15 ? C.danger : result.maxDrawdownPct > 8 ? C.warn : C.ok}
            />
            <StatCell
              label="SHARPE"
              value={result.sharpeRatio.toFixed(2)}
              color={result.sharpeRatio > 1 ? C.ok : result.sharpeRatio > 0 ? C.warn : C.danger}
            />
            <StatCell
              label="SORTINO"
              value={result.sortinoRatio.toFixed(2)}
              color={result.sortinoRatio > 1 ? C.ok : result.sortinoRatio > 0 ? C.warn : C.danger}
            />
            <StatCell
              label="WIN RATE"
              value={`${result.winRatePct.toFixed(0)}%`}
              color={result.winRatePct >= 55 ? C.ok : result.winRatePct >= 45 ? C.warn : C.danger}
            />
            <StatCell label="ACCUMULATE" value={String(result.accumulateCount)} color={C.ok} />
            <StatCell label="REDUCE" value={String(result.reduceCount)} color={C.warn} />
          </div>

          {/* Equity curve */}
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={chartData} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="btg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={ret >= 0 ? C.ok : C.danger} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={ret >= 0 ? C.ok : C.danger} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: C.dim, fontSize: 10, fontFamily: "Courier New" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: C.dim, fontSize: 10, fontFamily: "Courier New" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
              />
              <Tooltip content={<BtTip />} />
              <ReferenceLine y={0} stroke={C.muted} strokeWidth={1} />
              <Area
                type="monotone"
                dataKey="returnPct"
                stroke={ret >= 0 ? C.ok : C.danger}
                strokeWidth={2}
                fill="url(#btg)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>

          {/* Footer badges */}
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <Badge text="LOCAL SIGNAL" color={C.dim} />
            <Badge
              text={String(agent?.actionMode || "full").replace("_", "-").toUpperCase()}
              color={agent?.actionMode === "accumulate_only" ? C.ok : C.accent}
            />
            {result.sharpeRatio > 1.5 && <Badge text="STRONG EDGE" color={C.ok} />}
            {result.maxDrawdownPct > 20 && <Badge text="HIGH DD" color={C.danger} />}
            {result.winRatePct < 40 && <Badge text="LOW WIN RATE" color={C.warn} />}
          </div>

          {/* Leaderboard share */}
          {LEADERBOARD_URL && (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={async () => {
                  if (shareStatus === "sharing") return;
                  setShareStatus("sharing");
                  setShareError(null);
                  try {
                    const configHash = await hashAgentConfig(agent);
                    const payload = {
                      configHash,
                      strategy:       String(agent?.strategy || ""),
                      risk:           String(agent?.risk || "medium"),
                      actionMode:     String(agent?.actionMode || "full"),
                      sharpeRatio:    result.sharpeRatio,
                      totalReturnPct: result.totalReturnUsdPct,
                      maxDrawdownPct: result.maxDrawdownPct,
                      winRatePct:     result.winRatePct,
                      tradeCount:     result.tradeCount,
                      elapsedDays:    result.elapsedDays,
                    };
                    const resp = await fetch(`${LEADERBOARD_URL}/leaderboard/submit`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload),
                    });
                    if (!resp.ok) {
                      const err = await resp.json().catch(() => ({}));
                      throw new Error((err as any)?.error || `HTTP ${resp.status}`);
                    }
                    setShareStatus("shared");
                  } catch (err) {
                    setShareError(err instanceof Error ? err.message : "Submit failed");
                    setShareStatus("error");
                  }
                }}
                style={{
                  background: shareStatus === "shared" ? `${C.ok}20` : C.s2,
                  border: `1px solid ${shareStatus === "shared" ? C.ok : shareStatus === "error" ? C.danger : C.border}`,
                  borderRadius: 4, padding: "5px 12px", cursor: "pointer",
                  fontSize: 11, color: shareStatus === "shared" ? C.ok : shareStatus === "error" ? C.danger : C.dim,
                  fontWeight: 700, ...mono,
                }}
              >
                {shareStatus === "sharing" ? "SHARING…" : shareStatus === "shared" ? "✓ SHARED" : "SHARE ANONYMOUSLY ↗"}
              </button>
              <span style={{ fontSize: 10, color: C.muted, ...mono }}>
                {shareStatus === "error"
                  ? shareError
                  : shareStatus === "shared"
                    ? "Published to leaderboard (no wallet data)"
                    : "Only config hash + backtest metrics — no wallet data"}
              </span>
            </div>
          )}
        </>
      ) : (
        <div style={{ color: C.dim, fontSize: 13, ...mono, textAlign: "center", padding: "32px 0" }}>
          Insufficient market history for backtest. Need at least 30 snapshots in the selected window.
        </div>
      )}
    </Card>
  );
}
