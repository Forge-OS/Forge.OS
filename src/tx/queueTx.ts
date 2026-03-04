import { normalizeKaspaAddress } from "../helpers";
import { ALLOWED_ADDRESS_PREFIXES, TREASURY } from "../constants";
import { WalletAdapter } from "../wallet/WalletAdapter";

export type QueueTxStatus = "pending" | "signing" | "signed" | "rejected" | "failed";

export type QueueTxOutput = {
  to: string;
  amount_kas: number;
  tag?: string;
};

/**
 * Validates that the principal (amount_kas) does NOT go to the Treasury address.
 * This is a critical security check to prevent funds from being incorrectly routed.
 * 
 * @param outputs - Array of transaction outputs
 * @param primaryAmount - The principal amount (should match the primary output)
 * @throws Error if principal is being sent to treasury
 */
export function validateNoPrincipalToTreasury(outputs: QueueTxOutput[] | undefined, primaryAmount: number): void {
  if (!outputs || !outputs.length) return;
  
  const treasuryNormalized = TREASURY.toLowerCase();
  
  for (const output of outputs) {
    const isTreasury = output.to.toLowerCase() === treasuryNormalized;
    const isPrincipal = (output.tag || "").toLowerCase() === "primary" || 
                       (output.amount_kas === primaryAmount && primaryAmount > 0);
    
    // If this output goes to treasury AND is marked as primary, that's a bug
    if (isTreasury && isPrincipal) {
      throw new Error(
        `SECURITY VALIDATION FAILED: Principal (${output.amount_kas} KAS) cannot be sent to Treasury. ` +
        `Principal must go to agent deposit address. Treasury receives only platform fee.`
      );
    }
  }
}

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
  confirm_detected_ts?: number;
  confirm_ts_source?: "chain" | "poll";
  receipt_last_checked_ts?: number;
  receipt_next_check_at?: number;
  receipt_attempts?: number;
  confirmations?: number;
  failure_reason?: string | null;
  broadcast_price_usd?: number;
  confirm_price_usd?: number;
  receipt_block_time_ms?: number;
  receipt_fee_sompi?: number;
  receipt_fee_kas?: number;
  receipt_mass?: number;
  receipt_source_path?: string;
  receipt_source?: string;
  receipt_imported_from?: "kaspa_api" | "callback_consumer";
  receipt_backend_updated_at?: number;
  receipt_slippage_kas?: number;
  backend_confirm_ts?: number;
  backend_confirmations?: number;
  backend_receipt_fee_kas?: number;
  backend_receipt_fee_sompi?: number;
  backend_receipt_slippage_kas?: number;
  chain_confirm_ts?: number;
  chain_confirmations?: number;
  chain_receipt_fee_kas?: number;
  chain_receipt_fee_sompi?: number;
  chain_derived_slippage_kas?: number;
  receipt_consistency_status?: "insufficient" | "consistent" | "mismatch";
  receipt_consistency_mismatches?: string[];
  receipt_consistency_checked_ts?: number;
  receipt_consistency_confirm_ts_drift_ms?: number;
  receipt_consistency_fee_diff_kas?: number;
  receipt_consistency_slippage_diff_kas?: number;
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

  // CRITICAL: Validate that principal does NOT go to Treasury
  // This prevents the security bug where user deposits were incorrectly sent to treasury
  validateNoPrincipalToTreasury(outputs, amount);

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
    confirm_detected_ts:
      finite(input?.confirm_detected_ts, NaN) > 0 ? Math.round(finite(input?.confirm_detected_ts, 0)) : undefined,
    confirm_ts_source:
      input?.confirm_ts_source === "chain" || input?.confirm_ts_source === "poll" ? input.confirm_ts_source : undefined,
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
    receipt_block_time_ms:
      finite(input?.receipt_block_time_ms, NaN) > 0 ? Math.round(finite(input?.receipt_block_time_ms, 0)) : undefined,
    receipt_fee_sompi:
      Number.isFinite(finite(input?.receipt_fee_sompi, NaN)) ? Math.max(0, Math.round(finite(input?.receipt_fee_sompi, 0))) : undefined,
    receipt_fee_kas:
      Number.isFinite(finite(input?.receipt_fee_kas, NaN)) ? Math.max(0, Number(finite(input?.receipt_fee_kas, 0).toFixed(8))) : undefined,
    receipt_mass:
      Number.isFinite(finite(input?.receipt_mass, NaN)) ? Math.max(0, Math.round(finite(input?.receipt_mass, 0))) : undefined,
    receipt_source_path:
      input?.receipt_source_path ? String(input.receipt_source_path).slice(0, 240) : undefined,
    receipt_source:
      input?.receipt_source ? String(input.receipt_source).slice(0, 120) : undefined,
    receipt_imported_from:
      input?.receipt_imported_from === "callback_consumer" || input?.receipt_imported_from === "kaspa_api"
        ? input.receipt_imported_from
        : undefined,
    receipt_backend_updated_at:
      finite(input?.receipt_backend_updated_at, NaN) > 0 ? Math.round(finite(input?.receipt_backend_updated_at, 0)) : undefined,
    receipt_slippage_kas:
      Number.isFinite(finite(input?.receipt_slippage_kas, NaN))
        ? Math.max(0, Number(finite(input?.receipt_slippage_kas, 0).toFixed(8)))
        : undefined,
    backend_confirm_ts:
      finite(input?.backend_confirm_ts, NaN) > 0 ? Math.round(finite(input?.backend_confirm_ts, 0)) : undefined,
    backend_confirmations:
      Number.isFinite(finite(input?.backend_confirmations, NaN)) ? Math.max(0, Math.round(finite(input?.backend_confirmations, 0))) : undefined,
    backend_receipt_fee_kas:
      Number.isFinite(finite(input?.backend_receipt_fee_kas, NaN))
        ? Math.max(0, Number(finite(input?.backend_receipt_fee_kas, 0).toFixed(8)))
        : undefined,
    backend_receipt_fee_sompi:
      Number.isFinite(finite(input?.backend_receipt_fee_sompi, NaN)) ? Math.max(0, Math.round(finite(input?.backend_receipt_fee_sompi, 0))) : undefined,
    backend_receipt_slippage_kas:
      Number.isFinite(finite(input?.backend_receipt_slippage_kas, NaN))
        ? Math.max(0, Number(finite(input?.backend_receipt_slippage_kas, 0).toFixed(8)))
        : undefined,
    chain_confirm_ts:
      finite(input?.chain_confirm_ts, NaN) > 0 ? Math.round(finite(input?.chain_confirm_ts, 0)) : undefined,
    chain_confirmations:
      Number.isFinite(finite(input?.chain_confirmations, NaN)) ? Math.max(0, Math.round(finite(input?.chain_confirmations, 0))) : undefined,
    chain_receipt_fee_kas:
      Number.isFinite(finite(input?.chain_receipt_fee_kas, NaN))
        ? Math.max(0, Number(finite(input?.chain_receipt_fee_kas, 0).toFixed(8)))
        : undefined,
    chain_receipt_fee_sompi:
      Number.isFinite(finite(input?.chain_receipt_fee_sompi, NaN)) ? Math.max(0, Math.round(finite(input?.chain_receipt_fee_sompi, 0))) : undefined,
    chain_derived_slippage_kas:
      Number.isFinite(finite(input?.chain_derived_slippage_kas, NaN))
        ? Math.max(0, Number(finite(input?.chain_derived_slippage_kas, 0).toFixed(8)))
        : undefined,
    receipt_consistency_status:
      input?.receipt_consistency_status === "consistent" ||
      input?.receipt_consistency_status === "mismatch" ||
      input?.receipt_consistency_status === "insufficient"
        ? input.receipt_consistency_status
        : undefined,
    receipt_consistency_mismatches:
      Array.isArray(input?.receipt_consistency_mismatches)
        ? input.receipt_consistency_mismatches.map((v: any) => String(v)).filter(Boolean).slice(0, 8)
        : undefined,
    receipt_consistency_checked_ts:
      finite(input?.receipt_consistency_checked_ts, NaN) > 0 ? Math.round(finite(input?.receipt_consistency_checked_ts, 0)) : undefined,
    receipt_consistency_confirm_ts_drift_ms:
      Number.isFinite(finite(input?.receipt_consistency_confirm_ts_drift_ms, NaN))
        ? Math.max(0, Math.round(finite(input?.receipt_consistency_confirm_ts_drift_ms, 0)))
        : undefined,
    receipt_consistency_fee_diff_kas:
      Number.isFinite(finite(input?.receipt_consistency_fee_diff_kas, NaN))
        ? Math.max(0, Number(finite(input?.receipt_consistency_fee_diff_kas, 0).toFixed(8)))
        : undefined,
    receipt_consistency_slippage_diff_kas:
      Number.isFinite(finite(input?.receipt_consistency_slippage_diff_kas, NaN))
        ? Math.max(0, Number(finite(input?.receipt_consistency_slippage_diff_kas, 0).toFixed(8)))
        : undefined,
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

  // Paper trading: simulate broadcast without touching the chain
  if (wallet?.paper === true || String(wallet?.execMode || "").toLowerCase() === "paper") {
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 200));
    return `paper_${Date.now().toString(16)}_${crypto.randomUUID().replace(/-/g, "")}`;
  }

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
  if (wallet?.provider === "forgeos") {
    const provider = (window as any).forgeos;
    if (!provider?.sendTransaction) throw new Error("Forge-OS extension not available. Install the Forge-OS browser extension.");
    return provider.sendTransaction({
      to: tx.to,
      amountKas: tx.amount_kas,
      purpose: tx.purpose,
      agentId: tx.agentId ?? undefined,
      autoApproveKas: wallet.autoApproveKas ?? 0,
    });
  }

  // Demo mode fallback for UI flows/tests.
  await new Promise((r) => setTimeout(r, 300));
  return Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
}
