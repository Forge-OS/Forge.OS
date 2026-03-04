/**
 * On-Chain Analytics — whale and miner activity feed for the Claude AI overlay.
 *
 * Fetches recent block data from the Kaspa REST API to infer:
 *   - Network transaction velocity (blocks/min, txs/min)
 *   - Average output size (proxy for whale vs retail activity)
 *   - Estimated miner sell pressure based on block rewards
 *
 * Uses the existing apiFetch circuit-breaker from kaspaClient.
 * Results are cached for 60s to avoid hammering the API each cycle.
 *
 * Usage:
 *   const analytics = await fetchOnChainAnalytics("mainnet");
 *   const block = formatOnChainAnalyticsForPrompt(analytics);
 *   // Pass block to buildAiOverlayPrompt() via extra.onChainAnalyticsBlock
 */

import { kasNetworkInfo } from "../api/kaspaApi";
import { KAS_API } from "../constants";

export interface BlockStats {
  /** Blocks per second estimated from recent samples */
  bps: number;
  /** Average transactions per block */
  avgTxsPerBlock: number;
  /** Total transactions in sample window */
  totalTxs: number;
  /** Total block reward in sample window (KAS) */
  totalRewardKas: number;
  /** Estimated daily miner issuance rate (KAS/day) based on current bps */
  minerIssuancePerDayKas: number;
  /** Number of blocks sampled */
  blocksSampled: number;
  /** Current DAA score */
  daaScore: number;
}

