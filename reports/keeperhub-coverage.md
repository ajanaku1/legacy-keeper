# KeeperHub coverage matrix

Inventory of the live platform as probed on 2026-07-27, mapped to LegacyKeeper's
product journey. Status is evidence-based: **Proven** means a real execution ID
or artifact exists; **Available** means the surface exists and was inspected but
we have not used it; **Blocked** means something outside our control stands in
the way.

Probe method: MCP `tools/list` (35 tools), `list_action_schemas`
(442 actions / 6 triggers / chain list), `search_workflows` (77 listings),
`list_integrations`, and a real `call_workflow` 402 challenge.

---

## Platform vocabulary discovered

| Category | Detail |
|---|---|
| Triggers (6) | `Manual`, `Schedule` (cron), `Webhook`, `Event` (contract events), `Block` (block intervals), `Transfer` (Tempo TIP-20 with memo) |
| Actions | 442 across 34 categories |
| Core non-DeFi actions | `web3/read-contract`, `web3/write-contract`, `web3/sign-typed-data` (EIP-712), `web3/check-allowance`, `web3/check-balance`, `web3/query-events`, `web3/assess-risk`, `Condition`, `HTTP Request`, `math/aggregate`, `telegram/send-message`, `discord/send-message`, `slack/send-message`, `sendgrid/send-email` |
| Workflow schema | `workflowStructure` in `list_action_schemas` — react-flow style `nodes[]` + `edges[]`, `sourceHandle` only for Condition / For Each |
| Chains | Sepolia (11155111) supported alongside Ethereum, Base, Solana, Tempo |
| Marketplace | 77 listings; paid ones carry `priceUsdcPerCall` ($0.01–$0.05) |

---

## Surface status

| Surface | Product role in LegacyKeeper | Status | Evidence |
|---|---|---|---|
| **Aggregate MCP** | The agent's only path to submitting a transaction | **Proven** | Handshake + 35 tools; execution `tqba4l96rhclkuygrp8na` |
| **Gas sponsorship** | Owner proves liveness without funding a wallet | **Proven** | `"sponsored": true`, `estimatedCostUsd: null` on tx `0xb4d16c35…` |
| **Smart gas + retries** | Land unattended writes under drift | **Proven** | `gas_limit_multiplier` clamped at 0.3× and 0.02× — cannot underprice into a stuck tx (friction-log #05) |
| **Native run logs** | Judge-verifiable evidence | **Proven** | `get_direct_execution_status` returns tx hash, gas, `sponsored`, `retryCount`, timestamps |
| **Direct contract call** | Inheritance / evacuation / heartbeat execution | **Proven** | 5 Sepolia transactions |
| **Agentic wallet + x402** | Pay for independent allowance verification | **Blocked — funding only** | Real 402 challenge captured; see below |
| **MPP (Tempo)** | Same, over the Tempo rail | **Available** | `tempo` account exists in agentcash; `Transfer` trigger supports TIP-20 memo matching |
| **Workflow builder / CRUD** | Versioned inheritance, heartbeat, panic graphs | **Available** | `create_workflow`, `validate_workflow`, `update_workflow`; schema now known |
| **Schedule trigger** | Unattended liveness evaluation | **Available** | `scheduleCron` field confirmed |
| **Webhook trigger** | Panic path from dashboard / bot | **Available** | Optional `webhookSchema` |
| **Event trigger** | React to `GracePeriodEntered` / `PanicButtonPressed` | **Available** | Requires `network` + contract/event config |
| **Block trigger** | Second scheduling failure domain for liveness | **Available** | Block-interval firing per chain |
| **Conditions / notifications** | Branch on liveness; escalate to Telegram | **Available** | `Condition`, `telegram/send-message` |
| **Per-workflow MCP** | Narrow typed tool for one production journey | **Not yet probed** | Requires an existing workflow first |
| **CLI** | Export / reproduce workflow set for the starter | **Not yet probed** | — |
| **Workflow listing / export** | Onboarding-bounty artifact | **Available** | `update_workflow_listing`, `get_workflow_listing` |
| **Private routing** | Conceal evacuation until inclusion | **Unverified** | Our contract sets a flag; no evidence KeeperHub honoured a private path. Must not be claimed until proven |

---

## x402 feasibility — GO, pending funding

A real challenge, captured without paying:

```json
{"x402Version":2,"error":"Payment required",
 "accepts":[{"scheme":"exact","network":"eip155:8453",
   "asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
   "amount":"10000","payTo":"0xc7d92e2089bfd22539553fa8ea061cb094274dc5",
   "maxTimeoutSeconds":300}]}
```

`amount: 10000` atomic = **0.01 USDC on Base mainnet** — real money, trivially
small. The MCP tool does not auto-pay; it names three settlement paths:

1. `@keeperhub/wallet` — `paymentSigner.fetch(url, { paymentHint: 'x402' })`
2. **`agentcash`** — already installed in this environment
3. The marketplace UI, interactively

agentcash wallet `0xf09EDa717EA8E77243e435Db9E4f517604194411` holds accounts on
**base**, **tempo** and **solana**, all at **0.00**. Base covers x402; Tempo is
the MPP rail, so one funded wallet plausibly serves both protocols.

**Blocker:** funding only. ~$1 of USDC on Base covers ~100 calls at $0.01.

### Chosen product role

`approval-risk-rescan` ($0.01, category `security`, chain Sepolia) re-reads a
live on-chain ERC-20 allowance. That is not decorative: `Goal.md`'s own product
truth states *"LegacyKeeper protects ERC-20s only while its allowance remains
valid."* The entire ERC-20 custody model rests on an allowance the owner could
revoke, or a token could clear, without telling us. Paying a third party to
independently verify that assumption is exactly the failure mode x402 should
cover — and if it returns zero allowance, the estate silently cannot be
distributed.

Removing it would leave that assumption unchecked, which satisfies the
"load-bearing, not decorative" test.

---

## Honest gaps

Most of the platform is **Available but unused**. Today the agent calls
`execute_contract_call` directly rather than driving workflows, so the builder,
all four automatic triggers, conditions, and native notifications are inspected
but not load-bearing. That is the single largest distance between the current
build and `Goal.md`.

Private routing is the one surface we have actively claimed nowhere and proven
nowhere. The dashboard was corrected to say "private routing requested — flag
set onchain; submission path is chosen by KeeperHub" rather than asserting a
private path was used.
