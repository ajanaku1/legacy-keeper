# LegacyKeeper Proposal State Model

The proposal gate is a static design exercise, but every screen represents the
same real product state so the selected direction can later map cleanly into the
dashboard.

## Core state

- Wallet: connection status, account, network, KeeperHub availability
- Liveness: last heartbeat, timeout, grace period, next check, countdown state
- Beneficiaries: address, label, share basis points, validation total
- Recovery: vault address, recovery-key status, private-routing status
- Heartbeat flow: idle, signing EIP-712, signature ready, submitting to the
  server route, KeeperHub accepted, settling, receipt verifying, product-state
  verifying, verified, failed, retry available
- Panic flow: idle, recovery payload prepared, recovery signature ready,
  confirmation open, KeeperHub accepted, settling, receipt verifying, verified,
  failed, retry available
- Execution: trigger, action, simulation, attempt count, KeeperHub execution ID,
  native run ID, transaction hash, receipt status, expected event, independently
  verified resulting state, sponsorship, gas used, outcome, timestamp
- Route confidence: supported request fields, submitted route preference,
  returned route evidence, and an honest unavailable state when KeeperHub does
  not expose proof

## Required transitions

1. A heartbeat resets the liveness countdown only after KeeperHub settlement,
   successful receipt, expected event, and advanced onchain `lastHeartbeat`.
2. Beneficiary edits are valid only when shares total 10,000 basis points.
3. Panic requires a locally prepared recovery-key payload and deliberate
   confirmation before any server-side KeeperHub submission state.
4. A failed execution remains visible and is grouped with its later retry.
5. Empty, loading, error, and successful execution states all provide a next
   action; ambiguous acceptance never renders as success.
6. Every normal check-in exposes one readable lifecycle: signed → submitted →
   settled → receipt verified → product state verified.

## Proposal-only behavior

The HTML proposals are interactive previews. Their controls never submit a
transaction. Any confirmed panic action resolves to an explicit “preview only”
message so a proposal cannot be mistaken for execution evidence.
