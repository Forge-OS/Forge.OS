const env = import.meta.env;

type AiOverlayMode = "off" | "always" | "adaptive";

function parseBool(raw: any, fallback = false) {
  const v = String(raw ?? "").trim();
  if (!v) return fallback;
  return /^(1|true|yes)$/i.test(v);
}

function parseAiOverlayMode(raw: any): AiOverlayMode {
  const normalized = String(raw || "always").trim().toLowerCase();
  if (normalized === "off" || normalized === "always" || normalized === "adaptive") return normalized;
  return "adaptive";
}

const aiApiUrl = env.VITE_AI_API_URL || "https://api.anthropic.com/v1/messages";
const anthropicApiKey = env.VITE_ANTHROPIC_API_KEY || "";
const aiOverlayMinIntervalMs = Math.max(0, Number(env.VITE_AI_OVERLAY_MIN_INTERVAL_MS || 15000));
const aiOverlayCacheTtlMs = Math.max(aiOverlayMinIntervalMs, Number(env.VITE_AI_OVERLAY_CACHE_TTL_MS || 45000));

export const RUN_QUANT_ENGINE_CONFIG = {
  aiApiUrl,
  aiModel: env.VITE_AI_MODEL || "claude-sonnet-4-20250514",
  anthropicApiKey,
  aiTimeoutMs: Math.max(800, Number(env.VITE_AI_SOFT_TIMEOUT_MS || 2200)),
  aiFallbackEnabled: String(env.VITE_AI_FALLBACK_ENABLED || "true").toLowerCase() !== "false",
  aiOverlayMode: parseAiOverlayMode(env.VITE_AI_OVERLAY_MODE),
  aiOverlayMinIntervalMs,
  aiOverlayCacheTtlMs,
  aiOverlayCacheMaxEntries: 512,
  aiTransportReady: Boolean(aiApiUrl) && (!aiApiUrl.includes("api.anthropic.com") || Boolean(anthropicApiKey)),
  aiMaxAttempts: Math.max(1, Math.min(3, Number(env.VITE_AI_MAX_ATTEMPTS || 2))),
  aiRetryableStatuses: new Set([408, 425, 429, 500, 502, 503, 504]),
  decisionAuditRecordVersion: "forgeos.decision.audit.v1",
  aiPromptVersion: "forgeos.quant.overlay.prompt.v1",
  aiResponseSchemaVersion: "forgeos.ai.decision.schema.v1",
  auditSignerUrl: String(env.VITE_DECISION_AUDIT_SIGNER_URL || "").trim(),
  auditSignerToken: String(env.VITE_DECISION_AUDIT_SIGNER_TOKEN || "").trim(),
  auditSignerTimeoutMs: Math.max(500, Number(env.VITE_DECISION_AUDIT_SIGNER_TIMEOUT_MS || 1500)),
  auditSignerRequired: parseBool(env.VITE_DECISION_AUDIT_SIGNER_REQUIRED, false),
} satisfies Record<string, any>;

export type RunQuantEngineConfig = typeof RUN_QUANT_ENGINE_CONFIG;
