# ForgeOS

ForgeOS is a wallet-native Kaspa dashboard for running an AI-assisted trading agent simulation.

It includes:
- Wallet connection (Kasware + Kaspium + Kastle + Ghost Wallet + demo mode)
- Agent creation wizard
- Strategy templates (accumulation-first presets)
- Multi-agent portfolio panel with shared risk budget allocator
- Decision engine panel (Kelly, Monte Carlo, risk/confidence gating)
- PnL attribution panel and alert routing panel
- Runtime network selector in topbar (mainnet/testnet profiles with session reset guard)
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

## Researcher Bootstrap
- Repo-level agent rules: `AGENTS.md`
- Kaspa resource index: `docs/kaspa/links.md`
- Master AI prompts: `docs/ai/kaspa-elite-engineer-mode.md`

## Project Layout
- `forgeos-ui.tsx`: stable app export entry (re-exports `src/ForgeOS.tsx`)
- `src/ForgeOS.tsx`: root shell/topbar + view routing
- `src/components/ui/*`: base UI primitives (`Card`, `Btn`, `Inp`, etc.)
- `src/components/WalletGate.tsx`: wallet connect gate (Kasware/Kaspium/demo)
- `src/components/SigningModal.tsx`: signing confirmation modal
- `src/components/wizard/*`: agent setup/deploy flow
- `src/components/dashboard/*`: dashboard panels and core runtime UI
- `src/api/kaspaApi.ts`: Kaspa API calls
- `src/wallet/WalletAdapter.ts`: wallet mechanics (Kasware + Kaspium + Kastle + Ghost Wallet)
- `src/wallet/walletCapabilityRegistry.ts`: wallet capability registry + UI metadata (classes/capabilities/multi-output hints)
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

## Domain Validation
```bash
npm run domain:check
```

## Domain Watch Mode
```bash
npm run domain:watch
```

Optional watch overrides:
```bash
DOMAIN_WATCH_INTERVAL_MINUTES=5 DOMAIN_WATCH_MAX_CHECKS=48 npm run domain:watch
```

Production assets are generated in `dist/`.

## Environment Variables
Defined in `.env.example`.

Kaspa network:
- `VITE_KAS_API_MAINNET`
- `VITE_KAS_API_TESTNET`
- `VITE_KAS_API_FALLBACKS_MAINNET` (comma-separated backup endpoints)
- `VITE_KAS_API_FALLBACKS_TESTNET` (comma-separated backup endpoints)
- `VITE_KAS_EXPLORER_MAINNET`
- `VITE_KAS_EXPLORER_TESTNET`
- `VITE_KAS_WS_URL_MAINNET`
- `VITE_KAS_WS_URL_TESTNET`
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
- `SCHEDULER_AUTH_TOKEN` / `SCHEDULER_AUTH_TOKENS` (scheduler backend token auth)
- `SCHEDULER_AUTH_READS` (scheduler backend read protection toggle)
- `SCHEDULER_REDIS_URL` (scheduler Redis persistence + due-schedule backing)
- `SCHEDULER_REDIS_PREFIX`
- `SCHEDULER_SERVICE_TOKENS_JSON` (scoped service-token auth registry JSON)
- `SCHEDULER_JWT_HS256_SECRET` / `SCHEDULER_JWT_ISSUER` / `SCHEDULER_JWT_AUDIENCE` (HS256 JWT auth + claim checks)
- `SCHEDULER_OIDC_ISSUER` / `SCHEDULER_OIDC_DISCOVERY_TTL_MS` (OIDC discovery -> `jwks_uri`)
- `SCHEDULER_JWKS_URL` / `SCHEDULER_JWKS_CACHE_TTL_MS` (OIDC/JWKS JWT validation cache)
- `SCHEDULER_JWKS_ALLOWED_KIDS` / `SCHEDULER_JWKS_REQUIRE_PINNED_KID` (JWKS key pinning / rotation policy)
- `SCHEDULER_QUOTA_WINDOW_MS`, `SCHEDULER_QUOTA_READ_MAX`, `SCHEDULER_QUOTA_WRITE_MAX`, `SCHEDULER_QUOTA_TICK_MAX`
- `SCHEDULER_REDIS_AUTHORITATIVE_QUEUE` (Redis due-schedule + leader-lock mode)
- `SCHEDULER_REDIS_RESET_EXEC_QUEUE_ON_BOOT` (legacy reset behavior; defaults false for cold-start recovery)
- `SCHEDULER_REDIS_EXEC_LEASE_TTL_MS`, `SCHEDULER_REDIS_EXEC_REQUEUE_BATCH` (Redis execution queue lease/requeue tuning)
- `SCHEDULER_CALLBACK_IDEMPOTENCY_TTL_MS` (callback dedupe/idempotency retention)
- `SCHEDULER_LEADER_LOCK_RENEW_JITTER_MS`, `SCHEDULER_LEADER_ACQUIRE_BACKOFF_MIN_MS`, `SCHEDULER_LEADER_ACQUIRE_BACKOFF_MAX_MS` (leader fencing lock behavior)
- `VITE_KASTLE_TX_BUILDER_URL` / `VITE_KASTLE_TX_BUILDER_TOKEN` / `VITE_KASTLE_TX_BUILDER_TIMEOUT_MS` (automatic Kastle txJson builder endpoint)
- `VITE_KASTLE_TX_BUILDER_STRICT` (fail instead of fallback on builder error)

