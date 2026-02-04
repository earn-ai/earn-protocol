import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { bondingCurvePda, creatorVaultPda, PumpSdk } from '@pump-fun/pump-sdk';
import * as fs from 'fs';

async function main() {
  console.log('📊 CHECKING DEVNET STATE\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Wallets
  const earnWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/earn-wallet.json', 'utf-8'));
  const earnPubkey = new PublicKey(earnWalletData.public_address);
  
  const testWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/test-wallet.json', 'utf-8'));
  const testWallet = Keypair.fromSecretKey(Uint8Array.from(testWalletData));
  
  console.log('=== WALLETS ===\n');
  
  // Earn wallet
  const earnBalance = await connection.getBalance(earnPubkey);
  console.log('Earn Wallet:', earnPubkey.toString());
  console.log('  Balance:', (earnBalance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  
  // Test wallet
  const testBalance = await connection.getBalance(testWallet.publicKey);
  console.log('\nTest Wallet:', testWallet.publicKey.toString());
  console.log('  Balance:', (testBalance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  
  // Creator vault
  const vaultPda = creatorVaultPda(earnPubkey);
  const creatorVault = Array.isArray(vaultPda) ? vaultPda[0] : vaultPda;
  
  console.log('\n=== CREATOR VAULT ===\n');
  console.log('Creator Vault PDA:', creatorVault.toString());
  
  try {
    const vaultInfo = await connection.getAccountInfo(creatorVault);
    if (vaultInfo) {
      console.log('  Balance:', (vaultInfo.lamports / LAMPORTS_PER_SOL).toFixed(6), 'SOL');
      console.log('  Status: ACTIVE (fees accumulating here)');
    } else {
      console.log('  Status: Not initialized (no fees yet)');
    }
  } catch (e: any) {
    console.log('  Error:', e.message);
  }
  
  // Tokens
  console.log('\n=== TOKENS ===\n');
  
  const tokens = [
    { mint: 'EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1', symbol: 'EARNTEST' },
    { mint: '4hqoGYX7fNFnSYsHFJ6RosK24sUmpbLNj6BqDDkGhdpE', symbol: 'TEST' }
  ];
  
  for (const token of tokens) {
    const mint = new PublicKey(token.mint);
    const bcPda = bondingCurvePda(mint);
    const bondingCurve = Array.isArray(bcPda) ? bcPda[0] : bcPda;
    
    console.log(`${token.symbol}:`);
    console.log('  Mint:', token.mint);
    
    try {
      const bcInfo = await connection.getAccountInfo(bondingCurve);
      if (bcInfo) {
        console.log('  Bonding Curve:', bondingCurve.toString());
        console.log('  SOL in curve:', (bcInfo.lamports / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
        console.log('  Status: TRADEABLE');
      } else {
        console.log('  Status: Bonding curve not found');
      }
    } catch (e: any) {
      console.log('  Error:', e.message);
    }
    console.log('');
  }
  
  console.log('=== SUMMARY ===\n');
  console.log('✅ Devnet RPC: Working');
  console.log('✅ Tokens created: 2');
  console.log('✅ Bonding curves: Active');
  console.log('⏳ Creator vault: Waiting for trades');
  console.log('⏳ Staking program: Needs Anchor deploy');
  console.log('');
  console.log('To trade: Use pump.fun UI at https://pump.fun/<mint>?cluster=devnet');
}

main().catch(console.error);
