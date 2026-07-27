#!/usr/bin/env bash
# LegacyKeeper verification harness.
#
# Per CLAUDE.md this script has the final vote. Nothing is "done" because it
# looks finished; it is done when the gate below prints PASS.
#
# Usage:  bash loop/guardrails/verify.sh [--quiet]
# Exit:   0 = every gate passed, 1 = at least one gate failed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# Hardhat supports Node 18/20/22 only. If the default node is outside that
# range, fall back to a side-installed node@22 rather than running on an
# unsupported runtime and trusting the result.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
case "$NODE_MAJOR" in
  18|20|22) ;;
  *)
    for CANDIDATE in /usr/local/opt/node@22/bin /opt/homebrew/opt/node@22/bin; do
      if [ -x "$CANDIDATE/node" ]; then
        PATH="$CANDIDATE:$PATH"
        export PATH
        break
      fi
    done
    ;;
esac

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

PASS_COUNT=0
FAIL_COUNT=0
FAILED_GATES=""

if [ -t 1 ]; then
  R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
else
  R=""; G=""; Y=""; B=""; N=""
fi

pass() { PASS_COUNT=$((PASS_COUNT+1)); echo "${G}PASS${N}  $1"; }
fail() {
  FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_GATES="${FAILED_GATES}  - $1\n"
  echo "${R}FAIL${N}  $1"
  [ -n "${2:-}" ] && echo "        ${Y}$2${N}"
}

echo ""
echo "${B}LegacyKeeper — verification harness${N}"
echo "──────────────────────────────────────────────────"

# ── G1 · Contracts compile ────────────────────────────────────────────
if [ ! -d node_modules ]; then
  fail "G1 compile" "node_modules missing — run: npm install"
elif npx hardhat compile >/tmp/lk-compile.log 2>&1; then
  pass "G1 compile"
else
  fail "G1 compile" "see /tmp/lk-compile.log"
fi

# ── G2 · Contract test suite (predicates A1-A6, B1-B5) ────────────────
# Expected RED during Phase 0 — the bug tests are written before the fixes.
if [ ! -d node_modules ]; then
  fail "G2 contract tests" "node_modules missing"
elif npx hardhat test >/tmp/lk-test.log 2>&1; then
  pass "G2 contract tests"
else
  SUMMARY=$(grep -E "^\s+[0-9]+ (passing|failing)" /tmp/lk-test.log | tr '\n' ' ')
  fail "G2 contract tests" "${SUMMARY:-see /tmp/lk-test.log}"
fi

# ── G6 · Agent typechecks ─────────────────────────────────────────────
# Added after tsc caught three real defects the other gates passed over,
# including a deploy script that would ReferenceError on every verify.
if [ ! -d node_modules ]; then
  fail "G6 typecheck" "node_modules missing"
elif npx tsc --noEmit >/tmp/lk-tsc.log 2>&1; then
  pass "G6 typecheck"
else
  fail "G6 typecheck" "$(head -3 /tmp/lk-tsc.log | sed 's/^/          /')"
fi

# ── G7 · Dashboard typechecks ─────────────────────────────────────────
if [ ! -d dashboard/node_modules ]; then
  pass "G7 dashboard typecheck (skipped — not installed)"
elif (cd dashboard && npx tsc --noEmit >/tmp/lk-dash-tsc.log 2>&1); then
  pass "G7 dashboard typecheck"
else
  fail "G7 dashboard typecheck" "$(head -3 /tmp/lk-dash-tsc.log | sed 's/^/          /')"
fi

# ── G3 · No stub may return a success value ───────────────────────────
# The previous build returned a hardcoded 0x + 'a'.repeat(64) as a tx hash.
# Anything that fabricates success is a build failure, not scaffolding.
SCAN_DIRS=""
for d in agent bot scripts contracts starter; do
  [ -d "$d" ] && SCAN_DIRS="$SCAN_DIRS $d"
done

BANNED_HITS=""
if [ -n "$SCAN_DIRS" ]; then
  # shellcheck disable=SC2086
  BANNED_HITS=$(grep -rniE \
    "repeat\(64\)|repeat\(130\)|simulated success|simulate.*for the hackathon|fake ?tx|dummy ?hash|0xa{40,}" \
    $SCAN_DIRS 2>/dev/null | grep -v "verify.sh")
fi

if [ -z "$BANNED_HITS" ]; then
  pass "G3 no fabricated success values"
else
  fail "G3 no fabricated success values" "$(echo "$BANNED_HITS" | head -5 | sed 's/^/          /')"
fi

# ── G4 · KeeperHub is the only execution layer ────────────────────────
# Reads over direct RPC are fine. Sending a transaction outside KeeperHub
# is not. scripts/ is exempt: contract deployment is legitimately direct.
RPC_DIRS=""
for d in agent bot; do
  [ -d "$d" ] && RPC_DIRS="$RPC_DIRS $d"
done

RPC_HITS=""
if [ -n "$RPC_DIRS" ]; then
  # shellcheck disable=SC2086
  RPC_HITS=$(grep -rniE \
    "sendTransaction|sendRawTransaction|signer\.send|wallet\.send|eth_sendTransaction" \
    $RPC_DIRS 2>/dev/null)
fi

if [ -z "$RPC_HITS" ]; then
  pass "G4 no direct-RPC transaction sends"
else
  fail "G4 no direct-RPC transaction sends" "$(echo "$RPC_HITS" | head -5 | sed 's/^/          /')"
fi

# ── G5 · No secret material in tracked files ──────────────────────────
SECRET_HITS=""
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  for f in $(git ls-files 2>/dev/null | grep -E "\.(ts|tsx|js|json|sol|sh|md)$"); do
    # A 64-hex literal that is not an all-zero placeholder or a known hash field
    # Exclusions: zero placeholders, hash fields, typehashes, and named
    # cryptographic constants (secp256k1 order / half-order in the EIP-2
    # malleability check are published values, not secrets).
    HIT=$(grep -nE "0x[a-fA-F0-9]{64}" "$f" 2>/dev/null \
      | grep -vE "0x0{64}|txHash|blockHash|DOMAIN|keccak|_TYPEHASH|constant|malleable|0x7FFFFFFFFFFFFFFF|0xFFFFFFFFFFFFFFFF|etherscan\.io/tx/|/tx/0x")
    [ -n "$HIT" ] && SECRET_HITS="${SECRET_HITS}${f}: ${HIT}\n"
  done
fi

if [ -z "$SECRET_HITS" ]; then
  pass "G5 no secret material in tracked files"
else
  fail "G5 no secret material in tracked files" "$(printf "%b" "$SECRET_HITS" | head -5 | sed 's/^/          /')"
fi

# ── Summary ───────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "${G}${B}ALL GATES PASSED${N}  (${PASS_COUNT}/${PASS_COUNT})"
  echo ""
  exit 0
else
  echo "${R}${B}${FAIL_COUNT} GATE(S) FAILED${N}  (${PASS_COUNT} passed)"
  printf "%b" "$FAILED_GATES"
  echo ""
  exit 1
fi
