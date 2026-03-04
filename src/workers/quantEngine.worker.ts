import { runQuantEngine } from "../quant/runQuantEngine";

type QuantWorkerRequest = {
  id: string;
  agent: any;
  kasData: any;
  context?: any;
};

type QuantWorkerResponse =
  | { id: string; ok: true; decision: any }
  | { id: string; ok: false; error: string };

const WORKER_TIMEOUT_MS = 10000;

self.onmessage = async (event: MessageEvent<QuantWorkerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg.id !== "string" || !msg.id) return;
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Quant engine timed out after ${WORKER_TIMEOUT_MS}ms`)), WORKER_TIMEOUT_MS)
    );
    const decision = await Promise.race([
      runQuantEngine(msg.agent, msg.kasData, msg.context),
      timeoutPromise,
    ]);
    const out: QuantWorkerResponse = { id: msg.id, ok: true, decision };
    (self as unknown as Worker).postMessage(out);
  } catch (e: any) {
    const out: QuantWorkerResponse = {
      id: msg.id,
      ok: false,
      error: String(e?.message || "Quant worker request failed"),
    };
    (self as unknown as Worker).postMessage(out);
  }
};

export {};
