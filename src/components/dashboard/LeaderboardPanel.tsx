/**
 * LeaderboardPanel — displays the anonymous strategy leaderboard.
 *
 * Privacy design: entries contain only a config hash + backtest metrics.
 * No wallet address, no balance, no user identity ever stored or displayed.
 *
 * "USE THIS CONFIG" pre-fills the agent wizard with the strategy settings
 * from that leaderboard entry.
 */

import { useEffect, useState } from "react";
import { C, mono } from "../../tokens";
import { Card, Label } from "../ui";

const LEADERBOARD_URL = (import.meta as any)?.env?.VITE_LEADERBOARD_URL || "";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaderboardEntry {
  configHash: string;
  strategy: string;
  risk: string;
  actionMode: string;
  sharpeRatio: string;
  totalReturnPct: string;
  maxDrawdownPct: string;
  winRatePct: string;
  tradeCount: string;
  elapsedDays: string;
  score: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 72 }}>
      <span style={{ fontSize: 10, color: C.dim, ...mono, letterSpacing: "0.04em", marginBottom: 2 }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color, ...mono }}>{value}</span>
    </div>
  );
}

function sharpeColor(v: number) { return v > 1 ? C.ok : v > 0 ? C.warn : C.danger; }
function retColor(v: number)    { return v > 0 ? C.ok : C.danger; }
function ddColor(v: number)     { return v < 8 ? C.ok : v < 20 ? C.warn : C.danger; }

// ── Main component ────────────────────────────────────────────────────────────

export function LeaderboardPanel({ onUseConfig }: { onUseConfig?: (cfg: Record<string, string>) => void }) {
  const [sortKey, setSortKey] = useState<"sharpe" | "returns">("sharpe");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedHash, setUsedHash] = useState<string | null>(null);

  useEffect(() => {
    if (!LEADERBOARD_URL) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${LEADERBOARD_URL}/leaderboard/top?sort=${sortKey}&limit=20`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setEntries(Array.isArray(data?.entries) ? data.entries : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Fetch failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [sortKey]);

  if (!LEADERBOARD_URL) {
    return (
      <Card p={18}>
        <Label>Strategy Leaderboard</Label>
        <div style={{ fontSize: 12, color: C.dim, ...mono, marginTop: 10, lineHeight: 1.6 }}>
          Leaderboard is disabled — set <span style={{ color: C.accent }}>VITE_LEADERBOARD_URL</span> to your leaderboard server to enable.
        </div>
      </Card>
    );
  }

  return (
    <Card p={18}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <Label>Strategy Leaderboard</Label>
          <div style={{ fontSize: 10, color: C.dim, ...mono, marginTop: 2 }}>
            Anonymous · backtest metrics only · no wallet data
          </div>
        </div>

        {/* Sort tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["sharpe", "returns"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              style={{
                background: sortKey === k ? C.accent : C.s2,
                color: sortKey === k ? C.bg : C.dim,
                border: "none",
                borderRadius: 4,
                padding: "3px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                ...mono,
              }}
            >
              {k === "sharpe" ? "SHARPE" : "RETURN"}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {loading && (
        <div style={{ fontSize: 12, color: C.dim, ...mono, textAlign: "center", padding: "32px 0" }}>
          Loading leaderboard…
        </div>
      )}

      {!loading && error && (
        <div style={{ fontSize: 12, color: C.danger, ...mono, padding: "12px 0" }}>
          Failed to load: {error}
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div style={{ fontSize: 12, color: C.dim, ...mono, textAlign: "center", padding: "32px 0" }}>
          No entries yet. Run a backtest and click "Share Anonymously" to be the first.
        </div>
      )}

      {!loading && entries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.map((entry, idx) => {
            const sharpe = Number(entry.sharpeRatio);
            const ret    = Number(entry.totalReturnPct);
            const dd     = Number(entry.maxDrawdownPct);
            const win    = Number(entry.winRatePct);
            const isUsed = usedHash === entry.configHash;

            return (
              <div
                key={entry.configHash}
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: "12px 14px",
                  background: C.s2,
                }}
              >
                {/* Row: rank + config hash + USE button */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: C.dim, ...mono }}>#{idx + 1}</span>
                    <span style={{ fontSize: 11, color: C.muted, ...mono }}>{entry.configHash}</span>
                    {entry.strategy && (
                      <span style={{
                        background: `${C.accent}20`,
                        color: C.accent,
                        borderRadius: 3,
                        padding: "1px 6px",
                        fontSize: 9,
                        fontWeight: 700,
                        ...mono,
                      }}>
                        {String(entry.strategy).replace(/_/g, " ").toUpperCase()}
                      </span>
                    )}
                    {entry.risk && (
                      <span style={{
                        background: `${entry.risk === "high" ? C.danger : entry.risk === "low" ? C.ok : C.warn}20`,
                        color: entry.risk === "high" ? C.danger : entry.risk === "low" ? C.ok : C.warn,
                        borderRadius: 3,
                        padding: "1px 6px",
                        fontSize: 9,
                        fontWeight: 700,
                        ...mono,
                      }}>
                        {String(entry.risk).toUpperCase()}
                      </span>
                    )}
                  </div>
                  {onUseConfig && (
                    <button
                      onClick={() => {
                        setUsedHash(entry.configHash);
                        onUseConfig({
                          strategy:   entry.strategy,
                          risk:       entry.risk,
                          actionMode: entry.actionMode,
                        });
                      }}
                      style={{
                        background: isUsed ? `${C.ok}20` : `${C.accent}15`,
                        border: `1px solid ${isUsed ? C.ok : C.accent}50`,
                        borderRadius: 4,
                        padding: "4px 10px",
                        fontSize: 10,
                        fontWeight: 700,
                        color: isUsed ? C.ok : C.accent,
                        cursor: "pointer",
                        ...mono,
                      }}
                    >
                      {isUsed ? "✓ APPLIED" : "USE CONFIG →"}
                    </button>
                  )}
                </div>

                {/* Metrics row */}
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  <StatPill label="SHARPE"   value={sharpe.toFixed(2)}         color={sharpeColor(sharpe)} />
                  <StatPill label="USD RTN"  value={`${ret >= 0 ? "+" : ""}${ret.toFixed(1)}%`} color={retColor(ret)} />
                  <StatPill label="MAX DD"   value={`${dd.toFixed(1)}%`}        color={ddColor(dd)} />
                  <StatPill label="WIN RATE" value={`${win.toFixed(0)}%`}       color={win >= 55 ? C.ok : win >= 45 ? C.warn : C.danger} />
                  <StatPill label="TRADES"   value={String(entry.tradeCount)}   color={C.text} />
                  <StatPill label="DAYS"     value={Number(entry.elapsedDays).toFixed(0)} color={C.dim} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 10, color: C.muted, ...mono, lineHeight: 1.6 }}>
        Leaderboard shows backtest results only — simulated performance, not live trading.
        Entries are published anonymously. No address, balance, or personal data is ever sent.
      </div>
    </Card>
  );
}
