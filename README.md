# FORGE.OS

FORGE.OS is a **Kaspa-native quant trading control plane** with wallet-native signing, real AI overlay, deterministic quant guardrails, and production-oriented runtime controls.

<!-- If you're reading source, you're in the right place. FORGE.OS is built for operators, not just screenshots. -->

It is built for operators who want:
- Kaspa-first execution (UTXO-aware, non-custodial signing)
- Real AI decisioning bounded by quant math and hard risk controls
- Multi-agent allocation with shared portfolio risk budgets
- Transparent queueing, receipts, attribution, and alerting
- A path from browser prototype to backend-scaled orchestration

<details>
<summary><strong>Quick Jump (Operator Index)</strong></summary>

- [Quick Start](#quick-start)
- [Mainnet / Testnet Runtime Switching](#mainnet--testnet-runtime-switching)
- [Wallet Support (Current)](#wallet-support-current)
- [Transaction Lifecycle + Receipts](#transaction-lifecycle--receipts)
- [Scaling Modules (Backend Starters)](#scaling-modules-backend-starters)
- [Testing & Validation](#testing--validation)
- [Production Readiness Checklist](#production-readiness-checklist)

</details>

## Why FORGE.OS Is Different

Most “AI trading dashboards” stop at UI. FORGE.OS implements the actual runtime stack:
- **Wallet-native authorization** (Kasware, Kaspium, Demo) with no seed storage
- **Quant core first** (regime, volatility, Kelly/risk caps, EV sizing)
- **AI overlay second** (bounded by quant envelope; can run every cycle)
- **Execution lifecycle tracking** (submitted -> broadcasted -> pending confirm -> confirmed/failed/timeout)
- **Treasury fee routing** with on-chain payout support
- **Multi-agent portfolio allocator** with shared capital/risk constraints
- **Production-scale starters**: AI proxy + scheduler/shared market cache

## System Architecture (Text)

```text
WalletGate (Kasware / Kaspium / Demo)
  -> Wizard (agent config + strategy template)
  -> Dashboard (operator control plane)
     -> Kaspa Feed (price / blockdag / balance / utxos)
     -> Quant Engine Client (Web Worker preferred)
        -> Deterministic Quant Core (regime, vol, Kelly, EV, risk)
        -> Real AI Overlay (always/adaptive, bounded by quant core)
        -> Guarded Fusion (risk envelope + execution constraints)
     -> Execution Queue (signing lifecycle + receipt lifecycle)
     -> Treasury Payout (on-chain fee transfer, queue fallback)
     -> Alerts (Telegram / Discord / email-webhook)
     -> PnL Attribution (estimated + receipt-aware hybrid telemetry)

Scale Path (Server)
  -> AI Proxy (queueing, rate limits, retries, /health, /metrics)
  -> Scheduler + Shared Market Cache (multi-agent cycle dispatch, /metrics)
```

## Current Feature Set

### Core Runtime
- Wallet-gated access (`Kasware`, `Kaspium`, `Demo`)
- Mainnet-first boot with runtime network switching (`?network=mainnet|testnet`)
- Agent setup wizard with strategy templates:
  - DCA accumulator
  - Trend
  - Mean reversion
  - Volatility breakout
- Quant + AI decision engine with bounded fusion
- Web Worker quant/AI execution path (with controlled fallback)
- Accumulate-only execution discipline support

### Portfolio / Ops
- Multi-agent portfolio view with shared risk budget + capital allocator
- Action queue with manual sign / autonomous gating flows
- Receipt polling and lifecycle reconciliation for broadcast txs
- PnL attribution panel (signal quality / slippage / fees / timing / missed fills)
- Alerts panel (Telegram / Discord / email-webhook)
- Treasury panel + on-chain treasury payout flow
- Wallet panel (balance, UTXO view, withdraw tools)

### Reliability / Testing / Deployment
- Typecheck + lint + unit tests + perf tests + build + smoke validation
- Playwright E2E suite (wallet gate, queue sign/reject, treasury second tx, network switch, controls)
- GitHub Pages deploy + domain validation tooling
- AI proxy and scheduler backend starters with `/health` and Prometheus `/metrics`

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

### Strict Validation (Frontend + Build Integrity)
```bash
npm run ci
```

### E2E (Playwright)
```bash
npm run test:e2e
```

<details>
<summary><strong>Boot Sequence (Recommended Dev Flow)</strong></summary>

```bash
npm install
npm run ci
npm run dev
```

Then in a separate terminal:

```bash
npm run test:e2e
```

</details>

### Build / Preview
```bash
npm run build
npm run preview
```

## Environment (Overview)

Create `.env` from `.env.example`.

### Kaspa Network / RPC
- `VITE_KAS_API_MAINNET`
- `VITE_KAS_API_TESTNET`
- `VITE_KAS_API_FALLBACKS_MAINNET`
- `VITE_KAS_API_FALLBACKS_TESTNET`
- `VITE_KAS_EXPLORER_MAINNET`
- `VITE_KAS_EXPLORER_TESTNET`
- `VITE_KAS_WS_URL_MAINNET`
- `VITE_KAS_WS_URL_TESTNET`
- `VITE_KAS_NETWORK` (mainnet default in `.env.example`)
- `VITE_KAS_ENFORCE_WALLET_NETWORK`
- `VITE_KASPIUM_DEEP_LINK_SCHEME`

### Wallet / Execution / Treasury
- `VITE_ACCUMULATE_ONLY`
- `VITE_LIVE_EXECUTION_DEFAULT`
- `VITE_FEE_RATE`
- `VITE_TREASURY_SPLIT`
- `VITE_TREASURY_ADDRESS_MAINNET`
- `VITE_TREASURY_ADDRESS_TESTNET`
- `VITE_ACCUMULATION_ADDRESS_MAINNET`
- `VITE_ACCUMULATION_ADDRESS_TESTNET`
- `VITE_TREASURY_FEE_ONCHAIN_ENABLED`

### AI / Quant Runtime
- `VITE_AI_API_URL`
- `VITE_AI_MODEL`
- `VITE_ANTHROPIC_API_KEY` (frontend direct-call only; **backend proxy preferred**)
- `VITE_AI_FALLBACK_ENABLED`
- `VITE_AI_OVERLAY_MODE` (`always` default)
- `VITE_AI_OVERLAY_MIN_INTERVAL_MS`
- `VITE_AI_OVERLAY_CACHE_TTL_MS`
- `VITE_AI_SOFT_TIMEOUT_MS`
- `VITE_AI_MAX_ATTEMPTS`
- `VITE_QUANT_WORKER_ENABLED`
- `VITE_QUANT_WORKER_SOFT_TIMEOUT_MS`

### Quota / Monetization / Runtime Cadence
- `VITE_FREE_CYCLES_PER_DAY`
- `VITE_BILLING_UPGRADE_URL`
- `VITE_BILLING_CONTACT`
- `VITE_AUTO_CYCLE_SECONDS`

## Mainnet / Testnet Runtime Switching

FORGE.OS is **mainnet-first**.

Runtime network selection precedence:
1. `?network=` query param
2. runtime override (`localStorage`, guarded)
3. `VITE_KAS_NETWORK`
4. fallback `mainnet`

Examples:
- `https://forge-os.xyz/?network=mainnet`
- `https://forge-os.xyz/?network=testnet`

Address validation, explorer links, treasury routing, and accumulation vault routing all follow the active profile.

## Wallet Support (Current)

### Kasware (Browser Extension)
- Extension connect (`requestAccounts`, `getNetwork`)
- Network/profile enforcement (configurable)
- Send path (`sendKaspa`)
- Stronger timeout/error normalization in adapter
- Native multi-output send: **no** (single-recipient send path)
- Future path: PSKT/raw tx signing route may enable combined treasury output

### Kaspium (Mobile Deep-Link Flow)
- Mainnet-first connect behavior (testnet still optional)
- Deep-link transfer generation
- Manual `txid` handoff for receipt tracking
- Address-prefix validation (`kaspa:` / `kaspatest:`)
- Native multi-output send: **no** (current deep-link flow is single-recipient + manual `txid`)

### Kastle (Browser Extension)
- Injected `window.kastle` provider support in WalletGate and runtime adapter
- Connect/account/network checks with mainnet/testnet profile enforcement
- Send path (`sendKaspa`) wired into Forge.OS queue/signing lifecycle
- Wallet selector uses the real Kastle logo in UI
- Native multi-output send: **conditional** via `signAndBroadcastTx(networkId, txJson)` when the `VITE_KASTLE_RAW_TX_ENABLED` raw-tx path is enabled and a txJson bridge/manual txJson input is available

### Ghost Wallet (Browser Extension / Provider Bridge)
- Custom `kaspa:*` provider event bridge support in WalletGate and runtime adapter
- Connect/account/network checks with profile enforcement
- `transact` send path wired into Forge.OS queue/signing lifecycle
- Wallet selector uses the real Ghost Wallet logo in UI
- Native multi-output send: **yes** (`transact` accepts an outputs array; Forge.OS combines treasury fee output when eligible)

### Tangem (Hardware / Bridge Flow)
- Manual bridge connect (address pairing) in WalletGate
- External sign/broadcast flow with txid handoff back into Forge.OS
- Preserves hardware custody model (no private key handling in Forge.OS)
- Native multi-output send: **bridge/manual dependent**

### OneKey (Hardware / Bridge Flow)
- Manual bridge connect (address pairing) in WalletGate
- External sign/broadcast flow with txid handoff back into Forge.OS
- Preserves hardware custody model (no private key handling in Forge.OS)
- Native multi-output send: **bridge/manual dependent**

### Demo Mode
- Local tx/txid simulation for UI and testing workflows

## Treasury Routing

Mainnet treasury is pinned in code and validated at startup.

**Pinned mainnet treasury address:**
- `kaspa:qpv7fcvdlz6th4hqjtm9qkkms2dw0raem963x3hm8glu3kjgj7922vy69hv85`

Notes:
- Treasury micro-fee payout is sent as a **separate tx** for wallets without native multi-output support.
- Ghost Wallet can combine action + treasury outputs into a single transaction when the tx shape is eligible.
- Kastle can also use a combined treasury multi-output path when the feature-flagged raw-tx route is enabled and a raw txJson source is available.
- If treasury payout fails or is rejected, it is queued as a `TREASURY_FEE` action.
- Spendable balance calculations reserve treasury payout + network fee to avoid overspend.

## Transaction Lifecycle + Receipts

Queue items now track both:

### Signing Lifecycle
- `pending`
- `signing`
- `signed`
- `rejected`
- `failed`

### Receipt Lifecycle
- `submitted`
- `broadcasted`
- `pending_confirm`
- `confirmed`
- `failed`
- `timeout`

FORGE.OS polls Kaspa transaction endpoints with backoff and persists receipt telemetry, including:
- `submitted_ts`
- `broadcast_ts`
- `confirm_ts`
- `confirmations`
- `failure_reason`
- price snapshot telemetry at broadcast/confirm when available

This feeds receipt-aware attribution and improves operator trust in execution state.

## Real AI + Quant Intelligence

FORGE.OS uses a **quant-first, AI-bounded** model:
- Deterministic quant core computes regime, volatility, risk score, EV, Kelly cap, SL/TP, and sizing
- Real AI overlay refines decisions using quant context
- Guarded fusion enforces risk limits and can block unsafe AI actions

Production guidance:
- Prefer backend proxy (`VITE_AI_API_URL`) for AI calls
- Keep API keys server-side
- Use `VITE_AI_OVERLAY_MODE=always` for max AI involvement
- Use `VITE_AI_FALLBACK_ENABLED=false` if you require strict AI availability (no silent quant fallback)

## Scaling Modules (Backend Starters)

### AI Proxy (`server/ai-proxy`)
Run:
```bash
npm run ai:proxy
```

Provides:
- queueing
- per-user rate limiting
- transient retry/backoff
- concurrency caps
- `GET /health`
- `GET /metrics` (Prometheus)

Prometheus metrics include:
- queue depth / in-flight / saturation state
- HTTP response counters
- upstream success / error / retry counters
- proxy latency histogram
- upstream latency histogram

### Scheduler + Shared Market Cache (`server/scheduler`)
Run:
```bash
npm run scheduler:start
```

Provides:
- multi-agent registry (in-memory by default, Redis-backed persistence optional)
- server-side cycle scheduler queue with concurrency caps (Redis-authoritative execution queue when enabled)
- shared market snapshot cache (price/blockdag/balance) with TTL + in-flight dedupe
- optional token/service-token/JWT/JWKS auth with scopes + per-user quotas
- optional Redis-backed agent persistence + due schedule (degraded startup if Redis unavailable)
- optional Redis-authoritative due schedule + Redis execution queue + leader lock fencing + per-agent/task leases for multi-instance safety
- callback idempotency keys + fence-token propagation to downstream consumers (`X-ForgeOS-*` headers and payload metadata)
- `GET /health`
- `GET /metrics` (Prometheus)
- `POST /v1/agents/register`
- `GET /v1/market-snapshot?address=...`
- `POST /v1/scheduler/tick`

This is the bridge toward moving orchestration out of the browser.

### Tx Builder (`server/tx-builder`)
Run:
```bash
npm run tx-builder:start
```

Provides:
- backend tx-builder endpoint for automatic `Kastle` `signAndBroadcastTx(..., txJson)` flows
- command-hook mode (`TX_BUILDER_COMMAND`) for local Kaspa tx-builder integration
- upstream proxy mode (`TX_BUILDER_UPSTREAM_URL`)
- `GET /health`
- `GET /metrics`

Frontend integration:
- `VITE_KASTLE_TX_BUILDER_URL`
- `VITE_KASTLE_TX_BUILDER_TOKEN` (optional)

<details>
<summary><strong>Hidden Ops Notes (GitHub-friendly collapsible)</strong></summary>

- The browser app is the **operator control plane**; it is not intended to be an HFT execution engine.
- For real scale, pair `server/ai-proxy` and `server/scheduler` with Redis/Postgres plus distributed scheduler locking.
- Ghost Wallet supports a treasury-combined multi-output path. Kastle has a feature-flagged raw-tx combined path (`signAndBroadcastTx`) when a txJson source is provided. Other wallets use the separate treasury payout tx fallback.
- Exact realized attribution still improves significantly once fill/confirmation receipts are ingested from a backend execution service.

</details>

## Testing & Validation

### Local Validation Commands
```bash
npm run lint
npm run typecheck
npm run test:run
npm run test:perf
npm run build
npm run ci
npm run test:e2e
```

### E2E Coverage (Playwright)
Current flows include:
- demo wallet gate
- mocked Kasware wallet gate
- queue reject/sign flow
- treasury second-tx queue/sign flow
- network switching reset + URL update
- pause / resume / kill-switch controls

<details>
<summary><strong>CI Notes (Why E2E Is Separate)</strong></summary>

- `npm run ci` focuses on fast correctness gates (lint/typecheck/unit/build/smoke/domain).
- Playwright E2E runs in a dedicated GitHub Actions job for clearer failures and artifact uploads.
- The Playwright config uses strict port binding and CI-specific server reuse behavior for stability.

</details>

## Deployment / Domain

### GitHub Pages
- Workflow: `.github/workflows/deploy-pages.yml`
- Pages source should be **GitHub Actions** (not branch mode)
- Custom domain: `forge-os.xyz`

### Domain Tooling
```bash
npm run verify:domain
npm run domain:check
npm run domain:watch
```

## Production Readiness Checklist

1. Configure network-scoped mainnet/testnet Kaspa endpoints (`*_MAINNET`, `*_TESTNET`).
2. Set `VITE_KAS_ENFORCE_WALLET_NETWORK=true` for stricter wallet/profile matching.
3. Verify treasury and accumulation addresses per network.
4. Use backend AI proxy; do not expose production AI secrets in browser.
5. Run `npm run ci` and `npm run test:e2e`.
6. Ensure GitHub Actions `CI` and `Deploy Pages` are green.
7. Validate real wallet flows on production:
   - Kasware connect/sign/send
   - Kaspium deep-link + `txid` confirmation
   - treasury fee payout destination and queue fallback behavior

## Repo Map (High Signal)

- `src/ForgeOS.tsx` — root shell + topbar + network switch + multi-agent session state
- `src/components/WalletGate.tsx` — wallet connect gate (Kasware/Kaspium/demo)
- `src/components/wizard/*` — agent setup + strategy templates + deploy flow
- `src/components/dashboard/*` — runtime UI panels
- `src/components/dashboard/hooks/*` — dashboard runtime hooks (feed, lifecycle, queue, treasury, alerts, allocator)
- `src/quant/*` — quant math, quant core, AI fusion engine, worker client
- `src/wallet/WalletAdapter.ts` — wallet transport mechanics and safety checks
- `src/tx/queueTx.ts` — tx validation/build/broadcast helpers
- `src/runtime/*` — lifecycle, errors, persistence, alerts, quotas, portfolio state
- `src/api/kaspaApi.ts` — Kaspa REST integration + receipt lookups
- `server/ai-proxy/*` — AI proxy starter + metrics
- `server/scheduler/*` — scheduler/shared cache starter + metrics
- `tests/*` — unit, perf, and E2E suites

## Security Guardrails

- No seed phrase or private key storage in app/backend logic
- Wallet-side signing only (Kasware / Kaspium)
- Kaspa prefix validation enforced (`kaspa:` / `kaspatest:`)
- Quant guardrails constrain AI decisions before execution
- Explicit lifecycle states and error taxonomy for queue/receipt handling

<details>
<summary><strong>Threat Model Snapshot</strong></summary>

- **Do not** move seed/private key handling into frontend or backend services.
- Treat all AI outputs as untrusted until validated by quant/risk envelopes.
- Keep network profile, address prefix, and treasury routing checks explicit and testable.
- Prefer backend AI proxy for secrets, observability, and rate limiting.

</details>

## Core Docs

- `README.dev.md` — developer architecture and implementation notes
- `docs/kaspa/links.md` — curated Kaspa resource index
- `docs/ai/kaspa-elite-engineer-mode.md` — AI engineering brief
- `docs/ops/custom-domain.md` — custom domain ops runbook
- `AGENTS.md` — repo operating rules for agents/contributors

## License / Notes

This repo is designed as a **Kaspa-first operator platform** and a production-minded foundation for wallet-native quant automation.

If you are extending wallets/integrations, keep the repo standards intact:
- UTXO-first thinking
- non-custodial signing boundaries
- no insecure key handling
- network-aware address validation
