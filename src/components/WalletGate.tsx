import { useState } from "react";
import { DEFAULT_NETWORK, NETWORK_LABEL } from "../constants";
import { C, mono } from "../tokens";
import { isKaspaAddress } from "../helpers";
import { WalletAdapter } from "../wallet/WalletAdapter";
import { Badge, Btn, Card, Divider, Inp } from "./ui";

export function WalletGate({onConnect}: any) {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState(null as any);
  const [kaspiumAddress, setKaspiumAddress] = useState("");
  const detected = WalletAdapter.detect();

  const connect = async (provider: string) => {
    setBusy(true); setErr(null);
    try {
      let session;
      if(provider === "kasware") {
        session = await WalletAdapter.connectKasware();
      } else if(provider === "kaspium") {
        session = WalletAdapter.connectKaspium(kaspiumAddress);
      } else {
        // Demo mode — no extension
        session = { address:"kaspa:qp3t6flvhqd4d9jkk8m5v0xelwm6zxx99qx5p8f3j8vcm9y5la2vsnjsklav", network:DEFAULT_NETWORK, provider:"demo" };
      }
      onConnect(session);
    } catch(e: any) { setErr(e.message); }
    setBusy(false);
  };

  const wallets = [
    { k:"kasware", l:"Kasware", desc:"Browser extension wallet", available:detected.kasware, icon:"🦊" },
    { k:"kaspium", l:"Kaspium", desc:"Mobile wallet via deep-link", available:detected.kaspium, icon:"📱" },
    { k:"demo",    l:"Demo Mode", desc:"Simulated wallet — UI preview only", available:true, icon:"🧪" },
  ];

  return (
    <div style={{minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24}}>
      <div style={{marginBottom:32, textAlign:"center"}}>
        <div style={{fontSize:28, fontWeight:700, ...mono, letterSpacing:"0.12em", marginBottom:8}}>
          <span style={{color:C.accent}}>FORGE</span><span style={{color:C.text}}>OS</span>
        </div>
        <div style={{fontSize:12, color:C.dim, letterSpacing:"0.08em", ...mono}}>AI-NATIVE FINANCIAL OPERATING SYSTEM · POWERED BY KASPA</div>
      </div>
      <Card p={32} style={{maxWidth:440, width:"100%"}}>
        <div style={{fontSize:14, color:C.text, fontWeight:700, ...mono, marginBottom:4}}>Connect Wallet</div>
        <div style={{fontSize:12, color:C.dim, marginBottom:22}}>All operations are wallet-native. No custodial infrastructure. No private keys stored server-side.</div>
        <div style={{display:"flex", flexDirection:"column", gap:10}}>
          {wallets.map(w=> (
            <div key={w.k} onClick={()=>w.available && !busy && w.k!=="kaspium" && connect(w.k)}
              style={{padding:"14px 16px", borderRadius:5, border:`1px solid ${w.available?C.border:C.muted}`, background:w.available?C.s2:C.s1, cursor:w.available?"pointer":"not-allowed", opacity:w.available?1:0.45, transition:"all 0.15s", display:"flex", alignItems:"center", gap:14}}
              onMouseEnter={e=>{if(w.available){e.currentTarget.style.borderColor=C.accent; e.currentTarget.style.background=C.aLow;}}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=w.available?C.border:C.muted; e.currentTarget.style.background=w.available?C.s2:C.s1;}}>
              <span style={{fontSize:22}}>{w.icon}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13, color:C.text, fontWeight:700, ...mono, marginBottom:2}}>{w.l}</div>
                <div style={{fontSize:11, color:C.dim}}>{w.desc}</div>
              </div>
              {w.available ? <Badge text={w.k==="kaspium"?"SET ADDRESS":"CONNECT"} color={C.accent}/> : <Badge text="COMING SOON" color={C.muted}/>}
            </div>
          ))}
        </div>

        <div style={{marginTop:12}}>
          <Inp label="Kaspium Address" value={kaspiumAddress} onChange={setKaspiumAddress} placeholder="kaspa:... or kaspatest:..." hint="Required for Kaspium mobile connect flow" />
          <Btn onClick={()=>connect("kaspium")} disabled={busy || !isKaspaAddress(kaspiumAddress)} variant="ghost" style={{width:"100%", padding:"10px 0"}}>
            CONNECT KASPIUM
          </Btn>
        </div>

        {err && <div style={{marginTop:14, padding:"10px 14px", background:C.dLow, borderRadius:4, fontSize:12, color:C.danger, ...mono}}>{err}</div>}
        <Divider m={18}/>
        <div style={{fontSize:11, color:C.dim, ...mono, lineHeight:1.6}}>
          forge.os never requests your private key · All transaction signing happens in your wallet · {NETWORK_LABEL} only
        </div>
      </Card>
    </div>
  );
}
