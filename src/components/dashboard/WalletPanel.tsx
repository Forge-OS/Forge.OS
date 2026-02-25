import { useCallback, useEffect, useMemo, useState } from "react";
import { ALLOWED_ADDRESS_PREFIXES, EXPLORER, NET_FEE, NETWORK_LABEL, RESERVE } from "../../constants";
import { fmt, isKaspaAddress } from "../../helpers";
import { kasBalance, kasUtxos } from "../../api/kaspaApi";
import { C, mono } from "../../tokens";
import { WalletAdapter } from "../../wallet/WalletAdapter";
import { SigningModal } from "../SigningModal";
import { Badge, Btn, Card, ExtLink, Inp } from "../ui";
import {
  LineChart, Line, ResponsiveContainer, Tooltip, ReferenceLine,
} from "recharts";

// ── helpers ───────────────────────────────────────────────────────────────────

const fmtTs = (d: Date | null) => d
  ? `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`
  : "—";

const fmtUsd = (v: number | null) =>
  v === null ? "—"
  : v >= 1 ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : `$${v.toFixed(4)}`;

// regime → color + label
const REGIME_META: Record<string, { color: string; label: string; desc: string }> = {
  TREND_UP:          { color: "#39DDB6", label: "TREND UP",       desc: "Strong upward price momentum" },
  FLOW_ACCUMULATION: { color: "#39DDB6", label: "ACCUMULATING",   desc: "DAG inflow detected" },
  NEUTRAL:           { color: "#8FA0B5", label: "NEUTRAL",         desc: "No strong signal" },
  RANGE_VOL:         { color: "#F7B267", label: "RANGING VOL",     desc: "High volatility, no trend" },
  RISK_OFF:          { color: "#FF5D7A", label: "RISK OFF",        desc: "Drawdown pressure" },
};

const ACTION_META: Record<string, { color: string; label: string }> = {
  ACCUMULATE: { color: "#39DDB6", label: "⬆ ACCUMULATE" },
  HOLD:       { color: "#8FA0B5", label: "◆ HOLD" },
  REDUCE:     { color: "#FF5D7A", label: "⬇ REDUCE" },
  REBALANCE:  { color: "#F7B267", label: "↔ REBALANCE" },
};

// ── component ─────────────────────────────────────────────────────────────────

