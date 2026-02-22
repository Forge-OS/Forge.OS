# Forge.OS Scheduler + Shared Market Cache (Starter)

Server-side multi-agent scheduler scaffold for Forge.OS.

What it adds:
- Shared Kaspa market snapshot cache (price + blockdag + wallet balance) with TTL and in-flight dedupe
- In-memory agent registry and scheduler tick loop
- Cycle dispatch queue with concurrency limits (Redis-authoritative execution queue when enabled)
- Optional scheduler auth (`Bearer` / `X-Scheduler-Token`)
- Optional service-token / HS256 JWT / JWKS JWT auth with scopes + per-user quotas
- Optional OIDC discovery (`issuer` -> `jwks_uri`) with JWKS cache/pinning controls
- Optional Redis-backed agent persistence + execution queue storage (degrades safely if Redis is unavailable)
- Optional Redis-authoritative due schedule (`ZSET`) + execution queue + leader lock fencing + per-agent/task leases for multi-instance safety
- Optional callback dispatch per agent (`callbackUrl`)
- `/health` and Prometheus `/metrics` for operations

This is a production-scale **starter**, not a final scheduler. It is intended to move orchestration pressure out of the browser and make Forge.OS the operator control plane + signing surface.

## Endpoints
- `GET /health`
- `GET /metrics`
- `GET /v1/agents`
- `POST /v1/agents/register`
- `POST /v1/agents/:id/control` with `{ "action": "pause" | "resume" | "remove" }`
- `GET /v1/market-snapshot?address=kaspa:...`
- `POST /v1/scheduler/tick` (manual trigger)

Auth behavior:
- `GET /health` and `GET /metrics` stay public by default
- If `SCHEDULER_AUTH_TOKEN` or `SCHEDULER_AUTH_TOKENS` is set, mutating endpoints require auth
- Set `SCHEDULER_AUTH_READS=true` to require auth for `GET /v1/*` reads as well
- `SCHEDULER_SERVICE_TOKENS_JSON` supports scoped service tokens (recommended over shared admin token)
- `SCHEDULER_JWT_HS256_SECRET` enables HS256 JWT auth (`sub`, `scope`/`scopes`, optional `exp`, `iss`, `aud`)
- `SCHEDULER_JWKS_URL` enables OIDC/JWKS-backed JWT validation (RS256; cached by `kid`)
- `SCHEDULER_OIDC_ISSUER` enables OIDC discovery (`/.well-known/openid-configuration`) when direct `SCHEDULER_JWKS_URL` is not set

Scope model (current):
- `agent:read`
- `agent:write`
- `scheduler:tick`
- `metrics:read` (reserved; `/metrics` remains public by default)
- `admin`

Quota model (per authenticated principal, Redis-backed when available):
- `read` bucket (`GET /v1/*`) → `SCHEDULER_QUOTA_READ_MAX`
- `write` bucket (`POST /v1/*` except tick) → `SCHEDULER_QUOTA_WRITE_MAX`
- `tick` bucket (`POST /v1/scheduler/tick`) → `SCHEDULER_QUOTA_TICK_MAX`

## Register Agent Example (No Auth)
```bash
curl -X POST http://localhost:8790/v1/agents/register \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: user-123' \
  -d '{
    "agentId": "alpha-1",
    "name": "Alpha 1",
    "walletAddress": "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85",
    "strategyLabel": "DCA Accumulator",
    "cycleIntervalMs": 15000,
    "callbackUrl": "http://localhost:3001/forgeos/scheduler-hook"
  }'
```

## Register Agent Example (With Auth)
```bash
curl -X POST http://localhost:8790/v1/agents/register \
  -H 'Authorization: Bearer super-secret-token' \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: user-123' \
  -d '{
    "agentId": "alpha-1",
    "walletAddress": "kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85"
  }'
```

## Service Token Registry Example
```bash
export SCHEDULER_SERVICE_TOKENS_JSON='[
  {"token":"svc-read","sub":"user-123","scopes":["agent:read"]},
  {"token":"svc-write","sub":"user-123","scopes":["agent:read","agent:write"]},
  {"token":"svc-admin","sub":"ops","scopes":["admin"]}
]'
```

## Market Snapshot Example
```bash
curl "http://localhost:8790/v1/market-snapshot?address=kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85"
```

## Run
```bash
export KAS_API_BASE=https://api.kaspa.org
node server/scheduler/index.mjs
```

With auth + Redis:
```bash
export KAS_API_BASE=https://api.kaspa.org
export SCHEDULER_AUTH_TOKEN=super-secret-token
export SCHEDULER_AUTH_READS=true
export SCHEDULER_REDIS_URL=redis://127.0.0.1:6379
node server/scheduler/index.mjs
```

With scoped service tokens + Redis authoritative queue + leader lock:
```bash
export KAS_API_BASE=https://api.kaspa.org
export SCHEDULER_AUTH_READS=true
export SCHEDULER_SERVICE_TOKENS_JSON='[{"token":"svc-admin","sub":"ops","scopes":["admin"]}]'
export SCHEDULER_REDIS_URL=redis://127.0.0.1:6379
export SCHEDULER_REDIS_AUTHORITATIVE_QUEUE=true
node server/scheduler/index.mjs
```

