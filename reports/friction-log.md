# KeeperHub friction log

Running notes from building LegacyKeeper, captured as they happen. Entries that
firm up into reproducible issues get filed upstream (see `plan.md` for the
posting checkpoint). Raw notes here are cheap; reconstructing them later is not.

## Index, ranked by what it costs a new builder

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| [07](#07) | A reused `idempotency_key` silently replays a cached failure, making agent recovery impossible | **Critical** | Confirmed live |
| [03](#03) | `execute_contract_call` scalar types disagree with the schema it advertises | **High** | Confirmed |
| [06](#06) | `status: "completed"` means settled, not successful | **High** | Confirmed, cost us a real bug |
| [09](#09) | Private routing is advertised but has no API surface and no observability | **High** | Confirmed |
| [02](#02) | The workflow schema exists but is undiscoverable from the docs | Medium | Corrected |
| [08](#08) | `validate_workflow` cannot validate a definition before it exists | Medium | Confirmed |
| [04](#04) | Handshake ordering, header-borne session id, SSE framing | Medium | Confirmed |
| [01](#01) | Gas sponsorship scope reads as Base/Tempo-only but works on Sepolia | Low | Resolved |
| [05](#05) | `gas_limit_multiplier` is clamped, so you cannot test your own failure handling | Low | Positive finding |

Entries below are in the order they were discovered, not ranked order.

---

## 01 · Where gas sponsorship applies is ambiguous

**Status:** RESOLVED empirically — sponsorship works on Sepolia.

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

## 05 · `gas_limit_multiplier` is clamped — you cannot underprice into a stuck tx

**Status:** confirmed. Positive finding, worth documenting as a feature.

Attempting to induce a stuck transaction by starving gas failed at every level
tried — `0.3`, then `0.02`. All landed successfully. KeeperHub appears to floor
the multiplier at whatever its estimator considers safe.

This is exactly the "transactions execute instead of getting stuck" promise,
and it holds under deliberate attack. Worth stating outright in the docs: the
multiplier can raise a gas limit but cannot lower it below a safe floor.

Consequence for builders: **you cannot use `gas_limit_multiplier` to test your
own failure handling.** We had to reach for a different failure vector to
exercise our retry path.

---

## 07 · A reused `idempotency_key` silently replays a cached failure

**Status:** confirmed on a live Sepolia contract. Highest-severity finding.

`execute_contract_call` accepts an `idempotency_key`. The obvious reading —
"one key per logical action, so retries cannot double-submit" — produces an
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
irreversible, time-critical action, and it is invisible — the agent gets a
plausible, contract-shaped error message rather than a cache-hit signal.
Nothing in the response distinguishes a fresh revert from a replayed one.

**Fix we adopted:** scope the key per *attempt*
(`${executionKey}-a${attempt}`). Transport-level duplicates of a single
attempt are still deduplicated, and the contract's own executed flags remain
the real guard against double distribution — which is where that guarantee
belongs anyway.

**Suggested fix upstream:** document that the key caches outcomes including
failures, and either surface a `cached: true` field on replayed responses or
scope caching to successful executions only. As written, the parameter's name
suggests safety while the behaviour introduces a liveness bug.

---

## 06 · `status: "completed"` does not mean the call succeeded

**Status:** confirmed. Cost us a real bug.

`get_direct_execution_status` returns `status: "completed"` for a settled
execution, with success or failure carried separately in `result.success` and
`result.reverted`. A poller that treats `"completed"` as terminal-and-successful
is wrong, and one that omits it from its terminal set — as ours initially did —
waits out its entire timeout on a transaction that already landed, then reports
failure for a success.

Reporting a false *failure* is as damaging as a false success: an agent that
believes an irreversible action failed may try to compensate for something that
already happened.

**Suggested fix:** document the status vocabulary and the
`status` vs `result.success` split on the MCP page.

---

## 03 · `execute_contract_call` types disagree with the schema it advertises

**Status:** confirmed, reproducible. Strongest bounty candidate so far.

`tools/list` advertises `execute_contract_call` with properties
`chain_id` and `function_args`. The natural encoding — a numeric chain id and
a real JSON array of arguments — is rejected:

```
MCP error -32602: Input validation error:
  chain_id:      expected string, received number
  function_args: expected string, received array
```

`gas_limit_multiplier` is affected too. Every scalar on this tool must be a **string**, and `function_args` must be a JSON array *encoded as
a string*:

```jsonc
// rejected
{ "chain_id": 11155111,   "function_args": [] }
// accepted
{ "chain_id": "11155111", "function_args": "[]" }
```

Nothing in the tool description signals this, and `chain_id` as a string is
counter-intuitive enough that a builder will try the number first every time.
An agent generating calls from the schema alone produces invalid requests.

**Impact:** this is the first call anyone makes after the handshake, so it sits
directly on the critical path from signup to first transaction.

**Suggested fix:** either accept both encodings, or make the schema types
explicit (`"type": "string"` with a `"pattern"`/example on each). A one-line
example in the tool description would remove the guesswork entirely.

---

## 04 · The MCP handshake order is strict and easy to get wrong

**Status:** confirmed.

`tools/list` before the handshake returns:

```
-32003 Session not initialized
hint: Send `notifications/initialized` after `initialize` and BEFORE any
      `tools/list` or `tools/call`. These must be sequential, not parallel.
```

The hint is genuinely good — better than most error messages. Two things still
cost time: the session id arrives in the `Mcp-Session-Id` **response header**
rather than the body, which is easy to miss when hand-rolling a client; and
responses may come back either as plain JSON or as a single SSE `data:` frame
depending on the call, so a naive `JSON.parse` fails intermittently.

**Suggested fix:** document the header in the MCP page's auth section, and note
that responses can be SSE-framed.

---

## 02 · The workflow schema exists but is undiscoverable from the docs

**Status:** CORRECTED. My earlier claim — that no schema existed — was wrong.

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
matters most for exactly the audience the onboarding bounty targets — someone
authoring their first workflow in code, who will get it wrong several times.

---

<a id="09"></a>
## 09 · Private routing is advertised but has no API surface and no observability

**Status:** confirmed by exhaustive schema search.

The product pages promise MEV protection: KeeperHub "does not publish
intent-revealing transactions to public mempools when private routes are
available", with "private routing on supported chains". The hackathon brief
lists *Private routing. MEV protection via non-public submission paths* as a
headline capability.

There is no way to request it, and no way to tell whether it happened.

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
  "sponsored": true,        // observable — we can prove this
  "retryCount": 0,          // observable
  // no route / private / mempool field anywhere
}
```

So a builder can demonstrate gas sponsorship with evidence, and cannot
demonstrate private routing at all.

**Why it matters here.** LegacyKeeper's emergency evacuation is precisely the
transaction that must not be visible before inclusion: it announces "these
funds are moving, race me". Private routing is the difference between an
evacuation and a front-run evacuation. We built an explicit route policy that
requests it for evacuation and sponsorship for liveness, and we cannot verify
the request was honoured. Our UI therefore says "private routing requested",
never "used" — the only honest wording available.

Sepolia may simply have no private route, since private relays are mainnet
infrastructure. That would be a reasonable answer, but nothing in the API or
docs says so, and "when private routes are available" leaves a builder unable
to determine availability for their chain.

**Suggested fix, in order of usefulness:**

1. Return the submission path on the execution record, e.g.
   `"route": "private" | "public"`, alongside `sponsored`. This alone makes the
   feature demonstrable.
2. Document which chains have private routes available.
3. Allow the route to be requested explicitly, and report when a request could
   not be honoured, rather than silently falling back to the public mempool.

**Open question for the team:** is private routing applied automatically on
eligible chains, is it an organisation-level setting, and is Sepolia eligible?
