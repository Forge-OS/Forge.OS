import http from "node:http";
import { URL } from "node:url";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 8795);
const HOST = String(process.env.HOST || "0.0.0.0");
const ALLOWED_ORIGINS = String(process.env.TX_BUILDER_ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const AUTH_TOKENS = String(process.env.TX_BUILDER_AUTH_TOKENS || process.env.TX_BUILDER_AUTH_TOKEN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const REQUIRE_AUTH_FOR_READS = /^(1|true|yes)$/i.test(String(process.env.TX_BUILDER_AUTH_READS || "false"));
const UPSTREAM_URL = String(process.env.TX_BUILDER_UPSTREAM_URL || "").trim();
const UPSTREAM_TOKEN = String(process.env.TX_BUILDER_UPSTREAM_TOKEN || "").trim();
const COMMAND = String(process.env.TX_BUILDER_COMMAND || "").trim();
const COMMAND_TIMEOUT_MS = Math.max(1000, Number(process.env.TX_BUILDER_COMMAND_TIMEOUT_MS || 15000));
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.TX_BUILDER_REQUEST_TIMEOUT_MS || 15000));
const ALLOW_MANUAL_TXJSON = /^(1|true|yes)$/i.test(String(process.env.TX_BUILDER_ALLOW_MANUAL_TXJSON || "false"));

const metrics = {
  startedAtMs: Date.now(),
  httpRequestsTotal: 0,
  httpResponsesByRouteStatus: new Map(),
  authFailuresTotal: 0,
  buildRequestsTotal: 0,
  buildSuccessTotal: 0,
  buildErrorsTotal: 0,
  upstreamRequestsTotal: 0,
  upstreamErrorsTotal: 0,
  commandRequestsTotal: 0,
  commandErrorsTotal: 0,
};

function nowMs() {
  return Date.now();
}

