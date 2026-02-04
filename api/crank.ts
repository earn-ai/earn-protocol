/**
 * Fee Distribution Crank
 * 
 * Periodically:
 * 1. Claim accumulated fees from Pump.fun creator_vault
 * 2. Distribute to agents, Earn treasury, and staking pools
 * 
 * Can be run as:
 * - Standalone script: npx ts-node api/crank.ts
 * - Called from API: POST /admin/distribute
 * - Scheduled job (cron)
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PumpSdk, creatorVaultPda } from '@pump-fun/pump-sdk';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

// ============ CONFIG ============

const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const EARN_WALLET_PATH = process.env.EARN_WALLET || '/home/node/.config/solana/earn-wallet.json';
const DATA_DIR = process.env.DATA_DIR || './data';
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const DISTRIBUTION_LOG = path.join(DATA_DIR, 'distributions.json');

// Earn treasury wallet (separate from creator wallet for accounting)
const EARN_TREASURY = process.env.EARN_TREASURY || 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ';

// ============ TYPES ============

interface TokenConfig {
  mint: string;
  name: string;
  symbol: string;
  agentWallet: string;
  tokenomics: string;
  agentCutBps: number;
  earnCutBps: number;
  stakingCutBps: number;
}

interface DistributionRecord {
  timestamp: string;
  mint: string;
  symbol: string;
  totalFees: number;
  agentAmount: number;
  earnAmount: number;
  stakingAmount: number;
  agentWallet: string;
  txSignatures: string[];
}

interface DistributionLog {
  lastRun: string | null;
  totalDistributed: number;
  distributions: DistributionRecord[];
}

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
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DISTRIBUTION_LOG, JSON.stringify(log, null, 2));
}

// ============ CRANK LOGIC ============

export async function runDistributionCrank(): Promise<{
  success: boolean;
  tokensProcessed: number;
  totalDistributed: number;
  errors: string[];
}> {
  console.log('\n🔄 Starting fee distribution crank...\n');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const earnWallet = loadKeypair(EARN_WALLET_PATH);
  const pumpSdk = new PumpSdk();
  const tokens = loadTokens();
  const log = loadDistributionLog();
  
  console.log(`📊 Processing ${tokens.size} tokens`);
  console.log(`💼 Earn Wallet: ${earnWallet.publicKey.toString()}`);
  
  // Get Earn's creator vault balance
  const [creatorVault] = creatorVaultPda(earnWallet.publicKey);
  console.log(`🏦 Creator Vault: ${creatorVault.toString()}`);
  
  let vaultBalance = 0;
  try {
    const vaultInfo = await connection.getAccountInfo(creatorVault);
    vaultBalance = vaultInfo ? vaultInfo.lamports / LAMPORTS_PER_SOL : 0;
    console.log(`   Balance: ${vaultBalance.toFixed(4)} SOL`);
  } catch (e) {
    console.log(`   Vault not found or empty`);
  }
  
  if (vaultBalance < 0.001) {
    console.log('\n⚠️ No fees to distribute (vault empty or below minimum)');
    return {
      success: true,
      tokensProcessed: 0,
      totalDistributed: 0,
      errors: [],
    };
  }
  
  const errors: string[] = [];
  let tokensProcessed = 0;
  let totalDistributed = 0;
  
  // TODO: In production, implement actual on-chain fee claiming
  // For now, we simulate the distribution logic
  
  console.log('\n📝 Distribution plan (simulated):');
  console.log('─'.repeat(60));
  
  for (const [mint, token] of tokens) {
    try {
      // Calculate this token's share of fees
      // In production: track fees per token on-chain
      // For now: distribute proportionally
      const tokenShare = vaultBalance / tokens.size;
      
      if (tokenShare < 0.0001) {
        continue; // Skip tiny amounts
      }
      
      const agentAmount = tokenShare * (token.agentCutBps / 10000);
      const earnAmount = tokenShare * (token.earnCutBps / 10000);
      const stakingAmount = tokenShare * (token.stakingCutBps / 10000);
      
      console.log(`\n${token.symbol} (${mint.slice(0, 8)}...):`);
      console.log(`   Total: ${tokenShare.toFixed(4)} SOL`);
      console.log(`   → Agent (${token.agentCutBps/100}%): ${agentAmount.toFixed(4)} SOL → ${token.agentWallet.slice(0, 8)}...`);
      console.log(`   → Earn (${token.earnCutBps/100}%): ${earnAmount.toFixed(4)} SOL → Treasury`);
      console.log(`   → Staking (${token.stakingCutBps/100}%): ${stakingAmount.toFixed(4)} SOL → Pool`);
      
      // Record distribution (simulated)
      const record: DistributionRecord = {
        timestamp: new Date().toISOString(),
        mint,
        symbol: token.symbol,
        totalFees: tokenShare,
        agentAmount,
        earnAmount,
        stakingAmount,
        agentWallet: token.agentWallet,
        txSignatures: ['simulated'], // In production: actual tx signatures
      };
      
      log.distributions.push(record);
      totalDistributed += tokenShare;
      tokensProcessed++;
      
    } catch (e: any) {
      errors.push(`${token.symbol}: ${e.message}`);
      console.error(`   ❌ Error: ${e.message}`);
    }
  }
  
  console.log('\n' + '─'.repeat(60));
  console.log(`✅ Processed: ${tokensProcessed} tokens`);
  console.log(`💰 Total distributed: ${totalDistributed.toFixed(4)} SOL`);
  
  if (errors.length > 0) {
    console.log(`⚠️ Errors: ${errors.length}`);
    errors.forEach(e => console.log(`   - ${e}`));
  }
  
  // Update log
  log.lastRun = new Date().toISOString();
  log.totalDistributed += totalDistributed;
  saveDistributionLog(log);
  
  console.log('\n📁 Distribution log saved');
  
  return {
    success: errors.length === 0,
    tokensProcessed,
    totalDistributed,
    errors,
  };
}

// ============ CLI ============

async function main() {
  console.log('═'.repeat(60));
  console.log('EARN PROTOCOL - FEE DISTRIBUTION CRANK');
  console.log('═'.repeat(60));
  
  const result = await runDistributionCrank();
  
  console.log('\n═'.repeat(60));
  console.log('RESULT:', result.success ? '✅ SUCCESS' : '❌ FAILED');
  console.log('═'.repeat(60));
  
  process.exit(result.success ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
