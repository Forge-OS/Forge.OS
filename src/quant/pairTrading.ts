/**
 * Pair Trading Execution Bridge — KAS ↔ Stablecoin
 *
 * Maps quant engine decisions to concrete bi-directional trade intents when an agent
 * runs in `pairMode: "kas-usdc"` or `"dual"`.
 *
 * Architecture:
 *   1. buildPairExecutionIntent() — pure function, computes sizing & direction.
 *   2. The intent is logged by Dashboard.tsx and can be dispatched via:
 *        a. DEX route: swap.ts → kaspa_native endpoint (works today once USDC/KAS
 *           pair is live on a Kaspa DEX, no vProgs needed).
 *        b. Covenant route: covenant.ts → trustless atomic swap (after May 2026 KIP-9).
 *
 * The module is side-effect-free — it never calls network APIs or browser storage
 * directly, making it fully testable without mocking.
 *
 * Signal → intent mapping:
 *   ACCUMULATE  →  BUY_KAS   (sell stablecoin, receive KAS)
 *   REDUCE      →  SELL_KAS  (sell KAS, receive stablecoin)
 *   HOLD        →  null      (no trade)
 *   REBALANCE   →  null      (not yet supported in pair mode)
 *
 * Sizing:
 *   BUY_KAS:  stableAmount = min(stableBalance, capitalLimit × kasPriceUsd) × stableEntryBias × kellyFraction
 *             kasAmount    ≈ stableAmount / kasPriceUsd  (approximate; DEX sets final price)
 *   SELL_KAS: kasAmount    = min(kasBalance, capitalLimit) × stableExitBias × kellyFraction
 *             stableAmount ≈ kasAmount × kasPriceUsd
 *
 * Guards applied before returning an intent:
 *   - Minimum trade: 1 USDC equivalent (avoids dust trades)
 *   - Slippage cap: usdcSlippageTolerance from agent config (default 0.5%)
 *   - Balance check: zero balance on either side → null
 *   - Capital limit: hard capped by agent.capitalLimit
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/** Which direction the agent wants to trade. */
export type PairTradeDirection = "BUY_KAS" | "SELL_KAS";

/**
 * A computed pair trade intent — pure data, no side effects.
 * Dashboard.tsx logs this and (later) dispatches it to the swap layer.
 */
export interface PairExecutionIntent {
  direction: PairTradeDirection;
  /** KAS to buy or sell (rounded to 6 dp). */
  kasAmount: number;
  /** Stablecoin tick (e.g. "USDC", "USDT"). */
  stableTick: string;
  /** Stablecoin amount in display units — NOT smallest unit (rounded to 2 dp). */
  stableAmount: number;
  /** Max slippage the agent will accept in basis points (50 = 0.5%). */
  slippageBps: number;
  /** Approximate USD value of the trade. */
  usdValue: number;
  /** Kelly fraction applied (0–1). */
  kellyFraction: number;
  /** Human-readable explanation of why this trade was triggered. */
  reason: string;
  /** True when vProg covenant path is preferred (requires VITE_VPROG_ENABLED). */
  preferCovenant: boolean;
}

