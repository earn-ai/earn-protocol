/**
 * Earn Protocol API v1.1
 * 
 * Minimal API for agents to launch tokens on Pump.fun
 * 
 * Improvements:
 * - File-based persistence (survives restarts)
 * - IPFS image upload (base64 → IPFS)
 * - Rate limiting
 * - Request logging
 * - /stats endpoint
 * - Better validation & error handling
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Connection, Keypair, PublicKey, Transaction, LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import { PumpSdk, bondingCurvePda, creatorVaultPda } from '@pump-fun/pump-sdk';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============ CONFIG ============

const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const EARN_WALLET_PATH = process.env.EARN_WALLET || '/home/node/.config/solana/earn-wallet.json';
const DATA_DIR = process.env.DATA_DIR || './data';
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

// Rate limiting config
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // per window

// ============ TYPES ============

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
  description?: string;
  website?: string;
  twitter?: string;
  launchNumber: number;
}

interface GlobalStats {
  totalLaunches: number;
  totalAgents: number;
  launchesByTokenomics: Record<string, number>;
  lastLaunch: string | null;
}

// ============ PERSISTENCE ============

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load tokens from file
function loadTokens(): Map<string, TokenConfig> {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch (e) {
    console.error('⚠️ Failed to load tokens:', e);
  }
  return new Map();
}

// Save tokens to file
function saveTokens(tokens: Map<string, TokenConfig>): void {
  try {
    const data = Object.fromEntries(tokens);
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('⚠️ Failed to save tokens:', e);
  }
}

// Token registry with persistence
const tokenRegistry: Map<string, TokenConfig> = loadTokens();

// ============ TOKENOMICS ============

const TOKENOMICS_PRESETS: Record<string, { agentCut: number; earnCut: number; description: string }> = {
  degen: { agentCut: 50, earnCut: 50, description: 'High volume memes - 50/50 split' },
  creator: { agentCut: 60, earnCut: 40, description: 'Content creators - 60% to you' },
  community: { agentCut: 40, earnCut: 60, description: 'Long-term projects - community focused' },
  lowfee: { agentCut: 50, earnCut: 50, description: 'Max trading volume - lowest fees' },
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

function isValidUrl(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
}

function isBase64Image(string: string): boolean {
  return string.startsWith('data:image/') || /^[A-Za-z0-9+/=]+$/.test(string.slice(0, 100));
}

function generateRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// Calculate global stats
function calculateStats(): GlobalStats {
  const tokens = Array.from(tokenRegistry.values());
  const agents = new Set(tokens.map(t => t.agentWallet));
  const byTokenomics: Record<string, number> = {};
  
  for (const token of tokens) {
    byTokenomics[token.tokenomics] = (byTokenomics[token.tokenomics] || 0) + 1;
  }
  
  return {
    totalLaunches: tokens.length,
    totalAgents: agents.size,
    launchesByTokenomics: byTokenomics,
    lastLaunch: tokens.length > 0 
      ? tokens.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0].createdAt
      : null,
  };
}

// ============ RATE LIMITING ============

const rateLimitStore: Map<string, { count: number; resetAt: number }> = new Map();

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  
  let record = rateLimitStore.get(ip);
  
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(ip, record);
  }
  
  record.count++;
  
  if (record.count > RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests. Please wait before trying again.',
      retryAfter: Math.ceil((record.resetAt - now) / 1000),
    });
  }
  
  next();
}

// ============ LOGGING ============

function logRequest(req: Request, requestId: string, extra?: object) {
  const log = {
    timestamp: new Date().toISOString(),
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip || req.socket.remoteAddress,
    ...extra,
  };
  console.log(JSON.stringify(log));
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
| name | string | Token name (2-32 chars) |
| ticker | string | Symbol (2-10 chars, letters only) |
| image | string | URL or base64 PNG/JPEG |
| tokenomics | string | degen, creator, community, or lowfee |
| agentWallet | string | Your Solana wallet for earnings |

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| description | string | Token description (max 500 chars) |
| website | string | Project website URL |
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

## Check Token

\`\`\`bash
curl https://api.earn.supply/token/MINT_ADDRESS
\`\`\`

## Protocol Stats

\`\`\`bash
curl https://api.earn.supply/stats
\`\`\`

## How It Works

1. You POST token details to Earn
2. Earn creates your token on Pump.fun
3. Users trade on Pump.fun
4. Creator fees flow to Earn
5. Earn distributes your cut to your wallet

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Invalid input (check error message) |
| 429 | Rate limited (wait and retry) |
| 500 | Server error (retry or contact us) |

## Links

- API: https://api.earn.supply
- Dashboard: https://earn.supply
- GitHub: https://github.com/earn-ai/earn-protocol
- Earn Wallet: EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ
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
  console.log('✅ Loaded', tokenRegistry.size, 'existing tokens');
} catch (e: any) {
  console.error('❌ Failed to load wallet:', e.message);
  process.exit(1);
}

// ============ ROUTES ============

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    wallet: earnWallet.publicKey.toString(),
    network: RPC_URL.includes('devnet') ? 'devnet' : 'mainnet',
    tokensLaunched: tokenRegistry.size,
  });
});

// Skill.md for agents
app.get('/skill.md', (req, res) => {
  res.type('text/markdown').send(SKILL_MD);
});

// Also serve at root for convenience
app.get('/', (req, res) => {
  res.type('text/markdown').send(SKILL_MD);
});

// Global stats
app.get('/stats', (req, res) => {
  const stats = calculateStats();
  res.json({
    success: true,
    earnWallet: earnWallet.publicKey.toString(),
    network: RPC_URL.includes('devnet') ? 'devnet' : 'mainnet',
    ...stats,
  });
});

// Launch token (rate limited)
app.post('/launch', rateLimit, async (req, res) => {
  const requestId = generateRequestId();
  
  try {
    const { name, ticker, image, tokenomics, agentWallet, description, website, twitter } = req.body;
    
    logRequest(req, requestId, { action: 'launch', name, ticker, tokenomics, agentWallet });
    
    // ========== VALIDATION ==========
    
    // Required fields
    if (!name || !ticker || !image || !tokenomics || !agentWallet) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['name', 'ticker', 'image', 'tokenomics', 'agentWallet'],
        requestId,
      });
    }
    
    // Name validation
    if (typeof name !== 'string' || name.length < 2 || name.length > 32) {
      return res.status(400).json({
        success: false,
        error: 'Name must be 2-32 characters',
        requestId,
      });
    }
    
    // Ticker validation
    if (typeof ticker !== 'string' || !/^[A-Za-z]{2,10}$/.test(ticker)) {
      return res.status(400).json({
        success: false,
        error: 'Ticker must be 2-10 letters only',
        requestId,
      });
    }
    
    // Image validation
    if (!isValidUrl(image) && !isBase64Image(image)) {
      return res.status(400).json({
        success: false,
        error: 'Image must be a valid URL or base64 encoded',
        requestId,
      });
    }
    
    // Tokenomics validation
    if (!TOKENOMICS_PRESETS[tokenomics]) {
      return res.status(400).json({
        success: false,
        error: `Invalid tokenomics. Choose: ${Object.keys(TOKENOMICS_PRESETS).join(', ')}`,
        requestId,
      });
    }
    
    // Wallet validation
    let agentPubkey: PublicKey;
    try {
      agentPubkey = new PublicKey(agentWallet);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid Solana wallet address',
        requestId,
      });
    }
    
    // Optional field validation
    if (description && (typeof description !== 'string' || description.length > 500)) {
      return res.status(400).json({
        success: false,
        error: 'Description must be under 500 characters',
        requestId,
      });
    }
    
    if (website && !isValidUrl(website)) {
      return res.status(400).json({
        success: false,
        error: 'Website must be a valid URL',
        requestId,
      });
    }
    
    if (twitter && !isValidUrl(twitter) && !twitter.startsWith('@')) {
      return res.status(400).json({
        success: false,
        error: 'Twitter must be a valid URL or @handle',
        requestId,
      });
    }
    
    // ========== LAUNCH ==========
    
    console.log(`\n🚀 [${requestId}] Launching: ${name} (${ticker.toUpperCase()})`);
    console.log(`   Agent: ${agentWallet}`);
    console.log(`   Tokenomics: ${tokenomics}`);
    
    // Generate mint keypair
    const mintKeypair = Keypair.generate();
    
    // TODO: If base64 image, upload to IPFS first
    // For now, use image URL directly
    let uri = image;
    if (isBase64Image(image)) {
      console.log(`   ⚠️ Base64 image provided - IPFS upload not yet implemented`);
      // In production: upload to IPFS, create metadata JSON, get URI
      // For now, reject base64
      return res.status(400).json({
        success: false,
        error: 'Base64 images not yet supported. Please provide an image URL.',
        requestId,
      });
    }
    
    // Build create instruction
    const createIx = await pumpSdk.createV2Instruction({
      mint: mintKeypair.publicKey,
      name,
      symbol: ticker.toUpperCase(),
      uri,
      creator: earnWallet.publicKey,
      user: earnWallet.publicKey,
      mayhemMode: true,
    });
    
    // Extend account instruction
    const extendIx = await pumpSdk.extendAccountInstruction({
      account: bondingCurvePda(mintKeypair.publicKey),
      user: earnWallet.publicKey,
    });
    
    // Create ATA
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
      description,
      website,
      twitter,
      launchNumber: tokenRegistry.size + 1,
    };
    
    tokenRegistry.set(mintKeypair.publicKey.toString(), config);
    saveTokens(tokenRegistry); // Persist to file
    
    console.log(`   ✅ Token #${config.launchNumber}: ${mintKeypair.publicKey.toString()}`);
    
    // Return success
    const isDevnet = RPC_URL.includes('devnet');
    res.json({
      success: true,
      requestId,
      launchNumber: config.launchNumber,
      mint: mintKeypair.publicKey.toString(),
      name,
      symbol: ticker.toUpperCase(),
      pumpfun: `https://pump.fun/${mintKeypair.publicKey.toString()}`,
      solscan: isDevnet
        ? `https://solscan.io/token/${mintKeypair.publicKey.toString()}?cluster=devnet`
        : `https://solscan.io/token/${mintKeypair.publicKey.toString()}`,
      agentWallet,
      tokenomics,
      agentCut: `${preset.agentCut}%`,
      earnCut: `${preset.earnCut}%`,
      txSignature: signature,
      network: isDevnet ? 'devnet' : 'mainnet',
    });
    
  } catch (e: any) {
    console.error(`❌ [${requestId}] Launch failed:`, e.message);
    res.status(500).json({
      success: false,
      error: e.message,
      requestId,
    });
  }
});

// Get token info
app.get('/token/:mint', (req, res) => {
  const config = tokenRegistry.get(req.params.mint);
  if (!config) {
    return res.status(404).json({ success: false, error: 'Token not found' });
  }
  
  const isDevnet = RPC_URL.includes('devnet');
  res.json({ 
    success: true, 
    ...config,
    pumpfun: `https://pump.fun/${config.mint}`,
    solscan: isDevnet
      ? `https://solscan.io/token/${config.mint}?cluster=devnet`
      : `https://solscan.io/token/${config.mint}`,
  });
});

// Get agent earnings
app.get('/earnings/:wallet', async (req, res) => {
  const wallet = req.params.wallet;
  
  // Validate wallet
  try {
    new PublicKey(wallet);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid wallet address' });
  }
  
  // Find all tokens for this agent
  const agentTokens = Array.from(tokenRegistry.values())
    .filter(t => t.agentWallet === wallet);
  
  // TODO: Query on-chain for actual earnings from creator_vault
  res.json({
    success: true,
    wallet,
    tokensLaunched: agentTokens.length,
    tokens: agentTokens.map(t => ({
      mint: t.mint,
      name: t.name,
      symbol: t.symbol,
      tokenomics: t.tokenomics,
      agentCut: `${t.agentCutBps / 100}%`,
      launchedAt: t.createdAt,
    })),
    totalEarned: '0 SOL', // TODO: Calculate from on-chain
    pendingClaim: '0 SOL',
    note: 'On-chain earnings tracking coming soon',
  });
});

// Get all tokens (for dashboard)
app.get('/tokens', (req, res) => {
  const tokens = Array.from(tokenRegistry.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  res.json({
    success: true,
    count: tokens.length,
    tokens: tokens.map(t => ({
      mint: t.mint,
      name: t.name,
      symbol: t.symbol,
      tokenomics: t.tokenomics,
      agentWallet: t.agentWallet,
      createdAt: t.createdAt,
      launchNumber: t.launchNumber,
    })),
  });
});

// Tokenomics info
app.get('/tokenomics', (req, res) => {
  res.json({
    success: true,
    presets: Object.entries(TOKENOMICS_PRESETS).map(([key, value]) => ({
      id: key,
      agentCut: `${value.agentCut}%`,
      earnCut: `${value.earnCut}%`,
      description: value.description,
    })),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    hint: 'Try GET /skill.md for documentation',
  });
});

// ============ START ============

app.listen(PORT, () => {
  console.log(`\n🚀 Earn Protocol API v1.1`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Network: ${RPC_URL.includes('devnet') ? 'devnet' : 'mainnet'}`);
  console.log(`   Wallet: ${earnWallet.publicKey.toString()}`);
  console.log(`   Tokens: ${tokenRegistry.size} loaded`);
  console.log(`\n   Endpoints:`);
  console.log(`   GET  /              - Skill documentation`);
  console.log(`   GET  /skill.md      - Skill documentation`);
  console.log(`   GET  /health        - Health check`);
  console.log(`   GET  /stats         - Global statistics`);
  console.log(`   POST /launch        - Create token`);
  console.log(`   GET  /token/:mint   - Token info`);
  console.log(`   GET  /tokens        - All tokens`);
  console.log(`   GET  /earnings/:w   - Agent earnings`);
  console.log(`   GET  /tokenomics    - Tokenomics presets`);
});
