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
// PumpSdk loaded dynamically only on mainnet (has native deps that fail on serverless)
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { StakingClient, getStakingPoolPDA, getStakeAccountPDA, STAKING_PROGRAM_ID } from './staking-client';
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

// Check if running on Vercel (serverless - read-only filesystem)
const IS_SERVERLESS = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;

// Ensure data directory exists (skip on serverless)
if (!IS_SERVERLESS && !fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.warn('⚠️ Could not create data directory (may be serverless):', e);
  }
}

// Load tokens from file (returns empty on serverless)
function loadTokens(): Map<string, TokenConfig> {
  if (IS_SERVERLESS) {
    console.log('📦 Serverless mode: using in-memory storage');
    return new Map();
  }
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

// Save tokens to file (no-op on serverless)
function saveTokens(tokens: Map<string, TokenConfig>): void {
  if (IS_SERVERLESS) return; // Serverless has no persistent filesystem
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

// Load keypair from environment variable (base58 private key)
function loadKeypairFromEnv(envKey: string): Keypair | null {
  const key = process.env[envKey];
  if (!key) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(key));
  } catch (e) {
    console.error(`Failed to decode ${envKey}:`, e);
    return null;
  }
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

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| agentWallet | string | Your Solana wallet (defaults to Earn wallet if blank) |
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

try {
  // Try loading from environment variable first (for serverless), then file
  const envWallet = loadKeypairFromEnv('EARN_WALLET_KEY');
  if (envWallet) {
    earnWallet = envWallet;
    console.log('✅ Earn Wallet loaded from EARN_WALLET_KEY env var');
  } else if (!IS_SERVERLESS) {
    earnWallet = loadKeypair(EARN_WALLET_PATH);
    console.log('✅ Earn Wallet loaded from file');
  } else {
    throw new Error('No wallet configured. Set EARN_WALLET_KEY environment variable (base58 private key)');
  }
  
  connection = new Connection(RPC_URL, {
    commitment: RPC_COMMITMENT,
    confirmTransactionInitialTimeout: RPC_TIMEOUT_MS,
  });
  // PumpSdk loaded dynamically only when needed (mainnet launches)
  console.log('✅ Earn Wallet:', earnWallet.publicKey.toString());
  console.log('✅ Loaded', tokenRegistry.size, 'existing tokens');
  console.log(IPFS_ENABLED ? '✅ IPFS uploads enabled' : '⚠️ IPFS disabled (set NFT_STORAGE_KEY to enable)');
} catch (e: any) {
  console.error('❌ Failed to load wallet:', e.message);
  if (!IS_SERVERLESS) process.exit(1);
  // On serverless, we'll fail gracefully on requests that need the wallet
}

// ============ ROUTES ============

// Health check
app.get('/health', (req, res) => {
  if (!earnWallet) {
    return res.status(503).json({
      status: 'error',
      error: 'Wallet not configured. Set EARN_WALLET_KEY environment variable (base58 private key).',
      network: RPC_URL.includes('devnet') ? 'devnet' : 'mainnet',
    });
  }
  res.json({ 
    status: 'ok', 
    wallet: earnWallet.publicKey.toString(),
    network: RPC_URL.includes('devnet') ? 'devnet' : 'mainnet',
    tokensLaunched: tokenRegistry.size,
    ipfsEnabled: IPFS_ENABLED,
  });
});

// Serve logo
app.get('/logo.jpg', (req, res) => {
  res.sendFile('earn-logo.jpg', { root: __dirname });
});

// Skill.md for agents
app.get('/skill.md', (req, res) => {
  res.type('text/markdown').send(SKILL_MD);
});

// Interactive landing page
app.get('/', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Earn Protocol API</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #fff; min-height: 100vh; padding: 2rem; }
    .container { max-width: 600px; margin: 0 auto; }
    h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
    h1 span { color: #ef4444; }
    .subtitle { color: #888; margin-bottom: 2rem; }
    .form-group { margin-bottom: 1.5rem; }
    label { display: block; margin-bottom: 0.5rem; color: #ccc; font-size: 0.9rem; }
    input, select { width: 100%; padding: 0.75rem; border: 1px solid #333; border-radius: 8px; background: #1a1a1a; color: #fff; font-size: 1rem; }
    input:focus, select:focus { outline: none; border-color: #ef4444; }
    select { cursor: pointer; }
    .optional { color: #666; font-size: 0.8rem; }
    button { width: 100%; padding: 1rem; background: #ef4444; color: #fff; border: none; border-radius: 8px; font-size: 1.1rem; font-weight: 600; cursor: pointer; margin-top: 1rem; }
    button:hover { background: #dc2626; }
    button:disabled { background: #666; cursor: not-allowed; }
    .result { margin-top: 2rem; padding: 1rem; background: #1a1a1a; border-radius: 8px; display: none; }
    .result.show { display: block; }
    .result.success { border: 1px solid #22c55e; }
    .result.error { border: 1px solid #ef4444; }
    pre { overflow-x: auto; font-size: 0.85rem; }
    .tokenomics-info { font-size: 0.8rem; color: #888; margin-top: 0.25rem; }
    .curl-box { margin-top: 2rem; padding: 1rem; background: #1a1a1a; border-radius: 8px; }
    .curl-box h3 { margin-bottom: 0.5rem; font-size: 0.9rem; color: #888; }
    .curl-box pre { color: #22c55e; }
    a { color: #ef4444; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 <span>Earn</span> Protocol</h1>
    <p class="subtitle">Launch a token on Pump.fun. Earn handles everything. You get paid.</p>
    
    <form id="launchForm">
      <div class="form-group">
        <label>Token Name *</label>
        <input type="text" id="name" placeholder="My Awesome Token" required minlength="2" maxlength="32">
      </div>
      
      <div class="form-group">
        <label>Ticker *</label>
        <input type="text" id="ticker" placeholder="MAT" required pattern="[A-Za-z]{2,10}">
      </div>
      
      <div class="form-group">
        <label>Image URL *</label>
        <input type="url" id="image" placeholder="https://example.com/logo.png" required>
      </div>
      
      <div class="form-group">
        <label>Tokenomics *</label>
        <select id="tokenomics" required>
          <option value="degen">🎰 Degen - You 40% | Earn 30% | Stakers 30%</option>
          <option value="creator">🎨 Creator - You 50% | Earn 25% | Stakers 25%</option>
          <option value="community">🏛️ Community - You 25% | Earn 25% | Stakers 50%</option>
        </select>
        <div class="tokenomics-info">Choose how trading fees are split</div>
      </div>
      
      <div class="form-group">
        <label>Your Wallet <span class="optional">(optional - defaults to Earn wallet)</span></label>
        <input type="text" id="agentWallet" placeholder="Your Solana wallet address">
      </div>
      
      <button type="submit" id="submitBtn">🚀 Launch Token</button>
    </form>
    
    <div id="result" class="result">
      <pre id="resultContent"></pre>
    </div>
    
    <div class="curl-box">
      <h3>📋 Or use cURL:</h3>
      <pre id="curlCommand">curl -X POST https://api.earn.supply/launch \\
  -H "Content-Type: application/json" \\
  -d '{"name":"...","ticker":"...","image":"...","tokenomics":"degen"}'</pre>
    </div>
    
    <div style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #222;">
      <h3 style="font-size: 1rem; margin-bottom: 1rem; color: #888;">How It Works</h3>
      <div style="display: grid; gap: 0.75rem; font-size: 0.9rem; color: #aaa;">
        <div>1️⃣ You launch a token via this API</div>
        <div>2️⃣ Earn creates it on Pump.fun as the creator</div>
        <div>3️⃣ Users trade → creator fees flow to Earn</div>
        <div>4️⃣ Earn distributes: <span style="color:#22c55e">You</span> + <span style="color:#ef4444">Earn</span> + <span style="color:#3b82f6">Stakers</span></div>
      </div>
      
      <div style="margin-top: 1.5rem; padding: 1rem; background: #111; border-radius: 8px; font-size: 0.85rem; color: #888;">
        <strong style="color: #ef4444;">Earn Wallet:</strong> ${earnWallet?.publicKey?.toString() || 'Loading...'}<br>
        <span style="margin-top: 0.5rem; display: block;">
          💰 Handles all fee collection & distribution<br>
          🔄 Performs token buybacks<br>
          💎 Pays staking rewards automatically
        </span>
      </div>
    </div>
    
    <p style="margin-top: 2rem; color: #666; font-size: 0.85rem;">
      <a href="/skill.md">View full API docs</a> | 
      <a href="/stats">Stats</a> | 
      <a href="https://earn.supply">Dashboard</a> |
      <a href="https://github.com/earn-ai/earn-protocol">GitHub</a>
    </p>
  </div>
  
  <script>
    const form = document.getElementById('launchForm');
    const result = document.getElementById('result');
    const resultContent = document.getElementById('resultContent');
    const submitBtn = document.getElementById('submitBtn');
    const curlCmd = document.getElementById('curlCommand');
    
    // Update curl command as user types
    function updateCurl() {
      const data = {
        name: document.getElementById('name').value || '...',
        ticker: document.getElementById('ticker').value || '...',
        image: document.getElementById('image').value || '...',
        tokenomics: document.getElementById('tokenomics').value
      };
      const wallet = document.getElementById('agentWallet').value;
      if (wallet) data.agentWallet = wallet;
      
      curlCmd.textContent = \`curl -X POST https://api.earn.supply/launch \\\\
  -H "Content-Type: application/json" \\\\
  -d '\${JSON.stringify(data)}'\`;
    }
    
    document.querySelectorAll('input, select').forEach(el => el.addEventListener('input', updateCurl));
    
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Launching...';
      
      const data = {
        name: document.getElementById('name').value,
        ticker: document.getElementById('ticker').value,
        image: document.getElementById('image').value,
        tokenomics: document.getElementById('tokenomics').value
      };
      const wallet = document.getElementById('agentWallet').value;
      if (wallet) data.agentWallet = wallet;
      
      try {
        const res = await fetch('/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const json = await res.json();
        
        result.className = 'result show ' + (json.success ? 'success' : 'error');
        resultContent.textContent = JSON.stringify(json, null, 2);
      } catch (err) {
        result.className = 'result show error';
        resultContent.textContent = 'Error: ' + err.message;
      }
      
      submitBtn.disabled = false;
      submitBtn.textContent = '🚀 Launch Token';
    });
  </script>
</body>
</html>`;
  res.type('text/html').send(html);
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
    
    // Required fields (agentWallet defaults to Earn wallet if not provided)
    if (!name || !ticker || !image || !tokenomics) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['name', 'ticker', 'image', 'tokenomics'],
        optional: ['agentWallet (defaults to Earn wallet)'],
        requestId,
      });
    }
    
    // Default to Earn wallet if no agent wallet provided
    const finalAgentWallet = agentWallet || earnWallet.publicKey.toString();
    
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
      agentPubkey = new PublicKey(finalAgentWallet);
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
    
    const isDevnet = RPC_URL.includes('devnet');
    
    console.log(`\n🚀 [${requestId}] Launching: ${name} (${ticker.toUpperCase()})`);
    console.log(`   Agent: ${finalAgentWallet}${!agentWallet ? ' (defaulted to Earn)' : ''}`);
    console.log(`   Tokenomics: ${tokenomics}`);
    console.log(`   Network: ${isDevnet ? 'devnet (mock)' : 'mainnet'}`);
    
    // Generate mint keypair
    const mintKeypair = Keypair.generate();
    
    // ========== DEVNET MOCK MODE ==========
    // Pump.fun doesn't exist on devnet, so we simulate the launch
    if (isDevnet) {
      console.log(`   🧪 Devnet mock mode - simulating launch`);
      
      // Store token config
      const preset = TOKENOMICS_PRESETS[tokenomics];
      const sanitizedDescription = description ? sanitizeString(description) : undefined;
      const config: TokenConfig = {
        mint: mintKeypair.publicKey.toString(),
        name: sanitizedName,
        symbol: ticker.toUpperCase(),
        uri: image, // Use original image URL for mock
        agentWallet: finalAgentWallet,
        tokenomics,
        agentCutBps: preset.agentCut * 100,
        earnCutBps: preset.earnCut * 100,
        stakingCutBps: preset.stakingCut * 100,
        createdAt: new Date().toISOString(),
        txSignature: 'mock_' + requestId, // Mock signature
        description: sanitizedDescription,
        website,
        twitter,
        launchNumber: tokenRegistry.size + 1,
      };
      
      tokenRegistry.set(mintKeypair.publicKey.toString(), config);
      saveTokens(tokenRegistry);
      
      console.log(`   ✅ Mock token #${config.launchNumber}: ${mintKeypair.publicKey.toString()}`);
      
      return res.json({
        success: true,
        requestId,
        launchNumber: config.launchNumber,
        mint: mintKeypair.publicKey.toString(),
        name: sanitizedName,
        symbol: ticker.toUpperCase(),
        pumpfun: `https://pump.fun/${mintKeypair.publicKey.toString()}`,
        solscan: `https://solscan.io/token/${mintKeypair.publicKey.toString()}?cluster=devnet`,
        staking: `https://earn.supply/stake/${mintKeypair.publicKey.toString()}`,
        agentWallet: finalAgentWallet,
        tokenomics,
        feeSplit: {
          agent: `${preset.agentCut}%`,
          earn: `${preset.earnCut}%`,
          stakers: `${preset.stakingCut}%`,
        },
        txSignature: 'mock_' + requestId,
        network: 'devnet',
        mock: true,
        note: 'Devnet mock - Pump.fun only exists on mainnet. Token registered but not created on-chain.',
      });
    }
    
    // ========== MAINNET REAL LAUNCH ==========
    
    // Dynamically import PumpSdk (only needed for mainnet, has native deps)
    const { PumpSdk, bondingCurvePda } = await import('@pump-fun/pump-sdk');
    const pumpSdk = new PumpSdk();
    
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
      agentWallet: finalAgentWallet,
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
    
    // Return success (isDevnet already declared above)
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
      agentWallet: finalAgentWallet,
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

// Initialize staking client
let stakingClient: StakingClient;
try {
  stakingClient = new StakingClient(connection);
} catch (e) {
  console.warn('⚠️ Staking client not initialized (connection may be missing)');
}

// Get global staking config
app.get('/stake/config', async (req, res) => {
  try {
    const config = await stakingClient.getGlobalConfig();
    if (!config) {
      return res.json({
        success: true,
        initialized: false,
        note: 'Global config not yet initialized',
      });
    }
    res.json({
      success: true,
      initialized: true,
      authority: config.authority.toString(),
      earnWallet: config.earnWallet.toString(),
      totalPools: config.totalPools.toString(),
      totalStakedValue: config.totalStakedValue.toString(),
      totalRewardsDistributed: (Number(config.totalRewardsDistributed) / 1e9).toFixed(4) + ' SOL',
      programId: STAKING_PROGRAM_ID.toString(),
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get all staking pools (on-chain)
app.get('/stake/pools', async (req, res) => {
  try {
    const pools = await stakingClient.getAllPools();
    
    // Enrich with token registry data if available
    const enrichedPools = pools.map(({ pubkey, pool }) => {
      const tokenConfig = tokenRegistry.get(pool.mint.toString());
      return {
        poolAddress: pubkey.toString(),
        mint: pool.mint.toString(),
        name: tokenConfig?.name || 'Unknown',
        symbol: tokenConfig?.symbol || '???',
        agentWallet: pool.agentWallet.toString(),
        totalStaked: pool.totalStaked.toString(),
        stakerCount: pool.stakerCount,
        rewardsAvailable: (Number(pool.rewardsAvailable) / 1e9).toFixed(4) + ' SOL',
        rewardsDistributed: (Number(pool.rewardsDistributed) / 1e9).toFixed(4) + ' SOL',
        minStakeAmount: pool.minStakeAmount.toString(),
        cooldownSeconds: pool.cooldownSeconds,
        paused: pool.paused,
        createdAt: new Date(Number(pool.createdAt) * 1000).toISOString(),
        stakingUrl: `https://earn.supply/stake/${pool.mint.toString()}`,
      };
    });
    
    res.json({
      success: true,
      count: enrichedPools.length,
      pools: enrichedPools,
      programId: STAKING_PROGRAM_ID.toString(),
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get specific staking pool
app.get('/stake/pool/:mint', async (req, res) => {
  try {
    const mint = new PublicKey(req.params.mint);
    const pool = await stakingClient.getStakingPool(mint);
    
    if (!pool) {
      // Check if pool just doesn't exist vs other error
      const [poolPDA] = getStakingPoolPDA(mint);
      return res.json({
        success: true,
        exists: false,
        poolAddress: poolPDA.toString(),
        mint: req.params.mint,
        note: 'Pool not created yet. Use POST /stake/create-pool to create one.',
      });
    }
    
    const tokenConfig = tokenRegistry.get(req.params.mint);
    const [poolPDA] = getStakingPoolPDA(mint);
    
    res.json({
      success: true,
      exists: true,
      poolAddress: poolPDA.toString(),
      mint: pool.mint.toString(),
      name: tokenConfig?.name || 'Unknown',
      symbol: tokenConfig?.symbol || '???',
      agentWallet: pool.agentWallet.toString(),
      totalStaked: pool.totalStaked.toString(),
      stakerCount: pool.stakerCount,
      rewardsAvailable: (Number(pool.rewardsAvailable) / 1e9).toFixed(4) + ' SOL',
      rewardsDistributed: (Number(pool.rewardsDistributed) / 1e9).toFixed(4) + ' SOL',
      minStakeAmount: pool.minStakeAmount.toString(),
      cooldownSeconds: pool.cooldownSeconds,
      paused: pool.paused,
      createdAt: new Date(Number(pool.createdAt) * 1000).toISOString(),
    });
  } catch (e: any) {
    if (e.message?.includes('Invalid public key')) {
      return res.status(400).json({ success: false, error: 'Invalid mint address' });
    }
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get user's staking positions (on-chain)
app.get('/stake/user/:wallet', async (req, res) => {
  try {
    const wallet = new PublicKey(req.params.wallet);
    const stakes = await stakingClient.getUserStakes(wallet);
    
    // Enrich with pool and token data
    const positions = await Promise.all(stakes.map(async ({ pubkey, stake }) => {
      // Get pool data
      const pool = await stakingClient.getStakingPool(stake.pool);
      const tokenConfig = pool ? tokenRegistry.get(pool.mint.toString()) : null;
      
      return {
        stakeAccountAddress: pubkey.toString(),
        poolAddress: stake.pool.toString(),
        mint: pool?.mint.toString() || 'unknown',
        symbol: tokenConfig?.symbol || '???',
        amount: stake.amount.toString(),
        rewardsEarned: (Number(stake.rewardsEarned) / 1e9).toFixed(6) + ' SOL',
        stakedAt: stake.stakedAt > 0 ? new Date(Number(stake.stakedAt) * 1000).toISOString() : null,
        lastClaimAt: stake.lastClaimAt > 0 ? new Date(Number(stake.lastClaimAt) * 1000).toISOString() : null,
        unstakeRequested: stake.unstakeRequestedAt > 0,
        unstakeAmount: stake.unstakeAmount.toString(),
      };
    }));
    
    const totalEarned = stakes.reduce((sum, { stake }) => sum + Number(stake.rewardsEarned), 0);
    
    res.json({
      success: true,
      wallet: req.params.wallet,
      positionCount: positions.length,
      totalEarnedSol: (totalEarned / 1e9).toFixed(6) + ' SOL',
      positions,
    });
  } catch (e: any) {
    if (e.message?.includes('Invalid public key')) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }
    res.status(500).json({ success: false, error: e.message });
  }
});

// Create staking pool for a token (admin only)
app.post('/stake/create-pool', async (req, res) => {
  try {
    const { mint, agentWallet, minStakeAmount, cooldownSeconds } = req.body;
    
    if (!mint) {
      return res.status(400).json({ success: false, error: 'Missing required field: mint' });
    }
    
    const mintPubkey = new PublicKey(mint);
    const agentPubkey = agentWallet ? new PublicKey(agentWallet) : earnWallet.publicKey;
    
    // Check if pool already exists
    const existing = await stakingClient.getStakingPool(mintPubkey);
    if (existing) {
      const [poolPDA] = getStakingPoolPDA(mintPubkey);
      return res.status(400).json({
        success: false,
        error: 'Pool already exists',
        poolAddress: poolPDA.toString(),
      });
    }
    
    // Build create pool transaction
    const { transaction, poolPDA } = stakingClient.buildCreatePoolTx(
      mintPubkey,
      agentPubkey,
      earnWallet.publicKey,
      BigInt(minStakeAmount || 1000000),
      cooldownSeconds || 0
    );
    
    // Get recent blockhash and sign
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = earnWallet.publicKey;
    transaction.sign(earnWallet);
    
    // Send transaction
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    
    // Confirm
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    
    res.json({
      success: true,
      poolAddress: poolPDA.toString(),
      mint,
      txSignature: signature,
      explorer: `https://solscan.io/tx/${signature}?cluster=devnet`,
    });
  } catch (e: any) {
    console.error('Create pool failed:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Build stake transaction (returns unsigned tx for user to sign)
app.post('/stake/tx/stake', async (req, res) => {
  try {
    const { mint, userWallet, amount } = req.body;
    
    if (!mint || !userWallet || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: mint, userWallet, amount',
      });
    }
    
    const mintPubkey = new PublicKey(mint);
    const userPubkey = new PublicKey(userWallet);
    
    // Check pool exists
    const pool = await stakingClient.getStakingPool(mintPubkey);
    if (!pool) {
      return res.status(404).json({ success: false, error: 'Staking pool not found for this token' });
    }
    
    // Build transaction
    const { transaction, stakeAccountPDA } = stakingClient.buildStakeTx(
      mintPubkey,
      userPubkey,
      BigInt(amount)
    );
    
    // Add recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPubkey;
    
    // Serialize (unsigned)
    const serialized = transaction.serialize({ requireAllSignatures: false }).toString('base64');
    
    res.json({
      success: true,
      transaction: serialized,
      stakeAccountAddress: stakeAccountPDA.toString(),
      mint,
      amount,
      note: 'Sign this transaction with your wallet to stake',
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Build unstake transaction
app.post('/stake/tx/unstake', async (req, res) => {
  try {
    const { mint, userWallet, amount } = req.body;
    
    if (!mint || !userWallet || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: mint, userWallet, amount',
      });
    }
    
    const mintPubkey = new PublicKey(mint);
    const userPubkey = new PublicKey(userWallet);
    
    // Build transaction
    const transaction = stakingClient.buildUnstakeTx(mintPubkey, userPubkey, BigInt(amount));
    
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPubkey;
    
    const serialized = transaction.serialize({ requireAllSignatures: false }).toString('base64');
    
    res.json({
      success: true,
      transaction: serialized,
      mint,
      amount,
      note: 'Sign this transaction with your wallet to unstake',
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Build claim rewards transaction
app.post('/stake/tx/claim', async (req, res) => {
  try {
    const { mint, userWallet } = req.body;
    
    if (!mint || !userWallet) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: mint, userWallet',
      });
    }
    
    const mintPubkey = new PublicKey(mint);
    const userPubkey = new PublicKey(userWallet);
    
    // Build transaction
    const transaction = stakingClient.buildClaimTx(mintPubkey, userPubkey);
    
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPubkey;
    
    const serialized = transaction.serialize({ requireAllSignatures: false }).toString('base64');
    
    res.json({
      success: true,
      transaction: serialized,
      mint,
      note: 'Sign this transaction with your wallet to claim rewards',
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
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

// Export for Vercel serverless
export default app;
