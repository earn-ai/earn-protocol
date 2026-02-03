/**
 * Earn Protocol API
 * 
 * Minimal API for agents to launch tokens on Pump.fun
 * 
 * Endpoints:
 * - GET /skill.md - Agent instructions
 * - POST /launch - Create token on Pump.fun
 * - GET /token/:mint - Get token info
 * - GET /earnings/:wallet - Check agent earnings
 */

import express from 'express';
import cors from 'cors';
import { Connection, Keypair, PublicKey, Transaction, LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import { PumpSdk, bondingCurvePda, creatorVaultPda } from '@pump-fun/pump-sdk';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

// ============ CONFIG ============

const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const EARN_WALLET_PATH = process.env.EARN_WALLET || '/home/node/.config/solana/earn-wallet.json';

// In-memory store (replace with DB in production)
const tokenRegistry: Map<string, TokenConfig> = new Map();

interface TokenConfig {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  agentWallet: string;
  tokenomics: string;
  agentCutBps: number;
  earnCutBps: number;
  createdAt: string;
  txSignature: string;
}

// Tokenomics presets
const TOKENOMICS_PRESETS: Record<string, { agentCut: number; earnCut: number; description: string }> = {
  degen: { agentCut: 50, earnCut: 50, description: 'High volume memes' },
  creator: { agentCut: 60, earnCut: 40, description: 'Content creators' },
  community: { agentCut: 40, earnCut: 60, description: 'Long-term projects' },
  lowfee: { agentCut: 50, earnCut: 50, description: 'Max trading volume' },
};

// ============ HELPERS ============

function loadKeypair(filepath: string): Keypair {
  const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  if (Array.isArray(data)) {
    return Keypair.fromSecretKey(Uint8Array.from(data));
  } else if (data.private_key) {
    return Keypair.fromSecretKey(bs58.decode(data.private_key));
  }
  throw new Error('Unknown wallet format');
}

// ============ SKILL.MD ============

const SKILL_MD = `# Earn Protocol

Launch a token on Pump.fun. Earn handles everything. You get paid.

## Quick Start

\`\`\`bash
curl -X POST https://api.earn.supply/launch \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My Token",
    "ticker": "MTK",
    "image": "https://example.com/logo.png",
    "tokenomics": "degen",
    "agentWallet": "YOUR_SOLANA_WALLET"
  }'
\`\`\`

## Response

\`\`\`json
{
  "success": true,
  "mint": "HYp5GzxZ...",
  "pumpfun": "https://pump.fun/HYp5GzxZ...",
  "agentWallet": "YOUR_WALLET",
  "tokenomics": "degen",
  "agentCut": "50%",
  "earnCut": "50%"
}
\`\`\`

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| name | string | Token name (e.g., "Agent Coin") |
| ticker | string | 3-10 chars (e.g., "AGC") |
| image | string | URL to PNG/JPEG image |
| tokenomics | string | degen, creator, community, or lowfee |
| agentWallet | string | Your Solana wallet for earnings |

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| description | string | Token description |
| website | string | Project website |
| twitter | string | Twitter/X link |

## Tokenomics Styles

| Style | Your Cut | Earn Cut | Best For |
|-------|----------|----------|----------|
| degen | 50% | 50% | High volume memes |
| creator | 60% | 40% | Content creators |
| community | 40% | 60% | Long-term projects |
| lowfee | 50% | 50% | Max trading volume |

## Check Your Earnings

\`\`\`bash
curl https://api.earn.supply/earnings/YOUR_WALLET
\`\`\`

## How It Works

1. You POST token details to Earn
2. Earn creates your token on Pump.fun
3. Users trade on Pump.fun
4. Creator fees flow to Earn
5. Earn distributes your cut to your wallet

## Links

- API: https://api.earn.supply
- Dashboard: https://earn.supply
- GitHub: https://github.com/earn-ai/earn-protocol
`;

// ============ APP ============

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Load Earn wallet
let earnWallet: Keypair;
let connection: Connection;
let pumpSdk: PumpSdk;

try {
  earnWallet = loadKeypair(EARN_WALLET_PATH);
  connection = new Connection(RPC_URL, 'confirmed');
  pumpSdk = new PumpSdk();
  console.log('✅ Earn Wallet:', earnWallet.publicKey.toString());
} catch (e: any) {
  console.error('❌ Failed to load wallet:', e.message);
  process.exit(1);
}

// ============ ROUTES ============

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', wallet: earnWallet.publicKey.toString() });
});

// Skill.md for agents
app.get('/skill.md', (req, res) => {
  res.type('text/markdown').send(SKILL_MD);
});

// Also serve at root for convenience
app.get('/', (req, res) => {
  res.type('text/markdown').send(SKILL_MD);
});

