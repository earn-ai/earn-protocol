import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

async function main() {
  // Earn wallet
  const earnWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/earn-wallet.json', 'utf-8'));
  const earnPubkey = new PublicKey(earnWalletData.public_address);
  
  // Test wallet
  const testWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/test-wallet.json', 'utf-8'));
  const testPubkey = new PublicKey(testWalletData.public_address || testWalletData[0] ? 
    (Array.isArray(testWalletData) ? require('@solana/web3.js').Keypair.fromSecretKey(Uint8Array.from(testWalletData)).publicKey : testWalletData.public_address) 
    : testWalletData);
  
  console.log('=== WALLET BALANCES ===\n');
  
  try {
    const earnBalance = await connection.getBalance(earnPubkey);
    console.log('Earn Wallet:', earnPubkey.toString());
    console.log('  Balance:', (earnBalance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  } catch (e: any) {
    console.log('Earn Wallet: RPC error -', e.message);
  }
  
  console.log('');
  
  // Get test wallet pubkey properly
  let testPubkeyActual: PublicKey;
  if (Array.isArray(testWalletData)) {
    const { Keypair } = require('@solana/web3.js');
    testPubkeyActual = Keypair.fromSecretKey(Uint8Array.from(testWalletData)).publicKey;
  } else {
    testPubkeyActual = new PublicKey(testWalletData.public_address);
  }
  
  try {
    const testBalance = await connection.getBalance(testPubkeyActual);
    console.log('Test Wallet:', testPubkeyActual.toString());
    console.log('  Balance:', (testBalance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  } catch (e: any) {
    console.log('Test Wallet: RPC error -', e.message);
  }
  
  // Check our launched tokens
  console.log('\n=== LAUNCHED TOKENS ===\n');
  const tokens = [
    { mint: 'EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1', symbol: 'EARNTEST' },
    { mint: '4hqoGYX7fNFnSYsHFJ6RosK24sUmpbLNj6BqDDkGhdpE', symbol: 'TEST' }
  ];
  
  for (const token of tokens) {
    console.log(`${token.symbol}: ${token.mint}`);
    console.log(`  Pump.fun: https://pump.fun/${token.mint}`);
    console.log(`  Solscan: https://solscan.io/token/${token.mint}?cluster=devnet`);
    console.log('');
  }
}

main().catch(console.error);
