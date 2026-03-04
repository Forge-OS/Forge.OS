import { useState, useEffect } from "react";
import { C, mono } from "../../tokens";
import { Badge, Btn, Card, Label } from "../ui";
import {
  buildLimitOrder,
  cancelLimitOrder,
  getAllOrders,
  pruneExpiredOrders,
  formatLimitOrder,
  limitOrderStatusColor,
  type LimitOrder,
  type LimitOrderType,
} from "../../quant/limitOrder";

interface Props {
  currentPriceUsd?: number;
}

export function LimitOrderPanel({ currentPriceUsd = 0 }: Props) {
  const [orders, setOrders] = useState<LimitOrder[]>([]);
  const [type, setType] = useState<LimitOrderType>("BUY");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [kasAmount, setKasAmount] = useState("");
  const [expiryHours, setExpiryHours] = useState("24");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function refresh() {
    pruneExpiredOrders();
    setOrders(getAllOrders());
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  function handleCreate() {
    setError(null);
    const price = parseFloat(triggerPrice);
    const kas = parseFloat(kasAmount);
    const expMs = parseFloat(expiryHours) * 3_600_000;
    if (!Number.isFinite(price) || price <= 0) { setError("Enter a valid trigger price."); return; }
    if (!Number.isFinite(kas) || kas <= 0) { setError("Enter a valid KAS amount."); return; }
    const order = buildLimitOrder({
      type,
      triggerPrice: price,
      kasAmount: kas,
      expiryMs: parseFloat(expiryHours) > 0 ? expMs : 0,
      note: note.trim() || undefined,
    });
    if (!order) { setError("Failed to create order."); return; }
    setTriggerPrice(""); setKasAmount(""); setNote(""); setShowForm(false);
    refresh();
  }

  function handleCancel(id: string) {
    cancelLimitOrder(id);
    refresh();
  }

  const open = orders.filter((o) => o.status === "OPEN");
  const closed = orders.filter((o) => o.status !== "OPEN");

  const inputStyle = {
    background: C.s2, border: `1px solid ${C.border}`, borderRadius: 6,
    color: C.text, padding: "8px 12px", fontSize: 13, width: "100%",
    boxSizing: "border-box" as const, ...mono,
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, color: C.text, fontWeight: 700, ...mono, marginBottom: 2 }}>Limit Orders</div>
          <div style={{ fontSize: 12, color: C.dim }}>Price-triggered KAS buy/sell orders</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {currentPriceUsd > 0 && (
            <span style={{ fontSize: 12, color: C.accent, ...mono }}>${currentPriceUsd.toFixed(4)}</span>
          )}
          <Btn size="sm" variant={showForm ? "ghost" : "primary"} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "CANCEL" : "+ NEW ORDER"}
          </Btn>
        </div>
      </div>

      {showForm && (
        <Card p={16} style={{ marginBottom: 16, border: `1px solid ${C.accent}40` }}>
          <Label>New Limit Order</Label>
          {error && (
            <div style={{ fontSize: 12, color: C.danger, marginBottom: 10, padding: "6px 10px", background: `${C.danger}15`, borderRadius: 4 }}>
              {error}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>ORDER TYPE</div>
              <div style={{ display: "flex", gap: 6 }}>
                {(["BUY", "SELL"] as LimitOrderType[]).map((t) => (
                  <Btn key={t} size="sm" variant={type === t ? "primary" : "ghost"} onClick={() => setType(t)}>
                    {t} KAS
                  </Btn>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>
                {type === "BUY" ? "BUY WHEN PRICE ≤ ($)" : "SELL WHEN PRICE ≥ ($)"}
              </div>
              <input
                style={inputStyle}
                type="number"
                placeholder={currentPriceUsd > 0 ? currentPriceUsd.toFixed(4) : "0.0000"}
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(e.target.value)}
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>KAS AMOUNT</div>
              <input
                style={inputStyle}
                type="number"
                placeholder="100"
                value={kasAmount}
                onChange={(e) => setKasAmount(e.target.value)}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>EXPIRES IN (hours, 0=never)</div>
              <input
                style={inputStyle}
                type="number"
                placeholder="24"
                value={expiryHours}
                onChange={(e) => setExpiryHours(e.target.value)}
              />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>NOTE (optional)</div>
            <input
              style={inputStyle}
              type="text"
              placeholder="e.g. dip buy"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {triggerPrice && kasAmount && (
            <div style={{ fontSize: 11, color: C.dim, ...mono, marginBottom: 10 }}>
              ~{(parseFloat(kasAmount) * parseFloat(triggerPrice)).toFixed(2)} USDC
              {type === "BUY" ? " to spend" : " to receive"}
            </div>
          )}
          <Btn size="sm" variant="primary" onClick={handleCreate}>PLACE ORDER</Btn>
        </Card>
      )}

      {/* Open orders */}
      {open.length > 0 && (
        <Card p={0} style={{ marginBottom: 12 }}>
          <div style={{ padding: "10px 14px", background: C.s2, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 11, color: C.text, fontWeight: 600, ...mono }}>
              OPEN ({open.length})
            </span>
          </div>
          {open.map((o, i) => (
            <div
              key={o.id}
              style={{
                padding: "10px 14px",
                borderBottom: i < open.length - 1 ? `1px solid ${C.border}` : "none",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: C.text, ...mono }}>{formatLimitOrder(o)}</div>
                {o.note && <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{o.note}</div>}
              </div>
              <Btn size="sm" variant="ghost" onClick={() => handleCancel(o.id)}>CANCEL</Btn>
            </div>
          ))}
        </Card>
      )}

      {/* Closed orders history */}
      {closed.length > 0 && (
        <Card p={0}>
          <div style={{ padding: "10px 14px", background: C.s2, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 11, color: C.text, fontWeight: 600, ...mono }}>HISTORY</span>
          </div>
          {closed.slice(0, 20).map((o, i) => (
            <div
              key={o.id}
              style={{
                padding: "10px 14px",
                borderBottom: i < Math.min(closed.length, 20) - 1 ? `1px solid ${C.border}` : "none",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}
            >
              <div style={{ fontSize: 12, color: C.dim, ...mono }}>{formatLimitOrder(o)}</div>
              <Badge
                text={o.status}
                color={limitOrderStatusColor(o.status)}
              />
            </div>
          ))}
        </Card>
      )}

      {open.length === 0 && closed.length === 0 && (
        <div style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 13, color: C.dim, marginBottom: 4 }}>No limit orders</div>
          <div style={{ fontSize: 12, color: C.dim }}>Place an order to execute automatically when KAS hits your target price</div>
        </div>
      )}
    </div>
  );
}
