// Deterministic wallet state machine.
// All transition attempts are validated against TRANSITIONS.
// Invalid transitions throw — they must never be silently swallowed by callers.

import { TRANSITIONS, type WalletState, type StateTransition } from "./types";

type Listener = (next: WalletState, prev: WalletState, action: string) => void;

class WalletStateMachine {
  private _state: WalletState = "FIRST_RUN";
  private _listeners: Set<Listener> = new Set();

  get state(): WalletState {
    return this._state;
  }

  /**
   * Attempt a transition identified by action name.
   * Returns the new state on success.
   * Throws if the (current, action) pair has no valid target in TRANSITIONS.
   */
  transition(action: string): WalletState {
    const rule = this._findRule(this._state, action);
    if (!rule) {
      throw new Error(
        `StateMachine: no transition "${action}" from state "${this._state}"`,
      );
    }

    const prev = this._state;
    this._state = rule.to;

    for (const fn of this._listeners) {
      try { fn(this._state, prev, action); } catch { /* listener errors must not crash */ }
    }

    return this._state;
  }

  /**
   * Idempotent transition: perform the transition only if the current state
   * allows it. Returns true if the transition happened, false if it was
   * skipped (already in target state or not a valid transition).
   */
  tryTransition(action: string): boolean {
    try {
      this.transition(action);
      return true;
    } catch {
      return false;
    }
  }

  /** Register a listener called after every successful transition. */
  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Force-set state (use only for initialisation). */
  init(state: WalletState): void {
    this._state = state;
  }

  private _findRule(
    current: WalletState,
    action: string,
  ): StateTransition | undefined {
    return TRANSITIONS.find((t) => {
      const fromMatch = Array.isArray(t.from)
        ? t.from.includes(current)
        : t.from === current;
      return fromMatch && t.action === action;
    });
  }
}

// Singleton — shared across the popup lifetime
export const walletStateMachine = new WalletStateMachine();
