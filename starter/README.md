# One-key KeeperHub quickstart

This is the smallest LegacyKeeper path from a KeeperHub API key to a verified
Sepolia transaction. It does not deploy a contract, create a workflow, fund a
wallet, configure a webhook, start PostgreSQL, or require Telegram.

## Run it

```bash
git clone https://github.com/ajanaku1/legacy-keeper.git
cd legacy-keeper
npm ci
KEEPERHUB_API_KEY=kh_your_key_here npm run first-tx
```

The command:

1. generates an ephemeral owner and policy locally;
2. signs an EIP-712 `CreatePlan` intent without printing the private key;
3. calls KeeperHub's sponsored `execute_contract_call` on Sepolia;
4. waits for explicit execution success and a transaction hash;
5. independently checks the receipt, `PlanCreated` event, factory registry,
   deployed bytecode, owner, and initialization state; and
6. prints the command-to-proof time and an Etherscan link.

A successful result ends with evidence shaped like:

```json
{
  "proof": "KEEPERHUB_FIRST_TRANSACTION_VERIFIED",
  "keeperHubExecutionId": "...",
  "transactionHash": "0x...",
  "sponsored": true,
  "elapsedMs": 42000,
  "elapsedSeconds": 42,
  "planAddress": "0x...",
  "blockNumber": 12345678,
  "explorer": "https://sepolia.etherscan.io/tx/0x..."
}
```

`elapsedMs` starts before the MCP handshake and stops only after independent
onchain verification. Installation and the time needed to obtain an API key
are intentionally reported separately from this command clock.

## Measured result

On 2026-08-13, the command reached verified proof in **74.3 seconds**. KeeperHub
sponsored [Sepolia transaction `0x2f39…bbca`](https://sepolia.etherscan.io/tx/0x2f39e73bb20e3cea728da830708e2a2a9f98e590fb0638307ec5afee8025bbca),
which created plan `0xC9f1…C87B`. The complete sanitized output and verification
boundary are retained in
[`reports/first-transaction-benchmark.json`](../reports/first-transaction-benchmark.json).

## Inspect without sending a transaction

```bash
npm run first-tx:dry-run
```

The dry run creates the same throwaway signed request, redacts its function
arguments, and performs no network call.

## Optional overrides

- `KEEPERHUB_MCP_URL`: defaults to `https://app.keeperhub.com/mcp`.
- `SEPOLIA_RPC_URL`: defaults to a public Sepolia endpoint.
- `NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS`: defaults to LegacyKeeper's
  current verified Sepolia factory.

For the complete wallet-scoped product setup, including four workflows,
PostgreSQL, the dashboard, and optional Telegram alerts, continue to the
[production-shaped tutorial](docs/tutorial.md).
