import { useCallback } from "react";
import { uid } from "../../../helpers";
import { buildQueueTxItem } from "../../../tx/queueTx";
import { WalletAdapter } from "../../../wallet/WalletAdapter";

type UseTreasuryPayoutParams = {
  enabled: boolean;
  treasuryFeeKas: number;
  treasuryAddress: string;
  walletAddress?: string;
  walletProvider?: string;
  kasPriceUsd?: number;
  maxQueueEntries: number;
  addLog: (entry: any) => void;
  setQueue: (updater: (prev: any[]) => any[]) => void;
  sendWalletTransfer: (txItem: any) => Promise<string>;
  receiptBackoffMs: (attempts: number) => number;
};

export function useTreasuryPayout(params: UseTreasuryPayoutParams) {
  const {
    enabled,
    treasuryFeeKas,
    treasuryAddress,
    walletAddress,
    walletProvider,
    kasPriceUsd = 0,
    maxQueueEntries,
    addLog,
    setQueue,
    sendWalletTransfer,
    receiptBackoffMs,
  } = params;

  const buildTreasuryFeeTx = useCallback((parentTx: any) => {
    return buildQueueTxItem({
      id: uid(),
      type: "TREASURY_FEE",
      metaKind: "treasury_fee",
      from: walletAddress,
      to: treasuryAddress,
      amount_kas: Number(Number(treasuryFeeKas || 0).toFixed(6)),
      purpose: `Protocol treasury fee${parentTx?.txid ? ` · parent ${String(parentTx.txid).slice(0, 12)}` : ""}`,
      status: "pending",
      ts: Date.now(),
      parentActionId: parentTx?.id || null,
      parentTxid: parentTx?.txid || null,
    });
  }, [treasuryAddress, treasuryFeeKas, walletAddress]);

  const canCombineTreasuryWithAction = useCallback((txItem: any) => {
    if (!enabled || !(treasuryFeeKas > 0)) return false;
    if (!txItem || txItem?.metaKind === "treasury_fee") return false;
    if (String(txItem?.type || "").toUpperCase() !== "ACCUMULATE") return false;
    return WalletAdapter.supportsNativeMultiOutput(String(walletProvider || ""));
  }, [enabled, treasuryFeeKas, walletProvider]);

  const attachCombinedTreasuryOutput = useCallback((txItem: any) => {
    if (!canCombineTreasuryWithAction(txItem)) return txItem;
    const baseOutputs = Array.isArray(txItem?.outputs) && txItem.outputs.length
      ? txItem.outputs
      : [{ to: txItem.to, amount_kas: txItem.amount_kas, tag: "primary" }];
    const normalizedOutputs = [
      ...baseOutputs.filter((o: any) => String(o?.tag || "").toLowerCase() !== "treasury"),
      { to: treasuryAddress, amount_kas: Number(Number(treasuryFeeKas || 0).toFixed(6)), tag: "treasury" },
    ];
    return buildQueueTxItem({
      ...txItem,
      outputs: normalizedOutputs,
      treasuryCombined: true,
      treasuryCombinedWalletProvider: walletProvider || null,
      treasuryCombinedFeeKas: Number(Number(treasuryFeeKas || 0).toFixed(6)),
      treasuryCombinedAddress: treasuryAddress,
    });
  }, [canCombineTreasuryWithAction, treasuryAddress, treasuryFeeKas, walletProvider]);

  const enqueueTreasuryFeeTx = useCallback((parentTx: any, reason?: string) => {
    if (!enabled || !(treasuryFeeKas > 0)) return null;
    const feeTx = buildTreasuryFeeTx(parentTx);
    setQueue((prev: any[]) => {
      const exists = prev.some(
        (q: any) =>
          q?.metaKind === "treasury_fee" &&
          q?.parentActionId &&
          q.parentActionId === feeTx.parentActionId &&
          (q.status === "pending" || q.status === "signed" || q.status === "signing")
      );
      return exists ? prev : [feeTx, ...prev].slice(0, maxQueueEntries);
    });
    addLog({
      type: "TREASURY",
      msg: `Treasury fee payout queued${reason ? ` (${reason})` : ""}: ${feeTx.amount_kas} KAS → ${treasuryAddress.slice(0, 18)}...`,
      fee: null,
    });
    return feeTx;
  }, [addLog, buildTreasuryFeeTx, enabled, maxQueueEntries, setQueue, treasuryAddress, treasuryFeeKas]);

  const settleTreasuryFeePayout = useCallback(async (parentTx: any, mode: "auto" | "post-sign") => {
    if (!enabled || !(treasuryFeeKas > 0)) return null;
    if (!parentTx || parentTx.metaKind === "treasury_fee") return null;
    if (parentTx?.treasuryCombined) {
      addLog({
        type: "TREASURY",
        msg: `Treasury fee combined in primary transaction (${String(parentTx?.treasuryCombinedWalletProvider || "wallet")}) · ${Number(parentTx?.treasuryCombinedFeeKas || treasuryFeeKas).toFixed(6)} KAS`,
        fee: null,
      });
      return parentTx?.txid || null;
    }

    const feeTx = buildTreasuryFeeTx(parentTx);
    try {
      const txid = await sendWalletTransfer(feeTx);
      const broadcastTs = Date.now();
      const price = Number(kasPriceUsd || 0);
      setQueue((prev: any[]) => {
        const filtered = prev.filter(
          (q: any) =>
            !(q?.metaKind === "treasury_fee" && q?.parentActionId && q.parentActionId === feeTx.parentActionId)
        );
        return [
          {
            ...feeTx,
            status: "signed",
            txid,
            receipt_lifecycle: "broadcasted",
            broadcast_ts: broadcastTs,
            receipt_attempts: 0,
            confirmations: 0,
            receipt_next_check_at: broadcastTs + receiptBackoffMs(0),
            receipt_last_checked_ts: undefined,
            failure_reason: null,
            ...(price > 0 ? { broadcast_price_usd: price } : {}),
          },
          ...filtered,
        ].slice(0, maxQueueEntries);
      });
      addLog({
        type: "TREASURY",
        msg: `Treasury fee payout sent (${mode}): ${feeTx.amount_kas} KAS → ${treasuryAddress.slice(0, 18)}... · txid: ${String(txid).slice(0, 16)}...`,
        fee: null,
      });
      return txid;
    } catch (e: any) {
      enqueueTreasuryFeeTx(parentTx, e?.message || "wallet rejected");
      return null;
    }
  }, [
    addLog,
    buildTreasuryFeeTx,
    enabled,
    enqueueTreasuryFeeTx,
    kasPriceUsd,
    maxQueueEntries,
    receiptBackoffMs,
    sendWalletTransfer,
    setQueue,
    treasuryAddress,
    treasuryFeeKas,
  ]);

  return {
    canCombineTreasuryWithAction,
    attachCombinedTreasuryOutput,
    enqueueTreasuryFeeTx,
    settleTreasuryFeePayout,
  };
}
