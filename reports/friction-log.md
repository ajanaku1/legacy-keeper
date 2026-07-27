# KeeperHub friction log

Running notes from building LegacyKeeper, captured as they happen. Entries that
firm up into reproducible issues get filed upstream (see `plan.md` for the
posting checkpoint). Raw notes here are cheap; reconstructing them later is not.

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

## 02 · Docs describe no local workflow-definition schema

**Status:** observation, informs our design.

Workflows are defined via the visual builder, REST API, or MCP — there is no
documented JSON schema for defining one in-repo. The inherited build shipped
`starter/templates/*.json` in an invented schema that does not correspond to
anything the API accepts.

For a git-tracked, reviewable agent this is a real gap: there is no obvious way
to keep workflow definitions in version control alongside the code that depends
on them. Phase 2 will confirm what `create_workflow` actually accepts and
whether a round-trip (create → get → commit) is a usable pattern.
