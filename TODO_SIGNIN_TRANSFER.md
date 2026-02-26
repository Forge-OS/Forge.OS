# TODO: Transfer Sign In functionality to Connect button

## Task
Transfer the "Sign In" button functionality from the Header component to the "Connect" button in WalletGate component. Also make the Header's Sign In button check for existing session and reconnect via extension.

## Completed Changes

### Step 1: Modify WalletGate.tsx
- [x] Add `onSignInClick` prop to WalletGate component
- [x] Change "Connect" button to call `onSignInClick()` instead of `connect("demo")`

### Step 2: Modify ForgeOS.tsx  
- [x] Pass `onSignInClick` prop to WalletGate component
- [x] Add `handleReconnect` function to attempt reconnection via extension
- [x] Pass `onReconnect` prop to Header component

### Step 3: Modify Header.tsx
- [x] Add `onReconnect` prop to Header component
- [x] Check for existing session on mount using `loadSession()`
- [x] If user has existing session with extension (kasware/kastle), call `onReconnect` to sign in via extension
- [x] Otherwise, show SignInModal

## Files Edited
1. `src/components/WalletGate.tsx` - Added onSignInClick prop, changed button behavior
2. `src/ForgeOS.tsx` - Added handleReconnect, passed props to Header and WalletGate
3. `src/components/Header.tsx` - Added onReconnect logic to check existing session

## Status: COMPLETED
- The "Connect" button on the top page UI now opens the SignInModal with full wallet authentication
- The "Sign In" button in the Header now checks for existing session:
  - If user has a session with Kasware or Kastle extension → tries to reconnect via extension (user enters wallet password)
  - Otherwise → shows SignInModal

