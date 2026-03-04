import { useCallback, useEffect, useRef, useState } from "react";
import { kasBalance, kasNetworkInfo, kasNodeStatus, kasPrice } from "../../../api/kaspaApi";

type UseKaspaFeedParams = {
  walletAddress?: string;
  wsUrl?: string;
  livePollMs?: number;
  streamReconnectMaxDelayMs?: number;
  maxMarketSnapshots?: number;
};

export type KaspaStreamEvent = {
  kind: "daa" | "utxo" | "unknown";
  ts: number;
  daaScore?: number;
  affectsWallet: boolean;
  source: string;
};

function normalizeMaybeAddress(value: any) {
  const out = String(value || "").trim().toLowerCase();
  return out.includes(":") ? out : "";
}

function collectStringValues(input: any, out: string[], depth = 0) {
  if (depth > 4 || input == null) return;
  if (typeof input === "string") {
    out.push(input.toLowerCase());
    return;
  }
  if (Array.isArray(input)) {
    for (const row of input.slice(0, 24)) collectStringValues(row, out, depth + 1);
    return;
  }
  if (typeof input === "object") {
    for (const [k, v] of Object.entries(input)) {
      if (typeof k === "string") out.push(k.toLowerCase());
      collectStringValues(v, out, depth + 1);
    }
  }
}

function readNumeric(...candidates: any[]) {
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return NaN;
}

function parseRawPayload(raw: any) {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return { type: "raw", payload: trimmed };
    }
  }
  if (raw instanceof ArrayBuffer) {
    const text = new TextDecoder().decode(raw).trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { type: "raw", payload: text };
    }
  }
  if (typeof raw === "object" && raw != null) return raw;
  return null;
}

export function parseKaspaStreamEvent(raw: any, walletAddress?: string): KaspaStreamEvent {
  const ts = Date.now();
  const payload = parseRawPayload(raw);
  if (!payload) {
    return { kind: "unknown", ts, affectsWallet: false, source: "empty" };
  }

  const names: string[] = [];
  collectStringValues({
    type: (payload as any)?.type,
    event: (payload as any)?.event,
    eventType: (payload as any)?.eventType,
    topic: (payload as any)?.topic,
    method: (payload as any)?.method,
    name: (payload as any)?.name,
  }, names);
  const source = names.slice(0, 4).join("|") || "message";

  const daaScore = readNumeric(
    (payload as any)?.virtualDaaScore,
    (payload as any)?.daaScore,
    (payload as any)?.blockdag?.daaScore,
    (payload as any)?.data?.virtualDaaScore,
    (payload as any)?.data?.daaScore,
    (payload as any)?.params?.result?.virtualDaaScore,
    (payload as any)?.params?.result?.daaScore,
    (payload as any)?.payload?.virtualDaaScore,
    (payload as any)?.payload?.daaScore,
  );
  if (Number.isFinite(daaScore)) {
    return {
      kind: "daa",
      ts,
      daaScore: Math.round(daaScore),
      affectsWallet: false,
      source,
    };
  }

  const haystack: string[] = [];
  collectStringValues(payload, haystack);
  const eventText = haystack.join(" ");
  const walletLower = normalizeMaybeAddress(walletAddress);
  const utxoLike =
    /\butxo\b/.test(eventText) ||
    /\butxos-changed\b/.test(eventText) ||
    /\badded\b/.test(eventText) ||
    /\bremoved\b/.test(eventText);
  if (utxoLike) {
    const affectsWallet = walletLower ? eventText.includes(walletLower) : true;
    return {
      kind: "utxo",
      ts,
      affectsWallet,
      source,
    };
  }

  return { kind: "unknown", ts, affectsWallet: false, source };
}

