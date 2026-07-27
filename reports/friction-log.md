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
