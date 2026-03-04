/// <reference path="../../chrome.d.ts" />
import { useState } from "react";
import { C, mono } from "../../../src/tokens";
import { shortAddr } from "../../../src/helpers";
import {
  EXTENSION_CONNECT_APPROVAL_BASE_MIN_HEIGHT,
  EXTENSION_CONNECT_APPROVAL_BASE_WIDTH,
  EXTENSION_POPUP_UI_SCALE,
} from "../layout";
import { popupShellBackground } from "../surfaces";

export interface PendingTxRequest {
  requestId: string;
  tabId: number;
  to: string;
  amountKas: number;
  purpose: string;
  agentId?: string;
  autoApproveKas: number;
  createdAt: number;
}

interface Props {
  request: PendingTxRequest;
  fromAddress: string;
  kasUsdPrice?: number;
  onApprove: () => Promise<void>;
  onReject: () => void;
}

export function SendTxApprovalScreen({ request, fromAddress, kasUsdPrice, onApprove, onReject }: Props) {
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usdValue = kasUsdPrice && kasUsdPrice > 0 ? (request.amountKas * kasUsdPrice).toFixed(2) : null;

  async function handleApprove() {
    setSigning(true);
    setError(null);
    try {
      await onApprove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed");
      setSigning(false);
    }
  }

  return (
    <div
      data-testid="send-tx-approval-screen"
      style={{
        width: "100%",
        maxWidth: EXTENSION_CONNECT_APPROVAL_BASE_WIDTH,
        height: "100%",
        minHeight: EXTENSION_CONNECT_APPROVAL_BASE_MIN_HEIGHT,
        ...popupShellBackground(),
        display: "flex",
        flexDirection: "column",
        ...mono,
        overflow: "hidden",
        zoom: EXTENSION_POPUP_UI_SCALE,
      }}
    >
      {/* Header */}
      <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <img src="../icons/icon48.png" alt="Forge-OS" style={{ width: 22, height: 22, objectFit: "contain", filter: "drop-shadow(0 0 6px rgba(57,221,182,0.5))" }} />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.1em" }}>
          <span style={{ color: C.accent }}>FORGE</span><span style={{ color: C.text }}>-OS</span>
        </span>
        <span style={{ fontSize: 9, color: C.warn, marginLeft: "auto", letterSpacing: "0.1em" }}>AGENT TX REQUEST</span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "14px 16px 12px", gap: 12, overflowY: "auto" }}>

        {/* Amount */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.warn, ...mono, lineHeight: 1.2 }}>
            {request.amountKas.toFixed(4)} <span style={{ fontSize: 14, color: C.dim }}>KAS</span>
          </div>
          {usdValue && (
            <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>${usdValue} USD</div>
          )}
        </div>

        {/* Destination */}
        <div style={{ background: "rgba(11,17,24,0.8)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.12em", marginBottom: 8 }}>TRANSACTION DETAILS</div>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 10 }}>
            <span style={{ color: C.dim }}>FROM</span>
            <span style={{ color: C.text }}>{shortAddr(fromAddress)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 10 }}>
            <span style={{ color: C.dim }}>TO</span>
            <span style={{ color: C.text, wordBreak: "break-all", maxWidth: "60%", textAlign: "right" }}>{shortAddr(request.to)}</span>
          </div>
          {request.agentId && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 10 }}>
              <span style={{ color: C.dim }}>AGENT</span>
              <span style={{ color: C.accent }}>{String(request.agentId).slice(0, 24)}</span>
            </div>
          )}
          <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
          <div style={{ fontSize: 10, color: C.dim }}>
            <span style={{ color: C.text }}>PURPOSE: </span>{request.purpose}
          </div>
        </div>

        {/* Warning */}
        <div style={{ background: `${C.warn}10`, border: `1px solid ${C.warn}30`, borderRadius: 8, padding: "8px 12px", fontSize: 9, color: C.warn, lineHeight: 1.5 }}>
          An agent is requesting to send KAS from your wallet. Verify the amount and destination before approving.
        </div>

        {error && (
          <div style={{ background: `${C.danger}12`, border: `1px solid ${C.danger}30`, borderRadius: 8, padding: "8px 12px", fontSize: 10, color: C.danger }}>
            {error}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
          <button
            data-testid="send-tx-reject"
            onClick={onReject}
            disabled={signing}
            style={{
              flex: 1,
              background: "rgba(33,48,67,0.5)",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "10px 0",
              color: C.dim,
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: "0.08em",
              ...mono,
            }}
          >
            REJECT
          </button>
          <button
            data-testid="send-tx-approve"
            onClick={() => { void handleApprove(); }}
            disabled={signing}
            style={{
              flex: 2,
              background: signing ? C.s2 : `linear-gradient(90deg, ${C.warn}, #F5A623)`,
              border: "none",
              borderRadius: 8,
              padding: "10px 0",
              color: signing ? C.dim : "#04110E",
              fontSize: 11,
              fontWeight: 700,
              cursor: signing ? "not-allowed" : "pointer",
              letterSpacing: "0.08em",
              ...mono,
            }}
          >
            {signing ? "SIGNING..." : "APPROVE & SEND"}
          </button>
        </div>
      </div>
    </div>
  );
}
