import { ACCUMULATION_VAULT, DEFAULT_NETWORK } from "../../constants";
import { shortAddr } from "../../helpers";
import { C, mono } from "../../tokens";
import { Btn, Card } from "../ui";
import { STRATEGY_TEMPLATES } from "./constants";

export const WStep3 = ({d, wallet, onDeploy}: any) => {
  const canDeploy = d.name && d.capitalLimit && d.kpiTarget;
  const strategyMeta = STRATEGY_TEMPLATES.find((tpl) => tpl.id === d.strategyTemplate);
  return(
    <div>
      <div style={{fontSize:17, color:C.text, fontWeight:700, marginBottom:3, ...mono}}>Review & Deploy</div>
      <div style={{fontSize:12, color:C.dim, marginBottom:18}}>Agent vault will be provisioned. Initial funding requires a wallet signature.</div>
      <Card p={0} style={{marginBottom:14}}>
        {[["Agent", d.name || "—"], ["Strategy Template", d.strategyLabel || d.strategyTemplate || "Custom"], ["Wallet", shortAddr(wallet?.address)], ["Network", wallet?.network || DEFAULT_NETWORK], ["ROI Target", `${d.kpiTarget}%`], ["Capital / Cycle", `${d.capitalLimit} KAS`], ["Portfolio Allocator", "AUTO"], ["Risk", d.risk.toUpperCase()], ["Exec Mode", d.execMode.replace(/_/g, " ").toUpperCase()], ["Auto-Approve Under", `${d.autoApproveThreshold} KAS`]].map(([k,v],i,a)=>(
          <div key={k as any} style={{display:"flex", justifyContent:"space-between", padding:"9px 16px", borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
            <span style={{fontSize:12, color:C.dim, ...mono}}>{k}</span>
            <span style={{fontSize:12, color:C.text, ...mono}}>{v}</span>
          </div>
        ))}
      </Card>
      {strategyMeta?.purpose && (
        <div style={{background:C.s2, border:`1px solid ${C.border}`, borderRadius:4, padding:"10px 14px", marginBottom:12}}>
          <div style={{fontSize:11, color:C.dim, ...mono, marginBottom:4}}>STRATEGY PURPOSE</div>
          <div style={{fontSize:12, color:C.text, marginBottom:4}}>{strategyMeta.purpose}</div>
          {strategyMeta.bestFor && <div style={{fontSize:11, color:C.dim}}>Best for: {strategyMeta.bestFor}</div>}
        </div>
      )}
      <div style={{background:C.s2, border:`1px solid ${C.border}`, borderRadius:4, padding:"9px 14px", marginBottom:12, fontSize:11, color:C.dim}}>
        Shared portfolio allocation and risk weighting are auto-managed by Forge.OS. Your primary funding input is <span style={{color:C.text, ...mono}}>Capital / Cycle (KAS)</span>.
      </div>
      <div style={{background:C.wLow, border:`1px solid ${C.warn}30`, borderRadius:4, padding:"10px 14px", marginBottom:16, fontSize:12, color:C.dim}}>
        Deployment triggers a wallet signature to provision the agent vault. Vault address: <span style={{color:C.accent, ...mono}}>{shortAddr(ACCUMULATION_VAULT)}</span>
      </div>
      <Btn onClick={onDeploy} disabled={!canDeploy} style={{width:"100%", padding:"11px 0"}}>DEPLOY AGENT — SIGN WITH WALLET</Btn>
      {!canDeploy && <div style={{fontSize:11, color:C.warn, marginTop:6, textAlign:"center", ...mono}}>Name, capital, and target required.</div>}
    </div>
  );
};
