import { useMemo } from "react";
import {
  BILLING_CONTACT,
  BILLING_UPGRADE_URL,
  FREE_CYCLES_PER_DAY,
  TREASURY,
} from "../../constants";
import { C, mono } from "../../tokens";
import { Badge, Btn, Card, ExtLink, Label } from "../ui";

type BillingPanelProps = {
  usage: {
    day: string;
    used: number;
    limit: number;
    remaining: number;
    locked: boolean;
  };
};

export function BillingPanel({ usage }: BillingPanelProps) {
  const usagePct = useMemo(
    () => Math.min(100, Math.round((usage.used / Math.max(1, usage.limit)) * 100)),
    [usage.limit, usage.used]
  );

  return (
    <div>
      <div style={{fontSize:13, color:C.text, fontWeight:700, ...mono, marginBottom:4}}>Billing & Usage</div>
      <div style={{fontSize:12, color:C.dim, marginBottom:16}}>
        Usage-based monetization: free daily quant cycles with upgrade path after quota is reached.
      </div>

      <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:10, marginBottom:14}}>
        <Card p={14}>
          <Label>Plan</Label>
          <div style={{fontSize:18, color:C.text, fontWeight:700, ...mono}}>FREE</div>
          <div style={{fontSize:11, color:C.dim}}>Up to {FREE_CYCLES_PER_DAY} cycles/day</div>
        </Card>
        <Card p={14}>
          <Label>Cycles Used Today</Label>
          <div style={{fontSize:18, color:C.warn, fontWeight:700, ...mono}}>{usage.used}</div>
          <div style={{fontSize:11, color:C.dim}}>of {usage.limit}</div>
        </Card>
        <Card p={14}>
          <Label>Cycles Remaining</Label>
          <div style={{fontSize:18, color:usage.locked ? C.danger : C.ok, fontWeight:700, ...mono}}>{usage.remaining}</div>
          <div style={{fontSize:11, color:C.dim}}>resets daily (UTC)</div>
        </Card>
      </div>

      <Card p={16} style={{marginBottom:12}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
          <Label>Daily Quota Progress</Label>
          <Badge text={usage.locked ? "LOCKED" : "ACTIVE"} color={usage.locked ? C.danger : C.ok} dot />
        </div>
        <div style={{height:8, borderRadius:999, background:C.s2, border:`1px solid ${C.border}`, overflow:"hidden"}}>
          <div
            style={{
              width:`${usagePct}%`,
              height:"100%",
              background: usage.locked ? C.danger : C.accent,
              transition:"width 180ms ease",
            }}
          />
        </div>
        <div style={{marginTop:8, fontSize:11, color:C.dim, ...mono}}>{usagePct}% of daily free quota consumed</div>
      </Card>

      <Card p={16}>
        <Label>Upgrade / Payments</Label>
        <div style={{fontSize:12, color:C.dim, marginBottom:10}}>
          Set `VITE_BILLING_UPGRADE_URL` for hosted checkout, or accept direct KAS payments at treasury.
        </div>
        <div style={{display:"flex", gap:8, flexWrap:"wrap", marginBottom:10}}>
          {BILLING_UPGRADE_URL ? (
            <ExtLink href={BILLING_UPGRADE_URL} label="OPEN CHECKOUT ↗" />
          ) : (
            <Badge text="NO CHECKOUT URL SET" color={C.warn} />
          )}
          {BILLING_CONTACT && <Badge text={`CONTACT ${BILLING_CONTACT}`} color={C.dim} />}
        </div>
        <div style={{fontSize:11, color:C.accent, ...mono, wordBreak:"break-all", marginBottom:8}}>{TREASURY}</div>
        <Btn onClick={() => navigator.clipboard?.writeText(TREASURY)} variant="ghost" size="sm">
          COPY TREASURY ADDRESS
        </Btn>
      </Card>
    </div>
  );
}