// Launch token
app.post('/launch', async (req, res) => {
  try {
    const { name, ticker, image, tokenomics, agentWallet, description, website, twitter } = req.body;
    
    // Validate required fields
    if (!name || !ticker || !image || !tokenomics || !agentWallet) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, ticker, image, tokenomics, agentWallet'
      });
    }
    
    // Validate tokenomics
    if (!TOKENOMICS_PRESETS[tokenomics]) {
      return res.status(400).json({
        success: false,
        error: `Invalid tokenomics. Choose: ${Object.keys(TOKENOMICS_PRESETS).join(', ')}`
      });
    }
    
    // Validate wallet
    let agentPubkey: PublicKey;
    try {
      agentPubkey = new PublicKey(agentWallet);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid agentWallet address'
      });
    }
    
    // Validate ticker
    if (ticker.length < 2 || ticker.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'Ticker must be 2-10 characters'
      });
    }
    
    console.log(`\n🚀 Launching token: ${name} (${ticker})`);
    console.log(`   Agent: ${agentWallet}`);
    console.log(`   Tokenomics: ${tokenomics}`);
    
    // Generate mint keypair
    const mintKeypair = Keypair.generate();
    
    // TODO: Upload image to IPFS if base64 provided
    // For now, assume image is already a URL
    const uri = image; // In production, upload to IPFS and create metadata JSON
    
    // Build create instruction
    const createIx = await pumpSdk.createV2Instruction({
      mint: mintKeypair.publicKey,
      name,
      symbol: ticker.toUpperCase(),
      uri,
      creator: earnWallet.publicKey, // Earn receives fees
      user: earnWallet.publicKey,
      mayhemMode: true,
    });
    
    // Extend account instruction
    const extendIx = await pumpSdk.extendAccountInstruction({
      account: bondingCurvePda(mintKeypair.publicKey),
      user: earnWallet.publicKey,
    });
    
    // Create ATA for user
    const associatedUser = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      earnWallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      earnWallet.publicKey,
      associatedUser,
      earnWallet.publicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID
    );
    
    // Build transaction
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));
    tx.add(createIx);
    tx.add(extendIx);
    tx.add(createAtaIx);
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = earnWallet.publicKey;
    tx.sign(earnWallet, mintKeypair);
    
    // Send transaction
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    console.log(`   TX: ${signature}`);
    
    // Confirm
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    // Store token config
    const preset = TOKENOMICS_PRESETS[tokenomics];
    const config: TokenConfig = {
      mint: mintKeypair.publicKey.toString(),
      name,
      symbol: ticker.toUpperCase(),
      uri,
      agentWallet,
      tokenomics,
      agentCutBps: preset.agentCut * 100,
      earnCutBps: preset.earnCut * 100,
      createdAt: new Date().toISOString(),
      txSignature: signature,
    };
    
    tokenRegistry.set(mintKeypair.publicKey.toString(), config);
    
    console.log(`   ✅ Token created: ${mintKeypair.publicKey.toString()}`);
    
    // Return success
    const isDevnet = RPC_URL.includes('devnet');
    res.json({
      success: true,
      mint: mintKeypair.publicKey.toString(),
      name,
      symbol: ticker.toUpperCase(),
      pumpfun: isDevnet 
        ? `https://pump.fun/${mintKeypair.publicKey.toString()}` // pump.fun doesn't have devnet UI
        : `https://pump.fun/${mintKeypair.publicKey.toString()}`,
      solscan: isDevnet
        ? `https://solscan.io/token/${mintKeypair.publicKey.toString()}?cluster=devnet`
        : `https://solscan.io/token/${mintKeypair.publicKey.toString()}`,
      agentWallet,
      tokenomics,
      agentCut: `${preset.agentCut}%`,
      earnCut: `${preset.earnCut}%`,
      txSignature: signature,
    });
    
  } catch (e: any) {
    console.error('❌ Launch failed:', e.message);
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

// Get token info
app.get('/token/:mint', (req, res) => {
  const config = tokenRegistry.get(req.params.mint);
  if (!config) {
    return res.status(404).json({ success: false, error: 'Token not found' });
  }
  res.json({ success: true, ...config });
});

// Get agent earnings (placeholder - needs on-chain integration)
app.get('/earnings/:wallet', async (req, res) => {
  const wallet = req.params.wallet;
  
  // Find all tokens for this agent
  const agentTokens = Array.from(tokenRegistry.values())
    .filter(t => t.agentWallet === wallet);
  
  // TODO: Query on-chain for actual earnings
  // For now, return token list
  res.json({
    success: true,
    wallet,
    tokens: agentTokens.map(t => ({
      mint: t.mint,
      name: t.name,
      symbol: t.symbol,
      tokenomics: t.tokenomics,
      agentCut: `${t.agentCutBps / 100}%`,
    })),
    totalEarned: '0 SOL', // TODO: Calculate from on-chain
    pendingClaim: '0 SOL',
  });
});

// Get all tokens (for dashboard)
app.get('/tokens', (req, res) => {
  const tokens = Array.from(tokenRegistry.values());
  res.json({
    success: true,
    count: tokens.length,
    tokens,
  });
});

// Tokenomics info
app.get('/tokenomics', (req, res) => {
  res.json({
    success: true,
    presets: Object.entries(TOKENOMICS_PRESETS).map(([key, value]) => ({
      id: key,
      ...value,
    })),
  });
});

// ============ START ============

app.listen(PORT, () => {
  console.log(`\n🚀 Earn Protocol API`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Network: ${RPC_URL}`);
  console.log(`   Wallet: ${earnWallet.publicKey.toString()}`);
  console.log(`\n   GET  /skill.md     - Agent instructions`);
  console.log(`   POST /launch       - Create token`);
  console.log(`   GET  /token/:mint  - Token info`);
  console.log(`   GET  /earnings/:w  - Agent earnings`);
});