## Key Env Vars
- `PORT` (default `8790`)
- `KAS_API_BASE` (default `https://api.kaspa.org`)
- `KAS_API_TIMEOUT_MS` (default `5000`)
- `SCHEDULER_TICK_MS` (default `1000`)
- `SCHEDULER_CYCLE_CONCURRENCY` (default `4`)
- `SCHEDULER_MAX_AGENTS` (default `5000`)
- `SCHEDULER_MAX_QUEUE` (default `10000`)
- `SCHEDULER_MARKET_CACHE_TTL_MS` (default `2000`)
- `SCHEDULER_BALANCE_CACHE_TTL_MS` (default `2500`)
- `SCHEDULER_CALLBACK_TIMEOUT_MS` (default `4000`)
- `SCHEDULER_ALLOWED_ORIGINS` (default `*`)
- `SCHEDULER_AUTH_TOKEN` / `SCHEDULER_AUTH_TOKENS` (optional token auth)
- `SCHEDULER_SERVICE_TOKENS_JSON` (optional scoped service-token registry JSON)
- `SCHEDULER_JWT_HS256_SECRET` (optional HS256 JWT auth)
- `SCHEDULER_JWT_ISSUER`, `SCHEDULER_JWT_AUDIENCE` (optional JWT claim checks)
- `SCHEDULER_OIDC_ISSUER`, `SCHEDULER_OIDC_DISCOVERY_TTL_MS` (optional OIDC discovery)
- `SCHEDULER_JWKS_URL` (optional OIDC/JWKS endpoint for JWT verification)
- `SCHEDULER_JWKS_CACHE_TTL_MS` (JWKS cache TTL, default `300000`)
- `SCHEDULER_JWKS_ALLOWED_KIDS`, `SCHEDULER_JWKS_REQUIRE_PINNED_KID` (optional key pinning policy)
- `SCHEDULER_AUTH_READS` (default `false`; protect `GET /v1/*`)
- `SCHEDULER_QUOTA_WINDOW_MS`, `SCHEDULER_QUOTA_READ_MAX`, `SCHEDULER_QUOTA_WRITE_MAX`, `SCHEDULER_QUOTA_TICK_MAX`
- `SCHEDULER_REDIS_URL` (optional Redis for agent persistence + execution queue storage)
- `SCHEDULER_REDIS_RESET_EXEC_QUEUE_ON_BOOT` (default `false`; set `true` for legacy reset-on-boot behavior)
- `SCHEDULER_REDIS_PREFIX` (default `forgeos:scheduler`)
- `SCHEDULER_REDIS_CONNECT_TIMEOUT_MS` (default `2000`)
- `SCHEDULER_REDIS_AUTHORITATIVE_QUEUE` (default `true`)
- `SCHEDULER_INSTANCE_ID` (optional instance label)
- `SCHEDULER_LEADER_LOCK_TTL_MS`, `SCHEDULER_LEADER_LOCK_RENEW_MS`
- `SCHEDULER_LEADER_LOCK_RENEW_JITTER_MS`
- `SCHEDULER_LEADER_ACQUIRE_BACKOFF_MIN_MS`, `SCHEDULER_LEADER_ACQUIRE_BACKOFF_MAX_MS`
- `SCHEDULER_JOB_LEASE_TTL_MS`
- `SCHEDULER_MAX_DUE_CLAIMS_PER_TICK`
- `SCHEDULER_REDIS_EXEC_LEASE_TTL_MS`, `SCHEDULER_REDIS_EXEC_REQUEUE_BATCH`
- `SCHEDULER_CALLBACK_IDEMPOTENCY_TTL_MS`

## Redis Behavior (Current Starter)
- Agents are persisted in Redis hash storage when Redis is configured and reachable.
- Redis `ZSET` due schedule is used as the authoritative scheduler source when `SCHEDULER_REDIS_AUTHORITATIVE_QUEUE=true`.
- Redis execution queue uses payload storage + ready/processing lists + inflight lease tracking (leader schedules, workers can drain across instances).
- Leader lock uses a fencing token counter + renew backoff/jitter for stronger multi-instance coordination.
- Per-agent due leases + per-task execution leases reduce duplicate dispatch risk across multiple scheduler instances.
- On startup, queued/processing/inflight execution tasks are **preserved** by default and recovered/requeued when safe (instead of being cleared).
- Set `SCHEDULER_REDIS_RESET_EXEC_QUEUE_ON_BOOT=true` only if you explicitly want legacy reset-on-boot behavior.
- If Redis is down/unreachable at startup, scheduler boots in degraded in-memory mode and reports the error in `/health` + `/metrics`.
- This is still a starter: stronger distributed guarantees (fencing propagation enforcement + downstream idempotent sinks) are still recommended for production-grade multi-instance execution.

## Callback Idempotency + Fencing (Downstream Consumers)
Scheduler callback payloads now include:
- `scheduler.leaderFenceToken`
- `scheduler.queueTaskId`
- `scheduler.callbackIdempotencyKey`

Scheduler also sends callback headers:
- `X-ForgeOS-Leader-Fence-Token`
- `X-ForgeOS-Idempotency-Key`
- `X-ForgeOS-Queue-Task-Id`
- `X-ForgeOS-Scheduler-Instance`
- `X-ForgeOS-Agent-Key`

Consumer recommendation:
- Enforce **idempotency** on `X-ForgeOS-Idempotency-Key`
- Track the highest seen fence token per agent and reject stale/lower fence tokens for side-effecting operations

## Next Production Steps
- Make Redis execution queue fully crash-recoverable across cold restarts (preserve in-flight queue state instead of starter reset-on-boot policy)
- Add stronger enterprise authN/authZ beyond shared token/JWT modes (OIDC discovery is supported; next step is full OIDC discovery policy + key rotation automation and key pinset management)
- Add per-user quotas and scheduler fairness
- Add exact execution telemetry ingestion for realized PnL attribution
- Add circuit breakers for Kaspa API upstream degradation
