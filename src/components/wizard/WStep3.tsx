import { ACCUMULATION_VAULT, DEFAULT_NETWORK } from "../../constants";
import { shortAddr } from "../../helpers";
import { C, mono } from "../../tokens";
import { Btn, Card } from "../ui";

export const WStep3 = ({d, wallet, onDeploy}: any) => {
  const canDeploy = d.name && d.capitalLimit && d.kpiTarget;
  return(
    <div>
      <div style={{fontSize:17, color:C.text, fontWeight:700, marginBottom:3, ...mono}}>Review & Deploy</div>
      <div style={{fontSize:12, color:C.dim, marginBottom:18}}>Agent vault will be provisioned. Initial funding requires a wallet signature.</div>
      <Card p={0} style={{marginBottom:14}}>
        {[["Agent", d.name || "—"], ["Strategy Template", d.strategyLabel || d.strategyTemplate || "Custom"], ["Wallet", shortAddr(wallet?.address)], ["Network", wallet?.network || DEFAULT_NETWORK], ["ROI Target", `${d.kpiTarget}%`], ["Capital / Cycle", `${d.capitalLimit} KAS`], ["Portfolio Target", `${d.portfolioAllocationPct || "—"}%`], ["Risk Budget Weight", String(d.riskBudgetWeight || "1.0")], ["Risk", d.risk.toUpperCase()], ["Exec Mode", d.execMode.replace(/_/g, " ").toUpperCase()], ["Auto-Approve Under", `${d.autoApproveThreshold} KAS`]].map(([k,v],i,a)=>(
          <div key={k as any} style={{display:"flex", justifyContent:"space-between", padding:"9px 16px", borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
            <span style={{fontSize:12, color:C.dim, ...mono}}>{k}</span>
            <span style={{fontSize:12, color:C.text, ...mono}}>{v}</span>
          </div>
        ))}
      </Card>
      <div style={{background:C.wLow, border:`1px solid ${C.warn}30`, borderRadius:4, padding:"10px 14px", marginBottom:16, fontSize:12, color:C.dim}}>
        Deployment triggers a wallet signature to provision the agent vault. Vault address: <span style={{color:C.accent, ...mono}}>{shortAddr(ACCUMULATION_VAULT)}</span>
      </div>
      <Btn onClick={onDeploy} disabled={!canDeploy} style={{width:"100%", padding:"11px 0"}}>DEPLOY AGENT — SIGN WITH WALLET</Btn>
      {!canDeploy && <div style={{fontSize:11, color:C.warn, marginTop:6, textAlign:"center", ...mono}}>Name, capital, and target required.</div>}
    </div>
  );
};
