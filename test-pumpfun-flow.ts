import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import * as fs from 'fs';

const EARN_WALLET = 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ';
const API_BASE = 'https://earn-protocol.onrender.com';

async function main() {
  console.log('🧪 Testing Earn Protocol + Pump.fun Flow on Devnet\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  const walletPath = '/home/node/.config/solana/test-wallet.json';
  if (!fs.existsSync(walletPath)) {
    console.log('❌ No test wallet');
    return;
  }
  
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  console.log('📂 Wallet:', wallet.publicKey.toBase58());
  
  const balance = await connection.getBalance(wallet.publicKey);
  console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL\n');
  
  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    console.log('🪂 Requesting airdrop...');
    try {
      const sig = await connection.requestAirdrop(wallet.publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
      console.log('✅ Airdrop received\n');
    } catch (e) {
      console.log('⚠️ Airdrop failed, continuing...\n');
    }
  }
  
  // Step 1: Create token
  console.log('STEP 1: Create Token (simulating pump.fun launch)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const tokenMint = await createMint(connection, wallet, wallet.publicKey, wallet.publicKey, 9);
  console.log('✅ Token:', tokenMint.toBase58());
  
  const ata = await getOrCreateAssociatedTokenAccount(connection, wallet, tokenMint, wallet.publicKey);
  await mintTo(connection, wallet, tokenMint, ata.address, wallet, 1_000_000_000_000_000n);
  console.log('✅ Minted 1M tokens\n');
  
  // Step 2: Register with Earn Protocol
  console.log('STEP 2: Register with Earn Protocol');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const onboardRes = await fetch(`${API_BASE}/earn/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tokenMint: tokenMint.toBase58(),
      creatorWallet: EARN_WALLET,
      intent: 'degen'
    })
  });
  
  const onboardData = await onboardRes.json() as any;
  console.log('Response:', JSON.stringify(onboardData, null, 2), '\n');
  
  // Step 3: Verify
  console.log('STEP 3: Verify Token Config');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const configRes = await fetch(`${API_BASE}/earn/token/${tokenMint.toBase58()}`);
  const configData = await configRes.json() as any;
  console.log('Config:', JSON.stringify(configData, null, 2), '\n');
  
  // Step 4: Quote
  console.log('STEP 4: Test Fee Quote');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const quoteRes = await fetch(`${API_BASE}/earn/quote?tokenMint=${tokenMint.toBase58()}&amount=1000000000`);
  const quoteData = await quoteRes.json() as any;
  console.log('Quote:', JSON.stringify(quoteData, null, 2), '\n');
  
  // Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Token:', tokenMint.toBase58());
  console.log('Creator:', EARN_WALLET);
  console.log('Explorer:', `https://explorer.solana.com/address/${tokenMint.toBase58()}?cluster=devnet`);
  
  if (onboardData.dashboardUrl) {
    console.log('Dashboard:', onboardData.dashboardUrl);
  }
}

main().catch(e => console.error('Error:', e.message));
