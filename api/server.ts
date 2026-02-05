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

// Premium landing page matching earn.supply design
app.get('/', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Earn Protocol | Launch Tokens, Earn Forever</title>
  <meta name="description" content="Launch tokens on Pump.fun with automatic fee sharing, buybacks, and staking rewards. One API call.">
  <link rel="icon" href="/logo.jpg">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    
    :root {
      --bg-primary: #0a0a0a;
      --bg-secondary: #111111;
      --bg-card: #0f0f0f;
      --border: #1f1f1f;
      --border-hover: #2a2a2a;
      --text-primary: #fafafa;
      --text-secondary: #a1a1aa;
      --text-muted: #71717a;
      --accent: #22c55e;
      --accent-hover: #16a34a;
      --accent-glow: rgba(34, 197, 94, 0.15);
      --pink: #f43f5e;
      --blue: #3b82f6;
      --gold: #eab308;
      --purple: #a855f7;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    
    a { color: var(--accent); text-decoration: none; transition: color 0.2s; }
    a:hover { color: var(--accent-hover); }
    
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    
    /* Header */
    .header {
      position: sticky;
      top: 0;
      z-index: 100;
      padding: 16px 0;
      background: rgba(10, 10, 10, 0.8);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
    }
    .header-inner { display: flex; align-items: center; justify-content: space-between; }
    .logo { display: flex; align-items: center; gap: 10px; font-size: 1.5rem; font-weight: 800; }
    .logo img { width: 36px; height: 36px; border-radius: 8px; }
    .logo span { color: var(--accent); }
    .nav { display: flex; align-items: center; gap: 32px; }
    .nav a { color: var(--text-secondary); font-weight: 500; font-size: 0.95rem; }
    .nav a:hover { color: var(--text-primary); }
    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 0.95rem; transition: all 0.2s; }
    .btn-primary { background: var(--accent); color: #000; }
    .btn-primary:hover { background: var(--accent-hover); transform: translateY(-1px); color: #000; }
    .btn-secondary { background: transparent; color: var(--text-primary); border: 1px solid var(--border); }
    .btn-secondary:hover { border-color: var(--accent); color: var(--accent); }
    
    /* Hero */
    .hero {
      padding: 100px 0 80px;
      text-align: center;
      background: radial-gradient(ellipse 80% 50% at 50% -20%, var(--accent-glow), transparent);
    }
    .hero h1 {
      font-size: clamp(2.5rem, 6vw, 4rem);
      font-weight: 800;
      line-height: 1.1;
      margin-bottom: 20px;
      background: linear-gradient(to right, var(--text-primary), var(--text-secondary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .hero h1 em { font-style: normal; color: var(--accent); -webkit-text-fill-color: var(--accent); }
    .hero p { font-size: 1.25rem; color: var(--text-secondary); max-width: 600px; margin: 0 auto 40px; }
    .hero-buttons { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
    .hero .btn-primary { padding: 14px 32px; font-size: 1.1rem; }
    .hero .btn-secondary { padding: 14px 32px; font-size: 1.1rem; }
    
    /* Cards */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      transition: all 0.3s;
    }
    .card:hover { border-color: var(--border-hover); transform: translateY(-2px); }
    
    /* Section */
    .section { padding: 80px 0; }
    .section-header { text-align: center; margin-bottom: 48px; }
    .section-header h2 { font-size: 2rem; font-weight: 700; margin-bottom: 12px; }
    .section-header p { color: var(--text-secondary); font-size: 1.1rem; }
    
    /* How It Works */
    .steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
    .step { text-align: center; }
    .step-num {
      width: 48px; height: 48px;
      background: var(--accent);
      color: #000;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1.25rem;
      margin-bottom: 16px;
    }
    .step h3 { font-size: 1.1rem; margin-bottom: 8px; }
    .step p { color: var(--text-muted); font-size: 0.9rem; }
    
    /* Templates */
    .templates { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
    .template-card {
      background: linear-gradient(145deg, var(--bg-card), #0a0a0a);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      transition: all 0.3s;
      cursor: pointer;
      position: relative;
    }
    .template-card::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 16px;
      padding: 1px;
      background: linear-gradient(145deg, transparent, transparent);
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      transition: all 0.3s;
    }
    .template-card:hover { 
      border-color: var(--accent); 
      transform: translateY(-4px);
      box-shadow: 0 20px 40px -12px rgba(34, 197, 94, 0.25);
    }
    .template-card:hover::before {
      background: linear-gradient(145deg, var(--accent), transparent);
    }
    .template-card h3 { font-size: 1.25rem; margin-bottom: 8px; }
    .template-card .desc { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 16px; }
    .template-card .fee { font-size: 2rem; font-weight: 700; color: var(--accent); margin-bottom: 16px; }
    .template-card .fee span { font-size: 1rem; color: var(--text-muted); font-weight: 400; }
    .template-splits { display: flex; flex-direction: column; gap: 8px; }
    .template-split { display: flex; justify-content: space-between; font-size: 0.85rem; }
    .template-split-label { color: var(--text-muted); }
    .template-split-value { font-weight: 600; }
    .template-badge { display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; margin-top: 16px; }
    .template-badge.degen { background: var(--pink); color: #fff; }
    .template-badge.creator { background: var(--accent); color: #000; }
    .template-badge.community { background: var(--blue); color: #fff; }
    .template-badge.lowfee { background: var(--gold); color: #000; }
    
    /* Features */
    .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
    .feature-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px;
      transition: all 0.3s;
    }
    .feature-card:hover { border-color: var(--border-hover); }
    .feature-icon {
      width: 48px; height: 48px;
      background: var(--accent-glow);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      font-size: 1.5rem;
    }
    .feature-card h3 { font-size: 1.1rem; margin-bottom: 8px; }
    .feature-card p { color: var(--text-muted); font-size: 0.9rem; line-height: 1.5; }
    
    /* Launch Form */
    .launch-section { background: var(--bg-secondary); border-top: 1px solid var(--border); }
    .launch-inner { max-width: 500px; margin: 0 auto; }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; margin-bottom: 8px; font-weight: 500; font-size: 0.95rem; }
    .form-group label span { color: var(--text-muted); font-weight: 400; }
    .form-input {
      width: 100%;
      padding: 14px 16px;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text-primary);
      font-size: 1rem;
      transition: all 0.2s;
    }
    .form-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
    .form-input::placeholder { color: var(--text-muted); }
    select.form-input { cursor: pointer; }
    textarea.form-input { resize: vertical; min-height: 80px; }
    .form-submit {
      width: 100%;
      padding: 16px;
      background: var(--accent);
      color: #000;
      border: none;
      border-radius: 12px;
      font-size: 1.1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .form-submit:hover { background: var(--accent-hover); }
    .form-submit:disabled { background: var(--border); color: var(--text-muted); cursor: not-allowed; }
    .form-result {
      margin-top: 20px;
      padding: 16px;
      border-radius: 12px;
      display: none;
    }
    .form-result.show { display: block; }
    .form-result.success { background: rgba(34, 197, 94, 0.1); border: 1px solid var(--accent); }
    .form-result.error { background: rgba(244, 63, 94, 0.1); border: 1px solid var(--pink); }
    .form-result pre { font-size: 0.85rem; white-space: pre-wrap; word-break: break-all; }
    
    /* Agent Discovery - Subtle footer style */
    .agent-section {
      border-top: 1px solid var(--border);
      padding: 32px 0;
      text-align: center;
      background: var(--bg-secondary);
    }
    .agent-section p { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 16px; }
    .agent-section p span { color: var(--accent); }
    .agent-links { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
    .agent-link {
      padding: 8px 14px;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 0.85rem;
      color: var(--text-muted);
      font-family: monospace;
      transition: all 0.2s;
    }
    .agent-link:hover { border-color: var(--accent); color: var(--accent); }
    
    /* Stats Bar */
    .stats-bar {
      padding: 24px 0;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
    }
    .stats-grid { display: flex; justify-content: center; gap: 48px; flex-wrap: wrap; }
    .stat-item { text-align: center; }
    .stat-value { font-size: 2rem; font-weight: 700; color: var(--text-primary); }
    .stat-label { font-size: 0.85rem; color: var(--text-muted); margin-top: 4px; }
    
    /* Footer */
    .footer {
      padding: 48px 0;
      border-top: 1px solid var(--border);
      text-align: center;
    }
    .footer-links { display: flex; gap: 32px; justify-content: center; margin-bottom: 24px; }
    .footer-links a { color: var(--text-secondary); font-size: 0.95rem; }
    .footer-links a:hover { color: var(--text-primary); }
    .footer-tagline { color: var(--text-muted); font-size: 0.9rem; }
    .footer-tagline span { color: var(--accent); }
    
    /* Responsive */
    @media (max-width: 1024px) {
      .steps { grid-template-columns: repeat(2, 1fr); }
      .templates { grid-template-columns: repeat(2, 1fr); }
      .features { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 768px) {
      .nav { display: none; }
      .hero { padding: 60px 0 40px; }
      .hero h1 { font-size: 2rem; }
      .steps { grid-template-columns: 1fr 1fr; gap: 16px; }
      .templates { grid-template-columns: 1fr; }
      .features { grid-template-columns: 1fr; }
      .section { padding: 60px 0; }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header class="header">
    <div class="container header-inner">
      <a href="/" class="logo">
        <img src="/logo.jpg" alt="Earn">
        <span>Earn</span>Protocol
      </a>
      <nav class="nav">
        <a href="#launch">Launch</a>
        <a href="/explore">Explore</a>
        <a href="/docs">API Docs</a>
        <a href="https://github.com/earn-ai/earn-protocol" target="_blank">GitHub</a>
        <a href="#launch" class="btn btn-primary">Launch Token</a>
      </nav>
    </div>
  </header>

  <!-- Stats Bar -->
  <section class="stats-bar" id="statsBar">
    <div class="container">
      <div class="stats-grid" id="statsGrid">
        <div class="stat-item"><div class="stat-value" id="statTokens">-</div><div class="stat-label">Tokens</div></div>
        <div class="stat-item"><div class="stat-value" id="statVolume">-</div><div class="stat-label">24h Volume</div></div>
        <div class="stat-item"><div class="stat-value" id="statFees">-</div><div class="stat-label">Fees Distributed</div></div>
      </div>
    </div>
  </section>

  <!-- Launch Form -->
  <section id="launch" class="section launch-section">
    <div class="container">
      <div class="section-header">
        <h2>Launch Your Token</h2>
        <p>Fill in the details and we'll create your token on Pump.fun</p>
      </div>
      <div class="launch-inner">
        <form id="launchForm">
          <div class="form-group">
            <label>Token Name</label>
            <input type="text" class="form-input" id="name" placeholder="My Awesome Token" required minlength="2" maxlength="32">
          </div>
          <div class="form-group">
            <label>Ticker</label>
            <input type="text" class="form-input" id="ticker" placeholder="MAT" required pattern="[A-Za-z0-9]{2,10}" style="text-transform:uppercase;">
          </div>
          <div class="form-group">
            <label>Image URL</label>
            <input type="url" class="form-input" id="image" placeholder="https://example.com/logo.png" required>
          </div>
          <div class="form-group">
            <label>Description <span>(optional)</span></label>
            <textarea class="form-input" id="description" placeholder="What makes your token special?"></textarea>
          </div>
          <div class="form-group">
            <label>Tokenomics Template</label>
            <select class="form-input" id="tokenomics" required>
              <option value="degen">🎰 Degen — 40% Creator / 30% Earn / 30% Stakers</option>
              <option value="creator">🎨 Creator — 50% Creator / 25% Earn / 25% Stakers</option>
              <option value="community">🏛️ Community — 25% Creator / 25% Earn / 50% Stakers</option>
              <option value="lowfee">💰 Low Fee — 40% Creator / 30% Earn / 30% Stakers</option>
            </select>
          </div>
          <div class="form-group">
            <label>Your Wallet <span>(optional — defaults to Earn wallet)</span></label>
            <input type="text" class="form-input" id="agentWallet" placeholder="Your Solana wallet address">
          </div>
          <button type="submit" class="form-submit" id="submitBtn">🚀 Launch Token</button>
        </form>
        <div id="result" class="form-result">
          <pre id="resultContent"></pre>
        </div>
        
              </div>
    </div>
  </section>

  <!-- How It Works -->
  <section class="section">
    <div class="container">
      <div class="section-header">
        <h2>How It Works</h2>
        <p>Four steps to sustainable tokenomics. No smart contract deployment needed.</p>
      </div>
      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <h3>Configure</h3>
          <p>Choose your tokenomics template and fee structure</p>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <h3>Launch</h3>
          <p>One API call creates your token on Pump.fun</p>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <h3>Trade</h3>
          <p>Users trade on Pump.fun, fees flow to Earn</p>
        </div>
        <div class="step">
          <div class="step-num">4</div>
          <h3>Earn</h3>
          <p>Fees split to you, stakers, and buybacks automatically</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Templates -->
  <section class="section" style="background: var(--bg-secondary);">
    <div class="container">
      <div class="section-header">
        <h2>Choose Your Template</h2>
        <p>Pre-configured fee structures for every project type</p>
      </div>
      <div class="templates">
        <div class="template-card">
          <h3>🎰 Degen</h3>
          <p class="desc">Maximum extraction, maximum rewards</p>
          <div class="fee">2%<span> fee</span></div>
          <div class="template-splits">
            <div class="template-split"><span class="template-split-label">Creator</span><span class="template-split-value">40%</span></div>
            <div class="template-split"><span class="template-split-label">Earn</span><span class="template-split-value">30%</span></div>
            <div class="template-split"><span class="template-split-label">Stakers</span><span class="template-split-value">30%</span></div>
          </div>
          <span class="template-badge degen">Degen</span>
        </div>
        <div class="template-card">
          <h3>🎨 Creator</h3>
          <p class="desc">Balanced for builders</p>
          <div class="fee">1.5%<span> fee</span></div>
          <div class="template-splits">
            <div class="template-split"><span class="template-split-label">Creator</span><span class="template-split-value">50%</span></div>
            <div class="template-split"><span class="template-split-label">Earn</span><span class="template-split-value">25%</span></div>
            <div class="template-split"><span class="template-split-label">Stakers</span><span class="template-split-value">25%</span></div>
          </div>
          <span class="template-badge creator">Creator</span>
        </div>
        <div class="template-card">
          <h3>🏛️ Community</h3>
          <p class="desc">Fair launch energy</p>
          <div class="fee">1%<span> fee</span></div>
          <div class="template-splits">
            <div class="template-split"><span class="template-split-label">Creator</span><span class="template-split-value">25%</span></div>
            <div class="template-split"><span class="template-split-label">Earn</span><span class="template-split-value">25%</span></div>
            <div class="template-split"><span class="template-split-label">Stakers</span><span class="template-split-value">50%</span></div>
          </div>
          <span class="template-badge community">Community</span>
        </div>
        <div class="template-card">
          <h3>💰 Low Fee</h3>
          <p class="desc">For the fee-sensitive</p>
          <div class="fee">0.5%<span> fee</span></div>
          <div class="template-splits">
            <div class="template-split"><span class="template-split-label">Creator</span><span class="template-split-value">40%</span></div>
            <div class="template-split"><span class="template-split-label">Earn</span><span class="template-split-value">30%</span></div>
            <div class="template-split"><span class="template-split-label">Stakers</span><span class="template-split-value">30%</span></div>
          </div>
          <span class="template-badge lowfee">Low Fee</span>
        </div>
      </div>
    </div>
  </section>

  <!-- Features -->
  <section class="section">
    <div class="container">
      <div class="section-header">
        <h2>Everything Your Token Needs</h2>
        <p>Stop building tokenomics from scratch. We handle the infrastructure.</p>
      </div>
      <div class="features">
        <div class="feature-card">
          <div class="feature-icon">⚡</div>
          <h3>One API Call</h3>
          <p>Register your token in seconds. No smart contracts to deploy.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🔄</div>
          <h3>Automatic Buybacks</h3>
          <p>Price floor protection built-in. Tokens get bought back every trade.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">💎</div>
          <h3>Staking Rewards</h3>
          <p>Holders earn yield just by staking. Powered by trading fees.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">💰</div>
          <h3>Creator Revenue</h3>
          <p>Get paid on every trade. Real, sustainable income from your token.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🔌</div>
          <h3>Full API Access</h3>
          <p>Build custom integrations. Webhooks, stats, everything exposed.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🌐</div>
          <h3>Works Everywhere</h3>
          <p>Pump.fun, Raydium, Jupiter — we integrate with all Solana DEXs.</p>
        </div>
      </div>
    </div>
  </section>


  <!-- Agent Discovery -->
  <section class="agent-section">
    <div class="container">
      <p>🤖 <span>AI Agents</span>: Integrate via <a href="/openapi.json">openapi.json</a> • <a href="/llm.txt">llm.txt</a> • <a href="/.well-known/ai-plugin.json">ai-plugin.json</a></p>
    </div>
  </section>

  <!-- Footer -->
  <footer class="footer">
    <div class="container">
      <div class="footer-links">
        <a href="/docs">API Docs</a>
        <a href="/explore">Explore</a>
        <a href="/stats">Stats</a>
        <a href="https://github.com/earn-ai/earn-protocol" target="_blank">GitHub</a>
        <a href="https://earn.supply" target="_blank">Dashboard</a>
      </div>
      <p class="footer-tagline">Built for <span>Solana</span> • Powered by Pump.fun</p>
    </div>
  </footer>

  <script>
    // Load stats
    async function loadStats() {
      try {
        const res = await fetch('/stats');
        const data = await res.json();
        const statsBar = document.getElementById('statsBar');
        
        if (data.success && (data.totalLaunches > 0 || data.totalVolume24h > 0)) {
          document.getElementById('statTokens').textContent = data.totalLaunches || 0;
          document.getElementById('statVolume').textContent = data.totalVolume24h ? '$' + formatNum(data.totalVolume24h) : '$0';
          document.getElementById('statFees').textContent = data.totalFees ? '$' + formatNum(data.totalFees) : '$0';
          statsBar.style.display = 'block';
        } else {
          statsBar.style.display = 'none';
        }
      } catch (e) {
        document.getElementById('statsBar').style.display = 'none';
      }
    }
    
    function formatNum(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return n.toFixed(0);
    }
    
    loadStats();
    
    const form = document.getElementById('launchForm');
    const result = document.getElementById('result');
    const resultContent = document.getElementById('resultContent');
    const submitBtn = document.getElementById('submitBtn');
    
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Launching...';
      
      const data = {
        name: document.getElementById('name').value,
        ticker: document.getElementById('ticker').value.toUpperCase(),
        image: document.getElementById('image').value,
        tokenomics: document.getElementById('tokenomics').value,
        description: document.getElementById('description').value || undefined,
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
        
        result.className = 'form-result show ' + (json.success ? 'success' : 'error');
        resultContent.textContent = JSON.stringify(json, null, 2);
      } catch (err) {
        result.className = 'form-result show error';
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
// API Documentation page
app.get('/docs', (req, res) => {
  const docsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Docs - Earn Protocol</title>
  <link rel="icon" href="/logo.jpg">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e4e4e7; min-height: 100vh; line-height: 1.6; }
    a { color: #00FF88; }
    code { background: #1a1a1a; padding: 0.2em 0.4em; border-radius: 4px; font-size: 0.9em; font-family: 'JetBrains Mono', monospace; }
    pre { background: #111; border: 1px solid #27272a; border-radius: 8px; padding: 1rem; overflow-x: auto; margin: 1rem 0; }
    pre code { background: none; padding: 0; }
    .container { max-width: 900px; margin: 0 auto; padding: 2rem; }
    .header { display: flex; align-items: center; gap: 1rem; margin-bottom: 3rem; padding-bottom: 2rem; border-bottom: 1px solid #27272a; }
    .header img { width: 48px; height: 48px; border-radius: 10px; }
    .header h1 { font-size: 1.75rem; color: #fff; }
    .header h1 span { color: #00FF88; }
    .nav-links { margin-left: auto; display: flex; gap: 1.5rem; }
    .nav-links a { color: #a1a1aa; text-decoration: none; }
    .nav-links a:hover { color: #fff; }
    .section { margin-bottom: 3rem; }
    h2 { color: #fff; font-size: 1.5rem; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid #27272a; }
    h3 { color: #00FF88; font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
    .endpoint { background: #111; border: 1px solid #27272a; border-radius: 12px; padding: 1.5rem; margin: 1rem 0; }
    .endpoint-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
    .method { padding: 0.25rem 0.75rem; border-radius: 4px; font-weight: 600; font-size: 0.8rem; }
    .method.get { background: #22c55e20; color: #22c55e; }
    .method.post { background: #3b82f620; color: #60a5fa; }
    .endpoint-path { font-family: 'JetBrains Mono', monospace; color: #fff; }
    .endpoint-desc { color: #a1a1aa; margin-bottom: 1rem; }
    .params { margin-top: 1rem; }
    .param { display: grid; grid-template-columns: 120px 80px 1fr; gap: 1rem; padding: 0.5rem 0; border-bottom: 1px solid #1a1a1a; }
    .param:last-child { border-bottom: none; }
    .param-name { font-family: monospace; color: #00FF88; }
    .param-type { color: #a1a1aa; font-size: 0.85rem; }
    .param-desc { color: #71717a; font-size: 0.9rem; }
    .badge { display: inline-block; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-left: 0.5rem; }
    .badge.required { background: #00FF8820; color: #f87171; }
    .badge.optional { background: #3b82f620; color: #60a5fa; }
    .example { margin-top: 1rem; }
    .example-label { color: #a1a1aa; font-size: 0.85rem; margin-bottom: 0.5rem; }
    .quick-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 2rem 0; }
    .quick-link { background: #111; border: 1px solid #27272a; border-radius: 8px; padding: 1rem; text-decoration: none; transition: border-color 0.2s; }
    .quick-link:hover { border-color: #00FF88; }
    .quick-link-title { color: #fff; font-weight: 600; margin-bottom: 0.25rem; }
    .quick-link-desc { color: #71717a; font-size: 0.85rem; }
    .footer { text-align: center; padding: 2rem; border-top: 1px solid #27272a; color: #52525b; font-size: 0.85rem; margin-top: 3rem; }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <img src="/logo.jpg" alt="Earn">
      <h1><span>Earn</span> Protocol API</h1>
      <nav class="nav-links">
        <a href="/">Home</a>
        <a href="/openapi.json">OpenAPI</a>
        <a href="/llm.txt">LLM.txt</a>
        <a href="https://github.com/earn-ai/earn-protocol">GitHub</a>
      </nav>
    </header>

    <section class="section">
      <h2>🤖 AI Agent Quick Start</h2>
      <p>Integrate Earn Protocol into your AI agent in seconds:</p>
      <div class="quick-links">
        <a href="/.well-known/ai-plugin.json" class="quick-link">
          <div class="quick-link-title">ai-plugin.json</div>
          <div class="quick-link-desc">OpenAI plugin manifest</div>
        </a>
        <a href="/openapi.json" class="quick-link">
          <div class="quick-link-title">openapi.json</div>
          <div class="quick-link-desc">Full API specification</div>
        </a>
        <a href="/llm.txt" class="quick-link">
          <div class="quick-link-title">llm.txt</div>
          <div class="quick-link-desc">Plain text for LLMs</div>
        </a>
        <a href="/skill.md" class="quick-link">
          <div class="quick-link-title">skill.md</div>
          <div class="quick-link-desc">Agent skill file</div>
        </a>
      </div>
    </section>

    <section class="section">
      <h2>📡 Base URL</h2>
      <pre><code>https://api.earn.supply</code></pre>
      <p style="margin-top:1rem;color:#71717a;">All endpoints return JSON. No authentication required.</p>
    </section>

    <section class="section">
      <h2>🚀 Launch Token</h2>
      <div class="endpoint">
        <div class="endpoint-header">
          <span class="method post">POST</span>
          <span class="endpoint-path">/launch</span>
        </div>
        <p class="endpoint-desc">Create a new token on Pump.fun with automatic fee distribution.</p>
        
        <h3>Parameters</h3>
        <div class="params">
          <div class="param">
            <span class="param-name">name</span>
            <span class="param-type">string</span>
            <span class="param-desc">Token name (2-32 chars) <span class="badge required">required</span></span>
          </div>
          <div class="param">
            <span class="param-name">ticker</span>
            <span class="param-type">string</span>
            <span class="param-desc">Symbol (2-10 chars) <span class="badge required">required</span></span>
          </div>
          <div class="param">
            <span class="param-name">image</span>
            <span class="param-type">string</span>
            <span class="param-desc">URL or base64 <span class="badge required">required</span></span>
          </div>
          <div class="param">
            <span class="param-name">tokenomics</span>
            <span class="param-type">string</span>
            <span class="param-desc">degen | creator | community | lowfee <span class="badge required">required</span></span>
          </div>
          <div class="param">
            <span class="param-name">agentWallet</span>
            <span class="param-type">string</span>
            <span class="param-desc">Creator wallet address <span class="badge optional">optional</span></span>
          </div>
        </div>
        
        <div class="example">
          <div class="example-label">Example Request</div>
          <pre><code>curl -X POST https://api.earn.supply/launch \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My Token",
    "ticker": "MTK",
    "image": "https://example.com/logo.png",
    "tokenomics": "degen"
  }'</code></pre>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>🔍 Explore Tokens</h2>
      <div class="endpoint">
        <div class="endpoint-header">
          <span class="method get">GET</span>
          <span class="endpoint-path">/explore</span>
        </div>
        <p class="endpoint-desc">List all tokens with filtering and price data.</p>
        
        <h3>Query Parameters</h3>
        <div class="params">
          <div class="param">
            <span class="param-name">page</span>
            <span class="param-type">number</span>
            <span class="param-desc">Page number (default: 1)</span>
          </div>
          <div class="param">
            <span class="param-name">limit</span>
            <span class="param-type">number</span>
            <span class="param-desc">Results per page (max: 100)</span>
          </div>
          <div class="param">
            <span class="param-name">tokenomics</span>
            <span class="param-type">string</span>
            <span class="param-desc">Filter by template</span>
          </div>
          <div class="param">
            <span class="param-name">includePrice</span>
            <span class="param-type">boolean</span>
            <span class="param-desc">Include price data (default: true)</span>
          </div>
        </div>
        
        <div class="example">
          <div class="example-label">Example</div>
          <pre><code>curl "https://api.earn.supply/explore?limit=10&includePrice=true"</code></pre>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>📊 Protocol Stats</h2>
      <div class="endpoint">
        <div class="endpoint-header">
          <span class="method get">GET</span>
          <span class="endpoint-path">/stats</span>
        </div>
        <p class="endpoint-desc">Get protocol-wide statistics.</p>
        <div class="example">
          <pre><code>curl https://api.earn.supply/stats</code></pre>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>🪙 Token Details</h2>
      <div class="endpoint">
        <div class="endpoint-header">
          <span class="method get">GET</span>
          <span class="endpoint-path">/token/:mint</span>
        </div>
        <p class="endpoint-desc">Get details for a specific token.</p>
        <div class="example">
          <pre><code>curl https://api.earn.supply/token/BjY6brpbzurwVkeMWkpaioZU1F4pzSGMwDcs7MxFhidY</code></pre>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>💎 Staking Endpoints</h2>
      <div class="endpoint">
        <div class="endpoint-header">
          <span class="method get">GET</span>
          <span class="endpoint-path">/stake/pools</span>
        </div>
        <p class="endpoint-desc">List all staking pools.</p>
      </div>
      <div class="endpoint">
        <div class="endpoint-header">
          <span class="method get">GET</span>
          <span class="endpoint-path">/stake/pool/:mint</span>
        </div>
        <p class="endpoint-desc">Get staking pool details for a token.</p>
      </div>
      <div class="endpoint">
        <div class="endpoint-header">
          <span class="method get">GET</span>
          <span class="endpoint-path">/stake/user/:wallet</span>
        </div>
        <p class="endpoint-desc">Get staking positions for a wallet.</p>
      </div>
    </section>

    <section class="section">
      <h2>⚡ Rate Limits</h2>
      <p>10 requests per minute per IP address. Exceeding this returns <code>429 Too Many Requests</code>.</p>
    </section>

    <section class="section">
      <h2>📋 Tokenomics Templates</h2>
      <table style="width:100%;border-collapse:collapse;margin-top:1rem;">
        <tr style="border-bottom:1px solid #27272a;">
          <th style="text-align:left;padding:0.75rem;color:#a1a1aa;">Template</th>
          <th style="text-align:center;padding:0.75rem;color:#22c55e;">Creator</th>
          <th style="text-align:center;padding:0.75rem;color:#00FF88;">Earn</th>
          <th style="text-align:center;padding:0.75rem;color:#60a5fa;">Stakers</th>
        </tr>
        <tr style="border-bottom:1px solid #1a1a1a;"><td style="padding:0.75rem;">🎰 degen</td><td style="text-align:center;">40%</td><td style="text-align:center;">30%</td><td style="text-align:center;">30%</td></tr>
        <tr style="border-bottom:1px solid #1a1a1a;"><td style="padding:0.75rem;">🎨 creator</td><td style="text-align:center;">50%</td><td style="text-align:center;">25%</td><td style="text-align:center;">25%</td></tr>
        <tr style="border-bottom:1px solid #1a1a1a;"><td style="padding:0.75rem;">🏛️ community</td><td style="text-align:center;">25%</td><td style="text-align:center;">25%</td><td style="text-align:center;">50%</td></tr>
        <tr><td style="padding:0.75rem;">💰 lowfee</td><td style="text-align:center;">40%</td><td style="text-align:center;">30%</td><td style="text-align:center;">30%</td></tr>
      </table>
    </section>

    <footer class="footer">
      <p>Earn Protocol API v1.0 • <a href="https://earn.supply">earn.supply</a> • <a href="https://github.com/earn-ai/earn-protocol">GitHub</a></p>
    </footer>
  </div>
</body>
</html>`;
  res.type('text/html').send(docsHtml);
});

// Explore Page
app.get('/explore', async (req, res) => {
  // Check if requesting JSON (API) or HTML (page)
  if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
    // Forward to API handler - will be handled by the explore API below
    return res.redirect('/api/explore?' + new URLSearchParams(req.query as any).toString());
  }
  
  const exploreHtml = \`<!DOCTYPE html>
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
      <a href="/" class="logo"><img src="/logo.jpg" alt="Earn"><span>Earn</span>Protocol</a>
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
</html>\`;
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
  
  const statsHtml = \`<!DOCTYPE html>
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
      <a href="/" class="logo"><img src="/logo.jpg" alt="Earn"><span>Earn</span>Protocol</a>
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
</html>\`;
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

// ============ EXPLORE ENDPOINT (with prices) ============

app.get('/explore', async (req, res) => {
  try {
    const {
      page = '1',
      limit = '20',
      tokenomics,
      search,
      sort = 'newest',
      includePrice = 'true',
    } = req.query;
    
    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 100);
    
    let tokens: any[];
    let total: number;
    
    // Use Supabase if configured, otherwise fallback to in-memory
    if (USE_SUPABASE) {
      const result = await supabase.getAllTokens({
        page: pageNum,
        limit: limitNum,
        tokenomics: tokenomics as string,
        search: search as string,
        sort: sort as 'newest' | 'oldest',
      });
      tokens = result.tokens;
      total = result.total;
    } else {
      // Fallback to in-memory
      let allTokens = Array.from(tokenRegistry.values());
      
      if (tokenomics) {
        allTokens = allTokens.filter(t => t.tokenomics === tokenomics);
      }
      if (search) {
        const s = (search as string).toLowerCase();
        allTokens = allTokens.filter(t => 
          t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s)
        );
      }
      
      allTokens.sort((a, b) => sort === 'oldest' 
        ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      total = allTokens.length;
      tokens = allTokens.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    }
    
    // Enrich with prices if requested
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
      
      // Sort by volume if requested
      if (sort === 'volume') {
        tokens.sort((a: any, b: any) => (b.volume24h || 0) - (a.volume24h || 0));
      }
    }
    
    res.json({
      success: true,
      tokens,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      dataSource: USE_SUPABASE ? 'supabase' : 'memory',
      pricesEnabled: birdeye.isPriceApiAvailable(),
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
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
