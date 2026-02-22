import { describe, expect, it } from 'vitest';
import { derivePnlAttribution } from '../../src/analytics/pnlAttribution';

describe('pnlAttribution', () => {
  it('uses hybrid slippage/net when confirmed receipt telemetry exists', () => {
    const summary = derivePnlAttribution({
      decisions: [
        {
          ts: 1_000,
          dec: {
            action: 'ACCUMULATE',
            capital_allocation_kas: 10,
            expected_value_pct: 2,
            confidence_score: 0.8,
            liquidity_impact: 'MODERATE',
            decision_source: 'hybrid-ai',
            quant_metrics: { win_probability_model: 0.6 },
          },
        },
      ],
      queue: [
        {
          id: 'q1',
          type: 'ACCUMULATE',
          status: 'signed',
          metaKind: 'action',
          amount_kas: 10,
          receipt_lifecycle: 'confirmed',
          confirmations: 2,
          broadcast_price_usd: 0.10,
          confirm_price_usd: 0.101,
          dec: { liquidity_impact: 'MODERATE', action: 'ACCUMULATE' },
        },
      ],
      log: [],
      marketHistory: [
        { ts: 1_000, priceUsd: 0.10 },
        { ts: 2_000, priceUsd: 0.102 },
        { ts: 3_000, priceUsd: 0.103 },
      ],
    });

    expect(summary.netPnlMode).toBe('hybrid');
    expect(summary.confirmedSignals).toBe(1);
    expect(summary.executedSignals).toBe(1);
    expect(summary.receiptCoveragePct).toBe(100);
    expect(summary.realizedExecutionDriftKas).toBeGreaterThan(0);
    expect(summary.netPnlKas).not.toBe(summary.estimatedNetPnlKas);
  });
});
