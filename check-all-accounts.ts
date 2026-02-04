import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { bondingCurvePda, creatorVaultPda, PumpSdk, GLOBAL_PDA } from '@pump-fun/pump-sdk';
import * as fs from 'fs';
import { Keypair } from '@solana/web3.js';

async function main() {
  console.log('📊 ACCOUNT STATE CHECK\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const pumpSdk = new PumpSdk();
  
  const tokenMint = new PublicKey('EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1');
  const earnWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/earn-wallet.json', 'utf-8'));
  const earnPubkey = new PublicKey(earnWalletData.public_address);
  
  // Bonding curve
  console.log('=== BONDING CURVE ===');
  const bcPda = bondingCurvePda(tokenMint);
  const bondingCurve = Array.isArray(bcPda) ? bcPda[0] : bcPda;
  const bcInfo = await connection.getAccountInfo(bondingCurve);
  if (bcInfo) {
    const bc = pumpSdk.decodeBondingCurve(bcInfo);
    console.log('Address:', bondingCurve.toString());
    console.log('SOL balance:', bcInfo.lamports / LAMPORTS_PER_SOL, 'SOL');
    console.log('Virtual SOL:', bc.virtualSolReserves.toString());
    console.log('Virtual Token:', bc.virtualTokenReserves.toString());
    console.log('Real SOL:', bc.realSolReserves.toString());
    console.log('Real Token:', bc.realTokenReserves.toString());
    console.log('Creator:', bc.creator.toString());
    console.log('⬆️ This creator receives fees!');
  }
  
  // Creator vault for the token's creator (from bonding curve)
  console.log('\n=== CREATOR VAULT (Token Creator) ===');
  if (bcInfo) {
    const bc = pumpSdk.decodeBondingCurve(bcInfo);
    const tokenCreatorVaultPda = creatorVaultPda(bc.creator);
    const tokenCreatorVault = Array.isArray(tokenCreatorVaultPda) ? tokenCreatorVaultPda[0] : tokenCreatorVaultPda;
    console.log('Creator:', bc.creator.toString());
    console.log('Vault PDA:', tokenCreatorVault.toString());
    const vaultInfo = await connection.getAccountInfo(tokenCreatorVault);
    if (vaultInfo) {
      console.log('Balance:', vaultInfo.lamports / LAMPORTS_PER_SOL, 'SOL');
    } else {
      console.log('Not initialized');
    }
  }
  
  // Earn wallet's creator vault
  console.log('\n=== EARN WALLET CREATOR VAULT ===');
  const earnVaultPda = creatorVaultPda(earnPubkey);
  const earnVault = Array.isArray(earnVaultPda) ? earnVaultPda[0] : earnVaultPda;
  console.log('Earn wallet:', earnPubkey.toString());
  console.log('Vault PDA:', earnVault.toString());
  const earnVaultInfo = await connection.getAccountInfo(earnVault);
  if (earnVaultInfo) {
    console.log('Balance:', earnVaultInfo.lamports / LAMPORTS_PER_SOL, 'SOL');
  } else {
    console.log('Not initialized');
  }
  
  // Wallet balances
  console.log('\n=== WALLET BALANCES ===');
  const earnBalance = await connection.getBalance(earnPubkey);
  console.log('Earn wallet:', earnBalance / LAMPORTS_PER_SOL, 'SOL');
  
  const testWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/test-wallet.json', 'utf-8'));
  const testWallet = Keypair.fromSecretKey(Uint8Array.from(testWalletData));
  const testBalance = await connection.getBalance(testWallet.publicKey);
  console.log('Test wallet:', testBalance / LAMPORTS_PER_SOL, 'SOL');
}

main().catch(console.error);