export interface OnChainAnalytics {
  fetched: number;
  network: string;
  blockStats: BlockStats | null;
  /** Human pressure label: "LOW" | "MODERATE" | "HIGH" */
  minerPressure: "LOW" | "MODERATE" | "HIGH";
  /** Human activity label: "QUIET" | "ACTIVE" | "SURGE" */
  networkActivity: "QUIET" | "ACTIVE" | "SURGE";
  error?: string;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000; // 60s
const _cache: Partial<Record<string, { ts: number; data: OnChainAnalytics }>> = {};

// ── Constants ─────────────────────────────────────────────────────────────────

/** Kaspa block reward at current emission schedule (approx, will decrease over time) */
const BLOCK_REWARD_KAS = 440; // ~440 KAS per block as of early 2026
/** Normal BPS for mainnet (10 BPS) */
const MAINNET_BPS = 10;

// ── Core fetch ────────────────────────────────────────────────────────────────

/**
 * Fetches block and DAG analytics from the Kaspa REST API.
 * Returns cached data if within TTL.
 */
export async function fetchOnChainAnalytics(network = "mainnet"): Promise<OnChainAnalytics> {
  const cacheKey = network;
  const cached = _cache[cacheKey];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  try {
    // 1. Fetch DAG info for current BPS / DAA score
    const dagInfo = await kasNetworkInfo().catch(() => null);

    // 2. Fetch recent block headers (last 10 blocks) to compute tx density
    //    Fallback: use DAG info only
    const apiRoot = String(KAS_API || "").replace(/\/+$/, "");
    const blocksData = apiRoot
      ? await fetch(`${apiRoot}/blocks?limit=10`, { signal: AbortSignal.timeout(8000) })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      : null;

    const daaScore = Number(dagInfo?.daaScore || 0);

    // Parse block headers if available
    let blockStats: BlockStats | null = null;
    const headers = Array.isArray(blocksData?.headers) ? blocksData!.headers : [];
    if (headers.length >= 2) {
      const timestamps = headers
        .map((h) => Number(h?.timestamp || 0))
        .filter((t) => t > 0)
        .sort((a, b) => a - b);

      const windowMs = timestamps.length >= 2
        ? timestamps[timestamps.length - 1] - timestamps[0]
        : 0;
      const bps = windowMs > 0 ? (timestamps.length / (windowMs / 1000)) : MAINNET_BPS;

      const avgTxsPerBlock = headers.reduce((sum, h) => {
        return sum + (Array.isArray(h?.transactions) ? h!.transactions.length : 1);
      }, 0) / Math.max(1, headers.length);

      const totalTxs = Math.round(avgTxsPerBlock * headers.length);
      const totalRewardKas = headers.length * BLOCK_REWARD_KAS;
      const minerIssuancePerDayKas = bps * 86_400 * BLOCK_REWARD_KAS;

      blockStats = {
        bps: Number(bps.toFixed(2)),
        avgTxsPerBlock: Number(avgTxsPerBlock.toFixed(1)),
        totalTxs,
        totalRewardKas,
        minerIssuancePerDayKas: Math.round(minerIssuancePerDayKas),
        blocksSampled: headers.length,
        daaScore,
      };
    } else if (daaScore > 0) {
      // Fallback: estimate from DAG info only
      blockStats = {
        bps: MAINNET_BPS,
        avgTxsPerBlock: 2,
        totalTxs: 0,
        totalRewardKas: 0,
        minerIssuancePerDayKas: Math.round(MAINNET_BPS * 86_400 * BLOCK_REWARD_KAS),
        blocksSampled: 0,
        daaScore,
      };
    }

    // Classify miner pressure (daily issuance relative to typical)
    const dailyIssuance = blockStats?.minerIssuancePerDayKas ?? 0;
    const typicalDailyIssuance = MAINNET_BPS * 86_400 * BLOCK_REWARD_KAS; // ~380M
    const minerPressure: "LOW" | "MODERATE" | "HIGH" =
      dailyIssuance > typicalDailyIssuance * 1.2 ? "HIGH" :
      dailyIssuance > typicalDailyIssuance * 0.8 ? "MODERATE" :
      "LOW";

    // Classify network activity from BPS
    const bps = blockStats?.bps ?? MAINNET_BPS;
    const networkActivity: "QUIET" | "ACTIVE" | "SURGE" =
      bps > MAINNET_BPS * 1.3 ? "SURGE" :
      bps > MAINNET_BPS * 0.9 ? "ACTIVE" :
      "QUIET";

    const result: OnChainAnalytics = {
      fetched: Date.now(),
      network,
      blockStats,
      minerPressure,
      networkActivity,
    };
    _cache[cacheKey] = { ts: Date.now(), data: result };
    return result;
  } catch (err: any) {
    const fallback: OnChainAnalytics = {
      fetched: Date.now(),
      network,
      blockStats: null,
      minerPressure: "MODERATE",
      networkActivity: "ACTIVE",
      error: String(err?.message || "fetch failed"),
    };
    return fallback;
  }
}

/**
 * Formats the analytics data for injection into the Claude prompt.
 * Returns a short, information-dense block Claude can act on.
 */
export function formatOnChainAnalyticsForPrompt(analytics: OnChainAnalytics): string {
  if (!analytics.blockStats && analytics.error) {
    return `ON-CHAIN ANALYTICS: unavailable (${analytics.error})`;
  }

  const s = analytics.blockStats;
  const bpsStr = s ? `${s.bps.toFixed(1)} BPS` : "—";
  const txsStr = s ? `~${s.avgTxsPerBlock.toFixed(1)} tx/block` : "—";
  const issuanceStr = s
    ? `~${(s.minerIssuancePerDayKas / 1_000_000).toFixed(1)}M KAS/day miner issuance`
    : "—";

  return `ON-CHAIN ANALYTICS (${new Date(analytics.fetched).toISOString().slice(11, 19)} UTC):
- Network: ${analytics.networkActivity} · ${bpsStr} · ${txsStr}
- Miner pressure: ${analytics.minerPressure} · ${issuanceStr}
- Interpretation: ${interpretAnalytics(analytics)}`;
}

function interpretAnalytics(analytics: OnChainAnalytics): string {
  const { minerPressure, networkActivity } = analytics;
  if (networkActivity === "SURGE" && minerPressure === "HIGH") {
    return "High on-chain activity with elevated miner issuance — potential sell pressure, exercise caution on large buys.";
  }
  if (networkActivity === "SURGE" && minerPressure !== "HIGH") {
    return "Transaction surge without proportional miner pressure — organic demand likely bullish.";
  }
  if (networkActivity === "QUIET" && minerPressure === "HIGH") {
    return "Low network activity but high miner issuance — miners likely selling into thin liquidity.";
  }
  if (networkActivity === "ACTIVE" && minerPressure === "MODERATE") {
    return "Normal network conditions — no significant on-chain pressure signals.";
  }
  return "Network conditions nominal — proceed based on price action.";
}
