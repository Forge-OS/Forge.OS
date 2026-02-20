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

  return(
    <div>
      <div style={{display:"flex", flexDirection:isMobile ? "column" : "row", justifyContent:"space-between", alignItems:isMobile ? "flex-start" : "center", marginBottom:16, gap:isMobile ? 8 : 0}}>
        <div>
          <div style={{fontSize:13, color:C.text, fontWeight:700, ...mono}}>Quant Intelligence Layer</div>
          <div style={{fontSize:11, color:C.dim}}>Kelly criterion · Monte Carlo · Volatility clustering · Behavioral inference</div>
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

          {/* History */}
          {decisions.length>1 && (
            <Card p={0}>
              <div style={{padding:"11px 16px", borderBottom:`1px solid ${C.border}`}}>
                <span style={{fontSize:11, color:C.dim, ...mono}}>DECISION HISTORY — {decisions.length} records</span>
              </div>
              {decisions.slice(1).map((d: any, i: number)=>{
                const c = d.dec.action==="ACCUMULATE"?C.ok:d.dec.action==="REDUCE"?C.danger:C.warn;
                return(
                  <div key={i} style={{display:"grid", gridTemplateColumns:historyCols, gap:10, padding:"9px 16px", borderBottom:`1px solid ${C.border}`, alignItems:"center"}}>
                    <span style={{fontSize:11, color:C.dim, ...mono}}>{fmtT(d.ts)}</span>
                    <Badge text={d.dec.action} color={c}/>
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
