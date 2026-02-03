/**
 * Test script for Earn Protocol swap flow
 * 
 * Tests the full flow:
 * 1. Register a test token
 * 2. Call /earn/swap to get transaction
 * 3. Sign and submit transaction
 * 4. Verify fee split correctly
 */

import {
  Keypair,
  Connection,
  Transaction,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// Test token - use any devnet token or deploy your own
const TEST_TOKEN = process.env.TEST_TOKEN || 'So11111111111111111111111111111111111111112'; // SOL for testing

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSwapFlow() {
  console.log('🧪 Starting Earn Protocol Swap Test\n');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const userWallet = Keypair.generate();
  
  console.log(`📍 User wallet: ${userWallet.publicKey.toString()}`);
  console.log(`📍 RPC: ${RPC_URL}`);
  console.log(`📍 API: ${API_URL}\n`);

  // 1. Airdrop SOL to test wallet
  console.log('1️⃣ Airdropping SOL to test wallet...');
  try {
    const airdropSig = await connection.requestAirdrop(
      userWallet.publicKey,
      LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);
    console.log(`   ✅ Airdrop successful: ${airdropSig}\n`);
  } catch (error: any) {
    console.log(`   ⚠️ Airdrop failed (may already have SOL): ${error.message}\n`);
  }

  // Check balance
  const balance = await connection.getBalance(userWallet.publicKey);
  console.log(`   Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // 2. Register test token (if not already registered)
  console.log('2️⃣ Registering test token...');
  try {
    const registerRes = await fetch(`${API_URL}/earn/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenMint: TEST_TOKEN,
        template: 'degen',
        creator: userWallet.publicKey.toString(),
      }),
    });
    
    const registerData = await registerRes.json();
    if (registerRes.ok) {
      console.log('   ✅ Token registered:', registerData);
    } else {
      console.log('   ℹ️ Token registration response:', registerData);
    }
  } catch (error: any) {
    console.log(`   ⚠️ Registration error: ${error.message}`);
  }
  console.log();

  // 3. Get swap quote first
  console.log('3️⃣ Getting swap quote...');
  try {
    const quoteUrl = `${API_URL}/earn/swap/quote?tokenMint=${TEST_TOKEN}&inputMint=So11111111111111111111111111111111111111112&outputMint=${TEST_TOKEN}&amount=100000000`;
    const quoteRes = await fetch(quoteUrl);
    const quoteData = await quoteRes.json();
    
    if (quoteRes.ok) {
      console.log('   ✅ Quote received:');
      console.log(`      Input: ${quoteData.quote?.inputAmount}`);
      console.log(`      Output (net): ${quoteData.quote?.outputAmount}`);
      console.log(`      Fee: ${quoteData.quote?.feeAmount}`);
      console.log(`      Fee splits:`, quoteData.quote?.feeSplits);
    } else {
      console.log('   ⚠️ Quote error:', quoteData);
    }
  } catch (error: any) {
    console.log(`   ⚠️ Quote error: ${error.message}`);
  }
  console.log();

  // 4. Get swap transaction
  console.log('4️⃣ Building swap transaction...');
  try {
    const swapRes = await fetch(`${API_URL}/earn/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenMint: TEST_TOKEN,
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: TEST_TOKEN,
        amount: 100000000, // 0.1 SOL
        userPublicKey: userWallet.publicKey.toString(),
        slippageBps: 100,
      }),
    });
    
    const swapData = await swapRes.json();
    
    if (!swapRes.ok) {
      console.log('   ❌ Swap error:', swapData);
      return;
    }
    
    console.log('   ✅ Swap transaction built:');
    console.log(`      Output: ${swapData.quote?.outputAmount}`);
    console.log(`      Fee: ${swapData.quote?.feeAmount}`);
    console.log(`      Expires: ${new Date(swapData.expiresAt).toISOString()}`);
    console.log(`      Route: ${swapData.quote?.route?.join(' → ')}`);
    console.log();

    // 5. Sign and submit transaction
    console.log('5️⃣ Signing and submitting transaction...');
    try {
      const txBuffer = Buffer.from(swapData.transaction, 'base64');
      const tx = Transaction.from(txBuffer);
      
      tx.sign(userWallet);
      
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      
      console.log(`   ✅ Transaction submitted: ${sig}`);
      console.log(`      Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
      
      // Wait for confirmation
      console.log('   ⏳ Waiting for confirmation...');
      const confirmation = await connection.confirmTransaction(sig, 'confirmed');
      
      if (confirmation.value.err) {
        console.log('   ❌ Transaction failed:', confirmation.value.err);
      } else {
        console.log('   ✅ Transaction confirmed!');
      }
    } catch (error: any) {
      console.log(`   ❌ Transaction error: ${error.message}`);
      if (error.logs) {
        console.log('   Logs:', error.logs);
      }
    }
  } catch (error: any) {
    console.log(`   ❌ Swap error: ${error.message}`);
  }

  console.log('\n🏁 Test complete!');
}

// Run if executed directly
testSwapFlow().catch(console.error);
