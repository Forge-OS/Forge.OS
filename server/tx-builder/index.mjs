import http from "node:http";
import { URL } from "node:url";
import { spawn } from "node:child_process";
import { describeLocalTxPolicyConfig, readLocalTxPolicyConfig, selectUtxoEntriesForLocalBuild } from "./localPolicy.mjs";

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
const LOCAL_WASM_ENABLED = /^(1|true|yes)$/i.test(String(process.env.TX_BUILDER_LOCAL_WASM_ENABLED || "false"));
const LOCAL_WASM_JSON_KIND = String(process.env.TX_BUILDER_LOCAL_WASM_JSON_KIND || "transaction").trim().toLowerCase() === "pending"
  ? "pending"
  : "transaction";
const KAS_API_MAINNET = String(process.env.TX_BUILDER_KAS_API_MAINNET || process.env.TX_BUILDER_KAS_API_BASE || "https://api.kaspa.org")
  .trim()
  .replace(/\/+$/, "");
const KAS_API_TESTNET = String(process.env.TX_BUILDER_KAS_API_TESTNET || process.env.TX_BUILDER_KAS_API_BASE || "https://api-tn10.kaspa.org")
  .trim()
  .replace(/\/+$/, "");
const KAS_API_TIMEOUT_MS = Math.max(1000, Number(process.env.TX_BUILDER_KAS_API_TIMEOUT_MS || 12000));
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
  localWasmRequestsTotal: 0,
  localWasmErrorsTotal: 0,
  localWasmUtxoFetchErrorsTotal: 0,
  localWasmPolicySelectedInputsTotal: 0,
  localWasmPolicyTotalInputsSeen: 0,
  localWasmPolicyPriorityFeeSompiTotal: 0,
  localWasmPolicyTruncatedSelectionsTotal: 0,
  localWasmPolicyFallbackAllInputsTotal: 0,
  localWasmPolicySelectionModeTotal: new Map(),
  localWasmPolicyPriorityFeeModeTotal: new Map(),
  upstreamRequestsTotal: 0,
  upstreamErrorsTotal: 0,
  commandRequestsTotal: 0,
  commandErrorsTotal: 0,
};

let kaspaWasmPromise = null;
let localTxPolicyConfig = readLocalTxPolicyConfig();

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
  const priorityFeeSompi = body?.priorityFeeSompi == null ? undefined : Math.max(0, Math.round(Number(body.priorityFeeSompi || 0)));
  const telemetryRaw = body?.telemetry && typeof body.telemetry === "object" ? body.telemetry : {};
  const telemetry = {
    observedConfirmP95Ms:
      telemetryRaw?.observedConfirmP95Ms == null
        ? undefined
        : Math.max(0, Math.round(Number(telemetryRaw.observedConfirmP95Ms || 0))),
    daaCongestionPct:
      telemetryRaw?.daaCongestionPct == null
        ? undefined
        : Math.max(0, Math.min(100, Number(telemetryRaw.daaCongestionPct || 0))),
  };
  return { wallet, networkId, fromAddress, outputs, purpose, txJson: manualTxJson, priorityFeeSompi, telemetry };
}

function amountKasToSompiBigInt(amountKas) {
  const n = Number(amountKas || 0);
  if (!Number.isFinite(n) || n <= 0) throw new Error("invalid_output_amount");
  const sompi = Math.round(n * 1e8);
  if (!(sompi > 0)) throw new Error("invalid_output_amount");
  return BigInt(sompi);
}

