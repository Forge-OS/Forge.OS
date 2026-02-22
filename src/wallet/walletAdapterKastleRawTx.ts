type Output = { to: string; amount_kas: number };

type BridgeFn = ((input: any) => Promise<any> | any) | null;

export function createKastleRawTxRuntime(params: {
  allKaspaAddressPrefixes: string[];
  walletCallTimeoutMs: number;
  kastleAccountCacheTtlMs: number;
  kastleTxBuilderUrl: string;
  kastleTxBuilderToken: string;
  kastleTxBuilderTimeoutMs: number;
  kastleTxBuilderStrict: boolean;
  kastleRawTxManualJsonPromptEnabled: boolean;
  getKastleProvider: () => any;
  withTimeout: <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;
  normalizeKaspaAddress: (value: string, allowedPrefixes: string[]) => string;
  normalizeOutputList: (outputs: any[]) => Output[];
  kastleNetworkIdForCurrentProfile: () => "mainnet" | "testnet-10";
  getKastleRawTxJsonBuilderBridge: () => BridgeFn;
}) {
  const {
    allKaspaAddressPrefixes,
    walletCallTimeoutMs,
    kastleAccountCacheTtlMs,
    kastleTxBuilderUrl,
    kastleTxBuilderToken,
    kastleTxBuilderTimeoutMs,
    kastleTxBuilderStrict,
    kastleRawTxManualJsonPromptEnabled,
    getKastleProvider,
    withTimeout,
    normalizeKaspaAddress,
    normalizeOutputList,
    kastleNetworkIdForCurrentProfile,
    getKastleRawTxJsonBuilderBridge,
  } = params;

  let kastleAccountCache: { address: string; ts: number } = { address: "", ts: 0 };

  async function getKastleAccountAddress() {
    if (kastleAccountCache.address && Date.now() - kastleAccountCache.ts <= kastleAccountCacheTtlMs) {
      return kastleAccountCache.address;
    }
    const w = getKastleProvider();
    let account = null as any;
    if (typeof w.getAccount === "function") {
      account = await withTimeout(Promise.resolve(w.getAccount()), walletCallTimeoutMs, "kastle_get_account_for_raw_tx");
    } else if (typeof w.request === "function") {
      account = await withTimeout(
        Promise.resolve(w.request("kas:get_account")),
        walletCallTimeoutMs,
        "kastle_request_get_account_for_raw_tx"
      );
    } else {
      throw new Error("Kastle provider missing getAccount()/request()");
    }
    const normalized = normalizeKaspaAddress(
      String(account?.address || account?.addresses?.[0] || ""),
      allKaspaAddressPrefixes
    );
    kastleAccountCache = { address: normalized, ts: Date.now() };
    return normalized;
  }

  function setKastleAccountCacheAddress(address: string) {
    kastleAccountCache = { address, ts: Date.now() };
  }

  function getKastleCachedAccountAddress() {
    return kastleAccountCache.address;
  }

  async function buildKastleRawTxJsonViaBackend(outputs: Output[], purpose?: string, fromAddressHint?: string) {
    if (!kastleTxBuilderUrl) return "";
    if (typeof fetch !== "function") throw new Error("Kastle tx builder requires fetch()");
    const hinted = String(fromAddressHint || "").trim();
    const fromAddress = hinted
      ? normalizeKaspaAddress(hinted, allKaspaAddressPrefixes)
      : await getKastleAccountAddress();
    const networkId = kastleNetworkIdForCurrentProfile();

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), kastleTxBuilderTimeoutMs) : null;
    try {
      const res = await fetch(kastleTxBuilderUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(kastleTxBuilderToken ? { Authorization: `Bearer ${kastleTxBuilderToken}` } : {}),
        },
        body: JSON.stringify({
          wallet: "kastle",
          networkId,
          fromAddress,
          outputs: normalizeOutputList(outputs).map((o) => ({
            address: o.to,
            amountKas: Number(o.amount_kas),
          })),
          purpose: String(purpose || "").slice(0, 140),
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`kastle_tx_builder_${res.status}:${String(text || "").slice(0, 180)}`);
      const payload = text ? JSON.parse(text) : {};
      const txJson = typeof payload === "string" ? payload.trim() : String(payload?.txJson || payload?.result?.txJson || "").trim();
      if (!txJson) throw new Error("Kastle tx builder did not return txJson");
      return txJson;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function buildKastleRawTxJson(outputs: Output[], purpose?: string, fromAddressHint?: string) {
    const normalizedOutputs = normalizeOutputList(outputs);
    if (!normalizedOutputs.length) throw new Error("Kastle raw tx requires outputs");
    let backendError: any = null;

    if (kastleTxBuilderUrl) {
      try {
        const txJson = await buildKastleRawTxJsonViaBackend(normalizedOutputs, purpose, fromAddressHint);
        if (txJson) return txJson;
      } catch (e: any) {
        backendError = e;
        if (kastleTxBuilderStrict) throw e;
      }
    }

    const bridge = getKastleRawTxJsonBuilderBridge();
    if (bridge) {
      const txJson = await bridge({
        networkId: kastleNetworkIdForCurrentProfile(),
        outputs: normalizedOutputs,
        purpose: String(purpose || "").slice(0, 140),
      });
      if (typeof txJson !== "string" || !txJson.trim()) {
        throw new Error("Kastle raw tx builder bridge returned an empty txJson");
      }
      return txJson.trim();
    }

    if (!kastleRawTxManualJsonPromptEnabled || typeof window === "undefined" || typeof window.prompt !== "function") {
      const suffix = backendError ? ` Backend builder error: ${String(backendError?.message || backendError).slice(0, 180)}` : "";
      throw new Error(
        `Kastle raw tx builder unavailable. Provide VITE_KASTLE_TX_BUILDER_URL, window.__FORGEOS_KASTLE_BUILD_TX_JSON__, or enable manual txJson prompt.${suffix}`
      );
    }

    const promptBody = [
      "KASTLE raw multi-output txJson required",
      "",
      "Forge.OS can call kastle.signAndBroadcastTx(networkId, txJson), but no automatic txJson builder is currently available in this runtime.",
      ...(backendError ? [`Builder error: ${String(backendError?.message || backendError).slice(0, 180)}`, ""] : []),
      "Paste a prebuilt txJson (serializeToSafeJSON) matching the outputs below.",
      "",
      `Network: ${kastleNetworkIdForCurrentProfile()}`,
      `Purpose: ${String(purpose || "").slice(0, 120) || "Forge.OS multi-output"}`,
      "Outputs:",
      ...normalizedOutputs.map((o, i) => `  ${i + 1}. ${o.to}  ${Number(o.amount_kas).toFixed(8)} KAS`),
    ].join("\n");
    const txJson = window.prompt(promptBody) || "";
    if (!txJson.trim()) throw new Error("Kastle raw tx cancelled: no txJson provided");
    return txJson.trim();
  }

  return {
    getKastleAccountAddress,
    setKastleAccountCacheAddress,
    getKastleCachedAccountAddress,
    buildKastleRawTxJson,
  };
}

