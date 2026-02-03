/**
 * Register a test token with Earn Protocol
 * 
 * Usage: 
 *   npx ts-node scripts/register-test-token.ts
 *   npx ts-node scripts/register-test-token.ts <TOKEN_MINT>
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as os from 'os';

// Load deployment info
let PROGRAM_ID: PublicKey;
try {
  const deployment = JSON.parse(fs.readFileSync('./deployment-devnet.json', 'utf-8'));
  PROGRAM_ID = new PublicKey(deployment.programId);
} catch {
  console.error('❌ No deployment found. Run scripts/deploy-devnet.sh first');
  process.exit(1);
}

// Earn Protocol wallet - default creator, receives creator fees
const EARN_WALLET = new PublicKey('EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ');

// Templates
const TEMPLATES = {
  community: { feeBps: 200, earnCutBps: 1000, creatorCutBps: 2000, buybackCutBps: 3500, stakingCutBps: 3500 },
  degen: { feeBps: 300, earnCutBps: 1000, creatorCutBps: 1000, buybackCutBps: 5000, stakingCutBps: 3000 },
  creator: { feeBps: 200, earnCutBps: 1000, creatorCutBps: 3000, buybackCutBps: 3000, stakingCutBps: 3000 },
};

async function main() {
  console.log('🚀 Earn Protocol - Register Test Token\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Load wallet
  const keypairPath = `${os.homedir()}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const deployerKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  const wallet = new Wallet(deployerKeypair);
  
  console.log('📂 Deployer wallet:', wallet.publicKey.toBase58());
  console.log('🎯 Program ID:', PROGRAM_ID.toBase58());
  console.log('👤 Creator (Earn wallet):', EARN_WALLET.toBase58());
  
  const provider = new AnchorProvider(connection, wallet, {});
  const IDL = require('../target/idl/earn_protocol.json');
  const program = new Program(IDL, PROGRAM_ID, provider);
  
  // Check if token mint provided as argument
  let tokenMint: PublicKey;
  
  if (process.argv[2]) {
    tokenMint = new PublicKey(process.argv[2]);
    console.log('\n📋 Using existing token:', tokenMint.toBase58());
  } else {
    // Create a new test token
    console.log('\n🪙 Creating new test token...');
    tokenMint = await createMint(
      connection,
      deployerKeypair,
      deployerKeypair.publicKey,
      deployerKeypair.publicKey,
      9
    );
    console.log('✅ Token created:', tokenMint.toBase58());
    
    // Mint some tokens
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      deployerKeypair,
      tokenMint,
      deployerKeypair.publicKey
    );
    
    await mintTo(
      connection,
      deployerKeypair,
      tokenMint,
      tokenAccount.address,
      deployerKeypair,
      1_000_000_000_000_000n // 1M tokens
    );
    console.log('✅ Minted 1,000,000 tokens to:', tokenAccount.address.toBase58());
  }
  
  // Derive PDAs
  const [tokenConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_config'), tokenMint.toBuffer()],
    PROGRAM_ID
  );
  
  const [treasury] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury'), tokenMint.toBuffer()],
    PROGRAM_ID
  );
  
  const [stakingPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool'), tokenMint.toBuffer()],
    PROGRAM_ID
  );
  
  console.log('\n📋 PDAs:');
  console.log('   Token Config:', tokenConfig.toBase58());
  console.log('   Treasury:', treasury.toBase58());
  console.log('   Staking Pool:', stakingPool.toBase58());
  
  // Register with community template, Earn wallet as creator
  const template = TEMPLATES.community;
  
  console.log('\n📝 Registering with Earn Protocol...');
  console.log('   Template: community');
  console.log('   Fee: 2%');
  console.log('   Creator cut: 20% → Earn wallet');
  console.log('   Staking rewards: 35%');
  console.log('   Buybacks: 35%');
  
  try {
    const tx = await program.methods
      .registerToken(
        template.feeBps,
        template.earnCutBps,
        template.creatorCutBps,
        template.buybackCutBps,
        template.stakingCutBps
      )
      .accounts({
        creator: EARN_WALLET, // Earn wallet as creator!
        payer: wallet.publicKey,
        tokenMint,
        tokenConfig,
        treasury,
        stakingPool,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log('\n✅ Token registered!');
    console.log('   Transaction:', tx);
  } catch (e: any) {
    if (e.message?.includes('already in use')) {
      console.log('\n✅ Token already registered!');
    } else {
      throw e;
    }
  }
  
  // Verify registration
  console.log('\n🔍 Verifying registration...');
  const config = await program.account.tokenConfig.fetch(tokenConfig);
  
  console.log('\n✅ Token Config On-Chain:');
  console.log('   Token Mint:', config.tokenMint.toBase58());
  console.log('   Creator:', config.creator.toBase58());
  console.log('   Fee BPS:', config.feeBasisPoints);
  console.log('   Earn Cut BPS:', config.earnCutBps);
  console.log('   Creator Cut BPS:', config.creatorCutBps);
  console.log('   Buyback Cut BPS:', config.buybackCutBps);
  console.log('   Staking Cut BPS:', config.stakingCutBps);
  console.log('   Is Active:', config.isActive);
  
  // Ensure Earn wallet has token account for receiving fees
  console.log('\n🔧 Ensuring Earn wallet has token account...');
  const earnTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    deployerKeypair,
    tokenMint,
    EARN_WALLET
  );
  console.log('✅ Earn token account:', earnTokenAccount.address.toBase58());
  
  console.log('\n======================================');
  console.log('🎉 TOKEN READY FOR EARN PROTOCOL!');
  console.log('======================================\n');
  console.log('Token Mint:', tokenMint.toBase58());
  console.log('Creator (receives 20% fees):', EARN_WALLET.toBase58());
  console.log('');
  console.log('View on Solana Explorer:');
  console.log(`https://explorer.solana.com/address/${tokenMint.toBase58()}?cluster=devnet`);
  console.log('');
  console.log('Test swaps will now collect fees with this distribution:');
  console.log('  - 10% → Protocol (Earn)');
  console.log('  - 20% → Creator (Earn wallet)');
  console.log('  - 35% → Buyback pool');
  console.log('  - 35% → Staking rewards');
}

main().catch(console.error);
