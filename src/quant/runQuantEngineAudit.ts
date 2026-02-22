import { toFinite } from "./math";

export const AUDIT_HASH_ALGO = "sha256/canonical-json";

function stableStringify(value: any): string {
  if (value == null) return "null";
  const t = typeof value;
  if (t === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (t === "boolean") return value ? "true" : "false";
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (t === "object") {
    const entries = Object.entries(value)
      .filter(([_, v]) => typeof v !== "undefined")
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return "null";
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const bytes = enc.encode(input);
  const subtle = (globalThis.crypto as any)?.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    throw new Error("SHA-256 hashing requires WebCrypto subtle.digest");
  }
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashCanonical(value: any): Promise<string> {
  return `${AUDIT_HASH_ALGO}:${await sha256Hex(stableStringify(value))}`;
}

export function buildAuditSigningPayloadFromRecord(
  auditRecord: any,
  defaults: {
    decisionAuditRecordVersion: string;
    auditHashAlgo: string;
    aiPromptVersion: string;
    aiResponseSchemaVersion: string;
  }
) {
  return {
    audit_record_version: String(auditRecord?.audit_record_version || defaults.decisionAuditRecordVersion),
    hash_algo: String(auditRecord?.hash_algo || defaults.auditHashAlgo),
    prompt_version: String(auditRecord?.prompt_version || defaults.aiPromptVersion),
    ai_response_schema_version: String(auditRecord?.ai_response_schema_version || defaults.aiResponseSchemaVersion),
    quant_feature_snapshot_hash: String(auditRecord?.quant_feature_snapshot_hash || ""),
    decision_hash: String(auditRecord?.decision_hash || ""),
    overlay_plan_reason: String(auditRecord?.overlay_plan_reason || ""),
    engine_path: String(auditRecord?.engine_path || ""),
    created_ts: Math.max(0, Math.round(toFinite(auditRecord?.created_ts, Date.now()))),
  };
}
