export const DEFS = {
  name: "", kpiTarget: "12", capitalLimit: "5000", risk: "medium", execMode: "manual",
  autoApproveThreshold: "50",
  kpiMetric: "ROI %", horizon: 30, revenueSource: "momentum",
  dataSources: ["KAS On-Chain", "Kaspa DAG"], frequency: "1h",
  strategyTemplate: "dca_accumulator",
  strategyLabel: "Steady DCA Builder",
  strategyClass: "accumulation",
  riskBudgetWeight: "1.0",
  portfolioAllocationPct: "25",
  // Advanced execution params
  stopLossPct: "4.0",
  takeProfitPct: "10.0",
  minConfidence: "55",
  positionSizing: "kelly",
  daaVelocityFilter: "0",
  maxDailyActions: "8",
  cooldownCycles: "1",
  pnlTracking: "kas-native",
  // KAS/USDC pair params (activated when Kaspa enables native stablecoins)
  pairMode: "accumulation",        // "accumulation" | "kas-usdc" | "dual"
  stableEntryBias: "0.6",          // 0–1: how much to weight stable entry (buy dips with USDC)
  stableExitBias: "0.4",           // 0–1: how much to weight stable exit (sell peaks to USDC)
  usdcSlippageTolerance: "0.5",    // % max slippage on KAS/USDC trades
};

// ── Strategy Templates ────────────────────────────────────────────────────────

export const STRATEGY_TEMPLATES = [
  {
    id: "dca_accumulator",
    name: "Steady DCA Builder",
    tag: "ACCUMULATION",
    tagColor: "#00C2A8",
    class: "accumulation",
    purpose: "Core accumulation engine for steady inventory growth with low drawdown behavior.",
    bestFor: "Range-to-neutral regimes, long accumulation windows, disciplined compounding.",
    desc: "Frequent small entries, strict downside control, and conservative auto-execution thresholds.",
    defaults: {
      risk: "low", kpiTarget: "10", horizon: 90, frequency: "4h",
      revenueSource: "accumulation", execMode: "manual", autoApproveThreshold: "25",
      stopLossPct: "3.0", takeProfitPct: "8.0", minConfidence: "60",
      positionSizing: "half-kelly", daaVelocityFilter: "0", maxDailyActions: "6",
      cooldownCycles: "2", pairMode: "accumulation",
    },
  },
  {
    id: "trend",
    name: "Trend Rider",
    tag: "MOMENTUM",
    tagColor: "#7C3AED",
    class: "momentum",
    purpose: "Compound into persistent directional moves while protecting against reversals.",
    bestFor: "Clear momentum regimes with stable liquidity and improving edge score.",
    desc: "Scales entries with trend persistence and tightens risk when momentum degrades.",
    defaults: {
      risk: "medium", kpiTarget: "18", horizon: 45, frequency: "1h",
      revenueSource: "trend", execMode: "manual", autoApproveThreshold: "40",
      stopLossPct: "5.0", takeProfitPct: "14.0", minConfidence: "58",
      positionSizing: "kelly", daaVelocityFilter: "2", maxDailyActions: "10",
      cooldownCycles: "1", pairMode: "accumulation",
    },
  },
  {
    id: "mean_reversion",
    name: "Dip Harvester",
    tag: "REVERSION",
    tagColor: "#F59E0B",
    class: "reversion",
    purpose: "Accumulate discounted KAS during temporary weakness without chasing breakouts.",
    bestFor: "Range regimes, oversold snaps, and volatility normalization after spikes.",
    desc: "Buys weakness with quant-regime gating and reduced chase behavior.",
    defaults: {
      risk: "low", kpiTarget: "14", horizon: 30, frequency: "30m",
      revenueSource: "mean-reversion", execMode: "manual", autoApproveThreshold: "20",
      stopLossPct: "3.5", takeProfitPct: "9.0", minConfidence: "62",
      positionSizing: "half-kelly", daaVelocityFilter: "0", maxDailyActions: "8",
      cooldownCycles: "2", pairMode: "accumulation",
    },
  },
  {
    id: "vol_breakout",
    name: "Volatility Expansion Hunter",
    tag: "BREAKOUT",
    tagColor: "#EF4444",
    class: "breakout",
    purpose: "Exploit expansion regimes with tighter automation controls and rapid reviews.",
    bestFor: "Breakout conditions, elevated DAA activity, and strong regime transitions.",
    desc: "Responds to volatility expansion while preserving accumulation-only discipline.",
    defaults: {
      risk: "medium", kpiTarget: "22", horizon: 21, frequency: "15m",
      revenueSource: "breakout", execMode: "notify", autoApproveThreshold: "15",
      stopLossPct: "6.0", takeProfitPct: "18.0", minConfidence: "52",
      positionSizing: "kelly", daaVelocityFilter: "5", maxDailyActions: "12",
      cooldownCycles: "1", pairMode: "accumulation",
    },
  },
  {
    id: "kas_usdc_pair",
    name: "KAS / USDC Pair Trader",
    tag: "PAIR-READY",
    tagColor: "#8F7BFF",
    class: "pair-trading",
    purpose: "Bi-directional KAS/USDC pair trading — accumulates KAS on dips using USDC, exits to USDC on strength.",
    bestFor: "When Kaspa enables native USDC — stable P&L tracking, cleaner buy/sell logic, USDC-denominated risk.",
    desc: "Stable-entry bias on weakness, stable-exit on peaks. Dual-side execution. Risk measured in USDC terms.",
    defaults: {
      risk: "medium", kpiTarget: "20", horizon: 30, frequency: "15m",
      revenueSource: "pair-trading", execMode: "autonomous", autoApproveThreshold: "60",
      stopLossPct: "4.0", takeProfitPct: "12.0", minConfidence: "65",
      positionSizing: "kelly", daaVelocityFilter: "0", maxDailyActions: "20",
      cooldownCycles: "0", pairMode: "kas-usdc",
      stableEntryBias: "0.7", stableExitBias: "0.5", usdcSlippageTolerance: "0.5",
    },
  },
];

