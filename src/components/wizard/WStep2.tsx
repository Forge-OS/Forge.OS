import { C, mono } from "../../tokens";
import { Divider, Inp } from "../ui";
import { EXEC_OPTS } from "./constants";

export const WStep2 = ({d, set}: any) => (
  <div>
    <div style={{fontSize:17, color:C.text, fontWeight:700, marginBottom:3, ...mono}}>Execution & Signing</div>
    <div style={{fontSize:12, color:C.dim, marginBottom:20}}>Configure how the agent acts and when your wallet signs.</div>
    {EXEC_OPTS.map(m=>{const on = d.execMode === m.v; return (
      <div key={m.v} onClick={()=>set("execMode", m.v)} style={{padding:14, borderRadius:6, marginBottom:10, cursor:"pointer", border:`1px solid ${on?C.accent:C.border}`, background:on?C.aLow:C.s2, transition:"all 0.15s"}}>
        <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:4}}>
          <div style={{width:11, height:11, borderRadius:"50%", border:`2px solid ${on?C.accent:C.muted}`, background:on?C.accent:"transparent", flexShrink:0}}/>
          <span style={{fontSize:13, color:on?C.accent:C.text, fontWeight:700, ...mono}}>{m.l}</span>
        </div>
        <div style={{fontSize:12, color:C.dim, marginLeft:21}}>{m.desc}</div>
      </div>
    );})}
    <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
      <Inp label="Portfolio Allocation %" value={d.portfolioAllocationPct} onChange={(v: string)=>set("portfolioAllocationPct", v)} type="number" suffix="%" hint="Default allocation share inside shared portfolio budget."/>
      <Inp label="Risk Budget Weight" value={d.riskBudgetWeight} onChange={(v: string)=>set("riskBudgetWeight", v)} type="number" hint="Relative weight for shared risk allocator (e.g. 0.5, 1.0, 2.0)."/>
    </div>
    <Divider/>
    <Inp label="Auto-Approve Threshold" value={d.autoApproveThreshold} onChange={(v: string)=>set("autoApproveThreshold", v)} type="number" suffix="KAS" hint="Transactions under this amount sign automatically in autonomous mode. Above threshold always requires manual wallet signing."/>
  </div>
);
