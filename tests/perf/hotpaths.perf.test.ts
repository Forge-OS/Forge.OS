import { describe, expect, it } from 'vitest';
import { computeSharedRiskBudgetAllocation } from '../../src/portfolio/allocator';
import { derivePnlAttribution } from '../../src/analytics/pnlAttribution';

function sampleHistory(count: number) {
  const start = 1_700_000_000_000;
  let price = 0.12;
  let daa = 1000;
  return Array.from({ length: count }, (_, i) => {
    price = Math.max(0.0001, price * (1 + Math.sin(i / 8) * 0.003 + (i % 7 === 0 ? 0.002 : -0.001)));
    daa += 1 + (i % 3);
    return { ts: start + i * 5000, priceUsd: Number(price.toFixed(8)), daaScore: daa, walletKas: 5000 + (i % 11) };
  });
}

function sampleDecisions(history: any[], count: number) {
  return Array.from({ length: count }, (_, i) => {
    const h = history[Math.min(history.length - 1, i * 2)];
    return {
      ts: h.ts,
      source: i % 2 ? 'hybrid-ai' : 'quant-core',
      dec: {
        action: i % 5 === 0 ? 'HOLD' : i % 4 === 0 ? 'REDUCE' : 'ACCUMULATE',
        confidence_score: 0.6 + (i % 10) * 0.03,
        risk_score: 0.2 + (i % 7) * 0.07,
        capital_allocation_kas: 5 + (i % 12),
        expected_value_pct: 0.3 + (i % 6) * 0.4,
        liquidity_impact: i % 8 === 0 ? 'SIGNIFICANT' : 'MODERATE',
        monte_carlo_win_pct: 55,
        quant_metrics: {
          regime: i % 13 === 0 ? 'RISK_OFF' : 'TREND_UP',
          data_quality_score: 0.7,
          win_probability_model: 0.62,
        },
      },
    };
  });
}

describe('hotpath perf', () => {
  it('measures allocator and attribution hot paths', () => {
    const history = sampleHistory(3000);
    const decisions = sampleDecisions(history, 800);
    const queue = Array.from({ length: 300 }, (_, i) => ({
      id: `q${i}`,
      status: i % 5 === 0 ? 'pending' : i % 7 === 0 ? 'rejected' : 'signed',
      amount_kas: 2 + (i % 9),
    }));
    const log = Array.from({ length: 1200 }, (_, i) => ({ ts: history[i % history.length].ts, type: 'EXEC', fee: i % 3 ? 0.2 : null }));

    const agents = Array.from({ length: 24 }, (_, i) => ({
      agentId: `a${i}`,
      name: `Agent ${i}`,
      enabled: true,
      capitalLimitKas: 500 + i * 10,
      targetAllocationPct: 100 / 24,
      riskBudgetWeight: 1 + (i % 3) * 0.25,
      pendingKas: i % 4 ? 0 : 8,
      lastDecision: decisions[i]?.dec,
    }));

    const t0 = performance.now();
    const alloc = computeSharedRiskBudgetAllocation({ walletKas: 12000, agents, config: { totalBudgetPct: 0.85, reserveKas: 5, maxAgentAllocationPct: 0.5, rebalanceThresholdPct: 0.08 } });
    const t1 = performance.now();
    const pnl = derivePnlAttribution({ decisions, queue, log, marketHistory: history });
    const t2 = performance.now();

    const allocMs = t1 - t0;
    const pnlMs = t2 - t1;
    console.info(`[perf] allocator=${allocMs.toFixed(2)}ms attribution=${pnlMs.toFixed(2)}ms rows=${alloc.rows.length} decisions=${decisions.length}`);

    expect(alloc.rows.length).toBe(24);
    expect(pnl.actionableSignals).toBeGreaterThan(0);
    expect(allocMs).toBeLessThan(40);
    expect(pnlMs).toBeLessThan(150);
  });
});
