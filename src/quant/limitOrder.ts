/**
 * Limit Order Engine — price-triggered KAS buy/sell orders.
 *
 * Orders are persisted to localStorage under LIMIT_ORDERS_KEY.
 * Price checking runs inside the Dashboard's runCycle via checkAndTriggerOrders().
 * Actual execution is delegated to the caller via the onTrigger callback.
 *
 * Architecture:
 *   buildLimitOrder()           — validate + persist a new order
 *   cancelLimitOrder(id)        — mark CANCELLED, persist
 *   getAllOrders()              — load all orders from storage
 *   getOpenOrders()             — filter for OPEN status
 *   checkAndTriggerOrders()     — price-tick check; calls onTrigger for hit orders
 *   markOrderExecuted(id, txId) — called after successful execution
 *   pruneExpiredOrders()        — remove orders past expiry
 */

export type LimitOrderType = "BUY" | "SELL";

export type LimitOrderStatus =
  | "OPEN"       // Waiting for trigger price
  | "TRIGGERED"  // Price hit; execution in progress
  | "EXECUTED"   // Trade confirmed
  | "CANCELLED"  // Manually cancelled
  | "EXPIRED";   // Past expiry without execution

export interface LimitOrder {
  id: string;
  type: LimitOrderType;
  /** USD price that triggers this order */
  triggerPrice: number;
  /** KAS amount to buy/sell */
  kasAmount: number;
  /** Stablecoin ticker (e.g. "USDC") */
  stableTick: string;
  /** Approximate stablecoin amount at order creation time (kasAmount × triggerPrice) */
  stableAmountEst: number;
  /** Unix ms — 0 = no expiry */
  expiry: number;
  createdAt: number;
  status: LimitOrderStatus;
  triggeredAt?: number;
  executedAt?: number;
  txId?: string;
  /** Optional user note */
  note?: string;
}

export interface BuildLimitOrderParams {
  type: LimitOrderType;
  triggerPrice: number;
  kasAmount: number;
  stableTick?: string;
  expiryMs?: number; // duration from now; 0 = no expiry
  note?: string;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const LIMIT_ORDERS_KEY = "forgeos.limit.orders.v1";

function loadOrders(): LimitOrder[] {
  try {
    const raw = localStorage.getItem(LIMIT_ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveOrders(orders: LimitOrder[]): void {
  try {
    localStorage.setItem(LIMIT_ORDERS_KEY, JSON.stringify(orders));
  } catch {
    // storage full — silent fail
  }
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Creates and persists a new limit order.
 * Returns null if params are invalid.
 */
export function buildLimitOrder(params: BuildLimitOrderParams): LimitOrder | null {
  const { type, triggerPrice, kasAmount } = params;
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) return null;
  if (!Number.isFinite(kasAmount) || kasAmount <= 0) return null;

  const stableTick = String(params.stableTick ?? "USDC").toUpperCase();
  const now = Date.now();
  const expiry = params.expiryMs && params.expiryMs > 0 ? now + params.expiryMs : 0;

  const order: LimitOrder = {
    id: `lo_${crypto.randomUUID()}`,
    type,
    triggerPrice,
    kasAmount,
    stableTick,
    stableAmountEst: Number((kasAmount * triggerPrice).toFixed(2)),
    expiry,
    createdAt: now,
    status: "OPEN",
    note: params.note,
  };

  const orders = loadOrders();
  orders.push(order);
  saveOrders(orders);
  return order;
}

/** Marks an order as CANCELLED. No-op if not OPEN. */
export function cancelLimitOrder(id: string): boolean {
  const orders = loadOrders();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx < 0 || orders[idx].status !== "OPEN") return false;
  orders[idx] = { ...orders[idx], status: "CANCELLED" };
  saveOrders(orders);
  return true;
}

/** Marks an TRIGGERED order as EXECUTED with optional txId. */
export function markOrderExecuted(id: string, txId?: string): boolean {
  const orders = loadOrders();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx < 0) return false;
  if (orders[idx].status !== "TRIGGERED" && orders[idx].status !== "OPEN") return false;
  orders[idx] = { ...orders[idx], status: "EXECUTED", executedAt: Date.now(), txId };
  saveOrders(orders);
  return true;
}

/** Returns all stored orders (all statuses). */
export function getAllOrders(): LimitOrder[] {
  return loadOrders();
}

/** Returns all OPEN orders. */
export function getOpenOrders(): LimitOrder[] {
  return loadOrders().filter((o) => o.status === "OPEN");
}

/**
 * Marks expired OPEN orders as EXPIRED.
 * Call this on each price tick or when orders panel mounts.
 * Returns the number of orders expired.
 */
export function pruneExpiredOrders(): number {
  const now = Date.now();
  const orders = loadOrders();
  let count = 0;
  const updated = orders.map((o) => {
    if (o.status === "OPEN" && o.expiry > 0 && now >= o.expiry) {
      count++;
      return { ...o, status: "EXPIRED" as LimitOrderStatus };
    }
    return o;
  });
  if (count > 0) saveOrders(updated);
  return count;
}

/**
 * Checks all OPEN orders against currentPriceUsd.
 * Calls onTrigger(order) for each order whose trigger condition is met.
 * Marks triggered orders as TRIGGERED immediately (before onTrigger resolves).
 *
 * Trigger conditions:
 *   BUY  → current price <= triggerPrice  (buy when price dips to target)
 *   SELL → current price >= triggerPrice  (sell when price rises to target)
 *
 * Returns the list of triggered orders.
 */
export function checkAndTriggerOrders(
  currentPriceUsd: number,
  onTrigger: (order: LimitOrder) => void,
): LimitOrder[] {
  if (!Number.isFinite(currentPriceUsd) || currentPriceUsd <= 0) return [];

  pruneExpiredOrders();
  const orders = loadOrders();
  const triggered: LimitOrder[] = [];
  const updated = orders.map((o) => {
    if (o.status !== "OPEN") return o;
    const hit =
      (o.type === "BUY" && currentPriceUsd <= o.triggerPrice) ||
      (o.type === "SELL" && currentPriceUsd >= o.triggerPrice);
    if (!hit) return o;
    triggered.push(o);
    return { ...o, status: "TRIGGERED" as LimitOrderStatus, triggeredAt: Date.now() };
  });
  if (triggered.length > 0) {
    saveOrders(updated);
    for (const order of triggered) onTrigger(order);
  }
  return triggered;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatLimitOrder(o: LimitOrder): string {
  const dir = o.type === "BUY" ? "BUY" : "SELL";
  const ttl =
    o.expiry > 0
      ? ` · expires ${new Date(o.expiry).toLocaleDateString()}`
      : "";
  return (
    `${dir} ${o.kasAmount.toFixed(4)} KAS @ $${o.triggerPrice.toFixed(4)}` +
    ` (~${o.stableAmountEst.toFixed(2)} ${o.stableTick})${ttl}`
  );
}

export function limitOrderStatusColor(status: LimitOrderStatus): string {
  switch (status) {
    case "OPEN":      return "#39DDB6";
    case "TRIGGERED": return "#F5A623";
    case "EXECUTED":  return "#4CAF50";
    case "CANCELLED": return "#32435A";
    case "EXPIRED":   return "#E53935";
  }
}
