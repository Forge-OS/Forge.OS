import { useEffect, useMemo, useState } from "react";
import { DEFAULT_NETWORK, NETWORK_LABEL, NETWORK_PROFILE } from "./constants";
import { shortAddr } from "./helpers";
import { C, mono } from "./tokens";
import { WalletGate } from "./components/WalletGate";
import { Wizard } from "./components/wizard/Wizard";
import { Dashboard } from "./components/dashboard/Dashboard";
import { Btn } from "./components/ui";
import { KASPA_NETWORK_PROFILES } from "./kaspa/network";
import { ForgeAtmosphere } from "./components/chrome/ForgeAtmosphere";

export default function ForgeOS() {
  const [wallet, setWallet] = useState(null as any);
  const [view, setView] = useState("create");
  const [agent, setAgent] = useState(null as any);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1280
  );

  const handleConnect = (session: any) => { setWallet(session); };
  const handleDeploy = (a: any) => { setAgent(a); setView("dashboard"); };
  const isMainnet = DEFAULT_NETWORK === "mainnet";
  const networkOptions = useMemo(
    () => KASPA_NETWORK_PROFILES.filter((profile) => profile.id === "mainnet" || profile.id.startsWith("testnet")),
    []
  );
  const isMobile = viewportWidth < 860;

  const switchNetwork = (targetNetwork: string) => {
    if (typeof window === "undefined" || switchingNetwork || targetNetwork === DEFAULT_NETWORK) return;
    const hasSessionState = !!wallet || !!agent;
    if (hasSessionState) {
      const confirmed = window.confirm(
        "Switching networks will reset the current wallet session and agent state. Continue?"
      );
      if (!confirmed) return;
    }

    setSwitchingNetwork(true);
    try {
      window.localStorage.setItem("forgeos.network", targetNetwork);
      const next = new URL(window.location.href);
      next.searchParams.set("network", targetNetwork);
      window.location.assign(next.toString());
    } catch {
      setSwitchingNetwork(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if(!wallet) return <WalletGate onConnect={handleConnect}/>;

  return(
    <div className="forge-shell" style={{color:C.text}}>
      <ForgeAtmosphere />
      <div className="forge-content" style={{minHeight:"100vh"}}>
      {/* Topbar */}
      <div className="forge-topbar" style={{borderBottom:`1px solid ${C.border}`, padding:"12px clamp(14px, 2vw, 24px)", display:"flex", flexDirection:isMobile ? "column" : "row", alignItems:isMobile ? "stretch" : "center", justifyContent:"space-between", gap:isMobile ? 10 : 0}}>
        <div style={{display:"flex", alignItems:"center", gap:14, justifyContent:isMobile ? "space-between" : "flex-start"}}>
          <div style={{fontSize:14, fontWeight:700, letterSpacing:"0.14em", ...mono}}><span style={{color:C.accent}}>FORGE</span><span style={{color:C.text}}>OS</span></div>
          <div style={{width:1, height:14, background:C.border}}/>
          <div style={{fontSize:10, color:C.dim, letterSpacing:"0.08em", ...mono}}>AI-NATIVE FINANCIAL OS · KASPA</div>
        </div>
        <div style={{display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", justifyContent:isMobile ? "flex-start" : "flex-end"}}>
          <div style={{display:"flex", alignItems:"center", gap:6, border:`1px solid ${isMainnet ? C.warn : C.ok}50`, background:isMainnet?C.wLow:C.oLow, borderRadius:6, padding:"4px 6px"}}>
            <span style={{fontSize:10, color:isMainnet?C.warn:C.ok, letterSpacing:"0.08em", ...mono}}>
              {NETWORK_LABEL.toUpperCase()}
            </span>
            <select
              value={NETWORK_PROFILE.id}
              onChange={(event) => switchNetwork(event.target.value)}
              disabled={switchingNetwork}
              style={{
                background: "transparent",
                color: C.text,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: 10,
                letterSpacing: "0.05em",
                ...mono,
              }}
              title="Switch runtime Kaspa network profile"
            >
              {networkOptions.map((profile) => (
                <option key={profile.id} value={profile.id} style={{ background: C.s1, color: C.text }}>
                  {profile.label}
                </option>
              ))}
            </select>
          </div>
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
    </div>
  );
}
