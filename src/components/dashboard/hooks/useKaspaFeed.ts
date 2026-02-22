import { useCallback, useEffect, useRef, useState } from "react";
import { kasBalance, kasNetworkInfo, kasPrice } from "../../../api/kaspaApi";

type UseKaspaFeedParams = {
  walletAddress?: string;
  wsUrl?: string;
  livePollMs?: number;
  streamReconnectMaxDelayMs?: number;
  maxMarketSnapshots?: number;
};

export function useKaspaFeed(params: UseKaspaFeedParams) {
  const walletAddress = params.walletAddress;
  const wsUrl = params.wsUrl || "";
  const livePollMs = Math.max(1000, Number(params.livePollMs || 5000));
  const streamReconnectMaxDelayMs = Math.max(2000, Number(params.streamReconnectMaxDelayMs || 12000));
  const maxMarketSnapshots = Math.max(32, Number(params.maxMarketSnapshots || 240));

  const kasRefreshLockRef = useRef(false);
  const [kasData, setKasData] = useState(null as any);
  const [marketHistory, setMarketHistory] = useState([] as any[]);
  const [kasDataLoading, setKasDataLoading] = useState(true);
  const [kasDataError, setKasDataError] = useState(null as any);
  const [liveConnected, setLiveConnected] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamRetryCount, setStreamRetryCount] = useState(0);

  const refreshKasData = useCallback(async () => {
    if (!walletAddress) return;
    if (kasRefreshLockRef.current) return;
    kasRefreshLockRef.current = true;
    setKasDataLoading(true);
    setKasDataError(null);
    try {
      const [dag, bal, price] = await Promise.all([
        kasNetworkInfo(),
        kasBalance(walletAddress),
        kasPrice().catch(() => null),
      ]);
      const fetched = Date.now();
      const nextKasData = {
        dag,
        priceUsd: Number(price || 0),
        walletKas: Number(bal.kas || 0),
        address: walletAddress,
        fetched,
      };
      setKasData(nextKasData);
      setMarketHistory((prev: any[]) => {
        const lastSnapshot = prev[prev.length - 1];
        const nextSnapshot = {
          ts: fetched,
          priceUsd: Number(nextKasData.priceUsd || 0),
          daaScore: Number(nextKasData?.dag?.daaScore || 0),
          walletKas: Number(nextKasData.walletKas || 0),
        };

        const sameState =
          lastSnapshot &&
          lastSnapshot.priceUsd === nextSnapshot.priceUsd &&
          lastSnapshot.daaScore === nextSnapshot.daaScore &&
          lastSnapshot.walletKas === nextSnapshot.walletKas;

        if (sameState) return prev;
        return [...prev, nextSnapshot].slice(-maxMarketSnapshots);
      });
      setLiveConnected(true);
    } catch (e: any) {
      setLiveConnected(false);
      setKasDataError(e?.message || "Kaspa live feed disconnected");
    } finally {
      setKasDataLoading(false);
      kasRefreshLockRef.current = false;
    }
  }, [maxMarketSnapshots, walletAddress]);

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

      ws.onmessage = () => {
        if (wsRefreshTimer) return;
        wsRefreshTimer = setTimeout(() => {
          wsRefreshTimer = null;
          refreshKasData();
        }, 1200);
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
    refreshKasData,
  };
}
