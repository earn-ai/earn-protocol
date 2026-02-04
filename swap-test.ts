import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import { buyQuoteInput, poolPda } from '@pump-fun/pump-swap-sdk';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_2022_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import * as fs from 'fs';

async function main() {
  console.log('🔄 TESTING SWAP ON PUMP.FUN AMM (DEVNET)\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Load test wallet
  const testWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/test-wallet.json', 'utf-8'));
  const testWallet = Keypair.fromSecretKey(Uint8Array.from(testWalletData));
  
  console.log('Wallet:', testWallet.publicKey.toString());
  
  // Check balance
  let balance = await connection.getBalance(testWallet.publicKey);
  console.log('Balance:', (balance / LAMPORTS_PER_SOL).toFixed(4), 'SOL\n');
  
  // Token to buy
  const tokenMint = new PublicKey('EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1');
  console.log('Token Mint:', tokenMint.toString());
  
  // Get pool PDA (for pump AMM)
  const poolPdaResult = poolPda(tokenMint, NATIVE_MINT);
  const pool = Array.isArray(poolPdaResult) ? poolPdaResult[0] : poolPdaResult;
  console.log('Pool PDA:', pool.toString());
  
  // Check if pool exists
  const poolInfo = await connection.getAccountInfo(pool);
  if (!poolInfo) {
    console.log('\n⚠️ AMM pool not found.');
    console.log('   The token might still be on bonding curve (not graduated to AMM).');
    console.log('   Pump.fun tokens start on bonding curve and graduate to AMM after reaching threshold.');
    console.log('\n   For bonding curve trades, use pump.fun UI directly:');
    console.log(`   https://pump.fun/${tokenMint.toString()}`);
    return;
  }
  
  console.log('Pool exists! Size:', poolInfo.data.length, 'bytes');
  
  // Build buy transaction
  const buyAmountSol = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
  
  console.log(`\nBuying tokens with ${buyAmountSol / LAMPORTS_PER_SOL} SOL...`);
  
  // This would use the AMM to buy
  // ... (AMM specific logic)
}

main().catch(console.error);
