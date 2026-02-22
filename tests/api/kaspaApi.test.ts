import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('kaspaApi', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dedupes in-flight price requests', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, json: async () => ({ price: 0.12345 }) } as any;
    }));

    const api = await import('../../src/api/kaspaApi');
    const [a, b] = await Promise.all([api.kasPrice(), api.kasPrice()]);
    expect(a).toBeCloseTo(0.12345);
    expect(b).toBeCloseTo(0.12345);
    expect(calls).toBe(1);
  });

  it('retries transient RPC failures for balance', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 503, json: async () => ({}) } as any;
      }
      return { ok: true, json: async () => ({ balance: 100000000 }) } as any;
    }));

    const api = await import('../../src/api/kaspaApi');
    const bal = await api.kasBalance('kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85');
    expect(Number(bal.kas)).toBe(1);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('resolves tx receipt with endpoint fallback and parses confirmations', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('/transactions/')) {
        return { ok: false, status: 404, json: async () => ({}) } as any;
      }
      if (String(url).includes('/txs/')) {
        return {
          ok: true,
          json: async () => ({
            tx: {
              status: 'confirmed',
              confirmations: 3,
              blockTime: 1234567890,
            },
          }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }));

    const api = await import('../../src/api/kaspaApi');
    const receipt = await api.kasTxReceipt('a'.repeat(64));
    expect(receipt.found).toBe(true);
    expect(receipt.status).toBe('confirmed');
    expect(receipt.confirmations).toBe(3);
    expect(receipt.sourcePath).toContain('/txs/');
    expect(calls.some((url) => url.includes('/transactions/'))).toBe(true);
    expect(calls.some((url) => url.includes('/txs/'))).toBe(true);
  });

  it('returns pending-not-found when tx receipt endpoints return 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as any));
    const api = await import('../../src/api/kaspaApi');
    const receipt = await api.kasTxReceipt('b'.repeat(64));
    expect(receipt.found).toBe(false);
    expect(receipt.status).toBe('pending');
    expect(receipt.confirmations).toBe(0);
  });
});
