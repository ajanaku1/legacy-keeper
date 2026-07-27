# STATE

Decision log. Dependency proposals land here per `CLAUDE.md`.

## 2026-07-27 — Dependency override: Next.js dashboard (APPROVED)

`CLAUDE.md` says never add a dependency without asking. The user was shown the cost explicitly and chose the Next.js dashboard over a zero-dependency single-file alternative.

**Approved for `dashboard/package.json`:** `next`, `react`, `react-dom`, `wagmi`, `viem`, `@tanstack/react-query`, `tailwindcss`.

`dashboard/` gets its own `package.json`. The root stays Hardhat + agent, so Next's ESM and Hardhat's config resolution do not fight. Root `"type": "module"` must be removed — it breaks `hardhat.config.ts`.

Anything beyond this list is a fresh proposal: log it here and stop.

## 2026-07-27 — Network sequence

Sepolia first, mainnet only on explicit user go-ahead after Sepolia is proven. The hackathon requires a working transaction, not a mainnet one; the previous prompt's "mainnet required for submission" was an invented requirement and is dropped.

## 2026-07-27 — Why this is a rebuild

Review of the deepseek-v4/glm-2 build found: every execution path stubbed with a hardcoded `0x` + `'a'.repeat(64)` tx hash, eight critical contract bugs, zero tests, never compiled, not a git repo, and a fabricated KeeperHub integration surface (wrong auth header, invented workflow schema).

Root cause was the build contract, not the models. The old `prompt.md` mandated `code-reviewer` and `simplify` on every change but never required a test to pass, banned a stub, or defined a checkable done. Its skill-detection one-liner also scanned `$HOME/.Codex/skills`, a path that does not exist, so every skill reported MISSING and none were applied.
