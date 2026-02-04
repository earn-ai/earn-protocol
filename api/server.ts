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
const RPC_COMMITMENT = (process.env.RPC_COMMITMENT || 'confirmed') as 'confirmed' | 'finalized' | 'processed';
const RPC_TIMEOUT_MS = parseInt(process.env.RPC_TIMEOUT_MS || '30000'); // 30s default
const EARN_WALLET_PATH = process.env.EARN_WALLET || '/home/node/.config/solana/earn-wallet.json';
const DATA_DIR = process.env.DATA_DIR || './data';
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

// IPFS config (optional - enables base64 image uploads)
const NFT_STORAGE_KEY = process.env.NFT_STORAGE_KEY || '';
const IPFS_ENABLED = !!NFT_STORAGE_KEY;

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
  stakingCutBps: number;
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

const TOKENOMICS_PRESETS: Record<string, { agentCut: number; earnCut: number; stakingCut: number; description: string }> = {
  degen: { agentCut: 40, earnCut: 30, stakingCut: 30, description: 'High volume memes - balanced split' },
  creator: { agentCut: 50, earnCut: 25, stakingCut: 25, description: 'Content creators - max to you' },
  community: { agentCut: 25, earnCut: 25, stakingCut: 50, description: 'DAO-style - stakers rewarded most' },
  lowfee: { agentCut: 40, earnCut: 30, stakingCut: 30, description: 'Max trading volume - balanced' },
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

// Sanitize user input to prevent XSS/injection
function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

// Validate token name (alphanumeric, spaces, basic punctuation)
function isValidTokenName(name: string): boolean {
  return /^[a-zA-Z0-9\s\-_.!?']+$/.test(name);
}

function isBase64Image(string: string): boolean {
  return string.startsWith('data:image/') || /^[A-Za-z0-9+/=]+$/.test(string.slice(0, 100));
}

function generateRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// ============ IPFS UPLOAD ============

interface MetadataJson {
  name: string;
  symbol: string;
  description?: string;
  image: string;
  external_url?: string;
  attributes?: Array<{ trait_type: string; value: string }>;
}

async function uploadToIPFS(
  imageBase64: string,
  metadata: { name: string; symbol: string; description?: string; website?: string }
): Promise<string> {
  if (!IPFS_ENABLED) {
    throw new Error('IPFS upload not configured. Set NFT_STORAGE_KEY env var.');
  }
  
  // Dynamic import for nft.storage
  const { NFTStorage, File } = await import('nft.storage');
  const client = new NFTStorage({ token: NFT_STORAGE_KEY });
  
  // Parse base64 image
  let imageBuffer: Buffer;
  let mimeType = 'image/png';
  
  if (imageBase64.startsWith('data:')) {
    // data:image/png;base64,xxxx format
    const matches = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) throw new Error('Invalid base64 data URL format');
    mimeType = matches[1];
    imageBuffer = Buffer.from(matches[2], 'base64');
  } else {
    // Raw base64
    imageBuffer = Buffer.from(imageBase64, 'base64');
  }
  
  // Upload image
  const imageFile = new File([imageBuffer], `image.${mimeType.split('/')[1]}`, { type: mimeType });
  const imageCid = await client.storeBlob(imageFile);
  const imageUrl = `https://ipfs.io/ipfs/${imageCid}`;
  
  // Create metadata JSON
  const metadataJson: MetadataJson = {
    name: metadata.name,
    symbol: metadata.symbol,
    description: metadata.description || `${metadata.name} - Launched via Earn Protocol`,
    image: imageUrl,
    external_url: metadata.website || 'https://earn.supply',
    attributes: [
      { trait_type: 'Launched By', value: 'Earn Protocol' },
      { trait_type: 'Platform', value: 'Pump.fun' },
    ],
  };
  
  // Upload metadata
  const metadataFile = new File(
    [JSON.stringify(metadataJson, null, 2)],
    'metadata.json',
    { type: 'application/json' }
  );
  const metadataCid = await client.storeBlob(metadataFile);
  
  return `https://ipfs.io/ipfs/${metadataCid}`;
}

// Calculate global stats with caching
let statsCache: { stats: GlobalStats; tokenCount: number; cachedAt: number } | null = null;
const STATS_CACHE_TTL_MS = 10000; // 10 second cache

function calculateStats(): GlobalStats {
  const now = Date.now();
  const currentCount = tokenRegistry.size;
  
  // Return cached stats if still valid and token count unchanged
  if (statsCache && 
      now - statsCache.cachedAt < STATS_CACHE_TTL_MS && 
      statsCache.tokenCount === currentCount) {
    return statsCache.stats;
  }
  
  const tokens = Array.from(tokenRegistry.values());
  const agents = new Set(tokens.map(t => t.agentWallet));
  const byTokenomics: Record<string, number> = {};
  
  for (const token of tokens) {
    byTokenomics[token.tokenomics] = (byTokenomics[token.tokenomics] || 0) + 1;
  }
  
  const stats: GlobalStats = {
    totalLaunches: tokens.length,
    totalAgents: agents.size,
    launchesByTokenomics: byTokenomics,
    lastLaunch: tokens.length > 0 
      ? tokens.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0].createdAt
      : null,
  };
  
  // Cache the stats
  statsCache = { stats, tokenCount: currentCount, cachedAt: now };
  
  return stats;
}

