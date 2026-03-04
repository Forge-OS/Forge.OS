/**
 * Forge.OS Strategy Leaderboard Server
 *
 * Privacy-safe: stores only backtest metrics + opaque config hash.
 * No wallet addresses, balances, or user identity ever accepted.
 *
 * Redis sorted sets:
 *   forgeos:leaderboard:sharpe   → ZADD {sharpe} {configHash}
 *   forgeos:leaderboard:returns  → ZADD {returnPct} {configHash}
 *   forgeos:leaderboard:meta:{hash} → HSET strategy/risk/actionMode/metrics
 *
 * Endpoints:
 *   POST /leaderboard/submit   — submit backtest result
 *   GET  /leaderboard/top      — fetch top entries (?sort=sharpe|returns&limit=20)
 *   GET  /healthz              — health check
 */

import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { createClient } from "redis";

// ── Config ─────────────────────────────────────────────────────────────────────

const PORT        = Number(process.env.PORT || 8792);
const HOST        = process.env.HOST || "0.0.0.0";
const REDIS_URL   = String(process.env.REDIS_URL || process.env.LEADERBOARD_REDIS_URL || "").trim();
const REDIS_PREFIX = String(process.env.LEADERBOARD_REDIS_PREFIX || "forgeos:leaderboard").trim();
const MAX_TOP     = Math.min(100, Math.max(1, Number(process.env.LEADERBOARD_MAX_TOP || 50)));
const RATE_LIMIT  = Math.max(1, Number(process.env.LEADERBOARD_RATE_LIMIT_PER_HOUR || 10));

const ALLOWED_ORIGINS = String(process.env.LEADERBOARD_ALLOWED_ORIGINS || "*")
  .split(",").map((s) => s.trim()).filter(Boolean);

// ── Redis ──────────────────────────────────────────────────────────────────────

let redis = null;

async function connectRedis() {
  if (!REDIS_URL) {
    console.warn("[leaderboard] REDIS_URL not set — running in memory-only mode");
    return;
  }
  redis = createClient({ url: REDIS_URL, socket: { connectTimeout: 3000 } });
  redis.on("error", (err) => console.error("[leaderboard] redis error:", err.message));
  await redis.connect();
  console.info("[leaderboard] Redis connected");
}

// In-memory fallback when Redis is unavailable
const memSharpe  = new Map(); // hash → sharpe
const memReturns = new Map(); // hash → returnPct
const memMeta    = new Map(); // hash → meta object

async function zadd(key, score, member) {
  if (redis) {
    await redis.zAdd(`${REDIS_PREFIX}:${key}`, { score: Number(score), value: String(member) }, { GT: true });
  } else {
    if (key === "sharpe")  memSharpe.set(member, score);
    if (key === "returns") memReturns.set(member, score);
  }
}

async function zrevrange(key, limit) {
  if (redis) {
    return redis.zRangeWithScores(`${REDIS_PREFIX}:${key}`, 0, limit - 1, { REV: true });
  }
  const map = key === "sharpe" ? memSharpe : memReturns;
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, score]) => ({ value, score }));
}

async function hset(key, fields) {
  if (redis) {
    await redis.hSet(`${REDIS_PREFIX}:${key}`, fields);
    await redis.expire(`${REDIS_PREFIX}:${key}`, 86400 * 30); // 30-day TTL
  } else {
    memMeta.set(key, { ...(memMeta.get(key) || {}), ...fields });
  }
}

async function hgetall(key) {
  if (redis) return redis.hGetAll(`${REDIS_PREFIX}:${key}`);
  return memMeta.get(key) || null;
}

// ── Rate limiting (in-memory, per IP) ─────────────────────────────────────────

const rateLimitMap = new Map(); // ip → { count, windowStart }

function checkRateLimit(ip) {
  const now = Date.now();
  const state = rateLimitMap.get(ip) || { count: 0, windowStart: now };
  if (now - state.windowStart > 3_600_000) {
    state.count = 0;
    state.windowStart = now;
  }
  state.count += 1;
  rateLimitMap.set(ip, state);
  return state.count <= RATE_LIMIT;
}

// ── Input validation ───────────────────────────────────────────────────────────

const ALLOWED_STRATEGIES  = ["yield_harvest","accumulate","dca","swing","momentum","conservative","aggressive","balanced","custom",""];
const ALLOWED_RISK        = ["low","medium","high"];
const ALLOWED_ACTION_MODE = ["accumulate_only","full"];

