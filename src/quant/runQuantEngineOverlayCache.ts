import { clamp, round, toFinite } from "./math";

export type CachedOverlayDecision = {
  ts: number;
  signature: string;
  decision: any;
};

function cloneDecisionForCache(decision: any) {
  return {
    ...(decision || {}),
    risk_factors: Array.isArray(decision?.risk_factors) ? [...decision.risk_factors] : [],
    quant_metrics:
      decision?.quant_metrics && typeof decision.quant_metrics === "object"
        ? { ...decision.quant_metrics }
        : undefined,
  };
}

export function createOverlayDecisionCache(maxEntries: number) {
  const cache = new Map<string, CachedOverlayDecision>();
  return {
    get(cacheKey: string) {
      return cache.get(cacheKey) || null;
    },
    set(cacheKey: string, signature: string, decision: any) {
      cache.set(cacheKey, {
        ts: Date.now(),
        signature,
        decision: cloneDecisionForCache(decision),
      });

      while (cache.size > maxEntries) {
        const oldestKey = cache.keys().next().value;
        if (!oldestKey) break;
        cache.delete(oldestKey);
      }
    },
  };
}

export function agentOverlayCacheKey(agent: any, kasData?: any, regime?: string) {
  const agentId = String(agent?.agentId || agent?.name || "default").trim().toLowerCase();
  const risk = String(agent?.risk || "medium").trim().toLowerCase();
  const strategyTemplate = String(agent?.strategyTemplate || agent?.strategyLabel || "custom").trim().toLowerCase();
  const execMode = String(agent?.execMode || agent?.mode || "default").trim().toLowerCase();
  const cap = round(Math.max(0, toFinite(agent?.capitalLimit, 0)), 6);
  const kpi = round(Math.max(0, toFinite(agent?.kpiTarget, 0)), 4);
  const horizon = Math.max(0, Math.round(toFinite(agent?.horizon, 0)));
  const autoApprove = round(Math.max(0, toFinite(agent?.autoApproveThreshold, 0)), 6);
  const address = String(kasData?.address || "").trim().toLowerCase();
  const network = String(kasData?.dag?.networkName || kasData?.dag?.network || "").trim().toLowerCase();
  // Regime-aware key: cache is invalidated when the market regime changes, ensuring
  // AI overlay decisions are always contextually fresh after a regime transition.
  const regimePart = String(regime || "").trim().toLowerCase() || "na";
  return [
    agentId,
    risk,
    `tpl:${strategyTemplate}`,
    `mode:${execMode}`,
    `${cap}`,
    `kpi:${kpi}`,
    `hz:${horizon}`,
    `aa:${autoApprove}`,
    `addr:${address}`,
    `net:${network}`,
    `rg:${regimePart}`,
  ].join("|");
}

export function decisionSignature(decision: any) {
  const qm = decision?.quant_metrics || {};
  const regime = String(qm.regime || "NA");
  const vol = String(decision?.volatility_estimate || "NA");
  const action = String(decision?.action || "HOLD");
  const confidenceBucket = Math.round(clamp(toFinite(decision?.confidence_score, 0) * 10, 0, 10));
  const riskBucket = Math.round(clamp(toFinite(decision?.risk_score, 1) * 10, 0, 10));
  const edgeBucket = Math.round(clamp(toFinite(qm.edge_score, 0) * 10, -20, 20));
  const kellyBucket = Math.round(clamp(toFinite(decision?.kelly_fraction, 0) * 100, 0, 100));
  const dataBucket = Math.round(clamp(toFinite(qm.data_quality_score, 0) * 10, 0, 10));
  const sampleBucket = Math.round(clamp(toFinite(qm.sample_count, 0), 0, 999));
  return [
    regime,
    vol,
    action,
    `c${confidenceBucket}`,
    `r${riskBucket}`,
    `e${edgeBucket}`,
    `k${kellyBucket}`,
    `d${dataBucket}`,
    `s${sampleBucket}`,
  ].join("|");
}
