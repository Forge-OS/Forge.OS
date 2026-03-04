import { useState, useEffect, useCallback } from "react";
import { C, mono } from "../../tokens";
import { Badge, Btn, Card, Inp, Label } from "../ui";
import { KAS_API, KAS_WS_URL, NETWORK_LABEL, DEFAULT_NETWORK, ENFORCE_WALLET_NETWORK, ALLOWED_ADDRESS_PREFIXES, EXPLORER, KAS_API_FALLBACKS } from "../../constants";
import {
  loadNetworkConfig,
  saveNetworkConfig,
  clearNetworkConfig,
  testEndpoint,
  type NetworkConfig,
} from "../../network/networkConfig";
import { kasBlockdagInfo, kasNodeStatus, type KasNodeStatus } from "../../api/kaspaApi";

interface Props {
  kasData: any;
  liveConnected: boolean;
  streamConnected: boolean;
  streamRetryCount: number;
  streamHeartbeatLabel: string;
  lastStreamKindLabel: string;
  kasDataLoading: boolean;
  kasDataError: string | null;
  refreshKasData: () => void;
  alertConfig: any;
  patchAlertConfig: (patch: any) => void;
  saveAlertConfig: () => void;
  alertSaveBusy: boolean;
  isTablet: boolean;
  walletNetworkMismatch: boolean;
}

interface NetInfo {
  daaScore?: number;
  networkHashrate?: number;
  difficulty?: number;
  blockCount?: number;
  headerCount?: number;
  networkName?: string;
  pruningPointHash?: string;
}

interface TestResult {
  ok: boolean;
  latencyMs: number;
  daaScore?: number;
  networkName?: string;
  error?: string;
}

type NodeTelemetry = KasNodeStatus;

const LIVE_POLL_MS = 30_000;

