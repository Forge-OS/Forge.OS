import { useState } from "react";
import { uid } from "../../helpers";
import { C, mono } from "../../tokens";
import { SigningModal } from "../SigningModal";
import { Badge, Btn, Card } from "../ui";
import { DEFS } from "./constants";
import { WStep1 } from "./WStep1";
import { WStep2 } from "./WStep2";
import { WStep3 } from "./WStep3";
import { ACCUMULATION_VAULT } from "../../constants";

export function Wizard({wallet, onComplete}: any) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState({...DEFS});
  const set = (k: string, v: any) => setD((p: any)=>({...p, [k]: v}));
  const [pendingSign, setPendingSign] = useState(false);

  const deploy = () => {
    setPendingSign(true);
  };
  const handleSigned = (tx: any) => {
    setPendingSign(false);
    onComplete({...d, wallet, deployTx:tx, deployedAt:Date.now(), agentId:`forge_${uid()}`});
  };

  const deployTx = {
    type:"AGENT_DEPLOY",
    from:wallet?.address,
    to:ACCUMULATION_VAULT,
    amount_kas:parseFloat(d.capitalLimit) || 5000,
    purpose:"Agent vault provisioning + initial capital"
  };

  return(
    <div style={{maxWidth:1040, margin:"0 auto", padding:"clamp(18px, 2.2vw, 34px)"}}>
      {pendingSign && <SigningModal tx={deployTx} wallet={wallet} onSign={handleSigned} onReject={()=>setPendingSign(false)}/>}
      <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:22}}>
        <span style={{fontSize:10, color:C.dim, letterSpacing:"0.12em", ...mono}}>FORGEOS / NEW AGENT</span>
        <span style={{width:1, height:12, background:C.border, display:"inline-block"}}/>
        <Badge text={wallet?.provider?.toUpperCase() || "CONNECTED"} color={C.ok} dot/>
      </div>
      <Card p={28} style={{maxWidth:680, margin:"0 auto"}}>
        <div style={{display:"flex", gap:5, marginBottom:26}}>
          {[0,1,2].map(i=><div key={i} style={{height:3, flex:1, borderRadius:2, background:i<=step?C.accent:C.muted, transition:"background 0.3s"}}/>)}
        </div>
        {step===0 && <WStep1 d={d} set={set} wallet={wallet}/>}
        {step===1 && <WStep2 d={d} set={set}/>}
        {step===2 && <WStep3 d={d} wallet={wallet} onDeploy={deploy}/>}
        <div style={{display:"flex", justifyContent:"space-between", marginTop:22, paddingTop:16, borderTop:`1px solid ${C.border}`}}>
          <Btn onClick={()=>setStep((s: number)=>s-1)} variant="ghost" disabled={step===0}>BACK</Btn>
          <span style={{fontSize:11, color:C.dim, alignSelf:"center", ...mono}}>STEP {step+1} / 3</span>
          {step<2 && <Btn onClick={()=>setStep((s: number)=>s+1)}>NEXT</Btn>}
          {step===2 && <div/>}
        </div>
      </Card>
    </div>
  );
}
