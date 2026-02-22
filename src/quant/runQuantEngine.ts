import { buildQuantCoreDecision, type QuantContext } from "./quantCore";
import { clamp, round, toFinite } from "./math";

const env = import.meta.env;

const AI_API_URL = env.VITE_AI_API_URL || "https://api.anthropic.com/v1/messages";
const AI_MODEL = env.VITE_AI_MODEL || "claude-sonnet-4-20250514";
const ANTHROPIC_API_KEY = env.VITE_ANTHROPIC_API_KEY || "";
const AI_TIMEOUT_MS = Math.max(800, Number(env.VITE_AI_SOFT_TIMEOUT_MS || 2200));
const AI_FALLBACK_ENABLED = String(env.VITE_AI_FALLBACK_ENABLED || "true").toLowerCase() !== "false";
const AI_OVERLAY_MODE_RAW = String(env.VITE_AI_OVERLAY_MODE || "always").trim().toLowerCase();
const AI_OVERLAY_MODE = ["off", "always", "adaptive"].includes(AI_OVERLAY_MODE_RAW)
  ? (AI_OVERLAY_MODE_RAW as "off" | "always" | "adaptive")
  : "adaptive";
const AI_OVERLAY_MIN_INTERVAL_MS = Math.max(0, Number(env.VITE_AI_OVERLAY_MIN_INTERVAL_MS || 15000));
const AI_OVERLAY_CACHE_TTL_MS = Math.max(
  AI_OVERLAY_MIN_INTERVAL_MS,
  Number(env.VITE_AI_OVERLAY_CACHE_TTL_MS || 45000)
);
const AI_OVERLAY_CACHE_MAX_ENTRIES = 512;
const AI_TRANSPORT_READY = Boolean(AI_API_URL) && (!AI_API_URL.includes("api.anthropic.com") || Boolean(ANTHROPIC_API_KEY));
const AI_MAX_ATTEMPTS = Math.max(1, Math.min(3, Number(env.VITE_AI_MAX_ATTEMPTS || 2)));
const AI_RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

type CachedOverlayDecision = {
  ts: number;
  signature: string;
  decision: any;
};

const AI_OVERLAY_CACHE = new Map<string, CachedOverlayDecision>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function aiRetryDelayMs(attempt: number) {
  const jitter = Math.floor(Math.random() * 90);
  return 160 * (attempt + 1) + jitter;
}

function buildHeaders() {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // If using Anthropic directly from client, key+version headers are required.
  if (AI_API_URL.includes("api.anthropic.com")) {
    if (!ANTHROPIC_API_KEY) {
      throw new Error(
        "Anthropic API key missing. Set VITE_ANTHROPIC_API_KEY or configure VITE_AI_API_URL to your secure backend endpoint."
      );
    }
    headers["x-api-key"] = ANTHROPIC_API_KEY;
    headers["anthropic-version"] = "2023-06-01";
  }

  return headers;
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("AI response was not valid JSON");
  }
}

