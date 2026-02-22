import { useEffect, useState } from "react";
import { C, mono } from "../../tokens";
import { fmtT } from "../../helpers";
import { Badge, Btn, Card, Label } from "../ui";

export function IntelligencePanel({decisions, loading, onRun}: any) {
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isMobile = viewportWidth < 760;
  const metricsCols = isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)";
  const historyCols = isMobile ? "78px 108px 1fr" : "90px 120px 80px 80px 1fr";

  const latest = decisions[0];
  const dec = latest?.dec;
  const ac = dec?.action==="ACCUMULATE"?C.ok:dec?.action==="REDUCE"?C.danger:dec?.action==="REBALANCE"?C.purple:C.warn;
  const source = String(dec?.decision_source || latest?.source || "ai");
  const sourceColor =
    source === "hybrid-ai" ? C.accent :
    source === "quant-core" ? C.text :
    source === "fallback" ? C.warn :
    C.ok;
  const quant = dec?.quant_metrics || null;
  const formatMetric = (value: any) => {
    if (value == null || value === "") return "—";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "—";
      if (Math.abs(value) >= 1000) return String(Math.round(value));
      return String(value);
    }
    if (typeof value === "boolean") return value ? "yes" : "no";
    return String(value);
  };

  return(
    <div>
      <div style={{display:"flex", flexDirection:isMobile ? "column" : "row", justifyContent:"space-between", alignItems:isMobile ? "flex-start" : "center", marginBottom:16, gap:isMobile ? 8 : 0}}>
        <div>
          <div style={{fontSize:13, color:C.text, fontWeight:700, ...mono}}>Quant Intelligence Layer</div>
          <div style={{fontSize:11, color:C.dim}}>Deterministic quant core + AI risk overlay · Kelly sizing · regime detection · execution guardrails</div>
        </div>
        <Btn onClick={onRun} disabled={loading}>{loading?"PROCESSING...":"RUN QUANT CYCLE"}</Btn>
      </div>

      {loading && (
        <Card p={24} style={{textAlign:"center", marginBottom:12}}>
          <div style={{fontSize:12, color:C.dim, ...mono, marginBottom:6}}>Running quant engine...</div>
          <div style={{fontSize:11, color:C.dim}}>Kaspa on-chain data → Kelly sizing → Monte Carlo → Decision</div>
        </Card>
      )}

      {!dec && !loading && (
        <Card p={40} style={{textAlign:"center", marginBottom:12}}>
          <div style={{fontSize:13, color:C.dim, ...mono, marginBottom:6}}>No intelligence output yet.</div>
          <div style={{fontSize:12, color:C.dim}}>Run a quant cycle to generate a structured trade decision with Kelly sizing and Monte Carlo confidence.</div>
        </Card>
      )}

      {dec && (
        <>
          {/* Decision header */}
          <Card p={18} style={{marginBottom:10, border:`1px solid ${ac}25`}}>
            <div style={{display:"flex", alignItems:isMobile ? "flex-start" : "center", justifyContent:"space-between", flexDirection:isMobile ? "column" : "row", gap:isMobile ? 8 : 0, marginBottom:14}}>
              <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
                <Badge text={dec.action} color={ac}/>
                <Badge text={dec.strategy_phase} color={C.purple}/>
                <Badge text={`SOURCE ${source.toUpperCase()}`} color={sourceColor}/>
                {quant?.regime && <Badge text={`REGIME ${String(quant.regime).replace(/_/g, " ")}`} color={C.accent}/>}
                <span style={{fontSize:11, color:C.dim, ...mono}}>{fmtT(latest.ts)}</span>
              </div>
              <div style={{display:"flex", gap:8}}>
                <Badge text={`CONF ${dec.confidence_score}`} color={dec.confidence_score>=0.8?C.ok:C.warn}/>
                <Badge text={`RISK ${dec.risk_score}`} color={dec.risk_score<=0.4?C.ok:dec.risk_score<=0.7?C.warn:C.danger}/>
              </div>
            </div>

            {/* Quant metrics grid */}
            <div style={{display:"grid", gridTemplateColumns:metricsCols, gap:10, marginBottom:14}}>
              {[
                ["Kelly Fraction",    `${(dec.kelly_fraction*100).toFixed(1)}%`, C.accent],
                ["Monte Carlo Win",   `${dec.monte_carlo_win_pct}%`,             C.ok],
                ["Capital Alloc",     `${dec.capital_allocation_kas} KAS`,       C.text],
                ["Expected Value",    `+${dec.expected_value_pct}%`,             C.ok],
                ["Stop Loss",         `-${dec.stop_loss_pct}%`,                  C.danger],
                ["Take Profit",       `+${dec.take_profit_pct}%`,                C.ok],
                ["Volatility",        dec.volatility_estimate,                   dec.volatility_estimate==="HIGH"?C.danger:dec.volatility_estimate==="MEDIUM"?C.warn:C.ok],
                ["Liquidity Impact",  dec.liquidity_impact,                      dec.liquidity_impact==="SIGNIFICANT"?C.danger:C.dim],
                ["Engine Latency",    `${dec.engine_latency_ms || 0} ms`,       (dec.engine_latency_ms || 0) <= 2500 ? C.ok : C.warn],
                ["Data Quality",      quant?.data_quality_score ?? "—",          (quant?.data_quality_score ?? 0) >= 0.75 ? C.ok : C.warn],
              ].map(([k,v,c])=> (
                <div key={k as any} style={{background:C.s2, borderRadius:4, padding:"10px 12px"}}>
                  <div style={{fontSize:10, color:C.dim, ...mono, letterSpacing:"0.06em", marginBottom:4}}>{k}</div>
                  <div style={{fontSize:13, color:c as any, fontWeight:700, ...mono}}>{v}</div>
                </div>
              ))}
            </div>

            {/* Rationale */}
            <div style={{background:C.s2, borderRadius:4, padding:"10px 14px", marginBottom:12}}>
              <Label>Decision Rationale</Label>
              <div style={{fontSize:13, color:C.text, lineHeight:1.5}}>{dec.rationale}</div>
              {dec.decision_source_detail && (
                <div style={{fontSize:11, color:C.dim, marginTop:8, ...mono}}>source detail: {dec.decision_source_detail}</div>
              )}
            </div>

            {/* Risk factors */}
            {dec.risk_factors?.length>0 && (
              <div style={{marginBottom:12}}>
                <Label>Risk Factors</Label>
                <div style={{display:"flex", flexWrap:"wrap", gap:6}}>
                  {dec.risk_factors.map((f: any, i: number)=><Badge key={i} text={f} color={C.warn}/>) }
                </div>
              </div>
            )}

            <div style={{background:C.aLow, borderRadius:4, padding:"10px 14px"}}>
              <Label color={C.accent}>Next Review Trigger</Label>
              <div style={{fontSize:12, color:C.text}}>{dec.next_review_trigger}</div>
            </div>
          </Card>

          {quant && (
            <Card p={18} style={{marginBottom:10}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, gap:8, flexWrap:"wrap"}}>
                <Label>Quant Core Diagnostics</Label>
                <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
                  <Badge text={`SAMPLES ${formatMetric(quant.sample_count)}`} color={C.dim}/>
                  <Badge text={`EDGE ${formatMetric(quant.edge_score)}`} color={(Number(quant.edge_score) || 0) > 0 ? C.ok : C.warn}/>
                  {quant.ai_overlay_applied && <Badge text="AI OVERLAY APPLIED" color={C.accent}/>}
                </div>
              </div>
              <div style={{display:"grid", gridTemplateColumns:isMobile ? "1fr" : "1fr 1fr", gap:8}}>
                {[
                  ["Risk Profile", quant.risk_profile],
                  ["Risk Ceiling", quant.risk_ceiling],
                  ["Kelly Cap", quant.kelly_cap],
                  ["Price USD", quant.price_usd],
                  ["1-step Return %", quant.price_return_1_pct],
                  ["5-step Return %", quant.price_return_5_pct],
                  ["20-step Return %", quant.price_return_20_pct],
                  ["Momentum Z", quant.momentum_z],
                  ["EWMA Volatility", quant.ewma_volatility],
                  ["DAA Velocity", quant.daa_velocity],
                  ["DAA Slope", quant.daa_slope],
                  ["Drawdown %", quant.drawdown_pct],
                  ["Model Win Prob", quant.win_probability_model],
                  ["Exposure Cap %", quant.exposure_cap_pct],
                ].map(([label, value]) => (
                  <div key={String(label)} style={{display:"flex", justifyContent:"space-between", gap:10, background:C.s2, borderRadius:4, padding:"9px 12px"}}>
                    <span style={{fontSize:11, color:C.dim, ...mono}}>{label}</span>
                    <span style={{fontSize:11, color:C.text, ...mono}}>{formatMetric(value)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* History */}
          {decisions.length>1 && (
            <Card p={0}>
              <div style={{padding:"11px 16px", borderBottom:`1px solid ${C.border}`}}>
                <span style={{fontSize:11, color:C.dim, ...mono}}>DECISION HISTORY — {decisions.length} records</span>
              </div>
              {decisions.slice(1).map((d: any, i: number)=>{
                const c = d.dec.action==="ACCUMULATE"?C.ok:d.dec.action==="REDUCE"?C.danger:C.warn;
                const historySource = String(d?.dec?.decision_source || d?.source || "ai");
                const historySourceLabel =
                  historySource === "hybrid-ai" ? "HYB" :
                  historySource === "quant-core" ? "Q" :
                  historySource === "fallback" ? "F" :
                  "AI";
                const historySourceColor =
                  historySource === "hybrid-ai" ? C.accent :
                  historySource === "quant-core" ? C.text :
                  historySource === "fallback" ? C.warn :
                  C.ok;
                return(
                  <div key={i} style={{display:"grid", gridTemplateColumns:historyCols, gap:10, padding:"9px 16px", borderBottom:`1px solid ${C.border}`, alignItems:"center"}}>
                    <span style={{fontSize:11, color:C.dim, ...mono}}>{fmtT(d.ts)}</span>
                    <div style={{display:"flex", gap:6, alignItems:"center"}}>
                      <Badge text={d.dec.action} color={c}/>
                      {!isMobile && <Badge text={historySourceLabel} color={historySourceColor}/>}
                    </div>
                    {!isMobile && <span style={{fontSize:12, color:C.text, ...mono}}>{d.dec.capital_allocation_kas} KAS</span>}
                    {!isMobile && <span style={{fontSize:12, color:d.dec.confidence_score>=0.8?C.ok:C.warn, ...mono}}>c:{d.dec.confidence_score}</span>}
                    <span style={{fontSize:11, color:C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{d.dec.rationale}</span>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
