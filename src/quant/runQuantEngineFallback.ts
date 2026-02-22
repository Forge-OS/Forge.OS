import { buildQuantCoreDecision, type QuantContext } from "./quantCore";
import type { CachedOverlayDecision } from "./runQuantEngineOverlayCache";

export function appendSourceDetail(rawDetail: any, extra: string) {
  const base = String(rawDetail || "").trim();
  return [base, extra].filter(Boolean).join(";").slice(0, 220);
}

export function localQuantDecisionFromCore(params: {
  agent: any;
  coreDecision: any;
  reason: string;
  startedAt: number;
  sanitizeDecision: (raw: any, agent: any) => any;
}) {
  const { agent, coreDecision, reason, startedAt, sanitizeDecision } = params;
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

export function localQuantDecision(params: {
  agent: any;
  kasData: any;
  context?: QuantContext;
  reason: string;
  startedAt: number;
  sanitizeDecision: (raw: any, agent: any) => any;
}) {
  const { agent, kasData, context, reason, startedAt, sanitizeDecision } = params;
  const core = buildQuantCoreDecision(agent, kasData, context);
  return localQuantDecisionFromCore({ agent, coreDecision: core, reason, startedAt, sanitizeDecision });
}

export function sanitizeCachedOverlayDecision(params: {
  agent: any;
  cached: CachedOverlayDecision;
  startedAt: number;
  reason: string;
  sanitizeDecision: (raw: any, agent: any) => any;
}) {
  const { agent, cached, startedAt, reason, sanitizeDecision } = params;
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
