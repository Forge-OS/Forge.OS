import { useEffect, useMemo, useRef, useState } from "react";
import { C, mono } from "../../tokens";
import { fmtT } from "../../helpers";
import { decisionAuditVerifyCacheKey, type AuditCryptoVerificationResult, verifyDecisionAuditCryptoSignature } from "../../runtime/auditCryptoVerify";
import { Badge, Btn, Card } from "../ui";

export function IntelligencePanel({decisions, queue = [], loading, onRun}: any) {
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
  const historyCols = isMobile ? "78px 108px 1fr" : "90px 200px 96px 88px 1fr";
  const queueItems = Array.isArray(queue) ? queue : [];
  const [auditVerifyByDecisionHash, setAuditVerifyByDecisionHash] = useState<Record<string, { cacheKey: string; result: AuditCryptoVerificationResult }>>({});
  const verifyInFlight = useRef(new Set<string>());
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showAuditTrail, setShowAuditTrail] = useState(false);

  const decisionToQueue = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of queueItems) {
      if (!item || item?.metaKind === "treasury_fee") continue;
      const hash = String(item?.dec?.audit_record?.decision_hash || "").trim();
      if (!hash) continue;
      const prev = map.get(hash);
      if (!prev || Number(item?.ts || 0) > Number(prev?.ts || 0)) map.set(hash, item);
    }
    return map;
  }, [queueItems]);

  const queueItemForDecision = (entry: any) => {
    if (!entry?.dec) return null;
    const hash = String(entry?.dec?.audit_record?.decision_hash || "").trim();
    if (hash && decisionToQueue.has(hash)) return decisionToQueue.get(hash);
    const byRef = queueItems
      .filter((item: any) => item?.metaKind !== "treasury_fee" && item?.dec === entry.dec)
      .sort((a: any, b: any) => Number(b?.ts || 0) - Number(a?.ts || 0));
    return byRef[0] || null;
  };

  const classifyProvenance = (item: any) => {
    if (!item) return { text: "ESTIMATED", color: C.warn };
    const imported = String(item?.receipt_imported_from || "").toLowerCase();
    const sourcePath = String(item?.receipt_source_path || "").toLowerCase();
    const confirmSource = String(item?.confirm_ts_source || "").toLowerCase();
    if (imported === "callback_consumer" || sourcePath.includes("callback-consumer")) return { text: "BACKEND", color: C.purple };
    if (imported === "kaspa_api" || confirmSource === "chain") return { text: "CHAIN", color: C.ok };
    return { text: "ESTIMATED", color: C.warn };
  };

  const truthLabelForDecision = (entry: any) => {
    const item = queueItemForDecision(entry);
    const provenance = classifyProvenance(item);
    if (!item) return { text: "SIMULATED", color: C.dim, provenance: { text: "ESTIMATED", color: C.warn } };
    if (String(item?.status || "") !== "signed") return { text: "ESTIMATED", color: C.warn, provenance };
    const receiptState = String(item?.receipt_lifecycle || "submitted");
    if (receiptState === "confirmed") {
      if (provenance.text === "BACKEND") return { text: "BACKEND CONFIRMED", color: C.purple, provenance };
      if (provenance.text === "CHAIN") return { text: "CHAIN CONFIRMED", color: C.ok, provenance };
      return { text: "ESTIMATED", color: C.warn, provenance };
    }
    if (receiptState === "broadcasted" || receiptState === "pending_confirm" || receiptState === "submitted") {
      return { text: "BROADCASTED", color: C.warn, provenance };
    }
    return { text: "ESTIMATED", color: C.warn, provenance };
  };

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
  const latestTruth = latest ? truthLabelForDecision(latest) : null;
  const cryptoSig = dec?.audit_record?.crypto_signature || null;
  const latestAuditVerify = latest?.dec?.audit_record?.decision_hash
    ? auditVerifyByDecisionHash[String(latest.dec.audit_record.decision_hash)]?.result || null
    : null;
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

  useEffect(() => {
    let cancelled = false;
    const candidates = (Array.isArray(decisions) ? decisions : []).slice(0, 24);
    for (const entry of candidates) {
      const audit = entry?.dec?.audit_record;
      const hash = String(audit?.decision_hash || "").trim();
      if (!hash) continue;
      if (String(audit?.crypto_signature?.status || "").toLowerCase() !== "signed") continue;
      const cacheKey = decisionAuditVerifyCacheKey(entry.dec);
      if (!cacheKey) continue;
      const existing = auditVerifyByDecisionHash[hash];
      if (existing?.cacheKey === cacheKey) continue;
      if (verifyInFlight.current.has(cacheKey)) continue;
      verifyInFlight.current.add(cacheKey);
      void verifyDecisionAuditCryptoSignature(entry.dec)
        .then((result) => {
          if (cancelled) return;
          setAuditVerifyByDecisionHash((prev) => {
            const current = prev[hash];
            if (current?.cacheKey === cacheKey) return prev;
            return { ...prev, [hash]: { cacheKey, result } };
          });
        })
        .finally(() => {
          verifyInFlight.current.delete(cacheKey);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [auditVerifyByDecisionHash, decisions]);

  const cryptoVerifyBadge = (verify: AuditCryptoVerificationResult | null) => {
    if (!verify) return <Badge text="CRYPTO VERIFY…" color={C.dim}/>;
    if (verify.status === "verified") return <Badge text="CRYPTO VERIFIED" color={C.ok}/>;
    if (verify.status === "unpinned") return <Badge text="UNPINNED KEY" color={C.warn}/>;
    if (verify.status === "invalid") return <Badge text="CRYPTO INVALID" color={C.danger}/>;
    if (verify.status === "unsupported") return <Badge text="VERIFY UNSUPPORTED" color={C.dim}/>;
    if (verify.status === "error") return <Badge text="VERIFY ERROR" color={C.warn}/>;
    return <Badge text="VERIFY UNKNOWN" color={C.dim}/>;
  };

  const cryptoVerifyDetail = (verify: AuditCryptoVerificationResult | null) => {
    if (!verify) return "crypto verify pending";
    const bits = [
      `verify ${String(verify.status || "unknown")}`,
      verify.alg ? String(verify.alg) : "",
      verify.keyFingerprint ? `fp ${String(verify.keyFingerprint).slice(0, 26)}` : "",
      verify.pinMatched === true ? "pinned" : verify.pinMatched === false ? "unpinned" : "",
      verify.source ? `src ${verify.source}` : "",
    ].filter(Boolean);
    if (verify.detail) bits.push(String(verify.detail).slice(0, 80));
    return bits.join(" · ");
  };

  return(
    <div>
      {/* ── Header ── */}
      <div style={{display:"flex", flexDirection:isMobile ? "column" : "row", justifyContent:"space-between", alignItems:isMobile ? "flex-start" : "center", marginBottom:16, gap:isMobile ? 8 : 0}}>
        <div>
          <div style={{fontSize:13, color:C.text, fontWeight:700, ...mono}}>Intelligence Layer</div>
          <div style={{fontSize:11, color:C.dim}}>On-chain quant core · Kelly sizing · regime detection · AI risk overlay</div>
        </div>
        <Btn onClick={onRun} disabled={loading}>{loading ? "PROCESSING..." : "RUN CYCLE"}</Btn>
      </div>

      {loading && (
        <Card p={24} style={{textAlign:"center", marginBottom:12}}>
          <div style={{fontSize:12, color:C.dim, ...mono, marginBottom:6}}>Running quant engine...</div>
          <div style={{fontSize:11, color:C.dim}}>Kaspa on-chain data → Kelly sizing → Monte Carlo → Decision</div>
        </Card>
      )}

      {!dec && !loading && (
        <Card p={40} style={{textAlign:"center", marginBottom:12}}>
          <div style={{fontSize:28, marginBottom:12}}>⚡</div>
          <div style={{fontSize:13, color:C.text, fontWeight:700, ...mono, marginBottom:6}}>No Intelligence Signal Yet</div>
          <div style={{fontSize:12, color:C.dim}}>Run a cycle to generate a structured decision with Kelly sizing, Monte Carlo confidence, and on-chain regime detection.</div>
        </Card>
      )}

      {dec && (
        <>
          {/* ── Signal Banner ── */}
          <div style={{background:`linear-gradient(135deg, ${ac}12 0%, ${C.s1} 100%)`, border:`1px solid ${ac}35`, borderRadius:10, padding:isMobile?"14px 16px":"18px 22px", marginBottom:12, display:"flex", gap:18, alignItems:"center", flexWrap:isMobile?"wrap":"nowrap"}}>
            {/* Confidence ring */}
            <div style={{flexShrink:0, width:72, height:72, borderRadius:"50%", background:`conic-gradient(${ac} 0deg ${Math.round(dec.confidence_score*360)}deg, ${C.s2} ${Math.round(dec.confidence_score*360)}deg 360deg)`, display:"flex", alignItems:"center", justifyContent:"center"}}>
              <div style={{width:52, height:52, borderRadius:"50%", background:C.s1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column"}}>
                <span style={{fontSize:13, fontWeight:700, color:ac, ...mono, lineHeight:1}}>{Math.round(dec.confidence_score*100)}</span>
                <span style={{fontSize:8, color:C.dim, ...mono}}>CONF%</span>
              </div>
            </div>
            {/* Signal content */}
            <div style={{flex:1, minWidth:0}}>
              <div style={{display:"flex", gap:6, flexWrap:"wrap", marginBottom:8, alignItems:"center"}}>
                <span style={{fontSize:16, fontWeight:700, color:ac, letterSpacing:"0.1em", ...mono}}>{dec.action}</span>
                <span style={{width:1, height:14, background:C.border, display:"inline-block", flexShrink:0}}/>
                <Badge text={dec.strategy_phase} color={C.purple}/>
                <Badge text={`SRC: ${source.toUpperCase()}`} color={sourceColor}/>
                {quant?.regime && <Badge text={String(quant.regime).replace(/_/g," ").toUpperCase()} color={C.accent}/>}
                {latestTruth && <Badge text={latestTruth.text} color={latestTruth.color}/>}
                {latestTruth && <Badge text={`PROV ${latestTruth.provenance.text}`} color={latestTruth.provenance.color}/>}
              </div>
              <div style={{fontSize:12, color:C.text, lineHeight:1.55, marginBottom:8}}>{dec.rationale}</div>
              <div style={{display:"flex", gap:6, flexWrap:"wrap", alignItems:"center"}}>
                {dec?.audit_record?.audit_sig && <Badge text="AUDIT READY" color={C.text}/>}
                {cryptoSig?.status === "signed" && <Badge text="CRYPTO SIGNED" color={C.ok}/>}
                {cryptoSig?.status === "signed" && cryptoVerifyBadge(latestAuditVerify)}
                {latestAuditVerify?.pinMatched === true && <Badge text="KEY PINNED" color={C.accent}/>}
                {latestAuditVerify?.pinMatched === false && <Badge text="KEY UNPINNED" color={C.warn}/>}
                {cryptoSig?.status === "error" && <Badge text="SIGN ERR" color={C.warn}/>}
                <span style={{fontSize:10, color:C.dim, ...mono}}>{fmtT(latest.ts)}</span>
              </div>
            </div>
            {/* Risk pill */}
            <div style={{flexShrink:0, background:C.s2, borderRadius:8, padding:"12px 16px", textAlign:"center", border:`1px solid ${dec.risk_score<=0.4?C.ok:dec.risk_score<=0.7?C.warn:C.danger}30`}}>
              <div style={{fontSize:9, color:C.dim, ...mono, letterSpacing:"0.1em", marginBottom:2}}>RISK</div>
              <div style={{fontSize:20, fontWeight:700, ...mono, color:dec.risk_score<=0.4?C.ok:dec.risk_score<=0.7?C.warn:C.danger}}>{dec.risk_score}</div>
              <div style={{fontSize:9, color:C.dim, ...mono}}>SCORE</div>
            </div>
          </div>

          {/* ── Key Signal Metrics ── */}
          <div style={{display:"grid", gridTemplateColumns:metricsCols, gap:8, marginBottom:12}}>
            {[
              {k:"Kelly Fraction", v:`${(dec.kelly_fraction*100).toFixed(1)}%`, c:C.accent, hint:"Position sizing fraction after quant/AI guardrails. Higher is more aggressive."},
              {k:"Monte Carlo Win", v:`${dec.monte_carlo_win_pct}%`, c:C.ok, hint:"Model-estimated win probability for the current setup; not guaranteed realized PnL."},
              {k:"Capital Alloc", v:`${dec.capital_allocation_kas} KAS`, c:C.text, hint:"Proposed KAS amount for this cycle after portfolio caps and risk controls."},
              {k:"Expected Value", v:`+${dec.expected_value_pct}%`, c:C.ok, hint:"Expected edge for this decision before realized execution drift."},
              {k:"Stop Loss", v:`-${dec.stop_loss_pct}%`, c:C.danger, hint:"Loss control target used for risk envelope logic."},
              {k:"Take Profit", v:`+${dec.take_profit_pct}%`, c:C.ok, hint:"Profit-taking target used for expected value and phase planning."},
              {k:"Volatility", v:String(dec.volatility_estimate), c:dec.volatility_estimate==="HIGH"?C.danger:dec.volatility_estimate==="MEDIUM"?C.warn:C.ok, hint:"Quant volatility bucket; high volatility tightens signal trust."},
              {k:"Liquidity Impact", v:String(dec.liquidity_impact), c:dec.liquidity_impact==="SIGNIFICANT"?C.danger:C.dim, hint:"Estimated execution friction/slippage pressure."},
              {k:"Engine Latency", v:`${dec.engine_latency_ms||0}ms`, c:(dec.engine_latency_ms||0)<=2500?C.ok:C.warn, hint:"Decision engine runtime (quant + AI overlay + fusion) for this cycle."},
              {k:"Data Quality", v:formatMetric(quant?.data_quality_score), c:(quant?.data_quality_score??0)>=0.75?C.ok:C.warn, hint:"Signal trust score from quant feature sufficiency. Low quality reduces automation confidence."},
            ].map((item) => (
              <div key={item.k} title={item.hint} style={{background:`linear-gradient(135deg, ${item.c}10 0%, ${C.s2} 100%)`, border:`1px solid ${item.c}20`, borderRadius:6, padding:"10px 12px"}}>
                <div style={{fontSize:9, color:C.dim, ...mono, letterSpacing:"0.06em", marginBottom:4}}>{item.k.toUpperCase()}</div>
                <div style={{fontSize:13, color:item.c, fontWeight:700, ...mono}}>{item.v}</div>
              </div>
            ))}
          </div>

          {/* ── Next Review ── */}
          {dec.next_review_trigger && (
            <div style={{background:C.aLow, border:`1px solid ${C.accent}25`, borderRadius:6, padding:"10px 14px", marginBottom:12, display:"flex", gap:8, alignItems:"flex-start"}}>
              <span style={{fontSize:9, color:C.accent, ...mono, letterSpacing:"0.08em", flexShrink:0, paddingTop:2}}>NEXT TRIGGER</span>
              <span style={{fontSize:12, color:C.text}}>{dec.next_review_trigger}</span>
            </div>
          )}

          {/* ── Risk Factors ── */}
          {dec.risk_factors?.length > 0 && (
            <div style={{background:`${C.warn}08`, border:`1px solid ${C.warn}30`, borderRadius:6, padding:"10px 14px", marginBottom:12}}>
              <div style={{fontSize:9, color:C.warn, ...mono, letterSpacing:"0.08em", marginBottom:6}}>RISK FACTORS</div>
              <div style={{display:"flex", flexWrap:"wrap", gap:6}}>
                {dec.risk_factors.map((f: any, i: number) => <Badge key={i} text={f} color={C.warn}/>)}
              </div>
            </div>
          )}

          {/* ── Quant Diagnostics (collapsible) ── */}
          {quant && (
            <Card p={0} style={{marginBottom:10}}>
              <div
                onClick={() => setShowDiagnostics(s => !s)}
                style={{padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", userSelect:"none"}}
              >
                <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
                  <span style={{fontSize:11, color:C.text, fontWeight:700, ...mono}}>QUANT DIAGNOSTICS</span>
                  <Badge text={`${formatMetric(quant.sample_count)} SAMPLES`} color={C.dim}/>
                  <Badge text={`EDGE ${formatMetric(quant.edge_score)}`} color={(Number(quant.edge_score)||0)>0?C.ok:C.warn}/>
                  {quant.ai_overlay_applied && <Badge text="AI OVERLAY" color={C.accent}/>}
                </div>
                <span style={{fontSize:12, color:C.dim, flexShrink:0}}>{showDiagnostics ? "▲" : "▼"}</span>
              </div>
              {showDiagnostics && (
                <div style={{padding:"0 16px 16px", borderTop:`1px solid ${C.border}`}}>
                  <div style={{fontSize:11, color:C.dim, marginBottom:10, marginTop:10, lineHeight:1.4}}>
                    Raw quant features behind the decision — use these to understand regime behavior and why guardrails or AI fusion changed sizing/action.
                  </div>
                  <div style={{display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:6}}>
                    {([
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
                    ] as [string, any][]).map(([label, value]) => (
                      <div key={label} style={{display:"flex", justifyContent:"space-between", gap:10, background:C.s2, borderRadius:4, padding:"8px 12px"}}>
                        <span style={{fontSize:11, color:C.dim, ...mono}}>{label}</span>
                        <span style={{fontSize:11, color:C.text, fontWeight:600, ...mono}}>{formatMetric(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* ── Audit Trail (collapsible) ── */}
          {dec.audit_record && (
            <Card p={0} style={{marginBottom:10}}>
              <div
                onClick={() => setShowAuditTrail(s => !s)}
                style={{padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", userSelect:"none"}}
              >
                <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
                  <span style={{fontSize:11, color:C.text, fontWeight:700, ...mono}}>AUDIT TRAIL</span>
                  {cryptoSig?.status === "signed" && cryptoVerifyBadge(latestAuditVerify)}
                  {latestAuditVerify?.pinMatched === true && <Badge text="PINNED" color={C.accent}/>}
                </div>
                <span style={{fontSize:12, color:C.dim, flexShrink:0}}>{showAuditTrail ? "▲" : "▼"}</span>
              </div>
              {showAuditTrail && (
                <div style={{padding:"0 16px 16px", borderTop:`1px solid ${C.border}`}}>
                  {dec.decision_source_detail && (
                    <div style={{fontSize:11, color:C.dim, ...mono, marginTop:10, marginBottom:8}}>source detail: {dec.decision_source_detail}</div>
                  )}
                  <div style={{fontSize:11, color:C.dim, ...mono, lineHeight:1.8, marginTop:dec.decision_source_detail ? 0 : 10}}>
                    <div>audit: {String(dec.audit_record.audit_record_version||"—")} · prompt {String(dec.audit_record.prompt_version||"—")} · schema {String(dec.audit_record.ai_response_schema_version||"—")}</div>
                    <div>qhash {String(dec.audit_record.quant_feature_snapshot_hash||"—").slice(0,22)}… · dhash {String(dec.audit_record.decision_hash||"—").slice(0,22)}…</div>
                    <div>sig {String(dec.audit_record.audit_sig||"—").slice(0,18)}…</div>
                    {dec.audit_record.crypto_signature && (
                      <div>crypto {String(dec.audit_record.crypto_signature.status||"unknown")} · {String(dec.audit_record.crypto_signature.alg||"—")} · key {String(dec.audit_record.crypto_signature.key_id||"—").slice(0,22)}</div>
                    )}
                    {dec.audit_record.crypto_signature?.status === "signed" && (
                      <div>{cryptoVerifyDetail(latestAuditVerify)}</div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* ── Signal History ── */}
          {decisions.length > 1 && (
            <Card p={0}>
              <div style={{padding:"11px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <span style={{fontSize:11, color:C.dim, ...mono}}>SIGNAL HISTORY</span>
                <Badge text={`${decisions.length} records`} color={C.dim}/>
              </div>
              {decisions.slice(1).map((d: any, i: number) => {
                const c = d.dec.action==="ACCUMULATE"?C.ok:d.dec.action==="REDUCE"?C.danger:C.warn;
                const truth = truthLabelForDecision(d);
                const verify = d?.dec?.audit_record?.decision_hash
                  ? auditVerifyByDecisionHash[String(d.dec.audit_record.decision_hash)]?.result || null
                  : null;
                const histSrc = String(d?.dec?.decision_source||d?.source||"ai");
                const histSrcColor = histSrc==="hybrid-ai"?C.accent:histSrc==="quant-core"?C.text:histSrc==="fallback"?C.warn:C.ok;
                return (
                  <div key={i} style={{display:"grid", gridTemplateColumns:historyCols, gap:10, padding:"9px 16px", borderBottom:i<decisions.length-2?`1px solid ${C.border}`:"none", alignItems:"center"}}>
                    <span style={{fontSize:11, color:C.dim, ...mono}}>{fmtT(d.ts)}</span>
                    <div style={{display:"flex", gap:5, alignItems:"center", flexWrap:"wrap"}}>
                      <Badge text={d.dec.action} color={c}/>
                      {!isMobile && <Badge text={histSrc==="hybrid-ai"?"HYB":histSrc==="quant-core"?"Q":histSrc==="fallback"?"F":"AI"} color={histSrcColor}/>}
                      {!isMobile && <Badge text={truth.text} color={truth.color}/>}
                      {!isMobile && <Badge text={truth.provenance.text} color={truth.provenance.color}/>}
                      {!isMobile && d?.dec?.audit_record?.crypto_signature?.status==="signed" && verify && (
                        <Badge
                          text={verify.status==="verified"?"SIG✓":verify.status==="unpinned"?"SIG⚠":verify.status==="invalid"?"SIG✗":"SIG?"}
                          color={verify.status==="verified"?C.ok:verify.status==="unpinned"?C.warn:verify.status==="invalid"?C.danger:C.dim}
                        />
                      )}
                    </div>
                    {!isMobile && <span style={{fontSize:12, color:C.text, ...mono}}>{d.dec.capital_allocation_kas} KAS</span>}
                    {!isMobile && <span style={{fontSize:12, color:d.dec.confidence_score>=0.8?C.ok:C.warn, ...mono}}>c:{d.dec.confidence_score}</span>}
                    <span style={{fontSize:11, color:C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                      {d.dec.rationale}{d?.dec?.audit_record?.decision_hash ? ` · ${String(d.dec.audit_record.decision_hash).slice(0,12)}` : ""}
                    </span>
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
