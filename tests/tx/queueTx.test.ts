import { describe, expect, it, vi } from 'vitest';
import { buildQueueTxItem, broadcastQueueTx, validateQueueTxItem } from '../../src/tx/queueTx';
import { WalletAdapter } from '../../src/wallet/WalletAdapter';

const TREASURY_ADDR = 'kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85';
const MOCK_USER_ADDR = 'kaspa:qqkqkzjvr7zwxxmjxjkmxxdwju9kjs6e9u82uh59z07vgaks6gg62v8707g73';




describe('queueTx', () => {
  it('builds and validates queue tx items', () => {
    const tx = buildQueueTxItem({
      id: 'x1',
      type: 'ACCUMULATE',
      to: 'kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85',
      amount_kas: 1.23456789,
      purpose: 'test tx',
    });
    expect(tx.amount_kas).toBe(1.234568);
    expect(tx.status).toBe('pending');
    expect(validateQueueTxItem(tx).to).toMatch(/^kaspa:/);
  });

  it('validates multi-output queue tx items and keeps primary output for UI compatibility', () => {
    const tx = buildQueueTxItem({
      id: 'x-multi',
      type: 'ACCUMULATE',
      to: MOCK_USER_ADDR,
      amount_kas: 1.5,
      outputs: [
        { to: MOCK_USER_ADDR, amount_kas: 1.5, tag: 'primary' },
        { to: TREASURY_ADDR, amount_kas: 0.06, tag: 'treasury' },
      ],
      purpose: 'combined treasury',
    });
    expect(Array.isArray(tx.outputs)).toBe(true);
    expect(tx.outputs).toHaveLength(2);
    expect(tx.amount_kas).toBe(1.5);
    expect(tx.to).toMatch(/^kaspa:/);
  });

  it('broadcasts with wallet adapter for kasware', async () => {
    const spy = vi.spyOn(WalletAdapter, 'sendKasware').mockResolvedValue('a'.repeat(64));
    const tx = buildQueueTxItem({
      id: 'x2',
      type: 'ACCUMULATE',
      to: 'kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85',
      amount_kas: 1,
      purpose: 'test',
    });
    const txid = await broadcastQueueTx({ provider: 'kasware' }, tx);
    expect(txid).toHaveLength(64);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('routes multi-output tx through kastle raw tx path when capability is enabled', async () => {

    const supportSpy = vi.spyOn(WalletAdapter, 'supportsNativeMultiOutput').mockImplementation((provider: string) => provider === 'kastle');
    const canRawSpy = vi.spyOn(WalletAdapter, 'canKastleSignAndBroadcastRawTx').mockReturnValue(true);
    const rawSpy = vi.spyOn(WalletAdapter, 'sendKastleRawTx').mockResolvedValue('c'.repeat(64));
    const tx = buildQueueTxItem({
      id: 'x4',
      type: 'ACCUMULATE',
      to: MOCK_USER_ADDR,
      amount_kas: 1,
      outputs: [
        { to: MOCK_USER_ADDR, amount_kas: 1, tag: 'primary' },
        { to: TREASURY_ADDR, amount_kas: 0.06, tag: 'treasury' },
      ],
      purpose: 'kastle multi',
    });
    const txid = await broadcastQueueTx({ provider: 'kastle' }, tx);
    expect(txid).toHaveLength(64);
    expect(rawSpy).toHaveBeenCalledOnce();
    rawSpy.mockRestore();
    canRawSpy.mockRestore();
    supportSpy.mockRestore();
  });
});
