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
    <div style={{padding:"10px 12px", borderRadius:6, border:`1px solid ${C.border}`, background:C.s2, marginBottom:6}}>
      <div style={{fontSize:11, color:C.dim, ...mono, marginBottom:4}}>PORTFOLIO ALLOCATOR</div>
      <div style={{fontSize:12, color:C.text}}>Automatic</div>
      <div style={{fontSize:11, color:C.dim, marginTop:2}}>
        Forge.OS manages shared portfolio allocation and risk budget weighting automatically. You fund in KAS and the bot handles routing.
      </div>
    </div>
    <Divider/>
    <Inp label="Auto-Approve Threshold" value={d.autoApproveThreshold} onChange={(v: string)=>set("autoApproveThreshold", v)} type="number" suffix="KAS" hint="Transactions under this amount sign automatically in autonomous mode. Above threshold always requires manual wallet signing."/>
  </div>
);
