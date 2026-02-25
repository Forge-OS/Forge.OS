import { useEffect, useState } from "react";
import { C, mono } from "../../src/tokens";
import { fmt } from "../../src/helpers";
import { getAgents } from "../shared/storage";

export function AgentsTab() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAgents().then(a => { setAgents(a); setLoading(false); });
  }, []);

  if (loading) {
    return <div style={{ padding: "20px 14px", fontSize: 9, color: C.dim, textAlign: "center" }}>Loading agents…</div>;
  }

  if (agents.length === 0) {
    return (
      <div style={{ padding: "20px 14px", textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 10, color: C.dim }}>No agents deployed yet.</div>
        <button
          onClick={() => chrome.tabs.create({ url: "https://forgeos.xyz" })}
          style={{
            background: `linear-gradient(145deg, ${C.accent}18, rgba(8,13,20,0.6))`,
            border: `1px solid ${C.accent}35`, borderRadius: 8, padding: "8px 16px",
            color: C.accent, fontSize: 9, fontWeight: 700, cursor: "pointer", ...mono,
            letterSpacing: "0.08em",
          }}
        >CREATE AGENT ON FORGE-OS ↗</button>
      </div>
    );
  }

  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.12em", marginBottom: 2 }}>
        {agents.length} AGENT{agents.length !== 1 ? "S" : ""} · SYNCED FROM SITE
      </div>
      {agents.map((agent: any, i: number) => {
        const pnl = parseFloat(agent?.pnlUsd || agent?.pnl || 0);
        const pnlPositive = pnl >= 0;
        const execMode = String(agent?.execMode || "manual").toUpperCase();
        const isActive = agent?.status === "active" || agent?.execMode === "auto";

        return (
          <div key={agent?.agentId || i} style={{
            background: `linear-gradient(145deg, rgba(16,25,35,0.7), rgba(8,13,20,0.5))`,
            border: `1px solid ${isActive ? `${C.accent}40` : C.border}`,
            borderRadius: 10, padding: "10px 12px",
          }}>
            {/* Agent header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: isActive ? C.ok : C.warn, flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: C.text }}>{agent?.name || "Agent"}</span>
              </div>
              <span style={{
                fontSize: 7, color: isActive ? C.ok : C.warn, fontWeight: 700, ...mono,
                background: isActive ? `${C.ok}15` : `${C.warn}15`,
                border: `1px solid ${isActive ? C.ok : C.warn}30`,
                borderRadius: 3, padding: "2px 5px",
              }}>{execMode}</span>
            </div>

            {/* Strategy + P&L */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div>
                <div style={{ fontSize: 7, color: C.dim, marginBottom: 1 }}>STRATEGY</div>
                <div style={{ fontSize: 8, color: C.text }}>{agent?.strategyLabel || agent?.strategy || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 7, color: C.dim, marginBottom: 1 }}>P&L (USD)</div>
                <div style={{ fontSize: 8, color: pnlPositive ? C.ok : C.danger, fontWeight: 700 }}>
                  {pnlPositive ? "+" : ""}${fmt(Math.abs(pnl), 2)}
                </div>
              </div>
              {agent?.capitalLimit && (
                <div>
                  <div style={{ fontSize: 7, color: C.dim, marginBottom: 1 }}>CAPITAL</div>
                  <div style={{ fontSize: 8, color: C.text }}>{agent.capitalLimit} KAS</div>
                </div>
              )}
              {agent?.risk && (
                <div>
                  <div style={{ fontSize: 7, color: C.dim, marginBottom: 1 }}>RISK</div>
                  <div style={{ fontSize: 8, color: C.text }}>{agent.risk}</div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <button
        onClick={() => chrome.tabs.create({ url: "https://forgeos.xyz" })}
        style={{
          background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px",
          color: C.dim, fontSize: 8, cursor: "pointer", ...mono, letterSpacing: "0.08em",
          marginTop: 2,
        }}
      >MANAGE ON FORGE-OS ↗</button>
    </div>
  );
}
