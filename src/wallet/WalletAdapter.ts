import { createHardwareBridgeProvider } from "./providers/hardwareBridge";
import { createKaspiumProvider } from "./providers/kaspium";
import { createKastleProvider } from "./providers/kastle";
import { createGhostProvider } from "./providers/ghost";
import { createKaswareProvider } from "./providers/kasware";
import { loadManagedWallet, signMessage as managedSignMessage } from "./KaspaWalletManager";
import {
  ALLOWED_ADDRESS_PREFIXES,
  ALL_KASPA_ADDRESS_PREFIXES,
  DEFAULT_NETWORK,
  ENFORCE_WALLET_NETWORK,
  GHOST_CONNECT_TIMEOUT_MS,
  KASPIUM_DEEP_LINK_SCHEME,
  KASTLE_RAW_TX_ENABLED,
  KASTLE_RAW_TX_MANUAL_JSON_PROMPT_ENABLED,
  KASTLE_TX_BUILDER_URL,
  NETWORK_LABEL,
  WALLET_CALL_TIMEOUT_MS,
  WALLET_SEND_TIMEOUT_MS,
  buildKastleRawTxJson,
  formatKasAmountString,
  getKaswareProvider,
  getKastleCachedAccountAddress,
  getKastleProvider,
  getKastleRawTxJsonBuilderBridge,
  ghostInvoke,
  isAddressPrefixCompatible,
  isLikelyTxid,
  kastleNetworkIdForCurrentProfile,
  normalizeKaspaAddress,
  normalizeOutputList,
  normalizeWalletError,
  parseAnyTxid,
  parseKaswareBalance,
  parseKaswareTxid,
  probeGhostProviders,
  promptForTxidIfNeeded,
  resolveKaspaNetwork,
  setKastleAccountCacheAddress,
  toSompi,
  withTimeout,
} from "./walletAdapterInternals";

const kaswareProvider = createKaswareProvider({
  getKaswareProvider,
  withTimeout,
  WALLET_CALL_TIMEOUT_MS,
  WALLET_SEND_TIMEOUT_MS,
  resolveKaspaNetwork,
  DEFAULT_NETWORK,
  normalizeKaspaAddress,
  ALL_KASPA_ADDRESS_PREFIXES,
  ALLOWED_ADDRESS_PREFIXES,
  ENFORCE_WALLET_NETWORK,
  NETWORK_LABEL,
  isAddressPrefixCompatible,
  normalizeWalletError,
  parseKaswareBalance,
  parseKaswareTxid,
  isLikelyTxid,
  toSompi,
});

const kastleProvider = createKastleProvider({
  getKastleProvider,
  withTimeout,
  WALLET_CALL_TIMEOUT_MS,
  WALLET_SEND_TIMEOUT_MS,
  resolveKaspaNetwork,
  DEFAULT_NETWORK,
  normalizeKaspaAddress,
  ALL_KASPA_ADDRESS_PREFIXES,
  ALLOWED_ADDRESS_PREFIXES,
  ENFORCE_WALLET_NETWORK,
  NETWORK_LABEL,
  isAddressPrefixCompatible,
  normalizeWalletError,
  toSompi,
  parseAnyTxid,
  isLikelyTxid,
  KASTLE_RAW_TX_ENABLED,
  KASTLE_TX_BUILDER_URL,
  KASTLE_RAW_TX_MANUAL_JSON_PROMPT_ENABLED,
  getKastleRawTxJsonBuilderBridge,
  buildKastleRawTxJson,
  normalizeOutputList,
  kastleNetworkIdForCurrentProfile,
  setKastleAccountCacheAddress,
  getKastleCachedAccountAddress,
});

const kaspiumProvider = createKaspiumProvider({
  normalizeKaspaAddress,
  ALLOWED_ADDRESS_PREFIXES,
  DEFAULT_NETWORK,
  KASPIUM_DEEP_LINK_SCHEME,
  isLikelyTxid,
});

const hardwareBridgeProvider = createHardwareBridgeProvider({
  normalizeKaspaAddress,
  ALLOWED_ADDRESS_PREFIXES,
  DEFAULT_NETWORK,
  normalizeOutputList,
  isLikelyTxid,
});

const ghostProvider = createGhostProvider({
  resolveKaspaNetwork,
  DEFAULT_NETWORK,
  normalizeKaspaAddress,
  ALL_KASPA_ADDRESS_PREFIXES,
  ALLOWED_ADDRESS_PREFIXES,
  ENFORCE_WALLET_NETWORK,
  NETWORK_LABEL,
  isAddressPrefixCompatible,
  normalizeWalletError,
  withTimeout,
  GHOST_CONNECT_TIMEOUT_MS,
  WALLET_SEND_TIMEOUT_MS,
  ghostInvoke,
  probeGhostProviders,
  formatKasAmountString,
  parseAnyTxid,
  promptForTxidIfNeeded,
  normalizeOutputList,
});

