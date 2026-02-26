// Swap Tab — gated UI.
// Renders in disabled state when SWAP_CONFIG.enabled = false.
// All interactive elements are present but non-functional (clearly labelled).
// No fake quotes, no simulated swaps, no placeholder amounts.

import { useState } from "react";
import { C, mono } from "../../src/tokens";
import { SWAP_CONFIG } from "../swap/types";
import { getSwapGatingStatus } from "../swap/swap";
import { getAllTokens } from "../tokens/registry";
import type { TokenId } from "../tokens/types";

export function SwapTab() {
  const gating = getSwapGatingStatus();
  const tokens = getAllTokens();

  const [tokenIn, setTokenIn] = useState<TokenId>("KAS");
  const [tokenOut, setTokenOut] = useState<TokenId>("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [slippageBps, setSlippageBps] = useState(SWAP_CONFIG.defaultSlippageBps);

  const isDisabled = !gating.enabled;

  const inputStyle = (disabled: boolean): React.CSSProperties => ({
    width: "100%",
    boxSizing: "border-box" as const,
    background: disabled ? "rgba(8,13,20,0.4)" : "rgba(8,13,20,0.7)",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 12px",
    color: disabled ? C.dim : C.text,
    fontSize: 11,
    cursor: disabled ? "not-allowed" : "text",
    ...mono,
    outline: "none",
  });

  const selectStyle = (disabled: boolean): React.CSSProperties => ({
    ...inputStyle(disabled),
    cursor: disabled ? "not-allowed" : "pointer",
    appearance: "none" as const,
  });

  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Disabled overlay banner */}
      {isDisabled && (
        <div style={{
          background: "rgba(143,123,255,0.08)", border: "1px solid rgba(143,123,255,0.3)",
          borderRadius: 10, padding: "12px 14px",
          display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>⏳</span>
          <div>
            <div style={{ fontSize: 9, color: C.purple, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 4 }}>
              SWAP UNAVAILABLE
            </div>
            <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.5 }}>
              {gating.reason ?? "Swap functionality not yet active on Kaspa."}
            </div>
          </div>
        </div>
      )}

      {/* Token In */}
      <div>
        <div style={{ fontSize: 7, color: C.dim, letterSpacing: "0.1em", marginBottom: 6 }}>
          YOU PAY
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={tokenIn}
            onChange={(e) => setTokenIn(e.target.value as TokenId)}
            disabled={isDisabled}
            style={{ ...selectStyle(isDisabled), flex: "0 0 100px" }}
          >
            {tokens.filter((t) => t.enabled).map((t) => (
              <option key={t.id} value={t.id}>{t.symbol}</option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            placeholder={isDisabled ? "—" : "0.00"}
            disabled={isDisabled}
            style={{ ...inputStyle(isDisabled), flex: 1 }}
          />
        </div>
      </div>

      {/* Swap direction arrow */}
      <div style={{ textAlign: "center" }}>
        <button
          disabled={isDisabled}
          onClick={() => { setTokenIn(tokenOut); setTokenOut(tokenIn); }}
          style={{
            background: "rgba(8,13,20,0.5)", border: `1px solid ${C.border}`,
            borderRadius: "50%", width: 28, height: 28,
            color: isDisabled ? C.muted : C.accent, fontSize: 14,
            cursor: isDisabled ? "not-allowed" : "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}
        >⇅</button>
      </div>

      {/* Token Out */}
      <div>
        <div style={{ fontSize: 7, color: C.dim, letterSpacing: "0.1em", marginBottom: 6 }}>
          YOU RECEIVE (ESTIMATED)
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={tokenOut}
            onChange={(e) => setTokenOut(e.target.value as TokenId)}
            disabled={isDisabled}
            style={{ ...selectStyle(isDisabled), flex: "0 0 100px" }}
          >
            {getAllTokens().map((t) => (
              <option key={t.id} value={t.id} disabled={!t.enabled}>
                {t.symbol}{!t.enabled ? " (soon)" : ""}
              </option>
            ))}
          </select>
          <div style={{
            ...inputStyle(true), flex: 1,
            display: "flex", alignItems: "center",
            color: C.muted, fontSize: 11,
          }}>
            —
          </div>
        </div>
      </div>

      {/* Slippage control */}
      <div style={{ background: "rgba(8,13,20,0.5)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 7, color: C.dim, letterSpacing: "0.1em" }}>SLIPPAGE TOLERANCE</div>
          <div style={{ fontSize: 8, color: isDisabled ? C.muted : C.text, fontWeight: 700 }}>
            {(slippageBps / 100).toFixed(1)}%
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[25, 50, 100].map((bps) => (
            <button
              key={bps}
              onClick={() => setSlippageBps(bps)}
              disabled={isDisabled}
              style={{
                flex: 1, padding: "5px 0", borderRadius: 6,
                background: slippageBps === bps && !isDisabled ? `${C.accent}20` : "rgba(33,48,67,0.4)",
                border: `1px solid ${slippageBps === bps && !isDisabled ? C.accent : C.border}`,
                color: slippageBps === bps && !isDisabled ? C.accent : C.dim,
                fontSize: 8, fontWeight: 700, cursor: isDisabled ? "not-allowed" : "pointer",
                ...mono,
              }}
            >{(bps / 100).toFixed(1)}%</button>
          ))}
        </div>
      </div>

      {/* Quote / action area */}
      {!isDisabled ? (
        <button
          style={{
            width: "100%", padding: "11px 0",
            background: `linear-gradient(90deg, ${C.accent}, #7BE9CF)`,
            border: "none", borderRadius: 8,
            color: "#04110E", fontSize: 10, fontWeight: 700,
            cursor: "pointer", letterSpacing: "0.1em", ...mono,
          }}
        >
          GET QUOTE →
        </button>
      ) : (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.08em" }}>
            SWAP COMING SOON
          </div>
        </div>
      )}

      {/* Info footer */}
      <div style={{ background: "rgba(8,13,20,0.4)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px" }}>
        <div style={{ fontSize: 7, color: C.dim, letterSpacing: "0.1em", marginBottom: 5 }}>SWAP NOTES</div>
        {[
          "Output preview required before any signature.",
          `Max slippage cap: ${SWAP_CONFIG.maxSlippageBps / 100}%.`,
          "No silent token redirection — destination enforced.",
          "Swap routes verified against active network only.",
        ].map((note, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: i < 3 ? 3 : 0 }}>
            <span style={{ color: isDisabled ? C.muted : C.ok, fontSize: 8, flexShrink: 0 }}>•</span>
            <span style={{ fontSize: 7, color: C.muted, lineHeight: 1.4 }}>{note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
