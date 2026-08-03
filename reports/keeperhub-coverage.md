# KeeperHub coverage matrix

Refreshed from authenticated aggregate MCP and repository evidence on
2026-08-02. Status follows the evidence ladder in
[`judging-baseline.md`](judging-baseline.md): **Discovered → Configured →
Enabled → Triggered → Settled → Verified**.

## Current platform inventory

The aggregate MCP identified itself as KeeperHub `1.2.0` and returned 35 tools.
The relevant live surfaces include workflow CRUD/validation/execution, direct
contract execution and status, action schemas, integrations, workflow listing,
protocol actions, templates, and paid workflow calls.

| Surface | Product role | Status | Evidence / next requirement |
|---|---|---|---|
| Aggregate MCP | Only agent-controlled transaction path and workflow control plane | **Settled** | Direct execution IDs and successful Sepolia receipts; current handshake and 35-tool probe |
| Direct contract execution | Inheritance, evacuation, and heartbeat writes | **Verified** | Five successful Sepolia receipts with LegacyKeeper events |
| Gas sponsorship | Gasless owner heartbeat | **Settled** | KeeperHub record reports `sponsored: true`; tx `0x0041106b…` |
| Smart gas | Avoid underpriced transactions | **Triggered** | Deliberate 0.3× and 0.02× hints were clamped; both landed |
| Retry and idempotency | Recover an unattended execution | **Verified** | Three failed attempts followed by tx `0x3e8505e2…`; separate per-attempt keys |
| Native run status / audit | Distinguish attempts and settlement | **Settled** | Execution IDs, status, gas, transaction hashes, and local append-only ledger |
| Workflow CRUD, validation, export | Reproducible automation graphs | **Verified** | Five enabled workflow IDs, live validation, and definitions round-tripped from KeeperHub |
| Schedule trigger | Unattended liveness evaluation | **Verified** | Automatic execution `6g847vp4ael4oneykst8f`; stable schedule dispatch key captured |
| Panic Webhook trigger | Recovery-key evacuation handoff | **Enabled** | `pm22qhfnox30w0mnngw01`; deliberately not fired because it would evacuate the deployed vault |
| Heartbeat Webhook trigger | Sponsored EIP-712 check-in relay | **Verified** | Automatic webhook execution `9ysdci63m7ritc73lendt`; sponsored tx `0x291b7924…f9c2c3` advanced onchain liveness |
| Event trigger | Independent onchain heartbeat confirmation | **Verified** | Automatic execution `k6dj2mwo4twtkbu3il7ru` observed the webhook transaction and completed its Telegram action |
| Block trigger | Redundant overdue health check | **Verified** | Automatic execution `lrb7i7nghxrxk139d5ty7`; guard read completed inheritance and correctly skipped the write path |
| Conditions / reads / writes | Decide and execute inside workflows | **Verified** | Schedule/Block reads and guards ran automatically; webhook write settled with a confirmed receipt |
| Telegram workflow notification | Inform owner or beneficiaries | **Verified** | Stored integration test passed; Event workflow completed the Telegram confirmation action |
| Per-workflow MCP | Least-privilege client interface | **Verified** | Published `legacykeeper-status-sepolia`; its one typed tool executed successfully as `ao7ozazw7ydkkzastfdxt` |
| CLI lifecycle | Operator recovery and inspection | **Verified** | Official CLI `0.13.1` source build listed enabled workflows and returned filtered status/native logs for the webhook run |
| x402 | Buy an independent allowance/risk result | **Product-verified** | OneSource checked Sepolia USDC for the exact LegacyKeeper owner and spender; $0.003 Base tx `0x03376097…`; zero result consumed as an at-risk decision |
| MPP | Alternative autonomous payment rail | **Discovered, blocked** | The same OneSource endpoint advertises MPP, but the AgentCash Tempo account balance is $0.00 |
| Private routing | Conceal evacuation before inclusion | **Discovered** | No request parameter or returned route evidence found; onchain preference flag does not select a submission path |

## Workflow state

| Workflow | Trigger | ID | Configured | Enabled | Automatic run |
|---|---|---|---:|---:|---:|
| Liveness Monitor | Schedule | `n6h03seyd2178mvj0p9nm` | Yes | Yes | `6g847vp4ael4oneykst8f` / schedule dispatch |
| Panic Evacuation | Webhook | `pm22qhfnox30w0mnngw01` | Yes | Yes | Not fired; destructive evacuation is outside this proof |
| Heartbeat Relay | Webhook | `ryd34r3ayrg2u8o29fmrk` | Yes | Yes | `9ysdci63m7ritc73lendt` / `wrun_01KYZZR8GH2X2FACPB8C59DX7G` |
| Heartbeat Event Watch | Event | `sux1hhjj0u6an7p6vddp2` | Yes | Yes | `k6dj2mwo4twtkbu3il7ru` |
| Block Health Check | Block | `5w133r3gajq3haixv1nhl` | Yes | Yes | `lrb7i7nghxrxk139d5ty7` / block dispatch |

## Claims deliberately withheld

- The panic workflow is enabled but is not described as triggered: firing it
  would perform the destructive evacuation it is designed to execute.
- Private routing is not described as requested or used until a route parameter
  is sent before submission and KeeperHub returns verifiable route evidence.
- x402 is a settled, load-bearing LegacyKeeper allowance check. Its response is
  address-bound before the result can affect the product decision.
- MPP remains discovery evidence because its required Tempo payment account is
  unfunded; no additional funding was authorized.
