# Clean-clone tutorial

The starter takes a new clone to a KeeperHub-sponsored Sepolia heartbeat. The
script does not treat webhook acceptance as success. It waits for KeeperHub,
checks the transaction receipt, and confirms that `lastHeartbeat` advanced.

## Prerequisites

- Node.js 18, 20, or 22
- npm
- A funded Sepolia burner wallet
- A KeeperHub organization API key (`kh_...`)
- A user-scoped KeeperHub webhook key (`wfb_...`)
- A Telegram integration in the same KeeperHub organization
- A Telegram chat ID for workflow notifications

Use a burner wallet with Sepolia ETH. Do not put a mainnet key in this project.

## 1. Clone and create the environment file

```bash
git clone https://github.com/ajanaku1/legacy-keeper.git
cd legacy-keeper
nvm use
./starter/setup.sh
```

The first run creates `.env` and stops. Add these values:

| Variable | Purpose |
|---|---|
| `KEEPERHUB_API_KEY` | Aggregate MCP access for workflow creation and execution inspection |
| `KEEPERHUB_WEBHOOK_API_KEY` | Bearer credential for the heartbeat and evacuation webhooks |
| `SEPOLIA_RPC_URL` | Receipt and resulting-state verification |
| `DEPLOYER_PRIVATE_KEY` | Sepolia burner that owns the new contract and signs heartbeat typed data |
| `TELEGRAM_CHAT_ID` | Workflow notification destination |

Leave `LEGACY_KEEPER_ADDRESS` empty to deploy a new contract. To reuse a contract
owned by the burner key, set its address before the second run.

KeeperHub API keys come from **Settings > API Keys**. The workflow webhook uses:

```http
Authorization: Bearer wfb_your_webhook_key
Content-Type: application/json
```

The MCP client handles the required protocol sequence: `initialize`,
`notifications/initialized`, then `tools/call`. It reads `Mcp-Session-Id` from
the response header.

## 2. Run the complete path

```bash
./starter/setup.sh
```

Review the transaction and workflow warning, then confirm. For CI or an
already-reviewed testnet environment, use:

```bash
./starter/setup.sh --yes
```

The script runs these operations in order:

1. Installs the root and dashboard lockfiles with `npm ci`.
2. Compiles the contract and runs contract, agent, and dashboard tests.
3. Deploys `LegacyKeeper.sol` to Sepolia when no address is configured.
4. Writes the public contract address back to `.env`.
5. Creates, validates, exports, and enables the five KeeperHub workflows.
6. Signs a short-lived EIP-712 heartbeat with the owner burner.
7. Sends only `{nonce, deadline, signature}` to the workflow-specific webhook.
8. Polls KeeperHub settlement, verifies the receipt, and rereads the contract.

The successful final line is:

```text
WORKFLOW DROVE THE CONTRACT
```

## 3. Open the dashboard

```bash
cd dashboard
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), connect the owner wallet,
and use **Check in now**. The wallet signs typed data but sends no transaction.
The server submits the signature through KeeperHub and returns evidence only
after settlement, receipt, event, and state checks pass.

## 4. Verify the repository

```bash
./verify.sh
```

Useful focused commands:

```bash
npm test
npm run test:agent
npm run test:dashboard
npm --prefix dashboard run typecheck
npm --prefix dashboard run build
```

## Troubleshooting

### Node version rejected

Run `nvm use`. Hardhat supports Node 18, 20, and 22 in this repository.

### Workflow enable fails at Telegram

Add a Telegram integration in KeeperHub and set `TELEGRAM_CHAT_ID` in `.env`.
The starter will not enable a workflow with a placeholder notification target.

### Webhook returns 401 or 403

Use the user-scoped `wfb_` key in `KEEPERHUB_WEBHOOK_API_KEY`. The webhook uses
Bearer authentication. The organization `kh_` key is for MCP calls.

### KeeperHub says completed but the script fails

`completed` is a settlement phase, not proof of success. The runner requires a
successful execution, transaction hash, successful receipt, and advanced
`lastHeartbeat`. A missing field fails the run.

### A retry repeats an old failure

Do not reuse one idempotency key across attempts. KeeperHub caches failure
results as well as successful results.
