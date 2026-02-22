import { C, mono } from "../../tokens";
import { shortAddr } from "../../helpers";
import { Badge, Inp, Label } from "../ui";
import { RISK_OPTS, STRATEGY_TEMPLATES } from "./constants";

export const WStep1 = ({d, set, wallet}: any) => (
  <div>
    <div style={{fontSize:17, color:C.text, fontWeight:700, marginBottom:3, ...mono}}>Configure Agent</div>
    <div style={{fontSize:12, color:C.dim, marginBottom:20}}>Connected: <span style={{color:C.accent, ...mono}}>{shortAddr(wallet?.address)}</span></div>
    <Label>Strategy Template (Accumulation-First)</Label>
    <div style={{display:"grid", gridTemplateColumns:"1fr", gap:8, marginBottom:16}}>
      {STRATEGY_TEMPLATES.map((tpl) => {
        const on = d.strategyTemplate === tpl.id;
        return (
          <div
            key={tpl.id}
            onClick={() => {
              set("strategyTemplate", tpl.id);
              set("strategyLabel", tpl.name);
              set("strategyClass", tpl.class);
              Object.entries(tpl.defaults).forEach(([k, v]) => set(k, v));
            }}
            style={{
              padding:"10px 12px",
              borderRadius:8,
              cursor:"pointer",
              border:`1px solid ${on ? C.accent : C.border}`,
              background:on ? C.aLow : C.s2,
              transition:"all 0.15s",
            }}
          >
            <div style={{display:"flex", justifyContent:"space-between", gap:8, alignItems:"center", marginBottom:4}}>
              <div style={{fontSize:12, color:on?C.accent:C.text, fontWeight:700, ...mono}}>{tpl.name}</div>
              <Badge text={tpl.class.toUpperCase()} color={tpl.class === "accumulation" ? C.ok : C.warn}/>
            </div>
            <div style={{fontSize:11, color:C.dim}}>{tpl.desc}</div>
          </div>
        );
      })}
    </div>
    <Inp label="Agent Name" value={d.name} onChange={(v: string)=>set("name", v)} placeholder="KAS-Alpha-01"/>
    <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
      <Inp label="ROI Target" value={d.kpiTarget} onChange={(v: string)=>set("kpiTarget", v)} type="number" placeholder="12" suffix="%"/>
      <Inp label="Capital / Cycle" value={d.capitalLimit} onChange={(v: string)=>set("capitalLimit", v)} type="number" placeholder="5000" suffix="KAS"/>
    </div>
    <Label>Risk Tolerance</Label>
    <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8}}>
      {RISK_OPTS.map(r=>{const on = d.risk === r.v; return (
        <div key={r.v} onClick={()=>set("risk", r.v)} style={{padding:"12px 10px", borderRadius:4, cursor:"pointer", border:`1px solid ${on?C.accent:C.border}`, background:on?C.aLow:C.s2, textAlign:"center", transition:"all 0.15s"}}>
          <div style={{fontSize:13, color:on?C.accent:C.text, fontWeight:700, ...mono, marginBottom:3}}>{r.l}</div>
          <div style={{fontSize:11, color:C.dim}}>{r.desc}</div>
        </div>
      );})}
    </div>
  </div>
);
