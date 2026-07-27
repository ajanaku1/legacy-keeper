# From clone to a KeeperHub-executed transaction

Target: **under 5 minutes** of hands-on time, plus waiting on a faucet.

Everything below was run end to end on a clean machine. Where a step has a
gotcha that cost us time, it says so — those are the parts the docs don't warn
you about.

---

## 0 · What you need

| | |
|---|---|
| Node | **18, 20 or 22**. Hardhat rejects anything newer. `nvm use` reads the repo's `.nvmrc`. |
| KeeperHub account | [app.keeperhub.com](https://app.keeperhub.com) — free to create |
| Sepolia ETH | ~0.05, from [sepoliafaucet.com](https://sepoliafaucet.com) or the [Google faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) |

> **Node version is the single most common failure.** On Node 25 Hardhat prints
> a warning and then behaves unpredictably. On Node 26 it may not run at all.

---

## 1 · Install

```bash
git clone <this-repo> && cd legacy-keeper
nvm use          # or: brew install node@22
npm install
```

## 2 · Credentials

```bash
cp .env.example .env
```

**KeeperHub API key** — app.keeperhub.com → **Settings → API Keys →
Organisation** tab. Keys begin `kh_`.

Or skip the key entirely and authorise in a browser:

```bash
claude mcp add --transport http keeperhub https://app.keeperhub.com/mcp
```

**Deployer key** — a burner, never a wallet with real funds:

```bash
node -e "console.log(require('ethers').Wallet.createRandom().privateKey)"
```

Run it **twice**. The second key is your *recovery key*, and it must live
somewhere the first one doesn't — that separation is the entire point of
emergency evacuation. Only its **address** goes in `.env`.

**Fund two wallets**, not one:

1. your deployer address
2. the wallet KeeperHub executes with — app.keeperhub.com → Integrations

> Forgetting the second is why a workflow that looks correct does nothing.

## 3 · Deploy

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

Copy the printed address into `LEGACY_KEEPER_ADDRESS` in `.env`.

For a demo you can watch, compress the timers:

```bash
DEMO_TIMEOUT_SECONDS=120 DEMO_GRACE_SECONDS=60 \
  npx hardhat run scripts/deploy.ts --network sepolia
```

## 4 · Configure the estate

```bash
LK_ADDRESS=0xYourContract npx hardhat run scripts/configure-demo.ts --network sepolia
```

Adds two beneficiaries (60/40) and funds the contract.

> Shares must total **exactly** 10,000 bps. Distribution reverts otherwise, and
> it reverts at execution time — when nobody is around to fix it.

## 5 · Create the workflows

```bash
npm run workflows:deploy
```

Creates five workflows — Schedule, Webhook ×2, Event and Block triggers — and
exports what KeeperHub actually stored to `workflows/exported/`. That export is
a round-trip, not a copy of what was sent, so it proves the definition survived.

They are created **disabled**; non-manual triggers stay dormant until you
enable them in the UI.

> There is no dry-run. `validate_workflow` needs a `workflowId`, so a workflow
> must exist before it can be validated. Expect to create, inspect, and delete
> a few while iterating.

## 6 · Execute through KeeperHub

```bash
npx tsx scripts/workflows/run-heartbeat.ts
```

Signs an EIP-712 heartbeat locally, hands it to the KeeperHub workflow, polls
until settlement, then verifies `lastHeartbeat` advanced **on-chain** rather
than trusting the reported status.

You should see a real transaction hash. That is the finish line.

## 7 · Watch it

```bash
npm run agent                     # monitor
npm run agent:bot                 # monitor + Telegram
cd dashboard && npm install && npm run dev
```

---

## Things that will cost you time

**The MCP handshake order is strict.** `initialize`, then
`notifications/initialized`, sequentially, before any `tools/call`. The session
id comes back in the **`Mcp-Session-Id` response header**, not the body. Get it
wrong and you get `-32003 Session not initialized`.

**Scalars are strings.** `chain_id`, `function_args` and `gas_limit_multiplier`
on `execute_contract_call` are all string-typed, and `function_args` is a JSON
array *encoded as a string*:

```jsonc
{ "chain_id": 11155111,   "function_args": [] }    // rejected
{ "chain_id": "11155111", "function_args": "[]" }  // accepted
```

**`status: "completed"` does not mean success.** It means settled. Read
`result.success` and `result.reverted`. Treating `completed` as success will
report a reverted transaction as done.

**Never reuse an `idempotency_key` across retries.** KeeperHub caches the
outcome — including failures — and replays it. Reuse one and your agent
receives the first failure forever while the chain says it should have
succeeded. Scope the key per *attempt*.

**The workflow schema is real but undocumented.** `list_action_schemas` returns
`workflowStructure`, `templateSyntax`, all 6 triggers and 442 actions. Nothing
on the docs site points to it.

Full write-ups with reproductions: [`reports/friction-log.md`](../../reports/friction-log.md).
