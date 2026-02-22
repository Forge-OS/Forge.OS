import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || '0.0.0.0';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'claude-sonnet-4-20250514';
const UPSTREAM_URL = process.env.ANTHROPIC_MESSAGES_URL || 'https://api.anthropic.com/v1/messages';
const CONCURRENCY = Math.max(1, Number(process.env.AI_PROXY_CONCURRENCY || 4));
const MAX_QUEUE = Math.max(1, Number(process.env.AI_PROXY_MAX_QUEUE || 200));
const RATE_LIMIT_PER_MIN = Math.max(1, Number(process.env.AI_PROXY_RATE_LIMIT_PER_MIN || 60));
const SOFT_TIMEOUT_MS = Math.max(1000, Number(process.env.AI_PROXY_TIMEOUT_MS || 9000));
const AI_MAX_ATTEMPTS = Math.max(1, Math.min(4, Number(process.env.AI_PROXY_MAX_ATTEMPTS || 2)));
const ALLOWED_ORIGINS = String(process.env.AI_PROXY_ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);

const queue = [];
let inFlight = 0;
const userBuckets = new Map();
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];
const QUEUE_SATURATION_RATIO = Math.max(0.5, Math.min(0.99, Number(process.env.AI_PROXY_QUEUE_SATURATION_RATIO || 0.8)));
const metrics = {
  startedAtMs: Date.now(),
  requestsTotal: 0,
  requestsByRoute: new Map(),
  responsesByRouteStatus: new Map(),
  rateLimitedTotal: 0,
  invalidRequestsTotal: 0,
  queueFullTotal: 0,
  queueSaturationEventsTotal: 0,
  upstreamCallsTotal: 0,
  upstreamSuccessTotal: 0,
  upstreamRetryTotal: 0,
  upstreamErrorsByKind: new Map(),
  maxQueueDepthSeen: 0,
  maxInFlightSeen: 0,
  proxyLatencyMs: newHistogram(LATENCY_BUCKETS_MS),
  upstreamLatencyMs: newHistogram(LATENCY_BUCKETS_MS),
};
let queueSaturationActive = false;

function nowMs() {
  return Date.now();
}

function newHistogram(buckets) {
  return {
    buckets: [...buckets].sort((a, b) => a - b),
    counts: new Map(),
    sum: 0,
    count: 0,
  };
}

function observeHistogram(hist, valueMs) {
  const value = Math.max(0, Number(valueMs || 0));
  hist.sum += value;
  hist.count += 1;
  for (const bucket of hist.buckets) {
    if (value <= bucket) {
      hist.counts.set(bucket, (hist.counts.get(bucket) || 0) + 1);
    }
  }
}

