// Wallet state machine types.
// All state transitions are explicit and validated — no implicit state drift.

export type WalletState =
  | "FIRST_RUN"          // No vault in storage; user must create or import
  | "LOCKED"             // Vault exists, session not active
  | "UNLOCKED"           // Session active, UTXO sync pending
  | "SYNCING"            // Fetching UTXOs + balance
  | "READY"              // Synced, idle, ready for user interaction
  | "BUILDING_TX"        // User has initiated a send; building transaction
  | "AWAITING_SIGNATURE" // Dry-run passed; waiting for user confirmation
  | "BROADCASTING"       // Signed transaction being submitted to network
  | "CONFIRMING"         // Broadcast accepted; waiting for DAG confirmation
  | "ERROR";             // Recoverable error (shown in UI, reset → READY)

export interface StateTransition {
  from: WalletState | WalletState[];
  to: WalletState;
  action: string;
}

// Valid transition table — every other (from → to) pair is rejected.
export const TRANSITIONS: StateTransition[] = [
  { from: "FIRST_RUN",           to: "LOCKED",            action: "VAULT_CREATED" },
  { from: "LOCKED",              to: "UNLOCKED",          action: "UNLOCK" },
  { from: ["UNLOCKED", "READY"], to: "LOCKED",            action: "LOCK" },
  { from: "UNLOCKED",            to: "SYNCING",           action: "BEGIN_SYNC" },
  { from: "SYNCING",             to: "READY",             action: "SYNC_COMPLETE" },
  { from: "SYNCING",             to: "ERROR",             action: "SYNC_FAIL" },
  { from: "READY",               to: "BUILDING_TX",       action: "BUILD_TX" },
  { from: "BUILDING_TX",         to: "AWAITING_SIGNATURE", action: "DRY_RUN_OK" },
  { from: "BUILDING_TX",         to: "ERROR",             action: "DRY_RUN_FAIL" },
  { from: "AWAITING_SIGNATURE",  to: "BROADCASTING",      action: "SIGN_OK" },
  { from: "AWAITING_SIGNATURE",  to: "READY",             action: "SIGN_CANCEL" },
  { from: "BROADCASTING",        to: "CONFIRMING",        action: "BROADCAST_OK" },
  { from: "BROADCASTING",        to: "ERROR",             action: "BROADCAST_FAIL" },
  { from: "CONFIRMING",          to: "READY",             action: "CONFIRMED" },
  { from: "CONFIRMING",          to: "ERROR",             action: "CONFIRM_TIMEOUT" },
  { from: "ERROR",               to: "READY",             action: "RESET_ERROR" },
  // Auto-lock from any non-terminal state
  { from: ["READY", "BUILDING_TX", "ERROR"], to: "LOCKED", action: "AUTOLOCK" },
];

// States in which an auto-lock must NOT interrupt the user
export const AUTOLOCK_DEFERRED_STATES: WalletState[] = [
  "AWAITING_SIGNATURE",
  "BROADCASTING",
  "CONFIRMING",
];
