/**
 * OverviewPanel — Forge.OS command center.
 *
 * v2 enhancements:
 *  – Holographic dot-grid backgrounds on header + Neural Core sections
 *  – GlitchNum: numbers flash a digital-corruption animation on value change
 *  – RippleDot: pulse dot with expanding concentric ring
 *  – SpinRing: outer dashed ring rotating around the confidence arc
 *  – RadarPulse: spinning radar sweep for the Neural Core empty state
 *  – SysTag: status cell with animated bottom progress bar
 *  – Scanline overlay on the AI Rationale terminal box
 *  – Animated slide-in on Chain Event Feed rows
 *  – Deployed-agent identity (agentId, deployedAt, deployTx) in header
 *  – Logic: useMemo split into price / chain / decision / layout scopes
 *    for finer dependency tracking and fewer spurious re-renders
 */

import { lazy, Suspense, useEffect, useRef, useState, useMemo } from "react";
import { C, mono } from "../../tokens";
import { Badge, Btn, ExtLink, Label } from "../ui";
import { EXPLORER, AUTO_CYCLE_SECONDS, RESERVE } from "../../constants";
import { describePairMode } from "../../quant/pairTrading";
import { formatStopStatus } from "../../quant/stopLoss";
import { PanelSkeleton } from "./PanelSkeleton";

const AgentOverviewPanel = lazy(() =>
  import("./AgentOverviewPanel").then((m) => ({ default: m.AgentOverviewPanel }))
);
const PerfChart = lazy(() =>
  import("./PerfChart").then((m) => ({ default: m.PerfChart }))
);

// ── Keyframe CSS (injected once) ──────────────────────────────────────────────

const FORGE_CSS = `
@keyframes forge-pulse {
  0%,100% { opacity:1; box-shadow:0 0 6px var(--fp-color,#39DDB6); }
  50%      { opacity:.45; box-shadow:0 0 18px var(--fp-color,#39DDB6); }
}
@keyframes forge-scan {
  0%   { transform:translateX(-120%); opacity:0; }
  30%  { opacity:.55; }
  70%  { opacity:.55; }
  100% { transform:translateX(220%); opacity:0; }
}
@keyframes forge-bar {
  from { width:0% }
}
@keyframes forge-fadein {
  from { opacity:0; transform:translateY(4px); }
  to   { opacity:1; transform:translateY(0); }
}
@keyframes forge-glitch {
  0%   { opacity:1;   transform:translateX(0)    skewX(0deg);  }
  8%   { opacity:.75; transform:translateX(-3px)  skewX(-2deg); filter:hue-rotate(90deg); }
  16%  { opacity:1;   transform:translateX(2px)   skewX(1deg);  filter:none; }
  26%  { opacity:.9;  transform:translateX(-1px)  skewX(0deg);  }
  34%  { opacity:1;   transform:translateX(0)     skewX(0deg);  }
  100% { opacity:1;   transform:translateX(0)     skewX(0deg);  }
}
@keyframes forge-rotate-cw {
  from { transform:rotate(0deg);   }
  to   { transform:rotate(360deg); }
}
@keyframes forge-rotate-ccw {
  from { transform:rotate(0deg);    }
  to   { transform:rotate(-360deg); }
}
@keyframes forge-ripple {
  0%   { transform:scale(1);   opacity:.55; }
  100% { transform:scale(3.4); opacity:0;   }
}
@keyframes forge-glow {
  0%,100% { text-shadow:0 0 8px currentColor;                           }
  50%      { text-shadow:0 0 20px currentColor, 0 0 40px currentColor;  }
}
@keyframes forge-flicker {
  0%,89%,91%,96%,100% { opacity:1;  }
  90%                  { opacity:.5; }
  97%                  { opacity:.7; }
}
@keyframes forge-blink {
  0%,49%  { opacity:1; }
  50%,100%{ opacity:0; }
}
@keyframes forge-radar {
  from { transform:rotate(0deg);   }
  to   { transform:rotate(360deg); }
}
@keyframes forge-scanline {
  0%   { top:-6%;   }
  100% { top:106%;  }
}
@keyframes forge-slide-in {
  from { opacity:0; transform:translateX(-10px); }
  to   { opacity:1; transform:translateX(0);     }
}
@keyframes forge-bracket-glow {
  0%,100% { filter:drop-shadow(0 0 2px var(--fb-c,#39DDB6)); }
  50%      { filter:drop-shadow(0 0 8px var(--fb-c,#39DDB6)); }
}
@keyframes forge-bar-fill {
  from { width:0%; }
}
`;

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Holographic dot-matrix background — purely decorative, zero interactivity. */
function HoloGrid({
  color = C.accent,
  spacing = 22,
  opacity = 0.18,
}: {
  color?: string;
  spacing?: number;
  opacity?: number;
}) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundImage: `radial-gradient(circle, ${color} 1px, transparent 1px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        opacity,
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)",
      }}
    />
  );
}

/** HUD corner-bracket decoration. */
function Brackets({
  c = C.accent,
  sz = 12,
  t = 1.5,
  glow = false,
}: {
  c?: string;
  sz?: number;
  t?: number;
  glow?: boolean;
}) {
  const br = `${t}px solid ${c}`;
  const base: React.CSSProperties = {
    position: "absolute",
    width: sz,
    height: sz,
    "--fb-c": c,
    animation: glow ? "forge-bracket-glow 3s ease-in-out infinite" : "none",
  } as React.CSSProperties;
  return (
    <>
      <div style={{ ...base, top: 0, left: 0, borderTop: br, borderLeft: br }} />
      <div style={{ ...base, top: 0, right: 0, borderTop: br, borderRight: br }} />
      <div style={{ ...base, bottom: 0, left: 0, borderBottom: br, borderLeft: br }} />
      <div style={{ ...base, bottom: 0, right: 0, borderBottom: br, borderRight: br }} />
    </>
  );
}

/** Animated pulse dot with optional expanding ripple ring. */
function RippleDot({
  color,
  active,
  ripple = false,
}: {
  color: string;
  active: boolean;
  ripple?: boolean;
}) {
  return (
    <div style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
      {ripple && active && (
        <div
          style={{
            position: "absolute",
            inset: -3,
            borderRadius: "50%",
            border: `1.5px solid ${color}`,
            animation: "forge-ripple 2.2s ease-out infinite",
            pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          "--fp-color": color,
          animation: active ? "forge-pulse 2.4s ease-in-out infinite" : "none",
          boxShadow: active ? `0 0 6px ${color}` : "none",
        } as React.CSSProperties}
      />
    </div>
  );
}

/** SVG circular progress arc for confidence score. */
function ConfArc({ value, color, size = 56 }: { value: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const fill = Math.min(Math.max(value, 0), 1);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={3.5} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={3.5}
        strokeDasharray={`${circ * fill} ${circ}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.7s cubic-bezier(.4,0,.2,1)" }}
      />
    </svg>
  );
}

/** Outer spinning dashed ring around ConfArc — shows AI is actively processing. */
function SpinRing({
  size = 68,
  color,
  active,
}: {
  size?: number;
  color: string;
  active: boolean;
}) {
  const mid = size / 2;
  const r1 = (size - 4) / 2;
  const r2 = r1 - 5;
  return (
    <svg
      width={size}
      height={size}
      style={{ position: "absolute", top: -(size - 52) / 2, left: -(size - 52) / 2, pointerEvents: "none" }}
    >
      <circle
        cx={mid}
        cy={mid}
        r={r1}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeDasharray="4 10"
        opacity={0.45}
        style={{
          animation: active ? "forge-rotate-cw 6s linear infinite" : "none",
          transformOrigin: `${mid}px ${mid}px`,
        }}
      />
      <circle
        cx={mid}
        cy={mid}
        r={r2}
        fill="none"
        stroke={color}
        strokeWidth={0.6}
        strokeDasharray="2 16"
        opacity={0.25}
        style={{
          animation: active ? "forge-rotate-ccw 10s linear infinite" : "none",
          transformOrigin: `${mid}px ${mid}px`,
        }}
      />
    </svg>
  );
}