// ── Professional Presets ──────────────────────────────────────────────────────

export const PROFESSIONAL_PRESETS = [
  {
    id: "market_maker",
    name: "Market Maker Pro",
    tag: "MM-PRO",
    tagColor: "#06B6D4",
    class: "market-making",
    purpose: "Professional market-making strategy with tight spreads and high-frequency inventory management.",
    bestFor: "Liquidity provision, spread capture, and neutral delta positioning.",
    desc: "Dual-sided quotes, dynamic spread adjustment, inventory skew controls, and maker fee optimization.",
    defaults: {
      risk: "low", kpiTarget: "8", horizon: 7, frequency: "5m",
      revenueSource: "market-making", execMode: "autonomous", autoApproveThreshold: "100",
      stopLossPct: "2.0", takeProfitPct: "4.0", minConfidence: "70",
      positionSizing: "fixed", daaVelocityFilter: "0", maxDailyActions: "48",
      cooldownCycles: "0", pairMode: "kas-usdc",
    },
  },
  {
    id: "high_freq_trader",
    name: "High Frequency Trader",
    tag: "HFT-PRO",
    tagColor: "#8B5CF6",
    class: "institutional",
    purpose: "High-frequency algorithmic trading that maximizes profit through rapid execution and DAG micro-structure analysis.",
    bestFor: "Maximum capital efficiency, arbitrage opportunities, and rapid profit capture.",
    desc: "Ultra-low latency execution, micro-structure pricing, order book dynamics, and real-time delta-neutral positioning.",
    defaults: {
      risk: "high", kpiTarget: "50", horizon: 1, frequency: "1m",
      revenueSource: "market-making", execMode: "autonomous", autoApproveThreshold: "500",
      stopLossPct: "1.5", takeProfitPct: "3.0", minConfidence: "50",
      positionSizing: "fixed", daaVelocityFilter: "0", maxDailyActions: "100",
      cooldownCycles: "0", pairMode: "kas-usdc",
    },
  },
  {
    id: "trader",
    name: "Pro Trader",
    tag: "TRADER",
    tagColor: "#F97316",
    class: "trading",
    purpose: "Active trading strategy with technical analysis, momentum capture, and active position management.",
    bestFor: "Day trading, swing trading, and active regime capture.",
    desc: "Technical indicators, multi-timeframe analysis, active stops, and quick position rotation.",
    defaults: {
      risk: "medium", kpiTarget: "25", horizon: 14, frequency: "15m",
      revenueSource: "momentum", execMode: "autonomous", autoApproveThreshold: "75",
      stopLossPct: "5.0", takeProfitPct: "15.0", minConfidence: "58",
      positionSizing: "kelly", daaVelocityFilter: "3", maxDailyActions: "15",
      cooldownCycles: "1", pairMode: "accumulation",
    },
  },
  {
    id: "custom",
    name: "Full Custom",
    tag: "CUSTOM",
    tagColor: "#64748B",
    class: "custom",
    purpose: "Build your own strategy with complete parameter control.",
    bestFor: "Advanced users who want full customization over every execution parameter.",
    desc: "Access all params: sizing method, DAA filters, stop/take-profit, pair mode, confidence gates, and more.",
    defaults: {
      risk: "medium", kpiTarget: "12", horizon: 30, frequency: "1h",
      revenueSource: "momentum", execMode: "manual", autoApproveThreshold: "50",
      stopLossPct: "4.0", takeProfitPct: "10.0", minConfidence: "55",
      positionSizing: "kelly", daaVelocityFilter: "0", maxDailyActions: "8",
      cooldownCycles: "1", pairMode: "accumulation",
    },
  },
];

// ── Option sets ───────────────────────────────────────────────────────────────

export const RISK_OPTS = [
  { v: "low",    l: "Low",    desc: "Tight stops · max 5–8% exposure per action" },
  { v: "medium", l: "Medium", desc: "Balanced Kelly sizing · 10–15% max exposure" },
  { v: "high",   l: "High",   desc: "Aggressive · up to 22% · wide targets" },
];

export const EXEC_OPTS = [
  { v: "autonomous", l: "Fully Autonomous", desc: "Auto-signs under threshold. Manual above." },
  { v: "manual",     l: "Manual Approval",  desc: "Every action requires wallet signature." },
  { v: "notify",     l: "Notify Only",      desc: "Decisions generated, no execution." },
];

export const SIZING_OPTS = [
  { v: "kelly",      l: "Full Kelly",   desc: "Kelly criterion fraction · maximizes log-wealth growth" },
  { v: "half-kelly", l: "Half Kelly",   desc: "50% of Kelly · lower variance, safer drawdown" },
  { v: "fixed",      l: "Fixed Size",   desc: "Fixed % of capital per cycle regardless of edge" },
];

export const PAIR_MODE_OPTS = [
  { v: "accumulation", l: "Accumulation Only", desc: "Buy & hold KAS · no stable side · current mode" },
  { v: "kas-usdc",     l: "KAS / USDC Pairs",  desc: "Bi-directional · requires native USDC on Kaspa L1" },
  { v: "dual",         l: "Dual Mode",          desc: "Accumulate by default · flip to pair when available" },
];

export const PNL_TRACKING_OPTS = [
  { v: "kas-native",  l: "KAS-Native",    desc: "P&L in KAS · accumulation-first baseline" },
  { v: "usdc-stable", l: "USDC-Stable",   desc: "P&L in USDC equivalent · stable-denominated reporting" },
];