function inc(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function resolveOrigin(req) {
  const origin = req.headers.origin || "*";
  if (ALLOWED_ORIGINS.includes("*")) return typeof origin === "string" ? origin : "*";
  return ALLOWED_ORIGINS.includes(String(origin)) ? String(origin) : "null";
}

function getAuthToken(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  if (/^bearer\s+/i.test(authHeader)) return authHeader.replace(/^bearer\s+/i, "").trim();
  return String(req.headers["x-tx-builder-token"] || "").trim();
}

function authEnabled() {
  return AUTH_TOKENS.length > 0;
}

function routeRequiresAuth(req, pathname) {
  if (!authEnabled()) return false;
  if (req.method === "OPTIONS") return false;
  if (req.method === "GET" && pathname === "/health") return false;
  if (req.method === "GET" && pathname === "/metrics" && !REQUIRE_AUTH_FOR_READS) return false;
  if (req.method === "GET" && !REQUIRE_AUTH_FOR_READS) return false;
  return true;
}

function json(res, status, body, origin = "*") {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Tx-Builder-Token",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function text(res, status, body, origin = "*") {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function recordHttp(routeKey, statusCode) {
  metrics.httpRequestsTotal += 1;
  inc(metrics.httpResponsesByRouteStatus, `${routeKey}|${statusCode}`);
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

function normalizeAddress(input) {
  const v = String(input || "").trim().toLowerCase();
  if (!v) return "";
  if (!v.startsWith("kaspa:") && !v.startsWith("kaspatest:")) return "";
  return v;
}

function normalizeBuildRequest(body) {
  const wallet = String(body?.wallet || "kastle").trim().toLowerCase();
  if (wallet !== "kastle") throw new Error("unsupported_wallet");
  const networkId = String(body?.networkId || "").trim();
  if (networkId !== "mainnet" && networkId !== "testnet-10") throw new Error("invalid_network_id");
  const fromAddress = normalizeAddress(body?.fromAddress);
  if (!fromAddress) throw new Error("invalid_from_address");
  const outputs = Array.isArray(body?.outputs)
    ? body.outputs
        .map((o) => ({
          address: normalizeAddress(o?.address || o?.to),
          amountKas: Number(o?.amountKas ?? o?.amount_kas ?? 0),
        }))
        .filter((o) => o.address && Number.isFinite(o.amountKas) && o.amountKas > 0)
    : [];
  if (!outputs.length) throw new Error("outputs_required");
  const purpose = String(body?.purpose || "").slice(0, 140);
  const manualTxJson = String(body?.txJson || "").trim();
  return { wallet, networkId, fromAddress, outputs, purpose, txJson: manualTxJson };
}

async function proxyToUpstream(payload) {
  metrics.upstreamRequestsTotal += 1;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const res = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(UPSTREAM_TOKEN ? { Authorization: `Bearer ${UPSTREAM_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
      ...(controller ? { signal: controller.signal } : {}),
    });
    const textValue = await res.text();
    if (!res.ok) throw new Error(`upstream_${res.status}:${textValue.slice(0, 200)}`);
    const parsed = textValue ? JSON.parse(textValue) : {};
    const txJson = typeof parsed === "string" ? parsed : String(parsed?.txJson || parsed?.result?.txJson || "").trim();
    if (!txJson) throw new Error("upstream_missing_txJson");
    return { txJson, mode: "upstream" };
  } catch (e) {
    metrics.upstreamErrorsTotal += 1;
    throw e;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function runCommandBuilder(payload) {
  metrics.commandRequestsTotal += 1;
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.SHELL || "sh", ["-lc", COMMAND], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timeoutId = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error(`command_timeout_${COMMAND_TIMEOUT_MS}ms`));
    }, COMMAND_TIMEOUT_MS);
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", (e) => {
      clearTimeout(timeoutId);
      metrics.commandErrorsTotal += 1;
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        metrics.commandErrorsTotal += 1;
        reject(new Error(`command_exit_${code}:${stderr.slice(0, 200)}`));
        return;
      }
      try {
        const parsed = stdout.trim() ? JSON.parse(stdout) : {};
        const txJson = typeof parsed === "string" ? parsed : String(parsed?.txJson || parsed?.result?.txJson || "").trim();
        if (!txJson) throw new Error("command_missing_txJson");
        resolve({ txJson, mode: "command" });
      } catch (e) {
        metrics.commandErrorsTotal += 1;
        reject(e);
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function buildTxJson(payload) {
  if (COMMAND) return runCommandBuilder(payload);
  if (UPSTREAM_URL) return proxyToUpstream(payload);
  if (ALLOW_MANUAL_TXJSON && payload.txJson) return { txJson: payload.txJson, mode: "manual" };
  throw new Error("tx_builder_not_configured");
}

function exportPrometheus() {
  const lines = [];
  const push = (s) => lines.push(s);
  push("# HELP forgeos_tx_builder_http_requests_total HTTP requests received.");
  push("# TYPE forgeos_tx_builder_http_requests_total counter");
  push(`forgeos_tx_builder_http_requests_total ${metrics.httpRequestsTotal}`);
  push("# HELP forgeos_tx_builder_build_requests_total Build requests.");
  push("# TYPE forgeos_tx_builder_build_requests_total counter");
  push(`forgeos_tx_builder_build_requests_total ${metrics.buildRequestsTotal}`);
  push("# HELP forgeos_tx_builder_build_success_total Build successes.");
  push("# TYPE forgeos_tx_builder_build_success_total counter");
  push(`forgeos_tx_builder_build_success_total ${metrics.buildSuccessTotal}`);
  push("# HELP forgeos_tx_builder_build_errors_total Build errors.");
  push("# TYPE forgeos_tx_builder_build_errors_total counter");
  push(`forgeos_tx_builder_build_errors_total ${metrics.buildErrorsTotal}`);
  push("# HELP forgeos_tx_builder_auth_failures_total Auth failures.");
  push("# TYPE forgeos_tx_builder_auth_failures_total counter");
  push(`forgeos_tx_builder_auth_failures_total ${metrics.authFailuresTotal}`);
  push("# HELP forgeos_tx_builder_uptime_seconds Service uptime.");
  push("# TYPE forgeos_tx_builder_uptime_seconds gauge");
  push(`forgeos_tx_builder_uptime_seconds ${((nowMs() - metrics.startedAtMs) / 1000).toFixed(3)}`);
  return `${lines.join("\n")}\n`;
}

const server = http.createServer(async (req, res) => {
  const origin = resolveOrigin(req);
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const routeKey = `${req.method || "GET"} ${url.pathname}`;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Tx-Builder-Token",
    });
    res.end();
    recordHttp(routeKey, 204);
    return;
  }

  if (routeRequiresAuth(req, url.pathname)) {
    const token = getAuthToken(req);
    if (!token || !AUTH_TOKENS.includes(token)) {
      metrics.authFailuresTotal += 1;
      json(res, 401, { error: { message: "unauthorized" } }, origin);
      recordHttp(routeKey, 401);
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      service: "forgeos-tx-builder",
      auth: { enabled: authEnabled(), requireAuthForReads: REQUIRE_AUTH_FOR_READS },
      builder: {
        mode: COMMAND ? "command" : UPSTREAM_URL ? "upstream" : ALLOW_MANUAL_TXJSON ? "manual" : "unconfigured",
        hasCommand: Boolean(COMMAND),
        hasUpstream: Boolean(UPSTREAM_URL),
        allowManualTxJson: ALLOW_MANUAL_TXJSON,
      },
      ts: nowMs(),
    }, origin);
    recordHttp(routeKey, 200);
    return;
  }

  if (req.method === "GET" && url.pathname === "/metrics") {
    text(res, 200, exportPrometheus(), origin);
    recordHttp(routeKey, 200);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/kastle/build-tx-json") {
    metrics.buildRequestsTotal += 1;
    let body;
    try {
      body = await readJson(req);
      const payload = normalizeBuildRequest(body);
      const result = await buildTxJson(payload);
      metrics.buildSuccessTotal += 1;
      json(res, 200, {
        txJson: result.txJson,
        meta: {
          mode: result.mode,
          wallet: payload.wallet,
          networkId: payload.networkId,
          outputs: payload.outputs.length,
          fromAddress: payload.fromAddress,
        },
      }, origin);
      recordHttp(routeKey, 200);
    } catch (e) {
      metrics.buildErrorsTotal += 1;
      json(res, 400, { error: { message: String(e?.message || "build_failed") } }, origin);
      recordHttp(routeKey, 400);
    }
    return;
  }

  json(res, 404, { error: { message: "not_found" } }, origin);
  recordHttp(routeKey, 404);
});

server.listen(PORT, HOST, () => {
  console.log(`[forgeos-tx-builder] listening on http://${HOST}:${PORT}`);
  console.log(
    `[forgeos-tx-builder] auth=${authEnabled() ? "on" : "off"} mode=${COMMAND ? "command" : UPSTREAM_URL ? "upstream" : ALLOW_MANUAL_TXJSON ? "manual" : "unconfigured"}`
  );
});

