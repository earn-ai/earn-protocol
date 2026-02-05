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
import * as supabase from './supabase';
import * as birdeye from './birdeye';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Feature flags
const USE_SUPABASE = supabase.isSupabaseConfigured();
const USE_BIRDEYE = birdeye.isBirdeyeConfigured();

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

const SKILL_MD = `# Earn Protocol Skill

> Tokenomics-as-a-Service for Solana. Launch tokens with built-in fees, staking, and buybacks.

## What This Does

Earn Protocol gives your token instant tokenomics:
- **Fee collection** on trades (creator + stakers + buyback)
- **Staking rewards** for holders
- **Automated buybacks** to support price
- **Creator revenue** without rugging

One API call. No smart contract knowledge needed.

## Base URL

\`\`\`
https://api.earn.supply
\`\`\`

## Quick Start: Launch a Token

\`\`\`bash
curl -X POST https://api.earn.supply/launch \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My Agent Token",
    "symbol": "AGENT",
    "description": "Token for my autonomous agent",
    "image": "https://example.com/logo.png",
    "twitter": "https://twitter.com/myagent",
    "website": "https://myagent.ai",
    "template": "creator"
  }'
\`\`\`

**Templates:**
- \`degen\` - 40% creator, 30% earn, 30% stakers (high volume memes)
- \`creator\` - 50% creator, 25% earn, 25% stakers (content creators)
- \`community\` - 25% creator, 25% earn, 50% stakers (DAO-style)

## All Endpoints

### Health Check
\`\`\`bash
curl https://api.earn.supply/health
\`\`\`

### Get Token Info
\`\`\`bash
curl https://api.earn.supply/token/{mint}
\`\`\`

### Register Existing Token
\`\`\`bash
curl -X POST https://api.earn.supply/register \\
  -H "Content-Type: application/json" \\
  -d '{"mint": "TokenMint...", "creator": "CreatorWallet...", "template": "creator"}'
\`\`\`

### Create Staking Pool
\`\`\`bash
curl -X POST https://api.earn.supply/pool/create \\
  -H "Content-Type: application/json" \\
  -d '{"mint": "TokenMint...", "rewardRate": 100, "lockPeriod": 86400}'
\`\`\`

### Get Pool Info
\`\`\`bash
curl https://api.earn.supply/pool/{mint}
\`\`\`

### Stake Tokens
\`\`\`bash
curl -X POST https://api.earn.supply/stake \\
  -H "Content-Type: application/json" \\
  -d '{"pool": "PoolAddress...", "amount": 1000000000, "staker": "StakerWallet..."}'
\`\`\`

### Unstake Tokens
\`\`\`bash
curl -X POST https://api.earn.supply/unstake \\
  -H "Content-Type: application/json" \\
  -d '{"pool": "PoolAddress...", "staker": "StakerWallet..."}'
\`\`\`

### Claim Rewards
\`\`\`bash
curl -X POST https://api.earn.supply/claim \\
  -H "Content-Type: application/json" \\
  -d '{"pool": "PoolAddress...", "staker": "StakerWallet..."}'
\`\`\`

### Explore Tokens
\`\`\`bash
curl "https://api.earn.supply/api/explore?template=creator&sort=newest"
\`\`\`

### Get Stats
\`\`\`bash
curl https://api.earn.supply/api/stats
\`\`\`

## Fee Templates

| Template | Creator | Earn | Stakers | Best For |
|----------|---------|------|---------|----------|
| degen | 40% | 30% | 30% | High volume memes |
| creator | 50% | 25% | 25% | Content creators |
| community | 25% | 25% | 50% | DAO-style, reward holders |
| low_fee | 20% | 10% | 70% | Maximum holder rewards |

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad request - Invalid or missing parameters |
| 404 | Not found - Token not registered |
| 429 | Rate limited - Max 10 requests per minute |
| 500 | Server error - Try again later |

## Links

- **API:** https://api.earn.supply
- **Frontend:** https://earn.supply
- **Docs:** https://earn.supply/docs
- **GitHub:** https://github.com/earn-ai/earn-protocol
- **Earn Wallet:** EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ

## Network

Currently on **Solana Devnet**. Mainnet coming soon.

---

Built by Earn for the Colosseum Agent Hackathon 🚀
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

// Debug endpoint - check env vars
app.get('/debug', (req, res) => {
  res.json({
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_KEY,
    hasEarnWalletKey: !!process.env.EARN_WALLET_KEY,
    supabaseConfigured: USE_SUPABASE,
    birdeyeConfigured: USE_BIRDEYE,
    isServerless: IS_SERVERLESS,
    nodeEnv: process.env.NODE_ENV,
  });
});

// Serve logo
app.get('/logo.jpg', (req, res) => {
  res.sendFile('earn-logo.jpg', { root: __dirname });
});

// ============ AI AGENT DISCOVERY ============

// OpenAI Plugin Manifest
app.get('/.well-known/ai-plugin.json', (req, res) => {
  res.json({
    schema_version: "v1",
    name_for_human: "Earn Protocol",
    name_for_model: "earn_protocol",
    description_for_human: "Launch tokens on Pump.fun with automatic fee sharing, buybacks, and staking rewards.",
    description_for_model: "Earn Protocol API for launching tokens on Solana/Pump.fun. Use this to: 1) Launch new tokens with POST /launch, 2) Get token listings with GET /explore, 3) Get protocol stats with GET /stats, 4) Get token details with GET /token/:mint. All tokens launched through Earn automatically have fee distribution to creators, stakers, and buybacks.",
    auth: { type: "none" },
    api: {
      type: "openapi",
      url: "https://api.earn.supply/openapi.json"
    },
    logo_url: "https://api.earn.supply/logo.jpg",
    contact_email: "support@earn.supply",
    legal_info_url: "https://earn.supply/terms"
  });
});

// OpenAPI Specification
app.get('/openapi.json', (req, res) => {
  res.json({
    openapi: "3.0.0",
    info: {
      title: "Earn Protocol API",
      version: "1.0.0",
      description: "Launch tokens on Pump.fun with automatic tokenomics. Fee sharing, buybacks, and staking rewards built-in.",
      contact: { email: "support@earn.supply", url: "https://earn.supply" }
    },
    servers: [{ url: "https://api.earn.supply", description: "Production" }],
    paths: {
      "/launch": {
        post: {
          summary: "Launch a new token",
          description: "Create a new token on Pump.fun with automatic fee distribution",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "ticker", "image", "tokenomics"],
                  properties: {
                    name: { type: "string", description: "Token name (2-32 chars)", example: "My Token" },
                    ticker: { type: "string", description: "Token symbol (2-10 chars)", example: "MTK" },
                    image: { type: "string", description: "Image URL or base64", example: "https://example.com/logo.png" },
                    tokenomics: { type: "string", enum: ["degen", "creator", "community", "lowfee"], description: "Fee distribution template" },
                    agentWallet: { type: "string", description: "Creator wallet (optional, defaults to Earn wallet)" },
                    description: { type: "string", description: "Token description" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Token launched successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      mint: { type: "string", description: "Token mint address" },
                      name: { type: "string" },
                      symbol: { type: "string" },
                      pumpfun: { type: "string", description: "Pump.fun URL" },
                      txSignature: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/explore": {
        get: {
          summary: "List all tokens",
          description: "Get paginated list of tokens with optional filtering and price data",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
            { name: "tokenomics", in: "query", schema: { type: "string", enum: ["degen", "creator", "community", "lowfee"] } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["newest", "oldest", "volume"] } },
            { name: "includePrice", in: "query", schema: { type: "boolean", default: true } }
          ],
          responses: {
            "200": {
              description: "Token list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      tokens: { type: "array", items: { $ref: "#/components/schemas/Token" } },
                      total: { type: "integer" },
                      page: { type: "integer" },
                      pages: { type: "integer" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/stats": {
        get: {
          summary: "Protocol statistics",
          description: "Get overall protocol stats including total tokens, volume, and fees",
          responses: {
            "200": {
              description: "Protocol stats",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      totalLaunches: { type: "integer" },
                      totalAgents: { type: "integer" },
                      totalVolume24h: { type: "number" },
                      earnWallet: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/token/{mint}": {
        get: {
          summary: "Token details",
          description: "Get detailed information about a specific token",
          parameters: [
            { name: "mint", in: "path", required: true, schema: { type: "string" }, description: "Token mint address" }
          ],
          responses: {
            "200": {
              description: "Token details",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Token" } } }
            },
            "404": { description: "Token not found" }
          }
        }
      },
      "/health": {
        get: {
          summary: "API health check",
          responses: { "200": { description: "API is healthy" } }
        }
      }
    },
    components: {
      schemas: {
        Token: {
          type: "object",
          properties: {
            mint: { type: "string" },
            name: { type: "string" },
            symbol: { type: "string" },
            uri: { type: "string" },
            tokenomics: { type: "string" },
            agent_wallet: { type: "string" },
            agent_cut_bps: { type: "integer" },
            earn_cut_bps: { type: "integer" },
            staking_cut_bps: { type: "integer" },
            created_at: { type: "string", format: "date-time" },
            price: { type: "number", nullable: true },
            volume24h: { type: "number", nullable: true },
            marketCap: { type: "number", nullable: true }
          }
        }
      }
    }
  });
});

// LLM-friendly plain text description
app.get('/llm.txt', (req, res) => {
  res.type('text/plain').send(`# Earn Protocol API