function validateSubmission(body) {
  if (!body || typeof body !== "object") return "invalid body";
  const { configHash, strategy, risk, actionMode, sharpeRatio, totalReturnPct, maxDrawdownPct, winRatePct, tradeCount, elapsedDays } = body;
  if (typeof configHash !== "string" || !/^[0-9a-f]{16}$/.test(configHash)) return "invalid configHash (must be 16-char hex)";
  if (typeof strategy !== "string" || !ALLOWED_STRATEGIES.includes(strategy)) return `unknown strategy (${strategy})`;
  if (!ALLOWED_RISK.includes(risk)) return `unknown risk (${risk})`;
  if (!ALLOWED_ACTION_MODE.includes(actionMode)) return `unknown actionMode (${actionMode})`;
  if (!Number.isFinite(sharpeRatio)   || sharpeRatio < -10 || sharpeRatio > 10)   return "sharpeRatio out of range";
  if (!Number.isFinite(totalReturnPct)|| totalReturnPct < -100 || totalReturnPct > 10000) return "totalReturnPct out of range";
  if (!Number.isFinite(maxDrawdownPct)|| maxDrawdownPct < 0 || maxDrawdownPct > 100) return "maxDrawdownPct out of range";
  if (!Number.isFinite(winRatePct)    || winRatePct < 0 || winRatePct > 100)       return "winRatePct out of range";
  if (!Number.isFinite(tradeCount)    || tradeCount < 0 || tradeCount > 1_000_000) return "tradeCount out of range";
  if (!Number.isFinite(elapsedDays)   || elapsedDays < 0 || elapsedDays > 3650)    return "elapsedDays out of range";
  return null;
}

// ── CORS ───────────────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// ── HTTP handlers ──────────────────────────────────────────────────────────────

async function handleSubmit(req, res, origin) {
  const ip = req.socket.remoteAddress || "unknown";
  if (!checkRateLimit(ip)) {
    send(res, 429, { error: "rate_limit_exceeded" }, origin);
    return;
  }

  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    send(res, 400, { error: "invalid_json" }, origin);
    return;
  }

  const validErr = validateSubmission(body);
  if (validErr) {
    send(res, 422, { error: validErr }, origin);
    return;
  }

  const { configHash, strategy, risk, actionMode, sharpeRatio, totalReturnPct, maxDrawdownPct, winRatePct, tradeCount, elapsedDays } = body;

  try {
    await zadd("sharpe",  sharpeRatio,   configHash);
    await zadd("returns", totalReturnPct, configHash);
    await hset(`meta:${configHash}`, {
      configHash,
      strategy:       String(strategy),
      risk:           String(risk),
      actionMode:     String(actionMode),
      sharpeRatio:    String(Number(sharpeRatio).toFixed(3)),
      totalReturnPct: String(Number(totalReturnPct).toFixed(2)),
      maxDrawdownPct: String(Number(maxDrawdownPct).toFixed(2)),
      winRatePct:     String(Number(winRatePct).toFixed(1)),
      tradeCount:     String(Math.round(tradeCount)),
      elapsedDays:    String(Number(elapsedDays).toFixed(1)),
      submittedAt:    String(Date.now()),
    });
    send(res, 200, { ok: true, configHash }, origin);
  } catch (err) {
    console.error("[leaderboard] submit error:", err);
    send(res, 500, { error: "storage_error" }, origin);
  }
}

async function handleTop(req, res, origin, searchParams) {
  const sortKey = searchParams.get("sort") === "returns" ? "returns" : "sharpe";
  const limit   = Math.min(MAX_TOP, Math.max(1, Number(searchParams.get("limit") || 20)));

  try {
    const entries = await zrevrange(sortKey, limit);
    const results = await Promise.all(
      entries.map(async ({ value: hash, score }) => {
        const meta = await hgetall(`meta:${hash}`);
        return meta ? { ...meta, score: Number(score) } : { configHash: hash, score: Number(score) };
      }),
    );
    send(res, 200, { ok: true, sort: sortKey, entries: results.filter(Boolean) }, origin);
  } catch (err) {
    console.error("[leaderboard] top error:", err);
    send(res, 500, { error: "fetch_error" }, origin);
  }
}

// ── HTTP server ────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, body, origin) {
  const headers = { "Content-Type": "application/json", ...corsHeaders(origin) };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost`);
  const origin = req.headers.origin || "*";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (url.pathname === "/healthz") {
    send(res, 200, { ok: true, redis: Boolean(redis) }, origin);
    return;
  }

  if (url.pathname === "/leaderboard/submit" && req.method === "POST") {
    await handleSubmit(req, res, origin);
    return;
  }

  if (url.pathname === "/leaderboard/top" && req.method === "GET") {
    await handleTop(req, res, origin, url.searchParams);
    return;
  }

  send(res, 404, { error: "not_found" }, origin);
});

// ── Boot ───────────────────────────────────────────────────────────────────────

(async () => {
  await connectRedis().catch((err) => {
    console.warn("[leaderboard] Redis connect failed; using in-memory fallback:", err.message);
  });
  server.listen(PORT, HOST, () => {
    console.info(`[leaderboard] listening on ${HOST}:${PORT}`);
  });
})();

export default server;
