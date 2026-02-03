/**
 * Launch a token on Pump.fun with Earn as creator
 * 
 * Run: npx ts-node scripts/launch-token-pumpfun.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { PumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import * as fs from 'fs';

// ============ CONFIG ============

const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const EARN_WALLET_PATH = process.env.EARN_WALLET || '/home/node/.config/solana/earn-wallet.json';

// Token details (would come from agent in production)
const TOKEN_NAME = process.env.TOKEN_NAME || `Earn Test ${Date.now() % 10000}`;
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || `ET${Date.now() % 1000}`;
const TOKEN_URI = process.env.TOKEN_URI || 'https://arweave.net/placeholder'; // Placeholder

// ============ HELPERS ============

function loadKeypair(filepath: string): Keypair {
  const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  
  if (Array.isArray(data)) {
    return Keypair.fromSecretKey(Uint8Array.from(data));
  } else if (data.private_key) {
    const secretKey = bs58.decode(data.private_key);
    return Keypair.fromSecretKey(secretKey);
  } else if (data.secretKey) {
    return Keypair.fromSecretKey(Uint8Array.from(data.secretKey));
  }
  
  throw new Error('Unknown wallet format');
}

// ============ MAIN ============

async function main() {
  console.log('🚀 Launching Token on Pump.fun via Earn\n');
  
  // Setup connection
  const connection = new Connection(RPC_URL, 'confirmed');
  console.log('📡 Network:', RPC_URL);
  
  // Load Earn wallet
  const earnWallet = loadKeypair(EARN_WALLET_PATH);
  console.log('💼 Earn Wallet:', earnWallet.publicKey.toString());
  
  // Check balance
  const balance = await connection.getBalance(earnWallet.publicKey);
  console.log(`   Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    console.log('\n⚠️  Low balance! Need at least 0.05 SOL');
    if (RPC_URL.includes('devnet')) {
      console.log('   Requesting airdrop...');
      try {
        const sig = await connection.requestAirdrop(earnWallet.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
        console.log('   ✅ Airdrop received');
      } catch (e: any) {
        console.log('   ⚠️ Airdrop failed:', e.message);
      }
    }
  }
  
  // Create SDK (offline - just for building instructions)
  const pumpSdk = new PumpSdk();
  
  // Generate new mint keypair
  const mintKeypair = Keypair.generate();
  console.log('\n🪙 New Token:');
  console.log('   Mint:', mintKeypair.publicKey.toString());
  console.log('   Name:', TOKEN_NAME);
  console.log('   Symbol:', TOKEN_SYMBOL);
  console.log('   URI:', TOKEN_URI);
  console.log('   Creator (fees):', earnWallet.publicKey.toString());
  
  // Build create_v2 instruction
  console.log('\n⏳ Building createV2 instruction...');
  
  try {
    // Build the create instruction
    const createIx = await pumpSdk.createV2Instruction({
      mint: mintKeypair.publicKey,
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      uri: TOKEN_URI,
      creator: earnWallet.publicKey,  // Earn gets all creator fees!
      user: earnWallet.publicKey,
      mayhemMode: true,               // Required for new tokens
    });
    
    console.log('   ✅ Create instruction built');
    console.log('   Accounts:', createIx.keys.length);
    
    // Also need extend account instruction
    const extendIx = await pumpSdk.extendAccountInstruction({
      account: bondingCurvePda(mintKeypair.publicKey),
      user: earnWallet.publicKey,
    });
    
    console.log('   ✅ Extend account instruction built');
    
    // Create associated token account for user
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
    
    console.log('   ✅ ATA instruction built');
    
    // Build transaction
    const tx = new Transaction();
    
    // Add compute budget (Pump.fun needs ~100k CU)
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));
    
    // Add instructions in order
    tx.add(createIx);
    tx.add(extendIx);
    tx.add(createAtaIx);
    
    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = earnWallet.publicKey;
    
    // Sign with both Earn wallet and mint keypair
    tx.sign(earnWallet, mintKeypair);
    
    console.log('\n📤 Sending transaction...');
    
    // Simulate first
    console.log('   Simulating...');
    const simResult = await connection.simulateTransaction(tx);
    
    if (simResult.value.err) {
      console.error('❌ Simulation failed:', simResult.value.err);
      console.log('\n📋 Logs:');
      simResult.value.logs?.forEach(log => console.log('  ', log));
      return;
    }
    
    console.log('   ✅ Simulation passed');
    console.log('   CU used:', simResult.value.unitsConsumed);
    
    // Send transaction
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    console.log('   Signature:', signature);
    console.log('   Waiting for confirmation...');
    
    // Confirm
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    
    if (confirmation.value.err) {
      console.error('❌ Transaction failed:', confirmation.value.err);
    } else {
      console.log('\n' + '═'.repeat(60));
      console.log('✅ TOKEN CREATED SUCCESSFULLY!');
      console.log('═'.repeat(60));
      console.log(`   Mint:       ${mintKeypair.publicKey.toString()}`);
      console.log(`   Name:       ${TOKEN_NAME}`);
      console.log(`   Symbol:     ${TOKEN_SYMBOL}`);
      console.log(`   Creator:    ${earnWallet.publicKey.toString()}`);
      console.log('');
      if (RPC_URL.includes('devnet')) {
        console.log(`   🔗 Solscan: https://solscan.io/token/${mintKeypair.publicKey.toString()}?cluster=devnet`);
      } else {
        console.log(`   🔗 Pump.fun: https://pump.fun/${mintKeypair.publicKey.toString()}`);
        console.log(`   🔗 Solscan: https://solscan.io/token/${mintKeypair.publicKey.toString()}`);
      }
      console.log('═'.repeat(60));
      
      // Save token info
      const tokenInfo = {
        mint: mintKeypair.publicKey.toString(),
        name: TOKEN_NAME,
        symbol: TOKEN_SYMBOL,
        uri: TOKEN_URI,
        creator: earnWallet.publicKey.toString(),
        network: RPC_URL.includes('devnet') ? 'devnet' : 'mainnet',
        createdAt: new Date().toISOString(),
        txSignature: signature,
      };
      
      fs.writeFileSync(
        `./token-${mintKeypair.publicKey.toString().slice(0, 8)}.json`,
        JSON.stringify(tokenInfo, null, 2)
      );
      console.log(`\n💾 Token info saved to token-${mintKeypair.publicKey.toString().slice(0, 8)}.json`);
    }
    
  } catch (e: any) {
    console.error('\n❌ Error:', e.message);
    
    if (e.logs) {
      console.log('\n📋 Logs:');
      e.logs.forEach((log: string) => console.log('  ', log));
    }
    
    if (e.stack) {
      console.log('\n📋 Stack:', e.stack.split('\n').slice(0, 5).join('\n'));
    }
  }
}

main().catch(console.error);
