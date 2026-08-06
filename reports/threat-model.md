# LegacyKeeper threat model

## Primary adversary

An attacker with **full use of the owner's wallet key**. Mode B claims to
survive this. Everything below is judged against that claim.

## Findings and resolutions (Phase 1)

| ID | Finding | Severity | Resolution |
|---|---|---|---|
| S1 | `registerRecoveryKey` was owner-callable and overwritable, so a compromised owner key could re-point the recovery key to the attacker and evacuate to their own vault. Mode B defended against nobody. | **Critical** | First registration is owner-only; rotation now requires a signature from the **current recovery key** (`rotateRecoveryKey`). |
| S1b | `setSafeVault` was owner-callable at any time. Redirecting the vault is equivalent to theft because evacuation would sweep straight to the attacker. | **Critical** | Owner-settable only until a recovery key exists; thereafter requires a recovery-key signature (`setSafeVaultBySig`). |
| S2 | Single-step `transferOwnership` let a stolen key lock the real owner out in one transaction. It also silently broke ERC-20 distribution, since allowances point at the previous owner. | **High** | Two-step: `transferOwnership` proposes, `acceptOwnership` completes. |
| S3 | `_safeTransferFrom` called `abi.decode(data,(bool))` on any non-empty return. A token returning fewer than 32 bytes reverted the entire distribution. | **Medium** | Explicit length handling: empty = success, `<32` bytes = failure, else decode. |
| S4 | One blocklisted beneficiary (USDC/USDT freeze) reverted ERC-20 distribution for everyone. | **High** | Pull-fallback mirroring the native path: failed delivery records `pendingTokenWithdrawal`, claimable via `claimToken`. |
| S5 | Unbounded beneficiary array could be configured past the block gas limit, making the estate permanently undistributable. | **Medium** | `MAX_BENEFICIARIES = 10`. |

Every row has a regression test in `test/LegacyKeeper.security.test.ts`.

## Wallet-scoped and Telegram findings

| ID | Finding | Severity | Resolution |
|---|---|---:|---|
| S6 | A caller could redirect a signed action to another plan. | **Critical** | Every route rereads `factory.planOf(owner)` and every workflow compares that address with the requested plan before writing. |
| S7 | A stolen Telegram deep link could bind the wrong person or wallet. | **High** | Five-minute opaque session, private-chat webhook identity, owner EIP-712 signature naming Telegram user ID, nonce, chain, and deadline. |
| S8 | Concurrent links could exceed the two-wallet allowance or assign two recipients to one wallet. | **High** | PostgreSQL row locking plus partial unique indexes enforce both limits transactionally. |
| S9 | Telegram account access could become evacuation authority. | **Critical** | `/evacuate` creates only a short-lived entry; the contract and server require the registered recovery-wallet signature. |
| S10 | A deployment could lose browser-only Telegram state and disclose link metadata before reauthentication. | **High** | Seven-day HMAC wallet session in an HttpOnly, Secure, SameSite cookie; invalid or absent sessions return 401 with no Telegram metadata. |
| S11 | A successful onchain action could be reported as failed because Telegram delivery failed. | **Medium** | Delivery is a post-verification side effect with independent idempotent state; it never changes the onchain result. |

## Accepted residual risks

- **Allowance revocation.** ERC-20 protection lasts only while the owner's
  allowance stands. Revoking it silently disables token inheritance. Mitigation
  is monitoring, not code. This is the product role assigned to the paid x402
  allowance re-scan.
- **Native ETH must be deposited.** An EOA's native balance cannot be pulled,
  so native inheritance requires funds held by the contract. Stated plainly in
  the UI and README instead of engineered around.
- **Recovery-key loss.** If the recovery key is lost, evacuation is
  unavailable; inheritance still functions. Rotation exists but requires the
  current key.
- **Ownership handover invalidates allowances.** After `acceptOwnership` the
  contract pulls from the new owner, who must grant fresh allowances.
- **Telegram availability.** Bot or database outages delay alerts; they do not
  stop already-authorized onchain actions. Users must not treat Telegram as the
  contract source of truth.
- **Free-tier background notifications.** Current wallet workflows contain no
  paid HTTP action and no wallet-specific direct Telegram node. Dashboard actions
  notify after verification; background event delivery depends on the authenticated
  integration route becoming callable from the active KeeperHub plan.
