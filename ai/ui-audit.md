# UI Audit Report — LegacyKeeper proposal gate

**Date:** 2026-08-03
**Scope:** Existing dashboard as input to three standalone proposal directions
**Automated result:** 11 files scanned, zero hard-rule violations

## Executive summary

The existing dashboard is mechanically sound: two radii, a 4px spacing scale,
visible focus treatment, 44px controls, reduced-motion handling, semantic
structure, and no banned animation patterns. Its design and state model are no
longer aligned with the selected dark-green identity or the required
KeeperHub-first product journey.

## Priority findings

| Priority | Finding | Severity |
|---:|---|---:|
| 1 | Heartbeat UI does not expose signing → KeeperHub submission → settlement → independent verification | 3 |
| 2 | Accepted execution can be visually conflated with verified success | 3 |
| 3 | Failure history lacks an explicit retry/recovery action | 3 |
| 4 | Recovery-key preparation and server-side evacuation submission are not represented as separate trust boundaries | 3 |
| 5 | Route confidence lacks field-level evidence and an honest unavailable state | 2 |
| 6 | Existing warm paper/forest/clay theme conflicts with the selected dark KeeperHub-green identity | 2 |
| 7 | Evidence is presented as a ledger, but the current action and its proof are spatially separated | 2 |
| 8 | Technical identifiers are visible without enough plain-language interpretation | 1 |
| 9 | Loading and empty states exist but do not teach the next safe action | 1 |
| 10 | The selected mark is not yet integrated into hierarchy or status language | 1 |

## Heuristic scores

| Heuristic | Score | Note |
|---|---:|---|
| System status | 3 | Missing explicit multi-stage transaction lifecycle |
| Real-world match | 2 | Settlement terminology needs plain-language pairing |
| User control | 1 | Confirmation exists; retry path needs stronger placement |
| Consistency | 1 | Mechanics consistent; identity now stale |
| Error prevention | 2 | Trust boundaries need clearer pre-submit review |
| Recognition | 1 | IDs need interpretation beside raw evidence |
| Flexibility | 1 | Main safe path is clear; emergency fallback needs separation |
| Minimalism | 1 | Evidence density is justified but action/proof grouping can improve |
| Error recovery | 3 | Failure has history but insufficient recovery guidance |
| Help/docs | 1 | Complex route-confidence semantics need contextual explanation |

## Approved-scope proposal plan

1. Establish one dark-only token system using the selected shield and KeeperHub greens.
2. Make sponsored heartbeat the single primary action in normal operation.
3. Show five lifecycle checkpoints: sign, submit, settle, verify receipt, verify state.
4. Pair raw execution IDs and hashes with plain-language evidence meaning.
5. Give failed attempts a visible recovery path without hiding historical failure.
6. Separate recovery-key preparation from server-side KeeperHub submission.
7. Render private routing as unavailable unless returned route evidence exists.
8. Keep one or two radii, 4/8px spacing, ≥44px controls, strong focus, and reduced motion.
9. Produce the agreed three directions: minimal evolution, action/evidence split, incident console.
10. Run the automated audit and visual hierarchy checks on every proposal.
