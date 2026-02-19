# Forge.OS

ForgeOS is a Kaspa-focused, wallet-native AI trading dashboard.

It provides:
- Wallet-gated access (Kasware, Kaspium, or demo mode)
- Agent setup wizard
- AI decision panel (risk/confidence-based)
- Action queue with signing workflow
- Treasury fee split visibility
- Wallet and UTXO operations panel
- Accumulate-only execution mode (buy/stack discipline)
- Runtime mainnet/testnet profile switching (`?network=mainnet|testnet`)

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

### Strict Validation
```bash
npm run ci
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
- `VITE_KAS_API_FALLBACKS` (comma-separated backup endpoints)
- `VITE_KAS_EXPLORER`
- `VITE_KAS_NETWORK`
- `VITE_KAS_NETWORK_LABEL`
- `VITE_KAS_WS_URL`
- `VITE_KASPIUM_DEEP_LINK_SCHEME`
- `VITE_KAS_ENFORCE_WALLET_NETWORK`
- `VITE_ACCUMULATE_ONLY`
- `VITE_TREASURY_ADDRESS_MAINNET`
- `VITE_TREASURY_ADDRESS_TESTNET`
- `VITE_ACCUMULATION_ADDRESS_MAINNET`
- `VITE_ACCUMULATION_ADDRESS_TESTNET`
- `VITE_FEE_RATE`
- `VITE_TREASURY_SPLIT`

AI settings:
- `VITE_AI_API_URL`
- `VITE_AI_MODEL`
- `VITE_ANTHROPIC_API_KEY` (only if calling Anthropic directly from browser)

## Mainnet/Testnet Runtime Switch
- Default profile comes from `VITE_KAS_NETWORK`.
- You can override at runtime:
  - `https://<host>/?network=mainnet`
  - `https://<host>/?network=testnet`
- The app stores the active profile in browser local storage (`forgeos.network`).
- Wallet address validation, API/explorer defaults, treasury routing, and accumulation vault routing all follow the active profile.

## Production Readiness Checklist
1. Set repo-level Actions variables for all `VITE_KAS_*` values.
2. Configure `VITE_KAS_WS_URL` for real-time websocket feeds.
3. Configure `VITE_KAS_ENFORCE_WALLET_NETWORK=true` for strict wallet-network matching.
4. Configure network-specific treasury/vault addresses and fee split vars.
5. Use backend proxy for AI (`VITE_AI_API_URL`) to avoid exposing secrets.
6. Run `npm run ci` and ensure all workflows are green.
7. Validate wallet flows:
- Kasware connect/sign/send
- Kaspium deep-link + txid confirmation
8. Confirm GitHub Pages deploy succeeds and loads at:
- `https://gryszzz.github.io/Forge.OS/`

## Overnight Go-Live + Domain
1. Push to `main` to trigger deploy.
2. In GitHub repo settings, set Actions variable:
- `GH_PAGES_CNAME=yourdomain.com`
3. In DNS provider, add:
- `CNAME` record for `www` -> `gryszzz.github.io`
- Optional apex root: `A` records to GitHub Pages IPs (if using root domain)
4. Re-run `Deploy ForgeOS to GitHub Pages` workflow.
5. Verify:
- `https://gryszzz.github.io/Forge.OS/`
- `https://yourdomain.com` (after DNS propagation)

## Core Docs
- Developer architecture: `README.dev.md`
- Kaspa raw links and resources: `docs/kaspa/links.md`
- AI researcher prompts: `docs/ai/kaspa-elite-engineer-mode.md`
- Agent operating rules for this repo: `AGENTS.md`