// ============ RATE LIMITING ============

const rateLimitStore: Map<string, { count: number; resetAt: number }> = new Map();

// Cleanup expired rate limit entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now > record.resetAt) {
      rateLimitStore.delete(ip);
    }
  }
}, 5 * 60 * 1000);

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

| Style | You | Earn | Stakers | Best For |
|-------|-----|------|---------|----------|
| degen | 40% | 30% | 30% | High volume memes |
| creator | 50% | 25% | 25% | Content creators |
| community | 25% | 25% | 50% | DAO-style projects |
| lowfee | 40% | 30% | 30% | Max trading volume |

**Stakers** = People who stake your token on earn.supply/stake earn a portion of fees!

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

// CORS configuration
const CORS_ORIGINS = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['*']; // Allow all by default for development

app.use(cors({
  origin: CORS_ORIGINS.includes('*') ? true : CORS_ORIGINS,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Admin-Key'],
}));

app.use(express.json({ limit: '10mb' }));

// Request logging middleware for debugging
app.use((req, res, next) => {
  if (process.env.DEBUG_REQUESTS) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// Load Earn wallet
let earnWallet: Keypair;
let connection: Connection;
let pumpSdk: PumpSdk;

try {
  earnWallet = loadKeypair(EARN_WALLET_PATH);
  connection = new Connection(RPC_URL, {
    commitment: RPC_COMMITMENT,
    confirmTransactionInitialTimeout: RPC_TIMEOUT_MS,
  });
  pumpSdk = new PumpSdk();
  console.log('✅ Earn Wallet:', earnWallet.publicKey.toString());
  console.log('✅ Loaded', tokenRegistry.size, 'existing tokens');
  console.log(IPFS_ENABLED ? '✅ IPFS uploads enabled' : '⚠️ IPFS disabled (set NFT_STORAGE_KEY to enable)');
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
    ipfsEnabled: IPFS_ENABLED,
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
    
    // Name validation and sanitization
    const sanitizedName = sanitizeString(name);
    if (typeof name !== 'string' || sanitizedName.length < 2 || sanitizedName.length > 32) {
      return res.status(400).json({
        success: false,
        error: 'Name must be 2-32 characters',
        requestId,
      });
    }
    
    if (!isValidTokenName(sanitizedName)) {
      return res.status(400).json({
        success: false,
        error: 'Name can only contain letters, numbers, spaces, and basic punctuation',
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
    
    // Handle image: URL or base64
    let uri = image;
    if (isBase64Image(image)) {
      if (!IPFS_ENABLED) {
        return res.status(400).json({
          success: false,
          error: 'Base64 images require IPFS to be configured. Please provide an image URL instead.',
          hint: 'Server admin: Set NFT_STORAGE_KEY env var to enable IPFS uploads',
          requestId,
        });
      }
      
      console.log(`   📤 Uploading image to IPFS...`);
      try {
        uri = await uploadToIPFS(image, { name, symbol: ticker.toUpperCase(), description, website });
        console.log(`   ✅ IPFS URI: ${uri}`);
      } catch (ipfsError: any) {
        console.error(`   ❌ IPFS upload failed:`, ipfsError.message);
        return res.status(500).json({
          success: false,
          error: `IPFS upload failed: ${ipfsError.message}`,
          requestId,
        });
      }
    }
    
    // Build create instruction (use sanitized name)
    const createIx = await pumpSdk.createV2Instruction({
      mint: mintKeypair.publicKey,
      name: sanitizedName,
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
    
    // Store token config (use sanitized values)
    const preset = TOKENOMICS_PRESETS[tokenomics];
    const sanitizedDescription = description ? sanitizeString(description) : undefined;
    const config: TokenConfig = {
      mint: mintKeypair.publicKey.toString(),
      name: sanitizedName,
      symbol: ticker.toUpperCase(),
      uri,
      agentWallet,
      tokenomics,
      agentCutBps: preset.agentCut * 100,
      earnCutBps: preset.earnCut * 100,
      stakingCutBps: preset.stakingCut * 100,
      createdAt: new Date().toISOString(),
      txSignature: signature,
      description: sanitizedDescription,
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
      name: sanitizedName,
      symbol: ticker.toUpperCase(),
      pumpfun: `https://pump.fun/${mintKeypair.publicKey.toString()}`,
      solscan: isDevnet
        ? `https://solscan.io/token/${mintKeypair.publicKey.toString()}?cluster=devnet`
        : `https://solscan.io/token/${mintKeypair.publicKey.toString()}`,
      staking: `https://earn.supply/stake/${mintKeypair.publicKey.toString()}`,
      agentWallet,
      tokenomics,
      feeSplit: {
        agent: `${preset.agentCut}%`,
        earn: `${preset.earnCut}%`,
        stakers: `${preset.stakingCut}%`,
      },
      txSignature: signature,
      network: isDevnet ? 'devnet' : 'mainnet',
    });
    
  } catch (e: any) {
    // Handle different error types robustly
    let errorMessage: string;
    if (e instanceof Error) {
      errorMessage = e.message;
    } else if (typeof e === 'string') {
      errorMessage = e;
    } else if (e && typeof e === 'object') {
      errorMessage = e.message || e.error || JSON.stringify(e);
    } else {
      errorMessage = 'Unknown error occurred';
    }
    
    // Check for common Solana errors
    if (errorMessage.includes('0x1') || errorMessage.includes('insufficient')) {
      errorMessage = 'Insufficient SOL balance. Airdrop SOL to the Earn wallet on devnet.';
    }
    
    console.error(`❌ [${requestId}] Launch failed:`, errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
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

// Get all tokens (for dashboard) with pagination and filtering
app.get('/tokens', (req, res) => {
  let tokens = Array.from(tokenRegistry.values());
  
  // Filter by tokenomics
  const tokenomicsFilter = req.query.tokenomics as string;
  if (tokenomicsFilter && TOKENOMICS_PRESETS[tokenomicsFilter]) {
    tokens = tokens.filter(t => t.tokenomics === tokenomicsFilter);
  }
  
  // Filter by agent wallet
  const agentFilter = req.query.agent as string;
  if (agentFilter) {
    tokens = tokens.filter(t => t.agentWallet === agentFilter);
  }
  
  // Search by name or symbol
  const search = (req.query.search as string || '').toLowerCase();
  if (search) {
    tokens = tokens.filter(t => 
      t.name.toLowerCase().includes(search) || 
      t.symbol.toLowerCase().includes(search)
    );
  }
  
  // Sort (default: newest first)
  const sortBy = req.query.sort as string;
  if (sortBy === 'oldest') {
    tokens.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } else {
    tokens.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  
  // Pagination
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;
  const totalCount = tokens.length;
  const paginatedTokens = tokens.slice(offset, offset + limit);
  
  res.json({
    success: true,
    count: paginatedTokens.length,
    total: totalCount,
    page,
    limit,
    pages: Math.ceil(totalCount / limit),
    tokens: paginatedTokens.map(t => ({
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
      stakingCut: `${value.stakingCut}%`,
      description: value.description,
    })),
    note: 'Staking cut goes to token holders who stake on earn.supply/stake',
  });
});

// ============ STAKING ENDPOINTS ============

// Helper: Generate mock staking data for a token
function generateStakingPool(token: TokenConfig) {
  // Simulate based on token age and randomness seeded by mint
  const seed = parseInt(token.mint.slice(0, 8), 16);
  const random = (min: number, max: number) => min + (seed % (max - min));
  
  const totalStaked = random(1000, 100000) * 1e9; // lamports worth
  const volume24h = random(5000, 200000); // USD
  const stakingCut = token.stakingCutBps / 10000;
  const dailyRewards = volume24h * 0.01 * stakingCut; // 1% fee * staking cut
  const apy = totalStaked > 0 ? ((dailyRewards * 365) / (totalStaked / 1e9)) * 100 : 0;
  
  return {
    mint: token.mint,
    name: token.name,
    symbol: token.symbol,
    tokenomics: token.tokenomics,
    stakingCut: `${token.stakingCutBps / 100}%`,
    pool: {
      totalStaked: totalStaked / 1e9,
      totalStakedUsd: (totalStaked / 1e9) * 0.00001, // Mock price
      stakerCount: random(10, 500),
      rewardsAvailable: random(1, 50),
      rewardsDistributed: random(10, 200),
    },
    stats: {
      apy: Math.min(apy, 9999).toFixed(1) + '%',
      volume24h: `$${volume24h.toLocaleString()}`,
      dailyRewards: `${dailyRewards.toFixed(2)} SOL`,
    },
    stakingUrl: `https://earn.supply/stake/${token.mint}`,
  };
}

// Get all staking pools
app.get('/stake/pools', (req, res) => {
  const tokens = Array.from(tokenRegistry.values());
  const pools = tokens.map(generateStakingPool);
  
  // Sort by APY descending
  pools.sort((a, b) => parseFloat(b.stats.apy) - parseFloat(a.stats.apy));
  
  res.json({
    success: true,
    count: pools.length,
    pools,
    note: 'Mock data - on-chain staking coming soon',
  });
});

// Get specific staking pool
app.get('/stake/pool/:mint', (req, res) => {
  const token = tokenRegistry.get(req.params.mint);
  if (!token) {
    return res.status(404).json({ success: false, error: 'Token not found' });
  }
  
  const pool = generateStakingPool(token);
  res.json({
    success: true,
    ...pool,
    note: 'Mock data - on-chain staking coming soon',
  });
});

// Get user's staking positions
app.get('/stake/user/:wallet', (req, res) => {
  const wallet = req.params.wallet;
  
  // Validate wallet
  try {
    new PublicKey(wallet);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid wallet address' });
  }
  
  // Generate mock positions for demo
  const tokens = Array.from(tokenRegistry.values()).slice(0, 3); // First 3 tokens
  const positions = tokens.map(token => {
    const seed = parseInt(wallet.slice(0, 8), 16) + parseInt(token.mint.slice(0, 8), 16);
    const stakedAmount = (seed % 10000) + 100;
    const earnedRewards = (seed % 100) / 100;
    
    return {
      mint: token.mint,
      symbol: token.symbol,
      stakedAmount,
      stakedValueUsd: stakedAmount * 0.00001,
      earnedRewards: earnedRewards.toFixed(4) + ' SOL',
      earnedRewardsUsd: (earnedRewards * 100).toFixed(2),
      stakedAt: new Date(Date.now() - (seed % 7) * 24 * 60 * 60 * 1000).toISOString(),
    };
  });
  
  const totalStakedUsd = positions.reduce((sum, p) => sum + p.stakedValueUsd, 0);
  const totalEarned = positions.reduce((sum, p) => sum + parseFloat(p.earnedRewards), 0);
  
  res.json({
    success: true,
    wallet,
    totalStakedUsd: `$${totalStakedUsd.toFixed(2)}`,
    totalEarnedSol: `${totalEarned.toFixed(4)} SOL`,
    positionCount: positions.length,
    positions,
    note: 'Mock data - on-chain staking coming soon',
  });
});

// Staking quote (preview stake/unstake)
app.post('/stake/quote', (req, res) => {
  const { mint, amount, action } = req.body;
  
  if (!mint || !amount || !action) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: mint, amount, action (stake/unstake)',
    });
  }
  
  const token = tokenRegistry.get(mint);
  if (!token) {
    return res.status(404).json({ success: false, error: 'Token not found' });
  }
  
  const pool = generateStakingPool(token);
  const apy = parseFloat(pool.stats.apy);
  const dailyReturn = (amount * (apy / 100)) / 365;
  
  res.json({
    success: true,
    action,
    mint,
    amount,
    pool: {
      currentApy: pool.stats.apy,
      totalStaked: pool.pool.totalStaked,
    },
    estimate: {
      dailyRewards: `${dailyReturn.toFixed(6)} SOL`,
      weeklyRewards: `${(dailyReturn * 7).toFixed(6)} SOL`,
      monthlyRewards: `${(dailyReturn * 30).toFixed(6)} SOL`,
    },
    gasCost: '~0.00025 SOL',
    note: 'Estimates based on current APY, actual returns may vary',
  });
});

// ============ END STAKING ============

// ============ ADMIN ENDPOINTS ============

// Trigger fee distribution (crank)
app.post('/admin/distribute', async (req, res) => {
  // Simple auth check (in production, use proper auth)
  const authKey = req.headers['x-admin-key'];
  if (authKey !== process.env.ADMIN_KEY && process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  console.log('\n🔄 Manual distribution triggered via API');
  
  try {
    // Dynamic import of crank
    const { runDistributionCrank } = await import('./crank');
    const result = await runDistributionCrank();
    
    res.json({
      success: result.success,
      ...result,
    });
  } catch (e: any) {
    console.error('Distribution failed:', e);
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

// Get distribution history
app.get('/admin/distributions', (req, res) => {
  const logPath = path.join(DATA_DIR, 'distributions.json');
  
  try {
    if (fs.existsSync(logPath)) {
      const log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
      res.json({ success: true, ...log });
    } else {
      res.json({
        success: true,
        lastRun: null,
        totalDistributed: 0,
        distributions: [],
      });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// System status (for monitoring)
app.get('/admin/status', async (req, res) => {
  try {
    // Get system metrics (always available)
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    
    // Try to check wallet balance (may fail if RPC is down)
    let balance: number | null = null;
    let rpcStatus = 'ok';
    try {
      balance = await connection.getBalance(earnWallet.publicKey);
    } catch {
      rpcStatus = 'unavailable';
    }
    
    res.json({
      success: true,
      system: {
        uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
        memory: {
          heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`,
        },
        rateLimitEntries: rateLimitStore.size,
      },
      wallet: {
        address: earnWallet.publicKey.toString(),
        balance: balance !== null ? `${(balance / 1e9).toFixed(4)} SOL` : 'unavailable',
        balanceLamports: balance,
      },
      rpc: {
        url: RPC_URL,
        status: rpcStatus,
      },
      registry: {
        tokens: tokenRegistry.size,
      },
      network: RPC_URL.includes('devnet') ? 'devnet' : 'mainnet',
      ipfsEnabled: IPFS_ENABLED,
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Check wallet balance and airdrop status
app.get('/admin/wallet', async (req, res) => {
  const isDevnet = RPC_URL.includes('devnet');
  
  // Try to get balance (may fail if RPC is down)
  let balance: number | null = null;
  let rpcStatus = 'ok';
  try {
    balance = await connection.getBalance(earnWallet.publicKey);
  } catch {
    rpcStatus = 'unavailable';
  }
  
  res.json({
    success: true,
    address: earnWallet.publicKey.toString(),
    balance: balance !== null ? `${(balance / 1e9).toFixed(4)} SOL` : 'unavailable',
    balanceLamports: balance,
    network: isDevnet ? 'devnet' : 'mainnet',
    rpcStatus,
    canLaunch: balance !== null ? balance > 0.01 * 1e9 : null, // Need ~0.01 SOL for launch
    airdropCommand: isDevnet 
      ? `solana airdrop 1 ${earnWallet.publicKey.toString()} --url devnet`
      : null,
  });
});

// ============ END ADMIN ============

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    hint: 'Try GET /skill.md for documentation',
  });
});

// ============ START ============

const server = app.listen(PORT, () => {
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

// Graceful shutdown
const shutdown = (signal: string) => {
  console.log(`\n📴 Received ${signal}, shutting down gracefully...`);
  
  // Save tokens before exit
  saveTokens(tokenRegistry);
  console.log(`   💾 Saved ${tokenRegistry.size} tokens`);
  
  server.close(() => {
    console.log('   ✅ Server closed');
    process.exit(0);
  });
  
  // Force exit after 10s if still running
  setTimeout(() => {
    console.log('   ⚠️ Forcing exit');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