function sanitizeQuantMetrics(raw: any) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key) continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      out[key] = Math.abs(value) >= 1000 ? Math.round(value) : round(value, 6);
      continue;
    }
    if (typeof value === "string") {
      out[key] = value.slice(0, 80);
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeDecision(raw: any, agent: any) {
  const actionRaw = String(raw?.action || "HOLD").toUpperCase();
  const action = ["ACCUMULATE", "REDUCE", "HOLD", "REBALANCE"].includes(actionRaw) ? actionRaw : "HOLD";

  const capitalLimit = Math.max(0, toFinite(agent?.capitalLimit, 0));
  const allocation = clamp(toFinite(raw?.capital_allocation_kas, 0), 0, capitalLimit);
  const allocationPct =
    capitalLimit > 0
      ? clamp((allocation / capitalLimit) * 100, 0, 100)
      : clamp(toFinite(raw?.capital_allocation_pct, 0), 0, 100);

  const confidence = clamp(toFinite(raw?.confidence_score, 0), 0, 1);
  const risk = clamp(toFinite(raw?.risk_score, 1), 0, 1);

  const volatilityRaw = String(raw?.volatility_estimate || "MEDIUM").toUpperCase();
  const volatility = ["LOW", "MEDIUM", "HIGH"].includes(volatilityRaw) ? volatilityRaw : "MEDIUM";

  const liquidityRaw = String(raw?.liquidity_impact || "MODERATE").toUpperCase();
  const liquidity = ["MINIMAL", "MODERATE", "SIGNIFICANT"].includes(liquidityRaw) ? liquidityRaw : "MODERATE";

  const phaseRaw = String(raw?.strategy_phase || "HOLDING").toUpperCase();
  const phase = ["ENTRY", "SCALING", "HOLDING", "EXIT"].includes(phaseRaw) ? phaseRaw : "HOLDING";

  const riskFactors = Array.isArray(raw?.risk_factors)
    ? raw.risk_factors.map((v: any) => String(v)).filter(Boolean).slice(0, 6)
    : [];

  const decisionSourceRaw = String(raw?.decision_source || "ai").toLowerCase();
  const decisionSource = ["ai", "fallback", "quant-core", "hybrid-ai"].includes(decisionSourceRaw)
    ? decisionSourceRaw
    : "ai";
  const decisionSourceDetail = String(raw?.decision_source_detail || "").slice(0, 220);
  const quantMetrics = sanitizeQuantMetrics(raw?.quant_metrics);
  const engineLatencyMs = Math.max(0, Math.round(toFinite(raw?.engine_latency_ms, 0)));

  return {
    action,
    confidence_score: round(confidence, 4),
    risk_score: round(risk, 4),
    kelly_fraction: clamp(toFinite(raw?.kelly_fraction, 0), 0, 1),
    capital_allocation_kas: Number(allocation.toFixed(6)),
    capital_allocation_pct: Number(allocationPct.toFixed(2)),
    expected_value_pct: Number(toFinite(raw?.expected_value_pct, 0).toFixed(2)),
    stop_loss_pct: Number(Math.max(0, toFinite(raw?.stop_loss_pct, 0)).toFixed(2)),
    take_profit_pct: Number(Math.max(0, toFinite(raw?.take_profit_pct, 0)).toFixed(2)),
    monte_carlo_win_pct: Number(clamp(toFinite(raw?.monte_carlo_win_pct, 0), 0, 100).toFixed(2)),
    volatility_estimate: volatility,
    liquidity_impact: liquidity,
    strategy_phase: phase,
    rationale: String(raw?.rationale || "No rationale returned by engine."),
    risk_factors: riskFactors,
    next_review_trigger: String(raw?.next_review_trigger || "On next cycle or major DAA/price movement."),
    decision_source: decisionSource,
    decision_source_detail: decisionSourceDetail,
    quant_metrics: quantMetrics,
    engine_latency_ms: engineLatencyMs,
  };
}

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

function agentOverlayCacheKey(agent: any, kasData?: any) {
  const agentId = String(agent?.agentId || agent?.name || "default").trim().toLowerCase();
  const risk = String(agent?.risk || "medium").trim().toLowerCase();
  const cap = round(Math.max(0, toFinite(agent?.capitalLimit, 0)), 6);
  const kpi = round(Math.max(0, toFinite(agent?.kpiTarget, 0)), 4);
  const horizon = Math.max(0, Math.round(toFinite(agent?.horizon, 0)));
  const autoApprove = round(Math.max(0, toFinite(agent?.autoApproveThreshold, 0)), 6);
  const address = String(kasData?.address || "").trim().toLowerCase();
  return `${agentId}|${risk}|${cap}|kpi:${kpi}|hz:${horizon}|aa:${autoApprove}|addr:${address}`;
}

function decisionSignature(decision: any) {
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

function appendSourceDetail(rawDetail: any, extra: string) {
  const base = String(rawDetail || "").trim();
  return [base, extra].filter(Boolean).join(";").slice(0, 220);
}

function localQuantDecisionFromCore(agent: any, coreDecision: any, reason: string, startedAt: number) {
  return sanitizeDecision(
    {
      ...coreDecision,
      decision_source: "quant-core",
      decision_source_detail: appendSourceDetail(coreDecision?.decision_source_detail, `fallback_reason:${reason}`),
      engine_latency_ms: Date.now() - startedAt,
    },
    agent
  );
}

function localQuantDecision(agent: any, kasData: any, context: QuantContext | undefined, reason: string, startedAt: number) {
  const core = buildQuantCoreDecision(agent, kasData, context);
  return localQuantDecisionFromCore(agent, core, reason, startedAt);
}

function getCachedOverlay(cacheKey: string) {
  return AI_OVERLAY_CACHE.get(cacheKey) || null;
}

function setCachedOverlay(cacheKey: string, signature: string, decision: any) {
  AI_OVERLAY_CACHE.set(cacheKey, {
    ts: Date.now(),
    signature,
    decision: cloneDecisionForCache(decision),
  });

  // Keep cache bounded for multi-agent sessions.
  while (AI_OVERLAY_CACHE.size > AI_OVERLAY_CACHE_MAX_ENTRIES) {
    const oldestKey = AI_OVERLAY_CACHE.keys().next().value;
    if (!oldestKey) break;
    AI_OVERLAY_CACHE.delete(oldestKey);
  }
}

function sanitizeCachedOverlayDecision(agent: any, cached: CachedOverlayDecision, startedAt: number, reason: string) {
  return sanitizeDecision(
    {
      ...(cached.decision || {}),
      decision_source: "hybrid-ai",
      decision_source_detail: appendSourceDetail(cached?.decision?.decision_source_detail, reason),
      engine_latency_ms: Date.now() - startedAt,
    },
    agent
  );
}

function resolveAiOverlayPlan(coreDecision: any, cached: CachedOverlayDecision | null) {
  const now = Date.now();
  const signature = decisionSignature(coreDecision);
  const qm = coreDecision?.quant_metrics || {};

  if (!AI_TRANSPORT_READY) {
    return { kind: "skip" as const, reason: "ai_transport_not_configured", signature };
  }

  if (AI_OVERLAY_MODE === "off") {
    return { kind: "skip" as const, reason: "ai_overlay_mode_off", signature };
  }

  if (AI_OVERLAY_MODE === "always") {
    return { kind: "call" as const, reason: "ai_overlay_mode_always", signature };
  }

  if (cached && cached.signature === signature) {
    const ageMs = Math.max(0, now - cached.ts);
    if (ageMs <= AI_OVERLAY_MIN_INTERVAL_MS) {
      return { kind: "reuse" as const, reason: `cache_hit_min_interval_${ageMs}ms`, signature };
    }
    if (AI_OVERLAY_MODE === "adaptive" && ageMs <= AI_OVERLAY_CACHE_TTL_MS) {
      const conf = toFinite(coreDecision?.confidence_score, 0);
      const risk = toFinite(coreDecision?.risk_score, 1);
      const riskCeiling = toFinite(qm.risk_ceiling, 0.65);
      const regime = String(qm.regime || "NEUTRAL");
      const edge = Math.abs(toFinite(qm.edge_score, 0));
      const uncertainZone = conf < 0.88 && conf > 0.56;
      const nearRiskBoundary = Math.abs(risk - riskCeiling) < 0.06;
      const regimeSensitive = regime === "RISK_OFF" || regime === "RANGE_VOL";
      if (!uncertainZone && !nearRiskBoundary && !regimeSensitive && edge > 0.2) {
        return { kind: "reuse" as const, reason: `cache_hit_stable_state_${ageMs}ms`, signature };
      }
    }
  }

  const dataQuality = toFinite(qm.data_quality_score, 0);
  const confidence = toFinite(coreDecision?.confidence_score, 0);
  const risk = toFinite(coreDecision?.risk_score, 1);
  const riskCeiling = toFinite(qm.risk_ceiling, 0.65);
  const regime = String(qm.regime || "NEUTRAL");
  const edge = Math.abs(toFinite(qm.edge_score, 0));
  const samples = toFinite(qm.sample_count, 0);
  const kelly = toFinite(coreDecision?.kelly_fraction, 0);

  if (dataQuality < 0.4 || samples < 6) {
    return { kind: "skip" as const, reason: "low_data_quality", signature };
  }

  const regimeSensitive = regime === "RISK_OFF" || regime === "RANGE_VOL";
  const nearRiskBoundary = Math.abs(risk - riskCeiling) < 0.08;
  const uncertainZone = confidence < 0.9 && confidence > 0.58;
  const lowEdge = edge < 0.12;
  const highConvictionDeterministic =
    dataQuality >= 0.72 &&
    confidence >= 0.88 &&
    !regimeSensitive &&
    !nearRiskBoundary &&
    edge >= 0.25 &&
    (kelly === 0 || kelly >= 0.02);

  if (highConvictionDeterministic) {
    return { kind: "skip" as const, reason: "quant_core_high_conviction", signature };
  }

  if (regimeSensitive || nearRiskBoundary || uncertainZone || lowEdge) {
    return { kind: "call" as const, reason: "adaptive_uncertain_or_sensitive", signature };
  }

  return { kind: "skip" as const, reason: "adaptive_cost_control", signature };
}

function mergeRiskFactors(a: any[], b: any[], extra?: string) {
  const merged = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
  if (extra) merged.push(extra);
  return Array.from(new Set(merged.map((v) => String(v).trim()).filter(Boolean))).slice(0, 6);
}

function fuseWithQuantCore(agent: any, coreDecision: any, aiDecision: any, aiLatencyMs: number, startedAt: number) {
  const regime = String(coreDecision?.quant_metrics?.regime || "NEUTRAL");
  const riskCeiling = toFinite(coreDecision?.quant_metrics?.risk_ceiling, 0.65);
  const aiAction = String(aiDecision?.action || "HOLD");
  let action = aiAction;
  let conflict = false;

  if (regime === "RISK_OFF" && aiAction === "ACCUMULATE") {
    action = coreDecision.action === "REDUCE" ? "REDUCE" : "HOLD";
    conflict = true;
  }
  if (toFinite(coreDecision?.risk_score, 0) > riskCeiling && aiAction === "ACCUMULATE") {
    action = coreDecision.action === "REDUCE" ? "REDUCE" : "HOLD";
    conflict = true;
  }

  const blendedRisk = round(Math.max(toFinite(coreDecision?.risk_score, 1), toFinite(aiDecision?.risk_score, 1)), 4);
  let blendedConfidence = round(
    clamp(
      toFinite(coreDecision?.confidence_score, 0.5) * 0.58 + toFinite(aiDecision?.confidence_score, 0.5) * 0.42 - (conflict ? 0.08 : 0),
      0,
      1
    ),
    4
  );

  if (action === "HOLD") blendedConfidence = Math.min(blendedConfidence, 0.86);

  const kellyCap = toFinite(coreDecision?.quant_metrics?.kelly_cap, toFinite(coreDecision?.kelly_fraction, 0));
  const blendedKelly = round(
    clamp(
      Math.min(
        Math.max(toFinite(coreDecision?.kelly_fraction, 0) * 0.8, toFinite(aiDecision?.kelly_fraction, 0) * 0.6),
        kellyCap || 1
      ),
      0,
      1
    ),
    4
  );

  let allocationKas = 0;
  const coreAlloc = toFinite(coreDecision?.capital_allocation_kas, 0);
  const aiAlloc = toFinite(aiDecision?.capital_allocation_kas, 0);
  if (action === "ACCUMULATE") {
    allocationKas = Math.min(aiAlloc || coreAlloc, coreAlloc * 1.25 || aiAlloc || 0);
  } else if (action === "REDUCE" || action === "REBALANCE") {
    allocationKas = Math.min(Math.max(coreAlloc, aiAlloc * 0.75), Math.max(coreAlloc * 1.5, aiAlloc));
  }

  const riskFactors = mergeRiskFactors(coreDecision?.risk_factors, aiDecision?.risk_factors, conflict ? "AI signal conflict; core risk override applied" : undefined);
  const aiRationale = String(aiDecision?.rationale || "AI overlay unavailable.").trim();
  const coreRationale = String(coreDecision?.rationale || "").trim();
  const rationale = `${coreRationale} AI overlay: ${aiRationale}`.slice(0, 900);

  return sanitizeDecision(
    {
      ...aiDecision,
      action,
      confidence_score: blendedConfidence,
      risk_score: blendedRisk,
      kelly_fraction: blendedKelly,
      capital_allocation_kas: action === "HOLD" ? 0 : allocationKas,
      expected_value_pct: round((toFinite(coreDecision?.expected_value_pct, 0) * 0.6) + (toFinite(aiDecision?.expected_value_pct, 0) * 0.4), 2),
      stop_loss_pct: round(Math.max(toFinite(coreDecision?.stop_loss_pct, 0), toFinite(aiDecision?.stop_loss_pct, 0)), 2),
      take_profit_pct: round((toFinite(coreDecision?.take_profit_pct, 0) * 0.6) + (toFinite(aiDecision?.take_profit_pct, 0) * 0.4), 2),
      monte_carlo_win_pct: round((toFinite(coreDecision?.monte_carlo_win_pct, 0) * 0.65) + (toFinite(aiDecision?.monte_carlo_win_pct, 0) * 0.35), 2),
      volatility_estimate: coreDecision?.volatility_estimate || aiDecision?.volatility_estimate,
      liquidity_impact: coreDecision?.liquidity_impact || aiDecision?.liquidity_impact,
      strategy_phase: action === "ACCUMULATE" ? coreDecision?.strategy_phase || aiDecision?.strategy_phase : aiDecision?.strategy_phase || coreDecision?.strategy_phase,
      rationale,
      risk_factors: riskFactors,
      next_review_trigger: coreDecision?.next_review_trigger || aiDecision?.next_review_trigger,
      decision_source: "hybrid-ai",
      decision_source_detail: `regime:${regime};ai_latency_ms:${aiLatencyMs};mode:quant_core_guarded`,
      quant_metrics: {
        ...(coreDecision?.quant_metrics || {}),
        ai_overlay_applied: true,
        ai_action_raw: aiAction,
        ai_confidence_raw: toFinite(aiDecision?.confidence_score, 0),
      },
      engine_latency_ms: Date.now() - startedAt,
    },
    agent
  );
}

function buildPrompt(agent: any, kasData: any, quantCoreDecision: any) {
  const compactKasData = {
    fetched: toFinite(kasData?.fetched, 0),
    address: String(kasData?.address || ""),
    walletKas: round(toFinite(kasData?.walletKas, 0), 6),
    priceUsd: round(toFinite(kasData?.priceUsd, 0), 8),
    dag: {
      daaScore: toFinite(kasData?.dag?.daaScore, 0),
      difficulty: toFinite(kasData?.dag?.difficulty ?? kasData?.dag?.virtualDaaScore, 0),
      networkName: String(kasData?.dag?.networkName || kasData?.dag?.network || ""),
      pastMedianTime: toFinite(kasData?.dag?.pastMedianTime ?? kasData?.dag?.virtualPastMedianTime, 0),
    },
  };
  const quantMetrics = quantCoreDecision?.quant_metrics || {};
  return `You are a quant-grade AI risk overlay for a Kaspa-native autonomous trading engine. The local quant core (deterministic math) has already computed features, regime, Kelly cap, and risk limits. Your job is to refine the decision WITHOUT violating the local risk envelope.

Respond ONLY with a valid JSON object — no markdown, no prose, no code fences.

AGENT PROFILE:
Name: ${agent.name}
Strategy: momentum / on-chain flow / risk-controlled execution
Risk Tolerance: ${agent.risk} (low=conservative, high=aggressive)
KPI Target: ${agent.kpiTarget}% ROI
Capital per Cycle: ${agent.capitalLimit} KAS
Auto-Approve Threshold: ${agent.autoApproveThreshold} KAS

KASPA SNAPSHOT:
${JSON.stringify(compactKasData)}

LOCAL QUANT CORE PRIOR (trust this as the primary signal unless you have a strong reason):
${JSON.stringify({
  action: quantCoreDecision.action,
  confidence_score: quantCoreDecision.confidence_score,
  risk_score: quantCoreDecision.risk_score,
  kelly_fraction: quantCoreDecision.kelly_fraction,
  capital_allocation_kas: quantCoreDecision.capital_allocation_kas,
  expected_value_pct: quantCoreDecision.expected_value_pct,
  stop_loss_pct: quantCoreDecision.stop_loss_pct,
  take_profit_pct: quantCoreDecision.take_profit_pct,
  monte_carlo_win_pct: quantCoreDecision.monte_carlo_win_pct,
  quant_metrics: quantMetrics,
  rationale: quantCoreDecision.rationale,
  risk_factors: quantCoreDecision.risk_factors,
})}

RULES:
1. Do not exceed quant_metrics.kelly_cap in kelly_fraction.
2. Do not exceed local quant capital_allocation_kas by more than 25%.
3. If quant_metrics.regime is RISK_OFF, avoid ACCUMULATE unless confidence_score >= 0.9 and risk_score <= quant_metrics.risk_ceiling.
4. Preserve strict risk discipline; prefer HOLD over low-quality conviction.
5. Keep rationale concise and reference actual metrics from the snapshot/core prior.

OUTPUT (strict JSON, all fields required):
{
  "action": "ACCUMULATE or REDUCE or HOLD or REBALANCE",
  "confidence_score": 0.00,
  "risk_score": 0.00,
  "kelly_fraction": 0.00,
  "capital_allocation_kas": 0.00,
  "capital_allocation_pct": 0,
  "expected_value_pct": 0.00,
  "stop_loss_pct": 0.00,
  "take_profit_pct": 0.00,
  "monte_carlo_win_pct": 0,
  "volatility_estimate": "LOW or MEDIUM or HIGH",
  "liquidity_impact": "MINIMAL or MODERATE or SIGNIFICANT",
  "strategy_phase": "ENTRY or SCALING or HOLDING or EXIT",
  "rationale": "Two concise sentences citing specific metrics and why this refines the quant-core prior.",
  "risk_factors": ["factor1", "factor2", "factor3"],
  "next_review_trigger": "Describe the specific condition that should trigger next decision cycle"
}`;
}

async function requestAiDecision(agent: any, kasData: any, quantCoreDecision: any) {
  const prompt = buildPrompt(agent, kasData, quantCoreDecision);
  const body = AI_API_URL.includes("api.anthropic.com")
    ? { model: AI_MODEL, max_tokens: 900, messages: [{ role: "user", content: prompt }] }
    : { prompt, agent, kasData, quantCore: quantCoreDecision };

  let data: any;
  for (let attempt = 0; attempt < AI_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const res = await fetch(AI_API_URL, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const status = Number(res.status || 0);
        if (AI_RETRYABLE_STATUSES.has(status) && attempt + 1 < AI_MAX_ATTEMPTS) {
          await sleep(aiRetryDelayMs(attempt));
          continue;
        }
        throw new Error(`AI endpoint ${status || "request_failed"}`);
      }

      data = await res.json();
      break;
    } catch (err: any) {
      const isTimeout = err?.name === "AbortError";
      const rawMessage = String(err?.message || "");
      const isNetworkError = err?.name === "TypeError" || /failed to fetch|network|load failed/i.test(rawMessage);
      if (!isTimeout && isNetworkError && attempt + 1 < AI_MAX_ATTEMPTS) {
        await sleep(aiRetryDelayMs(attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (data?.error?.message) throw new Error(data.error.message);

  // Anthropic shape
  if (Array.isArray(data?.content)) {
    const text = data.content.map((block: any) => block.text || "").join("");
    const parsed = safeJsonParse(text.replace(/```json|```/g, "").trim());
    return sanitizeDecision({ ...parsed, decision_source: "ai" }, agent);
  }

  // Backend-proxy shape: { decision: {...} } or direct JSON decision object.
  if (data?.decision) return sanitizeDecision({ ...data.decision, decision_source: "ai" }, agent);
  return sanitizeDecision({ ...data, decision_source: "ai" }, agent);
}

export async function runQuantEngine(agent: any, kasData: any, context?: QuantContext) {
  const startedAt = Date.now();
  const quantCoreDecision = sanitizeDecision(
    {
      ...buildQuantCoreDecision(agent, kasData, context),
      engine_latency_ms: Date.now() - startedAt,
    },
    agent
  );
  const cacheKey = agentOverlayCacheKey(agent, kasData);
  const cachedOverlay = getCachedOverlay(cacheKey);
  const overlayPlan = resolveAiOverlayPlan(quantCoreDecision, cachedOverlay);

  if (
    overlayPlan.kind === "skip" &&
    overlayPlan.reason === "ai_transport_not_configured" &&
    !AI_FALLBACK_ENABLED &&
    AI_OVERLAY_MODE !== "off"
  ) {
    throw new Error("Real AI overlay is required but AI transport is not configured (set VITE_AI_API_URL and credentials/proxy).");
  }

  // Local quant core is the primary engine. AI acts only as a bounded overlay.
  if (overlayPlan.kind === "skip") {
    return localQuantDecisionFromCore(agent, quantCoreDecision, overlayPlan.reason, startedAt);
  }

  if (overlayPlan.kind === "reuse" && cachedOverlay) {
    return sanitizeCachedOverlayDecision(agent, cachedOverlay, startedAt, overlayPlan.reason);
  }

  const aiStartedAt = Date.now();
  try {
    const aiDecision = await requestAiDecision(agent, kasData, quantCoreDecision);
    const aiLatencyMs = Date.now() - aiStartedAt;
    const fused = fuseWithQuantCore(agent, quantCoreDecision, aiDecision, aiLatencyMs, startedAt);
    fused.decision_source_detail = appendSourceDetail(fused?.decision_source_detail, `overlay_plan:${overlayPlan.reason}`);
    setCachedOverlay(cacheKey, overlayPlan.signature, fused);
    return fused;
  } catch (err: any) {
    if (cachedOverlay) {
      const cacheAgeMs = Math.max(0, Date.now() - cachedOverlay.ts);
      if (cacheAgeMs <= AI_OVERLAY_CACHE_TTL_MS) {
        return sanitizeCachedOverlayDecision(
          agent,
          cachedOverlay,
          startedAt,
          `ai_error_cache_reuse_${cacheAgeMs}ms`
        );
      }
    }
    if (AI_FALLBACK_ENABLED) {
      const reason = err?.name === "AbortError" ? `ai_timeout_${AI_TIMEOUT_MS}ms` : (err?.message || "request failure");
      return localQuantDecisionFromCore(agent, quantCoreDecision, reason, startedAt);
    }
    if (err?.name === "AbortError") throw new Error(`AI request timeout (${AI_TIMEOUT_MS}ms)`);
    throw err;
  }
}
