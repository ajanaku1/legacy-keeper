#!/usr/bin/env bash
# LegacyKeeper verification harness.
#
# Per CLAUDE.md this script has the final vote. Nothing is "done" because it
# looks finished; it is done when the gate below prints PASS.
#
# Usage:  bash loop/guardrails/verify.sh [phase-0|...|phase-5] [--quiet]
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
PHASE_FILTER=""
for ARG in "$@"; do
  case "$ARG" in
    --quiet) QUIET=1 ;;
    phase-[0-5]) PHASE_FILTER="$ARG" ;;
    *) echo "unknown argument: $ARG"; exit 2 ;;
  esac
done

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

# ── G9 · Agent reliability suite ──────────────────────────────────────
# MCP handshake, SSE framing, session expiry, 402, per-attempt idempotency,
# settlement-vs-receipt disagreement, and route exclusivity — all against a
# local fake server, because you cannot ask production to fail on cue.
if [ ! -d node_modules ]; then
  fail "G9 agent tests" "node_modules missing"
elif npx vitest run >/tmp/lk-vitest.log 2>&1; then
  AGENT_COUNT=$(grep -oE 'Tests +[0-9]+ passed' /tmp/lk-vitest.log | grep -oE '[0-9]+' | head -1)
  pass "G9 agent tests (${AGENT_COUNT:-?} passed)"
else
  fail "G9 agent tests" "$(grep -E 'FAIL|✕' /tmp/lk-vitest.log | head -3 | sed 's/^/          /')"
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
  fail "G7 dashboard typecheck" "dashboard/node_modules missing"
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
  # Fabricated VALUES — hashes, signatures, canned success payloads.
  # shellcheck disable=SC2086
  BANNED_HITS=$(grep -rniE \
    "repeat\(64\)|repeat\(130\)|simulated success|simulate.*for the hackathon|fake ?tx|dummy ?hash|0xa{40,}" \
    $SCAN_DIRS 2>/dev/null | grep -v "verify.sh")

  # Stub LANGUAGE. This class slipped through for three phases: bot/index.ts
  # had zero network calls and returned a hardcoded true, while the gate stayed
  # green because it only looked for fabricated hashes. A module that says it
  # will do something "in production" is not doing it now.
  # shellcheck disable=SC2086
  STUB_HITS=$(grep -rniE \
    "in production, this|for now, return|stub implementation|not implemented|placeholder — real|TODO: implement" \
    $SCAN_DIRS 2>/dev/null | grep -v "verify.sh")
  [ -n "$STUB_HITS" ] && BANNED_HITS="${BANNED_HITS}${BANNED_HITS:+
}${STUB_HITS}"
fi

if [ -z "$BANNED_HITS" ]; then
  pass "G3 no fabricated success values or stub modules"
else
  fail "G3 no fabricated success values or stub modules" \
    "$(echo "$BANNED_HITS" | head -6 | sed 's/^/          /')"
fi

# ── G8 · A module that names an external API must actually call it ─────
# bot/index.ts documented "POST https://api.telegram.org/..." in a comment and
# never issued a request. Claiming an integration in prose is not integrating.
# Only COMMENTED API references count. Naming an endpoint in prose while
# never calling it is the bot/index.ts failure mode. A URL used as a config
# default and handed to a client that does the fetching is legitimate.
API_LIARS=""
for f in $(find agent bot -name "*.ts" 2>/dev/null); do
  if grep -qiE "^\s*(//|\*).*https?://(api|app)\.[a-z0-9.-]+" "$f" 2>/dev/null; then
    grep -qE "fetch\(|axios|request\(" "$f" 2>/dev/null || API_LIARS="${API_LIARS}${f}
"
  fi
done

if [ -z "$API_LIARS" ]; then
  pass "G8 modules that name an API actually call it"
else
  fail "G8 modules that name an API actually call it" \
    "$(printf '%s' "$API_LIARS" | sed 's/^/          /')"
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

# ── G10 · Every Goal.md predicate maps to a gate or a named artifact ──
# prompt.md's definition of done requires this mapping to exist and hold.
# Phase runs prove their own subset below. The full run alone requires every
# Goal.md predicate to have closed evidence; an `open` row is intentionally RED.
if [ -z "$PHASE_FILTER" ]; then
  EV=loop/guardrails/evidence.tsv
  if [ ! -f "$EV" ]; then
    fail "G10 evidence map" "$EV missing"
  else
  MISSING=""
  OPEN_COUNT=0
  while IFS=$'\t' read -r predicate kind ref note; do
    case "$predicate" in ''|\#*) continue;; esac
    case "$kind" in
      gate)
        echo "$ref" | grep -qE '^G[0-9]+$' \
          || MISSING="${MISSING}  ${predicate}: invalid gate reference $ref
"
        ;;
      file)
        [ -s "$ref" ] || MISSING="${MISSING}  ${predicate}: missing or empty $ref
"
        ;;
      tx)
        # 32-byte hash, so a placeholder cannot pass for evidence.
        echo "$ref" | grep -qE '^0x[a-fA-F0-9]{64}$' \
          || MISSING="${MISSING}  ${predicate}: not a valid tx hash
"
        ;;
      exec)
        echo "$ref" | grep -qE '^[a-zA-Z0-9_-]{12,}$' \
          || MISSING="${MISSING}  ${predicate}: invalid KeeperHub execution id
