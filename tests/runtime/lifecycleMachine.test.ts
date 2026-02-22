import { describe, expect, it } from 'vitest';
import {
  transitionAgentLifecycle,
  transitionQueueTxLifecycle,
  transitionQueueTxReceiptLifecycle,
} from '../../src/runtime/lifecycleMachine';

describe('lifecycleMachine', () => {
  it('transitions agent lifecycle through pause/resume/kill', () => {
    let state = transitionAgentLifecycle('RUNNING', { type: 'PAUSE' });
    expect(state).toBe('PAUSED');
    state = transitionAgentLifecycle(state, { type: 'RESUME' });
    expect(state).toBe('RUNNING');
    state = transitionAgentLifecycle(state, { type: 'KILL' });
    expect(state).toBe('SUSPENDED');
  });

  it('transitions tx lifecycle correctly', () => {
    let state = transitionQueueTxLifecycle('pending', { type: 'BEGIN_SIGN' });
    expect(state).toBe('signing');
    state = transitionQueueTxLifecycle(state, { type: 'SIGN_SUCCESS', txid: 'a'.repeat(64) });
    expect(state).toBe('signed');
    expect(transitionQueueTxLifecycle('pending', { type: 'SIGN_REJECT' })).toBe('rejected');
    expect(transitionQueueTxLifecycle('failed', { type: 'REQUEUE' })).toBe('pending');
  });

  it('transitions tx receipt lifecycle correctly (including rehydrated submitted items)', () => {
    expect(transitionQueueTxReceiptLifecycle('submitted', { type: 'BROADCASTED' })).toBe('broadcasted');
    expect(transitionQueueTxReceiptLifecycle('broadcasted', { type: 'POLL_PENDING' })).toBe('pending_confirm');
    expect(transitionQueueTxReceiptLifecycle('pending_confirm', { type: 'CONFIRMED' })).toBe('confirmed');
    expect(transitionQueueTxReceiptLifecycle('submitted', { type: 'CONFIRMED' })).toBe('confirmed');
    expect(transitionQueueTxReceiptLifecycle('submitted', { type: 'POLL_PENDING' })).toBe('pending_confirm');
    expect(transitionQueueTxReceiptLifecycle('pending_confirm', { type: 'TIMEOUT' })).toBe('timeout');
  });
});