function safeJsonStringify(value) {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

function kasApiBaseForNetwork(networkId) {
  return networkId === "testnet-10" ? KAS_API_TESTNET : KAS_API_MAINNET;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const textValue = await res.text();
    if (!res.ok) {
      throw new Error(`upstream_${res.status}:${String(textValue || "").slice(0, 200)}`);
    }
    return textValue ? JSON.parse(textValue) : {};
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function loadKaspaWasm() {
  if (kaspaWasmPromise) return kaspaWasmPromise;
  kaspaWasmPromise = (async () => {
    const wsMod = await import("isomorphic-ws");
    if (typeof globalThis.WebSocket === "undefined") {
      globalThis.WebSocket = wsMod.default || wsMod;
    }
    return import("kaspa-wasm");
  })();
  return kaspaWasmPromise;
}

function normalizeScriptHex(raw) {
  const hex = String(raw || "").trim().toLowerCase();
  if (!hex || /[^0-9a-f]/.test(hex)) return "";
  return hex;
}

function normalizeUtxoEntriesForKaspaWasm(kaspa, fromAddress, payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.utxos) ? payload.utxos : Array.isArray(payload?.entries) ? payload.entries : [];
  if (!list.length) return [];
  const addressJson = new kaspa.Address(fromAddress).toJSON();
  const out = [];
  for (const row of list) {
    const txid = String(row?.outpoint?.transactionId || row?.outpoint?.txid || "").trim().toLowerCase();
    const index = Number(row?.outpoint?.index);
    const amount = Number(row?.utxoEntry?.amount ?? row?.amount);
    const blockDaaScore = Number(row?.utxoEntry?.blockDaaScore ?? row?.blockDaaScore ?? 0);
    const isCoinbase = Boolean(row?.utxoEntry?.isCoinbase ?? row?.isCoinbase);
    const scriptHex = normalizeScriptHex(
      row?.utxoEntry?.scriptPublicKey?.scriptPublicKey ??
      row?.utxoEntry?.scriptPublicKey?.script ??
      row?.scriptPublicKey?.scriptPublicKey ??
      row?.scriptPublicKey?.script
    );
    if (!/^[a-f0-9]{64}$/.test(txid)) continue;
    if (!Number.isFinite(index) || index < 0) continue;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!scriptHex) continue;
    out.push({
      address: addressJson,
      outpoint: { transactionId: txid, index: Math.round(index) },
      utxoEntry: {
        amount: Math.round(amount),
        scriptPublicKey: new kaspa.ScriptPublicKey(0, scriptHex),
        blockDaaScore: Number.isFinite(blockDaaScore) ? Math.max(0, Math.round(blockDaaScore)) : 0,
        isCoinbase,
      },
    });
  }
  return out;
}