AI engine:
- `VITE_AI_API_URL` (default: Anthropic Messages API)
- `VITE_AI_MODEL`
- `VITE_ANTHROPIC_API_KEY` (required when calling Anthropic directly)
- `VITE_AI_FALLBACK_ENABLED` (`true` by default; deterministic conservative fallback if upstream AI is unavailable)
- `VITE_AI_OVERLAY_MODE` (`always` default; `adaptive` for scale/cost control, `off` disables overlay)
- `VITE_AI_OVERLAY_MIN_INTERVAL_MS` (AI overlay throttle per agent/state)
- `VITE_AI_OVERLAY_CACHE_TTL_MS` (cache reuse TTL for AI overlay)
- `VITE_AI_SOFT_TIMEOUT_MS` (soft AI timeout to protect cycle latency)
- `VITE_AI_MAX_ATTEMPTS` (retry attempts for transient AI transport/API failures)
- `VITE_QUANT_WORKER_ENABLED` (run quant+AI engine off main thread)
- `VITE_QUANT_WORKER_SOFT_TIMEOUT_MS` (worker timeout before fallback)

Monetization / quota:
- `VITE_FREE_CYCLES_PER_DAY` (free cycle limit, default `30`)
- `VITE_BILLING_UPGRADE_URL` (checkout URL used by billing panel CTA)
- `VITE_BILLING_CONTACT` (support label shown in billing panel)

Runtime override:
- Default profile is `VITE_KAS_NETWORK` (set to `mainnet` in `.env.example`).
- For production, configure network-scoped endpoint vars so runtime switching stays on the correct chain.
- Append `?network=mainnet` or `?network=testnet` to force a network profile without rebuilding.
- The app persists active selection in local storage key `forgeos.network`.

