# KeeperHub friction log

Running notes from building LegacyKeeper, captured as they happened. Entries
that became reproducible issues were filed upstream. Raw notes here preserve
the sponsor-integration evidence behind those reports.

## Index, ranked by what it costs a new builder

| #         | Finding                                                                                        | Severity     | Status                                                  |
| --------- | ---------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------- |
| [07](#07) | A reused `idempotency_key` silently replays a cached failure, making agent recovery impossible | **Critical** | Accepted upstream; execution change queued behind #2020 |
| [03](#03) | `execute_contract_call` scalar types disagree with the schema it advertises                    | **High**     | Fixed upstream; live retest passed                      |
| [06](#06) | `status: "completed"` means settled, not successful                                            | **High**     | Confirmed, cost us a real bug                           |
| [09](#09) | Private-routing capability, request, and proof were conflated                                  | **High**     | Clarified in merged entrant-authored PR #1983           |
| [02](#02) | The workflow schema exists but is undiscoverable from the docs                                 | Medium       | Corrected                                               |
| [08](#08) | `validate_workflow` cannot validate a definition before it exists                              | Medium       | Confirmed                                               |
| [04](#04) | Handshake ordering, header-borne session id, SSE framing                                       | Medium       | Confirmed                                               |
| [01](#01) | Gas sponsorship scope reads as Base/Tempo-only but works on Sepolia                            | Low          | Resolved                                                |
| [05](#05) | `gas_limit_multiplier` is clamped, so you cannot test your own failure handling                | Low          | Positive finding                                        |
| [10](#10) | Marketplace listings take no inputs, so a paid check cannot target your own contract           | Medium       | Confirmed by paying                                     |

Entries below are in the order they were discovered, not ranked order.

---

<a id="01"></a>

## 01 · Where gas sponsorship applies is ambiguous

**Status:** RESOLVED empirically. Sponsorship works on Sepolia.

A real `execute_contract_call` on Sepolia returned `"sponsored": true` with
`estimatedCostUsd: null`
([tx](https://sepolia.etherscan.io/tx/0xb4d16c35912d75f032a483d1974857d5db03d51358326aeeb96b3a0c9a191be3)).
Sponsorship is **not** limited to Base/Tempo as the agentic-wallet page implies.

The docs gap is still worth reporting: those pages describe x402/MPP
facilitators covering gas on Base and Tempo and state "other chains are not
yet supported", which reads as a global constraint but describes only the
agentic-wallet payment path. A builder deciding whether gasless relaying is
viable on a testnet will conclude it is not, and be wrong.

**Suggested fix:** scope that sentence explicitly to the agentic wallet, and
state on the MCP page that direct executions are sponsored on supported EVM
networks including Sepolia.

---

<a id="05"></a>

## 05 · `gas_limit_multiplier` is clamped, so you cannot underprice into a stuck tx

**Status:** confirmed. Positive finding, worth documenting as a feature.

Attempting to induce a stuck transaction by starving gas failed at every level
tried: `0.3`, then `0.02`. All landed successfully. KeeperHub appears to floor
the multiplier at whatever its estimator considers safe.

This is exactly the "transactions execute instead of getting stuck" promise,
and it holds under deliberate attack. Worth stating outright in the docs: the
multiplier can raise a gas limit but cannot lower it below a safe floor.

Consequence for builders: **you cannot use `gas_limit_multiplier` to test your
own failure handling.** We had to reach for a different failure vector to
exercise our retry path.

---

<a id="07"></a>

## 07 · A reused `idempotency_key` silently replays a cached failure

**Status:** confirmed and accepted upstream. Replay visibility and retry guidance
have shipped; the execution change is queued behind
[KeeperHub/keeperhub#2020](https://github.com/KeeperHub/keeperhub/issues/2020).

**Filed upstream:** [KeeperHub/keeperhub#1840](https://github.com/KeeperHub/keeperhub/issues/1840)

`execute_contract_call` accepts an `idempotency_key`. The obvious reading,
"one key per logical action, so retries cannot double-submit," produces an
agent that **can never recover from a failure**.

Observed: a keeper fired `executeInheritance()` slightly before its grace
period expired and reverted with `LK: not yet due`. It retried three more
times over four minutes, reusing the same key. All three returned the
identical revert. Meanwhile the contract was verifiably due:

```
secondsSinceHeartbeat: 420      (needs 150)
timeoutExceeded: true   graceElapsed: true    ← due
keeper reported: "LK: not yet due"            ← cached from attempt 1
```

The retries never re-executed. KeeperHub replayed the cached outcome, so the
agent concluded the estate could not be distributed when in fact it could.

**Why this is dangerous:** it fails in the direction of inaction on an
irreversible, time-critical action, and it is invisible. The agent gets a
plausible, contract-shaped error message instead of a cache-hit signal. At the
time, nothing in the response distinguished a fresh revert from a replayed one.

**Client policy we adopted:** reuse the same key while the outcome is unknown.
Timeouts, dropped connections, 5xx responses, and
`idempotency_in_progress` do not rotate it. Only a confirmed terminal failure
increments `idempotencyAttempt`, producing a fresh key for the next request.
The key is therefore `${executionKey}-a${idempotencyAttempt}`, not one new key
for every loop attempt.

**Upstream outcome:** merged [PR #1884](https://github.com/KeeperHub/keeperhub/pull/1884)
adds `idempotentReplay: true` to replayed object responses. Merged
[PR #1922](https://github.com/KeeperHub/keeperhub/pull/1922) marks
`idempotency_in_progress` as retryable with the same key and documents when to
reuse or rotate.

The remaining change is deliberately narrower than "cache successes only."
KeeperHub will release the key when the outcome is definite and nothing
landed, but retain it when the broadcast outcome is unknown. That work follows
#2020, which must first stop classifying an unreadable receipt as a definite
failure. Once deployed, the original preflight-revert repro should recover by
reusing the same key after the contract condition becomes true.

---

<a id="06"></a>

## 06 · `status: "completed"` does not mean the call succeeded

**Status:** confirmed. Cost us a real bug.

`get_direct_execution_status` returns `status: "completed"` for a settled
execution, with success or failure carried separately in `result.success` and
`result.reverted`. A poller that treats `"completed"` as terminal-and-successful
is wrong. A poller that omits it from its terminal set, as ours initially did,
waits out its entire timeout on a transaction that already landed, then reports
failure for a success.

Reporting a false _failure_ is as damaging as a false success: an agent that
believes an irreversible action failed may try to compensate for something that
already happened.

**Suggested fix:** document the status vocabulary and the
`status` vs `result.success` split on the MCP page.

Adjacent to upstream [#1784](https://github.com/KeeperHub/keeperhub/issues/1784), which covers the missing txHash on the execute response and sponsored executions being invisible to EOA-level checks. Not filed separately to avoid duplicating it.

---

<a id="03"></a>

## 03 · `execute_contract_call` types disagree with the schema it advertises

**Status:** FIXED UPSTREAM; LIVE RETEST PASSED on 2026-08-11.

**Filed upstream:** [KeeperHub/keeperhub#1841](https://github.com/KeeperHub/keeperhub/issues/1841)

**Upstream result:** merged [PR #1848](https://github.com/KeeperHub/keeperhub/pull/1848),
including commit [`97be79e`](https://github.com/keeperguard-labs/keeperhub/commit/97be79e6ff10e504c5387909244ba4a3467ad536).

**Hosted retest:** [sanitized KeeperHub v1.2.0 evidence](keeperhub-natural-encoding-evidence.json).
The mutation-safe probe sent all three natural values together:

```json
{
  "chain_id": 11155111,
  "function_args": [],
  "gas_limit_multiplier": 1.2
}
```

It paired them with an intentionally invalid contract address, making
simulation or broadcast impossible. The hosted MCP accepted all three values
and advanced to ABI lookup, where it failed with `ABI is required` for that
address. There were no `expected string`, `received number`, or `received
array` errors. This confirms the coercion fix is deployed, not merely merged.

The current `tools/list` schema retains the legacy string representation for
generated clients, while the runtime accepts natural numbers and arrays. The
tool description now includes a full working string-form example and explicitly
notes that `function_args` is a JSON array encoded as a string.

### Original behavior when filed

`tools/list` advertises `execute_contract_call` with properties
`chain_id` and `function_args`. The natural encoding, a numeric chain id and
a real JSON array of arguments, was rejected:

```
MCP error -32602: Input validation error:
  chain_id:      expected string, received number
  function_args: expected string, received array
```

`gas_limit_multiplier` was affected too. Every scalar had to be a **string**,
and `function_args` had to be a JSON array _encoded as a string_:

```jsonc
// rejected
{ "chain_id": 11155111,   "function_args": [] }
// accepted
{ "chain_id": "11155111", "function_args": "[]" }
```

Nothing in the original tool description signaled this, and `chain_id` as a string is
counter-intuitive enough that a builder will try the number first every time.
An agent generating calls from the schema alone produced invalid requests.

**Impact:** this is the first call anyone makes after the handshake, so it sits
directly on the critical path from signup to first transaction.

**Resolution:** KeeperHub implemented both practical remedies: natural inputs
are coerced safely at runtime, and the description now documents the legacy
string encoding with a complete example.

---

<a id="04"></a>

## 04 · The MCP handshake order is strict and easy to get wrong

**Status:** confirmed.

`tools/list` before the handshake returns:

```
-32003 Session not initialized
hint: Send `notifications/initialized` after `initialize` and BEFORE any
      `tools/list` or `tools/call`. These must be sequential, not parallel.
```

The hint is better than most error messages. Two things still
cost time: the session id arrives in the `Mcp-Session-Id` **response header**
instead of the body, which is easy to miss when hand-rolling a client; and
responses may come back either as plain JSON or as a single SSE `data:` frame
depending on the call, so a naive `JSON.parse` fails intermittently.

**Suggested fix:** document the header in the MCP page's auth section, and note
that responses can be SSE-framed.

---

<a id="02"></a>

## 02 · The workflow schema exists but is undiscoverable from the docs

**Status:** CORRECTED. My earlier claim that no schema existed was wrong.

`list_action_schemas` returns a complete `workflowStructure` (react-flow shaped
`nodes[]` + `edges[]`), the full `templateSyntax` for cross-node references
(`{{@nodeId:Label.field}}`), all 6 trigger definitions with their required
fields, and 442 action schemas. Everything needed to author a workflow in code
is there.

None of it appears on the documentation site, which describes only the visual
builder, REST API and MCP as authoring routes. A builder reading the docs
concludes workflows cannot be version-controlled; the inherited build in this
repo invented a schema on that assumption and shipped templates the API would
never accept.

Round-tripping works well once found: `create_workflow` → `get_workflow` →
commit preserves the graph exactly, including `sourceHandle: "true"` on
Condition edges.

**Suggested fix:** link `list_action_schemas` from the workflow docs page, or
publish the `workflowStructure` block as a documented schema. This is the
difference between "workflows are a UI feature" and "workflows are code".

---

<a id="08"></a>

## 08 · `validate_workflow` cannot validate a workflow that does not exist yet

**Status:** confirmed.

`validate_workflow` requires a `workflowId`, so it validates only workflows
already persisted. There is no dry-run for a candidate definition.

The practical consequence: to find out whether a definition is well-formed you
must first `create_workflow` it. A malformed definition therefore leaves a
broken workflow in the account, and iterating on a graph means repeatedly
creating and deleting real objects.

**Suggested fix:** accept `nodes`/`edges` directly as an alternative to
`workflowId`, so a definition can be checked before it is persisted. This
matters most for the audience the onboarding bounty targets: someone
authoring their first workflow in code, who will get it wrong several times.

---

<a id="09"></a>

## 09 · Private routing capability, request, and proof were conflated

**Status:** clarified by a later source audit and merged upstream documentation
[PR #1983](https://github.com/KeeperHub/keeperhub/pull/1983).

The product pages promise MEV protection: KeeperHub "does not publish
intent-revealing transactions to public mempools when private routes are
available", with "private routing on supported chains". The hackathon brief
lists _Private routing. MEV protection via non-public submission paths_ as a
headline capability.

The MCP direct-execution tools provide no way to request it, and no direct
execution result proves that it happened. A later source audit found that
workflow write actions can request it with `usePrivateMempool: true`; this
workflow-only surface was absent from the action-schema result inspected below.

**Reproduction.** Search every live schema for
`private|mev|flashbot|protect|bundle|relay|mempool`:

- all 35 MCP tool input schemas → **0 matches**
- all 442 action schemas from `list_action_schemas` → **0 matches**

`execute_contract_call` exposes `gas_limit_multiplier`, `priority_fee_gwei`,
`value` and `idempotency_key`. Nothing route-related.

**The asymmetry is the sharpest part.** `get_direct_execution_status` reports
sponsorship but not routing:

```jsonc
{
  "sponsored": true, // observable and provable
  "retryCount": 0, // observable
  // no route / private / mempool field anywhere
}
```

So a builder can demonstrate gas sponsorship with evidence, but cannot prove
the submission route of an individual transaction from the execution result.

**Why it matters here.** LegacyKeeper's emergency evacuation is precisely the
transaction that must not be visible before inclusion: it announces "these
funds are moving, race me". LegacyKeeper therefore does not claim private
routing was used. Capability, workflow request, strict-versus-fallback behavior,
and observed execution proof are recorded as separate facts.

Sepolia may have no private route because private relays are mainnet
infrastructure. That would be a reasonable answer, but nothing in the API or
docs says so, and "when private routes are available" leaves a builder unable
to determine availability for their chain.

**Suggested fix, in order of usefulness:**

1. Return the submission path on the execution record, e.g.
   `"route": "private" | "public"`, alongside `sponsored`. This alone makes the
   feature demonstrable.
2. Document which chains have private routes available.
3. Allow the route to be requested explicitly, and report when a request could
   not be honoured instead of silently falling back to the public mempool.

**Upstream result:** PR #1983 documents the capability flag, workflow opt-in,
strict mode, public fallback, the sponsorship tradeoff, and the lack of
per-transaction route evidence. Direct execution still exposes no route input.

---

<a id="10"></a>

## 10 · Marketplace listings take no inputs, so a paid check cannot be pointed at your own contract

**Status:** confirmed by paying for one.

We paid $0.01 for `approval-risk-rescan` to get an independent read of an ERC-20
allowance. The payment worked end to end
([Base tx](https://basescan.org/tx/0xc91e3026f9695639fb2e262677b4e77a752efae89a7c32312f0319bc11074728),
execution `9kctohfxdeqgrl2pv5kym`). The result did not answer our question.

The listing's `inputSchema` is `{"type": "object"}` with no properties, and
`call_workflow` requires an `inputs` record that the workflow then ignores. It
reads a hardcoded demo LINK approval on Sepolia and returned `MAX_UINT256` for
an address we have never interacted with.

So the rail works and the listing runs, but a buyer cannot ask it about their
own contract. As a marketplace primitive that is a significant limit: the
listings we browsed are workflow demonstrations, not services you
can point at your own state. `search_workflows` does return an `inputSchema`
per listing, so the mechanism for parameterised listings appears to exist and
is not used by the listings currently published.

**What we did instead:** kept the payment as proof the x402 path works, and
stopped claiming it verifies our allowance, because it does not. The honest
version of this product role needs a listing that accepts a contract address
and token, which means publishing one ourselves.

**Suggested fix:** encourage or require a meaningful `inputSchema` on paid
listings, and surface it in `search_workflows` output so a buyer can tell
before paying whether a listing can answer their question. Right now the only
way to find out is to pay.
