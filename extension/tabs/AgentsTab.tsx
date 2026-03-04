import { useCallback, useEffect, useMemo, useState } from "react";
import { C, mono } from "../../src/tokens";
import { fmt } from "../../src/helpers";
import {
  getAgents,
  getWalletAccountList,
  WALLET_ACCOUNT_LIST_STORAGE_KEY,
  type WalletAccountRef,
} from "../shared/storage";
import { getOrSyncUtxosBatch } from "../utxo/utxoSync";
import { outlineButton, popupTabStack, sectionCard, sectionKicker, sectionTitle } from "../popup/surfaces";
import {
  buildAgentViewModels,
  filterAgentViews,
  networkBadgeLabel,
  normalizeNetworkId,
  type AgentModeFilter,
  type AgentNetworkFilter,
  type AgentViewModel,
} from "./agentsView";
import { buildTrackedAddressPlan } from "./accountSourceAdapter";

const AGENTS_KEY = "forgeos.session.agents.v2";

interface Props {
  network: string;
}

function formatTimeAgo(ts: number, now: number): string {
  if (!ts || ts <= 0) return "No recent heartbeat";
  const diff = Math.max(0, now - ts);
  if (diff < 1_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function networkFilterLabel(filter: AgentNetworkFilter, currentNetwork: string): string {
  if (filter === "current") {
    const normalized = normalizeNetworkId(currentNetwork, "unknown");
    return `CURRENT (${networkBadgeLabel(normalized)})`;
  }
  if (filter === "mainnet") return "MAINNET";
  if (filter === "testnet-12") return "TN12";
  if (filter === "testnet-10") return "TN10";
  if (filter === "testnet-11") return "TN11";
  return "ALL";
}

function modeFilterLabel(filter: AgentModeFilter): string {
  if (filter === "all") return "ALL MODES";
  if (filter === "bots") return "BOTS";
  return "MANUAL";
}

export function AgentsTab({ network }: Props) {
  const [agents, setAgents] = useState<AgentViewModel[]>([]);
  const [canonicalAccounts, setCanonicalAccounts] = useState<WalletAccountRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [networkFilter, setNetworkFilter] = useState<AgentNetworkFilter>("current");
  const [modeFilter, setModeFilter] = useState<AgentModeFilter>("all");
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [onChainBalancesKas, setOnChainBalancesKas] = useState<Record<string, number>>({});
  const [onChainSyncAt, setOnChainSyncAt] = useState(0);
  const [onChainSyncBusy, setOnChainSyncBusy] = useState(false);
  const [onChainSyncError, setOnChainSyncError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const refreshAgents = useCallback(async () => {
    const [raw, accounts] = await Promise.all([
      getAgents(),
      getWalletAccountList().catch(() => [] as WalletAccountRef[]),
    ]);
    setAgents(buildAgentViewModels(raw, network));
    setCanonicalAccounts(accounts);
    setLastSyncAt(Date.now());
    setLoading(false);
  }, [network]);

  useEffect(() => {
    refreshAgents().catch(() => setLoading(false));
  }, [refreshAgents]);

  useEffect(() => {
    const id = setInterval(() => {
      refreshAgents().catch(() => {});
      setNow(Date.now());
    }, 5_000);
    return () => clearInterval(id);
  }, [refreshAgents]);

  useEffect(() => {
    const onChanged = (changes: Record<string, unknown>, areaName: string) => {
      if (areaName !== "local") return;
      if (!(AGENTS_KEY in changes) && !(WALLET_ACCOUNT_LIST_STORAGE_KEY in changes)) return;
      refreshAgents().catch(() => {});
    };
    chrome.storage.onChanged.addListener(onChanged as any);
    return () => chrome.storage.onChanged.removeListener(onChanged as any);
  }, [refreshAgents]);

  useEffect(() => {
    const onRuntimeMessage = (message: any) => {
      if (message?.type !== "FORGEOS_AGENTS_UPDATED") return;
      refreshAgents().catch(() => {});
    };
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    return () => chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  }, [refreshAgents]);

  const visibleAgents = useMemo(
    () => filterAgentViews(agents, networkFilter, modeFilter, network),
    [agents, modeFilter, network, networkFilter],
  );

  const trackedAddressPlan = useMemo(() => {
    return buildTrackedAddressPlan(visibleAgents, network, canonicalAccounts);
  }, [canonicalAccounts, network, visibleAgents]);

  useEffect(() => {
    let cancelled = false;

    const syncOnChainBalances = async () => {
      if (trackedAddressPlan.groups.length === 0) {
        if (cancelled) return;
        setOnChainBalancesKas({});
        setOnChainSyncError(null);
        setOnChainSyncBusy(false);
        setOnChainSyncAt(Date.now());
        return;
      }

      if (cancelled) return;
      setOnChainSyncBusy(true);
      setOnChainSyncError(null);

      try {
        const groupResults = await Promise.all(
          trackedAddressPlan.groups.map(async (group) => ({
            group,
            utxosByAddress: await getOrSyncUtxosBatch(group.addresses, group.rpcNetwork),
          })),
        );

        if (cancelled) return;
        const nextBalances: Record<string, number> = {};
        for (const { group, utxosByAddress } of groupResults) {
          for (const address of group.addresses) {
            const mapped = utxosByAddress[address];
            const kas = mapped ? Number(mapped.confirmedBalance) / 1e8 : 0;
            const ids = group.addressToAgentIds[address] ?? [];
            for (const id of ids) nextBalances[id] = kas;
          }
        }

        setOnChainBalancesKas(nextBalances);
        setOnChainSyncAt(Date.now());
      } catch (err) {
        if (cancelled) return;
        setOnChainSyncError(err instanceof Error ? err.message : "Failed to sync on-chain balances.");
      } finally {
        if (!cancelled) setOnChainSyncBusy(false);
      }
    };

    syncOnChainBalances().catch(() => {});
    const id = setInterval(() => {
      syncOnChainBalances().catch(() => {});
    }, 25_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [trackedAddressPlan.signature]);

  const summary = useMemo(() => {
    const total = visibleAgents.length;
    const bots = visibleAgents.filter((a) => a.isBot).length;
    const active = visibleAgents.filter((a) => a.isActive).length;
    const pnlUsd = visibleAgents.reduce((sum, a) => sum + a.pnlUsd, 0);
    const onChainKas = Object.values(onChainBalancesKas).reduce((sum, value) => sum + value, 0);
    return { total, bots, active, pnlUsd, onChainKas };
  }, [onChainBalancesKas, visibleAgents]);

  if (loading) {
    return <div style={{ ...popupTabStack, paddingTop: 20, fontSize: 9, color: C.dim, textAlign: "center" }}>Loading agents…</div>;
  }

  if (visibleAgents.length === 0) {
    return (
      <div style={{ ...popupTabStack, gap: 10 }}>
        <div style={sectionCard("default", true)}>
          <div style={{ ...sectionKicker, marginBottom: 7 }}>LIVE AGENT FEED · TESTNET/MAINNET FILTERS</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 7 }}>
            {(["current", "mainnet", "testnet-10", "testnet-11", "testnet-12", "all"] as AgentNetworkFilter[]).map((filter) => {
              const active = filter === networkFilter;
              return (
                <button
                  key={filter}
                  onClick={() => setNetworkFilter(filter)}
                  style={{
                    ...outlineButton(active ? C.accent : C.dim),
                    padding: "5px 7px",
                    fontSize: 8,
                    background: active ? `${C.accent}20` : "rgba(16,25,35,0.45)",
                    borderColor: active ? `${C.accent}55` : C.border,
                  }}
                >
                  {networkFilterLabel(filter, network)}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["all", "bots", "manual"] as AgentModeFilter[]).map((filter) => {
              const active = filter === modeFilter;
              return (
                <button
                  key={filter}
                  onClick={() => setModeFilter(filter)}
                  style={{
                    ...outlineButton(active ? C.ok : C.dim),
                    padding: "5px 7px",
                    fontSize: 8,
                    background: active ? `${C.ok}20` : "rgba(16,25,35,0.45)",
                    borderColor: active ? `${C.ok}55` : C.border,
                  }}
                >
                  {modeFilterLabel(filter)}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ ...popupTabStack, ...sectionCard("accent"), padding: "20px 18px", textAlign: "center", gap: 14, alignItems: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: `${C.accent}14`, border: `1px solid ${C.accent}35`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, boxShadow: "0 8px 18px rgba(57,221,182,0.12)" }}>⚡</div>
          <div>
            <div style={{ ...sectionTitle, fontSize: 11, marginBottom: 6 }}>No Agents In This Filter</div>
            <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.6, maxWidth: 220 }}>
              Live refresh runs every 5 seconds. Switch filters or deploy a new bot on Forge-OS.
            </div>
            <div style={{ fontSize: 8, color: C.muted, marginTop: 7 }}>
              Last sync {lastSyncAt > 0 ? formatTimeAgo(lastSyncAt, now) : "never"}
            </div>
          </div>
          <button
            onClick={() => chrome.tabs.create({ url: `https://forge-os.xyz?network=${encodeURIComponent(network)}` })}
            style={{
              background: `linear-gradient(90deg, ${C.accent}, #7BE9CF)`,
              border: "none", borderRadius: 10, padding: "10px 20px",
              color: "#04110E", fontSize: 9, fontWeight: 700, cursor: "pointer", ...mono,
              letterSpacing: "0.1em", boxShadow: "0 8px 18px rgba(57,221,182,0.16)",
            }}
          >OPEN FORGE-OS ↗</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...popupTabStack, paddingTop: 10, gap: 8 }}>
      <div style={sectionCard("default", true)}>
        <div style={{ ...sectionKicker, marginBottom: 7 }}>LIVE AGENT FEED · TESTNET/MAINNET OPTIONS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, marginBottom: 8 }}>
          <div style={{ background: "rgba(16,25,35,0.45)", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 7px" }}>
            <div style={{ fontSize: 8, color: C.dim }}>VISIBLE</div>
            <div style={{ fontSize: 10, color: C.text, fontWeight: 700 }}>{summary.total}</div>
          </div>
          <div style={{ background: "rgba(16,25,35,0.45)", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 7px" }}>
            <div style={{ fontSize: 8, color: C.dim }}>BOTS</div>
            <div style={{ fontSize: 10, color: C.accent, fontWeight: 700 }}>{summary.bots}</div>
          </div>
          <div style={{ background: "rgba(16,25,35,0.45)", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 7px" }}>
            <div style={{ fontSize: 8, color: C.dim }}>ACTIVE</div>
            <div style={{ fontSize: 10, color: C.ok, fontWeight: 700 }}>{summary.active}</div>
          </div>
          <div style={{ background: "rgba(16,25,35,0.45)", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 7px" }}>
            <div style={{ fontSize: 8, color: C.dim }}>P&L USD</div>
            <div style={{ fontSize: 10, color: summary.pnlUsd >= 0 ? C.ok : C.danger, fontWeight: 700 }}>
              {summary.pnlUsd >= 0 ? "+" : "-"}${fmt(Math.abs(summary.pnlUsd), 2)}
            </div>
          </div>
        </div>

        <div style={{ background: "rgba(16,25,35,0.45)", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 8px", marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 8, color: C.dim, ...mono }}>ON-CHAIN KAS (TRACKED)</span>
            <span style={{ fontSize: 9, color: C.accent, fontWeight: 700, ...mono }}>
              {onChainSyncBusy ? "SYNCING…" : `${fmt(summary.onChainKas, 4)} KAS`}
            </span>
          </div>
          <div style={{ fontSize: 8, color: C.dim, marginTop: 4 }}>
            {trackedAddressPlan.trackedAgentCount}/{summary.total} agents with mapped wallet addresses
            {onChainSyncAt > 0 ? ` · synced ${formatTimeAgo(onChainSyncAt, now)}` : ""}
          </div>
          <div style={{ fontSize: 8, color: C.dim, marginTop: 3 }}>
            Source: {trackedAddressPlan.sourceMode === "canonical" ? "CANONICAL ACCOUNTS" : "AGENT FALLBACK"}
          </div>
          {onChainSyncError && (
            <div style={{ fontSize: 8, color: C.warn, marginTop: 4 }}>
              {onChainSyncError}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 7 }}>
          {(["current", "mainnet", "testnet-10", "testnet-11", "testnet-12", "all"] as AgentNetworkFilter[]).map((filter) => {
            const active = filter === networkFilter;
            return (
              <button
                key={filter}
                onClick={() => setNetworkFilter(filter)}
                style={{
                  ...outlineButton(active ? C.accent : C.dim),
                  padding: "5px 7px",
                  fontSize: 8,
                  background: active ? `${C.accent}20` : "rgba(16,25,35,0.45)",
                  borderColor: active ? `${C.accent}55` : C.border,
                }}
              >
                {networkFilterLabel(filter, network)}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["all", "bots", "manual"] as AgentModeFilter[]).map((filter) => {
            const active = filter === modeFilter;
            return (
              <button
                key={filter}
                onClick={() => setModeFilter(filter)}
                style={{
                  ...outlineButton(active ? C.ok : C.dim),
                  padding: "5px 7px",
                  fontSize: 8,
                  background: active ? `${C.ok}20` : "rgba(16,25,35,0.45)",
                  borderColor: active ? `${C.ok}55` : C.border,
                }}
              >
                {modeFilterLabel(filter)}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ ...sectionKicker, marginBottom: 2 }}>
        LIVE UPDATE · LAST SYNC {lastSyncAt > 0 ? formatTimeAgo(lastSyncAt, now).toUpperCase() : "NEVER"}
      </div>

      {visibleAgents.map((agent) => {
        const pnlPositive = agent.pnlUsd >= 0;
        const execMode = String(agent.execMode || "manual").toUpperCase();
        const statusColor = agent.isActive ? C.ok : C.warn;
        return (
          <div key={agent.id} style={{
            ...sectionCard(agent.isActive ? "accent" : "default", true),
            borderColor: agent.isActive ? `${C.accent}40` : C.border,
            padding: "10px 12px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: C.text,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>{agent.name}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <span style={{
                  fontSize: 8, color: C.dim, ...mono,
                  background: "rgba(16,25,35,0.65)", border: `1px solid ${C.border}`, borderRadius: 3, padding: "2px 5px",
                }}>{networkBadgeLabel(agent.network)}</span>
                <span style={{
                  fontSize: 8, color: agent.isBot ? C.accent : C.dim, ...mono,
                  background: agent.isBot ? `${C.accent}18` : "rgba(16,25,35,0.65)",
                  border: `1px solid ${agent.isBot ? `${C.accent}50` : C.border}`,
                  borderRadius: 3, padding: "2px 5px",
                }}>{agent.isBot ? "BOT" : "MANUAL"}</span>
                <span style={{
                  fontSize: 8, color: agent.isActive ? C.ok : C.warn, fontWeight: 700, ...mono,
                  background: agent.isActive ? `${C.ok}15` : `${C.warn}15`,
                  border: `1px solid ${agent.isActive ? C.ok : C.warn}30`,
                  borderRadius: 3, padding: "2px 5px",
                }}>{execMode}</span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div>
                <div style={{ fontSize: 8, color: C.dim, marginBottom: 1 }}>STRATEGY</div>
                <div style={{ fontSize: 8, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{agent.strategy}</div>
              </div>
              <div>
                <div style={{ fontSize: 8, color: C.dim, marginBottom: 1 }}>P&L (USD)</div>
                <div style={{ fontSize: 8, color: pnlPositive ? C.ok : C.danger, fontWeight: 700 }}>
                  {pnlPositive ? "+" : ""}${fmt(Math.abs(agent.pnlUsd), 2)}
                </div>
              </div>
              {agent.capitalLimitKas && (
                <div>
                  <div style={{ fontSize: 8, color: C.dim, marginBottom: 1 }}>CAPITAL</div>
                  <div style={{ fontSize: 8, color: C.text }}>{agent.capitalLimitKas} KAS</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 8, color: C.dim, marginBottom: 1 }}>LAST HEARTBEAT</div>
                <div style={{ fontSize: 8, color: C.text }}>{formatTimeAgo(agent.updatedAt, now)}</div>
              </div>
              <div>
                <div style={{ fontSize: 8, color: C.dim, marginBottom: 1 }}>RISK</div>
                <div style={{ fontSize: 8, color: C.text }}>{String(agent.risk || "—").toUpperCase()}</div>
              </div>
              <div>
                <div style={{ fontSize: 8, color: C.dim, marginBottom: 1 }}>ON-CHAIN KAS</div>
                <div style={{ fontSize: 8, color: C.accent }}>
                  {Number.isFinite(onChainBalancesKas[agent.id]) ? `${fmt(onChainBalancesKas[agent.id], 4)} KAS` : "—"}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <button
        onClick={() => chrome.tabs.create({ url: `https://forge-os.xyz?network=${encodeURIComponent(network)}` })}
        style={{
          ...outlineButton(C.dim, true),
          padding: "8px 10px",
          marginTop: 2,
        }}
      >MANAGE LIVE ON FORGE-OS ↗</button>
    </div>
  );
}
