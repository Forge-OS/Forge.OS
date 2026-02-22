import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function setWindowKasware(kasware: any) {
  (globalThis as any).window = {
    kasware,
    kastle: undefined,
    location: { href: '' },
    prompt: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

function setWindowKastle(kastle: any) {
  (globalThis as any).window = {
    kasware: undefined,
    kastle,
    location: { href: '' },
    prompt: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

describe('WalletAdapter', () => {
  const originalEnv = { ...(import.meta as any).env };
  const originalFetch = (globalThis as any).fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    vi.unstubAllEnvs();
    (import.meta as any).env = { ...originalEnv };
    if (originalFetch) (globalThis as any).fetch = originalFetch;
    else delete (globalThis as any).fetch;
  });

  it('connects kasware when requestAccounts and getNetwork succeed', async () => {
    setWindowKasware({
      requestAccounts: vi.fn().mockResolvedValue(['kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85']),
      getNetwork: vi.fn().mockResolvedValue('mainnet'),
    });
    const { WalletAdapter } = await import('../../src/wallet/WalletAdapter');
    const session = await WalletAdapter.connectKasware();
    expect(session.provider).toBe('kasware');
    expect(session.network).toBe('mainnet');
    expect(session.address).toMatch(/^kaspa:/);
  });

  it('falls back when getNetwork fails but address matches active profile', async () => {
    setWindowKasware({
      requestAccounts: vi.fn().mockResolvedValue(['kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85']),
      getNetwork: vi.fn().mockRejectedValue(new Error('provider flaked')),
    });
    const { WalletAdapter } = await import('../../src/wallet/WalletAdapter');
    const session = await WalletAdapter.connectKasware();
    expect(session.network).toBe('mainnet');
  });

  it('normalizes user rejection on sendKasware', async () => {
    setWindowKasware({
      sendKaspa: vi.fn().mockRejectedValue(new Error('User rejected request')),
    });
    const { WalletAdapter } = await import('../../src/wallet/WalletAdapter');
    await expect(
      WalletAdapter.sendKasware('kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85', 1)
    ).rejects.toThrow(/User rejected wallet request/);
  });

  it('connects kastle when connect/getAccount/request succeed', async () => {
    setWindowKastle({
      connect: vi.fn().mockResolvedValue(true),
      getAccount: vi.fn().mockResolvedValue({
        address: 'kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85',
        publicKey: '02abc',
      }),
      request: vi.fn().mockImplementation((method: string) => {
        if (method === 'kas:get_network') return Promise.resolve('mainnet');
        return Promise.resolve(null);
      }),
    });
    const { WalletAdapter } = await import('../../src/wallet/WalletAdapter');
    const session = await WalletAdapter.connectKastle();
    expect(session.provider).toBe('kastle');
    expect(session.network).toBe('mainnet');
    expect(session.address).toMatch(/^kaspa:/);
  });

  it('builds kastle raw multi-output tx via backend tx-builder endpoint when configured', async () => {
    vi.stubEnv('VITE_KASTLE_RAW_TX_ENABLED', 'true');
    vi.stubEnv('VITE_KASTLE_RAW_TX_MANUAL_JSON_PROMPT_ENABLED', 'false');
    vi.stubEnv('VITE_KASTLE_TX_BUILDER_URL', 'http://127.0.0.1:9999/v1/kastle/build-tx-json');
    vi.stubEnv('VITE_KASTLE_TX_BUILDER_TIMEOUT_MS', '5000');
    const signAndBroadcastTx = vi.fn().mockResolvedValue('d'.repeat(64));
    setWindowKastle({
      connect: vi.fn().mockResolvedValue(true),
      getAccount: vi.fn().mockResolvedValue({
        address: 'kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85',
        publicKey: '02abc',
      }),
      request: vi.fn().mockImplementation((method: string) => {
        if (method === 'kas:get_network') return Promise.resolve('mainnet');
        return Promise.resolve(null);
      }),
      signAndBroadcastTx,
    });
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ txJson: '{"mock":"txjson"}' }),
    });
    const { WalletAdapter } = await import('../../src/wallet/WalletAdapter');
    const txid = await WalletAdapter.sendKastleRawTx([
      { to: 'kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85', amount_kas: 1.0 },
      { to: 'kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85', amount_kas: 0.06 },
    ], 'combined treasury');
    expect(txid).toBe('d'.repeat(64));
    expect((globalThis as any).fetch).toHaveBeenCalledOnce();
    expect(signAndBroadcastTx).toHaveBeenCalledWith('mainnet', '{"mock":"txjson"}');
  });
});
