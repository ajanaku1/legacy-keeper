#!/usr/bin/env bash
# Public entry point for the LegacyKeeper build contract.
# The authoritative predicates live with the existing project guardrails.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$PROJECT_ROOT/loop/guardrails/verify.sh" "$@"
