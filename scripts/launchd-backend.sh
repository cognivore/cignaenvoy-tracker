#!/usr/bin/env bash
# Wrapper script for LaunchAgent to start backend with credentials from passveil
# This allows the service to work after reboot without storing credentials in plists

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load credentials from passveil
# PASSVEIL_CIGNA_PATH should be set in .envrc or launchd plist
if [[ -z "${PASSVEIL_CIGNA_PATH:-}" ]]; then
    echo "PASSVEIL_CIGNA_PATH not set, trying to source .envrc..." >&2
    if [[ -f "$PROJECT_ROOT/.envrc" ]]; then
        # shellcheck disable=SC1091
        source "$PROJECT_ROOT/.envrc" 2>/dev/null || true
    fi
fi

if [[ -z "${PASSVEIL_CIGNA_PATH:-}" ]]; then
    echo "❌ PASSVEIL_CIGNA_PATH environment variable not set" >&2
    echo "   Cannot load credentials for LaunchAgent" >&2
    exit 1
fi

# Fetch credentials
CREDS=$(passveil show "$PASSVEIL_CIGNA_PATH" 2>/dev/null) || {
    echo "❌ Failed to fetch credentials from passveil" >&2
    echo "   Make sure passveil agent is running" >&2
    exit 1
}

# Parse credentials (same logic as start-dev.sh)
export CIGNA_ID=$(echo "$CREDS" | head -1 | grep -oE '[0-9]+$')
export CIGNA_PASSWORD=$(echo "$CREDS" | grep -v '^$' | tail -1)
export CIGNA_TOTP_SECRET=$(passveil show customer.cignaenvoy.com/totp-secret 2>/dev/null || true)

if [[ -z "$CIGNA_ID" ]] || [[ -z "$CIGNA_PASSWORD" ]]; then
    echo "❌ Failed to parse Cigna credentials" >&2
    exit 1
fi

echo "✓ Credentials loaded (ID: $CIGNA_ID)" >&2

# Start the backend
cd "$PROJECT_ROOT"
export STORAGE_BACKEND=sqlite
exec npx tsx src/server/api.ts
