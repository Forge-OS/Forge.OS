export type AgentNetworkId = "mainnet" | "testnet-10" | "testnet-11" | "testnet-12" | "testnet" | "unknown";
export type AgentNetworkFilter = "current" | "all" | "mainnet" | "testnet-10" | "testnet-11" | "testnet-12";
export type AgentModeFilter = "all" | "bots" | "manual";

export interface AgentViewModel {
  id: string;
  name: string;
  strategy: string;
  risk: string;
  walletAddress: string | null;
  capitalLimitKas: string | null;
  execMode: string;
  status: string;
  isBot: boolean;
  isActive: boolean;
  pnlUsd: number;
  network: AgentNetworkId;
  updatedAt: number;
  raw: Record<string, unknown>;
}

function toObject(value: unknown): Record<string, unknown> {
  return (value && typeof value === "object") ? (value as Record<string, unknown>) : {};
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "");
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function toTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function networkFromAddress(value: unknown): AgentNetworkId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("kaspa:")) return "mainnet";
  if (normalized.startsWith("kaspatest:")) return "testnet";
  return null;
}

function pickKaspaAddress(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    const lower = normalized.toLowerCase();
    if (lower.startsWith("kaspa:") || lower.startsWith("kaspatest:")) return normalized;
  }
  return "";
}

export function normalizeNetworkId(raw: unknown, fallback: unknown = "unknown"): AgentNetworkId {
  const normalized = String(raw ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized.includes("mainnet") || normalized === "main" || normalized === "livenet") return "mainnet";
  if (normalized.includes("testnet-12") || normalized === "tn12") return "testnet-12";
  if (normalized.includes("testnet-11") || normalized === "tn11") return "testnet-11";
  if (normalized.includes("testnet-10") || normalized === "tn10") return "testnet-10";
  if (normalized === "testnet" || normalized.startsWith("tn") || normalized.startsWith("testnet")) return "testnet";
  if (normalized === "kaspa") return "mainnet";
  if (normalized === "kaspatest") return "testnet";

  const fallbackNorm = String(fallback ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (fallbackNorm === "mainnet") return "mainnet";
  if (fallbackNorm === "testnet-12" || fallbackNorm === "tn12") return "testnet-12";
  if (fallbackNorm === "testnet-10" || fallbackNorm === "tn10") return "testnet-10";
  if (fallbackNorm === "testnet-11" || fallbackNorm === "tn11") return "testnet-11";
  if (fallbackNorm.startsWith("testnet") || fallbackNorm.startsWith("tn")) return "testnet";
  return "unknown";
}

function resolveAgentNetwork(agent: Record<string, unknown>, currentNetwork: string): AgentNetworkId {
  const wallet = toObject(agent.wallet);
  const deployTx = toObject(agent.deployTx);
  const meta = toObject(agent.meta);

  const explicit = pickString(
    agent.network,
    wallet.network,
    deployTx.network,
    meta.network,
  );
  if (explicit) return normalizeNetworkId(explicit, "unknown");

  const inferredAddress = pickString(
    wallet.address,
    agent.address,
    deployTx.from,
    deployTx.to,
  );
  const inferredNetwork = networkFromAddress(inferredAddress);
  if (inferredNetwork) return normalizeNetworkId(inferredNetwork, "unknown");

  // Fallback: align to active popup network when legacy agent records have no network field.
  return normalizeNetworkId(currentNetwork, "unknown");
}

function isBotExecMode(execMode: string): boolean {
  const mode = execMode.toLowerCase();
  return mode === "autonomous" || mode === "auto" || mode === "bot";
}

function isActiveStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "active" || s === "running" || s === "live";
}

export function mapAgentView(agent: unknown, currentNetwork: string): AgentViewModel | null {
  const raw = toObject(agent);
  const wallet = toObject(raw.wallet);
  const now = Date.now();
  const id = pickString(raw.agentId, raw.id, raw.name) || `agent_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const name = pickString(raw.name, raw.agentName) || "Agent";
  const strategy = pickString(raw.strategyLabel, raw.strategy, raw.strategyTemplate) || "—";
  const risk = pickString(raw.risk) || "—";
  const walletAddress = pickKaspaAddress(
    wallet.address,
    raw.address,
    raw.walletAddress,
  ) || null;
  const capitalLimitRaw = pickString(raw.capitalLimit, raw.capital_limit);
  const capitalLimitKas = capitalLimitRaw || null;
  const execMode = pickString(raw.execMode, raw.mode) || "manual";
  const status = pickString(raw.status) || "idle";
  const network = resolveAgentNetwork(raw, currentNetwork);
  const pnlUsd = toNumber(raw.pnlUsd) || toNumber(raw.pnl);
  const updatedAt = Math.max(
    toTimestamp(raw.updatedAt),
    toTimestamp(raw.lastActionTime),
    toTimestamp(raw.lastDecisionTs),
    toTimestamp(raw.lastSeenAt),
    toTimestamp(raw.deployedAt),
    toTimestamp(wallet.updatedAt),
  );
  const activeByHeartbeat = updatedAt > 0 && (now - updatedAt) <= (5 * 60 * 1000);
  const isBot = isBotExecMode(execMode);
  const isActive = isActiveStatus(status) || isBot || activeByHeartbeat;

  return {
    id,
    name,
    strategy,
    risk,
    walletAddress,
    capitalLimitKas,
    execMode,
    status,
    isBot,
    isActive,
    pnlUsd,
    network,
    updatedAt,
    raw,
  };
}

export function buildAgentViewModels(agents: unknown[], currentNetwork: string): AgentViewModel[] {
  const out: AgentViewModel[] = [];
  for (const agent of agents) {
    const mapped = mapAgentView(agent, currentNetwork);
    if (mapped) out.push(mapped);
    if (out.length >= 64) break;
  }
  out.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  return out;
}

function networkFilterMatches(
  network: AgentNetworkId,
  filter: AgentNetworkFilter,
  currentNetwork: string,
): boolean {
  if (filter === "all") return true;
  if (filter === "mainnet") return network === "mainnet";
  if (filter === "testnet-12") return network === "testnet-12" || network === "testnet";
  if (filter === "testnet-10") return network === "testnet-10" || network === "testnet";
  if (filter === "testnet-11") return network === "testnet-11" || network === "testnet";

  const current = normalizeNetworkId(currentNetwork, "unknown");
  if (current === "mainnet") return network === "mainnet";
  if (current === "testnet-12") return network === "testnet-12" || network === "testnet";
  if (current === "testnet-10") return network === "testnet-10" || network === "testnet";
  if (current === "testnet-11") return network === "testnet-11" || network === "testnet";
  if (current === "testnet") {
    return (
      network === "testnet"
      || network === "testnet-10"
      || network === "testnet-11"
      || network === "testnet-12"
    );
  }
  return true;
}

export function filterAgentViews(
  agents: AgentViewModel[],
  networkFilter: AgentNetworkFilter,
  modeFilter: AgentModeFilter,
  currentNetwork: string,
): AgentViewModel[] {
  return agents.filter((agent) => {
    if (!networkFilterMatches(agent.network, networkFilter, currentNetwork)) return false;
    if (modeFilter === "bots" && !agent.isBot) return false;
    if (modeFilter === "manual" && agent.isBot) return false;
    return true;
  });
}

export function networkBadgeLabel(network: AgentNetworkId): string {
  if (network === "mainnet") return "MAINNET";
  if (network === "testnet-12") return "TN12";
  if (network === "testnet-10") return "TN10";
  if (network === "testnet-11") return "TN11";
  if (network === "testnet") return "TESTNET";
  return "UNKNOWN";
}
