import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import {
  ACCUMULATE_ONLY,
  ACCUMULATION_VAULT,
  AGENT_SPLIT,
  CONF_THRESHOLD,
  FEE_RATE,
  KAS_WS_URL,
  NET_FEE,
  RESERVE,
  TREASURY_SPLIT,
} from "../../constants";
import { kasBalance, kasNetworkInfo } from "../../api/kaspaApi";
import { fmtT, shortAddr, uid } from "../../helpers";
import { runQuantEngine } from "../../quant/runQuantEngine";
import { LOG_COL, seedLog } from "../../log/seedLog";
import { C, mono } from "../../tokens";
import { WalletAdapter } from "../../wallet/WalletAdapter";
import { SigningModal } from "../SigningModal";
import { Badge, Btn, Card, Label } from "../ui";
import { EXEC_OPTS } from "../wizard/constants";
import { ActionQueue } from "./ActionQueue";
import { TreasuryPanel } from "./TreasuryPanel";
import { WalletPanel } from "./WalletPanel";

const PerfChart = lazy(() => import("./PerfChart").then((m) => ({ default: m.PerfChart })));
const IntelligencePanel = lazy(() =>
  import("./IntelligencePanel").then((m) => ({ default: m.IntelligencePanel }))
);

export function Dashboard({agent, wallet}: any) {
  const LIVE_POLL_MS = 5000;
  const [tab, setTab] = useState("overview");
  const [status, setStatus] = useState("RUNNING");
  const [log, setLog] = useState(()=>seedLog(agent.name));
  const [decisions, setDecisions] = useState([] as any[]);
  const [loading, setLoading] = useState(false);
  const [execMode, setExecMode] = useState(agent.execMode || "manual");
  const [autoThresh] = useState(parseFloat(agent.autoApproveThreshold) || 50);
  const [queue, setQueue] = useState([] as any[]);
  const [signingItem, setSigningItem] = useState(null as any);
  const [kasData, setKasData] = useState(null as any);
  const [kasDataLoading, setKasDataLoading] = useState(true);
  const [kasDataError, setKasDataError] = useState(null as any);
  const [liveConnected, setLiveConnected] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );

  const addLog = useCallback((e: any)=>setLog((p: any)=>[{ts:Date.now(), ...e}, ...p]), []);

  // Fetch Kaspa on-chain data (no external APIs)
  const refreshKasData = useCallback(async()=>{
    setKasDataLoading(true);
    setKasDataError(null);
    try{
      const [dag, bal] = await Promise.all([kasNetworkInfo(), kasBalance(wallet?.address)]);
      setKasData({ dag, walletKas: bal.kas, address: wallet?.address, fetched: Date.now() });
      setLiveConnected(true);
    }catch(e){
      setLiveConnected(false);
      setKasDataError((e as any)?.message || "Kaspa live feed disconnected");
    }
    setKasDataLoading(false);
  },[wallet]);

  useEffect(()=>{
    refreshKasData();

    const id = setInterval(refreshKasData, LIVE_POLL_MS);

    let ws: WebSocket | null = null;
    if(KAS_WS_URL){
      ws = new WebSocket(KAS_WS_URL);

      ws.onopen = ()=>{
        setStreamConnected(true);
      };

      ws.onmessage = ()=>{
        refreshKasData();
      };

      ws.onerror = ()=>{
        setStreamConnected(false);
      };

      ws.onclose = ()=>{
        setStreamConnected(false);
      };
    }

    return ()=>{
      clearInterval(id);
      if(ws){
        ws.close();
      }
    };
  },[refreshKasData]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isMobile = viewportWidth < 760;
  const isTablet = viewportWidth < 1024;

  const summaryGridCols = useMemo(() => {
    if (isMobile) return "1fr";
    if (isTablet) return "repeat(2,1fr)";
    return "repeat(4,1fr)";
  }, [isMobile, isTablet]);

  const splitGridCols = isTablet ? "1fr" : "2fr 1fr";
  const controlsGridCols = isTablet ? "1fr" : "1fr 1fr";

  const riskThresh = agent.risk==="low"?0.4:agent.risk==="medium"?0.65:0.85;

  const runCycle = async()=>{
    if(status!=="RUNNING" || loading) return;
    if(!kasData){
      addLog({type:"ERROR", msg:"No live Kaspa data available. Reconnect feed before running cycle.", fee:null});
      return;
    }
    setLoading(true);
    addLog({type:"DATA", msg:`Kaspa DAG snapshot: DAA ${kasData?.dag?.daaScore||"—"} · Wallet ${kasData?.walletKas||"—"} KAS`, fee:null});
    try{
      const dec = await runQuantEngine(agent, kasData||{});
      if (ACCUMULATE_ONLY && !["ACCUMULATE", "HOLD"].includes(dec.action)) {
        dec.action = "HOLD";
        dec.rationale = `${String(dec.rationale || "")} Execution constrained by accumulate-only mode.`.trim();
      }

      addLog({type:"AI", msg:`${dec.action} · Conf ${dec.confidence_score} · Kelly ${(dec.kelly_fraction*100).toFixed(1)}% · Monte Carlo ${dec.monte_carlo_win_pct}% win`, fee:0.12});

      const confOk = dec.confidence_score>=CONF_THRESHOLD;
      const riskOk = dec.risk_score<=riskThresh;
      const liveKas = Number(kasData?.walletKas || 0);
      const availableToSpend = Math.max(0, liveKas - RESERVE - NET_FEE);

      if(!riskOk){
        addLog({type:"VALID", msg:`Risk gate FAILED — score ${dec.risk_score} > ${riskThresh} ceiling`, fee:null});
        addLog({type:"EXEC", msg:"BLOCKED by risk gate", fee:0.03});
      } else if(!confOk){
        addLog({type:"VALID", msg:`Confidence ${dec.confidence_score} < ${CONF_THRESHOLD} threshold`, fee:null});
        addLog({type:"EXEC", msg:"HOLD — confidence gate enforced", fee:0.08});
      } else if (dec.action === "ACCUMULATE" && availableToSpend <= 0) {
        addLog({type:"VALID", msg:`Insufficient spendable balance after reserve (${RESERVE} KAS + ${NET_FEE} KAS network fee).`, fee:null});
        addLog({type:"EXEC", msg:"HOLD — waiting for available balance", fee:0.03});
      } else {
        addLog({type:"VALID", msg:`Risk OK (${dec.risk_score}) · Conf OK (${dec.confidence_score}) · Kelly ${(dec.kelly_fraction*100).toFixed(1)}%`, fee:null});
        setDecisions((p: any)=>[{ts:Date.now(), dec, kasData}, ...p]);

        if(dec.action!=="HOLD"){
          const requested = Number(dec.capital_allocation_kas || 0);
          const amountKas = dec.action === "ACCUMULATE" ? Math.min(requested, availableToSpend) : requested;
          if (requested > amountKas) {
            addLog({type:"SYSTEM", msg:`Clamped execution amount from ${requested} to ${amountKas.toFixed(4)} KAS (available balance guardrail).`, fee:null});
          }
          if (!(amountKas > 0)) {
            addLog({type:"EXEC", msg:"HOLD — computed execution amount is zero", fee:0.03});
            setLoading(false);
            return;
          }
          const txItem = {
            id:uid(),
            type:dec.action,
            from:wallet?.address,
            to:ACCUMULATION_VAULT,
            amount_kas:Number(amountKas.toFixed(6)),
            purpose:dec.rationale.slice(0,60),
            status:"pending",
            ts:Date.now(),
            dec
          };
          const isAutoApprove = execMode==="autonomous" && txItem.amount_kas <= autoThresh;
          if(isAutoApprove){
            try {
              let txid = "";
              if(wallet?.provider === "kasware") {
                txid = await WalletAdapter.sendKasware(txItem.to, txItem.amount_kas);
              } else if(wallet?.provider === "kaspium") {
                txid = await WalletAdapter.sendKaspium(txItem.to, txItem.amount_kas, txItem.purpose);
              } else {
                // Demo mode fallback only.
                await new Promise(r=>setTimeout(r,400));
                txid = Array.from({length:64},()=>"0123456789abcdef"[Math.floor(Math.random()*16)]).join("");
              }

              addLog({type:"EXEC", msg:`AUTO-APPROVED: ${dec.action} · ${txItem.amount_kas} KAS · txid: ${txid.slice(0,16)}...`, fee:0.08});
              addLog({type:"TREASURY", msg:`Fee split → Pool: ${(FEE_RATE*AGENT_SPLIT).toFixed(4)} KAS / Treasury: ${(FEE_RATE*TREASURY_SPLIT).toFixed(4)} KAS`, fee:FEE_RATE});
              setQueue((p: any)=>[{...txItem, status:"signed", txid}, ...p]);
            } catch (e: any) {
              setQueue((p: any)=>[txItem, ...p]);
              addLog({type:"SIGN", msg:`Auto-approve fallback to manual queue: ${e?.message || "wallet broadcast failed"}`, fee:null});
            }
          } else {
            addLog({type:"SIGN", msg:`Action queued for wallet signature: ${dec.action} · ${txItem.amount_kas} KAS`, fee:null});
            setQueue((p: any)=>[txItem, ...p]);
          }
        } else {
          addLog({type:"EXEC", msg:"HOLD — no action taken", fee:0.08});
        }
      }
    }catch(e: any){addLog({type:"ERROR", msg:e.message, fee:null});}
    setLoading(false);
  };

  const handleQueueSign = (item: any) => { setSigningItem(item); };
  const handleQueueReject = (id: string) => { setQueue((p: any)=>p.map((q: any)=>q.id===id?{...q,status:"rejected"}:q)); addLog({type:"SIGN", msg:`Transaction rejected by operator: ${id}`, fee:null}); };
  const handleSigned = (tx: any) => {
    setQueue((p: any)=>p.map((q: any)=>q.id===signingItem?.id?{...q,status:"signed",txid:tx.txid}:q));
    addLog({type:"EXEC", msg:`SIGNED: ${signingItem?.type} · ${signingItem?.amount_kas} KAS · txid: ${tx.txid?.slice(0,16)}...`, fee:0.08});
    addLog({type:"TREASURY", msg:`Fee split → Pool: ${(FEE_RATE*AGENT_SPLIT).toFixed(4)} KAS / Treasury: ${(FEE_RATE*TREASURY_SPLIT).toFixed(4)} KAS`, fee:FEE_RATE});
    setSigningItem(null);
  };

  const killSwitch = () => {setStatus("SUSPENDED"); addLog({type:"SYSTEM", msg:"KILL-SWITCH activated — agent suspended. All pending actions cancelled.", fee:null}); setQueue((p: any)=>p.map((q: any)=>q.status==="pending"?{...q,status:"rejected"}:q));};

  const pendingCount = queue.filter((q: any)=>q.status==="pending").length;
  const totalFees = parseFloat(log.filter((l: any)=>l.fee).reduce((s: number, l: any)=>s+(l.fee||0),0).toFixed(4));
  const TABS = [{k:"overview",l:"OVERVIEW"},{k:"intelligence",l:"INTELLIGENCE"},{k:"queue",l:`QUEUE${pendingCount>0?` (${pendingCount})`:""}`},{k:"treasury",l:"TREASURY"},{k:"wallet",l:"WALLET"},{k:"log",l:"LOG"},{k:"controls",l:"CONTROLS"}];

  return(
    <div style={{maxWidth:1080, margin:"0 auto", padding:isMobile ? "14px 14px" : "18px 20px"}}>
      {signingItem && <SigningModal tx={signingItem} wallet={wallet} onSign={handleSigned} onReject={()=>setSigningItem(null)}/>}

      {/* Header */}
      <div style={{display:"flex", flexDirection:isMobile ? "column" : "row", justifyContent:"space-between", alignItems:isMobile ? "stretch" : "flex-start", marginBottom:16, gap:isMobile ? 10 : 0}}>
        <div>
          <div style={{fontSize:11, color:C.dim, letterSpacing:"0.1em", ...mono, marginBottom:2}}>FORGEOS / AGENT / {agent.name}</div>
          <div style={{fontSize:18, color:C.text, fontWeight:700, ...mono}}>{agent.name}</div>
        </div>
        <div style={{display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", justifyContent:isMobile ? "flex-start" : "flex-end"}}>
          <Badge text={status} color={status==="RUNNING"?C.ok:status==="PAUSED"?C.warn:C.danger} dot/>
          <Badge text={execMode.toUpperCase()} color={C.accent}/>
          <Badge text={ACCUMULATE_ONLY ? "ACCUMULATE-ONLY" : "MULTI-ACTION"} color={ACCUMULATE_ONLY ? C.ok : C.warn}/>
          <Badge text={wallet?.provider?.toUpperCase()||"WALLET"} color={C.purple} dot/>
          <Badge text={liveConnected?"DAG LIVE":"DAG OFFLINE"} color={liveConnected?C.ok:C.danger} dot/>
          <Badge text={KAS_WS_URL?(streamConnected?"STREAM LIVE":"STREAM DOWN"):"STREAM OFF"} color={KAS_WS_URL?(streamConnected?C.ok:C.warn):C.dim} dot/>
        </div>
      </div>

      {!!kasDataError && (
        <div style={{background:C.dLow,border:`1px solid ${C.danger}40`,borderRadius:6,padding:"11px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
          <span style={{fontSize:12,color:C.danger,...mono}}>Kaspa live feed error (poll fallback): {kasDataError}</span>
          <Btn onClick={refreshKasData} disabled={kasDataLoading} size="sm" variant="ghost">{kasDataLoading?"RECONNECTING...":"RECONNECT FEED"}</Btn>
        </div>
      )}

      {/* Pending signature alert */}
      {pendingCount>0 && (
        <div style={{background:C.wLow, border:`1px solid ${C.warn}40`, borderRadius:6, padding:"11px 16px", marginBottom:14, display:"flex", alignItems:isMobile ? "flex-start" : "center", justifyContent:"space-between", flexDirection:isMobile ? "column" : "row", gap:isMobile ? 8 : 0}}>
          <span style={{fontSize:12, color:C.warn, ...mono}}>⚠ {pendingCount} transaction{pendingCount>1?"s":""} awaiting wallet signature</span>
          <Btn onClick={()=>setTab("queue")} size="sm" variant="warn">VIEW QUEUE</Btn>
        </div>
      )}

      {/* Tabs */}
      <div style={{display:"flex", borderBottom:`1px solid ${C.border}`, marginBottom:18, overflowX:"auto"}}>
        {TABS.map(t=> (
          <button key={t.k} onClick={()=>setTab(t.k)} style={{background:"none", border:"none", borderBottom:`2px solid ${tab===t.k?C.accent:"transparent"}`, color:tab===t.k?C.accent:C.dim, padding:"7px 14px", fontSize:11, cursor:"pointer", letterSpacing:"0.08em", ...mono, marginBottom:-1, whiteSpace:"nowrap", transition:"color 0.15s"}}>
            {t.l}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab==="overview" && (
        <div>
          <div style={{display:"grid", gridTemplateColumns:summaryGridCols, gap:10, marginBottom:12}}>
            {[
              {l:"Wallet Balance",    v:`${kasData?.walletKas||agent.capitalLimit} KAS`, s:shortAddr(wallet?.address),          c:C.accent},
              {l:"DAA Score",         v:kasData?.dag?.daaScore?.toLocaleString()||"—",   s:"Kaspa DAG height",                  c:C.text},
              {l:"Pending Signatures",v:pendingCount,                                    s:"In action queue",                   c:pendingCount>0?C.warn:C.dim},
              {l:"Total Protocol Fees",v:`${totalFees} KAS`,                             s:`${(totalFees*TREASURY_SPLIT).toFixed(4)} KAS → treasury`, c:C.text},
            ].map(r=> (
              <Card key={r.l} p={14}><Label>{r.l}</Label><div style={{fontSize:18, color:r.c, fontWeight:700, ...mono, marginBottom:2}}>{r.v}</div><div style={{fontSize:11, color:C.dim}}>{r.s}</div></Card>
            ))}
          </div>
          <div style={{marginBottom:12}}>
            <Suspense fallback={<Card p={18}><Label>Performance</Label><div style={{fontSize:12,color:C.dim}}>Loading performance chart...</div></Card>}>
              <PerfChart decisions={decisions} kpiTarget={agent.kpiTarget}/>
            </Suspense>
          </div>
          <div style={{display:"grid", gridTemplateColumns:splitGridCols, gap:12}}>
            <Card p={18}>
              <Label>Agent Configuration</Label>
              {[["Strategy","Momentum / On-Chain Flow"],["Risk",agent.risk.toUpperCase()],["Capital / Cycle",`${agent.capitalLimit} KAS`],["Exec Mode",execMode.toUpperCase()],["Auto-Approve ≤",`${autoThresh} KAS`],["Horizon",`${agent.horizon} days`],["KPI Target",`${agent.kpiTarget}% ROI`]].map(([k,v])=> (
                <div key={k as any} style={{display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${C.border}`}}>
                  <span style={{fontSize:12, color:C.dim, ...mono}}>{k}</span>
                  <span style={{fontSize:12, color:C.text, ...mono}}>{v}</span>
                </div>
              ))}
            </Card>
            <Card p={18}>
              <Label>Actions</Label>
              <div style={{display:"flex", flexDirection:"column", gap:8}}>
                <Btn onClick={runCycle} disabled={loading||status!=="RUNNING"} style={{padding:"10px 0"}}>{loading?"PROCESSING...":"RUN QUANT CYCLE"}</Btn>
                <Btn onClick={refreshKasData} disabled={kasDataLoading} variant="ghost" style={{padding:"9px 0"}}>{kasDataLoading?"FETCHING DAG...":liveConnected?"REFRESH KASPA DATA":KAS_WS_URL?"RECONNECT STREAM/DATA":"RECONNECT KASPA FEED"}</Btn>
                <Btn onClick={()=>setTab("queue")} variant="ghost" style={{padding:"9px 0"}}>ACTION QUEUE {pendingCount>0?`(${pendingCount})`:""}</Btn>
                <Btn onClick={()=>setStatus((s: string)=>s==="RUNNING"?"PAUSED":"RUNNING")} variant="ghost" style={{padding:"9px 0"}}>{status==="RUNNING"?"PAUSE":"RESUME"}</Btn>
                <Btn onClick={killSwitch} variant="danger" style={{padding:"9px 0"}}>KILL-SWITCH</Btn>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab==="intelligence" && (
        <Suspense fallback={<Card p={18}><Label>Intelligence</Label><div style={{fontSize:12,color:C.dim}}>Loading intelligence panel...</div></Card>}>
          <IntelligencePanel decisions={decisions} loading={loading} onRun={runCycle}/>
        </Suspense>
      )}
      {tab==="queue" && <ActionQueue queue={queue} wallet={wallet} onSign={handleQueueSign} onReject={handleQueueReject}/>}
      {tab==="treasury" && <TreasuryPanel log={log} agentCapital={agent.capitalLimit}/>}
      {tab==="wallet" && <WalletPanel agent={agent} wallet={wallet}/>}

      {/* ── LOG ── */}
      {tab==="log" && (
        <Card p={0}>
          <div style={{padding:"12px 18px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <span style={{fontSize:11, color:C.dim, ...mono}}>{log.length} entries · {totalFees} KAS fees</span>
            <Btn onClick={runCycle} disabled={loading||status!=="RUNNING"} size="sm">{loading?"...":"RUN CYCLE"}</Btn>
          </div>
          <div style={{maxHeight:520, overflowY:"auto"}}>
            {log.map((e: any, i: number)=>(
              <div key={i} style={{display:"grid", gridTemplateColumns:isMobile ? "74px 58px 1fr" : "92px 72px 1fr 80px", gap:10, padding:"8px 18px", borderBottom:`1px solid ${C.border}`, alignItems:"center"}}>
                <span style={{fontSize:11, color:C.dim, ...mono}}>{fmtT(e.ts)}</span>
                <span style={{fontSize:11, color:LOG_COL[e.type]||C.dim, fontWeight:700, ...mono}}>{e.type}</span>
                <span style={{fontSize:12, color:C.text, ...mono, lineHeight:1.4}}>{e.msg}</span>
                {!isMobile && <span style={{fontSize:11, color:C.dim, textAlign:"right", ...mono}}>{e.fee!=null?`${e.fee} KAS`:"—"}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── CONTROLS ── */}
      {tab==="controls" && (
        <div style={{display:"grid", gridTemplateColumns:controlsGridCols, gap:14}}>
          <Card p={18}>
            <Label>Execution Mode</Label>
            {EXEC_OPTS.map(m=>{const on=execMode===m.v; return(
              <div key={m.v} onClick={()=>setExecMode(m.v)} style={{padding:"12px 14px", borderRadius:4, marginBottom:8, cursor:"pointer", border:`1px solid ${on?C.accent:C.border}`, background:on?C.aLow:C.s2, transition:"all 0.15s"}}>
                <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:3}}>
                  <div style={{width:10, height:10, borderRadius:"50%", background:on?C.accent:C.muted, flexShrink:0}}/>
                  <span style={{fontSize:12, color:on?C.accent:C.text, fontWeight:700, ...mono}}>{m.l}</span>
                </div>
                <div style={{fontSize:11, color:C.dim, marginLeft:20}}>{m.desc}</div>
              </div>
            );})}
          </Card>
          <div style={{display:"flex", flexDirection:"column", gap:12}}>
            <Card p={18}>
              <Label>Agent Controls</Label>
              <div style={{display:"flex", flexDirection:"column", gap:8}}>
                <Btn onClick={()=>setStatus((s: string)=>s==="RUNNING"?"PAUSED":"RUNNING")} variant="ghost" style={{padding:"10px 0"}}>{status==="RUNNING"?"PAUSE AGENT":"RESUME AGENT"}</Btn>
                <Btn onClick={()=>setTab("wallet")} variant="ghost" style={{padding:"10px 0"}}>MANAGE WALLET</Btn>
                <Btn onClick={killSwitch} variant="danger" style={{padding:"10px 0"}}>ACTIVATE KILL-SWITCH</Btn>
              </div>
            </Card>
            <Card p={18}>
              <Label>Active Risk Limits — {agent.risk.toUpperCase()}</Label>
              {[["Max Single Exposure",agent.risk==="low"?"5%":agent.risk==="medium"?"10%":"20%",C.warn],["Drawdown Halt",agent.risk==="low"?"-8%":agent.risk==="medium"?"-15%":"-25%",C.danger],["Confidence Floor","0.75",C.dim],["Kelly Cap",agent.risk==="low"?"10%":agent.risk==="medium"?"20%":"40%",C.warn],["Auto-Approve ≤",`${autoThresh} KAS`,C.accent]].map(([k,v,c])=> (
                <div key={k as any} style={{display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${C.border}`}}>
                  <span style={{fontSize:12, color:C.dim, ...mono}}>{k}</span>
                  <span style={{fontSize:12, color:c as any, fontWeight:700, ...mono}}>{v}</span>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
