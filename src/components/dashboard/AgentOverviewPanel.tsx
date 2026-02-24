import { useMemo } from "react";
import { C, mono } from "../../tokens";
import { Badge, Btn, Card, Label } from "../ui";

type AgentStats = {
  agentId: string;
  agentName: string;
  totalCycles: number;
  totalKasAccumulated: number;
  avgDecisionSize: number;
  lastActionTime: number;
  lastAction: string;
  status: "active" | "idle" | "error";
  profitScore: number;
  riskLevel: "low" | "medium" | "high";
};

type Props = {
  decisions?: any[];
  queue?: any[];
  agent?: AgentStats;
  onNavigate?: (tab: string) => void;
};

export function AgentOverviewPanel({ decisions = [], queue = [], agent, onNavigate }: Props) {
  // Enhanced stats calculation with profitability focus
  const stats = useMemo(() => {
    if (!decisions || decisions.length === 0) {
      return {
        totalCycles: 0,
        successfulTrades: 0,
        totalKasMoved: 0,
        avgKelly: 0,
        avgConfidence: 0,
        currentStreak: 0,
        bestWinStreak: 0,
        bestLossStreak: 0,
        lastAction: "NONE",
        lastActionTime: null,
        winRate: 50,
        actionBreakdown: { accumulate: 0, reduce: 0, hold: 0, rebalance: 0 },
        isProfitable: false,
        daysRunning: 0,
        // New enhanced stats
        totalPnl: 0,
        estimatedRoi: 0,
        expectedValue: 0,
        riskScore: 0,
        decisionQuality: 0,
        regime: "UNKNOWN",
        monteCarloWin: 0,
        lastRationale: "",
        executionRate: 0,
        avgHoldingTime: 0,
        capitalEfficiency: 0,
        timeSinceLastAction: null,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        signalAccuracy: 0,
      };
    }

    // Basic action counts
    const accumulate = decisions.filter(d => d.dec?.action === "ACCUMULATE").length;
    const reduce = decisions.filter(d => d.dec?.action === "REDUCE").length;
    const hold = decisions.filter(d => d.dec?.action === "HOLD").length;
    const rebalance = decisions.filter(d => d.dec?.action === "REBALANCE").length;
    const total = decisions.length;

    // Executed trades from queue
    const executed = queue.filter(q => 
      q?.status === "confirmed" || q?.receipt_lifecycle === "confirmed"
    ).length;
    const pending = queue.filter(q => 
      q?.status === "pending" || q?.status === "signed" || q?.status === "broadcasted"
    ).length;

    // Last decision
    const lastDec = decisions[0];
    const lastAction = lastDec?.dec?.action || "NONE";
    const lastActionTime = lastDec?.ts || null;
    const lastRationale = lastDec?.dec?.rationale || "";

    // Averages
    const avgKelly = decisions.reduce((sum, d) => sum + (d.dec?.kelly_fraction || 0), 0) / total;
    const avgConfidence = decisions.reduce((sum, d) => sum + (d.dec?.confidence_score || 0), 0) / total;
    const avgRiskScore = decisions.reduce((sum, d) => sum + (d.dec?.risk_score || 0), 0) / total;
    const avgMonteCarlo = decisions.reduce((sum, d) => sum + (d.dec?.monte_carlo_win_pct || 50), 0) / total;

    // Win rate calculation
    const wins = accumulate;
    const losses = reduce;
    const winRate = total > 0 ? (wins / (wins + losses || 1)) * 100 : 50;

    // Streaks
    let currentStreak = 0;
    let bestWinStreak = 0;
    let bestLossStreak = 0;
    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    let tempStreak = 0;
    let lastActionType: "win" | "loss" | null = null;

    for (const decision of decisions) {
      const action = decision.dec?.action;
      if (action === "ACCUMULATE" || action === "REBALANCE") {
        if (lastActionType === "win" || lastActionType === null) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }
        lastActionType = "win";
        if (tempStreak > bestWinStreak) bestWinStreak = tempStreak;
        consecutiveWins = tempStreak;
      } else if (action === "REDUCE" || action === "HOLD") {
        if (lastActionType === "loss" || lastActionType === null) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }
        lastActionType = "loss";
        if (tempStreak > bestLossStreak) bestLossStreak = tempStreak;
        consecutiveLosses = tempStreak;
      }
    }
    currentStreak = tempStreak;

    // Time metrics
    const firstTs = decisions[decisions.length - 1]?.ts || Date.now();
    const lastTs = decisions[0]?.ts || Date.now();
    const daysRunning = Math.max(1, Math.floor((Date.now() - firstTs) / (1000 * 60 * 60 * 24)));
    const timeSinceLastAction = lastTs ? Date.now() - lastTs : null;

    // KAS moved
    const totalKasMoved = queue
      .filter(q => q?.amount_kas)
      .reduce((sum, q) => sum + (q.amount_kas || 0), 0);

    // P&L estimation (based on executed trades and price changes)
    let totalPnl = 0;
    for (let i = 0; i < decisions.length - 1; i++) {
      const current = decisions[i];
      const next = decisions[i + 1];
      if (current.dec?.action === "ACCUMULATE" && next) {
        const currentPrice = current.kasData?.priceUsd || 0;
        const nextPrice = next.kasData?.priceUsd || currentPrice;
        if (nextPrice > currentPrice) {
          totalPnl += (nextPrice - currentPrice) * (current.dec?.capital_allocation_kas || 0);
        }
      }
    }

    // Estimated ROI (based on initial capital assumption)
    const initialCapital = 5000; // Default assumption
    const estimatedRoi = initialCapital > 0 ? (totalPnl / initialCapital) * 100 : 0;

    // Expected Value calculation: (winRate * avgWin) - (lossRate * avgLoss)
    const avgWinPct = 2.5; // Estimated average win percentage
    const avgLossPct = 1.0; // Estimated average loss percentage
    const winRateDecimal = winRate / 100;
    const expectedValue = (winRateDecimal * avgWinPct) - ((1 - winRateDecimal) * avgLossPct);

    // Decision quality score (composite of confidence, Kelly, and execution rate)
    const executionRate = total > 0 ? (executed / total) * 100 : 0;
    const decisionQuality = ((avgConfidence * 0.4) + (avgKelly * 0.3) + (executionRate / 100 * 0.3)) * 100;

    // Regime from quant metrics
    const regime = lastDec?.dec?.quant_metrics?.regime || "NEUTRAL";

    // Signal accuracy (how many signals were executed)
    const signalAccuracy = total > 0 ? (executed / total) * 100 : 0;

    // Capital efficiency (executed value vs signaled value)
    const signaledValue = decisions.reduce((sum, d) => sum + (d.dec?.capital_allocation_kas || 0), 0);
    const capitalEfficiency = signaledValue > 0 ? (totalKasMoved / signaledValue) * 100 : 0;

    return {
      totalCycles: total,
      successfulTrades: executed,
      pendingTrades: pending,
      totalKasMoved,
      avgKelly,
      avgConfidence,
      avgRiskScore,
      avgMonteCarlo,
      currentStreak,
      bestWinStreak,
      bestLossStreak,
      lastAction,
      lastActionTime,
      winRate,
      actionBreakdown: { accumulate, reduce, hold, rebalance },
      isProfitable: winRate > 50 && avgConfidence > 0.6 && totalPnl > 0,
      daysRunning,
      // Enhanced stats
      totalPnl,
      estimatedRoi,
      expectedValue,
      riskScore: avgRiskScore,
      decisionQuality,
      regime,
      monteCarloWin: avgMonteCarlo,
      lastRationale,
      executionRate,
      capitalEfficiency,
      timeSinceLastAction,
      consecutiveWins,
      consecutiveLosses,
      signalAccuracy,
    };
  }, [decisions, queue]);

  // Helper colors
  const getProfitColor = () => {
    if (stats.winRate >= 60 && stats.totalPnl > 0) return C.ok;
    if (stats.winRate >= 50) return C.accent;
    return C.danger;
  };

  const getStatusColor = () => {
    if (stats.totalCycles === 0) return C.dim;
    const hoursSinceLast = stats.timeSinceLastAction 
      ? (Date.now() - stats.timeSinceLastAction) / (1000 * 60 * 60) 
      : 999;
    if (hoursSinceLast < 1) return C.ok;
    if (hoursSinceLast < 6) return C.accent;
    return C.warn;
  };

  const getRegimeColor = () => {
    switch (stats.regime) {
      case "RISK_ON": return C.ok;
      case "RISK_OFF": return C.danger;
      case "BULL": return C.accent;
      case "BEAR": return C.warn;
      default: return C.dim;
    }
  };

  const getActionEmoji = (action: string) => {
    switch (action) {
      case "ACCUMULATE": return "📈";
      case "REDUCE": return "📉";
      case "HOLD": return "⏸️";
      case "REBALANCE": return "⚖️";
      default: return "❓";
    }
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case "ACCUMULATE": return "Accumulating";
      case "REDUCE": return "Reducing";
      case "HOLD": return "Holding";
      case "REBALANCE": return "Rebalancing";
      default: return "Idle";
    }
  };

  const formatTimeSince = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h ago`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
    return `${minutes}m ago`;
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 700, ...mono }}>
          🤖 AI Trading Agent Overview
        </div>
        <div style={{ fontSize: 11, color: C.dim }}>
          Your autonomous trading agent performance at a glance
        </div>
      </div>

      {/* MAIN PROFITABILITY CARD - Most prominent */}
      <Card p={20} style={{ marginBottom: 16, background: `linear-gradient(135deg, ${stats.isProfitable ? C.ok + '15' : C.danger + '15'} 0%, ${C.s1} 100%)`, border: `1px solid ${stats.isProfitable ? C.ok + '40' : C.danger + '40'}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ 
              width: 48, 
              height: 48, 
              borderRadius: "50%", 
              background: stats.isProfitable ? C.ok : C.danger,
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              fontSize: 24,
              boxShadow: stats.isProfitable ? `0 0 20px ${C.ok}60` : `0 0 20px ${C.danger}60`
            }}>
              {stats.isProfitable ? "✓" : "✗"}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: stats.isProfitable ? C.ok : C.danger }}>
                {stats.isProfitable ? "PROFITABLE" : "NOT PROFITABLE"}
              </div>
              <div style={{ fontSize: 11, color: C.dim, ...mono }}>
                Based on {stats.totalCycles} trading cycles
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <Badge 
              text={stats.totalCycles > 0 ? "ACTIVE" : "WAITING"} 
              color={stats.totalCycles > 0 ? C.ok : C.dim} 
              dot 
            />
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginTop: 4 }}>
              {stats.totalCycles} cycles
            </div>
          </div>
        </div>

        {/* Key profitability metrics row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <div style={{ background: "rgba(16,25,35,0.45)", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Est. P&L</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: stats.totalPnl >= 0 ? C.ok : C.danger, ...mono }}>
              {stats.totalPnl >= 0 ? "+" : ""}{stats.totalPnl.toFixed(2)} USD
            </div>
          </div>
          <div style={{ background: "rgba(16,25,35,0.45)", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Est. ROI</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: stats.estimatedRoi >= 0 ? C.ok : C.danger, ...mono }}>
              {stats.estimatedRoi >= 0 ? "+" : ""}{stats.estimatedRoi.toFixed(2)}%
            </div>
          </div>
          <div style={{ background: "rgba(16,25,35,0.45)", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Win Rate</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: getProfitColor(), ...mono }}>
              {stats.winRate.toFixed(1)}%
            </div>
          </div>
          <div style={{ background: "rgba(16,25,35,0.45)", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Expected Value</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: stats.expectedValue >= 0 ? C.ok : C.danger, ...mono }}>
              {stats.expectedValue >= 0 ? "+" : ""}{stats.expectedValue.toFixed(2)}%
            </div>
          </div>
        </div>
      </Card>

      {/* AI Decision Status Card */}
      <Card p={18} style={{ marginBottom: 16, background: `linear-gradient(135deg, ${C.s2} 0%, ${C.s1} 100%)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>🧠 Latest AI Decision</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Badge 
              text={getActionEmoji(stats.lastAction) + " " + getActionLabel(stats.lastAction)} 
              color={stats.lastAction === "ACCUMULATE" ? C.ok : stats.lastAction === "REDUCE" ? C.danger : C.warn}
            />
            {stats.timeSinceLastAction && (
              <Badge text={formatTimeSince(stats.timeSinceLastAction)} color={getStatusColor()} />
            )}
          </div>
        </div>

        {/* AI Metrics Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
          <div style={{ background: C.s2, borderRadius: 6, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Confidence</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: stats.avgConfidence >= 0.7 ? C.ok : stats.avgConfidence >= 0.5 ? C.warn : C.danger, ...mono }}>
              {(stats.avgConfidence * 100).toFixed(0)}%
            </div>
          </div>
          <div style={{ background: C.s2, borderRadius: 6, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Kelly Size</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.accent, ...mono }}>
              {(stats.avgKelly * 100).toFixed(1)}%
            </div>
          </div>
          <div style={{ background: C.s2, borderRadius: 6, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Monte Carlo</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.ok, ...mono }}>
              {stats.monteCarloWin.toFixed(0)}%
            </div>
          </div>
          <div style={{ background: C.s2, borderRadius: 6, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Risk Score</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: stats.riskScore <= 0.4 ? C.ok : stats.riskScore <= 0.7 ? C.warn : C.danger, ...mono }}>
              {stats.riskScore.toFixed(2)}
            </div>
          </div>
        </div>

        {/* Regime & Quality */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: stats.lastRationale ? 12 : 0 }}>
          <Badge 
            text={`📊 REGIME: ${String(stats.regime).replace(/_/g, " ")}`} 
            color={getRegimeColor()}
          />
          <Badge 
            text={`⭐ QUALITY: ${stats.decisionQuality.toFixed(0)}`} 
            color={stats.decisionQuality >= 70 ? C.ok : stats.decisionQuality >= 50 ? C.warn : C.danger}
          />
          <Badge 
            text={`⚡ SIGNAL ACCURACY: ${stats.signalAccuracy.toFixed(0)}%`} 
            color={stats.signalAccuracy >= 80 ? C.ok : stats.signalAccuracy >= 50 ? C.warn : C.danger}
          />
        </div>

        {/* Last Rationale */}
        {stats.lastRationale && (
          <div style={{ background: C.s2, borderRadius: 6, padding: 10 }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>AI RATIONALE</div>
            <div style={{ fontSize: 12, color: C.text, ...mono, lineHeight: 1.4 }}>
              {stats.lastRationale.slice(0, 180)}{stats.lastRationale.length > 180 ? "..." : ""}
            </div>
          </div>
        )}
      </Card>

      {/* Quick Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        <Card p={14} style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Trades Executed</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, ...mono }}>
            {stats.successfulTrades}
          </div>
          {stats.pendingTrades > 0 && (
            <div style={{ fontSize: 10, color: C.warn, ...mono }}>+ {stats.pendingTrades} pending</div>
          )}
        </Card>
        <Card p={14} style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>KAS Moved</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.accent, ...mono }}>
            {stats.totalKasMoved.toFixed(0)}
          </div>
          <div style={{ fontSize: 10, color: C.dim, ...mono }}>KAS</div>
        </Card>
        <Card p={14} style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Capital Efficiency</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: stats.capitalEfficiency >= 80 ? C.ok : stats.capitalEfficiency >= 50 ? C.warn : C.danger, ...mono }}>
            {stats.capitalEfficiency.toFixed(0)}%
          </div>
        </Card>
        <Card p={14} style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Days Running</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, ...mono }}>
            {stats.daysRunning}
          </div>
        </Card>
      </div>

      {/* Action Distribution */}
      <Card p={16} style={{ marginBottom: 16 }}>
        <Label style={{ marginBottom: 12 }}>📊 Decision Distribution</Label>
        <div style={{ display: "flex", height: 32, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
          {stats.actionBreakdown.accumulate > 0 && (
            <div 
              style={{ 
                width: `${(stats.actionBreakdown.accumulate / stats.totalCycles) * 100}%`, 
                background: C.ok, 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center",
                minWidth: stats.actionBreakdown.accumulate / stats.totalCycles > 0.15 ? 40 : 0
              }}
            >
              {stats.actionBreakdown.accumulate / stats.totalCycles > 0.15 && (
                <span style={{ fontSize: 11, color: C.s1, ...mono, fontWeight: 600 }}>📈 {stats.actionBreakdown.accumulate}</span>
              )}
            </div>
          )}
          {stats.actionBreakdown.reduce > 0 && (
            <div 
              style={{ 
                width: `${(stats.actionBreakdown.reduce / stats.totalCycles) * 100}%`, 
                background: C.danger, 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center",
                minWidth: stats.actionBreakdown.reduce / stats.totalCycles > 0.15 ? 40 : 0
              }}
            >
              {stats.actionBreakdown.reduce / stats.totalCycles > 0.15 && (
                <span style={{ fontSize: 11, color: C.s1, ...mono, fontWeight: 600 }}>📉 {stats.actionBreakdown.reduce}</span>
              )}
            </div>
          )}
          {stats.actionBreakdown.hold > 0 && (
            <div 
              style={{ 
                width: `${(stats.actionBreakdown.hold / stats.totalCycles) * 100}%`, 
                background: C.warn, 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center",
                minWidth: stats.actionBreakdown.hold / stats.totalCycles > 0.15 ? 40 : 0
              }}
            >
              {stats.actionBreakdown.hold / stats.totalCycles > 0.15 && (
                <span style={{ fontSize: 11, color: C.s1, ...mono, fontWeight: 600 }}>⏸️ {stats.actionBreakdown.hold}</span>
              )}
            </div>
          )}
          {stats.actionBreakdown.rebalance > 0 && (
            <div 
              style={{ 
                width: `${(stats.actionBreakdown.rebalance / stats.totalCycles) * 100}%`, 
                background: C.purple, 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center",
                minWidth: stats.actionBreakdown.rebalance / stats.totalCycles > 0.15 ? 40 : 0
              }}
            >
              {stats.actionBreakdown.rebalance / stats.totalCycles > 0.15 && (
                <span style={{ fontSize: 11, color: C.s1, ...mono, fontWeight: 600 }}>⚖️ {stats.actionBreakdown.rebalance}</span>
              )}
            </div>
          )}
        </div>
        
        {/* Legend */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, ...mono }}>
          <span style={{ color: C.ok }}>📈 Buy: {stats.actionBreakdown.accumulate}</span>
          <span style={{ color: C.danger }}>📉 Sell: {stats.actionBreakdown.reduce}</span>
          <span style={{ color: C.warn }}>⏸️ Hold: {stats.actionBreakdown.hold}</span>
          <span style={{ color: C.purple }}>⚖️ Rebalance: {stats.actionBreakdown.rebalance}</span>
        </div>
      </Card>

      {/* Streaks & Performance */}
      <Card p={16} style={{ marginBottom: 16 }}>
        <Label style={{ marginBottom: 12 }}>🔥 Streaks & Performance</Label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          <div style={{ background: C.s2, borderRadius: 8, padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Current</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: stats.currentStreak > 0 ? C.accent : C.dim, ...mono }}>
              {stats.currentStreak}
            </div>
          </div>
          <div style={{ background: C.s2, borderRadius: 8, padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Best Win</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.ok, ...mono }}>
              {stats.bestWinStreak}
            </div>
          </div>
          <div style={{ background: C.s2, borderRadius: 8, padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Best Loss</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.danger, ...mono }}>
              {stats.bestLossStreak}
            </div>
          </div>
          <div style={{ background: C.s2, borderRadius: 8, padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.dim, ...mono, marginBottom: 4 }}>Execution Rate</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: stats.executionRate >= 80 ? C.ok : stats.executionRate >= 50 ? C.warn : C.danger, ...mono }}>
              {stats.executionRate.toFixed(0)}%
            </div>
          </div>
        </div>
      </Card>

      {/* Quick Navigation Links */}
      <Card p={16}>
        <Label style={{ marginBottom: 12 }}>🔗 Quick Access</Label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
          <button 
            onClick={() => onNavigate?.("analytics")}
            style={{ 
              background: "rgba(16,25,35,0.45)",
              border: `1px solid rgba(57,221,182,0.1)`,
              borderRadius: 8,
              padding: 12,
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s"
            }}
          >
            <div style={{ fontSize: 12, color: C.accent, fontWeight: 600, ...mono }}>📊 View Analytics</div>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Detailed performance metrics</div>
          </button>
          
          <button 
            onClick={() => onNavigate?.("queue")}
            style={{ 
              background: "rgba(16,25,35,0.45)",
              border: `1px solid rgba(57,221,182,0.1)`,
              borderRadius: 8,
              padding: 12,
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s"
            }}
          >
            <div style={{ fontSize: 12, color: C.accent, fontWeight: 600, ...mono }}>📋 Action Queue</div>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{stats.pendingTrades > 0 ? `${stats.pendingTrades} pending transactions` : 'View all transactions'}</div>
          </button>
          
          <button 
            onClick={() => onNavigate?.("controls")}
            style={{ 
              background: "rgba(16,25,35,0.45)",
              border: `1px solid rgba(57,221,182,0.1)`,
              borderRadius: 8,
              padding: 12,
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s"
            }}
          >
            <div style={{ fontSize: 12, color: C.accent, fontWeight: 600, ...mono }}>⚙️ Agent Controls</div>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Strategy & execution settings</div>
          </button>
          
          <button 
            onClick={() => onNavigate?.("portfolio")}
            style={{ 
              background: "rgba(16,25,35,0.45)",
              border: `1px solid rgba(57,221,182,0.1)`,
              borderRadius: 8,
              padding: 12,
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s"
            }}
          >
            <div style={{ fontSize: 12, color: C.accent, fontWeight: 600, ...mono }}>💼 Portfolio</div>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Multi-agent allocation</div>
          </button>
        </div>
      </Card>
    </div>
  );
}