export const WalletAdapter = {
  detect() {
    let kasware: any;
    let kastle: any;
    let forgeos: any;
    try {
      kasware = typeof window !== "undefined" ? (window as any).kasware : undefined;
      kastle = typeof window !== "undefined" ? (window as any).kastle : undefined;
      forgeos = typeof window !== "undefined" ? (window as any).forgeos : undefined;
    } catch {
      kasware = undefined;
      kastle = undefined;
      forgeos = undefined;
    }
    return {
      kasware: !!kasware,
      kastle: !!kastle,
      forgeos: !!forgeos?.isForgeOS,
      ghost: false,
      kaspium: true,
      kaswareMethods: kasware
        ? {
            requestAccounts: typeof kasware.requestAccounts === "function",
            getNetwork: typeof kasware.getNetwork === "function",
            getBalance: typeof kasware.getBalance === "function",
            signMessage: typeof kasware.signMessage === "function",
            sendKaspa: typeof kasware.sendKaspa === "function",
          }
        : null,
      kastleMethods: kastle
        ? {
            connect: typeof kastle.connect === "function",
            getAccount: typeof kastle.getAccount === "function",
            request: typeof kastle.request === "function",
            sendKaspa: typeof kastle.sendKaspa === "function",
            signMessage: typeof kastle.signMessage === "function",
            signAndBroadcastTx: typeof kastle.signAndBroadcastTx === "function",
          }
        : null,
    };
  },

  async connectKasware() {
    return kaswareProvider.connect();
  },

  async connectKastle() {
    return kastleProvider.connect();
  },

  async connectForgeOS() {
    // Try extension provider first (page-provider.ts injects window.forgeos)
    const forgeos = (window as any).forgeos;
    if (forgeos?.isForgeOS) {
      const wallet = await forgeos.connect();
      if (wallet?.address) {
        return { address: wallet.address, network: wallet.network, provider: "forgeos" };
      }
    }
    // Fallback: read managed wallet directly from localStorage (no extension needed)
    const managed = loadManagedWallet();
    if (managed?.address) {
      return { address: managed.address, network: managed.network, provider: "forgeos" };
    }
    throw new Error("No Forge-OS wallet found. Please create or import a wallet first.");
  },

  connectKaspium(address: string) {
    return kaspiumProvider.connect(address);
  },

  async getKaswareBalance() {
    return kaswareProvider.getBalance();
  },

  async sendKasware(toAddress: string, amountKas: number) {
    return kaswareProvider.send(toAddress, amountKas);
  },

  async sendKastle(toAddress: string, amountKas: number) {
    return kastleProvider.send(toAddress, amountKas);
  },

  canKastleSignAndBroadcastRawTx() {
    return kastleProvider.canSignAndBroadcastRawTx();
  },

  canKastleMultiOutputRawTxPath() {
    return kastleProvider.canMultiOutputRawTxPath();
  },

  async sendKastleRawTx(outputs: Array<{ to: string; amount_kas: number }>, purpose?: string) {
    return kastleProvider.sendRawTx(outputs, purpose);
  },

  async sendKaspium(toAddress: string, amountKas: number, note?: string) {
    return kaspiumProvider.send(toAddress, amountKas, note);
  },

  async sendGhost(toAddress: string, amountKas: number) {
    return ghostProvider.send(toAddress, amountKas);
  },

  async sendGhostOutputs(outputs: Array<{ to: string; amount_kas: number }>, purpose?: string) {
    return ghostProvider.sendOutputs(outputs, purpose);
  },

  async signMessageKasware(message: string) {
    return kaswareProvider.signMessage(message);
  },

  async signMessageKastle(message: string) {
    return kastleProvider.signMessage(message);
  },

  async signMessageForgeOS(message: string) {
    // Try extension provider first
    const forgeos = (window as any).forgeos;
    if (forgeos?.isForgeOS) {
      return forgeos.signMessage(message);
    }
    // Fallback: sign locally with managed wallet phrase
    const managed = loadManagedWallet();
    if (managed?.phrase) {
      return managedSignMessage(managed.phrase, message);
    }
    throw new Error("No Forge-OS wallet found for signing.");
  },

  supportsNativeMultiOutput(provider: string) {
    const normalized = String(provider || "").toLowerCase();
    if (normalized === "kastle") return kastleProvider.canMultiOutputRawTxPath();
    return false;
  },

  async connectHardwareBridge(provider: "tangem" | "onekey", address: string) {
    return hardwareBridgeProvider.connect(provider, address);
  },

  async sendHardwareBridge(
    provider: string,
    toAddress: string,
    amountKas: number,
    note?: string,
    outputs?: Array<{ to: string; amount_kas: number }>
  ) {
    return hardwareBridgeProvider.send(provider, toAddress, amountKas, note, outputs);
  }
};