export function WalletPanel({ agent, wallet, kasData, marketHistory = [], lastDecision }: any) {
  const [liveKas, setLiveKas] = useState(null as any);
  const [utxos, setUtxos] = useState([] as any[]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null as any);
  const [fetched, setFetched] = useState(null as any);
  const [signingTx, setSigningTx] = useState(null as any);
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [note, setNote] = useState("");

  const priceUsd = Number(kasData?.priceUsd || 0);
  const daaScore = kasData?.dag?.daaScore;
  const blockCount = kasData?.dag?.blockCount || kasData?.dag?.headerCount;
  const networkName = kasData?.dag?.networkName || NETWORK_LABEL;
  const providerLabel = wallet?.provider === "kasware" ? "KasWare"
    : wallet?.provider === "demo" ? "Demo Mode"
    : wallet?.provider === "kasware-wasm" ? "KasWare (WASM)"
    : wallet?.provider || "External";

  // quant signal from last decision
  const dec = lastDecision?.dec;
  const qm = dec?.quant_metrics;
  const regime = String(qm?.regime || "");
  const regimeMeta = REGIME_META[regime] || { color: C.dim, label: "AWAITING DATA", desc: "Run a cycle to generate signal" };
  const actionMeta = ACTION_META[dec?.action || ""] || null;
  const daaVelocity = Number(qm?.daa_velocity || 0);
  const ewmaVol = Number(qm?.ewma_volatility || 0);
  const momentumZ = Number(qm?.momentum_z || 0);
  const edgeScore = Number(qm?.edge_score || 0);

  // price history for sparkline + 24h change
  const priceSnapshots = useMemo(() => {
    const arr = Array.isArray(marketHistory) ? marketHistory : [];
    return arr.filter((s: any) => s.priceUsd > 0).slice(-80);
  }, [marketHistory]);

  const priceChartData = priceSnapshots.map((s: any, i: number) => ({
    i,
    price: Number(s.priceUsd || 0),
  }));

  const firstPrice = priceSnapshots.length > 1 ? Number(priceSnapshots[0].priceUsd || 0) : 0;
  const change24hPct = firstPrice > 0 && priceUsd > 0
    ? ((priceUsd - firstPrice) / firstPrice) * 100
    : null;
  const change24hPositive = change24hPct !== null && change24hPct >= 0;

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      let b: any;
      if (wallet?.provider === "kasware") { b = await WalletAdapter.getKaswareBalance(); }
      else { const r = await kasBalance(wallet?.address || agent.wallet); b = r.kas; }
      const u = await kasUtxos(wallet?.address || agent.wallet);
      setLiveKas(b);
      setUtxos(Array.isArray(u) ? u.slice(0, 12) : []);
      setFetched(new Date());
    } catch (e: any) { setErr(e.message); }
    setLoading(false);
  }, [wallet, agent]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const interval = setInterval(() => refresh(), 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const bal = parseFloat(liveKas ?? agent.capitalLimit ?? 0);
  const maxSendKas = Math.max(0, bal - RESERVE - NET_FEE);
  const maxSend = maxSendKas.toFixed(4);
  const balanceUsd = priceUsd > 0 ? bal * priceUsd : null;
  const spendableKas = Math.max(0, bal - RESERVE - NET_FEE);
  const spendableUsd = priceUsd > 0 ? spendableKas * priceUsd : null;
  const capitalLimit = Number(agent?.capitalLimit || 0);
  const vaultUtilPct = capitalLimit > 0 ? Math.min(100, (bal / capitalLimit) * 100) : 0;
  const vaultUtilColor = vaultUtilPct > 90 ? C.danger : vaultUtilPct > 60 ? C.warn : C.ok;

  const initiateWithdraw = () => {
    const requested = Number(withdrawAmt);
    if (!isKaspaAddress(withdrawTo, ALLOWED_ADDRESS_PREFIXES) || !(requested > 0) || requested > maxSendKas) return;
    setSigningTx({ type: "WITHDRAW", from: wallet?.address, to: withdrawTo, amount_kas: Number(requested.toFixed(6)), purpose: note || "Withdrawal" });
  };
  const handleSigned = () => { setSigningTx(null); setWithdrawTo(""); setWithdrawAmt(""); setNote(""); };

  return (
    <div>
      {signingTx && <SigningModal tx={signingTx} wallet={wallet} onSign={handleSigned} onReject={() => setSigningTx(null)} />}

      {/* ── KAS / USDC MARKET ── */}
      <Card p={0} style={{ marginBottom: 12, border: `1px solid ${C.accent}28`, overflow: "hidden" }}>
        <div style={{ height: 2, background: `linear-gradient(90deg, ${C.accent}, ${C.purple}, ${C.accent})` }} />

        {/* Header strip */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 16px", borderBottom: `1px solid rgba(33,48,67,0.5)`, background: "rgba(8,13,20,0.6)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src="/kaspa-logo.png" alt="KAS" width={16} height={16} style={{ borderRadius: "50%" }} />
            <span style={{ fontSize: 11, color: C.accent, fontWeight: 700, ...mono }}>KAS / USDC</span>
            <span style={{ fontSize: 9, color: C.dim, ...mono, background: "rgba(33,48,67,0.5)", padding: "2px 6px", borderRadius: 3 }}>{networkName}</span>
            {daaScore && (
              <span style={{ fontSize: 9, color: C.dim, ...mono }}>
                DAA <span style={{ color: C.text }}>{Number(daaScore).toLocaleString()}</span>
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 9, ...mono, color: C.purple, background: `${C.purple}15`, padding: "3px 8px", borderRadius: 3 }}>
              {providerLabel}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 4, background: `${loading ? C.warn : C.accent}15`, padding: "3px 8px", borderRadius: 3 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: loading ? C.warn : C.accent, boxShadow: `0 0 6px ${loading ? C.warn : C.accent}` }} />
              <span style={{ fontSize: 9, color: loading ? C.warn : C.accent, fontWeight: 600, ...mono }}>{loading ? "SYNC…" : "LIVE"}</span>
            </div>
          </div>
        </div>

        {/* Price row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, padding: "14px 16px 0" }}>
          <div>
            <div style={{ fontSize: 9, color: C.dim, ...mono, letterSpacing: "0.12em", marginBottom: 4 }}>KAS / USDC PRICE</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 26, color: C.accent, fontWeight: 700, ...mono }}>
                {priceUsd > 0 ? `$${priceUsd.toFixed(4)}` : "—"}
              </span>
              {change24hPct !== null && (
                <span style={{ fontSize: 12, color: change24hPositive ? C.ok : C.danger, fontWeight: 600, ...mono }}>
                  {change24hPositive ? "▲ +" : "▼ "}{change24hPct.toFixed(2)}%
                </span>
              )}
            </div>
            {change24hPct !== null && (
              <div style={{ fontSize: 9, color: C.dim, ...mono, marginTop: 2 }}>
                Session change · {priceSnapshots.length} samples
              </div>
            )}
          </div>
          {/* Mini sparkline */}
          {priceChartData.length > 3 && (
            <div style={{ width: 120, paddingBottom: 8 }}>
              <ResponsiveContainer width="100%" height={48}>
                <LineChart data={priceChartData}>
                  <Line
                    type="monotone" dataKey="price"
                    stroke={change24hPositive ? C.ok : C.danger}
                    strokeWidth={1.5} dot={false} isAnimationActive={false}
                  />
                  <Tooltip
                    formatter={(v: number) => [`$${v.toFixed(4)}`, "KAS/USDC"]}
                    contentStyle={{ background: "rgba(8,13,20,0.95)", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 9 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Stablecoin balance */}
        <div style={{ padding: "12px 16px 14px" }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: C.dim, ...mono, letterSpacing: "0.12em" }}>STABLECOIN BALANCE</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: `${C.warn}15`, border: `1px solid ${C.warn}40`, borderRadius: 4, padding: "3px 8px" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.warn, display: "inline-block" }} />
                <span style={{ fontSize: 7, color: C.warn, fontWeight: 700, ...mono, letterSpacing: "0.1em" }}>DEMO</span>
              </div>
            </div>

            {/* USDC row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <img src="/usdc_white.png" alt="USDC" width={32} height={32} style={{ flexShrink: 0, borderRadius: "50%", boxShadow: "0 0 10px rgba(39,117,202,0.4)" }} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.text, ...mono }}>USDC</div>
                  <div style={{ fontSize: 8, color: C.dim }}>USD Coin</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: C.text, ...mono, lineHeight: 1 }}>0.00</div>
                <div style={{ fontSize: 9, color: C.dim, ...mono }}>≈ $0.00</div>
              </div>
            </div>

            {/* USDT row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <img src="/usdt-logo.svg" alt="USDT" width={32} height={32} style={{ flexShrink: 0, boxShadow: "0 0 10px rgba(38,161,123,0.4)", borderRadius: "50%" }} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.text, ...mono }}>USDT</div>
                  <div style={{ fontSize: 8, color: C.dim }}>Tether USD</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: C.text, ...mono, lineHeight: 1 }}>0.00</div>
                <div style={{ fontSize: 9, color: C.dim, ...mono }}>≈ $0.00</div>
              </div>
            </div>
          </div>

          {/* Stats row – 4 tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
            {[
              { k: "SPENDABLE", v: liveKas !== null ? `${fmt(spendableKas, 2)} KAS` : "—", sub: spendableUsd !== null ? fmtUsd(spendableUsd) : null, c: C.accent },
              { k: "RESERVE", v: `${RESERVE} KAS`, sub: "locked", c: C.purple },
              { k: "NET FEE", v: `${NET_FEE} KAS`, sub: "per tx", c: C.warn },
              { k: "UTXO COUNT", v: utxos.length > 0 ? String(utxos.length) : "—", sub: "outputs", c: C.dim },
            ].map(item => (
              <div key={item.k} style={{ background: `linear-gradient(135deg, ${item.c}10 0%, rgba(8,13,20,0.6) 100%)`, borderRadius: 8, padding: "9px 10px", border: `1px solid ${item.c}20` }}>
                <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 3, letterSpacing: "0.1em" }}>{item.k}</div>
                <div style={{ fontSize: 12, color: item.c, fontWeight: 700, ...mono }}>{item.v}</div>
                {item.sub && <div style={{ fontSize: 8, color: C.muted, ...mono, marginTop: 1 }}>{item.sub}</div>}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 9, color: C.muted, ...mono }}>Updated {fmtTs(fetched)}</span>
            <button onClick={refresh} disabled={loading}
              style={{ background: `${C.accent}08`, border: `1px solid ${C.accent}25`, color: C.accent, borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 10, ...mono }}>
              {loading ? "Syncing…" : "↺ Refresh"}
            </button>
          </div>
        </div>

        {err && (
          <div style={{ padding: "8px 16px", background: `${C.danger}12`, borderTop: `1px solid ${C.danger}30`, fontSize: 11, color: C.danger, ...mono }}>⚠ {err}</div>
        )}
      </Card>

      {/* ── DEPOSIT ADDRESS ── */}
      <Card p={12} style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: C.dim, ...mono, letterSpacing: "0.12em", marginBottom: 8 }}>
          DEPOSIT ADDRESS <span style={{ color: C.ok }}>↓ INCOMING</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1, background: "rgba(8,13,20,0.65)", borderRadius: 6, padding: "9px 12px", border: `1px solid rgba(33,48,67,0.6)`, overflow: "hidden" }}>
            <div style={{ fontSize: 8, color: C.dim, ...mono, marginBottom: 2, letterSpacing: "0.1em" }}>KASPA ADDRESS</div>
            <div style={{ fontSize: 10, color: C.accent, ...mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {wallet?.address || "—"}
            </div>
          </div>
          <Btn onClick={() => navigator.clipboard?.writeText(wallet?.address || "")} variant="primary" style={{ padding: "8px 14px", fontSize: 11 }}>📋</Btn>
        </div>
        {wallet?.address && (
          <ExtLink href={`${EXPLORER}/addresses/${wallet.address}`} style={{ fontSize: 9, color: C.dim, ...mono, marginTop: 6, display: "block" }}>
            ↗ View on Kaspa Explorer
          </ExtLink>
        )}
      </Card>

      {/* ── SEND KAS ── */}
      <Card p={12} style={{ marginBottom: 12, border: `1px solid ${C.danger}20` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: C.dim, ...mono, letterSpacing: "0.12em" }}>
            SEND KAS <span style={{ color: C.danger }}>↑ OUTGOING</span>
          </div>
          <span style={{ fontSize: 9, color: C.dim, ...mono }}>MAX: {maxSend} KAS</span>
        </div>

        <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
          {[{ l: "25%", v: maxSendKas * 0.25 }, { l: "50%", v: maxSendKas * 0.5 }, { l: "75%", v: maxSendKas * 0.75 }, { l: "MAX", v: maxSendKas }].map(p => (
            <button key={p.l} onClick={() => setWithdrawAmt(p.v.toFixed(4))} disabled={maxSendKas <= 0}
              style={{ flex: 1, padding: "5px", borderRadius: 4, border: `1px solid rgba(33,48,67,0.7)`, background: "rgba(8,13,20,0.55)", color: C.dim, fontSize: 10, cursor: "pointer", ...mono }}>
              {p.l}
            </button>
          ))}
        </div>

        <Inp label="Recipient" value={withdrawTo} onChange={setWithdrawTo} placeholder="kaspa:..." />
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "end", marginBottom: 6 }}>
          <Inp label="Amount (KAS)" value={withdrawAmt} onChange={setWithdrawAmt} type="number" suffix="KAS" placeholder="0" />
          <Btn onClick={() => setWithdrawAmt(maxSend)} variant="ghost" size="sm">MAX</Btn>
        </div>

        {withdrawAmt && Number(withdrawAmt) > 0 && priceUsd > 0 && (
          <div style={{ fontSize: 9, color: C.dim, ...mono, marginBottom: 6, textAlign: "right" }}>
            ≈ {fmtUsd(Number(withdrawAmt) * priceUsd)} USDC
          </div>
        )}

        <Btn
          onClick={initiateWithdraw}
          disabled={!isKaspaAddress(withdrawTo, ALLOWED_ADDRESS_PREFIXES) || !Number(withdrawAmt) || Number(withdrawAmt) > maxSendKas}
          style={{ width: "100%", padding: "9px", fontSize: 11 }}>
          ↗ SEND {withdrawAmt || "0"} KAS
          {withdrawAmt && Number(withdrawAmt) > 0 && priceUsd > 0 ? ` (${fmtUsd(Number(withdrawAmt) * priceUsd)})` : ""}
        </Btn>
      </Card>

      {/* ── DAG NETWORK + AGENT SIGNAL ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>

        {/* DAG Network state */}
        <Card p={12} style={{ background: `linear-gradient(135deg, ${C.purple}06 0%, rgba(8,13,20,0.5) 100%)`, border: `1px solid ${C.purple}20` }}>
          <div style={{ fontSize: 9, color: C.dim, ...mono, letterSpacing: "0.12em", marginBottom: 10 }}>DAG NETWORK</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {[
              { k: "DAA Score", v: daaScore ? Number(daaScore).toLocaleString() : "—", c: C.accent },
              { k: "Block Count", v: blockCount ? Number(blockCount).toLocaleString() : "—", c: C.dim },
              {
                k: "DAA Velocity",
                v: qm ? `${daaVelocity >= 0 ? "+" : ""}${daaVelocity.toFixed(1)} blk/s` : "—",
                c: daaVelocity > 0 ? C.ok : daaVelocity < 0 ? C.danger : C.dim,
              },
              { k: "EWMA Volatility", v: qm ? `${(ewmaVol * 100).toFixed(3)}%` : "—", c: ewmaVol > 0.02 ? C.warn : C.ok },
            ].map(item => (
              <div key={item.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 9, color: C.dim, ...mono }}>{item.k}</span>
                <span style={{ fontSize: 11, color: item.c, fontWeight: 600, ...mono }}>{item.v}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Agent Signal */}
        <Card p={12} style={{ background: `linear-gradient(135deg, ${regimeMeta.color}10 0%, rgba(8,13,20,0.5) 100%)`, border: `1px solid ${regimeMeta.color}28` }}>
          <div style={{ fontSize: 9, color: C.dim, ...mono, letterSpacing: "0.12em", marginBottom: 10 }}>AGENT SIGNAL</div>
          <div>
            <div style={{ fontSize: 14, color: regimeMeta.color, fontWeight: 700, ...mono, marginBottom: 2 }}>{regimeMeta.label}</div>
            <div style={{ fontSize: 9, color: C.dim, marginBottom: 8 }}>{regimeMeta.desc}</div>
          </div>
          {actionMeta && (
            <div style={{ background: `${actionMeta.color}14`, border: `1px solid ${actionMeta.color}30`, borderRadius: 4, padding: "5px 10px", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: actionMeta.color, fontWeight: 700, ...mono }}>{actionMeta.label}</span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {[
              { k: "Confidence", v: dec ? `${(dec.confidence_score * 100).toFixed(1)}%` : "—", c: C.dim },
              { k: "Momentum Z", v: qm ? `${momentumZ >= 0 ? "+" : ""}${momentumZ.toFixed(2)}` : "—", c: momentumZ > 0.5 ? C.ok : momentumZ < -0.5 ? C.danger : C.dim },
              { k: "Edge Score", v: qm ? edgeScore.toFixed(3) : "—", c: edgeScore > 0.1 ? C.ok : C.dim },
            ].map(item => (
              <div key={item.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 9, color: C.dim, ...mono }}>{item.k}</span>
                <span style={{ fontSize: 11, color: item.c, fontWeight: 600, ...mono }}>{item.v}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── AGENT VAULT ALLOCATION ── */}
      <Card p={14} style={{ marginBottom: 12, background: `linear-gradient(135deg, ${C.accent}06 0%, rgba(8,13,20,0.5) 100%)`, border: `1px solid ${C.accent}20` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 9, color: C.dim, ...mono, letterSpacing: "0.12em", marginBottom: 4 }}>AGENT VAULT ALLOCATION</div>
            <div style={{ fontSize: 13, color: C.text, fontWeight: 700, ...mono }}>{agent?.name || "—"}</div>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 1 }}>{agent?.strategyLabel || agent?.strategyTemplate || "Accumulation Strategy"}</div>
          </div>
          <Badge
            text={`Risk: ${String(agent?.risk || "—").toUpperCase()}`}
            color={agent?.risk === "low" ? C.ok : agent?.risk === "medium" ? C.warn : C.danger}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
          {[
            { k: "CAPITAL LIMIT", v: capitalLimit > 0 ? `${fmt(capitalLimit, 2)} KAS` : "—", c: C.ok },
            { k: "LIVE BALANCE", v: liveKas !== null ? `${fmt(bal, 2)} KAS` : "—", c: C.accent },
            { k: "UTILIZATION", v: capitalLimit > 0 ? `${vaultUtilPct.toFixed(1)}%` : "—", c: vaultUtilColor },
          ].map(item => (
            <div key={item.k} style={{ background: `linear-gradient(135deg, ${item.c}08 0%, rgba(8,13,20,0.5) 100%)`, borderRadius: 6, padding: "8px 10px", border: `1px solid ${item.c}18` }}>
              <div style={{ fontSize: 8, color: C.dim, ...mono, letterSpacing: "0.1em" }}>{item.k}</div>
              <div style={{ fontSize: 12, color: item.c, fontWeight: 700, ...mono, marginTop: 2 }}>{item.v}</div>
            </div>
          ))}
        </div>

        {capitalLimit > 0 && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: C.dim, ...mono }}>Vault utilization</span>
              <span style={{ fontSize: 9, color: vaultUtilColor, ...mono }}>{vaultUtilPct.toFixed(1)}%</span>
            </div>
            <div style={{ width: "100%", height: 4, background: "rgba(16,25,35,0.7)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${vaultUtilPct}%`, height: "100%", background: `linear-gradient(90deg, ${C.accent}, ${vaultUtilColor})`, borderRadius: 2, transition: "width 0.5s ease" }} />
            </div>
          </div>
        )}
      </Card>

      {/* ── PRICE HISTORY (if enough data) ── */}
      {priceChartData.length > 6 && (
        <Card p={14} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, ...mono, letterSpacing: "0.1em" }}>
              KAS / USDC PRICE HISTORY
            </div>
            <div style={{ fontSize: 9, color: C.dim, ...mono }}>
              {priceChartData.length} ticks · session
            </div>
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={priceChartData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
              <Line
                type="monotone" dataKey="price"
                stroke={change24hPositive ? C.ok : C.danger}
                strokeWidth={2} dot={false} isAnimationActive={false}
              />
              {priceUsd > 0 && firstPrice > 0 && (
                <ReferenceLine y={firstPrice} stroke={C.dim} strokeDasharray="3 3" />
              )}
              <Tooltip
                formatter={(v: number) => [`$${v.toFixed(4)}`, "KAS/USDC"]}
                contentStyle={{ background: "rgba(8,13,20,0.95)", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 9 }}
              />
            </LineChart>
          </ResponsiveContainer>
          {change24hPct !== null && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: 9, color: C.dim, ...mono }}>Open: ${firstPrice.toFixed(4)}</span>
              <span style={{ fontSize: 9, color: change24hPositive ? C.ok : C.danger, fontWeight: 600, ...mono }}>
                {change24hPositive ? "▲ +" : "▼ "}{change24hPct.toFixed(2)}% session
              </span>
              <span style={{ fontSize: 9, color: C.dim, ...mono }}>Last: ${priceUsd.toFixed(4)}</span>
            </div>
          )}
        </Card>
      )}

      {/* ── UTXOs ── */}
      {utxos.length > 0 && (
        <Card p={12}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: C.dim, ...mono, letterSpacing: "0.12em" }}>UNSPENT OUTPUTS</div>
            <span style={{ fontSize: 9, color: C.dim, ...mono, background: "rgba(16,25,35,0.6)", padding: "2px 8px", borderRadius: 3 }}>{utxos.length} UTXOs</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {utxos.slice(0, 6).map((u: any, i: number) => {
              const utxoKas = (u.utxoEntry?.amount || 0) / 1e8;
              const utxoUsd = priceUsd > 0 ? utxoKas * priceUsd : null;
              return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: `linear-gradient(135deg, ${C.accent}06 0%, rgba(8,13,20,0.5) 100%)`, borderRadius: 6, border: `1px solid rgba(33,48,67,0.4)` }}>
                  <span style={{ color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "54%", fontSize: 9, ...mono }}>
                    #{i + 1} {u.outpoint?.transactionId?.slice(0, 16)}…
                  </span>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: C.accent, fontWeight: 600, ...mono }}>{fmt(utxoKas, 2)} KAS</div>
                    {utxoUsd !== null && <div style={{ fontSize: 9, color: C.dim, ...mono }}>{fmtUsd(utxoUsd)}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
