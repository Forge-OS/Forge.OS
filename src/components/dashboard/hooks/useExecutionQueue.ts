import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT_SPLIT, FEE_RATE, TREASURY_SPLIT } from "../../../constants";
import { uid } from "../../../helpers";
import { kasPrice, kasTxReceipt } from "../../../api/kaspaApi";
import { transitionQueueTxLifecycle, transitionQueueTxReceiptLifecycle } from "../../../runtime/lifecycleMachine";
import { broadcastQueueTx, buildQueueTxItem, validateQueueTxItem } from "../../../tx/queueTx";

type UseExecutionQueueParams = {
  wallet: any;
  maxQueueEntries: number;
  addLog: (entry: any) => void;
  kasPriceUsd?: number;
  setTab?: (tab: string) => void;
  onSignedAction?: (signedQueueItem: any) => Promise<void> | void;
  receiptRetryBaseMs?: number;
  receiptRetryMaxMs?: number;
  receiptTimeoutMs?: number;
  receiptMaxAttempts?: number;
  receiptPollIntervalMs?: number;
  receiptPollBatchSize?: number;
};

export function useExecutionQueue(params: UseExecutionQueueParams) {
  const {
    wallet,
    maxQueueEntries,
    addLog,
    kasPriceUsd = 0,
    setTab,
    onSignedAction,
    receiptRetryBaseMs = 2000,
    receiptRetryMaxMs = 30000,
    receiptTimeoutMs = 8 * 60 * 1000,
    receiptMaxAttempts = 18,
    receiptPollIntervalMs = 1200,
    receiptPollBatchSize = 2,
  } = params;

  const [queue, setQueue] = useState([] as any[]);
  const [signingItem, setSigningItem] = useState(null as any);
  const receiptPollInFlightRef = useRef(new Set<string>());

  const updateQueueItemLifecycle = useCallback((id: string, event: any, extra: Record<string, any> = {}) => {
    setQueue((prev: any[]) =>
      prev.map((item: any) => {
        if (item?.id !== id) return item;
        const nextStatus = transitionQueueTxLifecycle(String(item?.status || "pending") as any, event);
        return { ...item, status: nextStatus, ...extra };
      })
    );
  }, []);

  const updateQueueItemReceiptLifecycle = useCallback((id: string, event: any, extra: Record<string, any> = {}) => {
    setQueue((prev: any[]) =>
      prev.map((item: any) => {
        if (item?.id !== id) return item;
        const nextReceipt = transitionQueueTxReceiptLifecycle(
          String(item?.receipt_lifecycle || "submitted") as any,
          event
        );
        return { ...item, receipt_lifecycle: nextReceipt, ...extra };
      })
    );
  }, []);

  const receiptBackoffMs = useCallback((attempts: number) => {
    const step = Math.max(0, Math.min(6, Number(attempts || 0)));
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(receiptRetryMaxMs, receiptRetryBaseMs * (2 ** step) + jitter);
  }, [receiptRetryBaseMs, receiptRetryMaxMs]);

  const decorateBroadcastedSignedItem = useCallback((txItem: any, txid: string, extra: Record<string, any> = {}) => {
    const broadcastTs = Date.now();
    const price = Number(kasPriceUsd || 0);
    return {
      ...txItem,
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
      ...extra,
    };
  }, [kasPriceUsd, receiptBackoffMs]);

  const markQueueItemBroadcasted = useCallback((id: string, txid: string, extra: Record<string, any> = {}) => {
    const now = Date.now();
    const price = Number(kasPriceUsd || 0);
    updateQueueItemReceiptLifecycle(id, { type: "BROADCASTED" }, {
      txid,
      broadcast_ts: now,
      receipt_last_checked_ts: undefined,
      receipt_next_check_at: now + receiptBackoffMs(0),
      receipt_attempts: 0,
      confirmations: 0,
      failure_reason: null,
      ...(price > 0 ? { broadcast_price_usd: price } : {}),
      ...extra,
    });
  }, [kasPriceUsd, receiptBackoffMs, updateQueueItemReceiptLifecycle]);

  const pollReceiptForQueueItem = useCallback(async (item: any) => {
    const itemId = String(item?.id || "");
    const txid = String(item?.txid || "");
    if (!itemId || !txid) return;

    const now = Date.now();
    const attempts = Math.max(0, Number(item?.receipt_attempts || 0));
    const firstSeenTs = Math.max(0, Number(item?.broadcast_ts || item?.submitted_ts || item?.ts || now));
    if (attempts >= receiptMaxAttempts || (now - firstSeenTs) >= receiptTimeoutMs) {
      updateQueueItemReceiptLifecycle(itemId, { type: "TIMEOUT" }, {
        receipt_last_checked_ts: now,
        receipt_next_check_at: undefined,
        receipt_attempts: attempts,
        failure_reason: "confirmation_timeout",
      });
      addLog({
        type: item?.metaKind === "treasury_fee" ? "TREASURY" : "EXEC",
        msg: `${item?.metaKind === "treasury_fee" ? "Treasury payout" : "Transaction"} confirmation timeout · txid: ${txid.slice(0, 16)}...`,
        fee: null,
      });
      return;
    }

    let receipt;
    try {
      receipt = await kasTxReceipt(txid);
    } catch (e: any) {
      const nextAttempts = attempts + 1;
      updateQueueItemReceiptLifecycle(itemId, { type: "POLL_PENDING" }, {
        receipt_last_checked_ts: Date.now(),
        receipt_next_check_at: Date.now() + receiptBackoffMs(nextAttempts),
        receipt_attempts: nextAttempts,
        failure_reason: String(e?.message || "receipt_lookup_failed").slice(0, 240),
      });
      return;
    }

    const checkedTs = Date.now();
    if (!receipt?.found || receipt.status === "pending") {
      const nextAttempts = attempts + 1;
      const timedOut = nextAttempts >= receiptMaxAttempts || (checkedTs - firstSeenTs) >= receiptTimeoutMs;
      if (timedOut) {
        updateQueueItemReceiptLifecycle(itemId, { type: "TIMEOUT" }, {
          receipt_last_checked_ts: checkedTs,
          receipt_next_check_at: undefined,
          receipt_attempts: nextAttempts,
          confirmations: Math.max(0, Number(receipt?.confirmations || 0)),
          failure_reason: "confirmation_timeout",
        });
        addLog({
          type: item?.metaKind === "treasury_fee" ? "TREASURY" : "EXEC",
          msg: `${item?.metaKind === "treasury_fee" ? "Treasury payout" : "Transaction"} confirmation timeout · txid: ${txid.slice(0, 16)}...`,
          fee: null,
        });
      } else {
        updateQueueItemReceiptLifecycle(itemId, { type: "POLL_PENDING" }, {
          receipt_last_checked_ts: checkedTs,
          receipt_next_check_at: checkedTs + receiptBackoffMs(nextAttempts),
          receipt_attempts: nextAttempts,
          confirmations: Math.max(0, Number(receipt?.confirmations || 0)),
          failure_reason: null,
        });
      }
      return;
    }

    if (receipt.status === "failed") {
      updateQueueItemReceiptLifecycle(itemId, { type: "FAILED" }, {
        receipt_last_checked_ts: checkedTs,
        receipt_next_check_at: undefined,
        receipt_attempts: attempts + 1,
        confirmations: Math.max(0, Number(receipt?.confirmations || 0)),
        failure_reason: "chain_rejected",
      });
      addLog({
        type: item?.metaKind === "treasury_fee" ? "TREASURY" : "ERROR",
        msg: `${item?.metaKind === "treasury_fee" ? "Treasury payout" : "Transaction"} failed on-chain · txid: ${txid.slice(0, 16)}...`,
        fee: null,
      });
      return;
    }

    const livePrice = Number(kasPriceUsd || 0);
    const confirmPrice = livePrice > 0 ? livePrice : (Number(await kasPrice().catch(() => 0)) || undefined);
    updateQueueItemReceiptLifecycle(itemId, { type: "CONFIRMED" }, {
      receipt_last_checked_ts: checkedTs,
      receipt_next_check_at: undefined,
      receipt_attempts: attempts + 1,
      confirmations: Math.max(0, Number(receipt?.confirmations || 0)),
      confirm_ts: checkedTs,
      failure_reason: null,
      ...(confirmPrice ? { confirm_price_usd: confirmPrice } : {}),
    });
    addLog({
      type: item?.metaKind === "treasury_fee" ? "TREASURY" : "EXEC",
      msg:
        `${item?.metaKind === "treasury_fee" ? "Treasury payout" : "Transaction"} confirmed` +
        ` · ${Math.max(0, Number(receipt?.confirmations || 0))} conf · txid: ${txid.slice(0, 16)}...`,
      fee: null,
    });
  }, [
    addLog,
    kasPriceUsd,
    receiptBackoffMs,
    receiptMaxAttempts,
    receiptTimeoutMs,
    updateQueueItemReceiptLifecycle,
  ]);

  const sendWalletTransfer = useCallback(async (txItem: any) => {
    return broadcastQueueTx(wallet, validateQueueTxItem(txItem));
  }, [wallet]);

  const prependQueueItem = useCallback((txItem: any) => {
    setQueue((prev: any[]) => [txItem, ...prev].slice(0, maxQueueEntries));
  }, [maxQueueEntries]);

  const prependSignedBroadcastedQueueItem = useCallback((txItem: any, txid: string) => {
    const signedItem = decorateBroadcastedSignedItem(txItem, txid);
    setQueue((prev: any[]) => [signedItem, ...prev].slice(0, maxQueueEntries));
    return signedItem;
  }, [decorateBroadcastedSignedItem, maxQueueEntries]);

  const handleQueueSign = useCallback((item: any) => {
    if (item?.id) updateQueueItemLifecycle(item.id, { type: "BEGIN_SIGN" });
    setSigningItem(item);
  }, [updateQueueItemLifecycle]);

  const handleQueueReject = useCallback((id: string) => {
    const item = queue.find((q: any) => q.id === id);
    updateQueueItemLifecycle(id, { type: "SIGN_REJECT" });
    if (item?.metaKind === "treasury_fee") {
      addLog({ type: "TREASURY", msg: `Treasury fee payout rejected by operator: ${id}`, fee: null });
      return;
    }
    addLog({ type: "SIGN", msg: `Transaction rejected by operator: ${id}`, fee: null });
  }, [addLog, queue, updateQueueItemLifecycle]);

  const handleSigningReject = useCallback(() => {
    if (signingItem?.id) handleQueueReject(signingItem.id);
    setSigningItem(null);
  }, [handleQueueReject, signingItem]);

  const handleSigned = useCallback(async (tx: any) => {
    const signedQueueItem = signingItem ? { ...signingItem, status: "signed", txid: tx.txid } : tx;
    if (signingItem?.id) {
      updateQueueItemLifecycle(signingItem.id, { type: "SIGN_SUCCESS", txid: tx.txid }, { txid: tx.txid });
      markQueueItemBroadcasted(signingItem.id, tx.txid);
    }
    if (signingItem?.metaKind === "treasury_fee") {
      addLog({
        type: "TREASURY",
        msg: `Treasury fee payout signed: ${signingItem?.amount_kas} KAS · txid: ${tx.txid?.slice(0, 16)}...`,
        fee: null,
      });
      setSigningItem(null);
      return;
    }

    addLog({
      type: "EXEC",
      msg: `SIGNED: ${signingItem?.type} · ${signingItem?.amount_kas} KAS · txid: ${tx.txid?.slice(0, 16)}...`,
      fee: 0.08,
    });
    addLog({
      type: "TREASURY",
      msg: `Fee split → Pool: ${(FEE_RATE * AGENT_SPLIT).toFixed(4)} KAS / Treasury: ${(FEE_RATE * TREASURY_SPLIT).toFixed(4)} KAS`,
      fee: FEE_RATE,
    });
    setSigningItem(null);
    if (typeof onSignedAction === "function") {
      await onSignedAction(signedQueueItem);
    }
  }, [addLog, markQueueItemBroadcasted, onSignedAction, signingItem, updateQueueItemLifecycle]);

  const rejectAllPending = useCallback(() => {
    setQueue((prev: any[]) =>
      prev.map((q: any) =>
        q.status === "pending"
          ? { ...q, status: transitionQueueTxLifecycle("pending", { type: "SIGN_REJECT" }) }
          : q
      )
    );
    setSigningItem(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      const inFlight = receiptPollInFlightRef.current;
      const candidates = (Array.isArray(queue) ? queue : [])
        .filter((item: any) => item?.status === "signed" && /^[a-f0-9]{64}$/i.test(String(item?.txid || "")))
        .filter((item: any) => {
          const state = String(item?.receipt_lifecycle || "submitted");
          return state !== "confirmed" && state !== "failed" && state !== "timeout";
        })
        .filter((item: any) => {
          const nextCheck = Number(item?.receipt_next_check_at || 0);
          return !(nextCheck > 0) || nextCheck <= now;
        })
        .filter((item: any) => !inFlight.has(String(item?.id || "")))
        .slice(0, receiptPollBatchSize);

      for (const item of candidates) {
        const id = String(item?.id || "");
        if (!id) continue;
        inFlight.add(id);
        void pollReceiptForQueueItem(item).finally(() => {
          inFlight.delete(id);
        });
      }
    };

    tick();
    const id = setInterval(tick, receiptPollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollReceiptForQueueItem, queue, receiptPollBatchSize, receiptPollIntervalMs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (import.meta.env.MODE === "production") return;

    const root = ((window as any).__forgeosTest = (window as any).__forgeosTest || {});
    const dashboardBridge = {
      enqueueQueueTx: (input: any) => {
        const tx = buildQueueTxItem({
          id: uid(),
          from: wallet?.address,
          to: wallet?.address,
          type: "ACCUMULATE",
          amount_kas: 1,
          purpose: "ForgeOS E2E bridge tx",
          metaKind: "action",
          ...input,
        });
        setQueue((prev: any[]) => [tx, ...prev].slice(0, maxQueueEntries));
        return tx.id;
      },
      getQueue: () => queue,
      setTab,
    };

    root.dashboard = dashboardBridge;
    return () => {
      if (root.dashboard === dashboardBridge) delete root.dashboard;
    };
  }, [maxQueueEntries, queue, setTab, wallet?.address]);

  const pendingCount = queue.filter((q: any) => q.status === "pending").length;

  return {
    queue,
    setQueue,
    signingItem,
    setSigningItem,
    pendingCount,
    sendWalletTransfer,
    updateQueueItemLifecycle,
    updateQueueItemReceiptLifecycle,
    receiptBackoffMs,
    decorateBroadcastedSignedItem,
    markQueueItemBroadcasted,
    prependQueueItem,
    prependSignedBroadcastedQueueItem,
    handleQueueSign,
    handleQueueReject,
    handleSigningReject,
    handleSigned,
    rejectAllPending,
  };
}
