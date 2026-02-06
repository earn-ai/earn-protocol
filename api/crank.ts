/**
 * Fee Distribution Crank
 * 
 * Runs periodically (every 2 hours via Vercel cron) to:
 * 1. Check Earn wallet for accumulated fees
 * 2. Distribute fees per token:
 *    - 20% → Creator wallet (agent)
 *    - 30% → Buyback & burn (or LP)
 *    - 50% → Staking pool rewards
 * 
 * Run modes:
 * - Vercel cron: GET /api/cron/distribute
 * - Manual: POST /admin/distribute
 * - CLI: npx ts-node api/crank.ts
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  LAMPORTS_PER_SOL, 
  SystemProgram, 
  Transaction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
import { executeBuyback } from './buyback';

// ============ CONFIG ============

const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const IS_DEVNET = RPC_URL.includes('devnet');

// Wallet loading - supports both file path and base58 env var
const EARN_WALLET_PATH = process.env.EARN_WALLET || '/home/node/.config/solana/earn-wallet.json';
const EARN_WALLET_KEY = process.env.EARN_WALLET_KEY; // Base58 private key (for Vercel)

const DATA_DIR = process.env.DATA_DIR || './data';
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const DISTRIBUTION_LOG = path.join(DATA_DIR, 'distributions.json');

// Staking program
const STAKING_PROGRAM_ID = new PublicKey('E7JsJuQWGaEYC34AkEv8dcmkKUxR1KqUnje17mNCuTiY');
const GLOBAL_CONFIG_SEED = 'global_config';
const STAKING_POOL_SEED = 'staking_pool';

// Minimum balance to keep in wallet (for rent/fees)
const MIN_WALLET_BALANCE = 0.05; // SOL

// ============ TYPES ============

interface TokenConfig {
  mint: string;
  name: string;
  symbol: string;
  agentWallet: string;
  stakingPool?: string;
  creatorFeeBps: number;   // Default 2000 (20%)
  buybackFeeBps: number;   // Default 3000 (30%)
  stakingFeeBps: number;   // Default 5000 (50%)
}

interface DistributionRecord {
  timestamp: string;
  mint: string;
  symbol: string;
  totalFees: number;
  creatorAmount: number;
  buybackAmount: number;
  stakingAmount: number;
  creatorWallet: string;
  txSignatures: string[];
  status: 'success' | 'partial' | 'failed';
}

interface DistributionLog {
  lastRun: string | null;
  totalDistributed: number;
  distributions: DistributionRecord[];
}

// ============ HELPERS ============

function loadKeypair(): Keypair {
  // Try base58 env var first (Vercel deployment)
  if (EARN_WALLET_KEY) {
    try {
      return Keypair.fromSecretKey(bs58.decode(EARN_WALLET_KEY));
    } catch (e) {
      console.error('Failed to load wallet from EARN_WALLET_KEY');
    }
  }
  
  // Fall back to file
  try {
    const data = JSON.parse(fs.readFileSync(EARN_WALLET_PATH, 'utf-8'));
    if (Array.isArray(data)) {
      return Keypair.fromSecretKey(Uint8Array.from(data));
    } else if (data.private_key) {
      return Keypair.fromSecretKey(bs58.decode(data.private_key));
    }
  } catch (e) {
    console.error('Failed to load wallet from file');
  }
  
  throw new Error('No wallet available');
}

function loadTokens(): Map<string, TokenConfig> {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch (e) {
    console.error('Failed to load tokens:', e);
  }
  return new Map();
}

function loadDistributionLog(): DistributionLog {
  try {
    if (fs.existsSync(DISTRIBUTION_LOG)) {
      return JSON.parse(fs.readFileSync(DISTRIBUTION_LOG, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load distribution log:', e);
  }
  return { lastRun: null, totalDistributed: 0, distributions: [] };
}

function saveDistributionLog(log: DistributionLog): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DISTRIBUTION_LOG, JSON.stringify(log, null, 2));
  } catch (e) {
    console.error('Failed to save distribution log:', e);
  }
}

function getStakingPoolPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(STAKING_POOL_SEED), mint.toBuffer()],
    STAKING_PROGRAM_ID
  );
  return pda;
}

// ============ DISTRIBUTION FUNCTIONS ============

/**
 * Transfer SOL to creator wallet
 */
