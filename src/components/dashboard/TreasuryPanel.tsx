import { useEffect, useState } from "react";
import { BarChart, Bar, CartesianGrid, Tooltip, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { AGENT_SPLIT, EXPLORER, TREASURY, TREASURY_FEE_KAS, TREASURY_FEE_ONCHAIN_ENABLED, TREASURY_SPLIT } from "../../constants";
import { fmtT } from "../../helpers";
import { LOG_COL } from "../../log/seedLog";
import { C, mono } from "../../tokens";
import { Btn, Card, ExtLink, Label } from "../ui";

export function TreasuryPanel({log, agentCapital}: any) {
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
  const statsGrid = isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)";
  const ledgerCols = isMobile ? "82px 58px 1fr" : "90px 60px 90px 90px 1fr";

  const feeEntries = log.filter((l: any)=>l.fee!=null);
  const totalFees  = parseFloat(feeEntries.reduce((s: number, l: any)=>s+(l.fee||0),0).toFixed(4));
  const treasuryCollected = parseFloat((totalFees*TREASURY_SPLIT).toFixed(4));
  const agentPool  = parseFloat((totalFees*AGENT_SPLIT).toFixed(4));
  const execCount  = log.filter((l: any)=>l.type==="EXEC").length;

  const barData = feeEntries.slice(0,10).reverse().map((e: any, i: number)=>({
    label: `#${i+1}`,
    treasury: parseFloat((e.fee*TREASURY_SPLIT).toFixed(4)),
    pool: parseFloat((e.fee*AGENT_SPLIT).toFixed(4)),
  }));

  return(
    <div>
      <div style={{fontSize:13, color:C.text, fontWeight:700, ...mono, marginBottom:4}}>Treasury & Fee Routing</div>
      <div style={{fontSize:12, color:C.dim, marginBottom:16}}>All protocol fees split automatically: {(AGENT_SPLIT*100)}% agent pool · {(TREASURY_SPLIT*100)}% treasury.</div>

      <div style={{display:"grid", gridTemplateColumns:statsGrid, gap:10, marginBottom:14}}>
        {[
          {l:"Total Fees Paid",   v:`${totalFees} KAS`,          c:C.text},
          {l:"Treasury Collected",v:`${treasuryCollected} KAS`,  c:C.warn},
          {l:"Agent Pool",        v:`${agentPool} KAS`,           c:C.ok},
          {l:"Exec Cycles",       v:execCount,                    c:C.dim},
        ].map(r=> (
          <Card key={r.l} p={14}><Label>{r.l}</Label><div style={{fontSize:18, color:r.c, fontWeight:700, ...mono}}>{r.v}</div></Card>
        ))}
      </div>

      <Card p={18} style={{marginBottom:12}}>
        <Label>Treasury Address</Label>
        <div style={{fontSize:12, color:C.accent, ...mono, wordBreak:"break-all", marginBottom:10}}>{TREASURY}</div>
        <div style={{fontSize:11, color:C.dim, marginBottom:10, ...mono}}>
          Treasury payout mode: {TREASURY_FEE_ONCHAIN_ENABLED ? "ON-CHAIN ENABLED" : "LEDGER-ONLY"} · per execution payout {TREASURY_FEE_KAS} KAS
        </div>
        <div style={{display:"flex", gap:8}}>
          <Btn onClick={()=>navigator.clipboard?.writeText(TREASURY)} variant="ghost" size="sm">COPY</Btn>
          <ExtLink href={`${EXPLORER}/addresses/${TREASURY}`} label="VERIFY ON-CHAIN ↗"/>
        </div>
      </Card>

      {barData.length>0 && (
        <Card p={18} style={{marginBottom:12}}>
          <Label>Fee Split History (last {barData.length} cycles)</Label>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={barData} margin={{top:4, right:4, left:-24, bottom:0}}>
              <CartesianGrid stroke={C.border} vertical={false}/>
              <XAxis dataKey="label" tick={{fill:C.dim, fontSize:10, fontFamily:"Courier New"}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fill:C.dim, fontSize:10, fontFamily:"Courier New"}} tickLine={false} axisLine={false} tickFormatter={v=>`${v}`}/>
              <Tooltip contentStyle={{background:C.s2, border:`1px solid ${C.border}`, borderRadius:4, ...mono, fontSize:11}}/>
              <Bar dataKey="pool"     fill={C.ok}   radius={[2,2,0,0]} name="Agent Pool"/>
              <Bar dataKey="treasury" fill={C.warn}  radius={[2,2,0,0]} name="Treasury"/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card p={0}>
        <div style={{padding:"11px 16px", borderBottom:`1px solid ${C.border}`}}>
          <span style={{fontSize:11, color:C.dim, ...mono}}>FEE LEDGER — ALL ENTRIES</span>
        </div>
        {feeEntries.slice(0,12).map((e: any, i: number)=> (
          <div key={i} style={{display:"grid", gridTemplateColumns:ledgerCols, gap:8, padding:"8px 16px", borderBottom:`1px solid ${C.border}`, alignItems:"center"}}>
            <span style={{fontSize:11, color:C.dim, ...mono}}>{fmtT(e.ts)}</span>
            <span style={{fontSize:11, color:LOG_COL[e.type], ...mono, fontWeight:700}}>{e.type}</span>
            {!isMobile && <span style={{fontSize:12, color:C.text, ...mono}}>{e.fee} KAS</span>}
            {!isMobile && <span style={{fontSize:11, color:C.warn, ...mono}}>{(e.fee*TREASURY_SPLIT).toFixed(4)} → tsy</span>}
            <span style={{fontSize:11, color:C.dim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{e.msg}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
