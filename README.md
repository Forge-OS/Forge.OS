# Forge.OS

ForgeOS is a Kaspa-focused, wallet-native AI trading dashboard prototype.

It provides:
- Wallet-gated access (Kasware, Kaspium, or demo mode)
- Agent setup wizard
- AI decision panel (risk/confidence-based)
- Action queue with signing workflow
- Treasury fee split visibility
- Wallet and UTXO operations panel

## Quick Start

### Prerequisites
- Node.js 18+
- npm 9+
- Optional: Kasware extension
- Optional: Kaspium mobile wallet

### Install
```bash
npm install
```

### Run (Development)
```bash
npm run dev
```

### Build (Production)
```bash
npm run build
```

### Preview Build
```bash
npm run preview
```

## Environment
Create a `.env` file from `.env.example` and set values for your target environment.

Core Kaspa settings:
- `VITE_KAS_API`
- `VITE_KAS_EXPLORER`
- `VITE_KAS_NETWORK`
- `VITE_KAS_NETWORK_LABEL`
- `VITE_KAS_WS_URL` (for websocket/push feeds)

AI settings:
- `VITE_AI_API_URL` (Anthropic direct or your backend proxy)
- `VITE_AI_MODEL`
- `VITE_ANTHROPIC_API_KEY` (only if calling Anthropic directly from browser)

Kaspa ecosystem references:
- `https://github.com/K-Kluster/kaspa-js/`
- `https://github.com/kaspanet/silverscript`
- `https://kaspa.stream/`
- `https://kaspa.org/kaspium-v1-0-1-release/`
- `https://kasware.xyz`

## How It Works
1. Connect wallet (Kasware, Kaspium, or demo mode).
2. Configure and deploy an agent in the wizard.
3. Use Dashboard tabs:
- `Overview`: KPI/status summary
- `Intelligence`: latest quant decision output
- `Queue`: pending/signed/rejected actions
- `Treasury`: fee-routing and ledger
- `Wallet`: balances, UTXOs, withdrawals
- `Log`: event history
- `Controls`: execution/risk controls

## Wallet Support
- `Kasware`: extension connection + signing/broadcast via wallet provider APIs.
- `Kaspium`: mobile deep-link send flow with txid confirmation prompt.
- `Demo`: full UI simulation without live wallet signing.

## Important Notes
- Signing is wallet-native; keys are not stored by app code.
- Kaspium flow uses a deep-link handoff and manual txid confirmation.
- AI endpoint calls may fail without auth/proxy wiring.
- Kaspa data calls can use live polling or websocket stream (when configured).

## Production Readiness Checklist
1. Set repo-level Actions variables for all `VITE_KAS_*` values.
2. Configure `VITE_KAS_WS_URL` to a reliable websocket endpoint for real-time push updates.
3. For AI, use a backend proxy (`VITE_AI_API_URL`) instead of exposing secrets client-side.
4. Verify CORS and rate limits for your Kaspa API provider.
5. Run:
```bash
npm run build
npm run preview
```
6. Validate wallet flows in browser:
- Kasware connect/sign/send
- Kaspium deep-link + txid confirmation
7. Confirm GitHub Pages workflow succeeds and site loads from:
- `https://gryszzz.github.io/Forge.OS/`

## Release Packaging
```bash
npm run build
zip -r forgeos-vX.Y.Z-dist.zip dist
```

Use `GITHUB_RELEASE_TEMPLATE.md` when publishing a GitHub release.

## Developer Docs
For architecture and implementation details, see:
- `README.dev.md
-
- `<img width="606" height="784" alt="Screenshot 2026-02-18 at 7 16 58 PM" src="https://github.com/user-attachments/assets/0a3763ad-7dcf-4f7e-8c1e-3c5192208377" />

- 
