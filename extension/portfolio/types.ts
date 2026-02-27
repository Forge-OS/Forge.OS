import type { KaspaTokenStandard, SwapCustomToken } from "../swap/types";

export interface KrcMarketSnapshot {
  priceUsd: number | null;
  change24hPct: number | null;
  updatedAt: number;
  source: string;
}

export interface KrcChainStatsSnapshot {
  holders: number | null;
  owners: number | null;
  supply: string | null;
  txCount24h: number | null;
  sales24h: number | null;
  listedCount: number | null;
  collectionItems: number | null;
  volume24hUsd: number | null;
  floorPriceUsd: number | null;
  floorChange24hPct: number | null;
  marketCapUsd: number | null;
  updatedAt: number;
  source: string;
}

export interface KrcCandlePoint {
  ts: number;
  valueUsd: number;
  volumeUsd: number | null;
}

export interface KrcPortfolioToken {
  key: string;
  token: SwapCustomToken;
  standard: KaspaTokenStandard;
  balanceRaw: string;
  balanceDisplay: string;
  balanceApprox: number;
  market: KrcMarketSnapshot | null;
  chain: KrcChainStatsSnapshot | null;
  candles: KrcCandlePoint[];
  valueUsd: number | null;
  updatedAt: number;
}