/** GlitchNum — monospace numeric that briefly corrupts on value change. */
function GlitchNum({
  value,
  color,
  fontSize,
}: {
  value: string;
  color: string;
  fontSize: number;
}) {
  const [glitch, setGlitch] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setGlitch(true);
      const id = setTimeout(() => setGlitch(false), 520);
      return () => clearTimeout(id);
    }
  }, [value]);
  return (
    <span
      style={{
        fontSize,
        color,
        fontWeight: 700,
        ...mono,
        animation: glitch ? "forge-glitch 0.52s ease" : "none",
        display: "inline-block",
      }}
    >
      {value}
    </span>
  );
}

/** Radar sweep animation — Neural Core empty state focal point. */
function RadarPulse({ size = 88, color = C.accent }: { size?: number; color?: string }) {
  const cx = size / 2;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {[0.38, 0.62, 0.86].map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: `${((1 - s) / 2) * 100}%`,
            left: `${((1 - s) / 2) * 100}%`,
            width: `${s * 100}%`,
            height: `${s * 100}%`,
            borderRadius: "50%",
            border: `1px solid ${color}`,
            opacity: 0.08 + s * 0.18,
          }}
        />
      ))}
      {/* Conic sweep */}
      <div
        style={{
          position: "absolute",
          inset: 4,
          borderRadius: "50%",
          background: `conic-gradient(from 0deg, transparent 68%, ${color}70 100%)`,
          animation: "forge-radar 3s linear infinite",
        }}
      />
      {/* Center dot */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 14px ${color}`,
        }}
      />
    </div>
  );
}

/** Status system tag with animated bottom progress bar. */
function SysTag({
  label,
  value,
  subtext,
  color,
  barPct = 0,
  active = false,
  ripple = false,
}: {
  label: string;
  value: string;
  subtext: string;
  color: string;
  barPct?: number;
  active?: boolean;
  ripple?: boolean;
}) {
  return (
    <div
      style={{
        background: `${C.s2}80`,
        border: `1px solid ${color}30`,
        borderRadius: 8,
        padding: "10px 12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div style={{ fontSize: 8, color: C.dim, ...mono, letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <RippleDot color={color} active={active} ripple={ripple} />
        <span style={{ fontSize: 13, color, fontWeight: 700, ...mono }}>{value}</span>
      </div>
      <div style={{ fontSize: 9, color: C.dim, ...mono }}>{subtext}</div>
      {/* Animated bottom bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `${C.border}40`,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, Math.max(0, barPct))}%`,
            background: `linear-gradient(90deg, ${color}50, ${color})`,
            transition: "width 1.2s ease",
            animation: barPct > 0 ? "forge-bar-fill 1.2s ease" : "none",
          }}
        />
      </div>
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  kasData: any;
  agent: any;
  decisions: any[];
  queue: any[];
  loading: boolean;
  status: string;
  spendableKas: number;
  totalFees: number;
  pendingCount: number;
  paperPnlKas: number;
  execMode: string;
  liveConnected: boolean;
  liveExecutionArmed: boolean;
  onToggleAutoTrade: () => void;
  onRunCycle: () => void;
  onPauseResume: () => void;
  onExport: () => void;
  onKillSwitch: () => void;
  onNavigate: (tab: string) => void;
  lastDecision: any;
  lastDecisionSource: string;
  pnlAttribution: any;
  executionGuardrails: any;
  adaptiveAutoThreshold: any;
  stopLossState: any;
  activePortfolioRow: any;
  activeStrategyLabel: string;
  isMobile: boolean;
  isNarrowPhone: boolean;
  isTablet: boolean;
  summaryGridCols: string;
  splitGridCols: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function OverviewPanel({
  kasData,
  agent,
  decisions,
  queue,
  loading,
  status,
  spendableKas,
  totalFees,
  pendingCount,
  paperPnlKas,
  execMode,
  liveConnected,
  liveExecutionArmed,
  onToggleAutoTrade,
  onRunCycle,
  onPauseResume,
  onExport,
  onKillSwitch,
  onNavigate,
  lastDecision,
  lastDecisionSource,
  pnlAttribution,
  executionGuardrails,
  adaptiveAutoThreshold,
  stopLossState,
  activePortfolioRow,
  activeStrategyLabel,
  isMobile,
  isNarrowPhone,
  isTablet: _isTablet,
  summaryGridCols: _summaryGridCols,
  splitGridCols,
}: Props) {

  // ── 1. Price / balance data — re-runs only when kasData ticks ───────────────
  const priceMemo = useMemo(() => {
    const kasPrice  = Number(kasData?.priceUsd  || 0);
    const walletKas = Number(kasData?.walletKas || 0);
    const daaScore  = Number(kasData?.dag?.daaScore || 0);
    const nodeSyncState = kasData?.nodeStatus?.isSynced;
    const nodeIndexState = kasData?.nodeStatus?.isUtxoIndexed;
    const nodeReady = nodeSyncState === true && nodeIndexState === true;
    const nodeHealthLabel = nodeReady
      ? "READY"
      : nodeSyncState === false
        ? "SYNCING"
        : nodeIndexState === false
          ? "INDEXING"
          : "UNKNOWN";
    const nodeHealthColor = nodeReady
      ? C.ok
      : nodeSyncState === false || nodeIndexState === false
        ? C.warn
        : C.dim;
    const nodeHealthDetail = nodeReady
      ? "sync + index ok"
      : nodeSyncState === false
        ? "node behind tip"
        : nodeIndexState === false
          ? "utxo index warming"
          : "node health unknown";
    return {
      kasPrice,
      walletKas,
      walletUsd: walletKas * kasPrice,
      daaScore,
      daaLabel: daaScore > 0 ? `${(daaScore / 1_000_000).toFixed(2)}M` : "—",
      daaShort: daaScore > 0 ? String(daaScore).slice(-6) : "—",
      nodeReady,
      nodeHealthLabel,
      nodeHealthColor,
      nodeHealthDetail,
    };
  }, [kasData]);

  // ── 2. Chain / queue / PnL — re-runs on tx events ───────────────────────────
  const chainMemo = useMemo(() => {
    const confirmedTxs = queue?.filter((q: any) => q.status === "confirmed").length ?? 0;
    const pendingTxs   = queue?.filter((q: any) =>
      ["signed", "broadcasted", "pending"].includes(q.status)
    ).length ?? 0;
    const executedTxs  = queue?.filter((q: any) =>
      ["confirmed", "broadcasted"].includes(q.status)
    ).length ?? 0;
    const totalPnl  = pnlAttribution?.netPnlKas || 0;
    const netProfit = totalPnl - totalFees;
    // Sum KAS locked in un-confirmed outbound txs (pending + signed + broadcasted)
    const pendingOutflowKas = (queue || [])
      .filter((q: any) => ["pending", "signed", "broadcasted"].includes(String(q?.status || "")))
      .reduce((s: number, q: any) => s + Number(q?.amount_kas || 0), 0);
    return { confirmedTxs, pendingTxs, executedTxs, totalPnl, netProfit, pendingOutflowKas };
  }, [queue, pnlAttribution, totalFees]);

  // ── 3. Decision / AI data — re-runs on each quant cycle ─────────────────────
  const decMemo = useMemo(() => {
    const decSourceLabel =
      lastDecisionSource === "hybrid-ai"    ? "HYBRID AI"
      : lastDecisionSource === "ai"         ? "PURE AI"
      : lastDecisionSource === "quant-core" ? "QUANT CORE"
      : "FALLBACK";
    const decSourceColor =
      lastDecisionSource === "hybrid-ai"    ? C.accent
      : lastDecisionSource === "ai"         ? C.ok
      : C.text;
    const decSourceSub =
      lastDecisionSource === "hybrid-ai"    ? "AI + quant fusion"
      : lastDecisionSource === "ai"         ? "Claude neural"
      : "Local quant engine";

    const confScore = lastDecision?.confidence_score || 0;
    const confColor = confScore >= 0.8 ? C.ok : confScore >= 0.5 ? C.warn : C.danger;

    const riskScore = lastDecision?.risk_score ?? 0;
    const riskColor = riskScore <= 0.4 ? C.ok : riskScore <= 0.7 ? C.warn : C.danger;
    const riskLabel = riskScore <= 0.4 ? "SAFE" : riskScore <= 0.7 ? "CAUTION" : "BLOCKED";

    const signalAccuracy =
      decisions.length > 0
        ? Math.round(
            (decisions.filter(
              (d: any) => d?.dec?.action === "ACCUMULATE" || d?.dec?.action === "HOLD"
            ).length /
              decisions.length) *
              100
          )
        : 0;

    const agentRunning = status === "RUNNING";
    const agentPaused  = status === "PAUSED";
    const agentColor   = agentRunning ? C.ok : agentPaused ? C.warn : C.muted;

    return {
      decSourceLabel, decSourceColor, decSourceSub,
      confScore, confColor,
      riskScore, riskColor, riskLabel,
      signalAccuracy, agentRunning, agentPaused, agentColor,
    };
  }, [lastDecision, lastDecisionSource, decisions, status]);

  // ── 4. Layout — re-runs only on breakpoint changes ───────────────────────────
  const layoutMemo = useMemo(() => ({
    qCols: isNarrowPhone ? "1fr" : isMobile ? "repeat(2,1fr)" : "repeat(6,1fr)",
  }), [isNarrowPhone, isMobile]);

  const {
    kasPrice,
    walletKas,
    walletUsd,
    daaScore,
    daaLabel,
    daaShort,
    nodeReady,
    nodeHealthLabel,
    nodeHealthColor,
    nodeHealthDetail,
  } = priceMemo;
  const { confirmedTxs, executedTxs, totalPnl, netProfit, pendingOutflowKas } = chainMemo;
  const {
    decSourceLabel, decSourceColor, decSourceSub,
    confScore, confColor,
    riskScore, riskColor, riskLabel,
    signalAccuracy, agentRunning, agentPaused, agentColor,
  } = decMemo;
  const { qCols } = layoutMemo;

  const actionColor = lastDecision?.action === "ACCUMULATE" ? C.ok
    : lastDecision?.action === "REDUCE" ? C.danger
    : C.warn;

  // Deployed agent identity
  const agentId      = String(agent?.agentId || "").slice(0, 16);
  const deployedAt   = agent?.deployedAt ? new Date(Number(agent.deployedAt)).toLocaleDateString() : null;
  const deployTxId   = String(agent?.deployTx?.txid || "");
  const deployShort  = deployTxId ? `${deployTxId.slice(0, 12)}…` : null;

  // Decision continuity: compare live count vs snapshot (if available)
  const snapshotDecisions = Number(agent?._runtimeSnapshot?.totalDecisions || 0);
  const liveDecisions     = decisions.length;
  const decisionsSynced   = snapshotDecisions === 0 || liveDecisions >= snapshotDecisions;

  // ── Quick-stat data array ────────────────────────────────────────────────────
  const quickStats = useMemo(() => [
    { l: "SPENDABLE",   v: spendableKas.toFixed(2),   u: "KAS",      c: C.ok,     hi: C.ok },
    { l: "RESERVE",     v: String(RESERVE),            u: "KAS",      c: C.warn,   hi: C.warn },
    { l: "DAA HEIGHT",  v: daaShort,                   u: "BLOCK",    c: C.text,   hi: C.accent },
    { l: "PENDING",     v: String(pendingCount),       u: "TXS",      c: pendingCount > 0 ? C.warn : C.dim, hi: pendingCount > 0 ? C.warn : C.border },
    { l: "FEES PAID",   v: totalFees.toFixed(3),       u: "KAS",      c: C.text,   hi: C.border },
    { l: "CYCLE SIZE",  v: String(agent.capitalLimit), u: "KAS/CYC",  c: C.accent, hi: C.accent },
  ], [spendableKas, daaShort, pendingCount, totalFees, agent.capitalLimit]);

  // ── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Inject animations */}
      <style>{FORGE_CSS}</style>

      {/* ── 1. COMMAND CENTER HEADER ──────────────────────────────────────── */}
      <div
        data-testid="overview-portfolio-header"
        style={{
          position: "relative",
          marginBottom: 12,
          borderRadius: 12,
          overflow: "hidden",
          background:
            "linear-gradient(160deg, rgba(0,22,18,.97) 0%, rgba(5,7,10,.99) 55%, rgba(0,12,24,.97) 100%)",
          border: `1px solid ${C.accent}55`,
          boxShadow: `0 0 0 1px ${C.accent}14, 0 8px 48px ${C.accent}16, inset 0 0 120px rgba(57,221,182,.03)`,
        }}
      >
        {/* Holographic background grid */}
        <HoloGrid spacing={24} opacity={0.14} />

        <Brackets c={C.accent} sz={14} t={1.5} glow />

        {/* Scan beam */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: "28%",
            background: `linear-gradient(90deg, transparent, ${C.accent}05, transparent)`,
            animation: "forge-scan 9s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />

        {/* Top bar: breadcrumb + agent id + live indicators */}
        <div
          style={{
            padding: "8px 18px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: `1px solid ${C.accent}22`,
            background: `linear-gradient(90deg, ${C.accent}12 0%, transparent 55%)`,
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 9, color: C.accent, ...mono, letterSpacing: "0.28em", fontWeight: 700, animation: "forge-flicker 8s ease-in-out infinite" }}>
              FORGE.OS
            </span>
            <span style={{ fontSize: 9, color: `${C.accent}55`, ...mono }}>//</span>
            <span style={{ fontSize: 9, color: C.dim, ...mono, letterSpacing: "0.1em" }}>
              {activeStrategyLabel.toUpperCase()} · {execMode.toUpperCase()}
            </span>
            {agentId && (
              <>
                <span style={{ fontSize: 9, color: `${C.accent}40`, ...mono }}>·</span>
                <span style={{
                  fontSize: 8,
                  color: `${C.accent}90`,
                  ...mono,
                  letterSpacing: "0.08em",
                  background: `${C.accent}10`,
                  padding: "1px 6px",
                  borderRadius: 3,
                  border: `1px solid ${C.accent}25`,
                }}>
                  {agentId}
                </span>
              </>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {/* Decisions sync indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{
                fontSize: 8,
                color: decisionsSynced ? C.ok : C.warn,
                ...mono,
                background: `${decisionsSynced ? C.ok : C.warn}12`,
                padding: "1px 6px",
                borderRadius: 3,
                border: `1px solid ${decisionsSynced ? C.ok : C.warn}30`,
              }}>
                {liveDecisions} DECISIONS
              </span>
            </div>
            {/* Network dot */}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <RippleDot color={liveConnected ? C.ok : C.danger} active={liveConnected} ripple={liveConnected} />
              <span style={{ fontSize: 9, color: liveConnected ? C.ok : C.danger, fontWeight: 700, ...mono }}>
                {liveConnected ? "LIVE" : "OFFLINE"}
              </span>
            </div>
            <span style={{ color: `${C.accent}30`, fontSize: 10 }}>│</span>
            {/* Agent dot */}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <RippleDot color={agentColor} active={agentRunning} />
              <span style={{ fontSize: 9, color: agentColor, fontWeight: 700, ...mono }}>
                {status}
              </span>
            </div>
            {execMode === "paper" && (
              <>
                <span style={{ color: `${C.accent}30`, fontSize: 10 }}>│</span>
                <span style={{ fontSize: 9, color: C.warn, ...mono, fontWeight: 700, letterSpacing: "0.1em" }}>
                  PAPER MODE
                </span>
              </>
            )}
          </div>
        </div>

        {/* Deployed agent identity row */}
        {(deployedAt || deployShort) && (
          <div style={{
            padding: "5px 18px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: `${C.accent}06`,
            borderBottom: `1px solid ${C.accent}14`,
            flexWrap: "wrap",
          }}>
            <span style={{ fontSize: 8, color: C.ok, ...mono, letterSpacing: "0.12em", fontWeight: 700 }}>
              ◆ DEPLOYED
            </span>
            {deployedAt && (
              <span style={{ fontSize: 8, color: C.dim, ...mono }}>{deployedAt}</span>
            )}
            {deployShort && deployTxId && (
              <>
                <span style={{ fontSize: 8, color: `${C.accent}35`, ...mono }}>·</span>
                <ExtLink href={`${EXPLORER}/txs/${deployTxId}`} label={`TX ${deployShort}`} />
              </>
            )}
            {agent?.deployTx?.status && (
              <Badge
                text={String(agent.deployTx.status).toUpperCase()}
                color={agent.deployTx.status === "confirmed" ? C.ok : C.warn}
              />
            )}
          </div>
        )}

        {/* Balance + price row */}
        <div
          style={{
            padding: isMobile ? "16px 14px" : "18px 24px",
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            justifyContent: "space-between",
            alignItems: isMobile ? "stretch" : "flex-start",
            gap: isMobile ? 14 : 0,
            borderBottom: `1px solid ${C.border}40`,
          }}
        >
          {/* KAS balance */}
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, minWidth: 0 }}>
            <img
              src="/kaspa-logo.png"
              alt="KAS"
              width={isMobile ? 44 : 52}
              height={isMobile ? 44 : 52}
              style={{
                borderRadius: "50%",
                flexShrink: 0,
                objectFit: "cover",
                display: "block",
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 9,
                  color: C.accent,
                  ...mono,
                  letterSpacing: "0.2em",
                  marginBottom: 5,
                  fontWeight: 700,
                }}
              >
                ◆ PORTFOLIO BALANCE
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, lineHeight: 1 }}>
                <GlitchNum
                  value={loading && walletKas === 0 ? "···" : walletKas > 0 ? walletKas.toFixed(2) : "0.00"}
                  color={C.accent}
                  fontSize={isNarrowPhone ? 26 : isMobile ? 30 : 40}
                />
                <span style={{ fontSize: isNarrowPhone ? 14 : isMobile ? 16 : 20, color: C.dim, ...mono }}>
                  KAS
                </span>
              </div>
              {kasPrice > 0 && (
                <div style={{ fontSize: isMobile ? 13 : 15, color: C.text, ...mono, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                  ${walletUsd.toFixed(2)}
                  <span style={{ fontSize: 10, background: `${C.ok}20`, color: C.ok, padding: "2px 8px", borderRadius: 4, border: `1px solid ${C.ok}30`, ...mono }}>
                    USD
                  </span>
                </div>
              )}
              {/* Pending outflows */}
              {pendingOutflowKas > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5 }}>
                  <span style={{ fontSize: 9, color: C.warn, ...mono }}>
                    -{pendingOutflowKas.toFixed(2)} KAS pending
                  </span>
                  <span style={{ fontSize: 9, color: C.dim, ...mono }}>
                    · effective {Math.max(0, walletKas - pendingOutflowKas).toFixed(2)} KAS
                  </span>
                </div>
              )}
              {/* Wallet address match indicator */}
              {(() => {
                const feedAddr  = String(kasData?.address || "").toLowerCase();
                const agentAddr = String(agent?.wallet?.address || "").toLowerCase();
                if (!feedAddr || !agentAddr) return null;
                const matched = feedAddr === agentAddr;
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5 }}>
                    <span style={{
                      fontSize: 8,
                      color: matched ? C.ok : C.danger,
                      background: matched ? `${C.ok}14` : `${C.danger}14`,
                      border: `1px solid ${matched ? C.ok : C.danger}30`,
                      borderRadius: 3,
                      padding: "1px 6px",
                      ...mono,
                    }}>
                      {matched ? "● WALLET MATCHED" : "⚠ WALLET MISMATCH"}
                    </span>
                    <span style={{ fontSize: 8, color: C.dim, ...mono }}>
                      {`${feedAddr.slice(6, 14)}…${feedAddr.slice(-6)}`}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Right: price + DAA */}
          <div
            style={{
              display: "flex",
              flexDirection: isMobile ? "row" : "column",
              gap: 8,
              alignItems: isMobile ? "center" : "flex-end",
              justifyContent: isMobile ? "space-between" : "flex-start",
            }}
          >
            <div
              style={{
                background: `${C.s2}90`,
                padding: isMobile ? "8px 12px" : "10px 16px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
              }}
            >
              <div style={{ fontSize: 8, color: C.dim, ...mono, letterSpacing: "0.15em", marginBottom: 4 }}>
                KAS / USD
              </div>
              <GlitchNum
                value={`$${kasPrice.toFixed(4)}`}
                color={C.text}
                fontSize={isMobile ? 16 : 22}
              />
            </div>
            <div
              style={{
                background: `${C.accent}12`,
                padding: isMobile ? "8px 12px" : "10px 16px",
                borderRadius: 8,
                border: `1px solid ${C.accent}28`,
              }}
            >
              <div style={{ fontSize: 8, color: C.accent, ...mono, letterSpacing: "0.15em", marginBottom: 4 }}>
                DAA SCORE
              </div>
              <div style={{ fontSize: isMobile ? 14 : 18, color: C.accent, fontWeight: 700, ...mono }}>
                {daaLabel}
              </div>
            </div>
          </div>
        </div>

        {/* Quick stats grid */}
        <div
          data-testid="overview-quick-stats"
          style={{
            display: "grid",
            gridTemplateColumns: qCols,
            gap: 0,
            borderBottom: `1px solid ${C.border}40`,
          }}
        >
          {quickStats.map(({ l, v, u, c, hi }, i) => (
            <div
              key={l}
              style={{
                padding: "11px 8px",
                textAlign: "center",
                background: `${hi}08`,
                borderRight: i < quickStats.length - 1 ? `1px solid ${C.border}30` : "none",
                position: "relative",
              }}
            >
              <div
                style={{
                  height: 2,
                  background: `linear-gradient(90deg, transparent, ${hi}65, transparent)`,
                  marginBottom: 8,
                }}
              />
              <div style={{ fontSize: 8, color: C.dim, ...mono, letterSpacing: "0.12em", marginBottom: 4 }}>
                {l}
              </div>
              <GlitchNum value={v} color={c} fontSize={isMobile ? 15 : 17} />
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginTop: 3 }}>{u}</div>
            </div>
          ))}
          {execMode === "paper" && (
            <div
              style={{
                padding: "11px 8px",
                textAlign: "center",
                background: `${paperPnlKas >= 0 ? C.ok : C.danger}10`,
                gridColumn: isMobile ? "span 2" : "auto",
                position: "relative",
              }}
            >
              <div
                style={{
                  height: 2,
                  background: `linear-gradient(90deg, transparent, ${(paperPnlKas >= 0 ? C.ok : C.danger)}55, transparent)`,
                  marginBottom: 8,
                }}
              />
              <div style={{ fontSize: 8, color: C.warn, ...mono, letterSpacing: "0.12em", marginBottom: 4 }}>
                SIM P&L
              </div>
              <div
                style={{
                  fontSize: 17,
                  color: paperPnlKas >= 0 ? C.ok : C.danger,
                  fontWeight: 700,
                  ...mono,
                  lineHeight: 1,
                }}
              >
                {paperPnlKas >= 0 ? "+" : ""}
                {paperPnlKas.toFixed(2)}
              </div>
              <div style={{ fontSize: 8, color: C.warn, ...mono, marginTop: 3 }}>PAPER KAS</div>
            </div>
          )}
        </div>

        {/* Action bar */}
        <div
          style={{
            padding: isMobile ? "10px 14px" : "11px 20px",
            display: "flex",
            gap: 7,
            alignItems: "center",
            flexWrap: "wrap",
            background: "rgba(0,0,0,.3)",
          }}
        >
          <Btn
            onClick={onRunCycle}
            disabled={loading || !agentRunning}
            size="sm"
            style={{
              background: loading
                ? `${C.accent}18`
                : `linear-gradient(135deg, ${C.accent}30, ${C.accent}12)`,
              border: `1px solid ${C.accent}60`,
              color: C.accent,
              fontWeight: 700,
              letterSpacing: "0.06em",
              boxShadow: loading ? "none" : `0 0 12px ${C.accent}20`,
            }}
          >
            {loading ? "RUNNING..." : "RUN CYCLE"}
          </Btn>
          <Btn
            onClick={onToggleAutoTrade}
            variant={liveExecutionArmed ? "warn" : "primary"}
            size="sm"
          >
            {liveExecutionArmed ? "AUTO-TRADE: ON" : "AUTO-TRADE: OFF"}
          </Btn>
          <Btn onClick={onPauseResume} variant="ghost" size="sm">
            {agentRunning ? "PAUSE" : "RESUME"}
          </Btn>
          <Btn onClick={onExport} variant="ghost" size="sm">
            EXPORT
          </Btn>
          <Btn onClick={onKillSwitch} variant="danger" size="sm">
            KILL-SWITCH
          </Btn>
        </div>
      </div>

      {/* ── 2. SYSTEM STATUS ROW ──────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <SysTag
          label="NETWORK"
          value={liveConnected ? nodeHealthLabel : "OFFLINE"}
          subtext={liveConnected ? `kaspa mainnet · ${nodeHealthDetail}` : "kaspa feed offline"}
          color={liveConnected ? nodeHealthColor : C.danger}
          barPct={liveConnected ? (nodeReady ? 100 : nodeHealthLabel === "INDEXING" ? 72 : nodeHealthLabel === "SYNCING" ? 56 : 40) : 0}
          active={liveConnected && nodeReady}
          ripple={liveConnected && nodeReady}
        />
        <SysTag
          label="AGENT"
          value={status}
          subtext={activeStrategyLabel}
          color={agentColor}
          barPct={agentRunning ? 100 : agentPaused ? 50 : 10}
          active={agentRunning}
        />
        <SysTag
          label="AUTO-TRADE"
          value={liveExecutionArmed ? "ARMED" : "MANUAL"}
          subtext={`≤ ${adaptiveAutoThreshold?.thresholdKas?.toFixed(2) ?? "—"} KAS auto`}
          color={liveExecutionArmed ? C.warn : C.dim}
          barPct={liveExecutionArmed ? (adaptiveAutoThreshold?.thresholdKas ?? 0) / 5 : 0}
          active={liveExecutionArmed}
        />
        <SysTag
          label="PORTFOLIO CAP"
          value={activePortfolioRow?.cycleCapKas ? `${activePortfolioRow.cycleCapKas} KAS` : "UNCAPPED"}
          subtext={
            totalPnl !== 0
              ? `P&L: ${totalPnl > 0 ? "+" : ""}${totalPnl.toFixed(3)} KAS`
              : "No P&L data yet"
          }
          color={C.accent}
          barPct={activePortfolioRow?.cycleCapKas ? Math.min(100, (spendableKas / activePortfolioRow.cycleCapKas) * 100) : 60}
          active
        />
      </div>

      {/* ── 3. NEURAL CORE INTELLIGENCE ──────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          marginBottom: 12,
          borderRadius: 12,
          overflow: "hidden",
          background: lastDecision
            ? "linear-gradient(160deg, rgba(0,20,16,.98) 0%, rgba(5,7,10,.99) 60%)"
            : `${C.s2}`,
          border: `1px solid ${lastDecision ? C.accent + "45" : C.border}`,
          boxShadow: lastDecision ? `0 4px 36px ${C.accent}14` : "none",
        }}
      >
        {lastDecision && <HoloGrid spacing={28} opacity={0.1} />}
        {lastDecision && <Brackets c={C.accent} sz={10} t={1} />}

        {/* Neural Core header */}
        <div
          style={{
            padding: "12px 18px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: `1px solid ${C.accent}22`,
            background: `linear-gradient(90deg, ${C.accent}14 0%, transparent 65%)`,
            position: "relative",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <RippleDot
              color={agentRunning && lastDecision ? C.ok : agentRunning ? C.warn : C.muted}
              active={agentRunning && !!lastDecision}
              ripple={agentRunning && !!lastDecision}
            />
            <span
              style={{
                fontSize: 12,
                color: C.text,
                fontWeight: 700,
                ...mono,
                animation: agentRunning ? "forge-glow 4s ease-in-out infinite" : "none",
              }}
            >
              ◆ NEURAL CORE INTELLIGENCE
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {lastDecision && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  background: `${C.s2}90`,
                  padding: "4px 10px",
                  borderRadius: 20,
                  border: `1px solid ${C.border}`,
                }}
              >
                <span style={{ fontSize: 9, color: C.dim, ...mono }}>LATENCY</span>
                <span style={{ fontSize: 10, color: C.accent, fontWeight: 700, ...mono }}>
                  {lastDecision?.dec?.engine_latency_ms || 0}ms
                </span>
              </div>
            )}
            <Badge
              text={agentRunning ? "ACTIVE" : agentPaused ? "PAUSED" : "IDLE"}
              color={agentColor}
            />
            {lastDecision && <Badge text={lastDecision.action || "—"} color={actionColor} />}
          </div>
        </div>

        {lastDecision ? (
          <div style={{ padding: 18, position: "relative", zIndex: 1 }}>

            {/* Primary metrics row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1.4fr 1fr 1fr",
                gap: 10,
                marginBottom: 14,
              }}
            >
              {/* Decision source */}
              <div
                style={{
                  background: `${C.s1}80`,
                  borderRadius: 8,
                  padding: "12px 14px",
                  border: `1px solid ${decSourceColor}35`,
                  boxShadow: `inset 0 0 20px ${decSourceColor}06`,
                }}
              >
                <div
                  style={{
                    fontSize: 8,
                    color: C.dim,
                    ...mono,
                    letterSpacing: "0.1em",
                    marginBottom: 8,
                  }}
                >
                  DECISION SOURCE
                </div>
                <div style={{ fontSize: 16, color: decSourceColor, fontWeight: 700, ...mono }}>
                  {decSourceLabel}
                </div>
                <div style={{ fontSize: 9, color: C.dim, marginTop: 5 }}>{decSourceSub}</div>
              </div>

              {/* Confidence with SVG arc + SpinRing */}
              <div
                style={{
                  background: `${C.s1}80`,
                  borderRadius: 8,
                  padding: "12px 14px",
                  border: `1px solid ${confColor}35`,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <SpinRing size={68} color={confColor} active={agentRunning && !!lastDecision} />
                  <ConfArc value={confScore} color={confColor} size={52} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 8,
                      color: C.dim,
                      ...mono,
                      letterSpacing: "0.1em",
                      marginBottom: 6,
                    }}
                  >
                    CONFIDENCE
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                    <GlitchNum
                      value={(confScore * 100).toFixed(0)}
                      color={confColor}
                      fontSize={26}
                    />
                    <span style={{ fontSize: 12, color: C.dim, ...mono }}>%</span>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      height: 3,
                      background: C.s1,
                      borderRadius: 2,
                      overflow: "hidden",
                      width: 80,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${confScore * 100}%`,
                        background: confColor,
                        borderRadius: 2,
                        transition: "width .6s ease",
                        boxShadow: `0 0 6px ${confColor}`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Kelly sizing */}
              <div
                style={{
                  background: `${C.s1}80`,
                  borderRadius: 8,
                  padding: "12px 14px",
                  border: `1px solid ${C.accent}28`,
                }}
              >
                <div
                  style={{
                    fontSize: 8,
                    color: C.dim,
                    ...mono,
                    letterSpacing: "0.1em",
                    marginBottom: 8,
                  }}
                >
                  KELLY SIZING
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                  <GlitchNum
                    value={(lastDecision.kelly_fraction * 100).toFixed(1)}
                    color={C.accent}
                    fontSize={24}
                  />
                  <span style={{ fontSize: 12, color: C.dim, ...mono }}>%</span>
                </div>
                <div style={{ fontSize: 9, color: C.dim, marginTop: 5 }}>Position multiplier</div>
              </div>

              {/* Monte Carlo */}
              <div
                style={{
                  background: `${C.s1}80`,
                  borderRadius: 8,
                  padding: "12px 14px",
                  border: `1px solid ${C.ok}28`,
                }}
              >
                <div
                  style={{
                    fontSize: 8,
                    color: C.dim,
                    ...mono,
                    letterSpacing: "0.1em",
                    marginBottom: 8,
                  }}
                >
                  MONTE CARLO
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                  <GlitchNum
                    value={String(lastDecision.monte_carlo_win_pct)}
                    color={C.ok}
                    fontSize={24}
                  />
                  <span style={{ fontSize: 12, color: C.dim, ...mono }}>%</span>
                </div>
                <div style={{ fontSize: 9, color: C.dim, marginTop: 5 }}>Win probability</div>
              </div>
            </div>

            {/* Quant core metrics — compact table */}
            {lastDecision.quant_metrics && (
              <div
                style={{
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  overflow: "hidden",
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    padding: "7px 14px",
                    background: `${C.accent}10`,
                    borderBottom: `1px solid ${C.border}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      color: C.accent,
                      fontWeight: 700,
                      ...mono,
                      letterSpacing: "0.12em",
                    }}
                  >
                    QUANT CORE METRICS
                  </span>
                  {lastDecision.quant_metrics.ai_overlay_applied && (
                    <Badge text="AI OVERLAY" color={C.accent} />
                  )}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5,1fr)",
                    gap: 0,
                    padding: "12px 14px",
                  }}
                >
                  {(
                    [
                      ["SAMPLES",      String(lastDecision.quant_metrics.sample_count ?? "—"), C.text],
                      ["EDGE SCORE",   Number(lastDecision.quant_metrics.edge_score || 0).toFixed(4), Number(lastDecision.quant_metrics.edge_score) > 0 ? C.ok : C.warn],
                      ["VOLATILITY",   Number(lastDecision.quant_metrics.ewma_volatility || 0).toFixed(4), C.text],
                      ["DATA QUALITY", `${((lastDecision.quant_metrics.data_quality_score || 0) * 100).toFixed(0)}%`, (lastDecision.quant_metrics.data_quality_score || 0) >= 0.7 ? C.ok : C.warn],
                      ["REGIME",       String(lastDecision.quant_metrics.regime || "N/A").replace(/_/g, " "), lastDecision.quant_metrics.regime === "RISK_ON" ? C.ok : lastDecision.quant_metrics.regime === "RISK_OFF" ? C.danger : C.warn],
                    ] as [string, string, string][]
                  ).map(([l, v, c]) => (
                    <div key={l} style={{ paddingRight: 12 }}>
                      <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 4, letterSpacing: "0.08em" }}>{l}</div>
                      <div style={{ fontSize: 14, color: c, fontWeight: 700, ...mono }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk / Capital / Network strip */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,1fr)",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  background: `${riskColor}10`,
                  borderRadius: 8,
                  padding: "10px 14px",
                  border: `1px solid ${riskColor}35`,
                  boxShadow: `inset 0 0 14px ${riskColor}08`,
                }}
              >
                <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 4 }}>RISK SCORE</div>
                <GlitchNum value={riskScore.toFixed(3)} color={riskColor} fontSize={20} />
                <div style={{ fontSize: 9, color: riskColor, marginTop: 3, ...mono }}>{riskLabel}</div>
              </div>

              <div
                style={{
                  background: `${C.accent}0D`,
                  borderRadius: 8,
                  padding: "10px 14px",
                  border: `1px solid ${C.accent}35`,
                }}
              >
                <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 4 }}>CAPITAL ALLOC</div>
                <GlitchNum
                  value={String(lastDecision.capital_allocation_kas)}
                  color={C.accent}
                  fontSize={20}
                />
                <span style={{ fontSize: 11, color: C.dim }}> KAS</span>
                <div style={{ fontSize: 9, color: C.dim, marginTop: 3 }}>
                  ≈ ${(Number(lastDecision.capital_allocation_kas) * kasPrice).toFixed(2)} USD
                </div>
              </div>

              <div
                style={{
                  background: `${C.s1}80`,
                  borderRadius: 8,
                  padding: "10px 14px",
                  border: `1px solid ${C.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 4 }}>NETWORK</div>
                  <div
                    style={{
                      fontSize: 18,
                      color: liveConnected ? nodeHealthColor : C.danger,
                      fontWeight: 700,
                      ...mono,
                    }}
                  >
                    {liveConnected ? nodeHealthLabel : "OFFLINE"}
                  </div>
                  <div style={{ fontSize: 9, color: C.dim, marginTop: 3 }}>
                    {daaScore > 0
                      ? `DAA ${(daaScore / 1_000_000).toFixed(2)}M · ${nodeHealthDetail}`
                      : nodeHealthDetail}
                  </div>
                </div>
                <RippleDot
                  color={liveConnected ? nodeHealthColor : C.danger}
                  active={liveConnected && nodeReady}
                  ripple={liveConnected && nodeReady}
                />
              </div>
            </div>

            {/* AI Rationale — terminal box with scanline overlay */}
            <div
              style={{
                borderRadius: 8,
                overflow: "hidden",
                marginBottom: 14,
                border: `1px solid ${C.accent}28`,
                position: "relative",
              }}
            >
              <div
                style={{
                  padding: "6px 14px",
                  background: `${C.accent}0D`,
                  borderBottom: `1px solid ${C.accent}22`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 9,
                      color: C.accent,
                      fontWeight: 700,
                      ...mono,
                      letterSpacing: "0.12em",
                    }}
                  >
                    &gt; AI RATIONALE
                  </span>
                  {/* Blinking cursor */}
                  <span
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 12,
                      background: C.accent,
                      animation: "forge-blink 1.1s step-end infinite",
                      verticalAlign: "middle",
                    }}
                  />
                </div>
                {lastDecision.quant_metrics?.ai_overlay_applied && (
                  <Badge text="OVERLAY ACTIVE" color={C.accent} />
                )}
              </div>
              {/* Scanline overlay */}
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  height: "18%",
                  background: `linear-gradient(to bottom, transparent, ${C.accent}06, transparent)`,
                  animation: "forge-scanline 5s linear infinite",
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              />
              <div
                style={{
                  padding: "12px 16px",
                  background: "rgba(0,0,0,.35)",
                  fontSize: 12,
                  color: C.text,
                  ...mono,
                  lineHeight: 1.65,
                  maxHeight: 100,
                  overflowY: "auto",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                {lastDecision.rationale}
              </div>
            </div>

            {/* Status badges row */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {lastDecision.quant_metrics?.regime && (
                <Badge
                  text={String(lastDecision.quant_metrics.regime).replace(/_/g, " ")}
                  color={
                    lastDecision.quant_metrics.regime === "RISK_ON"
                      ? C.ok
                      : lastDecision.quant_metrics.regime === "RISK_OFF"
                      ? C.danger
                      : C.warn
                  }
                />
              )}
              <Badge text={`RISK ${riskScore.toFixed(2)}`} color={riskColor} />
              <Badge text={`${lastDecision.capital_allocation_kas} KAS`} color={C.text} />
              {executionGuardrails?.calibration?.tier && (
                <Badge
                  text={`CAL: ${executionGuardrails.calibration.tier.toUpperCase()}`}
                  color={executionGuardrails.calibration.tier === "healthy" ? C.ok : C.warn}
                />
              )}
              <Badge
                text={executionGuardrails?.truth?.degraded ? "TRUTH DEGRADED" : "VERIFIED"}
                color={executionGuardrails?.truth?.degraded ? C.danger : C.ok}
              />
              <Badge
                text={`${liveDecisions} SIGNALS`}
                color={C.accent}
              />
            </div>
          </div>
        ) : (
          /* Empty state — radar sweep */
          <div
            style={{
              padding: "48px 24px 40px",
              textAlign: "center",
              background: `linear-gradient(180deg, ${C.s2} 0%, ${C.s1} 100%)`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 0,
              position: "relative",
              zIndex: 1,
            }}
          >
            <div style={{ marginBottom: 20 }}>
              <RadarPulse size={90} color={C.accent} />
            </div>
            <div
              style={{
                fontSize: 15,
                color: C.text,
                fontWeight: 700,
                ...mono,
                marginBottom: 8,
                animation: "forge-glow 3s ease-in-out infinite",
              }}
            >
              Neural Core Ready
            </div>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 20 }}>
              Run a quant cycle to activate trading intelligence
              {agentId && (
                <span style={{ display: "block", fontSize: 10, color: `${C.accent}70`, marginTop: 4, ...mono }}>
                  Agent {agentId} · {liveDecisions} decisions loaded
                </span>
              )}
            </div>
            <Btn
              onClick={onRunCycle}
              disabled={loading || !agentRunning}
              style={{ padding: "11px 32px", fontSize: 13, boxShadow: `0 0 20px ${C.accent}25` }}
            >
              {loading ? "PROCESSING..." : "ACTIVATE NEURAL CORE"}
            </Btn>
          </div>
        )}
      </div>

      {/* ── 4. CHAIN EVENT FEED ───────────────────────────────────────────────── */}
      {queue && queue.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            borderRadius: 10,
            overflow: "hidden",
            border: `1px solid ${C.ok}28`,
            background: `${C.s2}`,
          }}
        >
          <div
            style={{
              padding: "10px 18px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: `1px solid ${C.border}`,
              background: `linear-gradient(90deg, ${C.ok}10 0%, transparent 65%)`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <RippleDot color={C.ok} active ripple />
              <span
                style={{
                  fontSize: 11,
                  color: C.ok,
                  fontWeight: 700,
                  ...mono,
                  letterSpacing: "0.1em",
                }}
              >
                CHAIN EVENT FEED
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <Badge text={`${confirmedTxs} CONFIRMED`} color={C.ok} />
              <Badge
                text={`${queue.filter((q: any) => q.status === "signed" || q.status === "broadcasted").length} PENDING`}
                color={C.warn}
              />
            </div>
          </div>

          <div style={{ maxHeight: 190, overflowY: "auto", fontFamily: "monospace" }}>
            {queue.slice(0, 5).map((item: any, i: number) => {
              const isConfirmed = item.receipt_lifecycle === "confirmed";
              const isPending = item.status === "signed" || item.status === "broadcasted" || item.status === "pending";
              const rowAccent = isConfirmed ? C.ok : isPending ? C.warn : C.dim;
              return (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "60px 70px 1fr 80px" : "70px 80px 1fr 100px 70px",
                    gap: 6,
                    padding: "9px 18px",
                    borderBottom: `1px solid ${C.border}`,
                    background: `${rowAccent}06`,
                    borderLeft: `2px solid ${rowAccent}55`,
                    alignItems: "center",
                    animation: `forge-slide-in 0.35s ease ${i * 0.05}s both`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 9, color: C.dim, ...mono }}>ACTION</div>
                    <div
                      style={{
                        fontSize: 11,
                        color:
                          item.type === "ACCUMULATE"
                            ? C.ok
                            : item.type === "REDUCE"
                            ? C.danger
                            : C.text,
                        fontWeight: 700,
                        ...mono,
                      }}
                    >
                      {item.type || "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: C.dim, ...mono }}>AMOUNT</div>
                    <div style={{ fontSize: 11, color: C.text, fontWeight: 700, ...mono }}>
                      {item.amount_kas} KAS
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 9, color: C.dim, ...mono }}>TXID</div>
                    <div
                      style={{
                        fontSize: 10,
                        color: C.accent,
                        ...mono,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.txid ? `${item.txid.slice(0, 22)}…` : "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: C.dim, ...mono }}>STATUS</div>
                    <Badge
                      text={
                        isConfirmed
                          ? "CONFIRMED"
                          : isPending
                          ? "PENDING"
                          : item.status?.toUpperCase() || "—"
                      }
                      color={rowAccent}
                    />
                  </div>
                  {!isMobile && (
                    <div>
                      {item.txid && (
                        <ExtLink href={`${EXPLORER}/txs/${item.txid}`} label="VERIFY" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div
            style={{
              padding: "8px 18px",
              borderTop: `1px solid ${C.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 10, color: C.dim, ...mono }}>{queue.length} total events</span>
            <Btn onClick={() => onNavigate("queue")} variant="ghost" size="sm">
              FULL QUEUE →
            </Btn>
          </div>
        </div>
      )}

      {/* ── 5. PERFORMANCE MATRIX ─────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          marginBottom: 12,
          borderRadius: 12,
          overflow: "hidden",
          background: "linear-gradient(160deg, rgba(0,20,14,.97) 0%, rgba(5,7,10,.99) 60%)",
          border: `1px solid ${C.ok}30`,
          boxShadow: `0 4px 32px ${C.ok}09`,
        }}
      >
        <HoloGrid color={C.ok} spacing={26} opacity={0.09} />
        <Brackets c={C.ok} sz={10} t={1} />

        {/* Header */}
        <div
          style={{
            padding: "10px 18px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: `1px solid ${C.ok}22`,
            background: `linear-gradient(90deg, ${C.ok}10 0%, transparent 60%)`,
            position: "relative",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 9, color: C.ok, ...mono, letterSpacing: "0.15em" }}>◆</span>
            <span style={{ fontSize: 12, color: C.text, fontWeight: 700, ...mono }}>
              PERFORMANCE MATRIX
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: `${C.s2}90`,
                padding: "4px 10px",
                borderRadius: 20,
                border: `1px solid ${C.border}`,
              }}
            >
              <span style={{ fontSize: 9, color: C.dim, ...mono }}>SESSION P&L</span>
              <span
                style={{
                  fontSize: 11,
                  color: totalPnl > 0 ? C.ok : totalPnl < 0 ? C.danger : C.dim,
                  fontWeight: 700,
                  ...mono,
                }}
              >
                {totalPnl > 0 ? "+" : ""}
                {totalPnl.toFixed(4)} KAS
              </span>
            </div>
            <Badge text={`${confirmedTxs} TXS`} color={C.accent} />
          </div>
        </div>

        <div style={{ padding: "16px 18px", position: "relative", zIndex: 1 }}>

          {/* Primary 5-cell grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5,1fr)",
              gap: 8,
              marginBottom: 12,
            }}
          >
            {/* P&L */}
            <div
              style={{
                background: `${totalPnl > 0 ? C.ok : totalPnl < 0 ? C.danger : C.border}12`,
                borderRadius: 8,
                padding: 12,
                border: `1px solid ${totalPnl > 0 ? C.ok : totalPnl < 0 ? C.danger : C.border}38`,
                boxShadow: `inset 0 0 16px ${totalPnl > 0 ? C.ok : totalPnl < 0 ? C.danger : C.border}08`,
              }}
            >
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 6 }}>TOTAL P&L</div>
              <GlitchNum
                value={`${totalPnl > 0 ? "+" : ""}${totalPnl.toFixed(4)}`}
                color={totalPnl > 0 ? C.ok : totalPnl < 0 ? C.danger : C.dim}
                fontSize={20}
              />
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginTop: 3 }}>KAS</div>
            </div>

            {/* Trades */}
            <div style={{ background: `${C.s1}80`, borderRadius: 8, padding: 12, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 6 }}>TRADES</div>
              <GlitchNum value={String(executedTxs)} color={C.accent} fontSize={20} />
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginTop: 3 }}>EXECUTIONS</div>
            </div>

            {/* Win rate */}
            <div style={{ background: `${C.s1}80`, borderRadius: 8, padding: 12, border: `1px solid ${C.ok}28` }}>
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 6 }}>WIN RATE</div>
              <GlitchNum
                value={`${pnlAttribution?.winRatePct || 0}%`}
                color={C.ok}
                fontSize={20}
              />
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginTop: 3 }}>PROFIT RATE</div>
            </div>

            {/* Avg win */}
            <div style={{ background: `${C.s1}80`, borderRadius: 8, padding: 12, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 6 }}>AVG WIN</div>
              <GlitchNum
                value={`+${Number(pnlAttribution?.avgProfitKas || 0).toFixed(4)}`}
                color={C.ok}
                fontSize={20}
              />
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginTop: 3 }}>KAS / WIN</div>
            </div>

            {/* Best trade */}
            <div style={{ background: `${C.s1}80`, borderRadius: 8, padding: 12, border: `1px solid ${C.ok}38` }}>
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 6 }}>BEST TRADE</div>
              <GlitchNum
                value={`+${Number(pnlAttribution?.bestTradeKas || 0).toFixed(4)}`}
                color={C.ok}
                fontSize={20}
              />
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginTop: 3 }}>KAS ALL-TIME</div>
            </div>
          </div>

          {/* Secondary 4-cell grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <div style={{ background: `${C.s1}80`, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 4 }}>TOTAL FEES</div>
              <div style={{ fontSize: 16, color: C.warn, fontWeight: 700, ...mono }}>
                -{totalFees.toFixed(4)}
              </div>
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginTop: 2 }}>KAS PAID</div>
            </div>
            <div
              style={{
                background: `${netProfit > 0 ? C.ok : netProfit < 0 ? C.danger : C.border}10`,
                borderRadius: 8,
                padding: "10px 12px",
                border: `1px solid ${netProfit > 0 ? C.ok : netProfit < 0 ? C.danger : C.border}32`,
              }}
            >
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 4 }}>NET PROFIT</div>
              <div
                style={{
                  fontSize: 16,
                  color: netProfit > 0 ? C.ok : netProfit < 0 ? C.danger : C.dim,
                  fontWeight: 700,
                  ...mono,
                }}
              >
                {netProfit > 0 ? "+" : ""}
                {netProfit.toFixed(4)}
              </div>
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginTop: 2 }}>AFTER FEES</div>
            </div>
            <div style={{ background: `${C.s1}80`, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 4 }}>DECISIONS</div>
              <div style={{ fontSize: 16, color: C.text, fontWeight: 700, ...mono }}>
                {decisions.length}
              </div>
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginTop: 2 }}>AI SIGNALS</div>
            </div>
            <div style={{ background: `${C.s1}80`, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 4 }}>SIGNAL ACC.</div>
              <div style={{ fontSize: 16, color: C.accent, fontWeight: 700, ...mono }}>
                {signalAccuracy}%
              </div>
              <div style={{ fontSize: 8, color: C.dim, ...mono, marginTop: 2 }}>ACCURACY</div>
            </div>
          </div>

          {/* Footer info row */}
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Badge text={`Budget: ${agent.capitalLimit} KAS/cycle`} color={C.accent} />
              <Badge text={`Target: ${agent.kpiTarget}% ROI`} color={C.ok} />
              <Badge text={`Cycle: ${AUTO_CYCLE_SECONDS}s`} color={C.text} />
            </div>
            <Btn onClick={() => onNavigate("analytics")} variant="ghost" size="sm">
              FULL ANALYTICS →
            </Btn>
          </div>
        </div>
      </div>

      {/* ── 6. AGENT OVERVIEW + PERF CHART (lazy) ────────────────────────────── */}
      <Suspense fallback={<PanelSkeleton label="Agent Overview" lines={4} />}>
        <AgentOverviewPanel decisions={decisions} queue={queue} agent={agent} onNavigate={onNavigate} />
      </Suspense>

      <div style={{ marginBottom: 12 }}>
        <Suspense fallback={<PanelSkeleton label="Performance" lines={5} />}>
          <PerfChart decisions={decisions} kpiTarget={agent.kpiTarget} />
        </Suspense>
      </div>

      {/* ── 7. AGENT CONFIGURATION ───────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: splitGridCols, gap: 12 }}>
        <div
          style={{
            position: "relative",
            borderRadius: 10,
            overflow: "hidden",
            background: `${C.s2}`,
            border: `1px solid ${C.border}`,
          }}
        >
          <Brackets c={`${C.accent}55`} sz={10} t={1} />
          <div
            style={{
              padding: "10px 16px",
              borderBottom: `1px solid ${C.border}`,
              background: `linear-gradient(90deg, ${C.accent}09 0%, transparent 65%)`,
            }}
          >
            <Label>Agent Configuration</Label>
            {agentId && (
              <div style={{ fontSize: 8, color: `${C.accent}70`, ...mono, marginTop: 2 }}>
                {agentId} {deployedAt ? `· deployed ${deployedAt}` : ""}
              </div>
            )}
          </div>
          <div style={{ padding: "12px 16px" }}>
            {(
              [
                ["Strategy",        activeStrategyLabel],
                ["Strategy Class",  String(agent?.strategyClass || "custom").toUpperCase()],
                ["Risk",            agent.risk.toUpperCase()],
                ["Capital / Cycle", `${agent.capitalLimit} KAS`],
                ["Exec Mode",       execMode.toUpperCase()],
                ["Pair Mode",       describePairMode(agent?.pairMode)],
                ["Auto-Approve ≤",  `${adaptiveAutoThreshold?.thresholdKas?.toFixed(2) ?? "—"} KAS`],
                ["Horizon",         `${agent.horizon} days`],
                ["KPI Target",      `${agent.kpiTarget}% ROI`],
                ["Stop Loss",       `${Number(agent?.stopLossPct || 0)}% hard · ${Number(agent?.trailingStopPct || 0)}% trail`],
                ["Position",        formatStopStatus(stopLossState, kasPrice, {
                  stopLossPct:     Number(agent?.stopLossPct || 0),
                  trailingStopPct: Number(agent?.trailingStopPct || 0),
                })],
                ["Decisions",       `${liveDecisions} signals live${snapshotDecisions > 0 ? ` (${snapshotDecisions} at export)` : ""}`],
              ] as [string, React.ReactNode][]
            ).map(([k, v], idx, arr) => (
              <div
                key={String(k)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 0",
                  borderBottom: idx < arr.length - 1 ? `1px solid ${C.border}` : "none",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 11, color: C.dim, ...mono, flexShrink: 0 }}>{k}</span>
                <span style={{ fontSize: 11, color: C.text, ...mono, textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "8px 16px 12px", fontSize: 10, color: C.dim, lineHeight: 1.5 }}>
            Portfolio weighting and allocator caps are managed automatically. Funding is set
            with <span style={{ color: C.text, ...mono }}>Capital / Cycle</span>.
          </div>
        </div>
      </div>
    </div>
  );
}
