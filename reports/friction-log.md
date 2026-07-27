# KeeperHub friction log

Running notes from building LegacyKeeper, captured as they happen. Entries that
firm up into reproducible issues get filed upstream (see `plan.md` for the
posting checkpoint). Raw notes here are cheap; reconstructing them later is not.

---

## 01 · Where gas sponsorship applies is ambiguous

**Status:** open question, needs empirical confirmation in Phase 2.

The hackathon brief states *"KeeperHub offers gas sponsorship on mainnet
Ethereum."* The agentic-wallet docs describe gas being covered by the x402
facilitator on **Base** and the MPP facilitator on **Tempo**, and state that
default signing is restricted to Base USDC and Tempo USDC.e with *"other chains
are not yet supported."*

These may describe two different features — workflow-execution sponsorship
versus agentic-wallet payment settlement — but a new builder reading both
cannot tell which applies to a plain `execute_contract_call` on Sepolia or
mainnet. This matters for LegacyKeeper because gasless heartbeat relaying is a
designed feature (`heartbeatBySig`), and whether it works depends entirely on
the answer.

**To confirm:** execute a sponsored contract call on Sepolia and on mainnet,
and record which one the facilitator actually covers.

**Why it's worth reporting:** the onboarding path "signup → first sponsored
transaction" is exactly the bounty's target, and this is the first fork in the
road where a builder has to guess.

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

Both must be **strings**, and `function_args` must be a JSON array *encoded as
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
