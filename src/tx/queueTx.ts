import { normalizeKaspaAddress } from "../helpers";
import { ALLOWED_ADDRESS_PREFIXES } from "../constants";
import { WalletAdapter } from "../wallet/WalletAdapter";

export type QueueTxStatus = "pending" | "signing" | "signed" | "rejected" | "failed";

export type QueueTxOutput = {
  to: string;
  amount_kas: number;
  tag?: string;
};

export type QueueTxItem = {
  id: string;
  type: string;
  from?: string;
  to: string;
  amount_kas: number;
  outputs?: QueueTxOutput[];
  purpose: string;
  status: QueueTxStatus;
  ts: number;
  receipt_lifecycle?: "submitted" | "broadcasted" | "pending_confirm" | "confirmed" | "failed" | "timeout";
  submitted_ts?: number;
  broadcast_ts?: number;
  confirm_ts?: number;
  receipt_last_checked_ts?: number;
  receipt_next_check_at?: number;
  receipt_attempts?: number;
  confirmations?: number;
  failure_reason?: string | null;
  broadcast_price_usd?: number;
  confirm_price_usd?: number;
  metaKind?: "treasury_fee" | "action" | "deploy";
  [key: string]: any;
};

function finite(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeOutputs(input: any): QueueTxOutput[] | undefined {
  if (!Array.isArray(input?.outputs)) return undefined;
  const outputs = input.outputs
    .map((entry: any) => ({
      to: normalizeKaspaAddress(String(entry?.to || entry?.address || ""), ALLOWED_ADDRESS_PREFIXES),
      amount_kas: Number(finite(entry?.amount_kas ?? entry?.amount, 0).toFixed(6)),
      tag: entry?.tag ? String(entry.tag).slice(0, 40) : undefined,
    }))
    .filter((entry: QueueTxOutput) => entry.to && entry.amount_kas > 0);
  if (!outputs.length) return undefined;
  return outputs;
}

function pickPrimaryOutput(outputs: QueueTxOutput[] | undefined, fallbackTo: string, fallbackAmount: number) {
  if (!outputs?.length) return { to: fallbackTo, amount_kas: fallbackAmount };
  const preferred =
    outputs.find((o) => String(o.tag || "").toLowerCase() === "primary") ||
    outputs[0];
  return {
    to: preferred.to,
    amount_kas: preferred.amount_kas,
  };
}

export function validateQueueTxItem(input: any): QueueTxItem {
  const outputs = normalizeOutputs(input);
  const rawTo = String(input?.to || "").trim();
  const rawAmount = Number(finite(input?.amount_kas, 0).toFixed(6));
  const fallbackTo = rawTo ? normalizeKaspaAddress(rawTo, ALLOWED_ADDRESS_PREFIXES) : (outputs?.[0]?.to || "");
  const fallbackAmount = rawAmount > 0 ? rawAmount : Number(outputs?.[0]?.amount_kas || 0);
  const primary = pickPrimaryOutput(outputs, fallbackTo, fallbackAmount);
  const to = primary.to;
  const amount = Number(finite(primary.amount_kas, 0).toFixed(6));
  if (!(amount > 0) || !to) throw new Error("Invalid tx amount_kas/to; must be > 0 and valid address");

  const statusRaw = String(input?.status || "pending").toLowerCase();
  const status: QueueTxStatus =
    statusRaw === "pending" || statusRaw === "signing" || statusRaw === "signed" || statusRaw === "rejected" || statusRaw === "failed"
      ? (statusRaw as QueueTxStatus)
      : "pending";

  return {
    ...input,
    id: String(input?.id || "").trim(),
    type: String(input?.type || "TX").trim() || "TX",
    from: input?.from ? String(input.from).trim() : undefined,
    to,
    amount_kas: amount,
    outputs,
    purpose: String(input?.purpose || "ForgeOS transaction").trim().slice(0, 140),
    status,
    ts: Math.max(0, Math.round(finite(input?.ts, Date.now()))),
    receipt_lifecycle:
      input?.receipt_lifecycle === "broadcasted" ||
      input?.receipt_lifecycle === "pending_confirm" ||
      input?.receipt_lifecycle === "confirmed" ||
      input?.receipt_lifecycle === "failed" ||
      input?.receipt_lifecycle === "timeout"
        ? input.receipt_lifecycle
        : "submitted",
    submitted_ts: Math.max(0, Math.round(finite(input?.submitted_ts, input?.ts ?? Date.now()))),
    broadcast_ts: finite(input?.broadcast_ts, NaN) > 0 ? Math.round(finite(input?.broadcast_ts, 0)) : undefined,
    confirm_ts: finite(input?.confirm_ts, NaN) > 0 ? Math.round(finite(input?.confirm_ts, 0)) : undefined,
    receipt_last_checked_ts:
      finite(input?.receipt_last_checked_ts, NaN) > 0 ? Math.round(finite(input?.receipt_last_checked_ts, 0)) : undefined,
    receipt_next_check_at:
      finite(input?.receipt_next_check_at, NaN) > 0 ? Math.round(finite(input?.receipt_next_check_at, 0)) : undefined,
    receipt_attempts: Math.max(0, Math.round(finite(input?.receipt_attempts, 0))),
    confirmations: Math.max(0, Math.round(finite(input?.confirmations, 0))),
    failure_reason:
      input?.failure_reason == null ? null : String(input.failure_reason).slice(0, 240),
    broadcast_price_usd:
      Number.isFinite(finite(input?.broadcast_price_usd, NaN)) ? finite(input?.broadcast_price_usd, 0) : undefined,
    confirm_price_usd:
      Number.isFinite(finite(input?.confirm_price_usd, NaN)) ? finite(input?.confirm_price_usd, 0) : undefined,
    metaKind: input?.metaKind === "treasury_fee" ? "treasury_fee" : input?.metaKind === "deploy" ? "deploy" : "action",
  };
}

export function buildQueueTxItem(input: any): QueueTxItem {
  const base = {
    id: String(input?.id || "").trim(),
    status: "pending",
    ts: Date.now(),
    submitted_ts: Date.now(),
    receipt_lifecycle: "submitted",
    receipt_attempts: 0,
    confirmations: 0,
    failure_reason: null,
    ...input,
  };
  if (!base.id) throw new Error("Queue tx requires id");
  return validateQueueTxItem(base);
}

export async function broadcastQueueTx(wallet: any, txItem: QueueTxItem) {
  const tx = validateQueueTxItem(txItem);
  const outputs = Array.isArray(tx.outputs) ? tx.outputs : [];
  const hasMultiOutputs = outputs.length > 1;
  if (hasMultiOutputs && !WalletAdapter.supportsNativeMultiOutput(String(wallet?.provider || ""))) {
    throw new Error(`Wallet ${String(wallet?.provider || "unknown")} does not support native multi-output send`);
  }
  if (wallet?.provider === "kasware") {
    return WalletAdapter.sendKasware(tx.to, tx.amount_kas);
  }
  if (wallet?.provider === "kastle") {
    if (hasMultiOutputs && WalletAdapter.canKastleSignAndBroadcastRawTx()) {
      return WalletAdapter.sendKastleRawTx(outputs, tx.purpose);
    }
    return WalletAdapter.sendKastle(tx.to, tx.amount_kas);
  }
  if (wallet?.provider === "ghost") {
    if (outputs.length) {
      return WalletAdapter.sendGhostOutputs(outputs, tx.purpose);
    }
    return WalletAdapter.sendGhost(tx.to, tx.amount_kas);
  }
  if (wallet?.provider === "kaspium") {
    return WalletAdapter.sendKaspium(tx.to, tx.amount_kas, tx.purpose);
  }
  if (wallet?.provider === "tangem" || wallet?.provider === "onekey") {
    return WalletAdapter.sendHardwareBridge(String(wallet?.provider || "hardware"), tx.to, tx.amount_kas, tx.purpose, outputs);
  }

  // Demo mode fallback for UI flows/tests.
  await new Promise((r) => setTimeout(r, 300));
  return Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
}
