#!/bin/bash
# Earn Protocol Fee Distribution Crank
# Run this periodically (every 6 hours) to distribute accumulated fees
#
# Usage: ./scripts/run-crank.sh
# Requires: Node.js, ts-node, earn-wallet.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "═══════════════════════════════════════════════════════"
echo "EARN PROTOCOL - FEE DISTRIBUTION CRANK"
echo "═══════════════════════════════════════════════════════"
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Check wallet exists
if [ ! -f "$HOME/.config/solana/earn-wallet.json" ]; then
    echo "❌ Wallet not found: ~/.config/solana/earn-wallet.json"
    exit 1
fi

# Run the crank
npx ts-node api/crank.ts

echo ""
echo "═══════════════════════════════════════════════════════"
echo "Done: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════════════"
