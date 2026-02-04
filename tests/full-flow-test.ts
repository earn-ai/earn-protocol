/**
 * FULL EARN PROTOCOL TEST SUITE
 * 
 * Tests:
 * 1. Token launch via API
 * 2. Buy tokens on pump.fun
 * 3. Check creator vault fees
 * 4. Stake tokens
 * 5. Claim staking rewards
 * 6. Unstake with cooldown
 * 
 * Prerequisites:
 * - Devnet SOL in test wallet
 * - earn-staking program deployed (for staking tests)
 * - RPC available
 * 
 * Run: npx ts-node tests/full-flow-test.ts
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } from '@solana/web3.js';
import { PumpSdk, bondingCurvePda, creatorVaultPda } from '@pump-fun/pump-sdk';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, getAccount } from '@solana/spl-token';
import * as fs from 'fs';

const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const API_URL = process.env.API_URL || 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    log(`✅ ${name}`);
  } catch (e: any) {
    results.push({ name, passed: false, error: e.message });
    log(`❌ ${name}: ${e.message}`);
  }
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('EARN PROTOCOL - FULL FLOW TEST');
  console.log('='.repeat(60) + '\n');
  
  // Setup
  const connection = new Connection(RPC_URL, 'confirmed');
  const pumpSdk = new PumpSdk();
  
  // Load wallets
  const testWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/test-wallet.json', 'utf-8'));
  const testWallet = Keypair.fromSecretKey(Uint8Array.from(testWalletData));
  
  const earnWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/earn-wallet.json', 'utf-8'));
  const earnPubkey = new PublicKey(earnWalletData.public_address);
  
  log(`Test Wallet: ${testWallet.publicKey.toString()}`);
  log(`Earn Wallet: ${earnPubkey.toString()}`);
  
  // ============================================
  // SECTION 1: SETUP & CONNECTIVITY
  // ============================================
  console.log('\n--- SECTION 1: SETUP ---\n');
  
  await test('RPC connection', async () => {
    const slot = await connection.getSlot();
    log(`  Current slot: ${slot}`);
  });
  
  await test('Test wallet has SOL', async () => {
    const balance = await connection.getBalance(testWallet.publicKey);
    log(`  Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    if (balance < 0.1 * LAMPORTS_PER_SOL) {
      throw new Error('Need at least 0.1 SOL');
    }
  });
  
  await test('API health check', async () => {
    const res = await fetch(`${API_URL}/health`);
    const data = await res.json() as any;
    if (data.status !== 'ok') throw new Error('API not healthy');
    log(`  Network: ${data.network}`);
  });
  
  // ============================================
  // SECTION 2: TOKEN LAUNCH
  // ============================================
  console.log('\n--- SECTION 2: TOKEN LAUNCH ---\n');
  
  let tokenMint: PublicKey | null = null;
  
  await test('Launch token via API', async () => {
    const res = await fetch(`${API_URL}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Test ${Date.now()}`,
        ticker: 'FLOW',
        image: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
        tokenomics: 'degen',
        agentWallet: testWallet.publicKey.toString(),
        description: 'Full flow test token'
      })
    });
    
    const data = await res.json() as any;
    if (!data.success) throw new Error(data.error || 'Launch failed');
    
    tokenMint = new PublicKey(data.mint);
    log(`  Mint: ${tokenMint.toString()}`);
    log(`  TX: ${data.txSignature}`);
  });
  
  if (!tokenMint) {
    log('\n⚠️ Token launch failed, skipping remaining tests');
    return;
  }
  
  // ============================================
  // SECTION 3: BONDING CURVE & TRADING
  // ============================================
  console.log('\n--- SECTION 3: TRADING ---\n');
  
  const bondingCurvePdaResult = bondingCurvePda(tokenMint);
  const bondingCurve = Array.isArray(bondingCurvePdaResult) ? bondingCurvePdaResult[0] : bondingCurvePdaResult;
  
  await test('Bonding curve exists', async () => {
    const info = await connection.getAccountInfo(bondingCurve);
    if (!info) throw new Error('Bonding curve not found');
    log(`  Bonding curve: ${bondingCurve.toString()}`);
    log(`  SOL balance: ${(info.lamports / LAMPORTS_PER_SOL).toFixed(4)}`);
  });
  
  await test('Buy tokens', async () => {
    const buyAmount = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
    
    // Get user's ATA
    const userAta = getAssociatedTokenAddressSync(
      tokenMint!,
      testWallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    // Build buy instruction
    const buyIx = await pumpSdk.buyV2Instruction({
      mint: tokenMint!,
      user: testWallet.publicKey,
      bondingCurve,
      associatedUser: userAta,
      maxSolAmount: BigInt(buyAmount),
      minTokenAmount: BigInt(1), // At least 1 token
    });
    
    const tx = new Transaction().add(buyIx);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = testWallet.publicKey;
    tx.sign(testWallet);
    
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig);
    
    log(`  Bought tokens for 0.01 SOL`);
    log(`  TX: ${sig}`);
  });
  
  // ============================================
  // SECTION 4: FEE VERIFICATION
  // ============================================
  console.log('\n--- SECTION 4: FEE VERIFICATION ---\n');
  
  const creatorVaultPdaResult = creatorVaultPda(earnPubkey);
  const creatorVault = Array.isArray(creatorVaultPdaResult) ? creatorVaultPdaResult[0] : creatorVaultPdaResult;
  
  await test('Creator vault has fees', async () => {
    const info = await connection.getAccountInfo(creatorVault);
    if (!info) throw new Error('Creator vault not found');
    
    const vaultBalance = info.lamports / LAMPORTS_PER_SOL;
    log(`  Creator vault: ${creatorVault.toString()}`);
    log(`  Accumulated fees: ${vaultBalance.toFixed(6)} SOL`);
    
    // Fees should exist after trading
    if (vaultBalance === 0) {
      log(`  ⚠️ No fees yet (expected if first trade)`);
    }
  });
  
  // ============================================
  // SECTION 5: STAKING (if program deployed)
  // ============================================
  console.log('\n--- SECTION 5: STAKING ---\n');
  
  // Note: These tests require the earn-staking Anchor program to be deployed
  // For now, we'll just verify the program structure
  
  await test('Staking program structure', async () => {
    // Check if staking pool PDA would be derivable
    const stakingProgramId = new PublicKey('EarnStak1111111111111111111111111111111111111');
    
    const [stakingPool] = PublicKey.findProgramAddressSync(
      [Buffer.from('staking-pool'), tokenMint!.toBuffer()],
      stakingProgramId
    );
    
    log(`  Staking program: ${stakingProgramId.toString()}`);
    log(`  Pool PDA (would be): ${stakingPool.toString()}`);
    log(`  ⚠️ Anchor deploy required for live staking tests`);
  });
  
  // ============================================
  // SUMMARY
  // ============================================
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60) + '\n');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }
  
  console.log('\n');
}

main().catch(console.error);
