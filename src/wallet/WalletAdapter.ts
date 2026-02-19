import { DEFAULT_NETWORK, KASPIUM_DEEP_LINK_SCHEME } from "../constants";
import { fmt, normalizeKaspaAddress } from "../helpers";

export const WalletAdapter = {
  detect() {
    return {
      kasware: typeof window !== "undefined" && !!(window as any).kasware,
      // Kaspium is an external mobile wallet/deep-link flow, so keep available.
      kaspium: true,
    };
  },

  async connectKasware() {
    const w = (window as any).kasware;
    if(!w) throw new Error("Kasware extension not detected. Install from kasware.org");
    const accounts = await w.requestAccounts();
    if(!accounts?.length) throw new Error("No accounts returned from Kasware");
    const network = await w.getNetwork();
    return { address: accounts[0], network, provider: "kasware" };
  },

  connectKaspium(address: string) {
    const normalized = normalizeKaspaAddress(address);
    return { address: normalized, network: DEFAULT_NETWORK, provider: "kaspium" };
  },

  async getKaswareBalance() {
    const w = (window as any).kasware;
    if(!w) throw new Error("Kasware not connected");
    const b = await w.getBalance();
    return fmt((b.total || 0) / 1e8, 4);
  },

  async sendKasware(toAddress: string, amountKas: number) {
    const w = (window as any).kasware;
    if(!w) throw new Error("Kasware not connected");
    const sompi = Math.floor(amountKas * 1e8);
    const txid = await w.sendKaspa(toAddress, sompi);
    return txid;
  },

  // Kaspium currently uses a manual deep-link + txid confirmation flow.
  async sendKaspium(toAddress: string, amountKas: number, note?: string) {
    normalizeKaspaAddress(toAddress);
    if(typeof window === "undefined") throw new Error("Kaspium deep-link is only available in browser environments");

    const scheme = KASPIUM_DEEP_LINK_SCHEME.endsWith("://") ? KASPIUM_DEEP_LINK_SCHEME : `${KASPIUM_DEEP_LINK_SCHEME}://`;
    const url = `${scheme}send?address=${encodeURIComponent(toAddress)}&amount=${encodeURIComponent(String(amountKas))}${note?`&note=${encodeURIComponent(note)}`:""}`;

    window.location.href = url;

    const txid = window.prompt("Complete the transfer in Kaspium, then paste the broadcast txid:");
    if(!txid) throw new Error("Transaction not confirmed. No txid provided.");

    return txid.trim();
  },

  async signMessageKasware(message: string) {
    const w = (window as any).kasware;
    if(!w) throw new Error("Kasware not connected");
    return w.signMessage(message);
  }
};
