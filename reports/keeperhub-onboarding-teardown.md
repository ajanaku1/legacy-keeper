# From first tool call to verified transaction

## A field teardown of KeeperHub agent onboarding

LegacyKeeper used KeeperHub as the only execution path for plan creation,
configuration, sponsored heartbeats, and recovery. This report isolates the
problems encountered between connecting an agent and proving that its first
transaction succeeded onchain.

It is not a review based on documentation alone. The findings came from live
MCP calls, workflow executions, paid marketplace calls, Sepolia receipts, and
the failure paths of an autonomous inheritance agent.

## Result

KeeperHub executed the required transactions and recovered from real failures.
The difficult part was knowing which inputs the tools accepted, whether a retry
sent a new transaction, and what evidence licensed the agent to report success.

The investigation produced two upstream issues and influenced two merged fixes:

| Field finding | Upstream result | Builder impact |
|---|---|---|
| Natural JSON values were rejected by `execute_contract_call` | [Issue #1841](https://github.com/KeeperHub/keeperhub/issues/1841) led to merged [PR #1848](https://github.com/KeeperHub/keeperhub/pull/1848); the [hosted v1.2.0 retest passed](keeperhub-natural-encoding-evidence.json) | Numeric chain IDs, arrays, and numeric gas values are now accepted by the MCP execute tools |
| A reused idempotency key silently replayed a cached revert | [Issue #1840](https://github.com/KeeperHub/keeperhub/issues/1840) informed merged [PR #1884](https://github.com/KeeperHub/keeperhub/pull/1884) | Replayed responses now carry `idempotentReplay: true` instead of looking like fresh executions |
| Retry disposition remained ambiguous after a timeout | Open [PR #1922](https://github.com/KeeperHub/keeperhub/pull/1922) builds on the same failure analysis | The proposed response tells an agent when the same key must be reused |

The original evidence remains in the chronological
[friction log](friction-log.md). This report is the shorter onboarding path,
with later upstream outcomes applied.

## The five highest-cost points

### 1. The first contract call failed on natural JSON

The MCP schema exposed `chain_id`, `function_args`, and
`gas_limit_multiplier`, but the deployed tool initially required all three as
strings. `function_args` also had to be a JSON array encoded inside a string.

```jsonc
// Natural call, rejected by the original tool
{
  "chain_id": 11155111,
  "function_args": [],
  "gas_limit_multiplier": 1.2
}

// Original accepted shape
{
  "chain_id": "11155111",
  "function_args": "[]",
  "gas_limit_multiplier": "1.2"
}
```

This produced three separate schema failures on the critical path to the first
transaction. The merged fix now accepts the natural encoding and retains the
legacy string form.

A mutation-safe retest against the hosted MCP on 2026-08-11 sent all three
natural values together with an intentionally invalid contract address. The
request advanced to ABI lookup without any type-validation error, confirming
the fix is deployed. The complete sanitized request types, schema snapshot,
tool description, server version, and downstream failure are preserved in
[`keeperhub-natural-encoding-evidence.json`](keeperhub-natural-encoding-evidence.json).

**Onboarding lesson:** examples help people, but machine-readable schemas must
also describe values an agent can send successfully.

### 2. A safe-looking retry policy prevented recovery

LegacyKeeper attempted inheritance slightly before the grace period elapsed.
The contract reverted, and the agent retried three times over four minutes with
the same idempotency key. KeeperHub replayed the first revert every time even
after the plan became eligible.

```text
seconds since heartbeat: 420
required delay:          150
contract state:          eligible
agent response:          LK: not yet due
```

The response was plausible because nothing identified it as cached. The agent
could not distinguish a new contract failure from an old response.

The safe policy is conditional:

1. Reuse the same key when the outcome is unknown, including timeouts, dropped
   connections, and in-progress responses.
2. Inspect the eventual execution or replay.
3. Rotate only after a definite terminal failure when the caller intends a new
   attempt.
4. Keep contract-level idempotency for irreversible actions.

Merged PR #1884 makes replay visible. PR #1922 addresses the remaining
same-key versus new-key decision.

**Onboarding lesson:** an idempotency key is not a generic retry identifier. Its
lifetime and replay semantics are part of the execution contract.

### 3. Settlement state was easy to confuse with action success

The direct-execution status used `completed` as a terminal state while the
contract outcome lived in separate result fields. Our first poller made both
possible mistakes:

- omitting `completed` from the terminal set and waiting until timeout after a
  successful transaction;
- treating a terminal response as sufficient evidence of success.

LegacyKeeper now requires the complete proof ladder:

```text
execution accepted
  -> execution settled
  -> transaction hash present
  -> receipt status successful
  -> expected event present
  -> target contract matches
  -> resulting state matches
```

Every arrow is checked. A missing or contradictory step fails closed.

**Onboarding lesson:** status polling should document transport state and
onchain outcome as different concepts, even when both appear in one response.

### 4. Workflow validation happened after persistence

`validate_workflow` accepted a `workflowId`, not an unpersisted `nodes` and
`edges` graph. The apparent validate-then-create journey was therefore not
possible. A first-time agent had to create a workflow, validate the stored
record, repair it, and delete or update the broken object.

The current workaround is:

1. Call `list_action_schemas` and build from its returned structure.
2. Create the workflow disabled.
3. Validate the stored workflow.
4. Update until valid.
5. Enable only after review.

Open [PR #1949](https://github.com/KeeperHub/keeperhub/pull/1949) corrects the
documentation that implied candidate validation already existed.

**Onboarding lesson:** if pre-create validation is unavailable, the tool and
docs should make the disabled-create workflow explicit.

### 5. Private routing exposed capability but not proof

The live MCP execute schema did not expose private-routing inputs, and direct
execution status did not report a submission route. A later source audit found
the missing distinction:

- `GET /api/chains` exposes `usePrivateMempoolRpc` as a chain capability;
- workflow write actions can request the capability with
  `usePrivateMempool: true`;
- strict mode prevents silent public fallback;
- private routing bypasses the sponsored path;
- the execution output still does not prove that a particular transaction used
  a private route.

The public Chains API described the capability flag as routing transactions by
default. That wording made support, selection, and proof look like one thing.
They are three different claims.

LegacyKeeper therefore says private routing was **requested**, never that it was
used. Upstream [PR #1983](https://github.com/KeeperHub/keeperhub/pull/1983)
corrects the capability wording and records those evidence boundaries.

**Onboarding lesson:** a security feature needs separate fields for
availability, request, fallback, and observed result.

## Correct first-transaction path

This is the shortest sequence that matched the deployed system and produced
independently verified evidence:

1. Create an organization-scoped `kh_` API key.
2. Connect to the hosted MCP endpoint and complete `initialize`, capture the
   response session ID, then send `notifications/initialized` sequentially.
3. Call `list_action_schemas` before constructing workflows.
4. Confirm the organization wallet and the target testnet.
5. Simulate the intended call when the selected execution surface supports it.
6. Generate one stable idempotency key for the attempt.
7. Submit the exact reviewed call through KeeperHub.
8. Persist the execution ID before polling.
9. Reuse the same request and key while the outcome is unknown.
10. Read the execution result and transaction hash.
11. Fetch the receipt independently from the target chain.
12. Verify the expected event and resulting contract state.
13. Store the request boundary, execution ID, receipt, event, and post-state as
    one audit record.

The current official [MCP reference](https://docs.keeperhub.com/ai-tools/mcp-server)
and [direct-execution guide](https://docs.keeperhub.com/api/direct-execution)
now cover more of this route than they did at the start of the hackathon.

## Prioritized platform improvements

### P0: Make retry disposition explicit

**Acceptance criteria**

- A replayed response is distinguishable from a new execution.
- An in-progress response tells the caller to reuse the same key.
- A definite terminal failure explains when a new attempt may use a new key.
- Documentation warns that changing a request body under the same logical
  intent can create a conflict or duplicate broadcast.

### P0: Expose verifiable submission routing

**Acceptance criteria**

- Chain capability is discoverable before construction.
- The caller can request private routing explicitly.
- Strict versus public-fallback behavior is explicit.
- The execution record reports the route actually used.
- Sponsorship and private routing are identified as mutually exclusive where
  that remains the implementation constraint.

### P1: Validate candidate workflow graphs

**Acceptance criteria**

- `validate_workflow` accepts either a stored `workflowId` or an unpersisted
  workflow definition.
- Validation performs no writes when passed a candidate graph.
- Errors use the same stable codes for stored and candidate workflows.

### P1: Require meaningful paid-workflow inputs

LegacyKeeper paid for a marketplace allowance check whose empty input schema
forced it to inspect a hardcoded demo address. A buyer could not supply the
owner, token, or spender it needed checked.

**Acceptance criteria**

- Paid listings declare a meaningful input schema or explicitly declare that
  they accept no inputs.
- Search results show required fields before payment.
- Listing validation warns when a paid workflow contains address-specific
  constants but exposes no corresponding input.

## Evidence inventory

| Claim | Evidence |
|---|---|
| Natural MCP argument mismatch | [Issue #1841](https://github.com/KeeperHub/keeperhub/issues/1841), merged [PR #1848](https://github.com/KeeperHub/keeperhub/pull/1848), and [passing hosted MCP retest](keeperhub-natural-encoding-evidence.json) |
| Cached-failure retry failure | [Issue #1840](https://github.com/KeeperHub/keeperhub/issues/1840), merged [PR #1884](https://github.com/KeeperHub/keeperhub/pull/1884), open [PR #1922](https://github.com/KeeperHub/keeperhub/pull/1922) |
| Private-routing evidence boundary | [PR #1983](https://github.com/KeeperHub/keeperhub/pull/1983) |
| Recovered autonomous inheritance | [Sepolia transaction `0x3e8505e2`](https://sepolia.etherscan.io/tx/0x3e8505e2f1bc59d4eb16597dd8dca5a8cc1d1a0525170c8cd55aa60067c351bc) |
| Sponsored transaction | [Sepolia transaction `0x0041106b`](https://sepolia.etherscan.io/tx/0x0041106b3d3f246c57efc27d200a215a07607c4f644c36173826f573da38a598) |
| Workflow and platform coverage | [KeeperHub coverage matrix](keeperhub-coverage.md) |
| Full chronological record | [Friction log](friction-log.md) |
| Fail-closed implementation | [`agent/executor/keeperhub.ts`](../agent/executor/keeperhub.ts) and its [integrity tests](../test/agent/executor-integrity.test.ts) |

## Scope and limitations

- Sepolia proves integration and execution behavior, not mainnet private relay
  inclusion.
- KeeperHub platform behavior changed during the hackathon. This report labels
  merged fixes and open work separately.
- A successful KeeperHub payment proves the payment rail, not that the purchased
  workflow accepted useful user-specific inputs.
- No claim of private routing is made without route evidence.

The central recommendation is simple: optimize onboarding for the first
**verified** transaction, not the first accepted request. Agents need enough
information to decide whether to retry, stop, or report success without guessing
across an irreversible boundary.
