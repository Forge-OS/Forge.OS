import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function sampleSnapshots(count: number) {
  const out: any[] = [];
  const startTs = 1_710_000_000_000;
  let price = 0.11;
  let daa = 3_100_000;
  for (let i = 0; i < count; i += 1) {
    const drift = i < count / 2 ? 1.001 : 0.9993;
    const noise = 1 + Math.sin(i / 12) * 0.0018;
    price = Math.max(0.02, price * drift * noise);
    daa += 8 + (i % 4);
    out.push({
      ts: startTs + i * 60_000,
      priceUsd: Number(price.toFixed(8)),
      daaScore: daa,
      walletKas: 5000,
    });
  }
  return out;
}

function runBacktestCli(inputPayload: any, args: string[] = []) {
  const raw = execFileSync(
    process.execPath,
    ["./node_modules/tsx/dist/cli.mjs", "scripts/backtest-quant.ts", ...args],
    {
      cwd: process.cwd(),
      input: JSON.stringify(inputPayload),
      encoding: "utf8",
    }
  );
  return raw;
}

describe("backtest CLI determinism", () => {
  it("emits byte-stable JSON by default for identical input", () => {
    const payload = {
      agent: { risk: "medium", strategyTemplate: "trend", capitalLimit: 200 },
      snapshots: sampleSnapshots(160),
      config: { initialCashUsd: 3000, feeBps: 8, slippageBps: 6, warmupSamples: 24, maxLookback: 120 },
    };
    const a = runBacktestCli(payload);
    const b = runBacktestCli(payload);
    expect(a).toBe(b);
    const parsed = JSON.parse(a);
    expect(parsed.generatedAt).toBeUndefined();
  });

  it("includes generatedAt only when explicitly requested", () => {
    const payload = {
      agent: { risk: "medium", strategyTemplate: "trend", capitalLimit: 180 },
      snapshots: sampleSnapshots(160),
      config: { initialCashUsd: 3000, feeBps: 8, slippageBps: 6, warmupSamples: 24, maxLookback: 120 },
    };
    const raw = runBacktestCli(payload, ["--include-generated-at"]);
    const parsed = JSON.parse(raw);
    expect(typeof parsed.generatedAt).toBe("string");
    expect(parsed.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
