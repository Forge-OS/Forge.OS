import { useState } from "react";
import { C, mono } from "../../src/tokens";
import { fmt, isKaspaAddress } from "../../src/helpers";
import type { ManagedWallet } from "../shared/storage";

interface Props {
  wallet: ManagedWallet | null;
  balance: number | null;
  usdPrice: number;
  network: string;
}

type Action = "none" | "send" | "receive";

const EXPLORER = "https://explorer.kaspa.org";

export function WalletTab({ wallet, balance, usdPrice, network }: Props) {
  const [action, setAction] = useState<Action>("none");
  const [sendTo, setSendTo] = useState("");
  const [sendAmt, setSendAmt] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [sendDone, setSendDone] = useState("");
  const [addrCopied, setAddrCopied] = useState(false);

  const canSend = wallet?.phrase && isKaspaAddress(sendTo) && parseFloat(sendAmt) > 0;

  const handleSend = async () => {
    if (!wallet?.phrase || !canSend) return;
    setSendBusy(true); setSendErr(""); setSendDone("");
    try {
      // For managed wallets we'd sign with kaspa-wasm here.
      // For now, open the site with intent so user can confirm.
      const url = `https://forgeos.xyz?send=1&to=${encodeURIComponent(sendTo)}&amount=${encodeURIComponent(sendAmt)}`;
      chrome.tabs.create({ url });
      setSendDone("Opened Forge-OS to complete the transaction.");
    } catch (e: any) {
      setSendErr(e?.message || "Send failed.");
    }
    setSendBusy(false);
  };

  const copyAddress = async () => {
    if (!wallet?.address) return;
    try { await navigator.clipboard.writeText(wallet.address); setAddrCopied(true); setTimeout(() => setAddrCopied(false), 2000); } catch {}
  };

  const explorerUrl = wallet?.address ? `${EXPLORER}/addresses/${wallet.address}` : EXPLORER;

  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Stablecoin balance card */}
      <div style={{ background: `linear-gradient(145deg, rgba(39,117,202,0.08), rgba(8,13,20,0.6))`, border: `1px solid rgba(39,117,202,0.2)`, borderRadius: 10, padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.12em" }}>STABLECOIN BALANCE</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "rgba(255,176,7,0.1)", border: "1px solid rgba(255,176,7,0.4)", borderRadius: 4, padding: "2px 6px" }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#FFB007", display: "inline-block" }} />
            <span style={{ fontSize: 6, color: "#FFB007", fontWeight: 700, letterSpacing: "0.1em" }}>DEMO</span>
          </div>
        </div>

        {/* USDC row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <img src="../icons/usdc.png" alt="USDC" width={22} height={22} style={{ flexShrink: 0, borderRadius: "50%", boxShadow: "0 0 6px rgba(39,117,202,0.4)", filter: "brightness(0) invert(1)" }} />
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.text }}>USDC</div>
              <div style={{ fontSize: 7, color: C.dim }}>USD Coin</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>0.00</div>
            <div style={{ fontSize: 7, color: C.dim }}>≈ $0.00</div>
          </div>
        </div>

        {/* USDT row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <img src="../icons/usdt-logo.svg" alt="USDT" style={{ width: 22, height: 22, flexShrink: 0, boxShadow: "0 0 6px rgba(38,161,123,0.4)", borderRadius: "50%" }} />
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.text }}>USDT</div>
              <div style={{ fontSize: 7, color: C.dim }}>Tether USD</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>0.00</div>
            <div style={{ fontSize: 7, color: C.dim }}>≈ $0.00</div>
          </div>
        </div>

        {/* Explorer link */}
        {wallet?.address && (
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${C.border}`, textAlign: "right" }}>
            <button
              onClick={() => chrome.tabs.create({ url: explorerUrl })}
              style={{ background: "none", border: "none", color: C.dim, fontSize: 7, cursor: "pointer", ...mono, padding: 0, letterSpacing: "0.06em" }}
            >Explorer ↗</button>
          </div>
        )}
      </div>

      {/* Action selector */}
      <div style={{ display: "flex", gap: 6 }}>
        {(["send", "receive"] as Action[]).map(a => (
          <button
            key={a}
            onClick={() => setAction(action === a ? "none" : a)}
            style={{
              flex: 1, background: action === a ? `${C.accent}18` : "rgba(16,25,35,0.5)",
              border: `1px solid ${action === a ? C.accent : C.border}`,
              borderRadius: 8, padding: "7px 0",
              color: action === a ? C.accent : C.dim,
              fontSize: 9, fontWeight: 700, cursor: "pointer", ...mono,
              letterSpacing: "0.1em", textTransform: "uppercase",
              transition: "all 0.15s",
            }}
          >{a}</button>
        ))}
        <button
          onClick={() => chrome.tabs.create({ url: "https://forgeos.xyz" })}
          style={{
            flex: 1, background: "rgba(16,25,35,0.5)", border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "7px 0", color: C.dim,
            fontSize: 9, fontWeight: 700, cursor: "pointer", ...mono, letterSpacing: "0.1em",
          }}
        >SWAP ↗</button>
      </div>

      {/* Send panel */}
      {action === "send" && (
        <div style={{ background: "rgba(8,13,20,0.7)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 9, color: C.text, fontWeight: 700, letterSpacing: "0.08em" }}>SEND KAS</div>
          <input
            value={sendTo}
            onChange={e => setSendTo(e.target.value)}
            placeholder="Recipient kaspa:qp..."
            style={{ background: "rgba(8,13,20,0.8)", border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 10px", color: C.text, fontSize: 9, ...mono, outline: "none", width: "100%" }}
          />
          <input
            value={sendAmt}
            onChange={e => setSendAmt(e.target.value)}
            placeholder="Amount (KAS)"
            type="number"
            min="0"
            style={{ background: "rgba(8,13,20,0.8)", border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 10px", color: C.text, fontSize: 9, ...mono, outline: "none", width: "100%" }}
          />
          {sendErr && <div style={{ fontSize: 8, color: C.danger }}>{sendErr}</div>}
          {sendDone && <div style={{ fontSize: 8, color: C.ok }}>{sendDone}</div>}
          <button
            onClick={handleSend}
            disabled={!canSend || sendBusy}
            style={{
              background: canSend && !sendBusy ? `linear-gradient(90deg, ${C.accent}, #7BE9CF)` : "rgba(33,48,67,0.5)",
              color: canSend ? "#04110E" : C.dim,
              border: "none", borderRadius: 8, padding: "8px",
              fontSize: 9, fontWeight: 700, cursor: canSend ? "pointer" : "not-allowed",
              ...mono, letterSpacing: "0.08em",
            }}
          >{sendBusy ? "PROCESSING…" : "CONFIRM SEND →"}</button>
        </div>
      )}

      {/* Receive panel */}
      {action === "receive" && wallet?.address && (
        <div style={{ background: "rgba(8,13,20,0.7)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 9, color: C.text, fontWeight: 700, letterSpacing: "0.08em" }}>RECEIVE KAS</div>
          <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.6, wordBreak: "break-all", background: "rgba(5,7,10,0.5)", borderRadius: 6, padding: "8px 10px" }}>
            {wallet.address}
          </div>
          <button
            onClick={copyAddress}
            style={{
              background: addrCopied ? `${C.ok}20` : "rgba(33,48,67,0.5)",
              border: `1px solid ${addrCopied ? C.ok : C.border}`,
              borderRadius: 6, padding: "6px", color: addrCopied ? C.ok : C.dim,
              fontSize: 9, cursor: "pointer", ...mono, letterSpacing: "0.08em", fontWeight: 700,
            }}
          >{addrCopied ? "✓ COPIED" : "COPY ADDRESS"}</button>
          <div style={{ fontSize: 7, color: C.dim, lineHeight: 1.5 }}>
            Send KAS to this address from any Kaspa wallet. Transactions confirm at BlockDAG speed.
          </div>
        </div>
      )}
    </div>
  );
}
