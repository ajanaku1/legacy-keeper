#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

say() { printf '\n%s\n' "$1"; }
fail() { printf 'setup failed: %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js 18, 20, or 22 is required"
command -v npm >/dev/null 2>&1 || fail "npm is required"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
case "$NODE_MAJOR" in
  18|20|22) ;;
  *) fail "Node.js 18, 20, or 22 is required; found $(node -v)" ;;
esac

say "LegacyKeeper clean-clone setup"
printf '%s\n' \
  "This installs both apps, compiles the contract, deploys to Sepolia when" \
  "LEGACY_KEEPER_ADDRESS is empty, creates and enables the KeeperHub workflows," \
  "then sends and independently verifies one sponsored heartbeat."

if [ ! -f .env ]; then
  cp .env.example .env
  printf '\nCreated .env. Fill the required values, then run this script again:\n'
  printf '  KEEPERHUB_API_KEY\n  KEEPERHUB_WEBHOOK_API_KEY\n  SEPOLIA_RPC_URL\n'
  printf '  DEPLOYER_PRIVATE_KEY\n  TELEGRAM_CHAT_ID\n\n'
  printf 'The KeeperHub organization must also have a Telegram integration.\n'
  exit 2
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

REQUIRED=(KEEPERHUB_API_KEY KEEPERHUB_WEBHOOK_API_KEY SEPOLIA_RPC_URL DEPLOYER_PRIVATE_KEY TELEGRAM_CHAT_ID)
for name in "${REQUIRED[@]}"; do
  [ -n "${!name:-}" ] || fail "$name is empty in .env"
done

if [ "${1:-}" != "--yes" ]; then
  printf '\nThis run may deploy a Sepolia contract and enable automatic workflows.\n'
  read -r -p "Continue? [y/N] " answer
  case "$answer" in y|Y|yes|YES) ;; *) exit 0 ;; esac
fi

say "Installing dependencies"
npm ci
npm --prefix dashboard ci

say "Compiling and testing"
npm run compile
npm test
npm run test:agent
npm run test:dashboard
npm --prefix dashboard run typecheck

if [ -z "${LEGACY_KEEPER_ADDRESS:-}" ]; then
  say "Deploying LegacyKeeper to Sepolia"
  DEPLOY_LOG="$(mktemp)"
  trap 'rm -f "$DEPLOY_LOG"' EXIT
  npm run deploy:sepolia | tee "$DEPLOY_LOG"
  LEGACY_KEEPER_ADDRESS="$(sed -nE 's/.*LegacyKeeper deployed: (0x[0-9a-fA-F]{40}).*/\1/p' "$DEPLOY_LOG" | tail -1)"
  [ -n "$LEGACY_KEEPER_ADDRESS" ] || fail "deployment returned no contract address"
  export LEGACY_KEEPER_ADDRESS
  ENV_NAME=LEGACY_KEEPER_ADDRESS ENV_VALUE="$LEGACY_KEEPER_ADDRESS" node -e '
    const fs = require("node:fs");
    const name = process.env.ENV_NAME;
    const value = process.env.ENV_VALUE;
    const path = ".env";
    const source = fs.readFileSync(path, "utf8");
    const line = `${name}=${value}`;
    const next = new RegExp(`^${name}=.*$`, "m").test(source)
      ? source.replace(new RegExp(`^${name}=.*$`, "m"), line)
      : `${source.trimEnd()}\n${line}\n`;
    fs.writeFileSync(path, next);
  '
fi

say "Creating and enabling KeeperHub workflows"
npm run workflows:deploy -- --enable

say "Sending a signed heartbeat through the workflow webhook"
npx tsx scripts/workflows/run-heartbeat.ts

say "Setup complete"
printf 'Contract: %s\n' "$LEGACY_KEEPER_ADDRESS"
printf 'Dashboard: cd dashboard && npm run dev\n'
printf 'Evidence: reports/live-workflow-evidence.json\n'
