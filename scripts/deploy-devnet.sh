#!/bin/bash
# Earn Protocol - Devnet Deployment Script
# Run this on a machine with Solana CLI + Anchor installed

set -e

echo "🚀 Earn Protocol - Devnet Deployment"
echo "====================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Earn Protocol wallet (default creator for all tokens)
EARN_WALLET="EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ"

# Check dependencies
echo -e "\n${YELLOW}Checking dependencies...${NC}"
command -v solana >/dev/null 2>&1 || { echo "❌ Solana CLI not found. Install: sh -c \"\$(curl -sSfL https://release.solana.com/v1.18.4/install)\""; exit 1; }
command -v anchor >/dev/null 2>&1 || { echo "❌ Anchor not found. Install: cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.29.0 && avm use 0.29.0"; exit 1; }
echo "✅ Solana CLI: $(solana --version)"
echo "✅ Anchor: $(anchor --version)"

# Configure for devnet
echo -e "\n${YELLOW}Configuring for devnet...${NC}"
solana config set --url devnet
echo "✅ Network: devnet"

# Check wallet
WALLET=$(solana address 2>/dev/null || echo "")
if [ -z "$WALLET" ]; then
    echo "❌ No wallet found. Create one with: solana-keygen new"
    exit 1
fi
echo "✅ Wallet: $WALLET"

# Check balance
BALANCE=$(solana balance | awk '{print $1}')
echo "💰 Balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 2" | bc -l) )); then
    echo -e "\n${YELLOW}Requesting airdrop...${NC}"
    solana airdrop 2
    sleep 5
    BALANCE=$(solana balance | awk '{print $1}')
    echo "✅ New balance: $BALANCE SOL"
fi

# Build program
echo -e "\n${YELLOW}Building Earn Protocol...${NC}"
cd "$(dirname "$0")/.."
anchor build
echo "✅ Build complete"

# Get program ID
PROGRAM_ID=$(solana address -k target/deploy/earn_protocol-keypair.json)
echo "📋 Program ID: $PROGRAM_ID"

# Update program ID in source files
echo -e "\n${YELLOW}Updating program ID in source...${NC}"
sed -i.bak "s/declare_id!(\".*\")/declare_id!(\"$PROGRAM_ID\")/" programs/earn-protocol/src/lib.rs
sed -i.bak "s/earn_protocol = \".*\"/earn_protocol = \"$PROGRAM_ID\"/" Anchor.toml
echo "✅ Updated lib.rs and Anchor.toml"

# Rebuild with correct program ID
anchor build
echo "✅ Rebuilt with correct program ID"

# Deploy
echo -e "\n${YELLOW}Deploying to devnet...${NC}"
anchor deploy --provider.cluster devnet
echo -e "${GREEN}✅ Program deployed!${NC}"
echo "   Program ID: $PROGRAM_ID"

# Initialize protocol
echo -e "\n${YELLOW}Initializing Earn Protocol...${NC}"
cat > /tmp/init-protocol.ts << 'INITEOF'
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as os from 'os';

const IDL = require('../target/idl/earn_protocol.json');
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID!);
const EARN_WALLET = new PublicKey('EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ');

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Load wallet
  const keypairPath = `${os.homedir()}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(secretKey)));
  
  const provider = new AnchorProvider(connection, wallet, {});
  const program = new Program(IDL, PROGRAM_ID, provider);
  
  // Initialize master treasury
  const [masterTreasury] = PublicKey.findProgramAddressSync(
    [Buffer.from('earn_master')],
    PROGRAM_ID
  );
  
  console.log('Initializing master treasury...');
  try {
    await program.methods
      .initializeMasterTreasury()
      .accounts({
        authority: wallet.publicKey,
        earnMasterTreasury: masterTreasury,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('✅ Master treasury initialized:', masterTreasury.toBase58());
  } catch (e: any) {
    if (e.message?.includes('already in use')) {
      console.log('✅ Master treasury already exists:', masterTreasury.toBase58());
    } else {
      throw e;
    }
  }
  
  console.log('\n🎉 Earn Protocol ready on devnet!');
  console.log('   Program ID:', PROGRAM_ID.toBase58());
  console.log('   Master Treasury:', masterTreasury.toBase58());
  console.log('   Default Creator:', EARN_WALLET.toBase58());
}

main().catch(console.error);
INITEOF

PROGRAM_ID=$PROGRAM_ID npx ts-node /tmp/init-protocol.ts
echo -e "${GREEN}✅ Protocol initialized!${NC}"

# Save deployment info
echo -e "\n${YELLOW}Saving deployment info...${NC}"
cat > deployment-devnet.json << EOF
{
  "network": "devnet",
  "programId": "$PROGRAM_ID",
  "earnWallet": "$EARN_WALLET",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployedBy": "$WALLET"
}
EOF
echo "✅ Saved to deployment-devnet.json"

echo -e "\n${GREEN}======================================${NC}"
echo -e "${GREEN}🎉 DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo "Program ID: $PROGRAM_ID"
echo "Earn Wallet: $EARN_WALLET"
echo ""
echo "Next steps:"
echo "  1. Run: npm run test:register-token"
echo "  2. Or use the API: POST /earn/register"
echo ""
