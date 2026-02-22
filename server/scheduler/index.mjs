import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { createClient } from "redis";

const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || "0.0.0.0";
const KAS_API_BASE = String(process.env.KAS_API_BASE || process.env.VITE_KAS_API_MAINNET || "https://api.kaspa.org").replace(/\/+$/, "");
const KAS_API_TIMEOUT_MS = Math.max(1000, Number(process.env.KAS_API_TIMEOUT_MS || 5000));
const MARKET_CACHE_TTL_MS = Math.max(250, Number(process.env.SCHEDULER_MARKET_CACHE_TTL_MS || 2000));
const BALANCE_CACHE_TTL_MS = Math.max(250, Number(process.env.SCHEDULER_BALANCE_CACHE_TTL_MS || 2500));
const TICK_MS = Math.max(250, Number(process.env.SCHEDULER_TICK_MS || 1000));
const CYCLE_CONCURRENCY = Math.max(1, Number(process.env.SCHEDULER_CYCLE_CONCURRENCY || 4));
const MAX_SCHEDULED_AGENTS = Math.max(1, Number(process.env.SCHEDULER_MAX_AGENTS || 5000));
const MAX_QUEUE_DEPTH = Math.max(1, Number(process.env.SCHEDULER_MAX_QUEUE || 10000));
const CALLBACK_TIMEOUT_MS = Math.max(500, Number(process.env.SCHEDULER_CALLBACK_TIMEOUT_MS || 4000));
const ALLOWED_ORIGINS = String(process.env.SCHEDULER_ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const AUTH_TOKENS = String(process.env.SCHEDULER_AUTH_TOKENS || process.env.SCHEDULER_AUTH_TOKEN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const REQUIRE_AUTH_FOR_READS = /^(1|true|yes)$/i.test(String(process.env.SCHEDULER_AUTH_READS || "false"));
const REDIS_URL = String(process.env.SCHEDULER_REDIS_URL || process.env.REDIS_URL || "").trim();
const REDIS_PREFIX = String(process.env.SCHEDULER_REDIS_PREFIX || "forgeos:scheduler").trim() || "forgeos:scheduler";
const REDIS_CONNECT_TIMEOUT_MS = Math.max(250, Number(process.env.SCHEDULER_REDIS_CONNECT_TIMEOUT_MS || 2000));
const REDIS_AUTHORITATIVE_QUEUE =
  /^(1|true|yes)$/i.test(String(process.env.SCHEDULER_REDIS_AUTHORITATIVE_QUEUE || "true"));
const INSTANCE_ID = String(process.env.SCHEDULER_INSTANCE_ID || crypto.randomUUID()).slice(0, 120);
const LEADER_LOCK_TTL_MS = Math.max(1000, Number(process.env.SCHEDULER_LEADER_LOCK_TTL_MS || 5000));
const LEADER_LOCK_RENEW_MS = Math.max(500, Number(process.env.SCHEDULER_LEADER_LOCK_RENEW_MS || Math.floor(LEADER_LOCK_TTL_MS / 2)));
const LEADER_LOCK_RENEW_JITTER_MS = Math.max(0, Number(process.env.SCHEDULER_LEADER_LOCK_RENEW_JITTER_MS || 250));
const LEADER_ACQUIRE_BACKOFF_MIN_MS = Math.max(50, Number(process.env.SCHEDULER_LEADER_ACQUIRE_BACKOFF_MIN_MS || 150));
const LEADER_ACQUIRE_BACKOFF_MAX_MS = Math.max(
  LEADER_ACQUIRE_BACKOFF_MIN_MS,
  Number(process.env.SCHEDULER_LEADER_ACQUIRE_BACKOFF_MAX_MS || 2000)
);
const JOB_LEASE_TTL_MS = Math.max(1000, Number(process.env.SCHEDULER_JOB_LEASE_TTL_MS || 15000));
const MAX_REDIS_DUE_CLAIMS_PER_TICK = Math.max(1, Number(process.env.SCHEDULER_MAX_DUE_CLAIMS_PER_TICK || CYCLE_CONCURRENCY * 2));
const REDIS_EXEC_LEASE_TTL_MS = Math.max(
  2000,
  Number(process.env.SCHEDULER_REDIS_EXEC_LEASE_TTL_MS || Math.max(30000, CALLBACK_TIMEOUT_MS + KAS_API_TIMEOUT_MS * 3))
);
const REDIS_EXEC_REQUEUE_BATCH = Math.max(1, Number(process.env.SCHEDULER_REDIS_EXEC_REQUEUE_BATCH || Math.max(10, CYCLE_CONCURRENCY * 4)));
const JWT_HS256_SECRET = String(process.env.SCHEDULER_JWT_HS256_SECRET || "").trim();
const JWT_ISSUER = String(process.env.SCHEDULER_JWT_ISSUER || "").trim();
const JWT_AUDIENCE = String(process.env.SCHEDULER_JWT_AUDIENCE || "").trim();
const JWKS_URL = String(process.env.SCHEDULER_JWKS_URL || process.env.SCHEDULER_OIDC_JWKS_URL || "").trim();
const JWKS_CACHE_TTL_MS = Math.max(1000, Number(process.env.SCHEDULER_JWKS_CACHE_TTL_MS || 300000));
const OIDC_ISSUER = String(process.env.SCHEDULER_OIDC_ISSUER || JWT_ISSUER || "").trim();
const OIDC_DISCOVERY_TTL_MS = Math.max(1000, Number(process.env.SCHEDULER_OIDC_DISCOVERY_TTL_MS || 300000));
const JWKS_ALLOWED_KIDS = String(process.env.SCHEDULER_JWKS_ALLOWED_KIDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const JWKS_REQUIRE_PINNED_KID = /^(1|true|yes)$/i.test(String(process.env.SCHEDULER_JWKS_REQUIRE_PINNED_KID || "false"));
const SERVICE_TOKENS_JSON = String(process.env.SCHEDULER_SERVICE_TOKENS_JSON || "").trim();
const QUOTA_WINDOW_MS = Math.max(1000, Number(process.env.SCHEDULER_QUOTA_WINDOW_MS || 60000));
const QUOTA_READ_MAX = Math.max(1, Number(process.env.SCHEDULER_QUOTA_READ_MAX || 600));
const QUOTA_WRITE_MAX = Math.max(1, Number(process.env.SCHEDULER_QUOTA_WRITE_MAX || 240));
const QUOTA_TICK_MAX = Math.max(1, Number(process.env.SCHEDULER_QUOTA_TICK_MAX || 60));
const CALLBACK_IDEMPOTENCY_TTL_MS = Math.max(1000, Number(process.env.SCHEDULER_CALLBACK_IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000));
const REDIS_RESET_EXEC_QUEUE_ON_BOOT = /^(1|true|yes)$/i.test(String(process.env.SCHEDULER_REDIS_RESET_EXEC_QUEUE_ON_BOOT || "false"));

const agents = new Map();
const cycleQueue = [];
let cycleInFlight = 0;
let isLeader = false;
let leaderLockToken = "";
let leaderLockValue = "";
let leaderFenceToken = 0;
let leaderLastRenewedAt = 0;
let leaderNextRenewAt = 0;
let leaderAcquireBackoffMs = 0;
let leaderAcquireBackoffUntil = 0;
let schedulerTickInFlight = false;
let redisQueuePumpActive = false;

const cache = {
  price: { value: null, ts: 0, inFlight: null },
  blockdag: { value: null, ts: 0, inFlight: null },
  balances: new Map(),
};

const metrics = {
  startedAtMs: Date.now(),
  httpRequestsTotal: 0,
  httpResponsesByRouteStatus: new Map(),
  ticksTotal: 0,
  dueAgentsTotal: 0,
  dispatchQueuedTotal: 0,
  dispatchStartedTotal: 0,
  dispatchCompletedTotal: 0,
  dispatchFailedTotal: 0,
  callbackSuccessTotal: 0,
  callbackErrorTotal: 0,
  callbackDedupeSkippedTotal: 0,
  queueFullTotal: 0,
  schedulerSaturationEventsTotal: 0,
  cacheHits: new Map(),
  cacheMisses: new Map(),
  cacheErrors: new Map(),
  upstreamLatencyMs: newHistogram([50, 100, 250, 500, 1000, 2500, 5000]),
  callbackLatencyMs: newHistogram([50, 100, 250, 500, 1000, 2500, 5000]),
  maxQueueDepthSeen: 0,
  maxInFlightSeen: 0,
  authFailuresTotal: 0,
  redisEnabled: false,
  redisConnected: false,
  redisOpsTotal: 0,
  redisErrorsTotal: 0,
  redisLastError: "",
  redisLoadedAgentsTotal: 0,
  redisAuthoritativeQueueEnabled: false,
  leaderAcquiredTotal: 0,
  leaderRenewFailedTotal: 0,
  leaderActiveMs: 0,
  leaderTransitionsTotal: 0,
  leaderFenceToken: 0,
  leaderAcquireBackoffTotal: 0,
  authSuccessTotal: 0,
  authJwtSuccessTotal: 0,
  authServiceTokenSuccessTotal: 0,
  authJwksSuccessTotal: 0,
  authScopeDeniedTotal: 0,
  quotaChecksTotal: 0,
  quotaExceededTotal: 0,
  redisExecQueueReadyDepth: 0,
  redisExecQueueProcessingDepth: 0,
  redisExecQueueInflightDepth: 0,
  redisExecClaimedTotal: 0,
  redisExecAckedTotal: 0,
  redisExecRequeuedExpiredTotal: 0,
  jwksFetchTotal: 0,
  jwksFetchErrorsTotal: 0,
  jwksCacheHitsTotal: 0,
  oidcDiscoveryFetchTotal: 0,
  oidcDiscoveryFetchErrorsTotal: 0,
  oidcDiscoveryCacheHitsTotal: 0,
  redisExecRecoveredOnBootTotal: 0,
  redisExecResetOnBootTotal: 0,
};
let schedulerSaturated = false;
let redisClient = null;
const quotaFallbackMemory = new Map();
const callbackIdempotencyMemory = new Map();
const jwksCache = {
  ts: 0,
  byKid: new Map(),
};
const oidcDiscoveryCache = {
  ts: 0,
  value: null,
};

const REDIS_KEYS = {
  agents: `${REDIS_PREFIX}:agents`,
  queue: `${REDIS_PREFIX}:cycle_queue`,
  queueProcessing: `${REDIS_PREFIX}:cycle_queue_processing`,
  queuePayloads: `${REDIS_PREFIX}:cycle_queue_payloads`,
  queueInflight: `${REDIS_PREFIX}:cycle_queue_inflight`,
  schedule: `${REDIS_PREFIX}:agent_schedule`,
  leaderLock: `${REDIS_PREFIX}:leader_lock`,
  leaderFence: `${REDIS_PREFIX}:leader_fence`,
  leasesPrefix: `${REDIS_PREFIX}:lease`,
  execLeasesPrefix: `${REDIS_PREFIX}:exec_lease`,
  callbackDedupePrefix: `${REDIS_PREFIX}:callback_dedupe`,
  quotaPrefix: `${REDIS_PREFIX}:quota`,
};

function nowMs() {
  return Date.now();
}

function randInt(maxExclusive) {
  const n = Math.max(1, Number(maxExclusive || 1));
  return Math.floor(Math.random() * n);
}

function jitterMs(maxJitterMs) {
  const span = Math.max(0, Number(maxJitterMs || 0));
  return span > 0 ? randInt(span + 1) : 0;
}

function newHistogram(buckets) {
  return { buckets: [...buckets].sort((a, b) => a - b), counts: new Map(), sum: 0, count: 0 };
}

function observeHistogram(hist, ms) {
  const value = Math.max(0, Number(ms || 0));
  hist.sum += value;
  hist.count += 1;
  for (const bucket of hist.buckets) {
    if (value <= bucket) hist.counts.set(bucket, (hist.counts.get(bucket) || 0) + 1);
  }
}

function inc(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function trackSchedulerLoad() {
  const queueDepth = schedulerUsesRedisAuthoritativeQueue()
    ? Number(metrics.redisExecQueueReadyDepth || 0)
    : cycleQueue.length;
  metrics.maxQueueDepthSeen = Math.max(metrics.maxQueueDepthSeen, queueDepth);
  metrics.maxInFlightSeen = Math.max(metrics.maxInFlightSeen, cycleInFlight);
  const queueRatio = MAX_QUEUE_DEPTH > 0 ? queueDepth / MAX_QUEUE_DEPTH : 0;
  const saturated = queueRatio >= 0.8 || (cycleInFlight >= CYCLE_CONCURRENCY && queueDepth > 0);
  if (saturated && !schedulerSaturated) metrics.schedulerSaturationEventsTotal += 1;
  schedulerSaturated = saturated;
}

function resolveOrigin(req) {
  const origin = req.headers.origin || "*";
  if (ALLOWED_ORIGINS.includes("*")) return typeof origin === "string" ? origin : "*";
  return ALLOWED_ORIGINS.includes(String(origin)) ? String(origin) : "null";
}

function parseServiceTokenRegistry() {
  if (!SERVICE_TOKENS_JSON) return new Map();
  try {
    const parsed = JSON.parse(SERVICE_TOKENS_JSON);
    const entries = Array.isArray(parsed) ? parsed : Object.entries(parsed || {}).map(([token, value]) => ({ token, ...value }));
    const map = new Map();
    for (const entry of entries) {
      const token = String(entry?.token || "").trim();
      if (!token) continue;
      map.set(token, {
        sub: String(entry?.sub || entry?.userId || "service").slice(0, 120),
        scopes: Array.isArray(entry?.scopes)
          ? entry.scopes.map((s) => String(s).trim()).filter(Boolean)
          : String(entry?.scopes || "agent:read agent:write scheduler:tick")
              .split(/[,\s]+/)
              .map((s) => s.trim())
              .filter(Boolean),
        type: "service_token",
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

const SERVICE_TOKEN_REGISTRY = parseServiceTokenRegistry();

function schedulerAuthEnabled() {
  return AUTH_TOKENS.length > 0 || SERVICE_TOKEN_REGISTRY.size > 0 || Boolean(JWT_HS256_SECRET) || Boolean(JWKS_URL) || Boolean(OIDC_ISSUER);
}

function getAuthToken(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  if (/^bearer\s+/i.test(authHeader)) return authHeader.replace(/^bearer\s+/i, "").trim();
  return String(req.headers["x-scheduler-token"] || "").trim();
}

function base64UrlDecode(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 ? "=".repeat(4 - (normalized.length % 4)) : "";
  return Buffer.from(normalized + pad, "base64");
}

async function loadOidcDiscovery(forceRefresh = false) {
  if (!OIDC_ISSUER) return null;
  const now = nowMs();
  if (!forceRefresh && oidcDiscoveryCache.ts > 0 && now - oidcDiscoveryCache.ts < OIDC_DISCOVERY_TTL_MS && oidcDiscoveryCache.value) {
    metrics.oidcDiscoveryCacheHitsTotal += 1;
    return oidcDiscoveryCache.value;
  }
  metrics.oidcDiscoveryFetchTotal += 1;
  const issuerBase = OIDC_ISSUER.replace(/\/+$/, "");
  const discoveryUrl = `${issuerBase}/.well-known/openid-configuration`;
  const res = await fetch(discoveryUrl, { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    metrics.oidcDiscoveryFetchErrorsTotal += 1;
    throw new Error(`oidc_discovery_${res.status}:${text.slice(0, 180)}`);
  }
  const parsed = text ? JSON.parse(text) : {};
  if (String(parsed?.issuer || "").replace(/\/+$/, "") !== issuerBase) {
    metrics.oidcDiscoveryFetchErrorsTotal += 1;
    throw new Error("oidc_discovery_issuer_mismatch");
  }
  const jwksUri = String(parsed?.jwks_uri || "").trim();
  if (!jwksUri) {
    metrics.oidcDiscoveryFetchErrorsTotal += 1;
    throw new Error("oidc_discovery_missing_jwks_uri");
  }
  const value = { issuer: issuerBase, jwksUri };
  oidcDiscoveryCache.ts = nowMs();
  oidcDiscoveryCache.value = value;
  return value;
}

async function resolveJwksUrl(forceRefreshDiscovery = false) {
  if (JWKS_URL) return JWKS_URL;
  const discovery = await loadOidcDiscovery(forceRefreshDiscovery).catch(() => null);
  return String(discovery?.jwksUri || "").trim();
}

function decodeJwtParts(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  try {
    return {
      header: JSON.parse(base64UrlDecode(h).toString("utf8")),
      payload: JSON.parse(base64UrlDecode(p).toString("utf8")),
      signature: s,
      signingInput: `${h}.${p}`,
    };
  } catch {
    return null;
  }
}

function verifyJwtClaims(payload) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expectedIssuer = JWT_ISSUER || OIDC_ISSUER;
  if (payload?.exp && Number(payload.exp) < nowSec) return null;
  if (payload?.nbf && Number(payload.nbf) > nowSec) return null;
  if (expectedIssuer && String(payload?.iss || "").replace(/\/+$/, "") !== expectedIssuer.replace(/\/+$/, "")) return null;
  if (JWT_AUDIENCE) {
    const aud = payload?.aud;
    const audOk = Array.isArray(aud) ? aud.includes(JWT_AUDIENCE) : String(aud || "") === JWT_AUDIENCE;
    if (!audOk) return null;
  }
  return payload;
}

function verifyHs256Jwt(token) {
  if (!JWT_HS256_SECRET) return null;
  const parsed = decodeJwtParts(token);
  if (!parsed) return null;
  const { header, payload, signature, signingInput } = parsed;
  if (String(header?.alg || "") !== "HS256") return null;
  const expected = crypto.createHmac("sha256", JWT_HS256_SECRET).update(signingInput).digest("base64url");
  if (expected !== signature) return null;
  return verifyJwtClaims(payload);
}

async function loadJwks(forceRefresh = false) {
  const jwksUrl = await resolveJwksUrl(forceRefresh && !JWKS_URL);
  if (!jwksUrl) return new Map();
  const now = nowMs();
  if (!forceRefresh && jwksCache.ts > 0 && now - jwksCache.ts < JWKS_CACHE_TTL_MS && jwksCache.byKid.size > 0) {
    metrics.jwksCacheHitsTotal += 1;
    return jwksCache.byKid;
  }
  metrics.jwksFetchTotal += 1;
  try {
    const res = await fetch(jwksUrl, { headers: { Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) throw new Error(`jwks_${res.status}:${text.slice(0, 180)}`);
    const parsed = text ? JSON.parse(text) : {};
    const keys = Array.isArray(parsed?.keys) ? parsed.keys : [];
    const byKid = new Map();
    for (const jwk of keys) {
      const kid = String(jwk?.kid || "").trim();
      if (!kid) continue;
      if (JWKS_ALLOWED_KIDS.length && !JWKS_ALLOWED_KIDS.includes(kid)) continue;
      byKid.set(kid, jwk);
    }
    if (JWKS_REQUIRE_PINNED_KID && JWKS_ALLOWED_KIDS.length && byKid.size === 0) {
      throw new Error("jwks_no_pinned_keys_loaded");
    }
    jwksCache.ts = nowMs();
    jwksCache.byKid = byKid;
    return byKid;
  } catch (e) {
    metrics.jwksFetchErrorsTotal += 1;
    throw e;
  }
}

async function verifyJwksJwt(token) {
  if (!JWKS_URL && !OIDC_ISSUER) return null;
  const parsed = decodeJwtParts(token);
  if (!parsed) return null;
  const { header, payload, signature, signingInput } = parsed;
  const alg = String(header?.alg || "");
  const kid = String(header?.kid || "").trim();
  if (alg !== "RS256" || !kid) return null;
  if (JWKS_ALLOWED_KIDS.length && !JWKS_ALLOWED_KIDS.includes(kid)) {
    if (JWKS_REQUIRE_PINNED_KID) return null;
  }

  const tryVerifyWithMap = (map) => {
    const jwk = map?.get?.(kid);
    if (!jwk) return null;
    try {
      const pub = crypto.createPublicKey({ key: jwk, format: "jwk" });
      const ok = crypto.verify("RSA-SHA256", Buffer.from(signingInput), pub, base64UrlDecode(signature));
      if (!ok) return null;
      return verifyJwtClaims(payload);
    } catch {
      return null;
    }
  };

  let keyMap = await loadJwks(false).catch(() => new Map());
  let verifiedPayload = tryVerifyWithMap(keyMap);
  if (verifiedPayload) return verifiedPayload;

  keyMap = await loadJwks(true).catch(() => new Map());
  verifiedPayload = tryVerifyWithMap(keyMap);
  if (!verifiedPayload) return null;
  return verifiedPayload;
}

function authFromSharedTokens(token) {
  if (!token || !AUTH_TOKENS.includes(token)) return null;
  return {
    type: "shared_token",
    sub: "scheduler-admin",
    scopes: ["admin", "agent:read", "agent:write", "scheduler:tick", "metrics:read"],
    rawToken: token,
  };
}

function authFromServiceRegistry(token) {
  if (!token) return null;
  const record = SERVICE_TOKEN_REGISTRY.get(token);
  if (!record) return null;
  return { ...record, rawToken: token };
}

async function authFromJwt(token) {
  let jwtSource = "";
  let payload = verifyHs256Jwt(token);
  if (payload) jwtSource = "hs256";
  if (!payload) {
    payload = await verifyJwksJwt(token);
    if (payload) jwtSource = "jwks";
  }
  if (!payload) return null;
  const scopes = Array.isArray(payload?.scopes)
    ? payload.scopes
    : String(payload?.scope || payload?.scopes || "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  return {
    type: "jwt",
    jwtSource,
    sub: String(payload?.sub || payload?.userId || "jwt-user").slice(0, 120),
    scopes,
    claims: payload,
    rawToken: token,
  };
}

async function authenticateRequest(req, pathname) {
  const token = getAuthToken(req);
  if (!token) return { principal: null, token: "" };
  const shared = authFromSharedTokens(token) || authFromServiceRegistry(token);
  if (shared) {
    metrics.authSuccessTotal += 1;
    if (shared.type === "service_token") metrics.authServiceTokenSuccessTotal += 1;
    return { principal: shared, token };
  }
  const jwtPrincipal = await authFromJwt(token);
  if (jwtPrincipal) {
    metrics.authSuccessTotal += 1;
    metrics.authJwtSuccessTotal += 1;
    if (String(jwtPrincipal?.jwtSource || "") === "jwks") {
      metrics.authJwksSuccessTotal += 1;
    }
    return { principal: jwtPrincipal, token };
  }
  // If auth is required for this route, invalid token will be handled by requireAuth.
  return { principal: null, token };
}

function routeAccessPolicy(req, pathname) {
  if (req.method === "GET" && pathname === "/health") return { scope: "public", quotaBucket: "public" };
  if (req.method === "GET" && pathname === "/metrics") return { scope: "metrics:read", quotaBucket: "read" };
  if (req.method === "GET" && pathname.startsWith("/v1/")) return { scope: "agent:read", quotaBucket: "read" };
  if (req.method === "POST" && pathname === "/v1/scheduler/tick") return { scope: "scheduler:tick", quotaBucket: "tick" };
  if (req.method === "POST" && pathname.startsWith("/v1/")) return { scope: "agent:write", quotaBucket: "write" };
  return { scope: "public", quotaBucket: "public" };
}

function principalHasScope(principal, scope) {
  if (scope === "public") return true;
  if (!principal) return false;
  const scopes = Array.isArray(principal.scopes) ? principal.scopes : [];
  return scopes.includes("admin") || scopes.includes(scope);
}

function quotaLimitForBucket(bucket) {
  if (bucket === "tick") return QUOTA_TICK_MAX;
  if (bucket === "write") return QUOTA_WRITE_MAX;
  if (bucket === "read") return QUOTA_READ_MAX;
  return Infinity;
}

async function checkQuota(principal, bucket) {
  const limit = quotaLimitForBucket(bucket);
  if (!Number.isFinite(limit)) return { ok: true, remaining: null };
  const subject = String(principal?.sub || "anon").slice(0, 120);
  const windowId = Math.floor(Date.now() / QUOTA_WINDOW_MS);
  const key = `${subject}:${bucket}:${windowId}`;
  metrics.quotaChecksTotal += 1;

  if (redisClient) {
    const count = await redisOp("quota_incr", async (r) => {
      const redisKey = `${REDIS_KEYS.quotaPrefix}:${key}`;
      const value = await r.incr(redisKey);
      if (value === 1) await r.pExpire(redisKey, QUOTA_WINDOW_MS + 1000);
      return value;
    });
    const n = Number(count || 0);
    if (!(n > 0)) return { ok: true, remaining: null };
    if (n > limit) {
      metrics.quotaExceededTotal += 1;
      return { ok: false, remaining: 0, limit, count: n };
    }
    return { ok: true, remaining: Math.max(0, limit - n), limit, count: n };
  }

  const rec = quotaFallbackMemory.get(key);
  const now = Date.now();
  const next = !rec || now > rec.expAt ? { count: 0, expAt: now + QUOTA_WINDOW_MS } : rec;
  next.count += 1;
  quotaFallbackMemory.set(key, next);
  if (quotaFallbackMemory.size > 5000) {
    for (const [k, v] of quotaFallbackMemory.entries()) {
      if (!v || now > v.expAt) quotaFallbackMemory.delete(k);
      if (quotaFallbackMemory.size <= 5000) break;
    }
  }
  if (next.count > limit) {
    metrics.quotaExceededTotal += 1;
    return { ok: false, remaining: 0, limit, count: next.count };
  }
  return { ok: true, remaining: Math.max(0, limit - next.count), limit, count: next.count };
}

function routeRequiresAuth(req, pathname) {
  if (!schedulerAuthEnabled()) return false;
  if (req.method === "OPTIONS") return false;
  if (req.method === "GET" && pathname === "/health") return false;
  if (req.method === "GET" && pathname === "/metrics") return false;
  if (req.method === "GET" && !REQUIRE_AUTH_FOR_READS) return false;
  return true;
}

async function requireAuth(req, res, origin, pathname) {
  if (!routeRequiresAuth(req, pathname)) {
    return { ok: true, principal: null, status: 200 };
  }
  const { principal, token } = await authenticateRequest(req, pathname);
  if (!token || !principal) {
    metrics.authFailuresTotal += 1;
    json(res, 401, { error: { message: "unauthorized" } }, origin);
    return { ok: false, principal: null, status: 401 };
  }
  const policy = routeAccessPolicy(req, pathname);
  if (!principalHasScope(principal, policy.scope)) {
    metrics.authScopeDeniedTotal += 1;
    json(res, 403, { error: { message: "forbidden", required_scope: policy.scope } }, origin);
    return { ok: false, principal, status: 403 };
  }
  const quota = await checkQuota(principal, policy.quotaBucket);
  if (!quota.ok) {
    json(res, 429, { error: { message: "quota_exceeded", bucket: policy.quotaBucket, limit: quota.limit } }, origin);
    return { ok: false, principal, status: 429 };
  }
  return { ok: true, principal, status: 200 };
}

async function redisOp(name, fn) {
  if (!redisClient) return null;
  try {
    metrics.redisOpsTotal += 1;
    return await fn(redisClient);
  } catch (e) {
    metrics.redisErrorsTotal += 1;
    metrics.redisLastError = String(e?.message || e || name).slice(0, 240);
    return null;
  }
}

function json(res, status, body, origin = "*") {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-User-Id,Authorization,X-Scheduler-Token",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("payload_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function recordHttp(routeKey, statusCode, startedAtMs) {
  metrics.httpRequestsTotal += 1;
  inc(metrics.httpResponsesByRouteStatus, `${routeKey}|${statusCode}`);
  if (startedAtMs > 0) {
    // Reuse upstream histogram name would be misleading; callback/upstream are tracked elsewhere.
    // Keep only counters on HTTP path.
  }
}

function normalizeAddress(input) {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return "";
  if (!value.startsWith("kaspa:") && !value.startsWith("kaspatest:")) return "";
  return value;
}

function agentKey(userId, agentId) {
  return `${String(userId || "anon").slice(0, 120)}:${String(agentId || "").slice(0, 120)}`;
}

function defaultAgentRecord(input, userId) {
  const id = String(input?.agentId || input?.id || "").trim();
  if (!id) throw new Error("agent_id_required");
  const address = normalizeAddress(input?.walletAddress);
  if (!address) throw new Error("wallet_address_required");
  const cycleMs = Math.max(1000, Number(input?.cycleIntervalMs || input?.cycleMs || 15000));
  return {
    userId: String(userId || "anon"),
    id,
    name: String(input?.name || id).slice(0, 120),
    walletAddress: address,
    status: String(input?.status || "RUNNING").toUpperCase() === "PAUSED" ? "PAUSED" : "RUNNING",
    cycleIntervalMs: cycleMs,
    callbackUrl: String(input?.callbackUrl || "").trim().slice(0, 500),
    strategyLabel: String(input?.strategyLabel || "Custom").slice(0, 120),
    createdAt: nowMs(),
    updatedAt: nowMs(),
    lastCycleAt: 0,
    nextRunAt: nowMs() + Math.min(cycleMs, 1000),
    lastDispatch: null,
    failureCount: 0,
    queuePending: false,
  };
}

function sanitizeAgentForStorage(agent) {
  if (!agent) return null;
  return {
    ...agent,
    queuePending: Boolean(agent.queuePending),
    lastDispatch: agent.lastDispatch ?? null,
  };
}

async function initRedis() {
  if (!REDIS_URL) return;
  metrics.redisEnabled = true;
  try {
    const client = createClient({ url: REDIS_URL, socket: { reconnectStrategy: (retries) => Math.min(1000 + retries * 250, 5000) } });
    client.on("error", (e) => {
      metrics.redisConnected = false;
      metrics.redisLastError = String(e?.message || e || "redis_error").slice(0, 240);
    });
    client.on("ready", () => {
      metrics.redisConnected = true;
    });
    client.on("end", () => {
      metrics.redisConnected = false;
    });
    await Promise.race([
      client.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`redis_connect_timeout_${REDIS_CONNECT_TIMEOUT_MS}ms`)), REDIS_CONNECT_TIMEOUT_MS)
      ),
    ]);
    redisClient = client;
    metrics.redisConnected = true;
    metrics.redisAuthoritativeQueueEnabled = REDIS_AUTHORITATIVE_QUEUE;
    await loadAgentsFromRedis();
    if (REDIS_RESET_EXEC_QUEUE_ON_BOOT) {
      await redisOp("reset_exec_queue_state_on_boot", (r) =>
        r.del(
          REDIS_KEYS.queue,
          REDIS_KEYS.queueProcessing,
          REDIS_KEYS.queuePayloads,
          REDIS_KEYS.queueInflight
        )
      );
      metrics.redisExecResetOnBootTotal += 1;
    } else {
      await recoverRedisExecutionQueueOnBoot();
    }
    // Rebuild the authoritative schedule from agent records on startup.
    await redisOp("clear_schedule", (r) => r.del(REDIS_KEYS.schedule));
    for (const rec of agents.values()) {
      syncRedisScheduleForAgent(rec);
    }
    await refreshRedisExecutionQueueMetrics();
  } catch (e) {
    metrics.redisConnected = false;
    metrics.redisLastError = String(e?.message || e || "redis_init_failed").slice(0, 240);
    try {
      await redisClient?.disconnect?.();
    } catch {
      // Ignore disconnect failures during degraded startup.
    }
    redisClient = null;
    console.warn(`[forgeos-scheduler] redis init failed: ${metrics.redisLastError}`);
  }
}

async function loadAgentsFromRedis() {
  const raw = await redisOp("hGetAll_agents", (r) => r.hGetAll(REDIS_KEYS.agents));
  if (!raw || typeof raw !== "object") return;
  let loaded = 0;
  for (const [key, jsonValue] of Object.entries(raw)) {
    try {
      const parsed = JSON.parse(String(jsonValue || "{}"));
      if (!parsed || typeof parsed !== "object") continue;
      const userId = String(parsed.userId || key.split(":")[0] || "anon").slice(0, 120);
      const normalized = defaultAgentRecord(
        {
          ...parsed,
          agentId: parsed.id,
          walletAddress: parsed.walletAddress,
          status: parsed.status,
          cycleIntervalMs: parsed.cycleIntervalMs,
          callbackUrl: parsed.callbackUrl,
          strategyLabel: parsed.strategyLabel,
          name: parsed.name,
        },
        userId
      );
      const rehydrated = {
        ...normalized,
        createdAt: Number(parsed.createdAt || normalized.createdAt),
        updatedAt: Number(parsed.updatedAt || normalized.updatedAt),
        lastCycleAt: Number(parsed.lastCycleAt || 0),
        nextRunAt: Number(parsed.nextRunAt || nowMs() + 1000),
        failureCount: Math.max(0, Number(parsed.failureCount || 0)),
        queuePending: false,
        lastDispatch: parsed.lastDispatch ?? null,
      };
      agents.set(key, rehydrated);
      loaded += 1;
    } catch {
      // Ignore malformed agent rows.
    }
  }
  metrics.redisLoadedAgentsTotal = loaded;
}

function persistAgentToRedis(agent) {
  if (!redisClient || !agent?.id || !agent?.userId) return;
  const key = agentKey(agent.userId, agent.id);
  const payload = JSON.stringify(sanitizeAgentForStorage(agent));
  void redisOp("hSet_agent", (r) => r.hSet(REDIS_KEYS.agents, key, payload));
  syncRedisScheduleForAgent(agent);
}

function deleteAgentFromRedis(key) {
  if (!redisClient || !key) return;
  void redisOp("hDel_agent", (r) => r.hDel(REDIS_KEYS.agents, key));
  removeRedisScheduleForAgent(key);
}

function schedulerUsesRedisAuthoritativeQueue() {
  return Boolean(redisClient && metrics.redisConnected && REDIS_AUTHORITATIVE_QUEUE);
}

function leaseKeyForAgent(queueKey) {
  return `${REDIS_KEYS.leasesPrefix}:${queueKey}`;
}

function execLeaseKeyForTask(taskId) {
  return `${REDIS_KEYS.execLeasesPrefix}:${taskId}`;
}

function buildAgentCycleTask(queueKey) {
  return {
    id: crypto.randomUUID(),
    kind: "agent_cycle",
    queueKey: String(queueKey || ""),
    enqueuedAt: nowMs(),
    leaderFenceToken: Number(leaderFenceToken || 0),
    instanceId: INSTANCE_ID,
  };
}

function parseExecutionTask(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || String(parsed?.kind || "") !== "agent_cycle") return null;
    const queueKey = String(parsed?.queueKey || "").trim();
    if (!queueKey) return null;
    return {
      id: String(parsed?.id || "").trim() || crypto.randomUUID(),
      kind: "agent_cycle",
      queueKey,
      enqueuedAt: Number(parsed?.enqueuedAt || nowMs()),
      leaderFenceToken: Math.max(0, Number(parsed?.leaderFenceToken || 0)),
      instanceId: String(parsed?.instanceId || "").slice(0, 120),
    };
  } catch {
    return null;
  }
}

async function refreshRedisExecutionQueueMetrics() {
  if (!schedulerUsesRedisAuthoritativeQueue()) {
    metrics.redisExecQueueReadyDepth = 0;
    metrics.redisExecQueueProcessingDepth = 0;
    metrics.redisExecQueueInflightDepth = 0;
    trackSchedulerLoad();
    return;
  }
  const [ready, processing, inflight] = await Promise.all([
    redisOp("llen_exec_ready", (r) => r.lLen(REDIS_KEYS.queue)),
    redisOp("llen_exec_processing", (r) => r.lLen(REDIS_KEYS.queueProcessing)),
    redisOp("zcard_exec_inflight", (r) => r.zCard(REDIS_KEYS.queueInflight)),
  ]);
  metrics.redisExecQueueReadyDepth = Math.max(0, Number(ready || 0));
  metrics.redisExecQueueProcessingDepth = Math.max(0, Number(processing || 0));
  metrics.redisExecQueueInflightDepth = Math.max(0, Number(inflight || 0));
  trackSchedulerLoad();
}

async function enqueueRedisExecutionTask(task) {
  if (!schedulerUsesRedisAuthoritativeQueue()) throw new Error("redis_execution_queue_unavailable");
  const parsedTask = parseExecutionTask(task);
  if (!parsedTask) throw new Error("invalid_execution_task");

  const [readyDepth, inflightDepth] = await Promise.all([
    redisOp("llen_exec_ready_pre_enqueue", (r) => r.lLen(REDIS_KEYS.queue)),
    redisOp("zcard_exec_inflight_pre_enqueue", (r) => r.zCard(REDIS_KEYS.queueInflight)),
  ]);
  const totalDepth = Number(readyDepth || 0) + Number(inflightDepth || 0);
  if (totalDepth >= MAX_QUEUE_DEPTH) {
    metrics.queueFullTotal += 1;
    await refreshRedisExecutionQueueMetrics();
    throw new Error("scheduler_queue_full");
  }

  const payload = JSON.stringify(parsedTask);
  const taskId = parsedTask.id;
  const enqueueOk = await redisOp("enqueue_exec_task", async (r) => {
    const multi = r.multi();
    multi.hSet(REDIS_KEYS.queuePayloads, taskId, payload);
    multi.rPush(REDIS_KEYS.queue, taskId);
    return multi.exec();
  });
  if (!enqueueOk) throw new Error("redis_execution_enqueue_failed");
  metrics.dispatchQueuedTotal += 1;
  await refreshRedisExecutionQueueMetrics();
}

async function claimRedisExecutionTask() {
  if (!schedulerUsesRedisAuthoritativeQueue()) return null;
  const leaseOwner = JSON.stringify({
    instanceId: INSTANCE_ID,
    leaderFenceToken: Number(leaderFenceToken || 0),
    ts: nowMs(),
  });
  const now = nowMs();
  const script = `
    local id = redis.call("LPOP", KEYS[1])
    if not id then
      return nil
    end
    redis.call("RPUSH", KEYS[2], id)
    local payload = redis.call("HGET", KEYS[3], id)
    if not payload then
      redis.call("LREM", KEYS[2], 1, id)
      return {id, ""}
    end
    redis.call("SET", ARGV[1] .. id, ARGV[2], "PX", tonumber(ARGV[3]))
    redis.call("ZADD", KEYS[4], tonumber(ARGV[4]), id)
    return {id, payload}
  `;
  const result = await redisOp("claim_exec_task", (r) =>
    r.eval(script, {
      keys: [REDIS_KEYS.queue, REDIS_KEYS.queueProcessing, REDIS_KEYS.queuePayloads, REDIS_KEYS.queueInflight],
      arguments: [
        `${REDIS_KEYS.execLeasesPrefix}:`,
        leaseOwner,
        String(REDIS_EXEC_LEASE_TTL_MS),
        String(now + REDIS_EXEC_LEASE_TTL_MS),
      ],
    })
  );
  if (!Array.isArray(result) || !result[0]) {
    await refreshRedisExecutionQueueMetrics();
    return null;
  }
  const taskId = String(result[0] || "").trim();
  const payload = String(result[1] || "");
  if (!taskId || !payload) {
    await ackRedisExecutionTask(taskId);
    return null;
  }
  const task = parseExecutionTask(payload);
  if (!task) {
    await ackRedisExecutionTask(taskId);
    return null;
  }
  metrics.redisExecClaimedTotal += 1;
  await refreshRedisExecutionQueueMetrics();
  return task;
}

async function ackRedisExecutionTask(taskId) {
  const id = String(taskId || "").trim();
  if (!schedulerUsesRedisAuthoritativeQueue() || !id) return;
  const script = `
    redis.call("LREM", KEYS[1], 1, ARGV[1])
    redis.call("ZREM", KEYS[2], ARGV[1])
    redis.call("HDEL", KEYS[3], ARGV[1])
    redis.call("DEL", ARGV[2] .. ARGV[1])
    return 1
  `;
  await redisOp("ack_exec_task", (r) =>
    r.eval(script, {
      keys: [REDIS_KEYS.queueProcessing, REDIS_KEYS.queueInflight, REDIS_KEYS.queuePayloads],
      arguments: [id, `${REDIS_KEYS.execLeasesPrefix}:`],
    })
  );
  metrics.redisExecAckedTotal += 1;
  await refreshRedisExecutionQueueMetrics();
}

async function requeueExpiredRedisExecutionTasks(limit = REDIS_EXEC_REQUEUE_BATCH) {
  if (!schedulerUsesRedisAuthoritativeQueue()) return 0;
  const expiredIds = await redisOp("zRangeByScore_exec_inflight_expired", (r) =>
    r.zRangeByScore(REDIS_KEYS.queueInflight, 0, nowMs(), { LIMIT: { offset: 0, count: limit } })
  );
  if (!Array.isArray(expiredIds) || !expiredIds.length) return 0;
  let requeued = 0;
  for (const rawId of expiredIds) {
    const id = String(rawId || "").trim();
    if (!id) continue;
    const leaseExists = await redisOp("exists_exec_lease", (r) => r.exists(execLeaseKeyForTask(id)));
    if (Number(leaseExists || 0) > 0) continue;
    const hasPayload = await redisOp("hExists_exec_payload", (r) => r.hExists(REDIS_KEYS.queuePayloads, id));
    await redisOp("cleanup_expired_exec_tracking", async (r) => {
      const multi = r.multi();
      multi.zRem(REDIS_KEYS.queueInflight, id);
      multi.lRem(REDIS_KEYS.queueProcessing, 1, id);
      if (hasPayload) multi.rPush(REDIS_KEYS.queue, id);
      return multi.exec();
    });
    if (hasPayload) {
      requeued += 1;
      metrics.redisExecRequeuedExpiredTotal += 1;
    }
  }
  if (requeued > 0) await refreshRedisExecutionQueueMetrics();
  return requeued;
}

async function recoverRedisExecutionQueueOnBoot() {
  if (!schedulerUsesRedisAuthoritativeQueue()) return;
  const processingIds = await redisOp("lRange_exec_processing_boot_recovery", (r) => r.lRange(REDIS_KEYS.queueProcessing, 0, -1));
  let recovered = 0;
  if (Array.isArray(processingIds) && processingIds.length) {
    for (const rawId of processingIds) {
      const id = String(rawId || "").trim();
      if (!id) continue;
      const leaseExists = await redisOp("exists_exec_lease_boot_recovery", (r) => r.exists(execLeaseKeyForTask(id)));
      if (Number(leaseExists || 0) > 0) continue;
      const hasPayload = await redisOp("hExists_exec_payload_boot_recovery", (r) => r.hExists(REDIS_KEYS.queuePayloads, id));
      await redisOp("recover_exec_processing_task", async (r) => {
        const multi = r.multi();
        multi.lRem(REDIS_KEYS.queueProcessing, 1, id);
        multi.zRem(REDIS_KEYS.queueInflight, id);
        if (hasPayload) multi.rPush(REDIS_KEYS.queue, id);
        else multi.hDel(REDIS_KEYS.queuePayloads, id);
        return multi.exec();
      });
      if (hasPayload) recovered += 1;
    }
  }
  // Sweep any expired in-flight tasks immediately after boot (instead of waiting for the next pump cycle).
  let requeuedBatch = 0;
  while ((requeuedBatch = await requeueExpiredRedisExecutionTasks(REDIS_EXEC_REQUEUE_BATCH)) > 0) {
    recovered += requeuedBatch;
    if (recovered > MAX_QUEUE_DEPTH * 2) break;
  }
  metrics.redisExecRecoveredOnBootTotal += recovered;
  await refreshRedisExecutionQueueMetrics();
}

function removeLocalQueuedTasksForAgent(queueKey) {
  const key = String(queueKey || "");
  if (!key) return;
  let changed = false;
  for (let i = cycleQueue.length - 1; i >= 0; i -= 1) {
    if (String(cycleQueue[i]?.queueKey || "") === key) {
      cycleQueue.splice(i, 1);
      changed = true;
    }
  }
  if (changed) trackSchedulerLoad();
}

async function removeRedisQueuedTasksForAgent(queueKey) {
  const key = String(queueKey || "");
  if (!schedulerUsesRedisAuthoritativeQueue() || !key) return;
  const payloads = await redisOp("hGetAll_exec_payloads_remove_agent", (r) => r.hGetAll(REDIS_KEYS.queuePayloads));
  if (!payloads || typeof payloads !== "object") return;
  const taskIds = [];
  for (const [taskId, rawPayload] of Object.entries(payloads)) {
    const task = parseExecutionTask(rawPayload);
    if (task && task.queueKey === key) taskIds.push(String(taskId));
  }
  if (!taskIds.length) return;
  await redisOp("remove_agent_exec_tasks", async (r) => {
    const multi = r.multi();
    for (const taskId of taskIds) {
      multi.lRem(REDIS_KEYS.queue, 1, taskId);
      multi.lRem(REDIS_KEYS.queueProcessing, 1, taskId);
      multi.zRem(REDIS_KEYS.queueInflight, taskId);
      multi.hDel(REDIS_KEYS.queuePayloads, taskId);
      multi.del(execLeaseKeyForTask(taskId));
    }
    return multi.exec();
  });
  await refreshRedisExecutionQueueMetrics();
}

function agentScheduleScore(agent) {
  return Math.max(nowMs(), Number(agent?.nextRunAt || 0) || nowMs());
}

function syncRedisScheduleForAgent(agent) {
  if (!redisClient || !agent?.id || !agent?.userId) return;
  const key = agentKey(agent.userId, agent.id);
  if (String(agent?.status || "").toUpperCase() !== "RUNNING") {
    void redisOp("zRem_schedule_pause", (r) => r.zRem(REDIS_KEYS.schedule, key));
    return;
  }
  void redisOp("zAdd_schedule_upsert", (r) =>
    r.zAdd(REDIS_KEYS.schedule, [{ score: agentScheduleScore(agent), value: key }])
  );
}

function removeRedisScheduleForAgent(key) {
  if (!redisClient || !key) return;
  void redisOp("zRem_schedule_remove", (r) => r.zRem(REDIS_KEYS.schedule, key));
  void redisOp("del_agent_lease", (r) => r.del(leaseKeyForAgent(key)));
}

async function hydrateAgentFromRedis(queueKey) {
  if (!redisClient || !queueKey) return null;
  const payload = await redisOp("hGet_agent", (r) => r.hGet(REDIS_KEYS.agents, queueKey));
  if (!payload) return null;
  try {
    const parsed = JSON.parse(String(payload));
    const userId = String(parsed?.userId || queueKey.split(":")[0] || "anon").slice(0, 120);
    const normalized = defaultAgentRecord(
      {
        ...parsed,
        agentId: parsed?.id,
        walletAddress: parsed?.walletAddress,
        status: parsed?.status,
        cycleIntervalMs: parsed?.cycleIntervalMs,
        callbackUrl: parsed?.callbackUrl,
        strategyLabel: parsed?.strategyLabel,
        name: parsed?.name,
      },
      userId
    );
    const rec = {
      ...normalized,
      createdAt: Number(parsed?.createdAt || normalized.createdAt),
      updatedAt: Number(parsed?.updatedAt || normalized.updatedAt),
      lastCycleAt: Number(parsed?.lastCycleAt || 0),
      nextRunAt: Number(parsed?.nextRunAt || nowMs() + 1000),
      failureCount: Math.max(0, Number(parsed?.failureCount || 0)),
      queuePending: Boolean(parsed?.queuePending),
      lastDispatch: parsed?.lastDispatch ?? null,
    };
    agents.set(queueKey, rec);
    return rec;
  } catch {
    return null;
  }
}

async function claimDueAgentsFromRedis(limit = MAX_REDIS_DUE_CLAIMS_PER_TICK) {
  if (!schedulerUsesRedisAuthoritativeQueue()) return [];
  const now = nowMs();
  const claimedKeys = await redisOp("zRangeByScore_schedule_due", (r) =>
    r.zRangeByScore(REDIS_KEYS.schedule, 0, now, { LIMIT: { offset: 0, count: limit } })
  );
  if (!Array.isArray(claimedKeys) || !claimedKeys.length) return [];
  const out = [];
  for (const key of claimedKeys) {
    if (!key) continue;
    const leaseValue = JSON.stringify({
      instanceId: INSTANCE_ID,
      leaderFenceToken: Number(leaderFenceToken || 0),
      ts: nowMs(),
    });
    const leaseOk = await redisOp("set_job_lease", (r) =>
      r.set(leaseKeyForAgent(key), leaseValue, { NX: true, PX: JOB_LEASE_TTL_MS })
    );
    if (leaseOk !== "OK") continue;
    await redisOp("zAdd_schedule_claim_reservation", (r) =>
      r.zAdd(REDIS_KEYS.schedule, [{ score: now + JOB_LEASE_TTL_MS, value: key }])
    );
    out.push(String(key));
  }
  return out;
}

function scheduleNextLeaderRenewAt() {
  leaderNextRenewAt = nowMs() + LEADER_LOCK_RENEW_MS + jitterMs(LEADER_LOCK_RENEW_JITTER_MS);
}

function resetLeaderBackoff() {
  leaderAcquireBackoffMs = 0;
  leaderAcquireBackoffUntil = 0;
}

function bumpLeaderAcquireBackoff() {
  const base = leaderAcquireBackoffMs > 0
    ? Math.min(LEADER_ACQUIRE_BACKOFF_MAX_MS, leaderAcquireBackoffMs * 2)
    : LEADER_ACQUIRE_BACKOFF_MIN_MS;
  leaderAcquireBackoffMs = base;
  leaderAcquireBackoffUntil = nowMs() + base + jitterMs(Math.floor(base / 2));
  metrics.leaderAcquireBackoffTotal += 1;
}

async function acquireOrRenewLeaderLock() {
  if (!schedulerUsesRedisAuthoritativeQueue()) {
    if (isLeader) {
      isLeader = false;
      metrics.leaderTransitionsTotal += 1;
    }
    leaderLockValue = "";
    leaderFenceToken = 0;
    metrics.leaderFenceToken = 0;
    return false;
  }
  const now = nowMs();
  if (!isLeader && leaderAcquireBackoffUntil > now) return false;
  const token = leaderLockToken || `${INSTANCE_ID}:${crypto.randomUUID()}`;
  if (!leaderLockToken) leaderLockToken = token;
  const lockKey = REDIS_KEYS.leaderLock;

  // Fast path renew if we currently believe we are leader.
  if (isLeader) {
    if (leaderNextRenewAt > 0 && now < leaderNextRenewAt) return true;
    const renewed = await redisOp("renew_leader_lock", (r) =>
      r.eval(
        `
          if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2]))
          end
          return 0
        `,
        { keys: [lockKey], arguments: [leaderLockValue, String(LEADER_LOCK_TTL_MS)] }
      )
    );
    if (Number(renewed || 0) > 0) {
      leaderLastRenewedAt = nowMs();
      metrics.leaderFenceToken = leaderFenceToken;
      scheduleNextLeaderRenewAt();
      resetLeaderBackoff();
      return true;
    }
    isLeader = false;
    leaderLockValue = "";
    leaderFenceToken = 0;
    metrics.leaderFenceToken = 0;
    metrics.leaderRenewFailedTotal += 1;
    metrics.leaderTransitionsTotal += 1;
    bumpLeaderAcquireBackoff();
  }

  const acquired = await redisOp("acquire_leader_lock", (r) =>
    r.eval(
      `
        local current = redis.call("GET", KEYS[1])
        if current then
          return {0, current}
        end
        local fence = redis.call("INCR", KEYS[2])
        local value = ARGV[1] .. "|" .. tostring(fence) .. "|" .. ARGV[3]
        redis.call("SET", KEYS[1], value, "PX", tonumber(ARGV[2]))
        return {1, tostring(fence), value}
      `,
      {
        keys: [lockKey, REDIS_KEYS.leaderFence],
        arguments: [token, String(LEADER_LOCK_TTL_MS), INSTANCE_ID],
      }
    )
  );

  if (Array.isArray(acquired) && Number(acquired[0] || 0) === 1) {
    isLeader = true;
    leaderFenceToken = Math.max(0, Number(acquired[1] || 0));
    leaderLockValue = String(acquired[2] || `${token}|${leaderFenceToken}|${INSTANCE_ID}`);
    leaderLastRenewedAt = nowMs();
    metrics.leaderFenceToken = leaderFenceToken;
    metrics.leaderAcquiredTotal += 1;
    metrics.leaderTransitionsTotal += 1;
    scheduleNextLeaderRenewAt();
    resetLeaderBackoff();
    return true;
  }

  bumpLeaderAcquireBackoff();
  return false;
}

async function releaseLeaderLock() {
  if (!redisClient || !leaderLockToken) return;
  const value = leaderLockValue;
  if (!value) {
    if (isLeader) {
      isLeader = false;
      metrics.leaderTransitionsTotal += 1;
    }
    return;
  }
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;
  await redisOp("release_leader_lock", (r) => r.eval(script, { keys: [REDIS_KEYS.leaderLock], arguments: [value] }));
  if (isLeader) {
    isLeader = false;
    metrics.leaderTransitionsTotal += 1;
  }
  leaderFenceToken = 0;
  metrics.leaderFenceToken = 0;
  leaderLockValue = "";
  leaderNextRenewAt = 0;
}

async function fetchKaspaJson(path) {
  const started = nowMs();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), KAS_API_TIMEOUT_MS);
  let observed = false;
  try {
    const res = await fetch(`${KAS_API_BASE}${path}`, { signal: controller.signal, headers: { Accept: "application/json" } });
    const text = await res.text();
    observeHistogram(metrics.upstreamLatencyMs, nowMs() - started);
    observed = true;
    if (!res.ok) throw new Error(`upstream_${res.status}:${text.slice(0, 180)}`);
    return text ? JSON.parse(text) : {};
  } catch (e) {
    if (!observed) observeHistogram(metrics.upstreamLatencyMs, nowMs() - started);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function withCachedEntry(key, state, ttlMs, loader) {
  const now = nowMs();
  if (state.value && now - Number(state.ts || 0) < ttlMs) {
    inc(metrics.cacheHits, key);
    return state.value;
  }
  if (state.inFlight) {
    inc(metrics.cacheHits, `${key}:inflight`);
    return state.inFlight;
  }
  inc(metrics.cacheMisses, key);
  state.inFlight = (async () => {
    try {
      const value = await loader();
      state.value = value;
      state.ts = nowMs();
      return value;
    } catch (e) {
      inc(metrics.cacheErrors, key);
      throw e;
    } finally {
      state.inFlight = null;
    }
  })();
  return state.inFlight;
}

function getBalanceCacheState(address) {
  const key = normalizeAddress(address);
  if (!key) throw new Error("wallet_address_required");
  let entry = cache.balances.get(key);
  if (!entry) {
    entry = { value: null, ts: 0, inFlight: null };
    cache.balances.set(key, entry);
  }
  if (cache.balances.size > 20_000) {
    for (const [addr, st] of cache.balances.entries()) {
      if (nowMs() - Number(st?.ts || 0) > BALANCE_CACHE_TTL_MS * 20) cache.balances.delete(addr);
      if (cache.balances.size <= 20_000) break;
    }
  }
  return entry;
}

async function getPriceSnapshot() {
  return withCachedEntry("price", cache.price, MARKET_CACHE_TTL_MS, async () => {
    const raw = await fetchKaspaJson("/info/price");
    return { priceUsd: Number(raw?.price || raw?.priceUsd || 0), raw };
  });
}

async function getBlockdagSnapshot() {
  return withCachedEntry("blockdag", cache.blockdag, MARKET_CACHE_TTL_MS, async () => {
    const raw = await fetchKaspaJson("/info/blockdag");
    const blockdag = raw?.blockdag || raw;
    const daaScore =
      Number(
        blockdag?.daaScore ??
        blockdag?.virtualDaaScore ??
        blockdag?.virtualDAAScore ??
        blockdag?.headerCount ??
        blockdag?.blockCount ??
        0
      ) || 0;
    return {
      daaScore,
      network: String(blockdag?.networkName || blockdag?.network || ""),
      raw: blockdag,
    };
  });
}

async function getBalanceSnapshot(address) {
  const normalized = normalizeAddress(address);
  const state = getBalanceCacheState(normalized);
  return withCachedEntry(`balance:${normalized.slice(0, 18)}`, state, BALANCE_CACHE_TTL_MS, async () => {
    const encoded = encodeURIComponent(normalized);
    const raw = await fetchKaspaJson(`/addresses/${encoded}/balance`);
    const sompi = Number(raw?.balance ?? raw?.sompi ?? 0);
    return { sompi, kas: sompi / 1e8, raw };
  });
}

async function getSharedMarketSnapshot(address) {
  const [price, blockdag, balance] = await Promise.all([
    getPriceSnapshot(),
    getBlockdagSnapshot(),
    getBalanceSnapshot(address),
  ]);
  return {
    ts: nowMs(),
    address: normalizeAddress(address),
    priceUsd: Number(price?.priceUsd || 0),
    dag: { daaScore: Number(blockdag?.daaScore || 0), network: blockdag?.network || "" },
    walletKas: Number(balance?.kas || 0),
  };
}

async function enqueueCycleTask(task) {
  const parsedTask = parseExecutionTask(task);
  if (!parsedTask) throw new Error("invalid_execution_task");

  if (schedulerUsesRedisAuthoritativeQueue()) {
    await enqueueRedisExecutionTask(parsedTask);
    drainCycleQueue();
    return;
  }

  if (cycleQueue.length >= MAX_QUEUE_DEPTH) {
    metrics.queueFullTotal += 1;
    trackSchedulerLoad();
    throw new Error("scheduler_queue_full");
  }
  cycleQueue.push(parsedTask);
  metrics.dispatchQueuedTotal += 1;
  trackSchedulerLoad();
  drainCycleQueue();
}

async function processCycleTask(task) {
  const parsedTask = parseExecutionTask(task);
  if (!parsedTask) return;
  if (parsedTask.kind !== "agent_cycle") return;
  const key = parsedTask.queueKey;
  try {
    let agent = agents.get(key);
    if (!agent && schedulerUsesRedisAuthoritativeQueue()) {
      agent = await hydrateAgentFromRedis(key);
    }
    if (!agent) return;
    await dispatchAgentCycle(agents.get(key) || agent, {
      leaderFenceToken: parsedTask.leaderFenceToken,
      schedulerInstanceId: parsedTask.instanceId || INSTANCE_ID,
      queueTaskId: parsedTask.id,
    });
  } finally {
    if (schedulerUsesRedisAuthoritativeQueue() && key) {
      await redisOp("del_job_lease_finalize", (r) => r.del(leaseKeyForAgent(key)));
    }
  }
}

async function pumpRedisExecutionQueue() {
  if (redisQueuePumpActive || !schedulerUsesRedisAuthoritativeQueue()) return;
  redisQueuePumpActive = true;
  try {
    await requeueExpiredRedisExecutionTasks();
    while (cycleInFlight < CYCLE_CONCURRENCY) {
      const task = await claimRedisExecutionTask();
      if (!task) break;
      const taskId = String(task.id || "");
      cycleInFlight += 1;
      trackSchedulerLoad();
      void (async () => {
        try {
          await processCycleTask(task);
        } catch {
          // dispatchAgentCycle captures dispatch failures; keep worker pump resilient to unexpected exceptions.
        } finally {
          try {
            await ackRedisExecutionTask(taskId);
          } catch {
            // Keep local worker loop moving even if ack fails; expired in-flight tasks will be requeued.
          }
          cycleInFlight -= 1;
          trackSchedulerLoad();
          drainCycleQueue();
        }
      })();
    }
  } finally {
    redisQueuePumpActive = false;
  }
}

function drainCycleQueue() {
  if (schedulerUsesRedisAuthoritativeQueue()) {
    void pumpRedisExecutionQueue();
    return;
  }
  while (cycleInFlight < CYCLE_CONCURRENCY && cycleQueue.length) {
    const task = cycleQueue.shift();
    cycleInFlight += 1;
    trackSchedulerLoad();
    void processCycleTask(task)
      .catch(() => {})
      .finally(() => {
        cycleInFlight -= 1;
        trackSchedulerLoad();
        drainCycleQueue();
      });
  }
}

async function postCallback(url, payload) {
  const started = nowMs();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);
  try {
    const extraHeaders = payload?.scheduler?.callbackHeaders && typeof payload.scheduler.callbackHeaders === "object"
      ? payload.scheduler.callbackHeaders
      : null;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(extraHeaders || {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    observeHistogram(metrics.callbackLatencyMs, nowMs() - started);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`callback_${res.status}:${txt.slice(0, 180)}`);
    }
    metrics.callbackSuccessTotal += 1;
    return true;
  } catch (e) {
    observeHistogram(metrics.callbackLatencyMs, nowMs() - started);
    metrics.callbackErrorTotal += 1;
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function markCallbackIdempotencyOnce(idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!key) return true;
  if (redisClient) {
    const ok = await redisOp("callback_dedupe_set_nx", (r) =>
      r.set(`${REDIS_KEYS.callbackDedupePrefix}:${key}`, "1", { NX: true, PX: CALLBACK_IDEMPOTENCY_TTL_MS })
    );
    if (ok == null) return true;
    return ok === "OK";
  }
  const now = nowMs();
  const prev = callbackIdempotencyMemory.get(key);
  if (prev && now < prev.expAt) return false;
  callbackIdempotencyMemory.set(key, { expAt: now + CALLBACK_IDEMPOTENCY_TTL_MS });
  if (callbackIdempotencyMemory.size > 50_000) {
    for (const [k, v] of callbackIdempotencyMemory.entries()) {
      if (!v || now >= Number(v.expAt || 0)) callbackIdempotencyMemory.delete(k);
      if (callbackIdempotencyMemory.size <= 50_000) break;
    }
  }
  return true;
}

async function dispatchAgentCycle(agent, meta = {}) {
  if (!agent || agent.status !== "RUNNING") return;
  metrics.dispatchStartedTotal += 1;
  agent.queuePending = false;
  persistAgentToRedis(agent);
  const started = nowMs();
  try {
    const snapshot = await getSharedMarketSnapshot(agent.walletAddress);
    const fenceToken = Math.max(0, Number(meta?.leaderFenceToken || leaderFenceToken || 0));
    const queueTaskId = String(meta?.queueTaskId || "").trim();
    const agentDispatchKey = `${String(agent.userId || "anon")}:${String(agent.id || "")}`;
    const callbackIdempotencyKey = `forgeos.scheduler:${agentDispatchKey}:${fenceToken}:${queueTaskId || Math.floor(started / 1000)}`;
    const callbackHeaders = {
      "X-ForgeOS-Scheduler-Instance": String(meta?.schedulerInstanceId || INSTANCE_ID),
      "X-ForgeOS-Leader-Fence-Token": String(fenceToken),
      "X-ForgeOS-Idempotency-Key": callbackIdempotencyKey,
      ...(queueTaskId ? { "X-ForgeOS-Queue-Task-Id": queueTaskId } : {}),
      "X-ForgeOS-Agent-Key": agentDispatchKey,
    };
    const payload = {
      event: "forgeos.scheduler.cycle",
      ts: nowMs(),
      scheduler: {
        instanceId: String(meta?.schedulerInstanceId || INSTANCE_ID),
        leaderFenceToken: fenceToken,
        queueTaskId: queueTaskId || null,
        callbackIdempotencyKey,
        callbackHeaders,
      },
      agent: {
        id: agent.id,
        userId: agent.userId,
        name: agent.name,
        strategyLabel: agent.strategyLabel,
        cycleIntervalMs: agent.cycleIntervalMs,
      },
      market: snapshot,
    };
    let callbackDeduped = false;
    if (agent.callbackUrl) {
      const shouldSend = await markCallbackIdempotencyOnce(callbackIdempotencyKey);
      if (shouldSend) {
        await postCallback(agent.callbackUrl, payload);
      } else {
        callbackDeduped = true;
        metrics.callbackDedupeSkippedTotal += 1;
      }
    }
    agent.lastCycleAt = nowMs();
    agent.nextRunAt = agent.lastCycleAt + agent.cycleIntervalMs;
    agent.updatedAt = nowMs();
    agent.failureCount = 0;
    agent.lastDispatch = {
      ok: true,
      ts: nowMs(),
      durationMs: nowMs() - started,
      callbackUrl: agent.callbackUrl || null,
      callbackIdempotencyKey,
      callbackDeduped,
      snapshotDaa: Number(snapshot?.dag?.daaScore || 0),
      snapshotPriceUsd: Number(snapshot?.priceUsd || 0),
    };
    metrics.dispatchCompletedTotal += 1;
    persistAgentToRedis(agent);
  } catch (e) {
    agent.failureCount = Number(agent.failureCount || 0) + 1;
    agent.updatedAt = nowMs();
    agent.nextRunAt = nowMs() + Math.min(agent.cycleIntervalMs, 5000);
    agent.lastDispatch = {
      ok: false,
      ts: nowMs(),
      durationMs: nowMs() - started,
      error: String(e?.message || "dispatch_failed").slice(0, 240),
    };
    metrics.dispatchFailedTotal += 1;
    persistAgentToRedis(agent);
  }
}

async function schedulerTick() {
  if (schedulerTickInFlight) return;
  schedulerTickInFlight = true;
  metrics.ticksTotal += 1;
  try {
    if (schedulerUsesRedisAuthoritativeQueue()) {
      const leaderOk = await acquireOrRenewLeaderLock();
      if (leaderOk) {
        leaderLastRenewedAt = nowMs();
        const claimedKeys = await claimDueAgentsFromRedis();
        metrics.dueAgentsTotal += claimedKeys.length;
        for (const key of claimedKeys) {
          let agent = agents.get(key);
          if (!agent) agent = await hydrateAgentFromRedis(key);
          if (!agent) {
            removeRedisScheduleForAgent(key);
            continue;
          }
          if (agent.status !== "RUNNING") {
            removeRedisScheduleForAgent(key);
            continue;
          }
          agent.queuePending = true;
          persistAgentToRedis(agent);
          try {
            await enqueueCycleTask(buildAgentCycleTask(key));
          } catch {
            agent.queuePending = false;
            agent.lastDispatch = {
              ok: false,
              ts: nowMs(),
              error: "scheduler_queue_full",
            };
            agent.failureCount = Number(agent.failureCount || 0) + 1;
            agent.nextRunAt = nowMs() + 3000;
            persistAgentToRedis(agent);
            await redisOp("del_job_lease_queue_full", (r) => r.del(leaseKeyForAgent(key)));
          }
        }
      }
      drainCycleQueue();
      return;
    }

    const now = nowMs();
    let dueCount = 0;
    for (const agent of agents.values()) {
      if (!agent || agent.status !== "RUNNING") continue;
      if (agent.queuePending) continue;
      if (Number(agent.nextRunAt || 0) > now) continue;
      dueCount += 1;
      agent.queuePending = true;
      persistAgentToRedis(agent);
      const key = agentKey(agent.userId, agent.id);
      try {
        await enqueueCycleTask(buildAgentCycleTask(key));
      } catch {
        agent.queuePending = false;
        agent.lastDispatch = {
          ok: false,
          ts: nowMs(),
          error: "scheduler_queue_full",
        };
        agent.failureCount = Number(agent.failureCount || 0) + 1;
        agent.nextRunAt = nowMs() + 3000;
        persistAgentToRedis(agent);
      }
    }
    metrics.dueAgentsTotal += dueCount;
  } finally {
    schedulerTickInFlight = false;
  }
}

function exportPrometheus() {
  const lines = [];
  const push = (line) => lines.push(line);
  push("# HELP forgeos_scheduler_http_requests_total HTTP requests received.");
  push("# TYPE forgeos_scheduler_http_requests_total counter");
  push(`forgeos_scheduler_http_requests_total ${metrics.httpRequestsTotal}`);

  push("# HELP forgeos_scheduler_http_responses_total HTTP responses by route and status.");
  push("# TYPE forgeos_scheduler_http_responses_total counter");
  for (const [key, value] of metrics.httpResponsesByRouteStatus.entries()) {
    const [route, status] = String(key).split("|");
    push(`forgeos_scheduler_http_responses_total{route="${esc(route)}",status="${esc(status)}"} ${value}`);
  }

  push("# HELP forgeos_scheduler_agents_registered Current registered agents.");
  push("# TYPE forgeos_scheduler_agents_registered gauge");
  push(`forgeos_scheduler_agents_registered ${agents.size}`);

  push("# HELP forgeos_scheduler_cycle_queue_depth Current scheduler cycle queue depth.");
  push("# TYPE forgeos_scheduler_cycle_queue_depth gauge");
  push(`forgeos_scheduler_cycle_queue_depth ${cycleQueue.length}`);

  push("# HELP forgeos_scheduler_cycle_in_flight Current scheduler in-flight cycles.");
  push("# TYPE forgeos_scheduler_cycle_in_flight gauge");
  push(`forgeos_scheduler_cycle_in_flight ${cycleInFlight}`);

  push("# HELP forgeos_scheduler_ticks_total Scheduler ticks executed.");
  push("# TYPE forgeos_scheduler_ticks_total counter");
  push(`forgeos_scheduler_ticks_total ${metrics.ticksTotal}`);

  push("# HELP forgeos_scheduler_due_agents_total Due agents scanned across ticks.");
  push("# TYPE forgeos_scheduler_due_agents_total counter");
  push(`forgeos_scheduler_due_agents_total ${metrics.dueAgentsTotal}`);

  push("# HELP forgeos_scheduler_dispatch_queued_total Cycles queued for dispatch.");
  push("# TYPE forgeos_scheduler_dispatch_queued_total counter");
  push(`forgeos_scheduler_dispatch_queued_total ${metrics.dispatchQueuedTotal}`);

  push("# HELP forgeos_scheduler_dispatch_started_total Cycle dispatches started.");
  push("# TYPE forgeos_scheduler_dispatch_started_total counter");
  push(`forgeos_scheduler_dispatch_started_total ${metrics.dispatchStartedTotal}`);

  push("# HELP forgeos_scheduler_dispatch_completed_total Cycle dispatches completed.");
  push("# TYPE forgeos_scheduler_dispatch_completed_total counter");
  push(`forgeos_scheduler_dispatch_completed_total ${metrics.dispatchCompletedTotal}`);

  push("# HELP forgeos_scheduler_dispatch_failed_total Cycle dispatches failed.");
  push("# TYPE forgeos_scheduler_dispatch_failed_total counter");
  push(`forgeos_scheduler_dispatch_failed_total ${metrics.dispatchFailedTotal}`);

  push("# HELP forgeos_scheduler_callback_success_total Callback POST successes.");
  push("# TYPE forgeos_scheduler_callback_success_total counter");
  push(`forgeos_scheduler_callback_success_total ${metrics.callbackSuccessTotal}`);

  push("# HELP forgeos_scheduler_callback_error_total Callback POST failures.");
  push("# TYPE forgeos_scheduler_callback_error_total counter");
  push(`forgeos_scheduler_callback_error_total ${metrics.callbackErrorTotal}`);

  push("# HELP forgeos_scheduler_callback_dedupe_skipped_total Callback sends skipped due to idempotency dedupe.");
  push("# TYPE forgeos_scheduler_callback_dedupe_skipped_total counter");
  push(`forgeos_scheduler_callback_dedupe_skipped_total ${metrics.callbackDedupeSkippedTotal}`);

  push("# HELP forgeos_scheduler_queue_full_total Queue full events.");
  push("# TYPE forgeos_scheduler_queue_full_total counter");
  push(`forgeos_scheduler_queue_full_total ${metrics.queueFullTotal}`);

  push("# HELP forgeos_scheduler_saturation_events_total Scheduler saturation threshold crossings.");
  push("# TYPE forgeos_scheduler_saturation_events_total counter");
  push(`forgeos_scheduler_saturation_events_total ${metrics.schedulerSaturationEventsTotal}`);

  push("# HELP forgeos_scheduler_auth_failures_total Scheduler auth failures.");
  push("# TYPE forgeos_scheduler_auth_failures_total counter");
  push(`forgeos_scheduler_auth_failures_total ${metrics.authFailuresTotal}`);

  push("# HELP forgeos_scheduler_redis_enabled Redis configured for scheduler.");
  push("# TYPE forgeos_scheduler_redis_enabled gauge");
  push(`forgeos_scheduler_redis_enabled ${metrics.redisEnabled ? 1 : 0}`);

  push("# HELP forgeos_scheduler_redis_connected Redis connection status.");
  push("# TYPE forgeos_scheduler_redis_connected gauge");
  push(`forgeos_scheduler_redis_connected ${metrics.redisConnected ? 1 : 0}`);

  push("# HELP forgeos_scheduler_redis_ops_total Redis operations attempted.");
  push("# TYPE forgeos_scheduler_redis_ops_total counter");
  push(`forgeos_scheduler_redis_ops_total ${metrics.redisOpsTotal}`);

  push("# HELP forgeos_scheduler_redis_errors_total Redis operation errors.");
  push("# TYPE forgeos_scheduler_redis_errors_total counter");
  push(`forgeos_scheduler_redis_errors_total ${metrics.redisErrorsTotal}`);

  push("# HELP forgeos_scheduler_redis_authoritative_queue_enabled Redis authoritative queue mode enabled.");
  push("# TYPE forgeos_scheduler_redis_authoritative_queue_enabled gauge");
  push(`forgeos_scheduler_redis_authoritative_queue_enabled ${metrics.redisAuthoritativeQueueEnabled ? 1 : 0}`);

  push("# HELP forgeos_scheduler_redis_exec_queue_ready_depth Redis execution queue ready depth.");
  push("# TYPE forgeos_scheduler_redis_exec_queue_ready_depth gauge");
  push(`forgeos_scheduler_redis_exec_queue_ready_depth ${Number(metrics.redisExecQueueReadyDepth || 0)}`);

  push("# HELP forgeos_scheduler_redis_exec_queue_processing_depth Redis execution queue processing depth.");
  push("# TYPE forgeos_scheduler_redis_exec_queue_processing_depth gauge");
  push(`forgeos_scheduler_redis_exec_queue_processing_depth ${Number(metrics.redisExecQueueProcessingDepth || 0)}`);

  push("# HELP forgeos_scheduler_redis_exec_queue_inflight_depth Redis execution queue inflight zset depth.");
  push("# TYPE forgeos_scheduler_redis_exec_queue_inflight_depth gauge");
  push(`forgeos_scheduler_redis_exec_queue_inflight_depth ${Number(metrics.redisExecQueueInflightDepth || 0)}`);

  push("# HELP forgeos_scheduler_redis_exec_claimed_total Redis execution tasks claimed.");
  push("# TYPE forgeos_scheduler_redis_exec_claimed_total counter");
  push(`forgeos_scheduler_redis_exec_claimed_total ${metrics.redisExecClaimedTotal}`);

  push("# HELP forgeos_scheduler_redis_exec_acked_total Redis execution tasks acknowledged.");
  push("# TYPE forgeos_scheduler_redis_exec_acked_total counter");
  push(`forgeos_scheduler_redis_exec_acked_total ${metrics.redisExecAckedTotal}`);

  push("# HELP forgeos_scheduler_redis_exec_requeued_expired_total Redis execution tasks requeued after expired lease.");
  push("# TYPE forgeos_scheduler_redis_exec_requeued_expired_total counter");
  push(`forgeos_scheduler_redis_exec_requeued_expired_total ${metrics.redisExecRequeuedExpiredTotal}`);

  push("# HELP forgeos_scheduler_redis_exec_recovered_on_boot_total Redis execution tasks recovered/requeued during scheduler startup.");
  push("# TYPE forgeos_scheduler_redis_exec_recovered_on_boot_total counter");
  push(`forgeos_scheduler_redis_exec_recovered_on_boot_total ${metrics.redisExecRecoveredOnBootTotal}`);

  push("# HELP forgeos_scheduler_redis_exec_reset_on_boot_total Redis execution queue resets on boot (debug/legacy mode).");
  push("# TYPE forgeos_scheduler_redis_exec_reset_on_boot_total counter");
  push(`forgeos_scheduler_redis_exec_reset_on_boot_total ${metrics.redisExecResetOnBootTotal}`);

  push("# HELP forgeos_scheduler_leader_active Leader lock status for this instance.");
  push("# TYPE forgeos_scheduler_leader_active gauge");
  push(`forgeos_scheduler_leader_active ${isLeader ? 1 : 0}`);

  push("# HELP forgeos_scheduler_leader_acquired_total Leader lock acquisitions.");
  push("# TYPE forgeos_scheduler_leader_acquired_total counter");
  push(`forgeos_scheduler_leader_acquired_total ${metrics.leaderAcquiredTotal}`);

  push("# HELP forgeos_scheduler_leader_renew_failed_total Leader renew failures.");
  push("# TYPE forgeos_scheduler_leader_renew_failed_total counter");
  push(`forgeos_scheduler_leader_renew_failed_total ${metrics.leaderRenewFailedTotal}`);

  push("# HELP forgeos_scheduler_leader_fence_token Current leader fencing token for this instance (0 when not leader).");
  push("# TYPE forgeos_scheduler_leader_fence_token gauge");
  push(`forgeos_scheduler_leader_fence_token ${Number(metrics.leaderFenceToken || 0)}`);

  push("# HELP forgeos_scheduler_leader_acquire_backoff_total Leader acquire backoff events.");
  push("# TYPE forgeos_scheduler_leader_acquire_backoff_total counter");
  push(`forgeos_scheduler_leader_acquire_backoff_total ${metrics.leaderAcquireBackoffTotal}`);

  push("# HELP forgeos_scheduler_auth_success_total Authenticated requests accepted.");
  push("# TYPE forgeos_scheduler_auth_success_total counter");
  push(`forgeos_scheduler_auth_success_total ${metrics.authSuccessTotal}`);

  push("# HELP forgeos_scheduler_auth_jwks_success_total JWT auth successes validated via JWKS.");
  push("# TYPE forgeos_scheduler_auth_jwks_success_total counter");
  push(`forgeos_scheduler_auth_jwks_success_total ${metrics.authJwksSuccessTotal}`);

  push("# HELP forgeos_scheduler_auth_scope_denied_total Authenticated requests denied by scope.");
  push("# TYPE forgeos_scheduler_auth_scope_denied_total counter");
  push(`forgeos_scheduler_auth_scope_denied_total ${metrics.authScopeDeniedTotal}`);

  push("# HELP forgeos_scheduler_quota_checks_total Quota checks executed.");
  push("# TYPE forgeos_scheduler_quota_checks_total counter");
  push(`forgeos_scheduler_quota_checks_total ${metrics.quotaChecksTotal}`);

  push("# HELP forgeos_scheduler_quota_exceeded_total Quota exceed events.");
  push("# TYPE forgeos_scheduler_quota_exceeded_total counter");
  push(`forgeos_scheduler_quota_exceeded_total ${metrics.quotaExceededTotal}`);

  push("# HELP forgeos_scheduler_jwks_fetch_total JWKS fetch attempts.");
  push("# TYPE forgeos_scheduler_jwks_fetch_total counter");
  push(`forgeos_scheduler_jwks_fetch_total ${metrics.jwksFetchTotal}`);

  push("# HELP forgeos_scheduler_jwks_fetch_errors_total JWKS fetch failures.");
  push("# TYPE forgeos_scheduler_jwks_fetch_errors_total counter");
  push(`forgeos_scheduler_jwks_fetch_errors_total ${metrics.jwksFetchErrorsTotal}`);

  push("# HELP forgeos_scheduler_jwks_cache_hits_total JWKS cache hits.");
  push("# TYPE forgeos_scheduler_jwks_cache_hits_total counter");
  push(`forgeos_scheduler_jwks_cache_hits_total ${metrics.jwksCacheHitsTotal}`);

  push("# HELP forgeos_scheduler_oidc_discovery_fetch_total OIDC discovery fetch attempts.");
  push("# TYPE forgeos_scheduler_oidc_discovery_fetch_total counter");
  push(`forgeos_scheduler_oidc_discovery_fetch_total ${metrics.oidcDiscoveryFetchTotal}`);

  push("# HELP forgeos_scheduler_oidc_discovery_fetch_errors_total OIDC discovery fetch failures.");
  push("# TYPE forgeos_scheduler_oidc_discovery_fetch_errors_total counter");
  push(`forgeos_scheduler_oidc_discovery_fetch_errors_total ${metrics.oidcDiscoveryFetchErrorsTotal}`);

  push("# HELP forgeos_scheduler_oidc_discovery_cache_hits_total OIDC discovery cache hits.");
  push("# TYPE forgeos_scheduler_oidc_discovery_cache_hits_total counter");
  push(`forgeos_scheduler_oidc_discovery_cache_hits_total ${metrics.oidcDiscoveryCacheHitsTotal}`);

  for (const [kind, value] of metrics.cacheHits.entries()) {
    push(`forgeos_scheduler_cache_hits_total{kind="${esc(kind)}"} ${value}`);
  }
  for (const [kind, value] of metrics.cacheMisses.entries()) {
    push(`forgeos_scheduler_cache_misses_total{kind="${esc(kind)}"} ${value}`);
  }
  for (const [kind, value] of metrics.cacheErrors.entries()) {
    push(`forgeos_scheduler_cache_errors_total{kind="${esc(kind)}"} ${value}`);
  }

  appendHistogram(lines, "forgeos_scheduler_upstream_latency_ms", "Kaspa upstream fetch latency (ms).", metrics.upstreamLatencyMs);
  appendHistogram(lines, "forgeos_scheduler_callback_latency_ms", "Callback dispatch latency (ms).", metrics.callbackLatencyMs);

  push("# HELP forgeos_scheduler_uptime_seconds Scheduler uptime seconds.");
  push("# TYPE forgeos_scheduler_uptime_seconds gauge");
  push(`forgeos_scheduler_uptime_seconds ${((nowMs() - metrics.startedAtMs) / 1000).toFixed(3)}`);

  return `${lines.join("\n")}\n`;
}

function appendHistogram(lines, name, help, hist) {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} histogram`);
  for (const bucket of hist.buckets) {
    lines.push(`${name}_bucket{le="${bucket}"} ${Number(hist.counts.get(bucket) || 0)}`);
  }
  lines.push(`${name}_bucket{le="+Inf"} ${hist.count}`);
  lines.push(`${name}_sum ${Number(hist.sum.toFixed(3))}`);
  lines.push(`${name}_count ${hist.count}`);
}

function esc(v) {
  return String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function listAgents(principal = null) {
  const isAdmin = principalHasScope(principal, "admin");
  const subject = String(principal?.sub || "").trim();
  return Array.from(agents.values())
    .filter((agent) => isAdmin || !subject || String(agent?.userId || "") === subject)
    .map((agent) => ({
    id: agent.id,
    userId: agent.userId,
    name: agent.name,
    walletAddress: agent.walletAddress,
    strategyLabel: agent.strategyLabel,
    status: agent.status,
    cycleIntervalMs: agent.cycleIntervalMs,
    nextRunAt: agent.nextRunAt,
    lastCycleAt: agent.lastCycleAt,
    failureCount: agent.failureCount,
    queuePending: agent.queuePending,
    lastDispatch: agent.lastDispatch,
    callbackConfigured: Boolean(agent.callbackUrl),
    updatedAt: agent.updatedAt,
  }));
}

const server = http.createServer(async (req, res) => {
  const origin = resolveOrigin(req);
  const startedAt = nowMs();
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const routeKey = `${req.method || "GET"} ${url.pathname}`;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-User-Id,Authorization,X-Scheduler-Token",
    });
    res.end();
    recordHttp(routeKey, 204, startedAt);
    return;
  }

  const authResult = await requireAuth(req, res, origin, url.pathname);
  if (!authResult.ok) {
    recordHttp(routeKey, Number(authResult.status || 401), startedAt);
    return;
  }
  const principal = authResult.principal;

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      service: "forgeos-scheduler",
      kasApiBase: KAS_API_BASE,
      scheduler: {
        tickMs: TICK_MS,
        queueDepth: schedulerUsesRedisAuthoritativeQueue()
          ? Number(metrics.redisExecQueueReadyDepth || 0)
          : cycleQueue.length,
        queueCapacity: MAX_QUEUE_DEPTH,
        inFlight: cycleInFlight,
        concurrency: CYCLE_CONCURRENCY,
        saturated: schedulerSaturated,
        redisAuthoritativeQueue: schedulerUsesRedisAuthoritativeQueue(),
        redisQueue: schedulerUsesRedisAuthoritativeQueue()
          ? {
              readyDepth: Number(metrics.redisExecQueueReadyDepth || 0),
              processingDepth: Number(metrics.redisExecQueueProcessingDepth || 0),
              inflightDepth: Number(metrics.redisExecQueueInflightDepth || 0),
            }
          : null,
        leader: {
          instanceId: INSTANCE_ID,
          active: isLeader,
          lastRenewedAt: leaderLastRenewedAt || null,
          nextRenewAt: leaderNextRenewAt || null,
          lockTtlMs: LEADER_LOCK_TTL_MS,
          fenceToken: Number(leaderFenceToken || 0),
          acquireBackoffUntil: leaderAcquireBackoffUntil || null,
        },
      },
      auth: {
        enabled: schedulerAuthEnabled(),
        requireAuthForReads: REQUIRE_AUTH_FOR_READS,
        jwtEnabled: Boolean(JWT_HS256_SECRET || JWKS_URL || OIDC_ISSUER),
        jwtHs256Enabled: Boolean(JWT_HS256_SECRET),
        jwksUrlConfigured: Boolean(JWKS_URL),
        oidcIssuerConfigured: Boolean(OIDC_ISSUER),
        jwksPinnedKids: JWKS_ALLOWED_KIDS.length,
        jwksRequirePinnedKid: JWKS_REQUIRE_PINNED_KID,
        serviceTokens: SERVICE_TOKEN_REGISTRY.size,
        quota: {
          windowMs: QUOTA_WINDOW_MS,
          readMax: QUOTA_READ_MAX,
          writeMax: QUOTA_WRITE_MAX,
          tickMax: QUOTA_TICK_MAX,
        },
      },
      redis: {
        enabled: metrics.redisEnabled,
        connected: metrics.redisConnected,
        keyPrefix: REDIS_PREFIX,
        loadedAgents: metrics.redisLoadedAgentsTotal,
        lastError: metrics.redisLastError || null,
        execQueueRecoveredOnBootTotal: metrics.redisExecRecoveredOnBootTotal,
        execQueueResetOnBootTotal: metrics.redisExecResetOnBootTotal,
      },
      agents: {
        count: agents.size,
        running: Array.from(agents.values()).filter((a) => a.status === "RUNNING").length,
        paused: Array.from(agents.values()).filter((a) => a.status === "PAUSED").length,
      },
      cache: {
        priceAgeMs: cache.price.ts ? nowMs() - cache.price.ts : null,
        blockdagAgeMs: cache.blockdag.ts ? nowMs() - cache.blockdag.ts : null,
        balanceEntries: cache.balances.size,
      },
      ts: nowMs(),
    }, origin);
    recordHttp(routeKey, 200, startedAt);
    return;
  }

  if (req.method === "GET" && url.pathname === "/metrics") {
    const body = exportPrometheus();
    res.writeHead(200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Cache-Control": "no-store",
    });
    res.end(body);
    recordHttp(routeKey, 200, startedAt);
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/agents") {
    json(res, 200, { agents: listAgents(principal), ts: nowMs() }, origin);
    recordHttp(routeKey, 200, startedAt);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/agents/register") {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      json(res, 400, { error: { message: String(e?.message || "invalid_json") } }, origin);
      recordHttp(routeKey, 400, startedAt);
      return;
    }
    const userId = String(principal?.sub || req.headers["x-user-id"] || body?.userId || "anon").slice(0, 120);
    try {
      const next = defaultAgentRecord(body, userId);
      const key = agentKey(userId, next.id);
      if (!agents.has(key) && agents.size >= MAX_SCHEDULED_AGENTS) {
        throw new Error("max_agents_reached");
      }
      const prev = agents.get(key);
      const saved = prev ? { ...prev, ...next, createdAt: prev.createdAt, updatedAt: nowMs() } : next;
      agents.set(key, saved);
      persistAgentToRedis(saved);
      json(res, 200, { ok: true, key, agent: saved }, origin);
      recordHttp(routeKey, 200, startedAt);
    } catch (e) {
      json(res, 400, { error: { message: String(e?.message || "register_failed") } }, origin);
      recordHttp(routeKey, 400, startedAt);
    }
    return;
  }

  if (req.method === "POST" && /^\/v1\/agents\/[^/]+\/control$/.test(url.pathname)) {
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      json(res, 400, { error: { message: String(e?.message || "invalid_json") } }, origin);
      recordHttp(routeKey, 400, startedAt);
      return;
    }
    const userId = String(principal?.sub || req.headers["x-user-id"] || body?.userId || "anon").slice(0, 120);
    const agentId = decodeURIComponent(url.pathname.split("/")[3] || "");
    const key = agentKey(userId, agentId);
    const rec = agents.get(key);
    if (!rec) {
      json(res, 404, { error: { message: "agent_not_found", key } }, origin);
      recordHttp(routeKey, 404, startedAt);
      return;
    }
    const action = String(body?.action || "").toLowerCase();
    if (action === "pause") rec.status = "PAUSED";
    else if (action === "resume") rec.status = "RUNNING";
    else if (action === "remove") agents.delete(key);
    else {
      json(res, 400, { error: { message: "invalid_action" } }, origin);
      recordHttp(routeKey, 400, startedAt);
      return;
    }
    if (action !== "remove") {
      rec.updatedAt = nowMs();
      rec.nextRunAt = action === "resume" ? nowMs() + 1000 : rec.nextRunAt;
      rec.queuePending = action === "pause" ? false : rec.queuePending;
      persistAgentToRedis(rec);
    } else {
      removeLocalQueuedTasksForAgent(key);
      await removeRedisQueuedTasksForAgent(key);
      deleteAgentFromRedis(key);
    }
    json(res, 200, { ok: true, action, key, agent: action === "remove" ? null : rec }, origin);
    recordHttp(routeKey, 200, startedAt);
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/market-snapshot") {
    const address = normalizeAddress(url.searchParams.get("address"));
    if (!address) {
      json(res, 400, { error: { message: "address_required" } }, origin);
      recordHttp(routeKey, 400, startedAt);
      return;
    }
    try {
      const snapshot = await getSharedMarketSnapshot(address);
      json(res, 200, {
        snapshot,
        cache: {
          priceAgeMs: cache.price.ts ? nowMs() - cache.price.ts : null,
          blockdagAgeMs: cache.blockdag.ts ? nowMs() - cache.blockdag.ts : null,
          balanceAgeMs: (() => {
            const st = cache.balances.get(address);
            return st?.ts ? nowMs() - st.ts : null;
          })(),
        },
      }, origin);
      recordHttp(routeKey, 200, startedAt);
    } catch (e) {
      json(res, 502, { error: { message: String(e?.message || "snapshot_failed") } }, origin);
      recordHttp(routeKey, 502, startedAt);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/scheduler/tick") {
    await schedulerTick();
    json(res, 200, {
      ok: true,
      ts: nowMs(),
      queueDepth: schedulerUsesRedisAuthoritativeQueue()
        ? Number(metrics.redisExecQueueReadyDepth || 0)
        : cycleQueue.length,
      inFlight: cycleInFlight,
      agents: agents.size,
    }, origin);
    recordHttp(routeKey, 200, startedAt);
    return;
  }

  json(res, 404, { error: { message: "not_found" } }, origin);
  recordHttp(routeKey, 404, startedAt);
});

const tickInterval = setInterval(() => {
  void schedulerTick();
}, TICK_MS);
tickInterval.unref?.();

const leaderRenewInterval = setInterval(() => {
  if (!schedulerUsesRedisAuthoritativeQueue()) return;
  void acquireOrRenewLeaderLock();
}, LEADER_LOCK_RENEW_MS);
leaderRenewInterval.unref?.();

await initRedis();

server.listen(PORT, HOST, () => {
  console.log(`[forgeos-scheduler] listening on http://${HOST}:${PORT}`);
  console.log(
    `[forgeos-scheduler] kas_api=${KAS_API_BASE} tick_ms=${TICK_MS} concurrency=${CYCLE_CONCURRENCY} auth=${schedulerAuthEnabled() ? "on" : "off"} redis=${metrics.redisConnected ? "connected" : metrics.redisEnabled ? "configured" : "off"} queue_mode=${schedulerUsesRedisAuthoritativeQueue() ? "redis-authoritative" : "local"} instance=${INSTANCE_ID}`
  );
});

async function shutdown(signal) {
  try {
    clearInterval(tickInterval);
    clearInterval(leaderRenewInterval);
  } catch {}
  try {
    await releaseLeaderLock();
  } catch {}
  try {
    await redisClient?.quit?.();
  } catch {}
  try {
    server.close?.();
  } catch {}
  if (signal) console.log(`[forgeos-scheduler] shutdown ${signal}`);
}

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
