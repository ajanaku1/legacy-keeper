# Clean-clone and production-shaped setup

This guide reproduces the current wallet-scoped LegacyKeeper application on
Sepolia. It does not treat KeeperHub webhook acceptance as success: every write
must settle, have a successful receipt, emit the expected event, and change the
expected contract state.

## Prerequisites

- Node.js 20 or 22 and npm
- A funded Sepolia burner wallet
- A Sepolia RPC endpoint
- A KeeperHub organization API key (`kh_...`)
- A user-scoped KeeperHub webhook key (`wfb_...`)
- PostgreSQL for activity and Telegram state
- Optional for Telegram: a BotFather bot and a public HTTPS application URL

Use only testnet keys. Never place a mainnet key or seed phrase in this project.

## 1. Install and configure

```bash
git clone https://github.com/ajanaku1/legacy-keeper.git
cd legacy-keeper
nvm use
npm ci
npm --prefix dashboard ci
cp .env.example .env
```

Required for the wallet-scoped application:

| Variable | Purpose |
|---|---|
| `KEEPERHUB_API_KEY` | Workflow creation, validation, export, and inspection |
| `KEEPERHUB_WEBHOOK_API_KEY` | Server-to-workflow execution |
| `SEPOLIA_RPC_URL` | Contract reads and independent receipt/state verification |
| `DEPLOYER_PRIVATE_KEY` | Testnet factory deployment only |
| `DATABASE_URL` | Owner activity and Telegram state |
| `NEXT_PUBLIC_APP_URL` | Browser and Telegram callback origin |

The deploy steps below fill the factory and workflow IDs. `TELEGRAM_CHAT_ID` is
not part of production wallet-scoped delivery; it belongs only to the optional
legacy standalone agent.

## 2. Verify the clone before remote changes

```bash
npm run compile
npm test
npm run test:agent
npm run test:dashboard
npm --prefix dashboard run typecheck
npm --prefix dashboard run build
```

## 3. Deploy the factory

```bash
npm run deploy:sepolia
```

Copy the printed value into `.env`:

```dotenv
NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS=0x...
```

`LegacyKeeperFactory` deploys and registers exactly one configured plan for each
owner. A newly connected wallet creates its own plan through onboarding; do not
set one environment-wide plan address for the dashboard.

## 4. Publish the wallet-scoped KeeperHub workflows

Review `workflows/wallet-scoped-definitions.ts`, then:

```bash
npm run workflows:deploy -- --wallet-scoped
```

This creates or updates and validates the four workflows while leaving new ones
disabled. After reviewing `workflows/exported/` and the printed IDs, enabling is
an explicit remote-state change:

```bash
npm run workflows:deploy -- --wallet-scoped --enable
```

Copy the resulting IDs into `.env`:

```dotenv
KEEPERHUB_PLAN_WORKFLOW_ID=
KEEPERHUB_CONFIGURATION_WORKFLOW_ID=
KEEPERHUB_HEARTBEAT_WORKFLOW_ID=
KEEPERHUB_PANIC_WORKFLOW_ID=
```

Each workflow resolves `factory.planOf(owner)` and rejects a requested plan that
does not match before it sends a signed write.

## 5. Apply PostgreSQL migrations

```bash
npm --prefix dashboard run db:migrate
```

The schema stores Telegram accounts, active wallet links, one-time link
sessions, delivery state, wallet-scoped activity counters, and immutable attempt
entries. Contracts remain authoritative for ownership, beneficiaries, timing,
and recovery.

## 6. Configure Telegram (optional)

Set:

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_ACTION_SECRET=
TELEGRAM_SESSION_SECRET=
NEXT_PUBLIC_APP_URL=https://your-app.example
```

Use independent random values for the action and session secrets. The session
secret must be at least 32 bytes.

Register the webhook:

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${NEXT_PUBLIC_APP_URL}/api/telegram/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

The bot accepts wallet linking only in a private chat. The final link requires
an owner EIP-712 signature and enforces two active wallets per Telegram user.

## 7. Run the dashboard

```bash
npm --prefix dashboard run dev
```

Open `http://127.0.0.1:3000` and connect a Sepolia wallet.

For a wallet with no plan:

1. Complete timing, beneficiaries, recovery, and optional assets.
2. Review the exact configuration.
3. Sign the factory intent.
4. Wait for KeeperHub settlement and independent creation proof.
5. Open the verified dashboard.

Check-in becomes available after the contract's rolling 24-hour cooldown. The
wallet signs typed data but sends no transaction; KeeperHub relays it and the UI
reports success only after `HeartbeatRecorded` and an advanced heartbeat time.

Settings supports signed updates to beneficiaries, timing, recovery, and tracked
assets. Activity is owner-scoped and paginated five attempts at a time.

## 8. Link Telegram

1. Open Settings → Telegram alerts → Connect Telegram.
2. Start the private bot deep link.
3. Return to the application when the Telegram user is detected.
4. Sign wallet ownership.
5. Send a test alert.

The connected state is restored with a signed HttpOnly wallet-session cookie.
Unlinking from Settings requires a wallet signature; `/unlink` in Telegram
requires a short-lived one-time callback. Neither path changes the onchain plan.

`/evacuate` only opens the secure recovery entry. The registered recovery wallet
must still connect and sign before KeeperHub can submit an evacuation.

## 9. Acceptance and verification

```bash
./verify.sh
npm --prefix dashboard run test:e2e
```

Phase 7 specifically uses:

```bash
npm --prefix dashboard run test:e2e -- e2e/ui-polish.spec.ts
```

Live Sepolia facts must be checked through the RPC/receipt verification path,
not inferred from source or an MCP `completed` status.

## Troubleshooting

### Webhook returns 401 or 403

Use the user-scoped `wfb_` key for `KEEPERHUB_WEBHOOK_API_KEY`. The organization
`kh_` key is for MCP operations.

### KeeperHub says completed but the app reports failure

`completed` describes settlement, not success. Inspect `result.success`, the
transaction hash, receipt status, expected event, and resulting state.

### A retry repeats a terminal failure

Reuse an idempotency key only while the outcome is unknown or still in progress.
After a confirmed failure, use a new per-attempt key.

### Telegram is not restored after refresh

Verify the wallet and chain match the signed server session, cookies are allowed,
`TELEGRAM_SESSION_SECRET` is stable across deployments, and production uses
HTTPS. Missing or invalid sessions deliberately return no Telegram metadata.

### Activity is empty

Confirm migrations ran, `DATABASE_URL` is available to the server, the connected
owner matches the stored lowercase owner, and the relevant action reached the
verified route before the activity write.

## Legacy starter script

`starter/setup.sh` remains as the historical single-contract KeeperHub proof
used by the original submission. It is useful for reproducing those evidence
transactions, but it is not the current wallet-scoped production bootstrap.
