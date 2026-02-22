# ForgeOS AI Proxy (Production Scale Starter)

Queueing + per-user rate limiting proxy for ForgeOS real AI overlay traffic.

## Why
- Keep AI keys server-side
- Smooth bursts from many users/agents
- Apply per-user rate limits
- Add an operational chokepoint for logging/monitoring

## Endpoints
- `GET /health`
- `GET /metrics` (Prometheus text metrics)
- `POST /v1/quant-decision`

Request shape (matches ForgeOS frontend proxy mode):
```json
{
  "prompt": "...",
  "agent": {"name":"..."},
  "kasData": {},
  "quantCore": {}
}
```

Response:
```json
{
  "decision": {"action":"ACCUMULATE", "confidence_score": 0.82}
}
```

## Run
```bash
export ANTHROPIC_API_KEY=...
export AI_MODEL=claude-sonnet-4-20250514
node server/ai-proxy/index.mjs
```

Then point frontend env:
- `VITE_AI_API_URL=http://localhost:8788/v1/quant-decision`

## Key env vars
- `PORT` (default `8788`)
- `AI_PROXY_CONCURRENCY` (default `4`)
- `AI_PROXY_MAX_QUEUE` (default `200`)
- `AI_PROXY_QUEUE_SATURATION_RATIO` (default `0.8`)
- `AI_PROXY_RATE_LIMIT_PER_MIN` (default `60`)
- `AI_PROXY_TIMEOUT_MS` (default `9000`)
- `AI_PROXY_ALLOWED_ORIGINS` (default `*`)

## Observability
- `/health` includes queue depth, in-flight, saturation state, and high-level counters
- `/metrics` exposes Prometheus metrics for:
  - queue depth / in-flight / saturation
  - HTTP response codes
  - upstream success/error/retry counters
  - proxy latency and upstream latency histograms
