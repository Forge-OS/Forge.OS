import { useEffect, useMemo, useRef, useState } from "react";
import { C, mono } from "../../tokens";
import { fmtT } from "../../helpers";
import { decisionAuditVerifyCacheKey, type AuditCryptoVerificationResult, verifyDecisionAuditCryptoSignature } from "../../runtime/auditCryptoVerify";
import { Badge, Btn, Card, Label } from "../ui";

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
                {latestTruth && <Badge text={`TRUTH ${latestTruth.text}`} color={latestTruth.color}/>}
                {latestTruth && <Badge text={`PROV ${latestTruth.provenance.text}`} color={latestTruth.provenance.color}/>}
                {quant?.regime && <Badge text={`REGIME ${String(quant.regime).replace(/_/g, " ")}`} color={C.accent}/>}
                {dec?.audit_record?.audit_sig && <Badge text="AUDIT READY" color={C.text}/>}
                {cryptoSig?.status === "signed" && <Badge text="CRYPTO SIGNED" color={C.ok}/>}
                {cryptoSig?.status === "signed" && cryptoVerifyBadge(latestAuditVerify)}
                {latestAuditVerify?.pinMatched === true && <Badge text="KEY PINNED" color={C.accent}/>}
                {latestAuditVerify?.pinMatched === false && <Badge text="KEY UNPINNED" color={C.warn}/>}
                {cryptoSig?.status === "error" && <Badge text="CRYPTO SIGN ERR" color={C.warn}/>}
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
                ["Kelly Fraction", `${(dec.kelly_fraction*100).toFixed(1)}%`, C.accent, "Position sizing fraction after quant/AI guardrails. Higher is more aggressive."],
                ["Monte Carlo Win", `${dec.monte_carlo_win_pct}%`, C.ok, "Model-estimated win probability for the current setup; not guaranteed realized PnL."],
                ["Capital Alloc", `${dec.capital_allocation_kas} KAS`, C.text, "Proposed KAS amount for this cycle after portfolio caps and risk controls."],
                ["Expected Value", `+${dec.expected_value_pct}%`, C.ok, "Expected edge for this decision before realized execution drift is known."],
                ["Stop Loss", `-${dec.stop_loss_pct}%`, C.danger, "Loss control target used for risk envelope logic."],
                ["Take Profit", `+${dec.take_profit_pct}%`, C.ok, "Profit-taking target used for expected value and phase planning."],
                ["Volatility", dec.volatility_estimate, dec.volatility_estimate==="HIGH"?C.danger:dec.volatility_estimate==="MEDIUM"?C.warn:C.ok, "Quant-estimated volatility bucket; high volatility tightens trust in raw signals."],
                ["Liquidity Impact", dec.liquidity_impact, dec.liquidity_impact==="SIGNIFICANT"?C.danger:C.dim, "Estimated execution friction/slippage pressure for current market conditions."],
                ["Engine Latency", `${dec.engine_latency_ms || 0} ms`, (dec.engine_latency_ms || 0) <= 2500 ? C.ok : C.warn, "Decision engine runtime (quant + AI overlay path + fusion) for this cycle."],
                ["Data Quality", quant?.data_quality_score ?? "—", (quant?.data_quality_score ?? 0) >= 0.75 ? C.ok : C.warn, "Signal trust score from quant feature sufficiency and stability. Low quality reduces automation confidence."],
              ].map(([k,v,c,hint])=> (
                <div key={k as any} title={String(hint)} style={{background:C.s2, borderRadius:4, padding:"10px 12px"}}>
                  <div style={{fontSize:10, color:C.dim, ...mono, letterSpacing:"0.06em", marginBottom:4}}>{k}</div>
                  <div style={{fontSize:13, color:c as any, fontWeight:700, ...mono}}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{display:"grid", gridTemplateColumns:isMobile ? "1fr" : "repeat(3,1fr)", gap:8, marginBottom:14}}>
              {[
                ["Sizing", "Kelly Fraction + Capital Alloc are your practical position-size controls in KAS."],
                ["Trust", "Data Quality + Regime + Risk/Confidence tell you whether to trust the action or wait."],
                ["Execution", "Liquidity Impact + Engine Latency help explain slippage risk and cycle responsiveness."],
              ].map(([title, text]) => (
                <div key={String(title)} style={{background:`linear-gradient(180deg, ${C.s2} 0%, ${C.s1} 100%)`, border:`1px solid ${C.border}`, borderRadius:6, padding:"9px 10px"}}>
                  <div style={{fontSize:10, color:C.accent, ...mono, marginBottom:3}}>{title}</div>
                  <div style={{fontSize:11, color:C.dim, lineHeight:1.35}}>{text}</div>
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
              {dec.audit_record && (
                <div style={{fontSize:11, color:C.dim, marginTop:8, ...mono, lineHeight:1.5}}>
                  <div>
                    audit: {String(dec.audit_record.audit_record_version || "—")} · prompt {String(dec.audit_record.prompt_version || "—")} · schema {String(dec.audit_record.ai_response_schema_version || "—")}
                  </div>
                  <div>
                    qhash {String(dec.audit_record.quant_feature_snapshot_hash || "—").slice(0, 22)}… · dhash {String(dec.audit_record.decision_hash || "—").slice(0, 22)}… · sig {String(dec.audit_record.audit_sig || "—").slice(0, 18)}…
                  </div>
                  {dec.audit_record.crypto_signature && (
                    <div>
                      crypto {String(dec.audit_record.crypto_signature.status || "unknown")} · {String(dec.audit_record.crypto_signature.alg || "—")} · key {String(dec.audit_record.crypto_signature.key_id || "—").slice(0, 22)}
                    </div>
                  )}
                  {dec.audit_record.crypto_signature?.status === "signed" && (
                    <div>{cryptoVerifyDetail(latestAuditVerify)}</div>
                  )}
                </div>
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
              <div style={{fontSize:11, color:C.dim, marginBottom:10}}>
                Raw quant features behind the decision. Use these to understand regime behavior and why guardrails or AI fusion changed sizing/action.
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
                const truth = truthLabelForDecision(d);
                const verify = d?.dec?.audit_record?.decision_hash
                  ? auditVerifyByDecisionHash[String(d.dec.audit_record.decision_hash)]?.result || null
                  : null;
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
                    <div style={{display:"flex", gap:6, alignItems:"center", flexWrap:"wrap"}}>
                      <Badge text={d.dec.action} color={c}/>
                      {!isMobile && <Badge text={historySourceLabel} color={historySourceColor}/>}
                      {!isMobile && <Badge text={truth.text} color={truth.color}/>}
                      {!isMobile && <Badge text={truth.provenance.text} color={truth.provenance.color}/>}
                      {!isMobile && d?.dec?.audit_record?.crypto_signature?.status === "signed" && verify && (
                        <Badge
                          text={
                            verify.status === "verified"
                              ? "SIG✓"
                              : verify.status === "unpinned"
                                ? "SIG⚠"
                                : verify.status === "invalid"
                                  ? "SIG✗"
                                  : "SIG?"
                          }
                          color={
                            verify.status === "verified"
                              ? C.ok
                              : verify.status === "unpinned"
                                ? C.warn
                                : verify.status === "invalid"
                                  ? C.danger
                                  : C.dim
                          }
                        />
                      )}
                    </div>
                    {!isMobile && <span style={{fontSize:12, color:C.text, ...mono}}>{d.dec.capital_allocation_kas} KAS</span>}
                    {!isMobile && <span style={{fontSize:12, color:d.dec.confidence_score>=0.8?C.ok:C.warn, ...mono}}>c:{d.dec.confidence_score}</span>}
                    <span style={{fontSize:11, color:C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                      {d.dec.rationale}
                      {d?.dec?.audit_record?.decision_hash ? ` · ${String(d.dec.audit_record.decision_hash).slice(0, 12)}` : ""}
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
