# LegacyKeeper Starter Kit — Tutorial

Welcome! This tutorial takes you from zero to a working KeeperHub-executed transaction in under 5 minutes. You will build a two-mode onchain security agent that handles both inheritance (passive liveness monitoring) and emergency evacuation (instant panic trigger).

## What you will build

A **LegacyKeeper agent** that runs through KeeperHub:

1. **Inheritance mode** — monitors onchain heartbeats. If you miss too many, it starts a grace period. If you still don't respond, it transfers your assets to your chosen beneficiaries.

2. **Emergency mode** — instant panic button that evacuates all assets to a safe vault. Protected by a separate recovery key and KeeperHub private routing (MEV protection).

## Prerequisites

- Node.js 18+
- npm or yarn
- A [KeeperHub](https://keeperhub.com) account (free tier works)
- An Ethereum wallet with Sepolia testnet ETH (get free from a faucet)
- A Telegram bot token (optional, for alerts) — talk to [@BotFather](https://t.me/BotFather)

## Step 1: Clone and set up

```bash
git clone https://github.com/your-org/legacy-keeper
cd legacy-keeper

# Run the setup wizard
chmod +x starter/setup.sh
./starter/setup.sh
```

The setup script will:
- Check your Node.js version
- Install npm dependencies
- Create your `.env` file from the template
- Walk you through KeeperHub MCP connection
- Deploy the LegacyKeeper contract (optional)

## Step 2: Connect to KeeperHub

LegacyKeeper uses KeeperHub's MCP server to execute all onchain actions. Connect your environment:

```bash
claude mcp add --transport http keeperhub \
  https://app.keeperhub.com/mcp \
  --header "X-Api-Key: $KEEPERHUB_API_KEY"
```

Or connect programmatically using the MCP URL and API key from your `.env` file.

The MCP server exposes tools to:
- Create and manage workflows
- Trigger scheduled and HTTP-based executions
- Read contract state
- View execution logs and audit trails

## Step 3: Deploy the contract

The LegacyKeeper contract stores all onchain configuration:
- Beneficiary addresses and share percentages
- Liveness parameters (heartbeat interval, timeout, grace period)
- Safe vault address
- Recovery key hash
- Heartbeat timestamps

Deploy to Sepolia testnet:

```bash
npm run deploy:contract
```

Or deploy manually using Hardhat:

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

After deployment, save the contract address to your `.env`:

```
LEGACY_KEEPER_ADDRESS=0x_your_deployed_address
```

## Step 4: Register workflows on KeeperHub

Two workflows ship with the starter kit:

### Workflow 1: Liveness Monitor & Inheritance

**File:** `starter/templates/inheritance-workflow.json`

This scheduled workflow runs every 6 hours and:
1. Reads the contract's `getLivenessStatus()` to check the last heartbeat timestamp
2. If the timeout has been exceeded, starts the grace period
3. Sends alerts via Telegram/Discord/Email
4. After the grace period, executes the inheritance transfer
5. Records everything in the KeeperHub audit trail

Upload to KeeperHub via the web dashboard or MCP API:

```bash
curl -X POST https://app.keeperhub.com/api/workflows \
  -H "X-Api-Key: $KEEPERHUB_API_KEY" \
  -d @starter/templates/inheritance-workflow.json
```

### Workflow 2: Emergency Evacuation

**File:** `starter/templates/evacuation-workflow.json`

This HTTP-triggered workflow handles panic events:
1. Verifies the recovery key signature from request headers
2. Checks the contract balance
3. Executes the evacuation via private routing (MEV protected)
4. Sends alerts on completion or failure
5. Logs to the audit trail

The webhook URL will be: `https://app.keeperhub.com/panic/{your_wallet_address}`

## Step 5: Configure the agent

Edit your `.env` file with your contract address and preferences:

```env
# Heartbeat every 24 hours
HEARTBEAT_INTERVAL_SECONDS=86400

# Inheritance triggers after 30 days without heartbeat
TIMEOUT_DURATION_SECONDS=2592000

# 7-day grace period to cancel before execution
GRACE_PERIOD_SECONDS=604800
```

## Step 6: Start the agent

```bash
npx tsx agent/index.ts
```

The agent will:
- Start periodic liveness checks
- Send a confirmation message via Telegram
- Monitor for heartbeat timeouts
- Listen for panic triggers

## Step 7: Send your first heartbeat

There are three ways to send a heartbeat:

### Option A: Dashboard
Open `dashboard/index.html` in your browser and click "Send Heartbeat."

### Option B: Telegram Bot
Send `/checkin` to your LegacyKeeper bot.

### Option C: Direct via KeeperHub
```bash
curl -X POST https://app.keeperhub.com/mcp \
  -H "X-Api-Key: $KEEPERHUB_API_KEY" \
  -d '{"tool":"contract-write","params":{"address":"$LEGACY_KEEPER_ADDRESS","method":"heartbeat","args":["0x_signature"]}}'
```

## Step 8: Test the panic button

### Via Dashboard
Open the dashboard and click "Activate panic protocol." Confirm in the modal.

### Via Telegram
Send `/panic` to your bot.

### Via Secret URL (webhook)
Use the URL shown in your dashboard (keep it secret!).

The evacuation workflow will:
1. Verify your recovery key signature
2. Check the contract balance
3. Execute the evacuation through KeeperHub private routing
4. Send you a confirmation with the transaction hash

## Next steps

- Open the **web dashboard** (`dashboard/index.html`) to configure beneficiaries
- Set up your **safe vault address** — this is where evacuated assets go
- Register your **recovery key** — make sure it is different from your wallet key
- Add **alert channels** — Telegram and Discord are quick to set up

## Architecture overview

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Dashboard  │────▶│  LegacyKeeper    │────▶│  KeeperHub       │
│  (HTML/JS)  │     │  Agent (TS)      │     │  MCP + Workflows │
└─────────────┘     └──────────────────┘     └─────────────────┘
                          │                          │
                          ▼                          ▼
                    ┌──────────────┐          ┌──────────────┐
                    │  Telegram    │          │  EVM Chain   │
                    │  Bot         │          │  (Sepolia)   │
                    └──────────────┘          └──────────────┘
```

All transaction execution flows through KeeperHub. The agent is stateless — configuration lives on the contract, execution lives in KeeperHub workflows.

## Getting help

- [KeeperHub Documentation](https://docs.keeperhub.com)
- [KeeperHub GitHub](https://github.com/KeeperHub/keeperhub)
- File an issue in the LegacyKeeper repo
