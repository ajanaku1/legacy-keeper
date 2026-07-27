#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# LegacyKeeper — Starter Kit Setup
# ============================================================
# This script takes you from `git clone` to a KeeperHub-executed
# transaction in under 5 minutes.
#
# Prerequisites:
#   - Node.js 18+
#   - npm or yarn
#   - A KeeperHub account (https://keeperhub.com)
#   - An Ethereum wallet with Sepolia testnet ETH
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "╔════════════════════════════════════════════════╗"
echo "║     LegacyKeeper — Starter Kit Setup          ║"
echo "║     Your KeeperHub agent in 5 minutes          ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

# ─── Step 1: Check prerequisites ───
echo "📋 Step 1: Checking prerequisites..."
echo ""

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. Current version: $(node -v)"
    exit 1
fi
echo "   ✅ Node.js $(node -v)"

if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi
echo "   ✅ npm $(npm -v)"

# ─── Step 2: Install dependencies ───
echo ""
echo "📦 Step 2: Installing dependencies..."
npm install

# ─── Step 3: Configure environment ───
echo ""
echo "🔧 Step 3: Setting up configuration..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "   ✅ Created .env from .env.example"
    echo ""
    echo "   ⚠️  Please edit .env with your credentials:"
    echo "      - KEEPERHUB_API_KEY (from https://keeperhub.com/settings)"
    echo "      - RPC_URL (Infura/Alchemy Sepolia endpoint)"
    echo "      - OWNER_PRIVATE_KEY (your wallet)"
    echo "      - RECOVERY_PUBLIC_KEY (separate recovery key)"
    echo "      - TELEGRAM_BOT_TOKEN (optional, for alerts)"
    echo ""
    read -p "   Press Enter once you've configured .env..."
else
    echo "   ✅ .env already exists"
fi

# ─── Step 4: Connect to KeeperHub ───
echo ""
echo "🔗 Step 4: Connecting to KeeperHub MCP server..."
echo ""
echo "   Run this command in your terminal:"
echo ""
echo "   claude mcp add --transport http keeperhub \\"
echo "     https://app.keeperhub.com/mcp \\"
echo "     --header \"X-Api-Key: \${KEEPERHUB_API_KEY}\""
echo ""

# Check if KeeperHub is accessible
if command -v curl &> /dev/null; then
    if curl -s -o /dev/null -w "%{http_code}" "https://app.keeperhub.com/health" 2>/dev/null | grep -q "200"; then
        echo "   ✅ KeeperHub is reachable"
    else
        echo "   ⚠️  KeeperHub health check failed (your API key may be needed)"
    fi
fi

# ─── Step 5: Deploy the LegacyKeeper contract ───
echo ""
echo "📄 Step 5: Deploying the LegacyKeeper contract..."
echo ""
echo "   This will deploy LegacyKeeper.sol to Sepolia testnet."
echo "   Make sure your .env has valid credentials."
echo ""
read -p "   Deploy now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npx hardhat run scripts/deploy.ts --network sepolia
    echo "   ✅ Contract deployed!"
else
    echo "   ⏳ Skipping deployment. You can deploy later with:"
    echo "      npm run deploy:contract"
fi

# ─── Step 6: Configure KeeperHub workflows ───
echo ""
echo "⚡ Step 6: Registering KeeperHub workflows..."
echo ""
echo "   The starter kit includes two workflow templates:"
echo ""
echo "   1. Liveness & Inheritance:"
echo "      templates/inheritance-workflow.json"
echo ""
echo "   2. Emergency Evacuation:"
echo "      templates/evacuation-workflow.json"
echo ""
echo "   Upload these to KeeperHub via the dashboard or MCP API."
echo ""

# ─── Step 7: Send first heartbeat ───
echo ""
echo "💓 Step 7: Send your first heartbeat!"
echo ""
echo "   Run this to send a test heartbeat:"
echo ""
echo "   curl -X POST https://app.keeperhub.com/mcp \\"
echo "     -H \"X-Api-Key: \${KEEPERHUB_API_KEY}\" \\"
echo "     -d '{\"workflow\":\"heartbeat\",\"params\":{\"address\":\"\${OWNER_ADDRESS}\"}}'"
echo ""

echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║     ✅ Setup complete!                        ║"
echo "║                                                ║"
echo "║     Next steps:                                ║"
echo "║     1. Configure beneficiaries in dashboard    ║"
echo "║     2. Set up your safe vault address          ║"
echo "║     3. Register your recovery key              ║"
echo "║     4. Test the panic button                   ║"
echo "║                                                ║"
echo "║     See starter/docs/tutorial.md for full guide║"
echo "╚════════════════════════════════════════════════╝"
