// Phase 6 — Integration tests: Wallet State Machine (Phase 5)
// Tests all valid transitions, invalid transition rejection, and subscription callbacks.
// Action names are taken directly from TRANSITIONS in extension/state/types.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });

describe("WalletStateMachine — valid transitions", () => {
  it("transitions FIRST_RUN → LOCKED on VAULT_CREATED", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("FIRST_RUN");
    expect(walletStateMachine.transition("VAULT_CREATED")).toBe("LOCKED");
  });

  it("transitions LOCKED → UNLOCKED on UNLOCK", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("LOCKED");
    expect(walletStateMachine.transition("UNLOCK")).toBe("UNLOCKED");
  });

  it("transitions UNLOCKED → LOCKED on LOCK", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("UNLOCKED");
    expect(walletStateMachine.transition("LOCK")).toBe("LOCKED");
  });

  it("transitions UNLOCKED → SYNCING on BEGIN_SYNC", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("UNLOCKED");
    expect(walletStateMachine.transition("BEGIN_SYNC")).toBe("SYNCING");
  });

  it("transitions SYNCING → READY on SYNC_COMPLETE", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("SYNCING");
    expect(walletStateMachine.transition("SYNC_COMPLETE")).toBe("READY");
  });

  it("transitions READY → BUILDING_TX on BUILD_TX", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("READY");
    expect(walletStateMachine.transition("BUILD_TX")).toBe("BUILDING_TX");
  });

  it("transitions BUILDING_TX → AWAITING_SIGNATURE on DRY_RUN_OK", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("BUILDING_TX");
    expect(walletStateMachine.transition("DRY_RUN_OK")).toBe("AWAITING_SIGNATURE");
  });

  it("transitions AWAITING_SIGNATURE → BROADCASTING on SIGN_OK", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("AWAITING_SIGNATURE");
    expect(walletStateMachine.transition("SIGN_OK")).toBe("BROADCASTING");
  });

  it("transitions BROADCASTING → CONFIRMING on BROADCAST_OK", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("BROADCASTING");
    expect(walletStateMachine.transition("BROADCAST_OK")).toBe("CONFIRMING");
  });

  it("transitions CONFIRMING → READY on CONFIRMED", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("CONFIRMING");
    expect(walletStateMachine.transition("CONFIRMED")).toBe("READY");
  });

  it("transitions tx states → ERROR on their respective error actions", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    const cases = [
      ["SYNCING",      "SYNC_FAIL"],
      ["BUILDING_TX",  "DRY_RUN_FAIL"],
      ["BROADCASTING", "BROADCAST_FAIL"],
      ["CONFIRMING",   "CONFIRM_TIMEOUT"],
    ] as const;
    for (const [state, action] of cases) {
      walletStateMachine.init(state);
      expect(walletStateMachine.transition(action)).toBe("ERROR");
    }
  });

  it("transitions ERROR → READY on RESET_ERROR", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("ERROR");
    expect(walletStateMachine.transition("RESET_ERROR")).toBe("READY");
  });

  it("AWAITING_SIGNATURE → READY on SIGN_CANCEL (user aborted)", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("AWAITING_SIGNATURE");
    expect(walletStateMachine.transition("SIGN_CANCEL")).toBe("READY");
  });
});

describe("WalletStateMachine — invalid transitions", () => {
  it("throws on invalid transition", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("LOCKED");
    expect(() => walletStateMachine.transition("BUILD_TX")).toThrow();
  });

  it("tryTransition returns false on invalid action (no throw)", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("FIRST_RUN");
    const result = walletStateMachine.tryTransition("CONFIRMED");
    expect(result).toBe(false);
    expect(walletStateMachine.state).toBe("FIRST_RUN"); // state unchanged
  });

  it("LOCKED cannot go directly to READY", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("LOCKED");
    expect(() => walletStateMachine.transition("SYNC_COMPLETE")).toThrow();
  });
});

describe("WalletStateMachine — subscriptions", () => {
  it("notifies subscribers on each transition", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("LOCKED");
    const received: string[] = [];
    const unsub = walletStateMachine.subscribe((s) => received.push(s));
    walletStateMachine.transition("UNLOCK");
    walletStateMachine.transition("BEGIN_SYNC");
    unsub();
    walletStateMachine.transition("SYNC_COMPLETE"); // after unsub — must NOT notify
    expect(received).toEqual(["UNLOCKED", "SYNCING"]);
  });

  it("tryTransition returns true on a valid action", async () => {
    const { walletStateMachine } = await import("../../extension/state/stateMachine");
    walletStateMachine.init("LOCKED");
    expect(walletStateMachine.tryTransition("UNLOCK")).toBe(true);
    expect(walletStateMachine.state).toBe("UNLOCKED");
  });
});
