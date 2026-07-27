# LegacyKeeper Proposal State Model

The proposal gate is a static design exercise, but every screen represents the
same real product state so the selected direction can later map cleanly into the
dashboard.

## Core state

- Wallet: connection status, account, network, KeeperHub availability
- Liveness: last heartbeat, timeout, grace period, next check, countdown state
- Beneficiaries: address, label, share basis points, validation total
- Recovery: vault address, recovery-key status, private-routing status
- Panic flow: idle, confirmation open, submitting, accepted, failed
- Execution: trigger, action, simulation, attempts, KeeperHub execution ID,
  transaction hash, gas used, outcome, timestamp

## Required transitions

1. A heartbeat resets the liveness countdown.
2. Beneficiary edits are valid only when shares total 10,000 basis points.
3. Panic requires a deliberate confirmation before any submission state.
4. A failed execution remains visible and is grouped with its later retry.
5. Empty, loading, error, and successful execution states all provide a next
   action.

## Proposal-only behavior

The HTML proposals are interactive previews. Their controls never submit a
transaction. Any confirmed panic action resolves to an explicit “preview only”
message so a proposal cannot be mistaken for execution evidence.
