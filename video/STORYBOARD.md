# LegacyKeeper storyboard

| Beat | Scene | Role | Claim | Evidence source |
|---|---|---|---|---|
| Hook | Accepted is not executed | Presentation | Agent acceptance is not transaction success | `Goal.md`, executor state machine |
| Problem | Four facts after acceptance | Explanation | Success requires settlement, receipt, event, and state | `agent/executor/keeperhub.ts`, integrity tests |
| Positioning | Signed request path | Explanation | Owner signs; KeeperHub sponsors; app verifies independently | heartbeat route and workflow export |
| Product reveal | Live dashboard | Evidence | Dashboard shows deployed state and real audit history | `dashboard/public/legacykeeper-screenshot.png` |
| Judge moment 1 | Sponsored check-in | Evidence | Webhook heartbeat settled on Sepolia with sponsorship | execution `9ysdci63m7ritc73lendt`, tx `0x291b...c2c3` |
| Judge moment 2 | Recovery and paid proof | Evidence | A failure recovered; x402 allowance result changed coverage | audit ledger, `reports/paid-rail-evidence.json` |
| Verifiable proof | Proof panel within judge scenes | Evidence | IDs and hashes map to retained artifacts | live workflow and paid-rail evidence JSON |
| Close | Verified system | Presentation | Five workflows, four automatic trigger types, 102 tests | manifest, live evidence, fresh test runs |

The close names the public repository as the next action. No scene simulates a
wallet signature, workflow run, receipt, or state change.
