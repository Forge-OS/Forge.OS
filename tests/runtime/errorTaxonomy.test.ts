import { describe, expect, it } from 'vitest';
import { formatForgeError, normalizeError, walletError, rpcError, txError } from '../../src/runtime/errorTaxonomy';

describe('errorTaxonomy', () => {
  it('classifies wallet timeout and rejection', () => {
    expect(walletError(new Error('request timeout')).code).toBe('WALLET_TIMEOUT');
    expect(walletError(new Error('User rejected request')).code).toBe('WALLET_USER_REJECTED');
  });

  it('classifies rpc and tx errors', () => {
    expect(rpcError(new Error('429 rate limited')).code).toBe('RPC_RATE_LIMIT');
    expect(txError(new Error('invalid tx amount')).code).toBe('TX_INVALID');
  });

  it('formats normalized errors', () => {
    const fx = normalizeError(new Error('boom'), { domain: 'system' });
    expect(formatForgeError(fx)).toContain('UNKNOWN');
    expect(formatForgeError(fx)).toContain('boom');
  });
});
