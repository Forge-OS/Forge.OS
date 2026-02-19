import { useState } from "react";
import { NET_FEE } from "../constants";
import { shortAddr } from "../helpers";
import { C, mono } from "../tokens";
import { WalletAdapter } from "../wallet/WalletAdapter";
import { Btn, Card } from "./ui";

export function SigningModal({tx, wallet, onSign, onReject}: any) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null as any);

  const sign = async () => {
    setBusy(true); setErr(null);
    try {
      let txid;
      if(wallet?.provider === "kasware") {
        txid = await WalletAdapter.sendKasware(tx.to, tx.amount_kas);
      } else if(wallet?.provider === "kaspium") {
        txid = await WalletAdapter.sendKaspium(tx.to, tx.amount_kas, tx.purpose);
      } else {
        // Simulate for demo/non-extension environments
        await new Promise(r=>setTimeout(r,1200));
        txid = Array.from({length:64},()=>"0123456789abcdef"[Math.floor(Math.random()*16)]).join("");
      }
      onSign({ ...tx, txid, signed_at: Date.now() });
    } catch(e: any) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20}}>
      <Card p={28} style={{maxWidth:480, width:"100%", border:`1px solid ${C.warn}40`}}>
        <div style={{fontSize:14, color:C.warn, fontWeight:700, ...mono, marginBottom:4}}>⚠ TRANSACTION SIGNING REQUIRED</div>
        <div style={{fontSize:12, color:C.dim, marginBottom:18}}>
          {wallet?.provider==="kasware" ? "Kasware will prompt you to sign." : wallet?.provider==="kaspium" ? "Kaspium deep-link will open; paste txid after broadcast." : "Confirm this transaction to proceed."}
        </div>
        <Card p={0} style={{marginBottom:16}}>
          {[
            ["Type",      tx.type],
            ["From",      shortAddr(tx.from)],
            ["To",        shortAddr(tx.to)],
            ["Amount",    `${tx.amount_kas} KAS`],
            ["Fee",       `${NET_FEE} KAS`],
            ["Purpose",   tx.purpose],
          ].map(([k,v],i,a)=>(
            <div key={k as any} style={{display:"flex", justifyContent:"space-between", padding:"9px 14px", borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
              <span style={{fontSize:12, color:C.dim, ...mono}}>{k}</span>
              <span style={{fontSize:12, color:C.text, ...mono}}>{v}</span>
            </div>
          ))}
        </Card>
        {err && <div style={{fontSize:12, color:C.danger, ...mono, marginBottom:12, padding:"8px 12px", background:C.dLow, borderRadius:4}}>Error: {err}</div>}
        <div style={{display:"flex", gap:10}}>
          <Btn onClick={onReject} variant="ghost" style={{flex:1, padding:"10px 0"}}>REJECT</Btn>
          <Btn onClick={sign} disabled={busy} style={{flex:2, padding:"10px 0"}}>{busy?"SIGNING...":"SIGN & BROADCAST"}</Btn>
        </div>
        <div style={{fontSize:11, color:C.dim, marginTop:10, textAlign:"center", ...mono}}>
          Signing occurs client-side · Private key never leaves your wallet
        </div>
      </Card>
    </div>
  );
}
