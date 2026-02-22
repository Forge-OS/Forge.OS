import { runQuantEngine } from "./runQuantEngine";

const WORKER_ENABLED = String(import.meta.env.VITE_QUANT_WORKER_ENABLED || "true").toLowerCase() !== "false";
const WORKER_SOFT_TIMEOUT_MS = Math.max(1000, Number(import.meta.env.VITE_QUANT_WORKER_SOFT_TIMEOUT_MS || 8000));
const WORKER_FALLBACK_ERROR_PATTERNS = [/^Quant worker timeout/i, /^Quant worker crashed/i, /^Worker postMessage/i];

type PendingResolver = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

let worker: Worker | null = null;
let workerReady = false;
let workerInitAttempted = false;
let nextReqId = 1;
const pending = new Map<number, PendingResolver>();

function teardownWorker() {
  if (worker) {
    try {
      worker.terminate();
    } catch {
      // ignore
    }
  }
  worker = null;
  workerReady = false;
}

function initWorker() {
  if (!WORKER_ENABLED || typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (worker && workerReady) return worker;
  if (workerInitAttempted && !workerReady) return null;
  workerInitAttempted = true;
  try {
    worker = new Worker(new URL("../workers/quantEngine.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<any>) => {
      const msg = event.data;
      const entry = pending.get(Number(msg?.id));
      if (!entry) return;
      pending.delete(Number(msg.id));
      clearTimeout(entry.timeoutId);
      if (msg?.ok) entry.resolve(msg.decision);
      else entry.reject(new Error(String(msg?.error || "Quant worker error")));
    };
    worker.onerror = () => {
      for (const [id, entry] of pending.entries()) {
        clearTimeout(entry.timeoutId);
        entry.reject(new Error("Quant worker crashed"));
        pending.delete(id);
      }
      teardownWorker();
    };
    workerReady = true;
    return worker;
  } catch {
    teardownWorker();
    return null;
  }
}

export async function runQuantEngineClient(agent: any, kasData: any, context?: any): Promise<any> {
  const w = initWorker();
  if (!w) return runQuantEngine(agent, kasData, context);

  const id = nextReqId++;
  return new Promise<any>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pending.delete(id);
      teardownWorker();
      reject(new Error(`Quant worker timeout (${WORKER_SOFT_TIMEOUT_MS}ms)`));
    }, WORKER_SOFT_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timeoutId });
    try {
      w.postMessage({ id, agent, kasData, context });
    } catch (e) {
      clearTimeout(timeoutId);
      pending.delete(id);
      teardownWorker();
      reject(new Error(`Worker postMessage failed: ${String((e as any)?.message || e || "unknown_error")}`));
    }
  }).catch((err) => {
    const msg = String((err as any)?.message || "");
    const shouldFallback = WORKER_FALLBACK_ERROR_PATTERNS.some((re) => re.test(msg));
    if (!shouldFallback) throw err;
    return runQuantEngine(agent, kasData, context).catch((directErr) => {
      throw directErr || err;
    });
  });
}

export function getQuantEngineClientMode() {
  if (!WORKER_ENABLED) return "main-thread";
  const w = initWorker();
  return w ? "worker" : "main-thread";
}
