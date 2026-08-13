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

function_selector() {
  local signature_hash
  signature_hash="$(event_signature_topic "$1")"
  printf '%s' "${signature_hash:0:10}"
}

uint256_word() {
  node -e \
    'process.stdout.write(BigInt(process.argv[1]).toString(16).padStart(64, "0"))' \
    "$1"
}

abi_string_data() {
  node -e '
    const { AbiCoder } = require("ethers");
    process.stdout.write(AbiCoder.defaultAbiCoder().encode(["string"], [process.argv[1]]));
  ' "$1"
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

verify_live_first_transaction() {
  if [ "$#" -ne 1 ]; then
    echo "usage: ./verify.sh live-first-transaction EVIDENCE_JSON" >&2
    return 2
  fi
  if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/.env"
    set +a
  fi
  case "${SEPOLIA_RPC_URL:-}" in
    ""|*your_key_here*) SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com" ;;
  esac

  local evidence="$1" factory owner plan tx expected_block receipt actual_block
  [ -f "$evidence" ]
  factory="$(jq -r '.factoryAddress' "$evidence")"
  owner="$(jq -r '.owner' "$evidence")"
  plan="$(jq -r '.planAddress' "$evidence")"
  tx="$(jq -r '.transactionHash' "$evidence")"
  expected_block="$(jq -r '.blockNumber' "$evidence")"
  receipt="$(rpc_result eth_getTransactionReceipt "[\"$tx\"]")"

  require_successful_receipt "$receipt" "first transaction"
  actual_block="$(printf '%d' "$(jq -r '.blockNumber' <<<"$receipt")")"
  [ "$actual_block" = "$expected_block" ]
  verify_plan_created_log "$receipt" "$factory" \
    "$(address_topic "$owner")" "$(address_topic "$plan")"
  verify_deployed_plan "$factory" "$(address_topic "$owner")" \
    "$(lowercase "${owner#0x}")" "$plan" "$(lowercase "${plan#0x}")"

  echo "PASS  First transaction receipt, block and PlanCreated event"
  echo "PASS  Factory mapping, plan bytecode, owner and initialization"
}

verify_configuration_event() {
  local receipt="$1" plan="$2" event_data expected_event_data
  expected_event_data="$(abi_string_data liveness_config)"
  event_data="$(jq -r \
    --arg address "$(lowercase "$plan")" \
    --arg event "$(event_signature_topic 'ConfigUpdated(string)')" '
      first(.logs[]? | select(
        (.address | ascii_downcase) == $address and
        (.topics[0] | ascii_downcase) == $event
      ) | .data) // empty
    ' <<<"$receipt")"
  [ "$(lowercase "$event_data")" = "$(lowercase "$expected_event_data")" ]
}

verify_configuration_identity() {
  local factory="$1" owner="$2" plan="$3" owner_topic plan_word owner_word
  owner_topic="$(address_topic "$owner")"
  plan_word="$(eth_call_word "$factory" "0x94a78483${owner_topic#0x}")"
  [ "${plan_word: -40}" = "$(lowercase "${plan#0x}")" ]
  owner_word="$(eth_call_word "$plan" 0x8da5cb5b)"
  [ "${owner_word: -40}" = "$(lowercase "${owner#0x}")" ]
}

verify_configuration_state() {
  local evidence="$1" plan="$2" heartbeat timeout grace liveness_data
  local heartbeat_actual timeout_actual grace_actual active_actual
  heartbeat="$(jq -r '.postState.heartbeatInterval' "$evidence")"
  timeout="$(jq -r '.postState.timeoutDuration' "$evidence")"
  grace="$(jq -r '.postState.gracePeriod' "$evidence")"
  liveness_data="$(eth_call_word "$plan" "$(function_selector 'liveness()')")"
  heartbeat_actual="$(printf '%d' "0x${liveness_data:2:64}")"
  timeout_actual="$(printf '%d' "0x${liveness_data:66:64}")"
  grace_actual="$(printf '%d' "0x${liveness_data:130:64}")"
  active_actual="${liveness_data: -1}"
  [ "$heartbeat_actual" = "$heartbeat" ]
  [ "$timeout_actual" = "$timeout" ]
  [ "$grace_actual" = "$grace" ]
  [ "$active_actual" = "1" ]
}

verify_configuration_nonce() {
  local evidence="$1" plan="$2" nonce action_typehash nonce_call nonce_used
  nonce="$(jq -r '.authorization.nonce' "$evidence")"
  action_typehash="$(event_signature_topic \
    'SetLivenessConfig(uint64 heartbeatInterval,uint64 timeoutDuration,uint64 gracePeriod,uint256 nonce,uint256 deadline)')"
  nonce_call="$(function_selector 'actionNonceUsed(bytes32,uint256)')${action_typehash#0x}$(uint256_word "$nonce")"
  nonce_used="$(eth_call_word "$plan" "$nonce_call")"
  [ "${nonce_used: -1}" = "1" ]
}

verify_live_configuration() {
  if [ "$#" -ne 1 ]; then
    echo "usage: ./verify.sh live-configuration EVIDENCE_JSON" >&2
    return 2
  fi
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
  : "${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL is required}"

  local evidence="$1" factory owner plan tx receipt
  [ -f "$evidence" ]
  factory="$(jq -r '.network.factory' "$evidence")"
  owner="$(jq -r '.authorization.owner' "$evidence")"
  plan="$(jq -r '.authorization.plan' "$evidence")"
  tx="$(jq -r '.receipt.transactionHash' "$evidence")"
  [ "$(lowercase "$factory")" = \
    "$(lowercase "${NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS:?factory address is required}")" ]

  receipt="$(rpc_result eth_getTransactionReceipt "[\"$tx\"]")"
  require_successful_receipt "$receipt" "configuration"
  verify_configuration_event "$receipt" "$plan"
  verify_configuration_identity "$factory" "$owner" "$plan"
  verify_configuration_state "$evidence" "$plan"
  verify_configuration_nonce "$evidence" "$plan"

  echo "PASS  Configuration receipt and ConfigUpdated(liveness_config) event"
  echo "PASS  Factory mapping, owner, consumed nonce and retained liveness state"
}

verify_receipt_metadata() {
  local receipt="$1" evidence="$2" path="$3" label="$4"
  local tx block gas
  tx="$(jq -r "$path.transactionHash" "$evidence")"
  block="$(jq -r "$path.blockNumber" "$evidence")"
  gas="$(jq -r "$path.gasUsed" "$evidence")"
  require_successful_receipt "$receipt" "$label"
  [ "$(lowercase "$(jq -r '.transactionHash' <<<"$receipt")")" = "$(lowercase "$tx")" ]
  [ "$(printf '%d' "$(jq -r '.blockNumber' <<<"$receipt")")" = "$block" ]
  [ "$(printf '%d' "$(jq -r '.gasUsed' <<<"$receipt")")" = "$gas" ]
}

verify_inheritance_event() {
  local receipt="$1" plan="$2" expected_timestamp="$3" event_data
  event_data="$(jq -r --arg address "$(lowercase "$plan")" \
    --arg event "$(event_signature_topic 'InheritanceExecuted(address,uint64)')" '
      first(.logs[]? | select(
        (.address | ascii_downcase) == $address and
        (.topics[0] | ascii_downcase) == $event
      ) | .data) // empty
    ' <<<"$receipt")"
  [ -n "$event_data" ]
  [ "$(printf '%d' "$event_data")" = "$expected_timestamp" ]
}

verify_token_transfer_events() {
  local receipt="$1" evidence="$2" plan="$3" token="$4" transfer
  while IFS= read -r transfer; do
    jq -e --arg address "$(lowercase "$plan")" \
      --arg event "$(event_signature_topic 'InheritanceTransfer(address,address,uint256)')" \
      --arg beneficiary "$(address_topic "$(jq -r '.beneficiary' <<<"$transfer")")" \
      --arg token "$(address_topic "$token")" \
      --arg amount "0x$(uint256_word "$(jq -r '.baseUnits' <<<"$transfer")")" '
        any(.logs[]?;
          (.address | ascii_downcase) == $address and
          (.topics[0] | ascii_downcase) == $event and
          (.topics[1] | ascii_downcase) == $beneficiary and
          (.topics[2] | ascii_downcase) == $token and
          (.data | ascii_downcase) == $amount)
      ' <<<"$receipt" >/dev/null
  done < <(jq -c '.tokenDistribution.transfers[]' "$evidence")
}

verify_inheritance_state() {
  local evidence="$1" factory="$2" owner="$3" plan="$4" token="$5"
  local inherited distributed balance token_call balance_call
  verify_configuration_identity "$factory" "$owner" "$plan"
  inherited="$(eth_call_word "$plan" "$(function_selector 'inheritanceExecuted()')")"
  [ "${inherited: -1}" = "1" ]
  token_call="$(function_selector 'tokenDistributed(address)')$(address_topic "$token" | cut -c3-)"
  distributed="$(eth_call_word "$plan" "$token_call")"
  [ "${distributed: -1}" = "1" ]
  balance_call="$(function_selector 'balanceOf(address)')$(address_topic "$owner" | cut -c3-)"
  balance="$(eth_call_word "$token" "$balance_call")"
  [ "$(printf '%d' "$balance")" = "0" ]
}

verify_live_inheritance() {
  if [ "$#" -ne 1 ]; then
    echo "usage: ./verify.sh live-inheritance EVIDENCE_JSON" >&2
    return 2
  fi
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
  : "${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL is required}"
  verify_inheritance_evidence "$1"
}

verify_inheritance_evidence() {
  local evidence="$1" factory owner plan token native_tx token_tx native_receipt token_receipt
  [ -f "$evidence" ]
  factory="$(jq -r '.contracts.factory' "$evidence")"
  owner="$(jq -r '.contracts.owner' "$evidence")"
  plan="$(jq -r '.contracts.plan' "$evidence")"
  token="$(jq -r '.contracts.token' "$evidence")"
  native_tx="$(jq -r '.inheritance.transactionHash' "$evidence")"
  token_tx="$(jq -r '.tokenDistribution.transactionHash' "$evidence")"
  [ "$(lowercase "$factory")" = \
    "$(lowercase "${NEXT_PUBLIC_LEGACY_KEEPER_FACTORY_ADDRESS:?factory address is required}")" ]
  native_receipt="$(rpc_result eth_getTransactionReceipt "[\"$native_tx\"]")"
  token_receipt="$(rpc_result eth_getTransactionReceipt "[\"$token_tx\"]")"
  verify_receipt_metadata "$native_receipt" "$evidence" '.inheritance' "inheritance"
  verify_receipt_metadata "$token_receipt" "$evidence" '.tokenDistribution' "token inheritance"
  verify_inheritance_event "$native_receipt" "$plan" \
    "$(jq -r '.inheritance.blockTimestamp' "$evidence")"
  verify_token_transfer_events "$token_receipt" "$evidence" "$plan" "$token"
  verify_inheritance_state "$evidence" "$factory" "$owner" "$plan" "$token"
  echo "PASS  Inheritance and token receipts, events and retained metadata"
  echo "PASS  Factory mapping, inheritance state, token state and zero owner balance"
}

if [ "${1:-}" = "live-sepolia" ]; then
  shift
  verify_live_sepolia "$@"
  exit $?
fi

if [ "${1:-}" = "live-first-transaction" ]; then
  shift
  verify_live_first_transaction "$@"
  exit $?
fi

if [ "${1:-}" = "live-configuration" ]; then
  shift
  verify_live_configuration "$@"
  exit $?
fi

if [ "${1:-}" = "live-inheritance" ]; then
  shift
  verify_live_inheritance "$@"
  exit $?
fi

if [ "$#" -ne 0 ]; then
  echo "usage: ./verify.sh [live-sepolia ... | live-first-transaction EVIDENCE_JSON | live-configuration EVIDENCE_JSON | live-inheritance EVIDENCE_JSON]" >&2
  exit 2
fi

cd "$PROJECT_ROOT"
npm run compile
npm test
npm run test:agent
npm run test:dashboard
npm --prefix dashboard run typecheck
npm --prefix dashboard run build
npm --prefix dashboard run test:e2e -- --workers=1

echo "PASS  LegacyKeeper contracts, agent, dashboard, build, and browser journeys"
