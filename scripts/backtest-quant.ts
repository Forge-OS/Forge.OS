import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runQuantBacktest, type QuantBacktestConfig } from "../src/backtest/harness";

type CliArgs = {
  inputPath?: string;
  outputPath?: string;
  pretty: boolean;
  includeGeneratedAt: boolean;
  help: boolean;
};

function usage() {
  return [
    "Usage:",
    "  npm run backtest:quant -- --input ./data/backtest.json [--output ./out/result.json] [--pretty] [--include-generated-at]",
    "  cat ./data/backtest.json | npm run backtest:quant -- --pretty [--include-generated-at]",
    "",
    "Input JSON shape:",
    '  { "agent": {...}, "snapshots": [...], "config": { "initialCashUsd": 10000, "feeBps": 8, "slippageBps": 6, "warmupSamples": 24, "maxLookback": 240 } }',
    "",
    "Notes:",
    "  - --input is optional; when omitted, stdin is used.",
    "  - --output is optional; when omitted, result JSON is printed to stdout.",
    "  - Output is deterministic by default for a fixed payload.",
    "  - Pass --include-generated-at to include wall-clock metadata.",
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    pretty: false,
    includeGeneratedAt: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--pretty") {
      out.pretty = true;
      continue;
    }
    if (arg === "--include-generated-at") {
      out.includeGeneratedAt = true;
      continue;
    }
    if (arg === "--input" || arg === "-i") {
      out.inputPath = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg.startsWith("--input=")) {
      out.inputPath = arg.slice("--input=".length).trim();
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      out.outputPath = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      out.outputPath = arg.slice("--output=".length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

async function readStdinText() {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readInputJson(args: CliArgs) {
  if (args.inputPath) {
    const raw = await fs.readFile(args.inputPath, "utf8");
    return JSON.parse(raw);
  }
  const stdin = await readStdinText();
  if (!stdin.trim()) {
    throw new Error("No input provided. Pass --input <file> or pipe JSON to stdin.");
  }
  return JSON.parse(stdin);
}

function asBacktestConfig(payload: any): QuantBacktestConfig {
  const cfg = payload?.config && typeof payload.config === "object" ? payload.config : {};
  return {
    agent: payload?.agent,
    snapshots: Array.isArray(payload?.snapshots) ? payload.snapshots : [],
    initialCashUsd: cfg.initialCashUsd,
    feeBps: cfg.feeBps,
    slippageBps: cfg.slippageBps,
    warmupSamples: cfg.warmupSamples,
    maxLookback: cfg.maxLookback,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const payload = await readInputJson(args);
  const config = asBacktestConfig(payload);
  const result = runQuantBacktest(config);
  const outputBase = {
    inputMeta: {
      snapshots: Array.isArray(config.snapshots) ? config.snapshots.length : 0,
      hasAgent: Boolean(config.agent),
    },
    result,
  };
  const output = args.includeGeneratedAt
    ? { generatedAt: new Date().toISOString(), ...outputBase }
    : outputBase;

  const json = JSON.stringify(output, null, args.pretty ? 2 : 0);
  if (args.outputPath) {
    const absOut = path.resolve(args.outputPath);
    await fs.mkdir(path.dirname(absOut), { recursive: true });
    await fs.writeFile(absOut, `${json}\n`, "utf8");
    process.stdout.write(`Wrote backtest result -> ${absOut}\n`);
    return;
  }
  process.stdout.write(`${json}\n`);
}

main().catch((err: any) => {
  const message = String(err?.message || err || "backtest_cli_failed");
  process.stderr.write(`backtest:quant failed: ${message}\n`);
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
});
