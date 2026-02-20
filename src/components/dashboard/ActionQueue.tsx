import { AGENT_SPLIT, EXPLORER, FEE_RATE, TREASURY_SPLIT } from "../../constants";
import { fmtT, shortAddr } from "../../helpers";
import { C, mono } from "../../tokens";
import { Badge, Btn, Card, ExtLink } from "../ui";

export function ActionQueue({queue, wallet, onSign, onReject}: any) {
  return(
    <div>
      <div style={{fontSize:13, color:C.text, fontWeight:700, ...mono, marginBottom:4}}>Action Queue</div>
      <div style={{fontSize:12, color:C.dim, marginBottom:16}}>Transactions pending wallet signature. Auto-approved items processed immediately.</div>
      {queue.length===0 && (
        <Card p={32} style={{textAlign:"center"}}>
          <div style={{fontSize:13, color:C.dim, ...mono, marginBottom:4}}>Queue empty</div>
          <div style={{fontSize:12, color:C.dim}}>Pending transactions will appear here awaiting your wallet signature.</div>
        </Card>
      )}
      {queue.map((item: any)=> (
        <Card key={item.id} p={18} style={{marginBottom:10, border:`1px solid ${item.status==="pending"?C.warn:item.status==="signed"?C.ok:C.border}25`}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12}}>
            <div>
              <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:4}}>
                <Badge text={item.type} color={C.purple}/>
                <Badge text={item.status.toUpperCase()} color={item.status==="pending"?C.warn:item.status==="signed"?C.ok:C.dim} dot/>
              </div>
              <div style={{fontSize:11, color:C.dim, ...mono}}>{fmtT(item.ts)}</div>
            </div>
            <div style={{fontSize:18, color:item.amount_kas>0?C.accent:C.danger, fontWeight:700, ...mono}}>{item.amount_kas} KAS</div>
          </div>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:item.status==="pending"?12:0, fontSize:12, color:C.dim, ...mono}}>
            <div>To: <span style={{color:C.text}}>{shortAddr(item.to)}</span></div>
            <div>Fee split: <span style={{color:C.text}}>Pool {(FEE_RATE*AGENT_SPLIT).toFixed(4)} / Treasury {(FEE_RATE*TREASURY_SPLIT).toFixed(4)}</span></div>
          </div>
          {item.status==="pending" && (
            <div style={{display:"flex", gap:8}}>
              <Btn onClick={()=>onReject(item.id)} variant="danger" size="sm">REJECT</Btn>
              <Btn onClick={()=>onSign(item)} size="sm">SIGN & BROADCAST</Btn>
            </div>
          )}
          {item.status==="signed" && item.txid && (
            <div style={{display:"flex", alignItems:"center", gap:10}}>
              <span style={{fontSize:11, color:C.ok, ...mono}}>✓ {item.txid.slice(0,32)}...</span>
              <ExtLink href={`${EXPLORER}/txs/${item.txid}`} label="EXPLORER ↗"/>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
