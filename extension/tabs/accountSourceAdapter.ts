import type { WalletAccountRef } from "../shared/storage";
import { normalizeNetworkId, type AgentNetworkId, type AgentViewModel } from "./agentsView";

type RpcNetwork = "mainnet" | "testnet-10" | "testnet-11" | "testnet-12";
type AddressSourceMode = "canonical" | "agent_fallback";

export interface TrackedAddressGroupPlan {
  rpcNetwork: RpcNetwork;
  addresses: string[];
  addressToAgentIds: Record<string, string[]>;
}

export interface TrackedAddressPlan {
  groups: TrackedAddressGroupPlan[];
  signature: string;
  trackedAgentCount: number;
  sourceMode: AddressSourceMode;
}

function normalizeKaspaAddress(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.startsWith("kaspa:") || trimmed.startsWith("kaspatest:")) return trimmed;
  return "";
}

function resolveRpcNetwork(network: AgentNetworkId | string, currentNetwork: string): RpcNetwork | null {
  const normalized = normalizeNetworkId(network, "unknown");
  if (normalized === "mainnet") return "mainnet";
  if (normalized === "testnet-10") return "testnet-10";
  if (normalized === "testnet-11") return "testnet-11";
  if (normalized === "testnet-12") return "testnet-12";

  if (normalized === "testnet") {
    const current = normalizeNetworkId(currentNetwork, "unknown");
    if (current === "testnet-10") return "testnet-10";
    if (current === "testnet-11") return "testnet-11";
    if (current === "testnet-12") return "testnet-12";
  }

  return null;
}

function addressMatchesNetwork(address: string, network: RpcNetwork): boolean {
  if (network === "mainnet") return address.startsWith("kaspa:");
  return address.startsWith("kaspatest:");
}

function makeAgentAddressIndex(visibleAgents: AgentViewModel[]): Map<string, string[]> {
  const byAddress = new Map<string, string[]>();
  for (const agent of visibleAgents) {
    const normalizedAddress = normalizeKaspaAddress(agent.walletAddress);
    if (!normalizedAddress) continue;
    const list = byAddress.get(normalizedAddress);
    if (list) {
      if (!list.includes(agent.id)) list.push(agent.id);
    } else {
      byAddress.set(normalizedAddress, [agent.id]);
    }
  }
  return byAddress;
}

function buildFromCanonical(
  canonicalAccounts: WalletAccountRef[],
  currentNetwork: string,
  visibleAgents: AgentViewModel[],
): TrackedAddressPlan {
  const byAddress = makeAgentAddressIndex(visibleAgents);
  const grouped = new Map<RpcNetwork, Map<string, string[]>>();

  for (const account of canonicalAccounts) {
    const normalizedAddress = normalizeKaspaAddress(account.address);
    if (!normalizedAddress) continue;
    const rpcNetwork = resolveRpcNetwork(account.network, currentNetwork);
    if (!rpcNetwork) continue;
    if (!addressMatchesNetwork(normalizedAddress, rpcNetwork)) continue;

    let networkGroup = grouped.get(rpcNetwork);
    if (!networkGroup) {
      networkGroup = new Map<string, string[]>();
      grouped.set(rpcNetwork, networkGroup);
    }
    if (networkGroup.has(normalizedAddress)) continue;
    networkGroup.set(normalizedAddress, [...(byAddress.get(normalizedAddress) ?? [])]);
  }

  const groups = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rpcNetwork, addressesMap]) => {
      const addresses = [...addressesMap.keys()].sort();
      const addressToAgentIds: Record<string, string[]> = {};
      for (const address of addresses) {
        addressToAgentIds[address] = [...(addressesMap.get(address) ?? [])].sort();
      }
      return { rpcNetwork, addresses, addressToAgentIds } satisfies TrackedAddressGroupPlan;
    });

  const trackedAgentIds = new Set<string>();
  for (const group of groups) {
    for (const ids of Object.values(group.addressToAgentIds)) {
      for (const id of ids) trackedAgentIds.add(id);
    }
  }

  const signature = groups
    .flatMap((group) =>
      group.addresses.map((address) => `${group.rpcNetwork}|${address}|${group.addressToAgentIds[address].join("&")}`),
    )
    .join(";");

  return {
    groups,
    signature: `canonical:${signature}`,
    trackedAgentCount: trackedAgentIds.size,
    sourceMode: "canonical",
  };
}

function buildFromAgents(visibleAgents: AgentViewModel[], currentNetwork: string): TrackedAddressPlan {
  const grouped = new Map<RpcNetwork, Map<string, string[]>>();

  for (const agent of visibleAgents) {
    const normalizedAddress = normalizeKaspaAddress(agent.walletAddress);
    if (!normalizedAddress) continue;
    const rpcNetwork = resolveRpcNetwork(agent.network, currentNetwork);
    if (!rpcNetwork) continue;
    if (!addressMatchesNetwork(normalizedAddress, rpcNetwork)) continue;

    let networkGroup = grouped.get(rpcNetwork);
    if (!networkGroup) {
      networkGroup = new Map<string, string[]>();
      grouped.set(rpcNetwork, networkGroup);
    }

    const ids = networkGroup.get(normalizedAddress);
    if (ids) {
      if (!ids.includes(agent.id)) ids.push(agent.id);
    } else {
      networkGroup.set(normalizedAddress, [agent.id]);
    }
  }

  const groups = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rpcNetwork, addressesMap]) => {
      const addresses = [...addressesMap.keys()].sort();
      const addressToAgentIds: Record<string, string[]> = {};
      for (const address of addresses) {
        addressToAgentIds[address] = [...(addressesMap.get(address) ?? [])].sort();
      }
      return { rpcNetwork, addresses, addressToAgentIds } satisfies TrackedAddressGroupPlan;
    });

  const trackedAgentIds = new Set<string>();
  for (const group of groups) {
    for (const ids of Object.values(group.addressToAgentIds)) {
      for (const id of ids) trackedAgentIds.add(id);
    }
  }

  const signature = groups
    .flatMap((group) =>
      group.addresses.map((address) => `${group.rpcNetwork}|${address}|${group.addressToAgentIds[address].join("&")}`),
    )
    .join(";");

  return {
    groups,
    signature: `agent:${signature}`,
    trackedAgentCount: trackedAgentIds.size,
    sourceMode: "agent_fallback",
  };
}

export function buildTrackedAddressPlan(
  visibleAgents: AgentViewModel[],
  currentNetwork: string,
  canonicalAccounts: WalletAccountRef[],
): TrackedAddressPlan {
  if (canonicalAccounts.length > 0) {
    return buildFromCanonical(canonicalAccounts, currentNetwork, visibleAgents);
  }
  return buildFromAgents(visibleAgents, currentNetwork);
}

