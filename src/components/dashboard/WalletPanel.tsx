import { useCallback, useEffect, useState } from "react";
import { DEFAULT_NETWORK, EXPLORER, KAS_API, NET_FEE, NETWORK_LABEL, RESERVE } from "../../constants";
import { fmt, isKaspaAddress } from "../../helpers";
import { kasBalance, kasUtxos } from "../../api/kaspaApi";
import { C, mono } from "../../tokens";
import { WalletAdapter } from "../../wallet/WalletAdapter";
import { SigningModal } from "../SigningModal";
import { Badge, Btn, Card, ExtLink, Inp, Label } from "../ui";

export function WalletPanel({agent, wallet}: any) {
  const [liveKas, setLiveKas] = useState(null as any);
  const [utxos, setUtxos] = useState([] as any[]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null as any);
  const [fetched, setFetched] = useState(null as any);
  const [signingTx, setSigningTx] = useState(null as any);
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [note, setNote] = useState("");

  const refresh = useCallback(async()=>{
    setLoading(true); setErr(null);
    try{
      let b;
      if(wallet?.provider==="kasware"){b = await WalletAdapter.getKaswareBalance();}
      else{const r = await kasBalance(wallet?.address||agent.wallet); b = r.kas;}
      const u = await kasUtxos(wallet?.address||agent.wallet);
      setLiveKas(b);
      setUtxos(Array.isArray(u)?u.slice(0,10):[]);
      setFetched(new Date());
    }catch(e: any){setErr(e.message);}
    setLoading(false);
  },[wallet,agent]);

  useEffect(()=>{refresh();},[]);

  const bal = parseFloat(liveKas ?? agent.capitalLimit ?? 0);
  const maxSend = Math.max(0, bal-RESERVE-NET_FEE).toFixed(4);

  const initiateWithdraw = () => {
    if(!isKaspaAddress(withdrawTo) || parseFloat(withdrawAmt)<=0) return;
    setSigningTx({type:"WITHDRAW", from:wallet?.address, to:withdrawTo, amount_kas:parseFloat(withdrawAmt), purpose:note || "Withdrawal"});
  };
  const handleSigned = () => {setSigningTx(null); setWithdrawTo(""); setWithdrawAmt(""); setNote("");};

  return(
    <div>
      {signingTx && <SigningModal tx={signingTx} wallet={wallet} onSign={handleSigned} onReject={()=>setSigningTx(null)}/>}
      <Card p={20} style={{marginBottom:12}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14}}>
          <div style={{flex:1, minWidth:0}}>
            <Label>Connected Wallet — {NETWORK_LABEL}</Label>
            <div style={{fontSize:12, color:C.accent, ...mono, wordBreak:"break-all", marginBottom:10}}>{wallet?.address || "—"}</div>
            <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
              <Btn onClick={()=>navigator.clipboard?.writeText(wallet?.address || "")} variant="ghost" size="sm">COPY</Btn>
              <ExtLink href={`${EXPLORER}/addresses/${wallet?.address}`} label="EXPLORER ↗"/>
            </div>
          </div>
          <div style={{display:"flex", gap:6, alignItems:"center", flexShrink:0, marginLeft:14}}>
            <Badge text={wallet?.provider==="demo"?"DEMO":wallet?.provider?.toUpperCase()||"—"} color={wallet?.provider==="kasware"?C.ok:C.warn} dot/>
            <Btn onClick={refresh} disabled={loading} size="sm" variant="ghost">{loading?"...":"REFRESH"}</Btn>
          </div>
        </div>
        {err && <div style={{background:C.dLow, border:`1px solid ${C.danger}30`, borderRadius:4, padding:"8px 12px", marginBottom:12, fontSize:12, color:C.danger, ...mono}}>RPC: {err}</div>}
        <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12}}>
          {[["Balance", `${liveKas ?? agent.capitalLimit} KAS`, liveKas?C.accent:C.warn], ["UTXOs", liveKas?String(utxos.length):"—", C.text], ["Network", wallet?.network||DEFAULT_NETWORK, C.dim]].map(([l,v,c])=> (
            <div key={l as any}><Label>{l}</Label><div style={{fontSize:18, color:c as any, fontWeight:700, ...mono}}>{v}</div></div>
          ))}
        </div>
        {fetched && <div style={{fontSize:11, color:C.dim, marginTop:8, ...mono}}>Fetched {fetched.toLocaleTimeString()} via {KAS_API}</div>}
      </Card>

      {/* Withdraw */}
      <Card p={20} style={{marginBottom:12}}>
        <Label>Withdraw KAS</Label>
        <div style={{background:C.s2, borderRadius:4, padding:"9px 13px", marginBottom:12, display:"flex", justifyContent:"space-between"}}>
          <span style={{fontSize:11, color:C.dim, ...mono}}>Available (after {RESERVE} KAS reserve)</span>
          <span style={{fontSize:14, color:C.accent, fontWeight:700, ...mono}}>{maxSend} KAS</span>
        </div>
        <Inp label="Recipient Address" value={withdrawTo} onChange={setWithdrawTo} placeholder="kaspa:... or kaspatest:..."/>
        <div style={{display:"grid", gridTemplateColumns:"1fr auto", gap:8, alignItems:"flex-end", marginBottom:12}}>
          <Inp label={`Amount (max ${maxSend} KAS)`} value={withdrawAmt} onChange={setWithdrawAmt} type="number" suffix="KAS" placeholder="0.0000"/>
          <Btn onClick={()=>setWithdrawAmt(maxSend)} variant="ghost" size="sm" style={{marginBottom:1}}>MAX</Btn>
        </div>
        <Inp label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. Profit extraction"/>
        <Btn onClick={initiateWithdraw} disabled={!isKaspaAddress(withdrawTo) || parseFloat(withdrawAmt)<=0} style={{width:"100%", padding:"10px 0"}}>
          INITIATE WITHDRAWAL — SIGN WITH {wallet?.provider?.toUpperCase()||"WALLET"}
        </Btn>
      </Card>

      {/* Deposit */}
      <Card p={20} style={{marginBottom:12}}>
        <Label>Deposit KAS</Label>
        <div style={{fontSize:12, color:C.dim, marginBottom:12}}>Send KAS directly to your connected wallet address. Funds are available after DAG confirmation (~1–2s).</div>
        <div style={{background:C.s2, borderRadius:4, padding:14, border:`1px solid ${C.accent}25`}}>
          <div style={{fontSize:12, color:C.accent, ...mono, wordBreak:"break-all", marginBottom:10}}>{wallet?.address || "—"}</div>
          <ExtLink href={`${EXPLORER}/addresses/${wallet?.address}`} label="VIEW ON KASPA EXPLORER ↗"/>
        </div>
      </Card>

      {/* UTXOs */}
      {utxos.length>0 && (
        <Card p={0}>
          <div style={{padding:"11px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between"}}>
            <span style={{fontSize:11, color:C.dim, ...mono}}>UTXO SET — {utxos.length} outputs</span>
          </div>
          {utxos.map((u: any, i: number)=>{
            const kas = fmt((u.utxoEntry?.amount||0)/1e8,4);
            const daa = u.utxoEntry?.blockDaaScore;
            const txid = u.outpoint?.transactionId;
            return(
              <div key={i} style={{display:"grid", gridTemplateColumns:"1fr 100px 120px 60px", gap:8, padding:"8px 16px", borderBottom:`1px solid ${C.border}`, alignItems:"center"}}>
                <span style={{fontSize:11, color:C.dim, ...mono, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{txid?.slice(0,34)}...</span>
                <span style={{fontSize:12, color:C.ok, fontWeight:700, ...mono, textAlign:"right"}}>{kas} KAS</span>
                <span style={{fontSize:11, color:C.dim, ...mono, textAlign:"right"}}>DAA {daa}</span>
                <div style={{textAlign:"right"}}><ExtLink href={`${EXPLORER}/txs/${txid}`} label="↗"/></div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