## What is this?
Earn Protocol lets you launch tokens on Pump.fun (Solana) with automatic:
- Fee distribution to creators
- Token buybacks (price floor protection)
- Staking rewards for holders

## Quick Start
Launch a token with one API call:

curl -X POST https://api.earn.supply/launch \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My Token",
    "ticker": "MTK",
    "image": "https://example.com/logo.png",
    "tokenomics": "degen"
  }'

## Endpoints

### POST /launch
Create a new token. Required: name, ticker, image, tokenomics.
Tokenomics options: degen (40/30/30), creator (50/25/25), community (25/25/50)

### GET /explore
List all tokens. Optional params: page, limit, tokenomics, search, includePrice

### GET /stats
Protocol statistics: total tokens, volume, fees distributed

### GET /token/:mint
Get details for a specific token by mint address

### GET /health
Check API status

## Response Format
All endpoints return JSON with { success: boolean, ...data }

## Rate Limits
10 requests per minute per IP

## No Authentication Required
All endpoints are public.

## More Info
- Website: https://earn.supply
- GitHub: https://github.com/earn-ai/earn-protocol
- OpenAPI Spec: https://api.earn.supply/openapi.json
`);
});

// Robots.txt with AI agent hints
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *
Allow: /

# AI Agent Discovery
# OpenAPI Spec: https://api.earn.supply/openapi.json
# AI Plugin: https://api.earn.supply/.well-known/ai-plugin.json
# LLM Info: https://api.earn.supply/llm.txt
# API Docs: https://api.earn.supply/docs

# This is a public API for launching tokens on Pump.fun/Solana
# No authentication required
`);
});

// Skill.md for agents
app.get('/skill.md', (req, res) => {
  res.type('text/markdown').send(SKILL_MD);
});