"
        ;;
      open)
        OPEN_COUNT=$((OPEN_COUNT+1))
        ;;
      *)
        MISSING="${MISSING}  ${predicate}: unknown evidence kind $kind
"
        ;;
    esac
  done < "$EV"

  TOTAL=$(grep -vcE '^\s*#|^\s*$' "$EV")
  if [ -z "$MISSING" ] && [ "$OPEN_COUNT" -eq 0 ]; then
    pass "G10 evidence map ($TOTAL/$TOTAL proven)"
  else
    fail "G10 evidence map" "$(printf '%s' "${MISSING}${OPEN_COUNT} predicate(s) still open" | head -5)"
  fi
  fi
fi

# ── Phase completion predicates ───────────────────────────────────────
# These start RED. They assert judge-visible artifacts and behavior that the
# current prototype does not yet provide. Never weaken them to fit the build.
phase_wanted() {
  [ -z "$PHASE_FILTER" ] || [ "$PHASE_FILTER" = "$1" ]
}

phase_assert() {
  local phase="$1" description="$2" command="$3"
  phase_wanted "$phase" || return 0
  if bash -c "$command" >/tmp/lk-${phase}.log 2>&1; then
    pass "$phase $description"
  else
    fail "$phase $description" "see /tmp/lk-${phase}.log"
  fi
}

phase_assert phase-0 "84/100 truth baseline and evidence taxonomy" '
  test -s reports/judging-baseline.md &&
  grep -q "84/100" reports/judging-baseline.md &&
  for status in discovered configured enabled triggered settled verified; do
    grep -qi "$status" reports/judging-baseline.md || exit 1
  done &&
  grep -qi "all five are disabled" reports/judging-baseline.md &&
  grep -q "unknown evidence kind" loop/guardrails/verify.sh
'

phase_assert phase-1 "fail-closed executor regression suite" '
  test -s test/agent/executor-integrity.test.ts &&
  grep -qi "missing.*execution" test/agent/executor-integrity.test.ts &&
  grep -qi "receipt" test/agent/executor-integrity.test.ts &&
  grep -qi "resulting state\|product state" test/agent/executor-integrity.test.ts &&
  grep -qi "429\|500\|5xx" test/agent/executor-integrity.test.ts &&
  ! grep -q "{ outcome: .success., txHash: parsed" agent/executor/keeperhub.ts &&
  grep -q "response.ok" agent/keeperhub/mcp-client.ts &&
  ! grep -RniE "(: any\\b|<any>|as any\\b|any\\[\\])" agent bot dashboard/app dashboard/components dashboard/lib workflows scripts --include="*.ts" --include="*.tsx"
'

phase_assert phase-2 "enabled automatic KeeperHub workflow evidence" '
  test -s reports/live-workflow-evidence.json &&
  jq -e '\''
    ([.workflows[] | select(.enabled == true and (.runId | type == "string") and (.runId | length > 0)) | .trigger] | unique) as $t |
    ($t | index("Schedule")) != null and
    ($t | index("Webhook")) != null and
    ($t | index("Event")) != null and
    ($t | index("Block")) != null and
    any(.workflows[]; (.txHash // "") | test("^0x[0-9a-fA-F]{64}$"))
  '\'' reports/live-workflow-evidence.json >/dev/null
'

phase_assert phase-3 "autonomous paid-rail evidence" '
  test -s reports/paid-rail-evidence.json &&
  jq -e '\''
    .x402.challenge == true and
    .x402.policyApproved == true and
    (.x402.paymentTx | test("^0x[0-9a-fA-F]{64}$")) and
    .x402.retried == true and
    .x402.resultConsumed == true and
    ((.mpp.demonstrated == true) or ((.mpp.blocker // "") | length > 0))
  '\'' reports/paid-rail-evidence.json >/dev/null
'

phase_assert phase-4 "every product check-in routes through KeeperHub" '
  test -s dashboard/app/api/heartbeat/route.ts &&
  grep -Rqi "signTypedData" dashboard/app dashboard/components dashboard/lib &&
  grep -q "KEEPERHUB_API_KEY" dashboard/app/api/heartbeat/route.ts &&
  grep -qi "execute_workflow\|heartbeat-relay" dashboard/app/api/heartbeat/route.ts &&
  grep -qi "verifyTypedData\|recoverTypedDataAddress" dashboard/app/api/heartbeat/route.ts &&
  ! grep -R "functionName: .heartbeat." dashboard bot --include="*.ts" --include="*.tsx" &&
  test -s dashboard/test/heartbeat-route.test.ts
'

phase_assert phase-5 "judge-runnable onboarding and submission assets" '
  test -s starter/setup.sh &&
  ! grep -q "OWNER_PRIVATE_KEY\|RECOVERY_PUBLIC_KEY\|templates/inheritance-workflow\|npm run deploy:contract" starter/setup.sh &&
  test -s dashboard/public/legacykeeper-screenshot.png &&
  ! grep -q "TODO: Add screenshot" README.md &&
  grep -qiE "demo video.*https?://|https?://(www\\.)?(youtube|youtu\\.be|loom|vimeo)" README.md
'

if [ -z "$PHASE_FILTER" ] || [ "$PHASE_FILTER" = "phase-4" ] || [ "$PHASE_FILTER" = "phase-5" ]; then
  echo "manual checks:"
  echo "  - selected mark remains legible at 16px"
  echo "  - selected dashboard proposal is implemented faithfully"
  echo "  - demo pacing and claims are judge-clear"
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