export function NetworkPanel({
  kasData,
  liveConnected,
  streamConnected,
  streamRetryCount,
  streamHeartbeatLabel,
  lastStreamKindLabel,
  kasDataLoading,
  kasDataError,
  refreshKasData,
  alertConfig,
  patchAlertConfig,
  saveAlertConfig,
  alertSaveBusy,
  isTablet,
  walletNetworkMismatch,
}: Props) {
  const cfg = loadNetworkConfig();
  const hasCustom = Boolean(cfg.customApiUrl);

  // ── Endpoint config form state
  const [customApiUrl, setCustomApiUrl] = useState(cfg.customApiUrl);
  const [customWsUrl, setCustomWsUrl] = useState(cfg.customWsUrl);
  const [customLabel, setCustomLabel] = useState(cfg.label);

  // ── Test state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // ── Live network info (full /info/blockdag snapshot)
  const [netInfo, setNetInfo] = useState<NetInfo | null>(null);
  const [netInfoLoading, setNetInfoLoading] = useState(false);
  const [nodeTelemetry, setNodeTelemetry] = useState<NodeTelemetry | null>(null);

  const fetchNetInfo = useCallback(async () => {
    setNetInfoLoading(true);
    try {
      const [info, nodeStatus] = await Promise.all([
        kasBlockdagInfo(),
        kasNodeStatus().catch(() => ({ isSynced: null, isUtxoIndexed: null, source: "unknown" as const })),
      ]);
      setNetInfo(info ?? null);
      setNodeTelemetry(nodeStatus);
    } catch {
      setNetInfo(null);
      setNodeTelemetry(null);
    } finally {
      setNetInfoLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNetInfo();
    const id = setInterval(fetchNetInfo, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [fetchNetInfo]);

  // ── Actions
  async function handleTest() {
    const url = customApiUrl.trim();
    if (!url) return;
    setTesting(true);
    setTestResult(null);
    const result = await testEndpoint(url);
    setTestResult(result);
    setTesting(false);
  }

  function handleSave() {
    saveNetworkConfig({
      customApiUrl: customApiUrl.trim(),
      customWsUrl: customWsUrl.trim(),
      label: customLabel.trim(),
    });
    window.location.reload();
  }

  function handleReset() {
    clearNetworkConfig();
    setCustomApiUrl("");
    setCustomWsUrl("");
    setCustomLabel("");
    setTestResult(null);
    window.location.reload();
  }

  // ── Derived stats
  const price = Number(kasData?.priceUsd || 0);
  const daaScore = Number(kasData?.dag?.daaScore || netInfo?.daaScore || 0);
  const hashrate = Number(netInfo?.networkHashrate || 0);
  const blockCount = Number(netInfo?.blockCount || 0);
  const hashrateEH = hashrate > 0 ? (hashrate / 1e18).toFixed(2) : null;
  const hashrateText = hashrateEH ? `${hashrateEH} EH/s` : "—";
  const nodeSyncText = nodeTelemetry?.isSynced == null ? "UNKNOWN" : (nodeTelemetry.isSynced ? "SYNCED" : "SYNCING");
  const nodeSyncColor = nodeTelemetry?.isSynced == null ? C.dim : (nodeTelemetry.isSynced ? C.ok : C.warn);
  const nodeIndexText = nodeTelemetry?.isUtxoIndexed == null ? "UNKNOWN" : (nodeTelemetry.isUtxoIndexed ? "READY" : "INDEXING");
  const nodeIndexColor = nodeTelemetry?.isUtxoIndexed == null ? C.dim : (nodeTelemetry.isUtxoIndexed ? C.ok : C.warn);

  const cols = isTablet ? "1fr" : "1fr 1fr";

  function statCell(label: string, value: string, color?: string) {
    return (
      <div style={{ background: C.s2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
        <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 15, color: color || C.text, fontWeight: 700, ...mono }}>{value}</div>
      </div>
    );
  }

  function row(label: string, value: React.ReactNode, last = false) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: last ? "none" : `1px solid ${C.border}`, paddingBottom: last ? 0 : 6, marginBottom: last ? 0 : 4 }}>
        <span style={{ fontSize: 11, color: C.dim, ...mono }}>{label}</span>
        <span style={{ fontSize: 11, color: C.text, fontWeight: 700, ...mono }}>{value}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, gap: 14 }}>

      {/* ── LIVE KASPA STATS ────────────────────────────────────────────── */}
      <Card p={18} style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <Label>Live Kaspa Network</Label>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
              {NETWORK_LABEL.toUpperCase()} · {DEFAULT_NETWORK}
              {hasCustom && <span style={{ color: C.accent, marginLeft: 8 }}>· CUSTOM ENDPOINT</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: liveConnected ? C.ok : C.danger,
              boxShadow: liveConnected ? `0 0 6px ${C.ok}` : undefined,
            }} />
            <span style={{ fontSize: 11, color: liveConnected ? C.ok : C.danger, fontWeight: 700, ...mono }}>
              {liveConnected ? "LIVE" : "OFFLINE"}
            </span>
            <Btn size="sm" variant="ghost" onClick={fetchNetInfo} disabled={netInfoLoading}>
              {netInfoLoading ? "..." : "↻"}
            </Btn>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isTablet ? "1fr 1fr" : "repeat(6, 1fr)", gap: 10 }}>
          {statCell("KAS PRICE", price > 0 ? `$${price.toFixed(4)}` : "—", price > 0 ? C.text : C.dim)}
          {statCell("DAA SCORE", daaScore > 0 ? daaScore.toLocaleString() : "—")}
          {statCell("HASHRATE", hashrateText)}
          {statCell("NETWORK", netInfo?.networkName || NETWORK_LABEL.toUpperCase())}
          {statCell("NODE SYNC", nodeSyncText, nodeSyncColor)}
          {statCell("UTXO INDEX", nodeIndexText, nodeIndexColor)}
        </div>

        {blockCount > 0 && (
          <div style={{ marginTop: 10, fontSize: 11, color: C.dim, ...mono }}>
            Block count: {blockCount.toLocaleString()}
            {netInfo?.difficulty ? ` · Difficulty: ${Number(netInfo.difficulty).toExponential(2)}` : ""}
          </div>
        )}
      </Card>

      {/* ── CUSTOM ENDPOINT CONFIGURATION ──────────────────────────────── */}
      <Card p={18} style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <Label>RPC Endpoint Configuration</Label>
          <Badge
            text={hasCustom ? `CUSTOM${cfg.label ? ` · ${cfg.label}` : ""}` : "ENV DEFAULT"}
            color={hasCustom ? C.accent : C.dim}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, marginBottom: 10 }}>
          <div>
            <Inp
              label="Custom REST API URL"
              value={customApiUrl}
              onChange={setCustomApiUrl}
              placeholder={KAS_API ? "Override env default" : "e.g. https://api.kaspa.org"}
            />
          </div>
          <div>
            <Inp
              label="Custom WebSocket URL (optional)"
              value={customWsUrl}
              onChange={setCustomWsUrl}
              placeholder={KAS_WS_URL || "e.g. wss://api.kaspa.org/ws"}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <Inp
            label="Label (optional, e.g. Local Node)"
            value={customLabel}
            onChange={setCustomLabel}
            placeholder="My Kaspa Node"
          />
        </div>

        {/* Test result */}
        {testResult && (
          <div style={{
            padding: "8px 12px",
            borderRadius: 6,
            marginBottom: 12,
            background: testResult.ok ? `${C.ok}15` : `${C.danger}15`,
            border: `1px solid ${testResult.ok ? C.ok : C.danger}40`,
            fontSize: 12,
            color: testResult.ok ? C.ok : C.danger,
            ...mono,
          }}>
            {testResult.ok
              ? `✓ Connected · ${testResult.latencyMs}ms · DAA ${testResult.daaScore?.toLocaleString() || "—"} · ${testResult.networkName || "kaspa"}`
              : `✗ Failed (${testResult.latencyMs}ms) — ${testResult.error}`}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn
            size="sm"
            variant="ghost"
            onClick={handleTest}
            disabled={testing || !customApiUrl.trim()}
          >
            {testing ? "TESTING..." : "TEST CONNECTION"}
          </Btn>
          <Btn
            size="sm"
            variant="primary"
            onClick={handleSave}
            disabled={!customApiUrl.trim() && !customWsUrl.trim()}
          >
            SAVE & APPLY
          </Btn>
          {hasCustom && (
            <Btn size="sm" variant="ghost" onClick={handleReset}>
              RESET TO ENV DEFAULT
            </Btn>
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
          Changes take effect immediately — no rebuild needed. Leave blank to use env defaults ({KAS_API ? "configured" : "not set"}).
          {KAS_API_FALLBACKS.length > 0 && ` ${KAS_API_FALLBACKS.length} fallback endpoint${KAS_API_FALLBACKS.length > 1 ? "s" : ""} configured.`}
        </div>
      </Card>

      {/* ── FEED HEALTH ─────────────────────────────────────────────────── */}
      <Card p={18}>
        <Label>Live Feed Health</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {row("REST Polling",
            <span style={{ color: liveConnected ? C.ok : C.warn }}>
              {liveConnected ? "LIVE" : "DEGRADED"}
            </span>
          )}
          {row("WebSocket Stream",
            <span style={{ color: streamConnected ? C.ok : KAS_WS_URL ? C.warn : C.dim }}>
              {KAS_WS_URL ? (streamConnected ? "CONNECTED" : `RETRYING (${streamRetryCount})`) : "DISABLED"}
            </span>
          )}
          {row("Heartbeat Age",
            <span style={{ color: streamConnected ? C.ok : C.warn }}>{streamHeartbeatLabel}</span>
          )}
          {row("Last Event", lastStreamKindLabel)}
          {row("DAA Score", daaScore > 0 ? daaScore.toLocaleString() : "—")}
          {row("Node Sync", <span style={{ color: nodeSyncColor }}>{nodeSyncText}</span>)}
          {row("UTXO Index", <span style={{ color: nodeIndexColor }}>{nodeIndexText}</span>)}
          {row("Wallet KAS", Number(kasData?.walletKas || 0) > 0
            ? `${Number(kasData.walletKas).toFixed(4)} KAS`
            : "—", true
          )}
        </div>
        {kasDataError && (
          <div style={{ fontSize: 11, color: C.danger, lineHeight: 1.4, marginTop: 8, ...mono }}>
            {String(kasDataError)}
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <Btn onClick={refreshKasData} size="sm" variant="ghost" disabled={kasDataLoading}>
            {kasDataLoading ? "SYNCING..." : "REFRESH FEED"}
          </Btn>
        </div>
      </Card>

      {/* ── NETWORK GUARDRAILS ──────────────────────────────────────────── */}
      <Card p={18}>
        <Label>Network Guardrails</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {row("Active Network", NETWORK_LABEL.toUpperCase())}
          {row("Wallet Enforcement",
            <span style={{ color: ENFORCE_WALLET_NETWORK ? C.ok : C.warn }}>
              {ENFORCE_WALLET_NETWORK ? "ON" : "OFF"}
            </span>
          )}
          {row("Network Mismatch",
            <span style={{ color: walletNetworkMismatch ? C.danger : C.ok }}>
              {walletNetworkMismatch ? "MISMATCH" : "CLEAR"}
            </span>
          )}
          {row("Accepted Prefixes", ALLOWED_ADDRESS_PREFIXES.join(", "))}
          {row("Explorer",
            <a href={EXPLORER} target="_blank" rel="noreferrer" style={{ color: C.accent, ...mono }}>
              open ↗
            </a>, true
          )}
        </div>
      </Card>

      {/* ── ALERT THRESHOLDS ────────────────────────────────────────────── */}
      <Card p={18} style={{ gridColumn: "1 / -1" }}>
        <Label>Alert Thresholds</Label>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, marginTop: 10 }}>
          <Inp
            label="Queue Pending Alert Threshold"
            value={String(alertConfig?.queuePendingThreshold ?? 3)}
            onChange={(v: string) =>
              patchAlertConfig({ queuePendingThreshold: Math.max(1, Math.round(Number(v) || 3)) })
            }
            type="number"
          />
          <Inp
            label="Low Balance Alert"
            value={String(alertConfig?.lowBalanceThreshold ?? 100)}
            onChange={(v: string) =>
              patchAlertConfig({ lowBalanceThreshold: Math.max(1, Number(v) || 100) })
            }
            type="number"
            suffix="KAS"
          />
        </div>
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <Btn size="sm" onClick={saveAlertConfig} disabled={alertSaveBusy}>
            {alertSaveBusy ? "SAVING..." : "SAVE THRESHOLDS"}
          </Btn>
        </div>
      </Card>

    </div>
  );
}
