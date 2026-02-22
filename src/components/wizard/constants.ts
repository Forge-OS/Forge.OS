export const DEFS = {
  name:"", kpiTarget:"12", capitalLimit:"5000", risk:"medium", execMode:"manual",
  autoApproveThreshold:"50",
  kpiMetric:"ROI %", horizon:30, revenueSource:"momentum",
  dataSources:["KAS On-Chain","Kaspa DAG"], frequency:"1h",
  strategyTemplate:"dca_accumulator",
  strategyLabel:"DCA Accumulator",
  strategyClass:"accumulation",
  riskBudgetWeight:"1.0",
  portfolioAllocationPct:"25",
};

export const STRATEGY_TEMPLATES = [
  {
    id: "dca_accumulator",
    name: "DCA Accumulator",
    class: "accumulation",
    desc: "Accumulation-first sizing, frequent small entries, strict downside control.",
    defaults: {
      risk: "low",
      kpiTarget: "10",
      horizon: 90,
      frequency: "4h",
      revenueSource: "accumulation",
      execMode: "manual",
      autoApproveThreshold: "25",
    },
  },
  {
    id: "trend",
    name: "Trend",
    class: "accumulation",
    desc: "Ride persistent trend regimes with scaling entries and tighter risk on reversals.",
    defaults: {
      risk: "medium",
      kpiTarget: "18",
      horizon: 45,
      frequency: "1h",
      revenueSource: "trend",
      execMode: "manual",
      autoApproveThreshold: "40",
    },
  },
  {
    id: "mean_reversion",
    name: "Mean Reversion",
    class: "accumulation",
    desc: "Accumulate on weakness with quant-regime gating and reduced chase behavior.",
    defaults: {
      risk: "low",
      kpiTarget: "14",
      horizon: 30,
      frequency: "30m",
      revenueSource: "mean-reversion",
      execMode: "manual",
      autoApproveThreshold: "20",
    },
  },
  {
    id: "vol_breakout",
    name: "Volatility Breakout",
    class: "accumulation",
    desc: "Respond to volatility expansion but keep accumulation-only execution discipline.",
    defaults: {
      risk: "medium",
      kpiTarget: "22",
      horizon: 21,
      frequency: "15m",
      revenueSource: "breakout",
      execMode: "notify",
      autoApproveThreshold: "15",
    },
  },
];

export const RISK_OPTS = [
  {v:"low",l:"Low",desc:"Tight stops. Max 5% exposure per action."},
  {v:"medium",l:"Medium",desc:"Balanced Kelly sizing. 10% max exposure."},
  {v:"high",l:"High",desc:"Aggressive. 20% max. Wide targets."},
];

export const EXEC_OPTS = [
  {v:"autonomous",l:"Fully Autonomous",desc:"Auto-signs under threshold. Manual above."},
  {v:"manual",l:"Manual Approval",desc:"Every action requires wallet signature."},
  {v:"notify",l:"Notify Only",desc:"Decisions generated, no execution."},
];
