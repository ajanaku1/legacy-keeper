# Best Onboarding UX Improvement

## Outcome

LegacyKeeper reduces the path from a clean clone to a first verified KeeperHub
transaction to one credential and one command after installation:

```bash
npm ci
KEEPERHUB_API_KEY=kh_your_key_here npm run first-tx
```

No funded wallet, deployer key, RPC key, webhook key, workflow ID, database, or
Telegram setup is required. The command creates one sponsored Sepolia plan and
reports success only after independently verifying its receipt, event, factory
registration, deployed bytecode, owner, and initialization state.

The retained live run reached verified proof in **74.3 seconds**:

- KeeperHub execution: `xcdvqyd7e552hhlnhd0vf`
- [Sepolia transaction `0x2f39…bbca`](https://sepolia.etherscan.io/tx/0x2f39e73bb20e3cea728da830708e2a2a9f98e590fb0638307ec5afee8025bbca)
- [Sanitized benchmark evidence](first-transaction-benchmark.json)
- [Runnable quickstart](../starter/README.md)

The clock starts before the MCP handshake and stops after independent onchain
verification. Clone, dependency installation, and API-key acquisition are not
included and are stated separately instead of being hidden in the number.

## KeeperHub improvements produced by the build

The contribution separates authorship from influence:

| Contribution                          | Entrant role                                                                                                          | Upstream result                                                                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Natural MCP argument encoding         | Authored [issue #1841](https://github.com/KeeperHub/keeperhub/issues/1841) and performed the hosted regression retest | Pico's merged [PR #1848](https://github.com/KeeperHub/keeperhub/pull/1848) explicitly credits the report; natural values now work                                                                                                                                      |
| Idempotency replay and retry safety   | Authored [issue #1840](https://github.com/KeeperHub/keeperhub/issues/1840), its reproduction, and client policy       | Other contributors shipped replay visibility in [PR #1884](https://github.com/KeeperHub/keeperhub/pull/1884) and retry guidance in [PR #1922](https://github.com/KeeperHub/keeperhub/pull/1922); the reproduction is the acceptance case for the pending execution fix |
| Private-routing documentation         | Authored the implementation                                                                                           | Entrant-authored [PR #1983](https://github.com/KeeperHub/keeperhub/pull/1983) merged                                                                                                                                                                                   |
| Candidate workflow validation wording | Documented the observed gap and workaround                                                                            | Independent PR [#1949](https://github.com/KeeperHub/keeperhub/pull/1949) closed without merging; candidate validation remains proposed, not claimed as shipped                                                                                                         |

## Deliverables

- [`starter/first-transaction.ts`](../starter/first-transaction.ts): executable,
  fail-closed, timed quickstart.
- [`starter/README.md`](../starter/README.md): minimal one-key instructions.
- [`keeperhub-onboarding-teardown.md`](keeperhub-onboarding-teardown.md): field
  teardown from first tool call to verified transaction, including prioritized
  fixes and acceptance criteria.
- [`friction-log.md`](friction-log.md): chronological reproductions and honest
  corrections as KeeperHub changed.
- [`first-transaction-benchmark.json`](first-transaction-benchmark.json):
  sanitized live evidence.
- [`test/agent/first-transaction.test.ts`](../test/agent/first-transaction.test.ts):
  regression coverage for request construction, settlement, verification,
  placeholder handling, and retained evidence.

## Remaining limitation

The quickstart demonstrates the shortest direct-execution path against the
existing verified LegacyKeeper factory. The complete product tutorial remains
intentionally separate because deploying a new factory, publishing four
wallet-scoped workflows, and configuring application infrastructure solve a
different onboarding problem.
