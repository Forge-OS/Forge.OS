import { shortAddr } from "../helpers";
import { C, mono } from "../tokens";
import { Btn } from "./ui";

type NetworkOption = {
  id: string;
  label: string;
};

interface Props {
  networkLabel: string;
  networkProfileId: string;
  networkOptions: NetworkOption[];
  isMainnet: boolean;
  isCompactMobile: boolean;
  switchingNetwork: boolean;
  view: string;
  activeAgent: any;
  agents: any[];
  wallet: any;
  onSwitchNetwork: (targetNetwork: string) => void;
  onOpenCreate: () => void;
  onSelectAgent: (agentId: string) => void;
  onDisconnect: () => void;
}

export function AuthenticatedMobileTopbar({
  networkLabel,
  networkProfileId,
  networkOptions,
  isMainnet,
  isCompactMobile,
  switchingNetwork,
  view,
  activeAgent,
  agents,
  wallet,
  onSwitchNetwork,
  onOpenCreate,
  onSelectAgent,
  onDisconnect,
}: Props) {
  return (
    <div
      className="forge-topbar"
      style={{
        borderBottom: `1px solid ${C.border}`,
        padding: isCompactMobile ? "8px 10px" : "10px clamp(12px, 2vw, 20px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <img
            src="/forge-os-icon3.png"
            alt="Forge-OS"
            style={{
              width: 22,
              height: 22,
              objectFit: "contain",
              filter: "drop-shadow(0 0 8px rgba(57,221,182,0.5))",
            }}
          />
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", ...mono }}>
            <span style={{ color: C.accent }}>FORGE</span>
            <span style={{ color: C.text }}>-OS</span>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "flex-start",
          maxWidth: "100%",
          overflowX: "auto",
          paddingBottom: 2,
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            border: `1px solid ${isMainnet ? C.warn : C.ok}50`,
            background: isMainnet ? C.wLow : C.oLow,
            borderRadius: 6,
            padding: "4px 6px",
          }}
        >
          <span style={{ fontSize: 10, color: isMainnet ? C.warn : C.ok, letterSpacing: "0.08em", ...mono }}>
            {networkLabel.toUpperCase()}
          </span>
          <select
            data-testid="network-select"
            value={networkProfileId}
            onChange={(event) => onSwitchNetwork(event.target.value)}
            disabled={switchingNetwork}
            style={{
              background: "transparent",
              color: C.text,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              padding: isCompactMobile ? "3px 6px" : "4px 8px",
              fontSize: isCompactMobile ? 9 : 10,
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

        <button
          onClick={onOpenCreate}
          style={{
            background: view === "create" ? C.s2 : "none",
            border: `1px solid ${view === "create" ? C.border : "transparent"}`,
            color: view === "create" ? C.text : C.dim,
            padding: isCompactMobile ? "4px 10px" : "5px 14px",
            borderRadius: 4,
            fontSize: isCompactMobile ? 10 : 11,
            cursor: "pointer",
            ...mono,
          }}
        >
          NEW AGENT
        </button>

        {agents.map((row: any) => {
          const isActive = String(activeAgent?.agentId || "") === String(row?.agentId || "");
          return (
            <button
              key={String(row?.agentId || row?.name || `agent-idx-${agents.indexOf(row)}`)}
              onClick={() => onSelectAgent(String(row?.agentId || ""))}
              style={{
                background: isActive && view === "dashboard" ? C.s2 : "none",
                border: `1px solid ${isActive && view === "dashboard" ? C.accent : "transparent"}`,
                color: isActive ? C.accent : C.dim,
                padding: isCompactMobile ? "4px 8px" : "5px 10px",
                borderRadius: 4,
                fontSize: isCompactMobile ? 10 : 11,
                cursor: "pointer",
                maxWidth: isCompactMobile ? 112 : 140,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                ...mono,
              }}
              title={String(row?.name || "Agent")}
            >
              {String(row?.name || "AGENT")}
            </button>
          );
        })}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: isCompactMobile ? "4px 10px" : "5px 12px",
            border: `1px solid ${C.border}`,
            borderRadius: 4,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: wallet?.provider === "demo" ? C.warn : C.ok,
            }}
          />
          <span style={{ fontSize: isCompactMobile ? 9 : 10, color: C.dim, letterSpacing: "0.08em", ...mono }}>
            {shortAddr(wallet?.address)}
          </span>
        </div>

        <Btn onClick={onDisconnect} variant="ghost" size="sm">
          DISCONNECT
        </Btn>
      </div>
    </div>
  );
}

