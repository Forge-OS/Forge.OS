# ForgeOS

ForgeOS is a wallet-native Kaspa dashboard for running an AI-assisted trading agent simulation.

It includes:
- Wallet connection (Kasware + Kaspium + demo mode)
- Agent creation wizard
- Decision engine panel (Kelly, Monte Carlo, risk/confidence gating)
- Action queue with manual/auto signing flows
- Treasury fee split and logs
- Wallet operations panel (balance, UTXOs, withdraw flow)

## Who This Is For
- Builders prototyping Kaspa-native agent workflows
- Operators who want transparent signing and execution controls
- Contributors who need a clean React/TypeScript codebase to extend

## Tech Stack
- React 18
- TypeScript
- Vite
- Recharts

## Project Layout
- `forgeos-ui.tsx`: stable app export entry (re-exports `src/ForgeOS.tsx`)
- `src/ForgeOS.tsx`: root shell/topbar + view routing
- `src/components/ui/*`: base UI primitives (`Card`, `Btn`, `Inp`, etc.)
- `src/components/WalletGate.tsx`: wallet connect gate (Kasware/Kaspium/demo)
- `src/components/SigningModal.tsx`: signing confirmation modal
- `src/components/wizard/*`: agent setup/deploy flow
- `src/components/dashboard/*`: dashboard panels and core runtime UI
- `src/api/kaspaApi.ts`: Kaspa API calls
- `src/wallet/WalletAdapter.ts`: wallet mechanics (Kasware + Kaspium)
- `src/quant/runQuantEngine.ts`: AI decision call + strict JSON parse
- `src/log/seedLog.ts`: seeded log data + log colors
- `src/constants.ts`, `src/tokens.ts`, `src/helpers.ts`: constants/design/helpers

## Prerequisites
- Node.js 18+
- npm 9+
- Optional: Kasware extension installed and unlocked
- Optional: Kaspium mobile wallet

## Local Run
```bash
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`).

## Build and Preview
```bash
npm run build
npm run preview
```

Production assets are generated in `dist/`.

## Environment Variables
Defined in `.env.example`.

Kaspa network:
- `VITE_KAS_API`
- `VITE_KAS_EXPLORER`
- `VITE_KAS_NETWORK`
- `VITE_KAS_NETWORK_LABEL`
- `VITE_KAS_WS_URL`

AI engine:
- `VITE_AI_API_URL` (default: Anthropic Messages API)
- `VITE_AI_MODEL`
- `VITE_ANTHROPIC_API_KEY` (required when calling Anthropic directly)

## How To Use
1. Launch app with `npm run dev`.
2. Connect wallet:
- `Kasware` for extension flow
- `Kaspium` for mobile deep-link flow
- `Demo Mode` for UI simulation without extension
3. Create agent in Wizard:
- name, ROI target, capital per cycle, risk, execution mode
4. Deploy agent (sign step appears).
5. In Dashboard:
- `Overview`: status, KPIs, quick controls
- `Intelligence`: decision output and rationale
- `Queue`: pending/signed/rejected actions
- `Treasury`: fee routing and ledger
- `Wallet`: balances/UTXOs/withdraw workflow
- `Log`: full runtime events
- `Controls`: execution and risk toggles

## Wallet Mechanics
- `WalletAdapter.detect()` reports wallet support:
- `kasware` (extension)
- `kaspium` (deep-link flow)
- Kasware connect path:
- `requestAccounts()`
- `getNetwork()`
- Kasware send path:
- `sendKaspa(toAddress, sompi)`
- Kaspium connect path:
- user enters `kaspa:` address
- adapter stores session with provider `kaspium`
- Kaspium send path:
- deep-link URL generated from `KASPIUM_DEEP_LINK_SCHEME`
- app prompts user to paste broadcast `txid`
- Demo mode:
- simulates transaction signatures/txids locally

## Execution Modes
- `manual`: every action requires signature
- `autonomous`: auto-signs actions below threshold; above threshold queues for manual sign
- `notify`: decisions generated, no execution broadcast

## Fee Routing
Defined in `src/constants.ts`:
- `FEE_RATE = 0.20`
- `TREASURY_SPLIT = 0.30`
- `AGENT_SPLIT = 0.70`

Dashboard logs and treasury panel display split accounting each cycle.

## AI Engine Notes
`src/quant/runQuantEngine.ts` supports two patterns:
- Direct Anthropic call (`VITE_AI_API_URL` points to `api.anthropic.com`):
- requires `x-api-key` (`VITE_ANTHROPIC_API_KEY`)
- requires `anthropic-version` header
- Backend proxy call (`VITE_AI_API_URL` points to your server):
- app sends `{ prompt, agent, kasData }`
- server returns either `{ decision }` or direct decision JSON

Recommendation for production:
- Keep AI keys server-side.
- Route AI requests through backend proxy.

## Kaspa Data Sources
`src/api/kaspaApi.ts` uses:
- `GET /info/price`
- `GET /addresses/:address/balance`
- `GET /addresses/:address/utxos`
- `GET /info/blockdag`

On failure, dashboard falls back to simulated DAG data so UI remains usable.

## CI Validation
Workflow: `.github/workflows/ci.yml`

Runs on push/PR and enforces:
- `npm run typecheck`
- `npm run build`
- `npm run smoke`

## GitHub Pages Deployment
Workflow: `.github/workflows/deploy-pages.yml`

Behavior:
- Builds on `main` pushes.
- Uses dynamic base path:
- `VITE_BASE_PATH=/${{ github.event.repository.name }}/`
- Adds `.nojekyll` to `dist/`.
- Publishes artifact with `actions/deploy-pages`.

Expected URL for current user/repo:
- `https://gryszzz.github.io/Forge.OS/`

## Go-Live Checklist
1. Set GitHub Actions repository variables for all `VITE_KAS_*` values.
2. Set a production websocket endpoint for `VITE_KAS_WS_URL`.
3. Point `VITE_AI_API_URL` to backend proxy.
4. Keep `VITE_ANTHROPIC_API_KEY` out of public client deployments whenever possible.
5. Verify pages build and deploy are green in GitHub Actions.
6. Validate wallet flows on production URL:
- Kasware connect/sign
- Kaspium deep-link + txid handoff
7. Run final checks:
```bash
npm run build
npm run preview
```

## Release / Packaging
A release template exists at:
- `GITHUB_RELEASE_TEMPLATE.md`

Typical flow:
```bash
npm run build
zip -r forgeos-vX.Y.Z-dist.zip dist
```

Then create GitHub release and attach:
- `forgeos-vX.Y.Z-dist.zip`

## Troubleshooting
- App does not start:
- verify Node version (`node -v`)
- run `npm install` again
- Kasware not detected:
- install/unlock extension, refresh page
- Kaspium send not opening wallet:
- verify mobile deep-link support and `KASPIUM_DEEP_LINK_SCHEME`
- AI errors in Intelligence panel:
- confirm `VITE_AI_API_URL` + auth/proxy configuration
- Build warning about chunk size:
- non-blocking for now; optimize later with code-splitting

## Security Notes
- Private keys are not handled by this app directly.
- Signing is delegated to wallet provider UI.
- For production, move external AI API calls server-side and store secrets in backend env vars.


## Kaspa Ecosystem References
- `https://github.com/K-Kluster/kaspa-js/`
- `https://github.com/kaspanet/silverscript`
- `https://kaspa.stream/`
- `https://kaspa.org/kaspium-v1-0-1-release/`
- `https://kasware.xyz`
