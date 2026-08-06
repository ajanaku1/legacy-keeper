#!/usr/bin/env bash
# Public verification entry point for contracts, agent, and dashboard.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

rpc_result() {
  local method="$1" params="$2" payload response error
  payload="$(jq -cn --arg method "$method" --argjson params "$params" \
    '{jsonrpc:"2.0",id:1,method:$method,params:$params}')"
  response="$(curl --fail-with-body -sS \
    -H 'Content-Type: application/json' \
    --data "$payload" "$SEPOLIA_RPC_URL")"
  error="$(jq -r '.error.message // empty' <<<"$response")"
  if [ -n "$error" ]; then
    echo "Sepolia RPC error: $error" >&2
    return 1
  fi
  jq -c '.result' <<<"$response"
}

address_topic() {
  printf '0x%064s' "${1#0x}" | tr '[:upper:] ' '[:lower:]0'
}

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

event_signature_topic() {
  node -e \
    'const { id } = require("ethers"); process.stdout.write(id(process.argv[1]))' \
    "$1"
}

require_successful_receipt() {
  local receipt="$1" label="$2"
  if [ "$(jq -r '.status // empty' <<<"$receipt")" != "0x1" ]; then
    echo "$label transaction did not succeed" >&2
    return 1
  fi
}

verify_plan_created_log() {
  local receipt="$1" factory="$2" owner_topic="$3" plan_topic="$4"
  jq -e --arg address "$(lowercase "$factory")" --arg owner "$owner_topic" \
    --arg plan "$plan_topic" \
    --arg event "$(event_signature_topic 'PlanCreated(address,address,uint256)')" '
      any(.logs[]?;
        (.address | ascii_downcase) == $address and
        (.topics[0] | ascii_downcase) == $event and
        (.topics[1] | ascii_downcase) == $owner and
        (.topics[2] | ascii_downcase) == $plan)
    ' <<<"$receipt" >/dev/null
}

heartbeat_event_data() {
  local receipt="$1" plan="$2" owner_topic="$3"
  jq -r --arg address "$(lowercase "$plan")" --arg owner "$owner_topic" \
    --arg event "$(event_signature_topic 'HeartbeatRecorded(address,uint64)')" '
    first(.logs[]? |
      select(
        (.address | ascii_downcase) == $address and
        (.topics[0] | ascii_downcase) == $event and
        (.topics[1] | ascii_downcase) == $owner
      ) | .data) // empty
  ' <<<"$receipt"
}

eth_call_word() {
  local contract="$1" data="$2"
  rpc_result eth_call \
    "[{\"to\":\"$contract\",\"data\":\"$data\"},\"latest\"]" | jq -r .
}

verify_deployed_plan() {
  local factory="$1" owner_topic="$2" owner_hex="$3" plan="$4" plan_hex="$5"
  local plan_word code owner_word initialized_word
  plan_word="$(eth_call_word "$factory" "0x94a78483${owner_topic#0x}")"
  [ "${plan_word: -40}" = "$plan_hex" ]
  code="$(rpc_result eth_getCode "[\"$plan\",\"latest\"]" | jq -r .)"
  [ "$code" != "0x" ]
  owner_word="$(eth_call_word "$plan" 0x8da5cb5b)"
  [ "${owner_word: -40}" = "$owner_hex" ]
  initialized_word="$(eth_call_word "$plan" 0x158ef93e)"
  [ "${initialized_word: -1}" = "1" ]
}

verify_heartbeat_state() {
  local plan="$1" event_data="$2" expected="$3"
  local last_heartbeat_word last_heartbeat event_timestamp
  last_heartbeat_word="$(eth_call_word "$plan" 0x3d6e025e)"
  last_heartbeat_word="0x${last_heartbeat_word:2:64}"
  last_heartbeat="$(printf '%d' "$last_heartbeat_word")"
  event_timestamp="$(printf '%d' "$event_data")"
  [ "$last_heartbeat" = "$expected" ]
  [ "$event_timestamp" = "$last_heartbeat" ]
}

verify_live_sepolia() {
  if [ "$#" -ne 5 ]; then
    echo "usage: ./verify.sh live-sepolia PLAN_TX HEARTBEAT_TX OWNER PLAN LAST_HEARTBEAT" >&2
    return 2
  fi
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
  : "${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL is required}"
  local factory="${NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS:?factory address is required}"
  local plan_receipt heartbeat_receipt owner_topic plan_topic heartbeat_data
  plan_receipt="$(rpc_result eth_getTransactionReceipt "[\"$1\"]")"
  heartbeat_receipt="$(rpc_result eth_getTransactionReceipt "[\"$2\"]")"
  require_successful_receipt "$plan_receipt" "plan creation"
  require_successful_receipt "$heartbeat_receipt" "heartbeat"
  owner_topic="$(address_topic "$3")"
  plan_topic="$(address_topic "$4")"
  verify_plan_created_log "$plan_receipt" "$factory" "$owner_topic" "$plan_topic"
  heartbeat_data="$(heartbeat_event_data "$heartbeat_receipt" "$4" "$owner_topic")"
  [ -n "$heartbeat_data" ]
  verify_deployed_plan "$factory" "$owner_topic" \
    "$(lowercase "${3#0x}")" "$4" "$(lowercase "${4#0x}")"
  verify_heartbeat_state "$4" "$heartbeat_data" "$5"

  echo "PASS  Sepolia plan receipt, registry, bytecode, owner and initialization"
  echo "PASS  Sepolia heartbeat receipt, event and lastHeartbeat=$5"
}

if [ "${1:-}" = "live-sepolia" ]; then
  shift
  verify_live_sepolia "$@"
  exit $?
fi

if [ "$#" -ne 0 ]; then
  echo "usage: ./verify.sh [live-sepolia PLAN_TX HEARTBEAT_TX OWNER PLAN LAST_HEARTBEAT]" >&2
  exit 2
fi

cd "$PROJECT_ROOT"
npm run compile
npm test
npm run test:agent
npm run test:dashboard
npm --prefix dashboard run typecheck
npm --prefix dashboard run build
npm --prefix dashboard run test:e2e

echo "PASS  LegacyKeeper contracts, agent, dashboard, build, and browser journeys"
