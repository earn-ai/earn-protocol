/**
 * STANDALONE EARN PROTOCOL LAUNCH
 * 
 * No API. No Render. Pure on-chain.
 * 
 * Usage:
 *   npx ts-node scripts/standalone-launch.ts --name "My Token" --symbol "TKN" --template degen
 * 
 * Requirements:
 *   - Solana CLI configured (solana config get)
 *   - Anchor CLI installed (anchor --version)
 *   - Earn Protocol program deployed (run scripts/deploy-devnet.sh first)
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import * as fs from 'fs';
import * as os from 'os';

// ============================================
// CONFIGURATION
// ============================================

const EARN_WALLET = new PublicKey('EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ');

const TEMPLATES = {
  degen: { feeBps: 300, earnCutBps: 1000, creatorCutBps: 1000, buybackCutBps: 5000, stakingCutBps: 3000 },
  creator: { feeBps: 200, earnCutBps: 1000, creatorCutBps: 3000, buybackCutBps: 3000, stakingCutBps: 3000 },
  community: { feeBps: 200, earnCutBps: 1000, creatorCutBps: 1000, buybackCutBps: 3000, stakingCutBps: 5000 },
};

// ============================================
// MAIN LAUNCH FUNCTION
// ============================================

async function launchToken(config: {
  name: string;
  symbol: string;
  template: 'degen' | 'creator' | 'community';
  network: 'devnet' | 'mainnet-beta';
  initialSupply?: number;
  decimals?: number;
}) {
  console.log('🚀 STANDALONE EARN PROTOCOL LAUNCH\n');
  console.log('No API. No Render. Pure on-chain.\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Setup connection
  const rpcUrl = config.network === 'devnet' 
    ? 'https://api.devnet.solana.com'
    : 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Load wallet from Solana CLI config (check multiple locations)
  const walletPaths = [
    `${os.homedir()}/.config/solana/id.json`,
    `${os.homedir()}/.config/solana/test-wallet.json`,
    './wallet.json',
  ];
  
  let keypairPath = walletPaths.find(p => fs.existsSync(p));
  
  if (!keypairPath) {
    console.error('❌ No wallet found. Run: solana-keygen new');
    console.error('   Or create wallet.json in current directory');
    process.exit(1);
  }
  
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  
  console.log('📂 Wallet:', wallet.publicKey.toBase58());
  console.log('🌐 Network:', config.network);
  
  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL\n');
  
  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    if (config.network === 'devnet') {
      console.log('🪂 Requesting airdrop...');
      try {
        const sig = await connection.requestAirdrop(wallet.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
        console.log('✅ Airdrop received\n');
      } catch (e) {
        console.error('⚠️ Airdrop failed. Get SOL from faucet.');
      }
    } else {
      console.error('❌ Insufficient SOL for mainnet deployment');
      process.exit(1);
    }
  }
  
  // ========================================
  // STEP 1: Create Token
  // ========================================
  console.log('STEP 1: Create Token');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const decimals = config.decimals || 9;
  const initialSupply = config.initialSupply || 1_000_000_000;
  
  const tokenMint = await createMint(
    connection,
    wallet,
    wallet.publicKey,  // mint authority
    wallet.publicKey,  // freeze authority
    decimals
  );
  
  console.log('✅ Token created');
  console.log('   Name:', config.name);
  console.log('   Symbol:', config.symbol);
  console.log('   Mint:', tokenMint.toBase58());
  console.log('   Decimals:', decimals);
  
  // Mint initial supply
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    tokenMint,
    wallet.publicKey
  );
  
  const supplyWithDecimals = BigInt(initialSupply) * BigInt(10 ** decimals);
  await mintTo(
    connection,
    wallet,
    tokenMint,
    tokenAccount.address,
    wallet,
    supplyWithDecimals
  );
  
  console.log('   Supply:', initialSupply.toLocaleString(), config.symbol);
  console.log('   Token Account:', tokenAccount.address.toBase58(), '\n');
  
  // ========================================
  // STEP 2: Load Earn Protocol Program
  // ========================================
  console.log('STEP 2: Load Earn Protocol Program');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Check for deployment info
  const deploymentPath = './deployment-devnet.json';
  let programId: PublicKey;
  
  if (fs.existsSync(deploymentPath)) {
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8'));
    programId = new PublicKey(deployment.programId);
    console.log('✅ Found deployment:', programId.toBase58(), '\n');
  } else {
    console.log('⚠️  No deployment found. Using default program ID.');
    console.log('   Run scripts/deploy-devnet.sh first to deploy.\n');
    // Default program ID (placeholder - would be real after deployment)
    programId = new PublicKey('EARNyKfN5M6dUCMk7vb5TW6QhMZ3xPLFHMrq7cXN6VFh');
  }
  
  // ========================================
  // STEP 3: Register Token with Earn Protocol
  // ========================================
  console.log('STEP 3: Register with Earn Protocol');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const template = TEMPLATES[config.template];
  
  console.log('📋 Template:', config.template);
  console.log('   Fee:', template.feeBps / 100, '%');
  console.log('   Buyback:', template.buybackCutBps / 100, '%');
  console.log('   Staking:', template.stakingCutBps / 100, '%');
  console.log('   Creator:', template.creatorCutBps / 100, '%');
  console.log('   Protocol:', template.earnCutBps / 100, '%');
  console.log('');
  console.log('👤 Creator wallet:', EARN_WALLET.toBase58(), '\n');
  
  // Derive PDAs
  const [tokenConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_config'), tokenMint.toBuffer()],
    programId
  );
  
  const [treasury] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury'), tokenMint.toBuffer()],
    programId
  );
  
  const [stakingPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool'), tokenMint.toBuffer()],
    programId
  );
  
  console.log('📋 PDAs:');
  console.log('   Token Config:', tokenConfig.toBase58());
  console.log('   Treasury:', treasury.toBase58());
  console.log('   Staking Pool:', stakingPool.toBase58(), '\n');
  
  // Note: Actual registration requires the Anchor program to be deployed
  // This script shows the complete flow - with deployed program, 
  // you would call program.methods.registerToken(...)
  
  console.log('⚠️  Note: To complete registration on-chain, the Earn Protocol');
  console.log('   program must be deployed. Run: npm run deploy:devnet\n');
  
  // ========================================
  // STEP 4: Create Earn Wallet Token Account
  // ========================================
  console.log('STEP 4: Initialize Earn Wallet Token Account');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    const earnTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      tokenMint,
      EARN_WALLET
    );
    console.log('✅ Earn token account:', earnTokenAccount.address.toBase58(), '\n');
  } catch (e: any) {
    console.log('⚠️  Could not create Earn token account:', e.message, '\n');
  }
  
  // ========================================
  // SUMMARY
  // ========================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TOKEN LAUNCHED!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('Token:', config.name, `($${config.symbol})`);
  console.log('Mint:', tokenMint.toBase58());
  console.log('Network:', config.network);
  console.log('Creator:', EARN_WALLET.toBase58());
  console.log('');
  console.log('Tokenomics (on registration):');
  console.log(`  • ${template.feeBps / 100}% fee per trade`);
  console.log(`  • ${template.buybackCutBps / 100}% → Buyback & Burn`);
  console.log(`  • ${template.stakingCutBps / 100}% → Staking Rewards`);
  console.log(`  • ${template.creatorCutBps / 100}% → Creator (Earn)`);
  console.log(`  • ${template.earnCutBps / 100}% → Protocol`);
  console.log('');
  console.log('Explorer:', `https://explorer.solana.com/address/${tokenMint.toBase58()}?cluster=${config.network}`);
  console.log('');
  
  return {
    mint: tokenMint.toBase58(),
    tokenAccount: tokenAccount.address.toBase58(),
    name: config.name,
    symbol: config.symbol,
    template: config.template,
    pdas: {
      tokenConfig: tokenConfig.toBase58(),
      treasury: treasury.toBase58(),
      stakingPool: stakingPool.toBase58(),
    },
  };
}

// ============================================
// CLI INTERFACE
// ============================================

const args = process.argv.slice(2);
const getArg = (name: string) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
};

const name = getArg('name') || 'Test Token';
const symbol = getArg('symbol') || 'TEST';
const template = (getArg('template') || 'degen') as 'degen' | 'creator' | 'community';
const network = (getArg('network') || 'devnet') as 'devnet' | 'mainnet-beta';

launchToken({ name, symbol, template, network })
  .then(result => {
    console.log('\n✅ Complete! Token data:', JSON.stringify(result, null, 2));
  })
  .catch(e => {
    console.error('\n❌ Error:', e.message);
    process.exit(1);
  });