async function buildTxJsonLocalWasm(payload) {
  metrics.localWasmRequestsTotal += 1;
  try {
    const kaspa = await loadKaspaWasm();
    const apiBase = kasApiBaseForNetwork(payload.networkId);
    if (!apiBase) throw new Error("kas_api_base_not_configured");
    const utxoPath = `/addresses/${encodeURIComponent(payload.fromAddress)}/utxos`;
    let utxoPayload;
    try {
      utxoPayload = await fetchJsonWithTimeout(`${apiBase}${utxoPath}`, KAS_API_TIMEOUT_MS);
    } catch (e) {
      metrics.localWasmUtxoFetchErrorsTotal += 1;
      throw e;
    }
    const entries = normalizeUtxoEntriesForKaspaWasm(kaspa, payload.fromAddress, utxoPayload);
    if (!entries.length) throw new Error("no_spendable_utxos");

    const changeAddress = new kaspa.Address(payload.fromAddress).toJSON();
    const outputs = payload.outputs.map((o) => {
      const amountSompi = amountKasToSompiBigInt(o.amountKas);
      return {
        address: o.address,
        amount: amountSompi,
      };
    });
    const outputsTotalSompi = outputs.reduce((sum, o) => sum + BigInt(o.amount), 0n);
    localTxPolicyConfig = readLocalTxPolicyConfig();
    let policyPlan = selectUtxoEntriesForLocalBuild({
      entries,
      outputsTotalSompi,
      outputCount: outputs.length,
      requestPriorityFeeSompi: payload.priorityFeeSompi,
      telemetry: payload.telemetry,
      config: localTxPolicyConfig,
    });
    if (!policyPlan.selectedEntries.length) throw new Error("tx_builder_no_selected_utxos");
    let priorityFeeSompi = Math.max(0, Number(policyPlan.priorityFeeSompi || 0));

    const buildWithEntries = async (candidateEntries, candidatePriorityFeeSompi) => {
      const generator = new kaspa.Generator({
        entries: candidateEntries,
        changeAddress,
        outputs,
        priorityFee: BigInt(Math.max(0, Math.round(Number(candidatePriorityFeeSompi || 0)))),
      });
      return generator.next();
    };

    let pendingTx = null;
    let selectedBuildError = null;
    try {
      pendingTx = await buildWithEntries(policyPlan.selectedEntries, priorityFeeSompi);
    } catch (e) {
      selectedBuildError = e;
    }
    let fallbackUsedAllInputs = false;
    if (!pendingTx && policyPlan.selectedEntries.length < entries.length) {
      // Conservative fallback if policy-selected inputs fail to build a valid pending transaction.
      fallbackUsedAllInputs = true;
      priorityFeeSompi = Math.max(0, Number(policyPlan.priorityFeeSompi || 0));
      pendingTx = await buildWithEntries(entries, priorityFeeSompi);
    }
    if (!pendingTx) {
      if (selectedBuildError) throw selectedBuildError;
      throw new Error("tx_builder_insufficient_funds_or_utxos");
    }

    const policyMeta = {
      selectionMode: String(policyPlan.selectionMode || "auto"),
      priorityFeeMode: String(policyPlan.priorityFeeMode || localTxPolicyConfig.priorityFeeMode || "request_or_fixed"),
      selectedInputs: fallbackUsedAllInputs ? entries.length : policyPlan.selectedEntries.length,
      totalInputs: entries.length,
      truncatedByMaxInputs: Boolean(policyPlan.truncatedByMaxInputs),
      selectedAmountSompi: String(fallbackUsedAllInputs
        ? entries.reduce((sum, e) => sum + BigInt(Math.max(0, Math.round(Number(e?.utxoEntry?.amount || 0)))), 0n)
        : (policyPlan.selectedAmountSompi || 0n)),
      outputsTotalSompi: String(outputsTotalSompi),
      requiredTargetSompi: String(policyPlan.requiredTargetSompi || 0n),
      priorityFeeSompi: String(priorityFeeSompi),
      fallbackUsedAllInputs,
      ...(payload?.telemetry ? { telemetry: payload.telemetry } : {}),
      ...(policyPlan?.adaptiveSignals ? { adaptiveSignals: policyPlan.adaptiveSignals } : {}),
      ...(selectedBuildError ? { selectedBuildError: String(selectedBuildError?.message || selectedBuildError).slice(0, 200) } : {}),
      config: describeLocalTxPolicyConfig(localTxPolicyConfig),
    };

    metrics.localWasmPolicySelectedInputsTotal += Number(policyMeta.selectedInputs || 0);
    metrics.localWasmPolicyTotalInputsSeen += Number(policyMeta.totalInputs || 0);
    metrics.localWasmPolicyPriorityFeeSompiTotal += Number(policyMeta.priorityFeeSompi || 0);
    if (policyMeta.truncatedByMaxInputs) metrics.localWasmPolicyTruncatedSelectionsTotal += 1;
    if (policyMeta.fallbackUsedAllInputs) metrics.localWasmPolicyFallbackAllInputsTotal += 1;
    inc(metrics.localWasmPolicySelectionModeTotal, String(policyMeta.selectionMode || "auto"));
    inc(metrics.localWasmPolicyPriorityFeeModeTotal, String(policyMeta.priorityFeeMode || "request_or_fixed"));


    let jsonObject;
    if (LOCAL_WASM_JSON_KIND === "pending") {
      jsonObject = pendingTx.toJSON();
    } else {
      const tx = pendingTx?.transaction;
      if (!tx || typeof tx.toJSON !== "function") throw new Error("pending_transaction_missing_transaction");
      jsonObject = tx.toJSON();
    }
    const txJson = safeJsonStringify(jsonObject);
    if (!txJson) throw new Error("local_wasm_missing_txJson");
    return {
      txJson,
      mode: "local_wasm",
      txid: String(pendingTx?.id || "").trim() || undefined,
      utxoCount: entries.length,
      apiBase,
      jsonKind: LOCAL_WASM_JSON_KIND,
      policy: policyMeta,
    };
  } catch (e) {
    metrics.localWasmErrorsTotal += 1;
    throw e;
  }
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
  if (LOCAL_WASM_ENABLED) return buildTxJsonLocalWasm(payload);
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
  push("# HELP forgeos_tx_builder_local_wasm_requests_total Local WASM build attempts.");
  push("# TYPE forgeos_tx_builder_local_wasm_requests_total counter");
  push(`forgeos_tx_builder_local_wasm_requests_total ${metrics.localWasmRequestsTotal}`);
  push("# HELP forgeos_tx_builder_local_wasm_errors_total Local WASM build errors.");
  push("# TYPE forgeos_tx_builder_local_wasm_errors_total counter");
  push(`forgeos_tx_builder_local_wasm_errors_total ${metrics.localWasmErrorsTotal}`);
  push("# HELP forgeos_tx_builder_local_wasm_utxo_fetch_errors_total Local WASM UTXO fetch errors.");
  push("# TYPE forgeos_tx_builder_local_wasm_utxo_fetch_errors_total counter");
  push(`forgeos_tx_builder_local_wasm_utxo_fetch_errors_total ${metrics.localWasmUtxoFetchErrorsTotal}`);
  push("# HELP forgeos_tx_builder_local_wasm_policy_selected_inputs_total Sum of selected inputs across local WASM builds.");
  push("# TYPE forgeos_tx_builder_local_wasm_policy_selected_inputs_total counter");
  push(`forgeos_tx_builder_local_wasm_policy_selected_inputs_total ${metrics.localWasmPolicySelectedInputsTotal}`);
  push("# HELP forgeos_tx_builder_local_wasm_policy_total_inputs_seen_total Sum of candidate UTXOs seen across local WASM builds.");
  push("# TYPE forgeos_tx_builder_local_wasm_policy_total_inputs_seen_total counter");
  push(`forgeos_tx_builder_local_wasm_policy_total_inputs_seen_total ${metrics.localWasmPolicyTotalInputsSeen}`);
  push("# HELP forgeos_tx_builder_local_wasm_policy_priority_fee_sompi_total Sum of priority fee sompi selected by local policy.");
  push("# TYPE forgeos_tx_builder_local_wasm_policy_priority_fee_sompi_total counter");
  push(`forgeos_tx_builder_local_wasm_policy_priority_fee_sompi_total ${metrics.localWasmPolicyPriorityFeeSompiTotal}`);
  push("# HELP forgeos_tx_builder_local_wasm_policy_truncated_selections_total Policy selections that hit max input cap.");
  push("# TYPE forgeos_tx_builder_local_wasm_policy_truncated_selections_total counter");
  push(`forgeos_tx_builder_local_wasm_policy_truncated_selections_total ${metrics.localWasmPolicyTruncatedSelectionsTotal}`);
  push("# HELP forgeos_tx_builder_local_wasm_policy_fallback_all_inputs_total Local WASM builds that fell back to all inputs.");
  push("# TYPE forgeos_tx_builder_local_wasm_policy_fallback_all_inputs_total counter");
  push(`forgeos_tx_builder_local_wasm_policy_fallback_all_inputs_total ${metrics.localWasmPolicyFallbackAllInputsTotal}`);
  push("# HELP forgeos_tx_builder_local_wasm_policy_selection_mode_total Local WASM builds by coin selection mode.");
  push("# TYPE forgeos_tx_builder_local_wasm_policy_selection_mode_total counter");
  for (const [mode, value] of metrics.localWasmPolicySelectionModeTotal.entries()) {
    push(`forgeos_tx_builder_local_wasm_policy_selection_mode_total{mode=${JSON.stringify(String(mode))}} ${value}`);
  }
  push("# HELP forgeos_tx_builder_local_wasm_policy_priority_fee_mode_total Local WASM builds by priority fee mode.");
  push("# TYPE forgeos_tx_builder_local_wasm_policy_priority_fee_mode_total counter");
  for (const [mode, value] of metrics.localWasmPolicyPriorityFeeModeTotal.entries()) {
    push(`forgeos_tx_builder_local_wasm_policy_priority_fee_mode_total{mode=${JSON.stringify(String(mode))}} ${value}`);
  }
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
        mode: LOCAL_WASM_ENABLED ? "local_wasm" : COMMAND ? "command" : UPSTREAM_URL ? "upstream" : ALLOW_MANUAL_TXJSON ? "manual" : "unconfigured",
        localWasmEnabled: LOCAL_WASM_ENABLED,
        localWasmJsonKind: LOCAL_WASM_JSON_KIND,
        kasApiMainnet: KAS_API_MAINNET || null,
        kasApiTestnet: KAS_API_TESTNET || null,
        localWasmPolicy: describeLocalTxPolicyConfig(localTxPolicyConfig),
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
          ...(result?.txid ? { txid: result.txid } : {}),
          ...(result?.utxoCount ? { utxoCount: result.utxoCount } : {}),
          ...(result?.jsonKind ? { jsonKind: result.jsonKind } : {}),
          ...(result?.policy ? { policy: result.policy } : {}),
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
    `[forgeos-tx-builder] auth=${authEnabled() ? "on" : "off"} mode=${LOCAL_WASM_ENABLED ? "local_wasm" : COMMAND ? "command" : UPSTREAM_URL ? "upstream" : ALLOW_MANUAL_TXJSON ? "manual" : "unconfigured"}`
  );
});
