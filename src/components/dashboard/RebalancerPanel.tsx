import { useState } from "react";
import { C, mono } from "../../tokens";
import { Badge, Btn, Card, Label } from "../ui";
import {
  computeRebalanceTrades,
  validateTargetWeights,
  type AssetWeights,
  type RebalanceTrade,
} from "../../quant/portfolioRebalancer";

interface Props {
  /** Current USD value per asset, e.g. { KAS: 800, USDC: 200 } */
  currentValues?: Record<string, number>;
  /** Current price per asset in USD */
  prices?: Record<string, number>;
  /** Called when user clicks "EXECUTE REBALANCE" for a trade */
  onRebalanceTrade?: (trade: RebalanceTrade) => void;
}

const DEFAULT_WEIGHTS = "KAS: 60\nUSDC: 40";

export function RebalancerPanel({ currentValues = {}, prices = {}, onRebalanceTrade }: Props) {
  const [weightsRaw, setWeightsRaw] = useState(DEFAULT_WEIGHTS);
  const [driftPct, setDriftPct] = useState("5");
  const [minTradeUsd, setMinTradeUsd] = useState("5");
  const [result, setResult] = useState<ReturnType<typeof computeRebalanceTrades> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function parseWeights(): AssetWeights | null {
    const weights: AssetWeights = {};
    for (const line of weightsRaw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.includes(":") ? ":" : trimmed.includes("=") ? "=" : null;
      if (!sep) continue;
      const [rawKey, rawVal] = trimmed.split(sep);
      const asset = rawKey.trim().toUpperCase();
      const val = parseFloat(rawVal?.trim());
      if (asset && Number.isFinite(val) && val > 0) weights[asset] = val;
    }
    return Object.keys(weights).length > 0 ? weights : null;
  }

  function handleCompute() {
    setError(null);
    const weights = parseWeights();
    if (!weights) { setError("Enter target weights (e.g. KAS: 60, USDC: 40)."); return; }
    const validationErr = validateTargetWeights(weights);
    if (validationErr) { setError(validationErr); return; }
    const drift = parseFloat(driftPct) / 100;
    const minTrade = parseFloat(minTradeUsd);
    if (!Number.isFinite(drift) || drift <= 0) { setError("Drift threshold must be > 0."); return; }
    setResult(computeRebalanceTrades({
      targetWeights: weights,
      currentValues,
      prices,
      driftThreshold: drift,
      minTradeUsd: Number.isFinite(minTrade) ? minTrade : 5,
    }));
  }

  const totalPortfolio = result?.totalPortfolioUsd ?? Object.values(currentValues).reduce((s, v) => s + v, 0);
  const inputStyle = {
    background: C.s2, border: `1px solid ${C.border}`, borderRadius: 6,
    color: C.text, padding: "8px 12px", fontSize: 13, width: "100%",
    boxSizing: "border-box" as const, ...mono,
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, color: C.text, fontWeight: 700, ...mono, marginBottom: 2 }}>Portfolio Rebalancer</div>
        <div style={{ fontSize: 12, color: C.dim }}>Compute trades to restore target asset weights</div>
      </div>

      {/* Portfolio value summary */}
      {totalPortfolio > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ padding: "8px 14px", background: C.s2, borderRadius: 8, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>TOTAL PORTFOLIO</div>
            <div style={{ fontSize: 16, color: C.text, fontWeight: 700, ...mono }}>${totalPortfolio.toFixed(2)}</div>
          </div>
          {Object.entries(currentValues).map(([asset, usd]) => {
            const weight = totalPortfolio > 0 ? (usd / totalPortfolio * 100).toFixed(1) : "0.0";
            return (
              <div key={asset} style={{ padding: "8px 14px", background: C.s2, borderRadius: 8, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 2 }}>{asset}</div>
                <div style={{ fontSize: 14, color: C.text, fontWeight: 600, ...mono }}>${usd.toFixed(2)}</div>
                <div style={{ fontSize: 10, color: C.accent, ...mono }}>{weight}%</div>
              </div>
            );
          })}
        </div>
      )}

      <Card p={16} style={{ marginBottom: 16 }}>
        <Label>Target Weights</Label>
        {error && (
          <div style={{ fontSize: 12, color: C.danger, marginBottom: 10, padding: "6px 10px", background: `${C.danger}15`, borderRadius: 4 }}>
            {error}
          </div>
        )}
        <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>
          ONE ASSET PER LINE · FORMAT: ASSET: WEIGHT  (values normalised, e.g. 60+40=100)
        </div>
        <textarea
          style={{ ...inputStyle, height: 100, resize: "vertical" as const, fontFamily: "monospace" }}
          value={weightsRaw}
          onChange={(e) => setWeightsRaw(e.target.value)}
          spellCheck={false}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>DRIFT THRESHOLD (%)</div>
            <input style={inputStyle} type="number" placeholder="5" value={driftPct} onChange={(e) => setDriftPct(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>MIN TRADE (USD)</div>
            <input style={inputStyle} type="number" placeholder="5" value={minTradeUsd} onChange={(e) => setMinTradeUsd(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Btn size="sm" variant="primary" onClick={handleCompute}>COMPUTE REBALANCE</Btn>
        </div>
      </Card>

      {result && (
        <Card p={0}>
          <div style={{ padding: "10px 14px", background: C.s2, borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: C.text, fontWeight: 600, ...mono }}>
              REBALANCE PLAN
            </span>
            <Badge
              text={result.isBalanced ? "BALANCED" : `${result.trades.length} TRADE${result.trades.length > 1 ? "S" : ""}`}
              color={result.isBalanced ? C.ok : C.accent}
            />
          </div>
          <div style={{ padding: "10px 14px", borderBottom: result.trades.length > 0 ? `1px solid ${C.border}` : "none" }}>
            <span style={{ fontSize: 12, color: C.dim, ...mono }}>{result.summary}</span>
          </div>
          {result.trades.map((t, i) => (
            <div
              key={t.asset}
              style={{
                padding: "12px 14px",
                borderBottom: i < result.trades.length - 1 ? `1px solid ${C.border}` : "none",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}
            >
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <Badge text={t.action} color={t.action === "BUY" ? C.ok : C.danger} />
                  <span style={{ fontSize: 13, color: C.text, fontWeight: 600, ...mono }}>
                    {t.assetAmount.toFixed(4)} {t.asset}
                  </span>
                  <span style={{ fontSize: 12, color: C.dim, ...mono }}>${t.usdValue.toFixed(2)}</span>
                </div>
                <div style={{ fontSize: 11, color: C.dim, ...mono }}>
                  {t.currentWeightPct}% → {t.targetWeightPct}% · drift {t.driftPct}%
                </div>
              </div>
              {onRebalanceTrade && (
                <Btn size="sm" variant="ghost" onClick={() => onRebalanceTrade(t)}>
                  EXECUTE
                </Btn>
              )}
            </div>
          ))}
        </Card>
      )}

      {!result && Object.keys(currentValues).length === 0 && (
        <div style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 13, color: C.dim, marginBottom: 4 }}>No portfolio data yet</div>
          <div style={{ fontSize: 12, color: C.dim }}>Connect wallet and run agent cycles to populate portfolio values</div>
        </div>
      )}
    </div>
  );
}