function incMetricMap(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function trackLoadMetrics() {
  metrics.maxQueueDepthSeen = Math.max(metrics.maxQueueDepthSeen, queue.length);
  metrics.maxInFlightSeen = Math.max(metrics.maxInFlightSeen, inFlight);
  const queueRatio = MAX_QUEUE > 0 ? queue.length / MAX_QUEUE : 0;
  const isSaturated = queueRatio >= QUEUE_SATURATION_RATIO || (inFlight >= CONCURRENCY && queue.length > 0);
  if (isSaturated && !queueSaturationActive) {
    metrics.queueSaturationEventsTotal += 1;
  }
  queueSaturationActive = isSaturated;
}

function recordRequest(routeKey) {
  metrics.requestsTotal += 1;
  incMetricMap(metrics.requestsByRoute, routeKey);
}

function recordResponse(routeKey, status, startedAtMs) {
  incMetricMap(metrics.responsesByRouteStatus, `${routeKey}|${String(status)}`);
  if (startedAtMs > 0) observeHistogram(metrics.proxyLatencyMs, nowMs() - startedAtMs);
}

function formatPrometheus() {
  const lines = [];
  const push = (line) => lines.push(line);
  const gauge = (name, value) => push(`${name} ${Number(value)}`);
  const counter = (name, value) => push(`${name} ${Number(value)}`);

  push("# HELP forgeos_ai_proxy_requests_total Total HTTP requests received.");
  push("# TYPE forgeos_ai_proxy_requests_total counter");
  counter("forgeos_ai_proxy_requests_total", metrics.requestsTotal);

  push("# HELP forgeos_ai_proxy_requests_by_route_total HTTP requests by route.");
  push("# TYPE forgeos_ai_proxy_requests_by_route_total counter");
  for (const [key, value] of metrics.requestsByRoute.entries()) {
    push(`forgeos_ai_proxy_requests_by_route_total{route="${escapePromLabel(key)}"} ${value}`);
  }

  push("# HELP forgeos_ai_proxy_http_responses_total HTTP responses by route and status.");
  push("# TYPE forgeos_ai_proxy_http_responses_total counter");
  for (const [key, value] of metrics.responsesByRouteStatus.entries()) {
    const [route, status] = String(key).split("|");
    push(
      `forgeos_ai_proxy_http_responses_total{route="${escapePromLabel(route)}",status="${escapePromLabel(status)}"} ${value}`
    );
  }

  push("# HELP forgeos_ai_proxy_rate_limited_total Requests rejected by rate limiting.");
  push("# TYPE forgeos_ai_proxy_rate_limited_total counter");
  counter("forgeos_ai_proxy_rate_limited_total", metrics.rateLimitedTotal);

  push("# HELP forgeos_ai_proxy_invalid_requests_total Invalid proxy requests.");
  push("# TYPE forgeos_ai_proxy_invalid_requests_total counter");
  counter("forgeos_ai_proxy_invalid_requests_total", metrics.invalidRequestsTotal);

  push("# HELP forgeos_ai_proxy_queue_full_total Requests rejected because queue is full.");
  push("# TYPE forgeos_ai_proxy_queue_full_total counter");
  counter("forgeos_ai_proxy_queue_full_total", metrics.queueFullTotal);

  push("# HELP forgeos_ai_proxy_queue_saturation_events_total Queue saturation threshold crossings.");
  push("# TYPE forgeos_ai_proxy_queue_saturation_events_total counter");
  counter("forgeos_ai_proxy_queue_saturation_events_total", metrics.queueSaturationEventsTotal);

  push("# HELP forgeos_ai_proxy_queue_depth Current proxy queue depth.");
  push("# TYPE forgeos_ai_proxy_queue_depth gauge");
  gauge("forgeos_ai_proxy_queue_depth", queue.length);

  push("# HELP forgeos_ai_proxy_in_flight Current in-flight upstream requests.");
  push("# TYPE forgeos_ai_proxy_in_flight gauge");
  gauge("forgeos_ai_proxy_in_flight", inFlight);

  push("# HELP forgeos_ai_proxy_queue_capacity Configured max queue capacity.");
  push("# TYPE forgeos_ai_proxy_queue_capacity gauge");
  gauge("forgeos_ai_proxy_queue_capacity", MAX_QUEUE);

  push("# HELP forgeos_ai_proxy_concurrency Configured concurrency.");
  push("# TYPE forgeos_ai_proxy_concurrency gauge");
  gauge("forgeos_ai_proxy_concurrency", CONCURRENCY);

  push("# HELP forgeos_ai_proxy_queue_saturation_ratio Current queue depth ratio.");
  push("# TYPE forgeos_ai_proxy_queue_saturation_ratio gauge");
  gauge("forgeos_ai_proxy_queue_saturation_ratio", MAX_QUEUE > 0 ? queue.length / MAX_QUEUE : 0);

  push("# HELP forgeos_ai_proxy_load_saturated 1 when queue/in-flight load is saturated.");
  push("# TYPE forgeos_ai_proxy_load_saturated gauge");
  gauge("forgeos_ai_proxy_load_saturated", queueSaturationActive ? 1 : 0);

  push("# HELP forgeos_ai_proxy_max_queue_depth_seen Maximum queue depth seen since boot.");
  push("# TYPE forgeos_ai_proxy_max_queue_depth_seen gauge");
  gauge("forgeos_ai_proxy_max_queue_depth_seen", metrics.maxQueueDepthSeen);

  push("# HELP forgeos_ai_proxy_max_in_flight_seen Maximum in-flight seen since boot.");
  push("# TYPE forgeos_ai_proxy_max_in_flight_seen gauge");
  gauge("forgeos_ai_proxy_max_in_flight_seen", metrics.maxInFlightSeen);

  push("# HELP forgeos_ai_proxy_upstream_calls_total Upstream AI calls attempted.");
  push("# TYPE forgeos_ai_proxy_upstream_calls_total counter");
  counter("forgeos_ai_proxy_upstream_calls_total", metrics.upstreamCallsTotal);

  push("# HELP forgeos_ai_proxy_upstream_success_total Successful upstream AI calls.");
  push("# TYPE forgeos_ai_proxy_upstream_success_total counter");
  counter("forgeos_ai_proxy_upstream_success_total", metrics.upstreamSuccessTotal);

  push("# HELP forgeos_ai_proxy_upstream_retries_total Upstream retries performed.");
  push("# TYPE forgeos_ai_proxy_upstream_retries_total counter");
  counter("forgeos_ai_proxy_upstream_retries_total", metrics.upstreamRetryTotal);

  push("# HELP forgeos_ai_proxy_upstream_errors_total Upstream errors by kind.");
  push("# TYPE forgeos_ai_proxy_upstream_errors_total counter");
  for (const [kind, value] of metrics.upstreamErrorsByKind.entries()) {
    push(`forgeos_ai_proxy_upstream_errors_total{kind="${escapePromLabel(kind)}"} ${value}`);
  }

  appendPromHistogram(lines, "forgeos_ai_proxy_proxy_latency_ms", "End-to-end proxy request latency (ms).", metrics.proxyLatencyMs);
  appendPromHistogram(lines, "forgeos_ai_proxy_upstream_latency_ms", "Upstream Anthropic request latency (ms).", metrics.upstreamLatencyMs);

  push("# HELP forgeos_ai_proxy_uptime_seconds Proxy uptime in seconds.");
  push("# TYPE forgeos_ai_proxy_uptime_seconds gauge");
  gauge("forgeos_ai_proxy_uptime_seconds", (nowMs() - metrics.startedAtMs) / 1000);

  return `${lines.join("\n")}\n`;
}

function appendPromHistogram(lines, name, help, hist) {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} histogram`);
  for (const bucket of hist.buckets) {
    lines.push(`${name}_bucket{le="${bucket}"} ${Number(hist.counts.get(bucket) || 0)}`);
  }
  lines.push(`${name}_bucket{le="+Inf"} ${hist.count}`);
  lines.push(`${name}_sum ${Number(hist.sum.toFixed(3))}`);
  lines.push(`${name}_count ${hist.count}`);
}

function escapePromLabel(v) {
  return String(v ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function json(res, status, body, origin = '*') {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-User-Id',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function resolveOrigin(req) {
  const origin = req.headers.origin || '*';
  if (ALLOWED_ORIGINS.includes('*')) return typeof origin === 'string' ? origin : '*';
  return ALLOWED_ORIGINS.includes(String(origin)) ? String(origin) : 'null';
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error('payload_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function rateLimitKey(req) {
  const userId = String(req.headers['x-user-id'] || '').trim();
  if (userId) return `user:${userId.slice(0, 120)}`;
  return `ip:${req.socket.remoteAddress || 'unknown'}`;
}

function consumeToken(key) {
  const minute = Math.floor(nowMs() / 60_000);
  const state = userBuckets.get(key) || { minute, used: 0 };
  if (state.minute !== minute) {
    state.minute = minute;
    state.used = 0;
  }
  if (state.used >= RATE_LIMIT_PER_MIN) return false;
  state.used += 1;
  userBuckets.set(key, state);
  if (userBuckets.size > 20_000) {
    for (const [k, v] of userBuckets.entries()) {
      if ((minute - Number(v?.minute || 0)) > 5) userBuckets.delete(k);
      if (userBuckets.size <= 20_000) break;
    }
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt) {
  return 180 * (attempt + 1) + Math.floor(Math.random() * 120);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('upstream_invalid_json_payload');
  }
}

async function callAnthropic(prompt) {
  if (!ANTHROPIC_API_KEY) throw new Error('missing_anthropic_api_key');
  for (let attempt = 0; attempt < AI_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SOFT_TIMEOUT_MS);
    const attemptStartedAt = nowMs();
    let latencyObserved = false;
    metrics.upstreamCallsTotal += 1;
    try {
      const res = await fetch(UPSTREAM_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: AI_MODEL,
          max_tokens: 900,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      observeHistogram(metrics.upstreamLatencyMs, nowMs() - attemptStartedAt);
      latencyObserved = true;
      if (!res.ok) {
        const status = Number(res.status || 0);
        const msg = await res.text().catch(() => '');
        if (RETRYABLE_STATUSES.has(status) && attempt + 1 < AI_MAX_ATTEMPTS) {
          metrics.upstreamRetryTotal += 1;
          incMetricMap(metrics.upstreamErrorsByKind, `http_${status}`);
          await sleep(retryDelayMs(attempt));
          continue;
        }
        incMetricMap(metrics.upstreamErrorsByKind, `http_${status}`);
        throw new Error(`upstream_${res.status}:${msg.slice(0, 180)}`);
      }
      const data = await res.json();
      const text = Array.isArray(data?.content) ? data.content.map((b) => b?.text || '').join('') : '';
      const parsed = safeJsonParse(text.replace(/```json|```/g, '').trim());
      metrics.upstreamSuccessTotal += 1;
      return parsed;
    } catch (e) {
      if (!latencyObserved) observeHistogram(metrics.upstreamLatencyMs, nowMs() - attemptStartedAt);
      const msg = String(e?.message || '');
      const isAbort = e?.name === 'AbortError';
      const isNetwork = e?.name === 'TypeError' || /network|fetch|load failed/i.test(msg);
      if ((isAbort || isNetwork) && attempt + 1 < AI_MAX_ATTEMPTS) {
        metrics.upstreamRetryTotal += 1;
        incMetricMap(metrics.upstreamErrorsByKind, isAbort ? 'timeout' : 'network');
        await sleep(retryDelayMs(attempt));
        continue;
      }
      incMetricMap(metrics.upstreamErrorsByKind, isAbort ? 'timeout' : (isNetwork ? 'network' : 'other'));
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw new Error('upstream_retry_exhausted');
}

function enqueueTask(task) {
  if (queue.length >= MAX_QUEUE) {
    metrics.queueFullTotal += 1;
    trackLoadMetrics();
    throw new Error('queue_full');
  }
  queue.push(task);
  trackLoadMetrics();
  drainQueue();
}

function drainQueue() {
  while (inFlight < CONCURRENCY && queue.length) {
    const task = queue.shift();
    inFlight += 1;
    trackLoadMetrics();
    task()
      .catch(() => {})
      .finally(() => {
        inFlight -= 1;
        trackLoadMetrics();
        drainQueue();
      });
  }
}

const server = http.createServer(async (req, res) => {
  const origin = resolveOrigin(req);
  const reqStartedAt = nowMs();
  const routeKey = (() => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    return `${req.method || 'GET'} ${url.pathname}`;
  })();
  recordRequest(routeKey);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-User-Id',
    });
    res.end();
    recordResponse(routeKey, 204, reqStartedAt);
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      service: 'forgeos-ai-proxy',
      queueDepth: queue.length,
      inFlight,
      concurrency: CONCURRENCY,
      queueCapacity: MAX_QUEUE,
      queueSaturationRatio: MAX_QUEUE > 0 ? Number((queue.length / MAX_QUEUE).toFixed(4)) : 0,
      saturated: queueSaturationActive,
      saturationThresholdRatio: QUEUE_SATURATION_RATIO,
      rateLimitPerMin: RATE_LIMIT_PER_MIN,
      upstreamConfigured: Boolean(ANTHROPIC_API_KEY),
      metrics: {
        requestsTotal: metrics.requestsTotal,
        rateLimitedTotal: metrics.rateLimitedTotal,
        queueFullTotal: metrics.queueFullTotal,
        upstreamCallsTotal: metrics.upstreamCallsTotal,
        upstreamSuccessTotal: metrics.upstreamSuccessTotal,
      },
      ts: nowMs(),
    }, origin);
    recordResponse(routeKey, 200, reqStartedAt);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/metrics') {
    const body = formatPrometheus();
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    recordResponse(routeKey, 200, reqStartedAt);
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/v1/quant-decision' || url.pathname === '/')) {
    const limiterKey = rateLimitKey(req);
    if (!consumeToken(limiterKey)) {
      metrics.rateLimitedTotal += 1;
      json(res, 429, { error: { message: 'rate_limited', key: limiterKey } }, origin);
      recordResponse(routeKey, 429, reqStartedAt);
      return;
    }

    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      metrics.invalidRequestsTotal += 1;
      json(res, 400, { error: { message: e.message || 'invalid_request' } }, origin);
      recordResponse(routeKey, 400, reqStartedAt);
      return;
    }

    const prompt = String(body?.prompt || '').trim();
    if (!prompt) {
      metrics.invalidRequestsTotal += 1;
      json(res, 400, { error: { message: 'prompt_required' } }, origin);
      recordResponse(routeKey, 400, reqStartedAt);
      return;
    }

    try {
      await new Promise((resolve, reject) => {
        enqueueTask(async () => {
          try {
            const decision = await callAnthropic(prompt);
            json(res, 200, {
              decision,
              meta: {
                model: AI_MODEL,
                queueDepth: queue.length,
                inFlight,
                saturated: queueSaturationActive,
                ts: nowMs(),
              },
            }, origin);
            recordResponse(routeKey, 200, reqStartedAt);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    } catch (e) {
      const message = String(e?.message || 'proxy_error');
      const status = message === 'queue_full' ? 503 : message.startsWith('upstream_') ? 502 : 500;
      json(res, status, { error: { message } }, origin);
      recordResponse(routeKey, status, reqStartedAt);
    }
    return;
  }

  json(res, 404, { error: { message: 'not_found' } }, origin);
  recordResponse(routeKey, 404, reqStartedAt);
});

server.listen(PORT, HOST, () => {
  console.log(`[forgeos-ai-proxy] listening on http://${HOST}:${PORT}`);
});
