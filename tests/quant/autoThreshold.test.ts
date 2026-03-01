import { describe, expect, it } from "vitest";
import {
  computeRollingWinRate,
  deriveAdaptiveAutoApproveThreshold,
} from "../../src/quant/autoThreshold";

function buildHistory(startPrice: number, stepPct: number, points: number) {
  const out: Array<{ ts: number; priceUsd: number }> = [];
  let price = startPrice;
  const startTs = 1_710_000_000_000;
  for (let i = 0; i < points; i += 1) {
    out.push({ ts: startTs + i * 60_000, priceUsd: Number(price.toFixed(8)) });
    price *= 1 + stepPct / 100;
  }
  return out;
}

function decisionsFrom(history: Array<{ ts: number }>, action: "ACCUMULATE" | "REDUCE", every = 4) {
  return history
    .filter((_, i) => i % every === 0)
    .map((h) => ({ ts: h.ts, dec: { action } }));
}

describe("auto threshold calibration", () => {
  it("boosts threshold when rolling win rate is strong", () => {
    const history = buildHistory(0.1, 0.3, 120); // persistent uptrend
    const decisions = decisionsFrom(history, "ACCUMULATE", 5);
    const out = deriveAdaptiveAutoApproveThreshold({
      baseThresholdKas: 40,
      decisions,
      marketHistory: history,
      calibrationHealth: 0.95,
      minimumSamples: 8,
    });
    expect(out.samplesSufficient).toBe(true);
    expect(out.rolling.winRatePct).toBeGreaterThan(60);
    expect(out.multiplier).toBeGreaterThan(1);
    expect(out.thresholdKas).toBeGreaterThan(40);
  });

  it("tightens threshold when rolling win rate is weak", () => {
    const history = buildHistory(0.1, 0.28, 120); // uptrend punishes REDUCE calls
    const decisions = decisionsFrom(history, "REDUCE", 5);
    const out = deriveAdaptiveAutoApproveThreshold({
      baseThresholdKas: 40,
      decisions,
      marketHistory: history,
      calibrationHealth: 0.75,
      minimumSamples: 8,
    });
    expect(out.samplesSufficient).toBe(true);
    expect(out.rolling.winRatePct).toBeLessThan(40);
    expect(out.multiplier).toBeLessThan(1);
    expect(out.thresholdKas).toBeLessThan(40);
  });

  it("falls back to baseline when samples are insufficient", () => {
    const history = buildHistory(0.1, 0.1, 20);
    const decisions = decisionsFrom(history, "ACCUMULATE", 10);
    const rolling = computeRollingWinRate({
      decisions,
      marketHistory: history,
      maxSamples: 8,
    });
    expect(rolling.samples).toBeLessThan(8);

    const out = deriveAdaptiveAutoApproveThreshold({
      baseThresholdKas: 25,
      decisions,
      marketHistory: history,
      minimumSamples: 8,
    });
    expect(out.samplesSufficient).toBe(false);
    expect(out.multiplier).toBe(1);
    expect(out.thresholdKas).toBe(25);
  });

  it("skips decisions without sufficient lookahead instead of counting losses", () => {
    const history = buildHistory(0.1, 0.25, 40);
    const tailTs = history[history.length - 1].ts;
    const nearTailTs = history[history.length - 2].ts;
    const validTs = history[history.length - 8].ts;
    const rolling = computeRollingWinRate({
      decisions: [
        { ts: tailTs, dec: { action: "ACCUMULATE" } },
        { ts: nearTailTs, dec: { action: "ACCUMULATE" } },
        { ts: validTs, dec: { action: "ACCUMULATE" } },
      ],
      marketHistory: history,
      lookaheadSteps: 3,
      maxSamples: 10,
    });
    expect(rolling.samples).toBe(1);
    expect(rolling.wins).toBe(1);
    expect(rolling.losses).toBe(0);
  });

  it("sorts decisions by timestamp before limiting samples", () => {
    const history = buildHistory(0.1, 0.2, 80);
    const rolling = computeRollingWinRate({
      decisions: [
        { ts: history[8].ts, dec: { action: "REDUCE" } },
        { ts: history[42].ts, dec: { action: "ACCUMULATE" } },
        { ts: history[34].ts, dec: { action: "ACCUMULATE" } },
        { ts: history[26].ts, dec: { action: "ACCUMULATE" } },
        { ts: history[18].ts, dec: { action: "ACCUMULATE" } },
      ],
      marketHistory: history,
      lookaheadSteps: 3,
      maxSamples: 4,
    });
    expect(rolling.samples).toBe(4);
    expect(rolling.wins).toBe(4);
    expect(rolling.losses).toBe(0);
  });
});
