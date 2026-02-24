# ForgeOS Audit Signer (Reference Service)

`server/audit-signer` provides **server-side cryptographic signatures** for frontend decision audit records.

It is intended for:
- non-custodial frontend decision audit integrity (no private keys in browser)
- replayable/auditable decision records
- HSM/KMS integration via command adapter mode

## Endpoints

- `GET /health`
- `GET /metrics` (Prometheus)
- `GET /v1/public-key` (local-key mode only)
- `GET /v1/audit-log` (append-only JSONL export with hash-chain fields when configured)
- `POST /v1/audit-sign`

## Modes

### 1) Local key mode (recommended default)

Use an Ed25519 private key (PEM):

- `AUDIT_SIGNER_PRIVATE_KEY_PEM`
or
- `AUDIT_SIGNER_PRIVATE_KEY_PATH`

Optional:
- `AUDIT_SIGNER_KEY_ID`
- `AUDIT_SIGNER_INCLUDE_PUBLIC_KEY=true`
- `AUDIT_SIGNER_APPEND_LOG_PATH` (append-only JSONL signed audit record log with `prev_record_hash` + `record_hash`)
- `AUDIT_SIGNER_APPEND_LOG_MAX_EXPORT_LINES`

### 2) External command mode (HSM/KMS-ready)

Set:
- `AUDIT_SIGNER_COMMAND`

The command receives JSON on stdin:

```json
{
  "kind": "forgeos.decision.audit.sign",
  "version": "forgeos.audit.crypto.v1",
  "canonicalPayload": "{...canonical-json...}",
  "signingPayload": { "...normalized audit payload..." },
  "payloadHashSha256B64u": "...",
  "ts": 0
}
```

The command must return JSON on stdout:

```json
{
  "signatureB64u": "...",
  "alg": "Ed25519",
  "keyId": "my-hsm-key",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----..."
}
```

## Frontend Integration

Configure Forge-OS frontend:

- `VITE_DECISION_AUDIT_SIGNER_URL=http://127.0.0.1:8797/v1/audit-sign`
- `VITE_DECISION_AUDIT_SIGNER_TOKEN=...` (optional)
- `VITE_DECISION_AUDIT_SIGNER_REQUIRED=true|false`

When configured, decision audit records include a cryptographic signature block in `audit_record.crypto_signature`.

## External Verification (Offline)

Use the bundled verifier CLI to validate:
- JSONL parseability
- append-only hash-chain integrity (`prev_record_hash`, `record_hash`)
- decision cryptographic signatures (when public key is included or provided)

```bash
npm run audit-log:verify -- --file ./forgeos-audit.jsonl --strict-signatures
```

Optional:
- `--public-key ./signer-public.pem`
- `--pin sha256:<fingerprint>`
- `--json`
