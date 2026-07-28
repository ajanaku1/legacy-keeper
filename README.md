# LegacyKeeper: onchain inheritance and emergency evacuation

An autonomous agent that moves your assets when you cannot: after you go silent, or the moment your wallet is compromised. Execution runs entirely through KeeperHub.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636)](https://soliditylang.org/)
[![Tests](https://img.shields.io/badge/tests-54_passing-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## Verified transactions

Every link below is a real Sepolia transaction executed through KeeperHub.

| What | Transaction | Evidence |
|------|-------------|----------|
| Inheritance, recovered after 3 failed attempts | [`0x3e8505e2`](https://sepolia.etherscan.io/tx/0x3e8505e2f1bc59d4eb16597dd8dca5a8cc1d1a0525170c8cd55aa60067c351bc) | 156,896 gas, landed on attempt 4 |
| Inheritance, exact 60/40 split | [`0x6efe67a5`](https://sepolia.etherscan.io/tx/0x6efe67a56e725408785e048eb3a7f1a2598ac70e4cdbbdbdc9cd554cd7d12308) | 0.006 and 0.004 ETH delivered |
| Emergency evacuation | [`0x9fe43045`](https://sepolia.etherscan.io/tx/0x9fe43045a93566b7b35f94ab5efc0a9ac39e459f024d12d69e0e2f257bba6ffd) | recovery key only, owner key unused |
| Gasless heartbeat, sponsored | [`0x0041106b`](https://sepolia.etherscan.io/tx/0x0041106b3d3f246c57efc27d200a215a07607c4f644c36173826f573da38a598) | 83,606 gas, paid by KeeperHub |
| Heartbeat via KeeperHub **workflow** | [`0x0993b361`](https://sepolia.etherscan.io/tx/0x0993b36145510f58c4e2cff66a91f6cd94b283835749a9066c356e9974a10c02) | execution `i14i9t2o1vu2wob2nunh4` |

Contract: [`0x0f92268dC069f40e9e6A37BF36dc49D60377f4bA`](https://sepolia.etherscan.io/address/0x0f92268dC069f40e9e6A37BF36dc49D60377f4bA#code), source verified.

<!-- TODO: Add screenshot -->

---

## What is LegacyKeeper?

Two things go wrong with self-custody. You lose access permanently (keys lost, incapacity, death), or someone else gains access and you have minutes to react.

Both need a system that acts without the key in question. LegacyKeeper watches for proof you are alive, and if that proof stops arriving, it distributes your assets to people you named. Separately, a recovery key you keep elsewhere can sweep everything to a safe vault at any moment, even if your wallet key is fully compromised.

The transaction has to fire when nobody is watching. That constraint is the whole product, and it is why execution runs through KeeperHub rather than a script on somebody's laptop.

---

## Features

- **Liveness inheritance.** Configurable timeout and grace period. Miss both, and distribution becomes callable by anyone. The share split is exact to the wei.
- **Emergency evacuation.** Authorized by a separate recovery key. The owner key signs nothing and is never consulted.
- **Assets stay in your wallet.** The contract holds ERC-20 allowances, not balances, and pulls at execution time. You never move funds into it to be protected.
- **Survives hostile recipients.** A beneficiary that reverts on receive, or one frozen by a token blocklist, gets a claimable balance instead of bricking the estate for everyone else.
- **Gasless proof of life.** Sign an EIP-712 heartbeat offline. KeeperHub sponsors the gas, so staying alive never requires a funded wallet.
- **Recovery is visible.** The audit ledger records every attempt, so a failure followed by a success stays in the record rather than being overwritten.
- **Nine verification gates.** A single script decides whether the project is done. It fails on fabricated success values, stub modules, and any direct-RPC transaction send.

---

## Capability matrix

Status is evidence-based. "Live" means a transaction or artifact exists.

| Capability | Status | Evidence |
|---|---|---|
| Inheritance distribution | Live | tx `0x3e8505e2`, `0x6efe67a5` |
| Emergency evacuation | Live | tx `0x9fe43045` |
| Gasless sponsored heartbeat | Live | tx `0x0041106b`, `"sponsored": true` |
| Execution via KeeperHub workflows | Live | 5 workflows, tx `0x0993b361` |
| Schedule, Webhook, Event, Block triggers | Live | `workflows/exported/` |
| Audit trail with retry history | Live | `loop/memory/audit.jsonl` |
| ERC-20 inheritance and evacuation | Live | 36 contract tests |
| Telegram bot | Live | real Bot API long-polling |
| Dashboard | Live | reads chain state, writes heartbeat |
| x402 paid workflow | Live | [Base tx `0xc91e3026`](https://basescan.org/tx/0xc91e3026f9695639fb2e262677b4e77a752efae89a7c32312f0319bc11074728), $0.01 USDC settled |
| MPP over Tempo | Available, untested | wallet exists, no funds |
| Private routing | Requested, unconfirmed | flag set onchain, path not verified |
| Mainnet | Out of scope | Sepolia only |

Private routing is the one thing we set but cannot prove. The UI says "requested", not "used", because KeeperHub has not confirmed the submission path.

The x402 payment is real and settled, but it proves less than we wanted. The listing we paid takes no arguments and reads a fixed demo approval, so it validates the payment rail rather than checking this project's own allowance. Pointing a paid check at our contract needs a listing that accepts inputs, which none of the published ones currently do.

---

## Product boundaries

Stated plainly, because each one changes what the product can promise.

**ERC-20 protection lasts only while your allowance stands.** Revoke it and token inheritance silently stops working. Nothing in the system notices on its own, which is why an independent paid allowance check exists.

**Native ETH must be deposited into the contract.** An EOA's balance cannot be pulled by a third party. Tokens stay in your wallet; ETH does not.

**Sponsorship and private routing are different paths.** A transaction is never presented as both.

**Losing the recovery key disables evacuation.** Inheritance still works. Rotation exists, but requires the current key.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Contract | Solidity 0.8.24, EIP-712, EIP-2 malleability guard |
| Execution | KeeperHub MCP, workflows, sponsored gas |
| Agent | TypeScript, ethers v6, JSON-RPC over streamable HTTP |
| Dashboard | Next.js 15, wagmi, viem |
| Bot | Telegram Bot API, long polling |
| Tests | Hardhat (36 contract), Vitest (18 agent) |
| Payments | x402 over Base USDC |

---

## How it works

```
   owner signs                      KeeperHub                     Sepolia
   heartbeat  ──────────────►  ┌──────────────────┐  ────────►  LegacyKeeper
   (offline, no gas)           │  Schedule  cron  │              .heartbeat
                               │  Webhook   panic │
   silence                     │  Event     grace │              .executeInheritance
   30 days ──────────────────► │  Block     health│  ────────►   (permissionless,
                               │                  │               time-gated)
   recovery key                │  smart gas       │
   signs evacuate ───────────► │  retries         │  ────────►   .evacuate
                               │  sponsorship     │               (recovery key only)
                               └──────────────────┘
                                        │
                                        ▼
                                   audit ledger
                          trigger, simulation, tx, gas,
                          outcome, retries, timestamp
```

The contract is permissionless where it matters. `executeInheritance()` can be called by anyone once the grace period expires, because the owner is by definition absent when it must run. Safety comes from the time gate, not from who is asking.

---

## Smart contract

| Function | Access | Purpose |
|----------|--------|---------|
| `heartbeat()` | owner | Reset the liveness timer |
| `heartbeatBySig(nonce, deadline, sig)` | anyone with a valid signature | Gasless relayed heartbeat |
| `executeInheritance()` | anyone, after grace | Distribute native ETH by share |
| `executeInheritanceERC20(token)` | anyone, after grace | Distribute a tracked token |
| `evacuate(nonce, deadline, sig)` | recovery key signature | Sweep everything to the safe vault |
| `rotateRecoveryKey(newKey, ...)` | current recovery key | Rotate without the owner key |
| `claimToken(token)` | beneficiary | Claim a share whose delivery failed |

Every signature is EIP-712, bound to chainId, this contract address, an action-specific typehash, a nonce, and a deadline. A signature for one action cannot authorize another, and one leaked signature cannot drain a second deployment.

---

## Testing the app

Full walkthrough: [`starter/docs/tutorial.md`](starter/docs/tutorial.md). Short version:

```bash
nvm use && npm install          # Node 18, 20 or 22 only
cp .env.example .env            # add KeeperHub key, RPC, burner key
npx hardhat run scripts/deploy.ts --network sepolia
LK_ADDRESS=0x... npx hardhat run scripts/configure-demo.ts --network sepolia
npm run workflows:deploy        # creates 5 workflows, disabled
npx tsx scripts/workflows/run-heartbeat.ts   # real transaction
```

Run everything:

```bash
bash loop/guardrails/verify.sh  # 9 gates
npm test                        # 36 contract tests
npm run test:agent              # 18 agent tests
npm run agent:bot               # monitor + Telegram
cd dashboard && npm install && npm run dev
```

---

## Verification

`loop/guardrails/verify.sh` has the final say on whether this project is done.

| Gate | Checks |
|------|--------|
| G1 | Contracts compile |
| G2 | 36 contract tests |
| G9 | 18 agent tests against a local fake KeeperHub |
| G6, G7 | Agent and dashboard typecheck |
| G3 | No fabricated success values or stub modules |
| G8 | A module naming an API actually calls it |
| G4 | No direct-RPC transaction sends |
| G5 | No secret material in tracked files |

G3 and G8 exist because an earlier version of this project shipped a hardcoded transaction hash and a Telegram bot with zero network calls. The gates now fail on both.

---

## For KeeperHub builders

Building this surfaced eight reproducible issues, written up with repros in [`reports/friction-log.md`](reports/friction-log.md). The three that will cost you the most time:

1. **Reusing an `idempotency_key` across retries makes recovery impossible.** KeeperHub caches outcomes including failures and replays them. Scope the key per attempt.
2. **`chain_id`, `function_args` and `gas_limit_multiplier` are string-typed** despite the schema implying otherwise.
3. **`status: "completed"` means settled, not successful.** Read `result.success`.

Platform coverage and what we could not use: [`reports/keeperhub-coverage.md`](reports/keeperhub-coverage.md). Threat model: [`reports/threat-model.md`](reports/threat-model.md).

---

## License

MIT
