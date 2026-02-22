import { round, toFinite } from "./math";
import {
  AUDIT_HASH_ALGO,
  buildAuditSigningPayloadFromRecord,
  hashCanonical,
} from "./runQuantEngineAudit";
import { RUN_QUANT_ENGINE_CONFIG as CFG } from "./runQuantEngineConfig";

function auditSignerHeaders() {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (CFG.auditSignerToken) headers.Authorization = `Bearer ${CFG.auditSignerToken}`;
  return headers;
}

async function maybeAttachCryptographicAuditSignature(decision: any) {
  const auditRecord = decision?.audit_record;
  if (!auditRecord || !CFG.auditSignerUrl) return decision;
  const signingPayload = buildAuditSigningPayloadFromRecord(auditRecord, {
    decisionAuditRecordVersion: CFG.decisionAuditRecordVersion,
    auditHashAlgo: AUDIT_HASH_ALGO,
    aiPromptVersion: CFG.aiPromptVersion,
    aiResponseSchemaVersion: CFG.aiResponseSchemaVersion,
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CFG.auditSignerTimeoutMs);
  try {
    const res = await fetch(CFG.auditSignerUrl, {
      method: "POST",
      headers: auditSignerHeaders(),
      body: JSON.stringify({ signingPayload }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(String(data?.error?.message || `audit_signer_${res.status || "failed"}`));
    }
    const sig = data?.signature && typeof data.signature === "object" ? data.signature : data;
    const cryptoSignature = {
      status: "signed",
      alg: String(sig?.alg || sig?.algorithm || "unknown").slice(0, 80),
      key_id: String(sig?.keyId || sig?.key_id || "").slice(0, 160),
      sig_b64u: String(sig?.signatureB64u || sig?.signature || sig?.sig_b64u || "").slice(0, 600),
      payload_hash_sha256_b64u: String(sig?.payloadHashSha256B64u || sig?.payload_hash_sha256_b64u || "").slice(0, 160),
      signer: String(sig?.signer || "audit-signer").slice(0, 80),
      signed_ts: Math.max(0, Math.round(toFinite(sig?.signedAt ?? sig?.signed_ts, Date.now()))),
      signing_latency_ms: Math.max(0, Math.round(toFinite(sig?.signingLatencyMs ?? sig?.signing_latency_ms, 0))),
      public_key_pem:
        typeof sig?.publicKeyPem === "string"
          ? sig.publicKeyPem.slice(0, 4000)
          : (typeof sig?.public_key_pem === "string" ? sig.public_key_pem.slice(0, 4000) : undefined),
    };
    return {
      ...decision,
      audit_record: {
        ...auditRecord,
        crypto_signature: cryptoSignature,
      },
    };
  } catch (err: any) {
    const message =
      err?.name === "AbortError"
        ? `audit_signer_timeout_${CFG.auditSignerTimeoutMs}ms`
        : String(err?.message || "audit_signer_failed");
    if (CFG.auditSignerRequired) {
      throw new Error(message);
    }
    return {
      ...decision,
      audit_record: {
        ...auditRecord,
        crypto_signature: {
          status: "error",
          signer: "audit-signer",
          error: message.slice(0, 240),
        },
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildQuantFeatureSnapshot(agent: any, kasData: any, quantCoreDecision: any) {
  const qm = quantCoreDecision?.quant_metrics || {};
  return {
    agent: {
      id: String(agent?.agentId || agent?.name || "agent"),
      risk: String(agent?.risk || ""),
      capitalLimit: round(Math.max(0, toFinite(agent?.capitalLimit, 0)), 6),
      autoApproveThreshold: round(Math.max(0, toFinite(agent?.autoApproveThreshold, 0)), 6),
      strategyTemplate: String(agent?.strategyTemplate || agent?.strategyLabel || "custom"),
    },
    kaspa: {
      address: String(kasData?.address || ""),
      walletKas: round(Math.max(0, toFinite(kasData?.walletKas, 0)), 6),
      priceUsd: round(Math.max(0, toFinite(kasData?.priceUsd, 0)), 8),
      daaScore: Math.max(0, Math.round(toFinite(kasData?.dag?.daaScore, 0))),
      network: String(kasData?.dag?.networkName || kasData?.dag?.network || ""),
    },
    quantCore: {
      action: String(quantCoreDecision?.action || "HOLD"),
      confidence_score: round(toFinite(quantCoreDecision?.confidence_score, 0), 4),
      risk_score: round(toFinite(quantCoreDecision?.risk_score, 0), 4),
      kelly_fraction: round(toFinite(quantCoreDecision?.kelly_fraction, 0), 6),
      capital_allocation_kas: round(toFinite(quantCoreDecision?.capital_allocation_kas, 0), 6),
      expected_value_pct: round(toFinite(quantCoreDecision?.expected_value_pct, 0), 4),
      quant_metrics: {
        regime: String(qm?.regime || ""),
        sample_count: Math.max(0, Math.round(toFinite(qm?.sample_count, 0))),
        edge_score: round(toFinite(qm?.edge_score, 0), 6),
        data_quality_score: round(toFinite(qm?.data_quality_score, 0), 6),
        ewma_volatility: round(toFinite(qm?.ewma_volatility, 0), 6),
        risk_ceiling: round(toFinite(qm?.risk_ceiling, 0), 6),
        kelly_cap: round(toFinite(qm?.kelly_cap, 0), 6),
      },
    },
  };
}

async function attachDecisionAuditRecord(params: {
  decision: any;
  agent: any;
  kasData: any;
  quantCoreDecision: any;
  overlayPlanReason: string;
  enginePath: string;
  sanitizeDecision: (raw: any, agent: any) => any;
}) {
  const decision = params.decision || {};
  const quantSnapshot = buildQuantFeatureSnapshot(params.agent, params.kasData, params.quantCoreDecision);
  const quantFeatureSnapshotHash = await hashCanonical(quantSnapshot);
  const decisionForHash = {
    ...decision,
    audit_record: undefined,
  };
  const decisionHash = await hashCanonical(decisionForHash);
  const auditSig = await hashCanonical({
    decision_hash: decisionHash,
    quant_feature_snapshot_hash: quantFeatureSnapshotHash,
    prompt_version: CFG.aiPromptVersion,
    ai_response_schema_version: CFG.aiResponseSchemaVersion,
    overlay_plan_reason: params.overlayPlanReason,
    engine_path: params.enginePath,
  });
  return params.sanitizeDecision(
    {
      ...decision,
      audit_record: {
        audit_record_version: CFG.decisionAuditRecordVersion,
        hash_algo: AUDIT_HASH_ALGO,
        prompt_version: CFG.aiPromptVersion,
        ai_response_schema_version: CFG.aiResponseSchemaVersion,
        quant_feature_snapshot_hash: quantFeatureSnapshotHash,
        decision_hash: decisionHash,
        audit_sig: auditSig,
        overlay_plan_reason: params.overlayPlanReason,
        engine_path: params.enginePath,
        prompt_used: params.enginePath === "hybrid-ai" || params.enginePath === "ai",
        ai_transport_ready: CFG.aiTransportReady,
        created_ts: Date.now(),
        quant_feature_snapshot_excerpt: {
          regime: String(params.quantCoreDecision?.quant_metrics?.regime || ""),
          sample_count: Math.max(0, Math.round(toFinite(params.quantCoreDecision?.quant_metrics?.sample_count, 0))),
          edge_score: round(toFinite(params.quantCoreDecision?.quant_metrics?.edge_score, 0), 6),
          data_quality_score: round(toFinite(params.quantCoreDecision?.quant_metrics?.data_quality_score, 0), 6),
          price_usd: round(toFinite(params.kasData?.priceUsd, 0), 8),
          wallet_kas: round(toFinite(params.kasData?.walletKas, 0), 6),
          daa_score: Math.max(0, Math.round(toFinite(params.kasData?.dag?.daaScore, 0))),
        },
      },
    },
    params.agent
  );
}

export async function finalizeDecisionAuditRecord(params: {
  decision: any;
  agent: any;
  kasData: any;
  quantCoreDecision: any;
  overlayPlanReason: string;
  enginePath: string;
  sanitizeDecision: (raw: any, agent: any) => any;
}) {
  const withAudit = await attachDecisionAuditRecord(params);
  return maybeAttachCryptographicAuditSignature(withAudit);
}

