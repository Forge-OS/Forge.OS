import { useState } from "react";
import { C, mono } from "../../tokens";
import { shortAddr } from "../../helpers";
import { Badge, Inp, Label, Card, Btn } from "../ui";
import { RISK_OPTS, EXEC_OPTS, SIZING_OPTS, PAIR_MODE_OPTS, PNL_TRACKING_OPTS, STRATEGY_TEMPLATES, PROFESSIONAL_PRESETS } from "./constants";

// ── inline section header ─────────────────────────────────────────────────────
const SectionHead = ({ label, sub }: { label: string; sub?: string }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, ...mono, letterSpacing: "0.16em" }}>{label}</div>
    {sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{sub}</div>}
  </div>
);

// ── option picker row ─────────────────────────────────────────────────────────
const PickRow = ({ opts, value, onChange, cols = 3 }: { opts: any[]; value: string; onChange: (v: string) => void; cols?: number }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},1fr)`, gap: 6 }}>
    {opts.map(o => {
      const on = value === o.v;
      return (
        <div key={o.v} onClick={() => onChange(o.v)}
          style={{
            padding: "10px 12px", borderRadius: 7, cursor: "pointer",
            border: `1px solid ${on ? C.accent : "rgba(33,48,67,0.7)"}`,
            background: on ? `linear-gradient(135deg, ${C.accent}18 0%, rgba(8,13,20,0.5) 100%)` : "rgba(16,25,35,0.4)",
            transition: "all 0.15s",
          }}>
          <div style={{ fontSize: 11, color: on ? C.accent : C.text, fontWeight: 700, ...mono, marginBottom: 2 }}>{o.l}</div>
          {o.desc && <div style={{ fontSize: 9, color: C.dim }}>{o.desc}</div>}
        </div>
      );
    })}
  </div>
);

// ── pair mode badge ───────────────────────────────────────────────────────────
const PairBadge = ({ mode }: { mode: string }) => {
  if (mode === "kas-usdc") return <Badge text="KAS/USDC PAIR" color={C.purple} />;
  if (mode === "dual") return <Badge text="DUAL MODE" color={C.warn} />;
  return <Badge text="ACCUMULATION" color={C.accent} />;
};

// ─────────────────────────────────────────────────────────────────────────────

export const WStep1 = ({ d, set, wallet }: any) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isCustom = d.strategyTemplate === "custom";
  const isPairMode = d.pairMode === "kas-usdc" || d.pairMode === "dual";

  const applyPreset = (preset: any) => {
    set("strategyTemplate", preset.id);
    set("strategyLabel", preset.name);
    set("strategyClass", preset.class);
    Object.entries(preset.defaults).forEach(([k, v]) => set(k, v));
    if (preset.id === "custom") setShowAdvanced(true);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 17, color: C.text, fontWeight: 700, ...mono, marginBottom: 2 }}>Configure Agent</div>
        <div style={{ fontSize: 11, color: C.dim }}>
          Connected: <span style={{ color: C.accent, ...mono }}>{shortAddr(wallet?.address)}</span>
          {d.pairMode && (
            <span style={{ marginLeft: 10 }}><PairBadge mode={d.pairMode} /></span>
          )}
        </div>
      </div>

      {/* ── Strategy Templates ── */}
      <SectionHead label="STRATEGY PROFILE" sub="Accumulation-first · KAS-native · KAS/USDC pair-ready" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 14 }}>
        {STRATEGY_TEMPLATES.map((tpl) => {
          const on = d.strategyTemplate === tpl.id;
          const isUsdcPair = tpl.id === "kas_usdc_pair";
          return (
            <div key={tpl.id} onClick={() => applyPreset(tpl)}
              style={{
                padding: "14px 16px", borderRadius: 10, cursor: "pointer",
                border: `2px solid ${on ? (isUsdcPair ? C.purple : C.accent) : isUsdcPair ? `${C.purple}40` : "rgba(33,48,67,0.7)"}`,
                background: on
                  ? `linear-gradient(135deg, ${isUsdcPair ? C.purple : C.accent}18 0%, rgba(8,13,20,0.6) 100%)`
                  : isUsdcPair
                  ? `linear-gradient(135deg, ${C.purple}08 0%, rgba(8,13,20,0.4) 100%)`
                  : "rgba(16,25,35,0.4)",
                boxShadow: on ? `0 4px 14px ${isUsdcPair ? C.purple : C.accent}28` : "none",
                transition: "all 0.2s",
                position: "relative",
              }}>
              {isUsdcPair && (
                <div style={{ position: "absolute", top: 8, right: 8 }}>
                  <span style={{ fontSize: 8, color: C.purple, fontWeight: 700, ...mono, background: `${C.purple}20`, padding: "2px 6px", borderRadius: 3, border: `1px solid ${C.purple}30` }}>PAIR-READY</span>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Badge text={tpl.tag} color={tpl.tagColor || C.ok} />
              </div>
              <div style={{ fontSize: 13, color: on ? (isUsdcPair ? C.purple : C.accent) : C.text, fontWeight: 700, ...mono, marginBottom: 4 }}>{tpl.name}</div>
              <div style={{ fontSize: 10, color: C.text, marginBottom: 3, lineHeight: 1.4 }}>{tpl.purpose}</div>
              {tpl.bestFor && <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.35 }}>Best for: {tpl.bestFor}</div>}
            </div>
          );
        })}
      </div>

      {/* ── Professional Presets ── */}
      <SectionHead label="PROFESSIONAL PRESETS" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 18 }}>
        {PROFESSIONAL_PRESETS.map((preset) => {
          const on = d.strategyTemplate === preset.id;
          return (
            <div key={preset.id} onClick={() => applyPreset(preset)}
              style={{
                padding: "12px 14px", borderRadius: 8, cursor: "pointer",
                border: `1px solid ${on ? C.accent : "rgba(33,48,67,0.6)"}`,
                background: on ? `linear-gradient(135deg, ${C.accent}12 0%, rgba(8,13,20,0.5) 100%)` : "rgba(16,25,35,0.35)",
                transition: "all 0.15s",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: on ? C.accent : C.text, fontWeight: 700, ...mono }}>{preset.name}</div>
                <Badge text={preset.tag} color={preset.tagColor || C.purple} />
              </div>
              <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.4, marginBottom: 4 }}>{preset.purpose}</div>
              {preset.id !== "custom" && (
                <div style={{ fontSize: 9, color: C.dim, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span>Risk: <span style={{ color: C.text }}>{preset.defaults.risk}</span></span>
                  <span>Target: <span style={{ color: C.text }}>{preset.defaults.kpiTarget}%</span></span>
                  {(preset.defaults as any).pairMode === "kas-usdc" && (
                    <span style={{ color: C.purple }}>KAS/USDC</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Core params ── */}
      <SectionHead label="AGENT IDENTITY" />
      <Inp label="Agent Name" value={d.name} onChange={(v: string) => set("name", v)} placeholder="KAS-Alpha-01" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        <Inp label="ROI Target" value={d.kpiTarget} onChange={(v: string) => set("kpiTarget", v)} type="number" placeholder="12" suffix="%" hint="Annual % return target" />
        <Inp label="Capital / Cycle" value={d.capitalLimit} onChange={(v: string) => set("capitalLimit", v)} type="number" placeholder="5000" suffix="KAS" hint="Max KAS this agent can deploy" />
      </div>

      {/* Risk */}
      <SectionHead label="RISK TOLERANCE" />
      <PickRow opts={RISK_OPTS} value={d.risk} onChange={(v) => set("risk", v)} cols={3} />

      {/* ── Pair Mode ── */}
      <div style={{ marginTop: 18 }}>
        <SectionHead label="PAIR MODE" sub="Current: accumulation-only · KAS/USDC activates when Kaspa enables native stablecoins" />
        <PickRow opts={PAIR_MODE_OPTS} value={d.pairMode || "accumulation"} onChange={(v) => set("pairMode", v)} cols={3} />
        {isPairMode && (
          <div style={{ marginTop: 10, padding: "10px 14px", background: `${C.purple}10`, border: `1px solid ${C.purple}25`, borderRadius: 8 }}>
            <div style={{ fontSize: 9, color: C.purple, fontWeight: 700, ...mono, marginBottom: 4 }}>KAS / USDC PAIR PARAMS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <Inp label="Stable Entry Bias" value={d.stableEntryBias || "0.6"} onChange={(v: string) => set("stableEntryBias", v)} type="number" suffix="×" hint="Weight for buying KAS with USDC on dips (0–1)" />
              <Inp label="Stable Exit Bias" value={d.stableExitBias || "0.4"} onChange={(v: string) => set("stableExitBias", v)} type="number" suffix="×" hint="Weight for selling KAS to USDC on strength (0–1)" />
              <Inp label="Slippage Tolerance" value={d.usdcSlippageTolerance || "0.5"} onChange={(v: string) => set("usdcSlippageTolerance", v)} type="number" suffix="%" hint="Max acceptable slippage on KAS/USDC trades" />
            </div>
          </div>
        )}
      </div>

      {/* ── Advanced Config Toggle ── */}
      <div style={{ marginTop: 18, borderTop: `1px solid rgba(33,48,67,0.5)`, paddingTop: 16 }}>
        <div
          onClick={() => setShowAdvanced(s => !s)}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", marginBottom: showAdvanced ? 14 : 0 }}
        >
          <div>
            <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, ...mono, letterSpacing: "0.12em" }}>
              {showAdvanced ? "▲" : "▼"} ADVANCED STRATEGY CONFIG
            </div>
            <div style={{ fontSize: 9, color: C.dim, marginTop: 1 }}>
              Stop/take-profit · position sizing · DAA filters · confidence gate · daily limits
            </div>
          </div>
          <Badge text={showAdvanced ? "OPEN" : "EXPAND"} color={C.dim} />
        </div>

        {showAdvanced && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {/* Risk params */}
            <div>
              <SectionHead label="RISK PARAMETERS" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Inp label="Stop Loss" value={d.stopLossPct || "4.0"} onChange={(v: string) => set("stopLossPct", v)} type="number" suffix="%" hint="% below entry to trigger stop" />
                <Inp label="Take Profit" value={d.takeProfitPct || "10.0"} onChange={(v: string) => set("takeProfitPct", v)} type="number" suffix="%" hint="% above entry to take profit" />
              </div>
            </div>

            {/* Position sizing */}
            <div>
              <SectionHead label="POSITION SIZING METHOD" sub="Controls how the Kelly fraction is applied to each trade" />
              <PickRow opts={SIZING_OPTS} value={d.positionSizing || "kelly"} onChange={(v) => set("positionSizing", v)} cols={3} />
            </div>

            {/* Signal filters */}
            <div>
              <SectionHead label="SIGNAL FILTERS" sub="Entry gates based on quant engine outputs" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Inp
                  label="Min AI Confidence"
                  value={d.minConfidence || "55"}
                  onChange={(v: string) => set("minConfidence", v)}
                  type="number" suffix="%"
                  hint="Agent won't act unless AI confidence ≥ this value"
                />
                <Inp
                  label="Min DAA Velocity"
                  value={d.daaVelocityFilter || "0"}
                  onChange={(v: string) => set("daaVelocityFilter", v)}
                  type="number" suffix="blk/s"
                  hint="Only enter when DAA velocity exceeds this threshold (0 = no filter)"
                />
              </div>
            </div>

            {/* Execution limits */}
            <div>
              <SectionHead label="EXECUTION LIMITS" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <Inp label="Max Daily Actions" value={d.maxDailyActions || "8"} onChange={(v: string) => set("maxDailyActions", v)} type="number" hint="Hard cap on executions per 24h" />
                <Inp label="Cooldown Cycles" value={d.cooldownCycles || "1"} onChange={(v: string) => set("cooldownCycles", v)} type="number" hint="Idle cycles to wait after each execution" />
                <Inp label="Auto-Approve ≤" value={d.autoApproveThreshold} onChange={(v: string) => set("autoApproveThreshold", v)} type="number" suffix="KAS" hint="Auto-sign transactions below this size" />
              </div>
            </div>

            {/* Execution mode */}
            <div>
              <SectionHead label="EXECUTION MODE" />
              <PickRow opts={EXEC_OPTS} value={d.execMode} onChange={(v) => set("execMode", v)} cols={3} />
            </div>

            {/* P&L tracking */}
            <div>
              <SectionHead label="P&L TRACKING DENOMINATION" sub="How agent profit/loss is reported" />
              <PickRow opts={PNL_TRACKING_OPTS} value={d.pnlTracking || "kas-native"} onChange={(v) => set("pnlTracking", v)} cols={2} />
            </div>

            {/* Horizon */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Inp label="Strategy Horizon (days)" value={d.horizon} onChange={(v: string) => set("horizon", v)} type="number" hint="Planning window for KPI evaluation" />
              <Inp label="Portfolio Allocation %" value={d.portfolioAllocationPct || "25"} onChange={(v: string) => set("portfolioAllocationPct", v)} type="number" suffix="%" hint="Target % of total portfolio for this agent" />
            </div>

            {/* Config summary */}
            <Card p={12} style={{ background: `linear-gradient(135deg, ${C.accent}06 0%, rgba(8,13,20,0.5) 100%)`, border: `1px solid ${C.accent}15` }}>
              <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, ...mono, letterSpacing: "0.1em", marginBottom: 8 }}>STRATEGY PARAMETER SUMMARY</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {[
                  { k: "Risk", v: String(d.risk || "—").toUpperCase() },
                  { k: "Sizing", v: String(d.positionSizing || "kelly").toUpperCase() },
                  { k: "Pair Mode", v: String(d.pairMode || "accumulation").replace("-", "/").toUpperCase() },
                  { k: "Stop Loss", v: `${d.stopLossPct || "4.0"}%` },
                  { k: "Take Profit", v: `${d.takeProfitPct || "10.0"}%` },
                  { k: "Min Confidence", v: `${d.minConfidence || "55"}%` },
                  { k: "DAA Filter", v: `>${d.daaVelocityFilter || "0"} blk/s` },
                  { k: "Max Daily", v: `${d.maxDailyActions || "8"} actions` },
                  { k: "P&L Denom", v: String(d.pnlTracking || "kas-native").toUpperCase() },
                ].map(item => (
                  <div key={item.k}>
                    <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 2 }}>{item.k}</div>
                    <div style={{ fontSize: 11, color: C.text, fontWeight: 700, ...mono }}>{item.v}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};
