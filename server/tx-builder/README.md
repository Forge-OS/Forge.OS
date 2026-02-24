# Forge-OS Tx Builder (Kastle Raw-Tx Builder Starter)

Backend tx-builder starter for automatic `Kastle` `signAndBroadcastTx(networkId, txJson)` flows.

What it does:
- Accepts normalized Forge-OS tx-build requests for Kastle multi-output sends
- Returns `{ txJson }` for the frontend to pass into `kastle.signAndBroadcastTx(...)`
- Supports local and bridged integration modes:
  - local `kaspa-wasm` UTXO constructor (`TX_BUILDER_LOCAL_WASM_ENABLED=true`)
  - command hook (`TX_BUILDER_COMMAND`) for a local Kaspa tx builder script/service
  - upstream proxy (`TX_BUILDER_UPSTREAM_URL`) to a remote builder
- Optional auth via shared tokens
- `/health` + `/metrics`

## Endpoint
- `POST /v1/kastle/build-tx-json`

Request shape:
```json
{
  "wallet": "kastle",
  "networkId": "mainnet",
  "fromAddress": "kaspa:...",
  "outputs": [
    { "address": "kaspa:...", "amountKas": 1.23 },
    { "address": "kaspa:...", "amountKas": 0.06 }
  ],
  "purpose": "ACCUMULATE / treasury-combined"
}
```

Response shape:
```json
{
  "txJson": "{...serializeToSafeJSON...}",
  "meta": {
    "mode": "command",
    "wallet": "kastle",
    "networkId": "mainnet",
    "outputs": 2,
    "fromAddress": "kaspa:..."
  }
}
```

`meta.mode` may be `local_wasm`, `command`, `upstream`, or `manual`.

## Run
```bash
node server/tx-builder/index.mjs
```

With command hook:
```bash
export TX_BUILDER_AUTH_TOKEN=super-secret
export TX_BUILDER_COMMAND='node /path/to/your/kaspa-tx-builder.js'
node server/tx-builder/index.mjs
```

With local `kaspa-wasm` builder (automatic UTXO fetch + txJson construction):
```bash
export TX_BUILDER_LOCAL_WASM_ENABLED=true
export TX_BUILDER_KAS_API_MAINNET=https://api.kaspa.org
export TX_BUILDER_KAS_API_TESTNET=https://api-tn10.kaspa.org
node server/tx-builder/index.mjs
```

With bundled HTTP bridge command (real `TX_BUILDER_COMMAND` executable):
```bash
export TX_BUILDER_COMMAND='node server/tx-builder/commands/kastle-http-bridge-command.mjs'
export KASTLE_TX_BUILDER_COMMAND_UPSTREAM_URL=http://127.0.0.1:9001/v1/build
export KASTLE_TX_BUILDER_COMMAND_UPSTREAM_TOKEN=upstream-secret
node server/tx-builder/index.mjs
```

With upstream proxy:
```bash
export TX_BUILDER_UPSTREAM_URL=http://127.0.0.1:9001/v1/build
export TX_BUILDER_UPSTREAM_TOKEN=upstream-secret
node server/tx-builder/index.mjs
```

## Forge-OS Frontend Config
Set in `.env` for the web app:
- `VITE_KASTLE_RAW_TX_ENABLED=true`
- `VITE_KASTLE_TX_BUILDER_URL=http://127.0.0.1:8795/v1/kastle/build-tx-json`
- `VITE_KASTLE_TX_BUILDER_TOKEN=super-secret` (if enabled)

Optional:
- `VITE_KASTLE_TX_BUILDER_STRICT=true` (fail instead of bridge/manual fallback if builder errors)
- `VITE_KASTLE_TX_BUILDER_TIMEOUT_MS=12000`
- `VITE_KASTLE_RAW_TX_MANUAL_JSON_PROMPT_ENABLED=false` (disable manual fallback)

## Key Env Vars
- `PORT` (default `8795`)
- `TX_BUILDER_ALLOWED_ORIGINS` (default `*`)
- `TX_BUILDER_AUTH_TOKEN` / `TX_BUILDER_AUTH_TOKENS`
- `TX_BUILDER_AUTH_READS` (protect `GET /metrics`)
- `TX_BUILDER_UPSTREAM_URL`, `TX_BUILDER_UPSTREAM_TOKEN`
- `TX_BUILDER_LOCAL_WASM_ENABLED`
- `TX_BUILDER_LOCAL_WASM_JSON_KIND` (`transaction` or `pending`)
- `TX_BUILDER_LOCAL_WASM_COIN_SELECTION` (`auto`, `largest-first`, `smallest-first`, `oldest-first`, `newest-first`)
- `TX_BUILDER_LOCAL_WASM_MAX_INPUTS`
- `TX_BUILDER_LOCAL_WASM_ESTIMATED_NETWORK_FEE_SOMPI`
- `TX_BUILDER_LOCAL_WASM_PER_INPUT_FEE_BUFFER_SOMPI`
- `TX_BUILDER_LOCAL_WASM_EXTRA_SAFETY_BUFFER_SOMPI`
- `TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_MODE` (`request_or_fixed`, `fixed`, `output_bps`, `per_output`)
- `TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_SOMPI` / `TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_OUTPUT_BPS` / `TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_PER_OUTPUT_SOMPI`
- `TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_MIN_SOMPI` / `TX_BUILDER_LOCAL_WASM_PRIORITY_FEE_MAX_SOMPI`
- `TX_BUILDER_LOCAL_WASM_PREFER_CONSOLIDATION`
- `TX_BUILDER_KAS_API_BASE` (legacy shared base) or `TX_BUILDER_KAS_API_MAINNET` / `TX_BUILDER_KAS_API_TESTNET`
- `TX_BUILDER_KAS_API_TIMEOUT_MS`
- `TX_BUILDER_COMMAND`
- `TX_BUILDER_COMMAND_TIMEOUT_MS`
- `KASTLE_TX_BUILDER_COMMAND_UPSTREAM_URL`, `KASTLE_TX_BUILDER_COMMAND_UPSTREAM_TOKEN`
- `KASTLE_TX_BUILDER_COMMAND_TIMEOUT_MS` (for bundled command adapter)
- `TX_BUILDER_REQUEST_TIMEOUT_MS`
- `TX_BUILDER_ALLOW_MANUAL_TXJSON` (debug/manual mode only)

## Command Hook Contract
If `TX_BUILDER_COMMAND` is set, Forge-OS writes the request JSON to the command's stdin.

The command must write JSON to stdout:
```json
{ "txJson": "{...serializeToSafeJSON...}" }
```

Non-zero exit code is treated as a build failure.

## Local WASM Policy Notes
- The local `kaspa-wasm` mode uses a dedicated fee/coin-selection policy module (`server/tx-builder/localPolicy.mjs`).
- It selects UTXOs before invoking `Generator`, applies safety buffers for estimated network cost + per-input mass, and exposes policy metadata in the build response.
- If policy-selected inputs fail to produce a pending transaction, the builder conservatively retries with all normalized UTXOs (same priority fee) before failing.
