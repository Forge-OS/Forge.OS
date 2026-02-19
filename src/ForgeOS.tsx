import { useState } from "react";
import { DEFAULT_NETWORK, NETWORK_LABEL } from "./constants";
import { shortAddr } from "./helpers";
import { C, mono } from "./tokens";
import { WalletGate } from "./components/WalletGate";
import { Wizard } from "./components/wizard/Wizard";
import { Dashboard } from "./components/dashboard/Dashboard";
import { Btn } from "./components/ui";

export default function ForgeOS() {
  const [wallet, setWallet] = useState(null as any);
  const [view, setView] = useState("create");
  const [agent, setAgent] = useState(null as any);

  const handleConnect = (session: any) => { setWallet(session); };
  const handleDeploy = (a: any) => { setAgent(a); setView("dashboard"); };
  const isMainnet = DEFAULT_NETWORK === "mainnet";

  const toggleNetwork = () => {
    const target = isMainnet ? "testnet-10" : "mainnet";
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("forgeos.network", target);
      const next = new URL(window.location.href);
      next.searchParams.set("network", target === "mainnet" ? "mainnet" : "testnet");
      window.location.assign(next.toString());
    } catch {
      // Ignore storage/nav edge cases in embedded browsers.
    }
  };

  if(!wallet) return <WalletGate onConnect={handleConnect}/>;

  return(
    <div style={{background:C.bg, minHeight:"100vh", color:C.text}}>
      {/* Topbar */}
      <div style={{borderBottom:`1px solid ${C.border}`, padding:"10px 22px", display:"flex", alignItems:"center", justifyContent:"space-between"}}>
        <div style={{display:"flex", alignItems:"center", gap:14}}>
          <div style={{fontSize:14, fontWeight:700, letterSpacing:"0.14em", ...mono}}><span style={{color:C.accent}}>FORGE</span><span style={{color:C.text}}>OS</span></div>
          <div style={{width:1, height:14, background:C.border}}/>
          <div style={{fontSize:10, color:C.dim, letterSpacing:"0.08em", ...mono}}>AI-NATIVE FINANCIAL OS · KASPA</div>
        </div>
        <div style={{display:"flex", gap:6, alignItems:"center"}}>
          <button
            onClick={toggleNetwork}
            style={{
              background: "none",
              border: `1px solid ${isMainnet ? C.warn : C.ok}`,
              color: isMainnet ? C.warn : C.ok,
              padding: "5px 10px",
              borderRadius: 4,
              fontSize: 10,
              cursor: "pointer",
              letterSpacing: "0.06em",
              ...mono,
            }}
            title="Toggle active Kaspa network profile"
          >
            {NETWORK_LABEL.toUpperCase()}
          </button>
          {!agent && <button onClick={()=>setView("create")} style={{background:view==="create"?C.s2:"none", border:`1px solid ${view==="create"?C.border:"transparent"}`, color:view==="create"?C.text:C.dim, padding:"5px 14px", borderRadius:4, fontSize:11, cursor:"pointer", ...mono}}>NEW AGENT</button>}
          {agent && <button onClick={()=>setView("dashboard")} style={{background:view==="dashboard"?C.s2:"none", border:`1px solid ${view==="dashboard"?C.accent:"transparent"}`, color:view==="dashboard"?C.accent:C.dim, padding:"5px 14px", borderRadius:4, fontSize:11, cursor:"pointer", ...mono}}>{agent.name}</button>}
          <div style={{display:"flex", alignItems:"center", gap:6, padding:"5px 12px", border:`1px solid ${C.border}`, borderRadius:4}}>
            <div style={{width:6, height:6, borderRadius:"50%", background:wallet?.provider==="demo"?C.warn:C.ok}}/>
            <span style={{fontSize:10, color:C.dim, letterSpacing:"0.08em", ...mono}}>{shortAddr(wallet?.address)}</span>
          </div>
          <Btn onClick={()=>{setWallet(null); setAgent(null); setView("create");}} variant="ghost" size="sm">DISCONNECT</Btn>
        </div>
      </div>
      {view==="create" ? <Wizard wallet={wallet} onComplete={handleDeploy}/> : <Dashboard agent={agent} wallet={wallet}/>}
    </div>
  );
}