## How To Use
1. Launch app with `npm run dev`.
2. Connect wallet:
- `Kasware` for extension flow
- `Kastle` for extension flow
- `Ghost Wallet` for custom provider bridge flow
- `Tangem` for hardware bridge/manual txid flow
- `OneKey` for hardware bridge/manual txid flow
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
- `kastle` (extension)
- `ghost` (provider bridge probe on connect)
- `tangem` (hardware bridge/manual txid)
- `onekey` (hardware bridge/manual txid)
- `kaspium` (deep-link flow)
- Kasware connect path:
- `requestAccounts()`
- `getNetwork()`
- strict network/profile match when `VITE_KAS_ENFORCE_WALLET_NETWORK=true`
- Kasware send path:
- `sendKaspa(toAddress, sompi)`
- Kastle send path:
- `sendKaspa(toAddress, sompi)`
- Kastle raw multi-output path (feature-flagged):
- `signAndBroadcastTx(networkId, txJson)` via adapter capability detection
- txJson comes from an injected builder bridge (`window.__FORGEOS_KASTLE_BUILD_TX_JSON__`) or manual operator paste prompt
- Ghost Wallet send path:
- provider `transact(outputs, fee?, inputs?)` bridge call (Forge.OS uses multi-output when treasury-combined send is supported/eligible)
- Tangem / OneKey send path:
- external sign/broadcast in hardware app/device with manual txid handoff back into Forge.OS
- Kaspium connect path:
- user enters address matching configured network prefixes
- adapter stores session with provider `kaspium`
- Kaspium send path:
- deep-link generated from `KASPIUM_DEEP_LINK_SCHEME` with `kaspa:` URI fallback
- app prompts user to paste broadcast `txid`
- `txid` format is validated before acceptance
- Demo mode:
- simulates transaction signatures/txids locally

## Execution Modes
- `manual`: every action requires signature
- `autonomous`: auto-signs actions below threshold; above threshold queues for manual sign
- `notify`: decisions generated, no execution broadcast
- `accumulate-only`: when `VITE_ACCUMULATE_ONLY=true`, non-accumulate actions are forced to hold
- safety override: when decision source is fallback, auto-approve is disabled for that cycle and manual sign path is required

## Fee Routing
Defined in `src/constants.ts`:
- `FEE_RATE` (env: `VITE_FEE_RATE`, default `0.20`)
- `TREASURY_SPLIT` (env: `VITE_TREASURY_SPLIT`, default `0.30`)
- `AGENT_SPLIT = 1 - TREASURY_SPLIT`
- Treasury and accumulation addresses are network-specific via env vars.

Dashboard logs and treasury panel display split accounting each cycle.

## AI Engine Notes
`src/quant/runQuantEngine.ts` supports a hybrid pattern:
- Deterministic local quant core (primary decision engine: features/regime/risk/Kelly)
- Optional real AI overlay (bounded by quant-core risk envelope; adaptive or always-on)

AI transport supports two patterns:
- Direct Anthropic call (`VITE_AI_API_URL` points to `api.anthropic.com`):
- requires `x-api-key` (`VITE_ANTHROPIC_API_KEY`)
- requires `anthropic-version` header
- Backend proxy call (`VITE_AI_API_URL` points to your server):
- app sends `{ prompt, agent, kasData }`
- server returns either `{ decision }` or direct decision JSON

Recommendation for production:
- Keep AI keys server-side.
- Route AI requests through backend proxy.
- Starter queue/rate-limit proxy example: `server/ai-proxy/index.mjs`
- Scheduler shared-cache + auth/JWT/JWKS/quotas/Redis-authoritative (due + execution queue) starter example: `server/scheduler/index.mjs`
- Kastle tx-builder starter example: `server/tx-builder/index.mjs`
- Keep decision sanitization enabled (default) and enforce wallet-side signing.
- For maximum AI involvement use `VITE_AI_OVERLAY_MODE=always`; for scale/cost control use `adaptive`.
- For strict real-AI-only operation, also set `VITE_AI_FALLBACK_ENABLED=false` (engine will error if AI transport is unavailable).

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
- Base path auto-mode:
- if `public/CNAME` exists, use root base path (`/`)
- otherwise use project base path (`/${{ github.event.repository.name }}/`)
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
npm run domain:check
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
- GitHub Pages `InvalidDNSError`:
- use `docs/ops/custom-domain.md` and verify delegation/records with `npm run domain:check`

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
