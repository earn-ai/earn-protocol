/**
 * Buyback Module for Earn Protocol
 * 
 * Uses accumulated creator fees to buy back tokens
 * Part of the tokenomics management system
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, ComputeBudgetProgram, AccountInfo } from '@solana/web3.js';
import { PumpSdk, bondingCurvePda, GLOBAL_PDA, creatorVaultPda } from '@pump-fun/pump-sdk';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const EARN_WALLET_PATH = process.env.EARN_WALLET || '/home/node/.config/solana/earn-wallet.json';
const DATA_DIR = process.env.DATA_DIR || './data';
const BUYBACK_LOG = path.join(DATA_DIR, 'buybacks.json');

interface BuybackRecord {
  timestamp: string;
  mint: string;
  symbol: string;
  solSpent: number;
  tokensReceived: string;
  txSignature: string;
}

interface BuybackLog {
  lastRun: string | null;
  totalBuybacks: number;
  totalSolSpent: number;
  buybacks: BuybackRecord[];
}

function loadKeypair(filepath: string): Keypair {
  const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  if (Array.isArray(data)) {
    return Keypair.fromSecretKey(Uint8Array.from(data));
  } else if (data.private_key) {
    const bs58 = require('bs58');
    return Keypair.fromSecretKey(bs58.decode(data.private_key));
  }
  throw new Error('Unknown wallet format');
}

function loadBuybackLog(): BuybackLog {
  try {
    if (fs.existsSync(BUYBACK_LOG)) {
      return JSON.parse(fs.readFileSync(BUYBACK_LOG, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load buyback log:', e);
  }
  return { lastRun: null, totalBuybacks: 0, totalSolSpent: 0, buybacks: [] };
}

function saveBuybackLog(log: BuybackLog): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(BUYBACK_LOG, JSON.stringify(log, null, 2));
}

export interface BuybackResult {
  success: boolean;
  mint: string;
  solSpent: number;
  tokensReceived: string;
  txSignature?: string;
  error?: string;
}

/**
 * Execute a buyback for a specific token
 */
export async function executeBuyback(
  tokenMint: PublicKey,
  solAmount: number, // in SOL
  symbol: string = 'TOKEN'
): Promise<BuybackResult> {
  console.log(`\n🔄 Executing buyback for ${symbol}`);
  console.log(`   Mint: ${tokenMint.toString()}`);
  console.log(`   Amount: ${solAmount} SOL`);
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const pumpSdk = new PumpSdk();
  const earnWallet = loadKeypair(EARN_WALLET_PATH);
  
  try {
    // Fetch bonding curve
    const bcPda = bondingCurvePda(tokenMint);
    const bondingCurve = Array.isArray(bcPda) ? bcPda[0] : bcPda;
    
    const globalInfo = await connection.getAccountInfo(GLOBAL_PDA) as AccountInfo<Buffer>;
    if (!globalInfo) throw new Error('Global account not found');
    const global = pumpSdk.decodeGlobal(globalInfo);
    
    const bcInfo = await connection.getAccountInfo(bondingCurve) as AccountInfo<Buffer>;
    if (!bcInfo) throw new Error('Bonding curve not found');
    const bc = pumpSdk.decodeBondingCurve(bcInfo);
    
    // Earn wallet's ATA for this token
    const earnAta = getAssociatedTokenAddressSync(
      tokenMint,
      earnWallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    const ataInfo = await connection.getAccountInfo(earnAta) as AccountInfo<Buffer> | null;
    
    // Calculate token amount based on SOL
    const solLamports = new BN(solAmount * LAMPORTS_PER_SOL);
    // Rough estimate: use virtual reserves ratio
    const tokenAmount = solLamports.mul(bc.virtualTokenReserves).div(bc.virtualSolReserves);
    
    console.log(`   Estimated tokens: ${tokenAmount.toString()}`);
    
    // Build buy instructions
    const buyIxs = await pumpSdk.buyInstructions({
      global,
      bondingCurve: bc,
      bondingCurveAccountInfo: bcInfo,
      associatedUserAccountInfo: ataInfo,
      mint: tokenMint,
      user: earnWallet.publicKey,
      amount: tokenAmount,
      solAmount: solLamports,
      slippage: 0.1, // 10% slippage for buybacks
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });
    
    // Build transaction
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));
    
    if (!ataInfo) {
      tx.add(createAssociatedTokenAccountIdempotentInstruction(
        earnWallet.publicKey,
        earnAta,
        earnWallet.publicKey,
        tokenMint,
        TOKEN_2022_PROGRAM_ID
      ));
    }
    
    for (const ix of buyIxs) {
      tx.add(ix);
    }
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = earnWallet.publicKey;
    tx.sign(earnWallet);
    
    console.log('   Sending transaction...');
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    const confirmation = await connection.confirmTransaction({
      signature: sig,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    // Get actual tokens received
    let tokensReceived = '0';
    try {
      const tokenBalance = await connection.getTokenAccountBalance(earnAta);
      tokensReceived = tokenBalance.value.uiAmountString || '0';
    } catch {}
    
    // Log the buyback
    const log = loadBuybackLog();
    const record: BuybackRecord = {
      timestamp: new Date().toISOString(),
      mint: tokenMint.toString(),
      symbol,
      solSpent: solAmount,
      tokensReceived,
      txSignature: sig,
    };
    log.buybacks.push(record);
    log.lastRun = record.timestamp;
    log.totalBuybacks++;
    log.totalSolSpent += solAmount;
    saveBuybackLog(log);
    
    console.log(`   ✅ Buyback successful!`);
    console.log(`   TX: ${sig}`);
    console.log(`   Tokens received: ${tokensReceived}`);
    
    return {
      success: true,
      mint: tokenMint.toString(),
      solSpent: solAmount,
      tokensReceived,
      txSignature: sig,
    };
    
  } catch (e: any) {
    console.error(`   ❌ Buyback failed:`, e.message);
    return {
      success: false,
      mint: tokenMint.toString(),
      solSpent: 0,
      tokensReceived: '0',
      error: e.message,
    };
  }
}

/**
 * Get creator vault balance
 */
export async function getCreatorVaultBalance(): Promise<number> {
  const connection = new Connection(RPC_URL, 'confirmed');
  const earnWalletData = JSON.parse(fs.readFileSync(EARN_WALLET_PATH, 'utf-8'));
  const earnPubkey = new PublicKey(earnWalletData.public_address);
  
  const vaultPda = creatorVaultPda(earnPubkey);
  const creatorVault = Array.isArray(vaultPda) ? vaultPda[0] : vaultPda;
  
  const vaultInfo = await connection.getAccountInfo(creatorVault);
  return vaultInfo ? vaultInfo.lamports / LAMPORTS_PER_SOL : 0;
}

// CLI
if (require.main === module) {
  async function main() {
    console.log('='.repeat(50));
    console.log('EARN PROTOCOL - BUYBACK MODULE');
    console.log('='.repeat(50));
    
    const vaultBalance = await getCreatorVaultBalance();
    console.log(`\nCreator vault balance: ${vaultBalance.toFixed(6)} SOL`);
    
    if (vaultBalance < 0.001) {
      console.log('⚠️ Not enough fees for buyback (min 0.001 SOL)');
      return;
    }
    
    // Example: buyback with 50% of fees
    const buybackAmount = vaultBalance * 0.5;
    const tokenMint = new PublicKey('EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1');
    
    const result = await executeBuyback(tokenMint, buybackAmount, 'EARNTEST');
    console.log('\nResult:', JSON.stringify(result, null, 2));
  }
  
  main().catch(console.error);
}
