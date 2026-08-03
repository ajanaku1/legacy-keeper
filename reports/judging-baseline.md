# LegacyKeeper judging baseline

Captured on 2026-08-01 before submission hardening. This is a truth baseline,
not a forecast of the final score.

## Score: 84/100

| Criterion | Weight | Score | Evidence at baseline |
|---|---:|---:|---|
| Onchain execution via KeeperHub | 35 | 34 | Successful inheritance, evacuation, sponsored heartbeat, and workflow heartbeat receipts |
| KeeperHub surfaces | 20 | 16 | Aggregate MCP, direct execution, workflow CRUD/export, sponsorship, audit status, and x402; automatic triggers disabled |
| Reliability and observability | 20 | 13 | Retry ledger and adversarial tests exist; executor can still infer success without sufficient evidence |
| Originality and usefulness | 15 | 14 | Coherent inheritance and compromised-wallet recovery use case |
| Integration quality and DX | 10 | 7 | Strong tests and architecture; stale starter, direct dashboard heartbeat, and incomplete submission assets |

The evidence ladder is strict: **discovered → configured → enabled → triggered →
settled → verified**. A higher label includes the lower steps, but an artifact at
one step never proves the next. In particular, an exported workflow with
`enabled: false` is configured—not live—and a KeeperHub `completed` status is
settled—not necessarily successful or independently verified.

## Preserved proof

| Journey | Evidence | Classification |
|---|---|---|
| Inheritance distribution | `0x3e8505e2…`, `0x6efe67a5…` | Verified transaction and contract events |
| Emergency evacuation | `0x9fe43045…` | Verified transaction and contract events |
| Sponsored heartbeat | `0x0041106b…` | Settled transaction; KeeperHub record reports sponsorship |
| Heartbeat workflow | execution `i14i9t2o1vu2wob2nunh4`, tx `0x0993b361…` | Settled and independently verified onchain |
| x402 payment | Base tx `0xc91e3026…` | Payment settled; returned service result was not product-specific |

## Baseline gaps

- All five LegacyKeeper workflows exist in KeeperHub and round-trip from the
  platform, but all five are disabled. No automatic Schedule, Webhook, Event,
  or Block run is proven.
- The dashboard calls `heartbeat()` through the connected wallet instead of
  handing an EIP-712 signature to KeeperHub.
- Private routing has no request field or route confirmation evidence.
- MPP has no compatible funded demonstration.
- The executor does not yet require execution ID, transaction hash, successful
  receipt, expected event, and resulting state before returning success.
- Screenshot, demo-video link, clean-clone proof, and submission links are open.

## Current platform probe

On 2026-08-01 the authenticated aggregate MCP identified itself as KeeperHub
`1.2.0` and exposed 35 tools. A read-only `list_workflows` call confirmed each
LegacyKeeper workflow ID and `enabled: false`; no remote state was changed.
