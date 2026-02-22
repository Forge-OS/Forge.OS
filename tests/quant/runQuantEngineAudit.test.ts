import { describe, expect, it } from "vitest";
import { AUDIT_HASH_ALGO, buildAuditSigningPayloadFromRecord, hashCanonical } from "../../src/quant/runQuantEngineAudit";

describe("runQuantEngine audit helpers", () => {
  it("hashes canonical JSON with SHA-256 deterministically", async () => {
    const a = await hashCanonical({ b: 2, a: 1, nested: { z: true, a: [2, 1] } });
    const b = await hashCanonical({ nested: { a: [2, 1], z: true }, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a.startsWith(`${AUDIT_HASH_ALGO}:`)).toBe(true);
    expect(a.split(":")[1]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds audit signing payload with defaults", () => {
    const payload = buildAuditSigningPayloadFromRecord(
      { decision_hash: "x", quant_feature_snapshot_hash: "y" },
      {
        decisionAuditRecordVersion: "forgeos.decision.audit.v1",
        auditHashAlgo: AUDIT_HASH_ALGO,
        aiPromptVersion: "prompt.v1",
        aiResponseSchemaVersion: "schema.v1",
      }
    );
    expect(payload.hash_algo).toBe(AUDIT_HASH_ALGO);
    expect(payload.decision_hash).toBe("x");
    expect(payload.quant_feature_snapshot_hash).toBe("y");
  });
});