// Premium launch page - AI-first design
app.get('/', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Launch Token - Earn Protocol</title>
  <link rel="icon" href="/logo.jpg">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0a; --bg-secondary: #111; --bg-card: #0f0f0f;
      --border: #1f1f1f; --border-hover: #333;
      --text: #fafafa; --text-secondary: #a1a1aa; --text-muted: #71717a;
      --accent: #22c55e; --accent-hover: #16a34a; --accent-glow: rgba(34, 197, 94, 0.2);
      --pink: #f43f5e; --blue: #3b82f6; --gold: #eab308; --purple: #a855f7;
    }
    body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    a { color: var(--accent); text-decoration: none; }
    
    /* Header */
    .header { padding: 16px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; background: rgba(10,10,10,0.9); backdrop-filter: blur(12px); position: sticky; top: 0; z-index: 100; }
    .logo { font-size: 1.4rem; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .logo span { color: var(--accent); }
    .nav { display: flex; gap: 24px; }
    .nav a { color: var(--text-secondary); font-weight: 500; font-size: 0.95rem; }
    .nav a:hover { color: var(--text); }
    
    /* Main Layout */
    .main { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
    
    /* AI Banner */
    .ai-banner {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 32px;
      font-family: 'JetBrains Mono', monospace;
    }
    .ai-banner-title { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 0.9rem; color: var(--text-secondary); }
    .ai-banner-code {
      background: #0a0a0a;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      font-size: 0.9rem;
      color: var(--accent);
      overflow-x: auto;
    }
    .ai-banner-links { margin-top: 12px; font-size: 0.85rem; color: var(--text-muted); }
    .ai-banner-links a { color: var(--text-secondary); margin-right: 16px; }
    .ai-banner-links a:hover { color: var(--accent); }
    
    /* Section Title */
    .section-title { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 24px; }
    
    /* Two Column Layout */
    .launch-grid { display: grid; grid-template-columns: 1fr 340px; gap: 32px; align-items: start; }
    @media (max-width: 900px) { .launch-grid { grid-template-columns: 1fr; } }
    
    /* Form */
    .form-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px;
    }
    .form-row { display: flex; gap: 16px; margin-bottom: 20px; }
    .form-group { flex: 1; }
    .form-group.small { flex: 0 0 30%; }
    .form-group label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 8px; color: var(--text-secondary); }
    .form-group label span { color: var(--text-muted); font-weight: 400; }
    .form-input {
      width: 100%;
      padding: 12px 14px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-size: 0.95rem;
      transition: all 0.2s;
    }
    .form-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
    .form-input::placeholder { color: var(--text-muted); }
    textarea.form-input { resize: none; height: 60px; }
    
    /* Image Upload - Circular */
    .image-upload-container { display: flex; align-items: center; gap: 20px; margin-bottom: 20px; }
    .image-upload {
      width: 100px; height: 100px;
      border: 2px dashed var(--border);
      border-radius: 50%;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      cursor: pointer;
      transition: all 0.3s;
      background: var(--bg);
      position: relative;
      overflow: hidden;
    }
    .image-upload:hover { border-color: var(--accent); background: rgba(34, 197, 94, 0.05); }
    .image-upload.has-image { border-style: solid; border-color: var(--accent); }
    .image-upload-icon { font-size: 1.5rem; margin-bottom: 4px; }
    .image-upload-text { font-size: 0.7rem; color: var(--text-muted); }
    .image-upload input { display: none; }
    .image-preview { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
    .image-upload-info { flex: 1; }
    .image-upload-info p { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 4px; }
    .image-upload-info small { font-size: 0.75rem; color: var(--text-muted); }
    .image-url-link { font-size: 0.8rem; color: var(--accent); cursor: pointer; margin-top: 8px; display: inline-block; }
    .image-url-input { margin-top: 8px; display: none; }
    .image-url-input.show { display: block; }
    
    /* Tokenomics Cards */
    .tokenomics-label { font-size: 0.85rem; font-weight: 500; margin-bottom: 12px; color: var(--text-secondary); }
    .tokenomics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
    .tokenomics-card {
      background: var(--bg);
      border: 2px solid var(--border);
      border-radius: 12px;
      padding: 14px 10px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tokenomics-card:hover { border-color: var(--border-hover); }
    .tokenomics-card.selected { border-color: var(--accent); background: rgba(34, 197, 94, 0.08); box-shadow: 0 0 20px -5px var(--accent-glow); }
    .tokenomics-card-icon { font-size: 1.5rem; margin-bottom: 6px; }
    .tokenomics-card-name { font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; }
    .tokenomics-card-split { font-size: 0.7rem; color: var(--text-muted); }
    .tokenomics-card.selected .tokenomics-card-name { color: var(--accent); }
    
    /* Advanced Toggle */
    .advanced-toggle { font-size: 0.85rem; color: var(--text-muted); cursor: pointer; margin-bottom: 16px; }
    .advanced-toggle:hover { color: var(--text-secondary); }
    .advanced-content { display: none; margin-bottom: 20px; }
    .advanced-content.show { display: block; }
    
    /* Submit Button */
    .submit-btn {
      width: 100%;
      padding: 16px;
      background: linear-gradient(135deg, var(--accent), #15803d);
      color: #000;
      border: none;
      border-radius: 12px;
      font-size: 1.1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .submit-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 30px -10px var(--accent-glow); }
    .submit-btn:hover .rocket { animation: bounce 0.5s ease infinite; }
    .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
    
    /* Preview Card */
    .preview-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      position: sticky;
      top: 100px;
    }
    .preview-title { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 16px; }
    .preview-token {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    .preview-header { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
    .preview-image { width: 56px; height: 56px; border-radius: 12px; background: var(--bg-secondary); display: flex; align-items: center; justify-content: center; font-size: 1.5rem; overflow: hidden; }
    .preview-image img { width: 100%; height: 100%; object-fit: cover; }
    .preview-name { font-weight: 600; font-size: 1.1rem; }
    .preview-symbol { color: var(--text-muted); font-size: 0.9rem; }
    .preview-badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-top: 8px; }
    .preview-badge.degen { background: rgba(244,63,94,0.15); color: #fb7185; }
    .preview-badge.creator { background: rgba(34,197,94,0.15); color: #4ade80; }
    .preview-badge.community { background: rgba(59,130,246,0.15); color: #60a5fa; }
    .preview-badge.lowfee { background: rgba(234,179,8,0.15); color: #fde047; }
    .preview-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
    .preview-stat-label { font-size: 0.75rem; color: var(--text-muted); }
    .preview-stat-value { font-weight: 600; font-size: 0.9rem; color: var(--text-secondary); }
    
    /* Result */
    .result { margin-top: 20px; padding: 16px; border-radius: 12px; display: none; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; }
    .result.show { display: block; }
    .result.success { background: rgba(34, 197, 94, 0.1); border: 1px solid var(--accent); }
    .result.error { background: rgba(244, 63, 94, 0.1); border: 1px solid var(--pink); }
    .result pre { white-space: pre-wrap; word-break: break-all; }
    
    /* Footer */
    .footer { text-align: center; padding: 32px; color: var(--text-muted); font-size: 0.85rem; border-top: 1px solid var(--border); margin-top: 48px; }
    .footer a { color: var(--text-secondary); margin: 0 12px; }
  </style>
</head>
<body>
  <header class="header">
    <a href="/" class="logo"><img src="/logo.jpg" alt="Earn" style="width:32px;height:32px;border-radius:6px;"><span>Earn</span></a>
    <nav class="nav">
      <a href="/">Launch</a>
      <a href="/explore">Explore</a>
      <a href="/stats">Stats</a>
      <a href="/docs">API Docs</a>
    </nav>
  </header>

  <main class="main">
    <!-- AI Agent Banner -->
    <div class="ai-banner">
      <div class="ai-banner-title">🤖 AI Agents — Launch tokens programmatically</div>
      <div class="ai-banner-code">curl -X POST https://api.earn.supply/launch -H "Content-Type: application/json" -d '{"name":"...","ticker":"...","image":"...","tokenomics":"degen"}'</div>
      <div class="ai-banner-links">
        <a href="/docs">📖 Docs</a>
        <a href="/openapi.json">📋 OpenAPI</a>
        <a href="/.well-known/ai-plugin.json">🔌 Plugin</a>
        <a href="/llm.txt">🤖 LLM.txt</a>
      </div>
    </div>

    <div class="section-title">Or launch manually:</div>

    <div class="launch-grid">
      <!-- Form -->
      <div class="form-card">
        <form id="launchForm">
          <!-- Name + Ticker Row -->
          <div class="form-row">
            <div class="form-group">
              <label>Token Name</label>
              <input type="text" class="form-input" id="name" placeholder="My Awesome Token" required maxlength="32">
            </div>
            <div class="form-group small">
              <label>Ticker</label>
              <input type="text" class="form-input" id="ticker" placeholder="MAT" required maxlength="10" style="text-transform:uppercase">
            </div>
          </div>

          <!-- Image Upload -->
          <div class="image-upload-container">
            <div class="image-upload" id="imageUpload">
              <div class="image-upload-icon">🖼️</div>
              <div class="image-upload-text">Upload</div>
              <input type="file" id="imageFile" accept="image/*">
            </div>
            <div class="image-upload-info">
              <p>Token Image</p>
              <small>PNG, JPG or GIF. Max 5MB.</small>
              <br><span class="image-url-link" id="toggleUrl">Or paste URL</span>
              <div class="image-url-input" id="urlInputContainer">
                <input type="url" class="form-input" id="imageUrl" placeholder="https://...">
              </div>
            </div>
          </div>
          <input type="hidden" id="image">

          <!-- Description -->
          <div class="form-group" style="margin-bottom:20px">
            <label>Description <span>(optional)</span></label>
            <textarea class="form-input" id="description" placeholder="What makes your token special?"></textarea>
          </div>

          <!-- Website + Twitter Row -->
          <div class="form-row">
            <div class="form-group">
              <label>Website <span>(optional)</span></label>
              <input type="url" class="form-input" id="website" placeholder="https://mytoken.com">
            </div>
            <div class="form-group">
              <label>X / Twitter <span>(optional)</span></label>
              <input type="url" class="form-input" id="twitter" placeholder="https://x.com/mytoken">
            </div>
          </div>

          <!-- Tokenomics Cards -->
          <div class="tokenomics-label">Tokenomics Template</div>
          <div class="tokenomics-grid">
            <div class="tokenomics-card selected" data-value="degen">
              <div class="tokenomics-card-icon">🎰</div>
              <div class="tokenomics-card-name">Degen</div>
              <div class="tokenomics-card-split">40/30/30</div>
            </div>
            <div class="tokenomics-card" data-value="creator">
              <div class="tokenomics-card-icon">🎨</div>
              <div class="tokenomics-card-name">Creator</div>
              <div class="tokenomics-card-split">50/25/25</div>
            </div>
            <div class="tokenomics-card" data-value="community">
              <div class="tokenomics-card-icon">🏛️</div>
              <div class="tokenomics-card-name">Community</div>
              <div class="tokenomics-card-split">25/25/50</div>
            </div>
            <div class="tokenomics-card" data-value="lowfee">
              <div class="tokenomics-card-icon">💰</div>
              <div class="tokenomics-card-name">Low Fee</div>
              <div class="tokenomics-card-split">40/30/30</div>
            </div>
          </div>
          <input type="hidden" id="tokenomics" value="degen">

          <!-- Advanced -->
          <div class="advanced-toggle" id="advancedToggle">Advanced ▼</div>
          <div class="advanced-content" id="advancedContent">
            <div class="form-group">
              <label>Your Wallet <span>(defaults to Earn wallet)</span></label>
              <input type="text" class="form-input" id="agentWallet" placeholder="Your Solana wallet address">
            </div>
          </div>

          <button type="submit" class="submit-btn" id="submitBtn">
            <span class="rocket">🚀</span> Launch Token
          </button>
        </form>

        <div id="result" class="result">
          <pre id="resultContent"></pre>
        </div>
      </div>

      <!-- Preview Card -->
      <div class="preview-card">
        <div class="preview-title">Live Preview</div>
        <div class="preview-token">
          <div class="preview-header">
            <div class="preview-image" id="previewImage">🪙</div>
            <div>
              <div class="preview-name" id="previewName">Token Name</div>
              <div class="preview-symbol" id="previewSymbol">$TICKER</div>
              <div class="preview-badge degen" id="previewBadge">degen</div>
            </div>
          </div>
          <div class="preview-stats">
            <div><div class="preview-stat-label">Price</div><div class="preview-stat-value">—</div></div>
            <div><div class="preview-stat-label">24h Volume</div><div class="preview-stat-value">—</div></div>
            <div><div class="preview-stat-label">Market Cap</div><div class="preview-stat-value">—</div></div>
            <div><div class="preview-stat-label">Staker APY</div><div class="preview-stat-value">—</div></div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <footer class="footer">
    <a href="/docs">API Docs</a>
    <a href="/explore">Explore</a>
    <a href="https://github.com/earn-ai/earn-protocol">GitHub</a>
    <a href="https://earn.supply">Dashboard</a>
  </footer>

  <script>
    // Tokenomics selection
    const tokenomicsCards = document.querySelectorAll('.tokenomics-card');
    const tokenomicsInput = document.getElementById('tokenomics');
    const previewBadge = document.getElementById('previewBadge');
    
    tokenomicsCards.forEach(card => {
      card.addEventListener('click', () => {
        tokenomicsCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const value = card.dataset.value;
        tokenomicsInput.value = value;
        previewBadge.textContent = value;
        previewBadge.className = 'preview-badge ' + value;
      });
    });

    // Advanced toggle
    document.getElementById('advancedToggle').addEventListener('click', function() {
      const content = document.getElementById('advancedContent');
      content.classList.toggle('show');
      this.textContent = content.classList.contains('show') ? 'Advanced ▲' : 'Advanced ▼';
    });

    // Image upload
    const imageUpload = document.getElementById('imageUpload');
    const imageFile = document.getElementById('imageFile');
    const imageInput = document.getElementById('image');
    const previewImage = document.getElementById('previewImage');
    
    imageUpload.addEventListener('click', () => imageFile.click());
    imageUpload.addEventListener('dragover', e => { e.preventDefault(); imageUpload.style.borderColor = 'var(--accent)'; });
    imageUpload.addEventListener('dragleave', () => { imageUpload.style.borderColor = ''; });
    imageUpload.addEventListener('drop', e => {
      e.preventDefault();
      imageUpload.style.borderColor = '';
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    imageFile.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
    
    function handleFile(file) {
      if (file.size > 5 * 1024 * 1024) { alert('Max 5MB'); return; }
      const reader = new FileReader();
      reader.onload = e => {
        imageInput.value = e.target.result;
        imageUpload.innerHTML = '<img src="' + e.target.result + '" class="image-preview">';
        imageUpload.classList.add('has-image');
        previewImage.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover;border-radius:12px">';
      };
      reader.readAsDataURL(file);
    }

    // URL toggle
    document.getElementById('toggleUrl').addEventListener('click', function() {
      const container = document.getElementById('urlInputContainer');
      container.classList.toggle('show');
      this.textContent = container.classList.contains('show') ? 'Hide URL' : 'Or paste URL';
    });
    document.getElementById('imageUrl').addEventListener('input', e => {
      imageInput.value = e.target.value;
      if (e.target.value) {
        previewImage.innerHTML = '<img src="' + e.target.value + '" style="width:100%;height:100%;object-fit:cover;border-radius:12px" onerror="this.parentElement.innerHTML=\\'🪙\\'">';
      }
    });

    // Live preview
    document.getElementById('name').addEventListener('input', e => {
      document.getElementById('previewName').textContent = e.target.value || 'Token Name';
    });
    document.getElementById('ticker').addEventListener('input', e => {
      document.getElementById('previewSymbol').textContent = '$' + (e.target.value.toUpperCase() || 'TICKER');
    });

    // Form submit
    const form = document.getElementById('launchForm');
    const result = document.getElementById('result');
    const resultContent = document.getElementById('resultContent');
    const submitBtn = document.getElementById('submitBtn');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!imageInput.value) { alert('Please upload an image or enter URL'); return; }
      
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="rocket">🚀</span> Launching...';
      
      const data = {
        name: document.getElementById('name').value,
        ticker: document.getElementById('ticker').value.toUpperCase(),
        image: imageInput.value,
        tokenomics: tokenomicsInput.value,
        description: document.getElementById('description').value || undefined,
        website: document.getElementById('website').value || undefined,
        twitter: document.getElementById('twitter').value || undefined,
      };
      const wallet = document.getElementById('agentWallet').value;
      if (wallet) data.agentWallet = wallet;

      try {
        const res = await fetch('/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const json = await res.json();
        result.className = 'result show ' + (json.success ? 'success' : 'error');
        resultContent.textContent = JSON.stringify(json, null, 2);
      } catch (err) {
        result.className = 'result show error';
        resultContent.textContent = 'Error: ' + err.message;
      }
      
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span class="rocket">🚀</span> Launch Token';
    });
  </script>
</body>
</html>`;
  res.type('text/html').send(html);
});
// API Documentation - redirect to frontend docs
app.get('/docs', (req, res) => {
  res.redirect('https://earn.supply/docs');
});
// Explore Page
app.get('/explore', async (req, res) => {
  // Check if requesting JSON (API) or HTML (page)
  if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
    // Forward to API handler - will be handled by the explore API below
    return res.redirect('/api/explore?' + new URLSearchParams(req.query as any).toString());
  }
  
  const exploreHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Explore Tokens - Earn Protocol</title>
  <link rel="icon" href="/logo.jpg">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0a; --bg-card: #111; --border: #1f1f1f; --border-hover: #2a2a2a;
      --text: #fafafa; --text-secondary: #a1a1aa; --text-muted: #71717a;
      --accent: #22c55e; --pink: #f43f5e; --blue: #3b82f6; --gold: #eab308;
    }
    body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    a { color: var(--accent); text-decoration: none; }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    
    .header { padding: 16px 0; background: rgba(10,10,10,0.9); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100; }
    .header-inner { display: flex; align-items: center; justify-content: space-between; }
    .logo { display: flex; align-items: center; gap: 10px; font-size: 1.5rem; font-weight: 800; }
    .logo img { width: 36px; height: 36px; border-radius: 8px; }
    .logo span { color: var(--accent); }
    .nav { display: flex; gap: 24px; align-items: center; }
    .nav a { color: var(--text-secondary); font-weight: 500; }
    .nav a:hover { color: var(--text); }
    .btn { padding: 10px 20px; background: var(--accent); color: #000; border-radius: 8px; font-weight: 600; }
    
    .page-header { padding: 48px 0 32px; }
    .page-header h1 { font-size: 2rem; margin-bottom: 8px; }
    .page-header p { color: var(--text-secondary); }
    
    .filters { display: flex; gap: 12px; margin-bottom: 32px; flex-wrap: wrap; align-items: center; }
    .filter-btn { padding: 8px 16px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; color: var(--text-secondary); cursor: pointer; font-size: 0.9rem; transition: all 0.2s; }
    .filter-btn:hover, .filter-btn.active { border-color: var(--accent); color: var(--accent); }
    .filter-btn.active { background: rgba(34, 197, 94, 0.1); }
    select { padding: 8px 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.9rem; cursor: pointer; }
    
    .token-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
    .token-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; transition: all 0.2s; }
    .token-card:hover { border-color: var(--border-hover); transform: translateY(-2px); }
    .token-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .token-icon { width: 48px; height: 48px; border-radius: 10px; background: var(--bg); object-fit: cover; }
    .token-name { font-weight: 600; font-size: 1.1rem; }
    .token-symbol { color: var(--text-muted); font-size: 0.9rem; }
    .token-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-left: 8px; }
    .token-badge.degen { background: rgba(244,63,94,0.2); color: #f87171; }
    .token-badge.creator { background: rgba(34,197,94,0.2); color: #4ade80; }
    .token-badge.community { background: rgba(59,130,246,0.2); color: #60a5fa; }
    .token-badge.lowfee { background: rgba(234,179,8,0.2); color: #facc15; }
    .token-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .token-stat { }
    .token-stat-label { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 2px; }
    .token-stat-value { font-weight: 600; font-size: 0.95rem; }
    .token-stat-value.positive { color: var(--accent); }
    .token-stat-value.negative { color: var(--pink); }
    .token-actions { display: flex; gap: 8px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
    .token-actions a { flex: 1; text-align: center; padding: 8px; background: var(--bg); border-radius: 8px; font-size: 0.85rem; color: var(--text-secondary); transition: all 0.2s; }
    .token-actions a:hover { color: var(--accent); }
    
    .loading { text-align: center; padding: 60px; color: var(--text-muted); }
    .empty { text-align: center; padding: 60px; color: var(--text-muted); }
    .footer { padding: 48px 0; border-top: 1px solid var(--border); text-align: center; margin-top: 60px; }
    .footer a { color: var(--text-muted); margin: 0 16px; }
  </style>
</head>
<body>
  <header class="header">
    <div class="container header-inner">
      <a href="/" class="logo"><img src="/logo.jpg" alt="Earn" style="width:32px;height:32px;border-radius:6px;"><span>Earn</span></a>
      <nav class="nav">
        <a href="/">Launch</a>
        <a href="/explore" style="color:var(--text)">Explore</a>
        <a href="/stats">Stats</a>
        <a href="/docs">API</a>
      </nav>
    </div>
  </header>
  
  <main class="container">
    <div class="page-header">
      <h1>Explore Tokens</h1>
      <p>Discover Earn-powered tokens and start earning rewards</p>
    </div>
    
    <div class="filters">
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn" data-filter="degen">🎰 Degen</button>
      <button class="filter-btn" data-filter="creator">🎨 Creator</button>
      <button class="filter-btn" data-filter="community">🏛️ Community</button>
      <button class="filter-btn" data-filter="lowfee">💰 Low Fee</button>
      <select id="sortBy" style="margin-left:auto;">
        <option value="newest">Newest</option>
        <option value="volume">Volume</option>
        <option value="oldest">Oldest</option>
      </select>
    </div>
    
    <div id="tokenGrid" class="token-grid">
      <div class="loading">Loading tokens...</div>
    </div>
  </main>
  
  <footer class="footer">
    <a href="/">Home</a>
    <a href="/docs">API</a>
    <a href="https://github.com/earn-ai/earn-protocol">GitHub</a>
  </footer>
  
  <script>
    let currentFilter = 'all';
    let currentSort = 'newest';
    
    async function loadTokens() {
      const grid = document.getElementById('tokenGrid');
      grid.innerHTML = '<div class="loading">Loading tokens...</div>';
      
      try {
        let url = '/api/explore?includePrice=true&limit=50';
        if (currentFilter !== 'all') url += '&tokenomics=' + currentFilter;
        if (currentSort) url += '&sort=' + currentSort;
        
        const res = await fetch(url);
        const data = await res.json();
        
        if (!data.tokens?.length) {
          grid.innerHTML = '<div class="empty">No tokens found. Be the first to launch!</div>';
          return;
        }
        
        grid.innerHTML = data.tokens.map(function(t) {
          return '<div class="token-card">' +
            '<div class="token-header">' +
            '<img src="' + (t.uri || t.image || '/logo.jpg') + '" class="token-icon" onerror="this.src=\\'/logo.jpg\\'">' +
            '<div>' +
            '<div class="token-name">' + t.name + ' <span class="token-badge ' + t.tokenomics + '">' + t.tokenomics + '</span></div>' +
            '<div class="token-symbol">' + t.symbol + '</div>' +
            '</div></div>' +
            '<div class="token-stats">' +
            '<div class="token-stat"><div class="token-stat-label">Price</div><div class="token-stat-value">' + (t.price ? '$' + t.price.toFixed(6) : '-') + '</div></div>' +
            '<div class="token-stat"><div class="token-stat-label">24h Change</div><div class="token-stat-value ' + ((t.priceChange24h || 0) >= 0 ? 'positive' : 'negative') + '">' + (t.priceChange24h ? (t.priceChange24h >= 0 ? '+' : '') + t.priceChange24h.toFixed(1) + '%' : '-') + '</div></div>' +
            '<div class="token-stat"><div class="token-stat-label">24h Volume</div><div class="token-stat-value">' + (t.volume24h ? '$' + formatNum(t.volume24h) : '-') + '</div></div>' +
            '<div class="token-stat"><div class="token-stat-label">Creator Cut</div><div class="token-stat-value">' + (t.agent_cut_bps/100).toFixed(0) + '%</div></div>' +
            '</div>' +
            '<div class="token-actions">' +
            '<a href="https://pump.fun/' + t.mint + '" target="_blank">Trade ↗</a>' +
            '<a href="https://solscan.io/token/' + t.mint + '" target="_blank">Solscan ↗</a>' +
            '</div></div>';
        }).join('');
      } catch (e) {
        grid.innerHTML = '<div class="empty">Failed to load tokens</div>';
      }
    }
    
    function formatNum(n) {
      if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
      return n.toFixed(0);
    }
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        loadTokens();
      });
    });
    
    document.getElementById('sortBy').addEventListener('change', (e) => {
      currentSort = e.target.value;
      loadTokens();
    });
    
    loadTokens();
  </script>
</body>
</html>`;
  res.type('text/html').send(exploreHtml);
});

// Explore API endpoint
app.get('/api/explore', async (req, res) => {
  try {
    const { page = '1', limit = '20', tokenomics, search, sort = 'newest', includePrice = 'true' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 100);
    
    let tokens: any[];
    let total: number;
    
    if (USE_SUPABASE) {
      const result = await supabase.getAllTokens({ page: pageNum, limit: limitNum, tokenomics: tokenomics as string, search: search as string, sort: sort as 'newest' | 'oldest' });
      tokens = result.tokens;
      total = result.total;
    } else {
      let allTokens = Array.from(tokenRegistry.values());
      if (tokenomics) allTokens = allTokens.filter(t => t.tokenomics === tokenomics);
      if (search) {
        const s = (search as string).toLowerCase();
        allTokens = allTokens.filter(t => t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s));
      }
      allTokens.sort((a, b) => sort === 'oldest' ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      total = allTokens.length;
      tokens = allTokens.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    }
    
    if (includePrice === 'true' && tokens.length > 0) {
      const mints = tokens.map(t => t.mint);
      const prices = await birdeye.getMultipleTokenPrices(mints);
      tokens = tokens.map(token => ({
        ...token,
        price: prices.get(token.mint)?.price || null,
        priceChange24h: prices.get(token.mint)?.priceChange24h || null,
        volume24h: prices.get(token.mint)?.volume24h || null,
        marketCap: prices.get(token.mint)?.marketCap || null,
      }));
    }
    
    res.json({ success: true, tokens, total, page: pageNum, pages: Math.ceil(total / limitNum), dataSource: USE_SUPABASE ? 'supabase' : 'memory' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Stats Page
app.get('/stats', (req, res) => {
  // Check if requesting JSON
  if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
    const stats = calculateStats();
    return res.json({ success: true, earnWallet: earnWallet.publicKey.toString(), network: RPC_URL.includes('devnet') ? 'devnet' : 'mainnet', ...stats });
  }
  
  const statsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Protocol Stats - Earn Protocol</title>
  <link rel="icon" href="/logo.jpg">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0a; --bg-card: #111; --border: #1f1f1f;
      --text: #fafafa; --text-secondary: #a1a1aa; --text-muted: #71717a;
      --accent: #22c55e; --pink: #f43f5e; --blue: #3b82f6; --gold: #eab308;
    }
    body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    a { color: var(--accent); text-decoration: none; }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    
    .header { padding: 16px 0; background: rgba(10,10,10,0.9); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100; }
    .header-inner { display: flex; align-items: center; justify-content: space-between; }
    .logo { display: flex; align-items: center; gap: 10px; font-size: 1.5rem; font-weight: 800; }
    .logo img { width: 36px; height: 36px; border-radius: 8px; }
    .logo span { color: var(--accent); }
    .nav { display: flex; gap: 24px; }
    .nav a { color: var(--text-secondary); font-weight: 500; }
    .nav a:hover { color: var(--text); }
    
    .page-header { padding: 48px 0 32px; text-align: center; }
    .page-header h1 { font-size: 2rem; margin-bottom: 8px; }
    .page-header p { color: var(--text-secondary); }
    
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 40px; }
    .stat-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 24px; }
    .stat-card-icon { width: 40px; height: 40px; background: rgba(34,197,94,0.1); border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; font-size: 1.25rem; }
    .stat-card-value { font-size: 2rem; font-weight: 700; margin-bottom: 4px; }
    .stat-card-label { color: var(--text-muted); font-size: 0.9rem; }
    
    .charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 40px; }
    .chart-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 24px; }
    .chart-card h3 { margin-bottom: 20px; font-size: 1rem; }
    
    .top-tokens { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 24px; }
    .top-tokens h3 { margin-bottom: 20px; }
    .token-row { display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); }
    .token-row:last-child { border-bottom: none; }
    .token-rank { width: 30px; font-weight: 700; color: var(--text-muted); }
    .token-info { flex: 1; }
    .token-name { font-weight: 500; }
    .token-symbol { color: var(--text-muted); font-size: 0.85rem; }
    .token-volume { text-align: right; font-weight: 600; }
    
    .footer { padding: 48px 0; border-top: 1px solid var(--border); text-align: center; margin-top: 60px; }
    .footer a { color: var(--text-muted); margin: 0 16px; }
    
    @media (max-width: 768px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .charts-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="container header-inner">
      <a href="/" class="logo"><img src="/logo.jpg" alt="Earn" style="width:32px;height:32px;border-radius:6px;"><span>Earn</span></a>
      <nav class="nav">
        <a href="/">Launch</a>
        <a href="/explore">Explore</a>
        <a href="/stats" style="color:var(--text)">Stats</a>
        <a href="/docs">API</a>
      </nav>
    </div>
  </header>
  
  <main class="container">
    <div class="page-header">
      <h1>Protocol Stats</h1>
      <p>Real-time transparency dashboard for Earn Protocol</p>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-icon">🪙</div>
        <div class="stat-card-value" id="totalTokens">-</div>
        <div class="stat-card-label">Total Tokens</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon">📈</div>
        <div class="stat-card-value" id="totalVolume">-</div>
        <div class="stat-card-label">Total Volume</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon">💰</div>
        <div class="stat-card-value" id="totalFees">-</div>
        <div class="stat-card-label">Fees Distributed</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon">👥</div>
        <div class="stat-card-value" id="totalAgents">-</div>
        <div class="stat-card-label">Creators</div>
      </div>
    </div>
    
    <div class="top-tokens">
      <h3>Top Tokens by Volume</h3>
      <div id="topTokens">
        <div style="text-align:center;padding:40px;color:var(--text-muted)">Loading...</div>
      </div>
    </div>
  </main>
  
  <footer class="footer">
    <a href="/">Home</a>
    <a href="/docs">API</a>
    <a href="https://github.com/earn-ai/earn-protocol">GitHub</a>
  </footer>
  
  <script>
    function formatNum(n) {
      if (n >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M';
      if (n >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K';
      return '$' + n.toFixed(0);
    }
    
    async function loadStats() {
      try {
        const res = await fetch('/stats?format=json');
        const data = await res.json();
        
        document.getElementById('totalTokens').textContent = data.totalLaunches || 0;
        document.getElementById('totalVolume').textContent = data.totalVolume24h ? formatNum(data.totalVolume24h * 30) : '$0';
        document.getElementById('totalFees').textContent = data.totalFees ? formatNum(data.totalFees) : '$0';
        document.getElementById('totalAgents').textContent = data.totalAgents || 0;
      } catch (e) {
        console.error('Failed to load stats:', e);
      }
    }
    
    async function loadTopTokens() {
      try {
        const res = await fetch('/api/explore?includePrice=true&limit=5&sort=newest');
        const data = await res.json();
        
        if (!data.tokens?.length) {
          document.getElementById('topTokens').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">No tokens yet</div>';
          return;
        }
        
        document.getElementById('topTokens').innerHTML = data.tokens.map(function(t, i) {
          return '<div class="token-row">' +
            '<span class="token-rank">' + (i + 1) + '</span>' +
            '<div class="token-info">' +
            '<div class="token-name">' + t.name + '</div>' +
            '<div class="token-symbol">' + t.symbol + '</div>' +
            '</div>' +
            '<div class="token-volume">' + (t.volume24h ? formatNum(t.volume24h) : '-') + '</div>' +
            '</div>';
        }).join('');
      } catch (e) {
        document.getElementById('topTokens').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Failed to load</div>';
      }
    }
    
    loadStats();
    loadTopTokens();
  </script>
</body>
</html>`;
  res.type('text/html').send(statsHtml);
});

// Global stats API
app.get('/api/stats', (req, res) => {
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
      
      // Also save to Supabase if configured
      if (USE_SUPABASE) {
        try {
          await supabase.insertToken({
            mint: config.mint,
            name: config.name,
            symbol: config.symbol,
            uri: config.uri,
            agent_wallet: config.agentWallet,
            tokenomics: config.tokenomics,
            agent_cut_bps: config.agentCutBps,
            earn_cut_bps: config.earnCutBps,
            staking_cut_bps: config.stakingCutBps,
            created_at: config.createdAt,
            tx_signature: config.txSignature,
            description: config.description,
            website: config.website,
            twitter: config.twitter,
            launch_number: config.launchNumber,
          });
        } catch (dbError: any) {
          console.error('Failed to save to Supabase:', dbError.message);
        }
      }
      
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
    
    // Also save to Supabase if configured
    if (USE_SUPABASE) {
      try {
        await supabase.insertToken({
          mint: config.mint,
          name: config.name,
          symbol: config.symbol,
          uri: config.uri,
          agent_wallet: config.agentWallet,
          tokenomics: config.tokenomics,
          agent_cut_bps: config.agentCutBps,
          earn_cut_bps: config.earnCutBps,
          staking_cut_bps: config.stakingCutBps,
          created_at: config.createdAt,
          tx_signature: config.txSignature,
          description: config.description,
          website: config.website,
          twitter: config.twitter,
          launch_number: config.launchNumber,
        });
      } catch (dbError: any) {
        console.error('Failed to save to Supabase:', dbError.message);
      }
    }
    
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