export function useKaspaFeed(params: UseKaspaFeedParams) {
  const walletAddress = params.walletAddress;
  const wsUrl = params.wsUrl || "";
  const livePollMs = Math.max(1000, Number(params.livePollMs || 5000));
  const streamReconnectMaxDelayMs = Math.max(2000, Number(params.streamReconnectMaxDelayMs || 12000));
  const maxMarketSnapshots = Math.max(32, Number(params.maxMarketSnapshots || 240));

  const kasRefreshLockRef = useRef(false);
  const kasDataRef = useRef<any>(null);
  const [kasData, setKasData] = useState(null as any);
  const [marketHistory, setMarketHistory] = useState([] as any[]);
  const [kasDataLoading, setKasDataLoading] = useState(true);
  const [kasDataError, setKasDataError] = useState(null as any);
  const [liveConnected, setLiveConnected] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamRetryCount, setStreamRetryCount] = useState(0);
  const [streamPulse, setStreamPulse] = useState(0);
  const [lastStreamEvent, setLastStreamEvent] = useState<KaspaStreamEvent | null>(null);

  useEffect(() => {
    kasDataRef.current = kasData;
  }, [kasData]);

  const appendMarketSnapshot = useCallback((snapshot: any) => {
    setMarketHistory((prev: any[]) => {
      const lastSnapshot = prev[prev.length - 1];
      const nextSnapshot = {
        ts: Number(snapshot?.ts || Date.now()),
        priceUsd: Number(snapshot?.priceUsd || 0),
        daaScore: Number(snapshot?.daaScore || 0),
        walletKas: Number(snapshot?.walletKas || 0),
      };

      const sameState =
        lastSnapshot &&
        lastSnapshot.priceUsd === nextSnapshot.priceUsd &&
        lastSnapshot.daaScore === nextSnapshot.daaScore &&
        lastSnapshot.walletKas === nextSnapshot.walletKas;
      if (sameState) return prev;
      return [...prev, nextSnapshot].slice(-maxMarketSnapshots);
    });
  }, [maxMarketSnapshots]);

  const refreshKasData = useCallback(async () => {
    if (!walletAddress) return;
    if (kasRefreshLockRef.current) return;
    kasRefreshLockRef.current = true;
    setKasDataLoading(true);
    setKasDataError(null);
    try {
      const [dag, bal, price, nodeStatus] = await Promise.all([
        kasNetworkInfo(),
        kasBalance(walletAddress),
        kasPrice().catch(() => null),
        kasNodeStatus().catch(() => ({ isSynced: null, isUtxoIndexed: null, source: "unknown" as const })),
      ]);
      const fetched = Date.now();
      const nextKasData = {
        dag,
        nodeStatus,
        priceUsd: Number(price || 0),
        walletKas: Number(bal.kas || 0),
        address: walletAddress,
        fetched,
      };
      setKasData(nextKasData);
      appendMarketSnapshot({
        ts: fetched,
        priceUsd: nextKasData.priceUsd,
        daaScore: nextKasData?.dag?.daaScore,
        walletKas: nextKasData.walletKas,
      });
      setLiveConnected(true);
    } catch (e: any) {
      setLiveConnected(false);
      setKasDataError(e?.message || "Kaspa live feed disconnected");
    } finally {
      setKasDataLoading(false);
      kasRefreshLockRef.current = false;
    }
  }, [appendMarketSnapshot, walletAddress]);

  useEffect(() => {
    if (!walletAddress) return;
    refreshKasData();

    const id = setInterval(refreshKasData, livePollMs);

    let ws: WebSocket | null = null;
    let wsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByApp = false;
    let attempts = 0;

    const scheduleReconnect = () => {
      if (closedByApp || !wsUrl) return;
      const delay = Math.min(streamReconnectMaxDelayMs, 1200 * 2 ** attempts);
      attempts += 1;
      setStreamRetryCount(attempts);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectStream();
      }, delay);
    };

    const connectStream = () => {
      if (!wsUrl || closedByApp) return;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        attempts = 0;
        setStreamRetryCount(0);
        setStreamConnected(true);
      };

      ws.onmessage = (ev: MessageEvent) => {
        // Guard: only process non-empty string or binary messages
        if (!ev || (ev.data !== null && ev.data !== undefined && typeof ev.data !== "string" && !(ev.data instanceof ArrayBuffer) && !(ev.data instanceof Blob))) return;
        const streamEvent = parseKaspaStreamEvent(ev.data, walletAddress);
        setLastStreamEvent(streamEvent);
        if (streamEvent.kind !== "unknown") setStreamPulse(streamEvent.ts);

        if (streamEvent.kind === "daa" && Number.isFinite(streamEvent.daaScore)) {
          const currentKasData = kasDataRef.current;
          if (currentKasData) {
            const fetched = Date.now();
            const nextKasData = {
              ...currentKasData,
              fetched,
              dag: {
                ...(currentKasData?.dag || {}),
                daaScore: streamEvent.daaScore,
              },
            };
            setKasData(nextKasData);
            appendMarketSnapshot({
              ts: fetched,
              priceUsd: Number(nextKasData.priceUsd || 0),
              daaScore: Number(streamEvent.daaScore || 0),
              walletKas: Number(nextKasData.walletKas || 0),
            });
          }
        }

        // Debounce: cancel any pending refresh and restart the timer so the
        // refresh fires 300ms after the *last* event in a burst (not the first).
        // Under 10 BPS a burst of DAA ticks would otherwise schedule multiple
        // consecutive 250ms refreshes; debouncing collapses them into one.
        if (wsRefreshTimer) clearTimeout(wsRefreshTimer);
        const fastRefresh =
          (streamEvent.kind === "utxo" && streamEvent.affectsWallet) ||
          streamEvent.kind === "daa";
        const refreshDelayMs = fastRefresh ? 300 : 1400;
        wsRefreshTimer = setTimeout(() => {
          wsRefreshTimer = null;
          refreshKasData();
        }, refreshDelayMs);
      };

      ws.onerror = () => {
        if (!closedByApp) setStreamConnected(false);
      };

      ws.onclose = () => {
        setStreamConnected(false);
        if (!closedByApp) scheduleReconnect();
      };
    };

    if (wsUrl) connectStream();

    return () => {
      closedByApp = true;
      clearInterval(id);
      if (wsRefreshTimer) clearTimeout(wsRefreshTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [livePollMs, refreshKasData, streamReconnectMaxDelayMs, walletAddress, wsUrl]);

  return {
    kasData,
    setKasData,
    marketHistory,
    setMarketHistory,
    kasDataLoading,
    setKasDataLoading,
    kasDataError,
    setKasDataError,
    liveConnected,
    setLiveConnected,
    streamConnected,
    streamRetryCount,
    streamPulse,
    lastStreamEvent,
    refreshKasData,
  };
}
