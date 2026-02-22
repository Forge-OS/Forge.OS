import { AGENT_SPLIT, EXPLORER, FEE_RATE, TREASURY_SPLIT } from "../../constants";
import { fmtT, shortAddr } from "../../helpers";
import { C, mono } from "../../tokens";
import { Badge, Btn, Card, ExtLink } from "../ui";

export function ActionQueue({queue, wallet, onSign, onReject}: any) {
  const receiptColor = (state: string) => {
    if (state === "confirmed") return C.ok;
    if (state === "failed" || state === "timeout") return C.danger;
    if (state === "pending_confirm" || state === "broadcasted") return C.warn;
    return C.dim;
  };
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
        <Card
          key={item.id}
          p={18}
          data-testid={`queue-item-${String(item.id)}`}
          style={{marginBottom:10, border:`1px solid ${item.status==="pending"?C.warn:item.status==="signed"?C.ok:C.border}25`}}
        >
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12}}>
            <div>
              <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:4}}>
                <Badge data-testid={`queue-item-type-${String(item.id)}`} text={item.type} color={C.purple}/>
                <Badge
                  data-testid={`queue-item-status-${String(item.id)}`}
                  text={item.status.toUpperCase()}
                  color={item.status==="pending"?C.warn:item.status==="signed"?C.ok:C.dim}
                  dot
                />
                {item.status==="signed" && (
                  <Badge
                    data-testid={`queue-item-receipt-${String(item.id)}`}
                    text={String(item.receipt_lifecycle || "submitted").toUpperCase().replace(/_/g, " ")}
                    color={receiptColor(String(item.receipt_lifecycle || "submitted"))}
                    dot
                  />
                )}
              </div>
              <div style={{fontSize:11, color:C.dim, ...mono}}>{fmtT(item.ts)}</div>
            </div>
            <div style={{fontSize:18, color:item.amount_kas>0?C.accent:C.danger, fontWeight:700, ...mono}}>{item.amount_kas} KAS</div>
          </div>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:item.status==="pending"?12:0, fontSize:12, color:C.dim, ...mono}}>
            <div>To: <span style={{color:C.text}}>{shortAddr(item.to)}</span></div>
            <div>
              {item.metaKind === "treasury_fee"
                ? <>Routing: <span style={{color:C.warn}}>Treasury payout transfer</span></>
                : item?.treasuryCombined
                  ? <>Routing: <span style={{color:C.ok}}>Combined treasury output ({Array.isArray(item?.outputs) ? item.outputs.length : 2} outputs)</span></>
                  : <>Fee split: <span style={{color:C.text}}>Pool {(FEE_RATE*AGENT_SPLIT).toFixed(4)} / Treasury {(FEE_RATE*TREASURY_SPLIT).toFixed(4)}</span></>}
            </div>
          </div>
          {item.status==="pending" && (
            <div style={{display:"flex", gap:8}}>
              <Btn onClick={()=>onReject(item.id)} variant="danger" size="sm">REJECT</Btn>
              <Btn data-testid={`queue-item-sign-${String(item.id)}`} onClick={()=>onSign(item)} size="sm">SIGN & BROADCAST</Btn>
            </div>
          )}
          {item.status==="signed" && item.txid && (
            <div>
              <div style={{display:"flex", alignItems:"center", gap:10, flexWrap:"wrap"}}>
                <span style={{fontSize:11, color:C.ok, ...mono}}>✓ {item.txid.slice(0,32)}...</span>
                {typeof item.confirmations === "number" && (
                  <span style={{fontSize:11, color:C.dim, ...mono}}>
                    conf: {Math.max(0, Number(item.confirmations || 0))}
                  </span>
                )}
                <ExtLink href={`${EXPLORER}/txs/${item.txid}`} label="EXPLORER ↗"/>
              </div>
              {(item.receipt_lifecycle === "failed" || item.receipt_lifecycle === "timeout") && item.failure_reason && (
                <div style={{fontSize:11, color:C.danger, ...mono, marginTop:6}}>
                  receipt: {String(item.failure_reason)}
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
