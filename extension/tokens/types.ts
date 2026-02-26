// Token registry types.
// All token amounts use bigint + decimals (never float arithmetic on balances).

export type TokenId = "KAS" | "USDT" | "USDC";

export interface Token {
  id: TokenId;
  symbol: string;
  name: string;
  decimals: number;
  /** null = native layer-1 asset (KAS); non-null = future Kaspa native asset ID */
  assetId: string | null;
  /** Whether this token is currently active/usable. False = display-only scaffolding. */
  enabled: boolean;
  /** Reason shown in UI when enabled=false. */
  disabledReason: string | null;
}

export interface TokenRegistry {
  version: number;
  tokens: Record<TokenId, Token>;
}
