# Forge-OS Callback Consumer (Reference Service)

Reference downstream callback receiver for scheduler cycle events with:
- idempotency enforcement (`X-ForgeOS-Idempotency-Key`)
- leader fence token enforcement (`X-ForgeOS-Leader-Fence-Token`)
- recent event storage for inspection
- execution receipt ingestion endpoints (for exact realized attribution pipelines)
- optional auth + optional Redis persistence

This is a starter service for production callback consumers.

## Endpoints
- `GET /health`
- `GET /metrics` (Prometheus)
- `GET /v1/events`
- `POST /v1/scheduler/cycle`
- `GET /v1/execution-receipts?txid=<txid>`
- `GET /v1/execution-receipts/stream` (SSE push stream for receipt updates)
- `POST /v1/execution-receipts`

## Scheduler Callback Headers (Consumed)
- `X-ForgeOS-Idempotency-Key`
- `X-ForgeOS-Leader-Fence-Token`
- `X-ForgeOS-Queue-Task-Id` (stored for inspection)
- `X-ForgeOS-Agent-Key`

## Run
```bash
node server/callback-consumer/index.mjs
```

With auth:
```bash
export CALLBACK_CONSUMER_AUTH_TOKEN=super-secret
node server/callback-consumer/index.mjs
```

With Redis:
```bash
export CALLBACK_CONSUMER_REDIS_URL=redis://127.0.0.1:6379
node server/callback-consumer/index.mjs
```

## Example Scheduler Callback
```bash
curl -X POST http://127.0.0.1:8796/v1/scheduler/cycle \
  -H 'Content-Type: application/json' \
  -H 'X-ForgeOS-Idempotency-Key: forgeos.scheduler:user1:agent1:42:task1' \
  -H 'X-ForgeOS-Leader-Fence-Token: 42' \
  -H 'X-ForgeOS-Agent-Key: user1:agent1' \
  -d '{
    "event":"forgeos.scheduler.cycle",
    "scheduler":{"instanceId":"sched-a","leaderFenceToken":42,"queueTaskId":"task1"},
    "agent":{"id":"agent1","userId":"user1","name":"A1","strategyLabel":"DCA"},
    "market":{"priceUsd":0.12,"dag":{"daaScore":123}}
  }'
```

Duplicate idempotency key returns `200` with `{ duplicate: true }`.
Stale fence token returns `409` with `stale_fence_token`.

## Example Execution Receipt Ingestion
```bash
curl -X POST http://127.0.0.1:8796/v1/execution-receipts \
  -H 'Content-Type: application/json' \
  -d '{
    "txid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "userId":"user1",
    "agentId":"agent1",
    "status":"confirmed",
    "confirmations":3,
    "feeKas":0.0001,
    "broadcastTs":1730000000000,
    "confirmTs":1730000004000,
    "confirmTsSource":"chain",
    "priceAtBroadcastUsd":0.12,
    "priceAtConfirmUsd":0.121
  }'
```

## Key Env Vars
- `PORT` (default `8796`)
- `CALLBACK_CONSUMER_ALLOWED_ORIGINS`
- `CALLBACK_CONSUMER_AUTH_TOKEN` / `CALLBACK_CONSUMER_AUTH_TOKENS`
- `CALLBACK_CONSUMER_AUTH_READS`
- `CALLBACK_CONSUMER_REDIS_URL`
- `CALLBACK_CONSUMER_REDIS_PREFIX`
- `CALLBACK_CONSUMER_REDIS_CONNECT_TIMEOUT_MS`
- `CALLBACK_CONSUMER_IDEMPOTENCY_TTL_MS`
- `CALLBACK_CONSUMER_MAX_EVENTS`
- `CALLBACK_CONSUMER_MAX_RECEIPTS`
- `CALLBACK_CONSUMER_RECEIPT_SSE_HEARTBEAT_MS`
- `CALLBACK_CONSUMER_RECEIPT_SSE_MAX_CLIENTS`
- `CALLBACK_CONSUMER_RECEIPT_SSE_REPLAY_DEFAULT_LIMIT`

## Production Notes
- This service now uses Redis Lua scripts for atomic idempotency + fence checks (when Redis is enabled), but downstream business logic should still persist and enforce idempotency/fence semantics.
- Redis support is optional; without Redis, state is in-memory only.
- Browser UIs can subscribe to `GET /v1/execution-receipts/stream` (SSE) to reduce receipt polling and drive PnL updates from backend receipt ingestion.