async function distributeToCreator(
  connection: Connection,
  payer: Keypair,
  creatorWallet: string,
  amount: number
): Promise<{ success: boolean; signature?: string; error?: string }> {
  if (IS_DEVNET) {
    console.log(`   [SIMULATED] → Creator: ${amount.toFixed(4)} SOL`);
    return { success: true, signature: 'simulated' };
  }
  
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: new PublicKey(creatorWallet),
        lamports: Math.floor(amount * LAMPORTS_PER_SOL),
      })
    );
    
    const signature = await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log(`   ✅ Creator transfer: ${signature}`);
    return { success: true, signature };
  } catch (e: any) {
    console.error(`   ❌ Creator transfer failed: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Deposit rewards to staking pool
 */
async function distributeToStakingPool(
  connection: Connection,
  payer: Keypair,
  tokenMint: string,
  amount: number
): Promise<{ success: boolean; signature?: string; error?: string }> {
  if (IS_DEVNET) {
    console.log(`   [SIMULATED] → Staking Pool: ${amount.toFixed(4)} SOL`);
    return { success: true, signature: 'simulated' };
  }
  
  try {
    const mint = new PublicKey(tokenMint);
    const stakingPool = getStakingPoolPda(mint);
    
    // For now, just transfer SOL to the pool PDA
    // The staking program will need a deposit_rewards instruction
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: stakingPool,
        lamports: Math.floor(amount * LAMPORTS_PER_SOL),
      })
    );
    
    const signature = await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log(`   ✅ Staking deposit: ${signature}`);
    return { success: true, signature };
  } catch (e: any) {
    console.error(`   ❌ Staking deposit failed: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ============ MAIN CRANK ============

export async function runDistributionCrank(): Promise<{
  success: boolean;
  tokensProcessed: number;
  totalDistributed: number;
  errors: string[];
  details: DistributionRecord[];
}> {
  console.log('\n' + '═'.repeat(60));
  console.log('🔄 EARN PROTOCOL - FEE DISTRIBUTION CRANK');
  console.log('═'.repeat(60));
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log(`   Network: ${IS_DEVNET ? 'DEVNET (simulated)' : 'MAINNET'}`);
  
  const connection = new Connection(RPC_URL, 'confirmed');
  let earnWallet: Keypair;
  
  try {
    earnWallet = loadKeypair();
  } catch (e) {
    console.error('❌ Failed to load wallet');
    return {
      success: false,
      tokensProcessed: 0,
      totalDistributed: 0,
      errors: ['Failed to load wallet'],
      details: [],
    };
  }
  
  const tokens = loadTokens();
  const log = loadDistributionLog();
  
  console.log(`\n📊 Wallet: ${earnWallet.publicKey.toString()}`);
  
  // Get wallet balance
  let walletBalance = 0;
  try {
    walletBalance = await connection.getBalance(earnWallet.publicKey) / LAMPORTS_PER_SOL;
    console.log(`   Balance: ${walletBalance.toFixed(4)} SOL`);
  } catch (e) {
    console.error('   Failed to get balance');
  }
  
  // Calculate distributable amount (keep minimum for rent/fees)
  const distributableBalance = Math.max(0, walletBalance - MIN_WALLET_BALANCE);
  console.log(`   Distributable: ${distributableBalance.toFixed(4)} SOL`);
  console.log(`   Tokens registered: ${tokens.size}`);
  
  if (distributableBalance < 0.001 || tokens.size === 0) {
    console.log('\n⚠️ Nothing to distribute');
    return {
      success: true,
      tokensProcessed: 0,
      totalDistributed: 0,
      errors: [],
      details: [],
    };
  }
  
  const errors: string[] = [];
  const details: DistributionRecord[] = [];
  let tokensProcessed = 0;
  let totalDistributed = 0;
  
  console.log('\n' + '─'.repeat(60));
  console.log('📝 DISTRIBUTION PLAN');
  console.log('─'.repeat(60));
  
  // Distribute proportionally to each token
  const perTokenShare = distributableBalance / tokens.size;
  
  for (const [mint, token] of tokens) {
    console.log(`\n🪙 ${token.symbol} (${mint.slice(0, 8)}...)`);
    console.log(`   Share: ${perTokenShare.toFixed(4)} SOL`);
    
    const creatorBps = token.creatorFeeBps || 2000;  // 20%
    const buybackBps = token.buybackFeeBps || 3000;  // 30%
    const stakingBps = token.stakingFeeBps || 5000;  // 50%
    
    const creatorAmount = perTokenShare * (creatorBps / 10000);
    const buybackAmount = perTokenShare * (buybackBps / 10000);
    const stakingAmount = perTokenShare * (stakingBps / 10000);
    
    console.log(`   → Creator (${creatorBps/100}%): ${creatorAmount.toFixed(4)} SOL`);
    console.log(`   → Buyback (${buybackBps/100}%): ${buybackAmount.toFixed(4)} SOL`);
    console.log(`   → Staking (${stakingBps/100}%): ${stakingAmount.toFixed(4)} SOL`);
    
    const txSignatures: string[] = [];
    let status: 'success' | 'partial' | 'failed' = 'success';
    
    // 1. Creator distribution
    if (creatorAmount >= 0.001) {
      const result = await distributeToCreator(
        connection, earnWallet, token.agentWallet, creatorAmount
      );
      if (result.signature) txSignatures.push(result.signature);
      if (!result.success) status = 'partial';
    }
    
    // 2. Buyback
    if (buybackAmount >= 0.001) {
      const result = await executeBuyback(
        connection, earnWallet, mint, buybackAmount, 'burn', IS_DEVNET
      );
      if (result.txSignature) txSignatures.push(result.txSignature);
      if (!result.success && status === 'success') status = 'partial';
    }
    
    // 3. Staking pool rewards
    if (stakingAmount >= 0.001) {
      const result = await distributeToStakingPool(
        connection, earnWallet, mint, stakingAmount
      );
      if (result.signature) txSignatures.push(result.signature);
      if (!result.success && status === 'success') status = 'partial';
    }
    
    // Record
    const record: DistributionRecord = {
      timestamp: new Date().toISOString(),
      mint,
      symbol: token.symbol,
      totalFees: perTokenShare,
      creatorAmount,
      buybackAmount,
      stakingAmount,
      creatorWallet: token.agentWallet,
      txSignatures,
      status,
    };
    
    details.push(record);
    log.distributions.push(record);
    
    if (status === 'failed') {
      errors.push(`${token.symbol}: Distribution failed`);
    }
    
    tokensProcessed++;
    totalDistributed += perTokenShare;
  }
  
  // Update log
  log.lastRun = new Date().toISOString();
  log.totalDistributed += totalDistributed;
  saveDistributionLog(log);
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(60));
  console.log(`   Tokens processed: ${tokensProcessed}`);
  console.log(`   Total distributed: ${totalDistributed.toFixed(4)} SOL`);
  console.log(`   Errors: ${errors.length}`);
  console.log('═'.repeat(60) + '\n');
  
  return {
    success: errors.length === 0,
    tokensProcessed,
    totalDistributed,
    errors,
    details,
  };
}

// ============ CLI ============

async function main() {
  const result = await runDistributionCrank();
  process.exit(result.success ? 0 : 1);
}

if (require.main === module) {
  main().catch(console.error);
}
