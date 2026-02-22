import { runQuantEngine } from "../quant/runQuantEngine";

type QuantWorkerRequest = {
  id: number;
  agent: any;
  kasData: any;
  context?: any;
};

type QuantWorkerResponse =
  | { id: number; ok: true; decision: any }
  | { id: number; ok: false; error: string };

self.onmessage = async (event: MessageEvent<QuantWorkerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg.id !== "number") return;
  try {
    const decision = await runQuantEngine(msg.agent, msg.kasData, msg.context);
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