/** Subset of agent config consumed by pair trading. */
export interface PairAgentConfig {
  pairMode?: string;           // "accumulation" | "kas-usdc" | "dual"
  stableEntryBias?: string;    // 0–1 fraction, default "0.6"
  stableExitBias?: string;     // 0–1 fraction, default "0.4"
  usdcSlippageTolerance?: string; // percent (0.5 = 0.5%), default "0.5"
  capitalLimit?: number;       // KAS per cycle
  stableTick?: string;         // override tick, default PAIR_STABLE_TICK env var
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ENV = (typeof import.meta !== "undefined" && (import.meta as any)?.env) ?? {};
const VPROG_ENABLED = String(ENV?.VITE_VPROG_ENABLED ?? "").trim().toLowerCase() === "true";
const DEFAULT_STABLE_TICK =
  String(ENV?.VITE_PAIR_STABLE_TICK ?? "USDC").trim().toUpperCase() || "USDC";

/** Minimum trade size in USD equivalent. Trades below this are skipped as dust. */
const MIN_TRADE_USD = 1.0;

/** Hard floor on slippage tolerance (basis points). Never accept 0 slippage. */
const MIN_SLIPPAGE_BPS = 10;
/** Hard cap on slippage tolerance (basis points). Never exceed 5%. */
const MAX_SLIPPAGE_BPS = 500;

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function toFinite(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(v: number, dp: number): number {
  const m = Math.pow(10, dp);
  return Math.round(v * m) / m;
}

function parseFraction(raw: string | undefined, fallback: number): number {
  return clamp(toFinite(raw, fallback), 0, 1);
}

function parsePct(raw: string | undefined, fallback: number): number {
  return clamp(toFinite(raw, fallback), 0, 100);
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Builds a pair trade intent from the current quant decision and balances.
 *
 * Returns null if:
 *   - pairMode is not "kas-usdc" or "dual"
 *   - action is "HOLD" or "REBALANCE"
 *   - the relevant balance (USDC for BUY, KAS for SELL) is zero
 *   - the computed trade size is below MIN_TRADE_USD
 *
 * @param action           Quant engine action: "ACCUMULATE" | "REDUCE" | "HOLD" | "REBALANCE"
 * @param kellyFraction    Raw Kelly fraction from quant decision (0–1)
 * @param kasPriceUsd      Current KAS/USD price
 * @param kasBalance       Wallet KAS balance available for trading
 * @param stableBalance    Wallet stablecoin balance in display units (e.g. USDC)
 * @param agentConfig      Agent config slice
 */
export function buildPairExecutionIntent(
  action: string,
  kellyFraction: number,
  kasPriceUsd: number,
  kasBalance: number,
  stableBalance: number,
  agentConfig: PairAgentConfig,
): PairExecutionIntent | null {
  const pairMode = String(agentConfig?.pairMode ?? "accumulation").toLowerCase();
  if (pairMode !== "kas-usdc" && pairMode !== "dual") return null;
  if (action !== "ACCUMULATE" && action !== "REDUCE") return null;
  if (!Number.isFinite(kasPriceUsd) || kasPriceUsd <= 0) return null;

  const stableTick = String(agentConfig?.stableTick ?? DEFAULT_STABLE_TICK).toUpperCase();
  const kelly = clamp(toFinite(kellyFraction, 0), 0, 1);
  const capitalLimit = Math.max(0, toFinite(agentConfig?.capitalLimit, 0));
  const slippagePct = parsePct(agentConfig?.usdcSlippageTolerance, 0.5);
  const slippageBps = clamp(Math.round(slippagePct * 100), MIN_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS);

  if (action === "ACCUMULATE") {
    // BUY_KAS: spend stablecoin to accumulate KAS
    const entryBias = parseFraction(agentConfig?.stableEntryBias, 0.6);
    const capitalLimitUsd = capitalLimit * kasPriceUsd;
    // How much USDC to spend this cycle
    const rawStableAmount = Math.min(stableBalance, capitalLimitUsd > 0 ? capitalLimitUsd : stableBalance)
      * entryBias * kelly;
    const stableAmount = round(rawStableAmount, 2);

    if (stableBalance <= 0 || stableAmount < MIN_TRADE_USD) return null;

    const kasAmount = round(stableAmount / kasPriceUsd, 6);
    const usdValue = round(stableAmount, 2);

    return {
      direction: "BUY_KAS",
      kasAmount,
      stableTick,
      stableAmount,
      slippageBps,
      usdValue,
      kellyFraction: kelly,
      reason:
        `ACCUMULATE signal: spending ${stableAmount.toFixed(2)} ${stableTick} ` +
        `to buy ~${kasAmount.toFixed(4)} KAS @ $${kasPriceUsd.toFixed(4)} ` +
        `(Kelly ${(kelly * 100).toFixed(1)}% × entry bias ${(entryBias * 100).toFixed(0)}%, ` +
        `slippage ≤ ${slippagePct.toFixed(2)}%)`,
      preferCovenant: VPROG_ENABLED,
    };
  }

  // REDUCE → SELL_KAS: convert KAS back to stablecoin
  const exitBias = parseFraction(agentConfig?.stableExitBias, 0.4);
  const rawKasAmount = Math.min(kasBalance, capitalLimit > 0 ? capitalLimit : kasBalance)
    * exitBias * kelly;
  const kasAmount = round(rawKasAmount, 6);

  if (kasBalance <= 0 || kasAmount <= 0) return null;

  const stableAmount = round(kasAmount * kasPriceUsd, 2);
  const usdValue = stableAmount;

  if (usdValue < MIN_TRADE_USD) return null;

  return {
    direction: "SELL_KAS",
    kasAmount,
    stableTick,
    stableAmount,
    slippageBps,
    usdValue,
    kellyFraction: kelly,
    reason:
      `REDUCE signal: selling ${kasAmount.toFixed(4)} KAS ` +
      `for ~${stableAmount.toFixed(2)} ${stableTick} @ $${kasPriceUsd.toFixed(4)} ` +
      `(Kelly ${(kelly * 100).toFixed(1)}% × exit bias ${(exitBias * 100).toFixed(0)}%, ` +
      `slippage ≤ ${slippagePct.toFixed(2)}%)`,
    preferCovenant: VPROG_ENABLED,
  };
}

/**
 * Returns a short status label for the current pair mode configuration.
 * Used in the Dashboard log + overview tile.
 */
export function describePairMode(
  pairMode: string | undefined,
  vProgEnabled = VPROG_ENABLED,
): string {
  const mode = String(pairMode ?? "accumulation").toLowerCase();
  if (mode === "kas-usdc") {
    return vProgEnabled
      ? "KAS/USDC — trustless atomic swap (vProg active)"
      : "KAS/USDC — DEX route (vProg pending)";
  }
  if (mode === "dual") {
    return vProgEnabled
      ? "Dual accumulation + pair trading (vProg active)"
      : "Dual accumulation + pair trading (vProg pending)";
  }
  return "Accumulation only";
}

/**
 * Formats a PairExecutionIntent for the execution log.
 * Returns a compact single-line summary.
 */
export function formatPairIntentLog(intent: PairExecutionIntent): string {
  const dir = intent.direction === "BUY_KAS" ? "BUY KAS" : "SELL KAS";
  const route = intent.preferCovenant ? "via covenant" : "via DEX";
  return (
    `PAIR TRADE → ${dir} · ${intent.kasAmount.toFixed(4)} KAS ↔ ` +
    `${intent.stableAmount.toFixed(2)} ${intent.stableTick} · ` +
    `~$${intent.usdValue.toFixed(2)} · slippage ≤ ${(intent.slippageBps / 100).toFixed(2)}% · ${route}`
  );
}
