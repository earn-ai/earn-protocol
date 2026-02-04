/**
 * Programmatic selling on Pump.fun bonding curve
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, ComputeBudgetProgram, AccountInfo } from '@solana/web3.js';
import { PumpSdk, bondingCurvePda, GLOBAL_PDA, creatorVaultPda } from '@pump-fun/pump-sdk';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';

async function main() {
  console.log('🔧 PROGRAMMATIC SELL TEST\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const pumpSdk = new PumpSdk();
  
  const testWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/test-wallet.json', 'utf-8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(testWalletData));
  console.log('Wallet:', wallet.publicKey.toString());
  
  const tokenMint = new PublicKey('EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1');
  
  const userAta = getAssociatedTokenAddressSync(
    tokenMint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  // Get token balance with decimals
  const tokenBalance = await connection.getTokenAccountBalance(userAta);
  const rawBalance = BigInt(tokenBalance.value.amount);
  const decimals = tokenBalance.value.decimals;
  console.log('Token balance:', tokenBalance.value.uiAmountString, '(raw:', rawBalance.toString(), ')');
  console.log('Decimals:', decimals);
  
  if (rawBalance < BigInt(100 * Math.pow(10, decimals))) {
    console.log('Not enough tokens to sell');
    return;
  }
  
  // Fetch state
  const globalInfo = await connection.getAccountInfo(GLOBAL_PDA) as AccountInfo<Buffer>;
  const global = pumpSdk.decodeGlobal(globalInfo);
  
  const bcPda = bondingCurvePda(tokenMint);
  const bondingCurve = Array.isArray(bcPda) ? bcPda[0] : bcPda;
  const bcInfo = await connection.getAccountInfo(bondingCurve) as AccountInfo<Buffer>;
  const bc = pumpSdk.decodeBondingCurve(bcInfo);
  
  // Sell 500 tokens (with correct decimals)
  const sellTokens = 500;
  const sellAmount = new BN(sellTokens * Math.pow(10, decimals));
  console.log('\nSelling:', sellTokens, 'tokens');
  console.log('Sell amount (raw):', sellAmount.toString());
  
  // Check creator vault before
  const earnWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/earn-wallet.json', 'utf-8'));
  const earnPubkey = new PublicKey(earnWalletData.public_address);
  const vaultPda = creatorVaultPda(earnPubkey);
  const creatorVault = Array.isArray(vaultPda) ? vaultPda[0] : vaultPda;
  
  const vaultBefore = await connection.getAccountInfo(creatorVault);
  const vaultBalanceBefore = vaultBefore ? vaultBefore.lamports / LAMPORTS_PER_SOL : 0;
  console.log('Creator vault before:', vaultBalanceBefore.toFixed(6), 'SOL');
  
  // Build sell instructions
  const sellIxs = await pumpSdk.sellInstructions({
    global,
    bondingCurve: bc,
    bondingCurveAccountInfo: bcInfo,
    mint: tokenMint,
    user: wallet.publicKey,
    amount: sellAmount,
    solAmount: new BN(1),
    slippage: 0.5,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    mayhemMode: true,
  });
  
  console.log('Got', sellIxs.length, 'sell instructions');
  
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));
  
  for (const ix of sellIxs) {
    tx.add(ix);
  }
  
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  tx.sign(wallet);
  
  console.log('\nSending transaction...');
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });
  
  console.log('TX:', sig);
  console.log('Solscan:', `https://solscan.io/tx/${sig}?cluster=devnet`);
  
  const confirmation = await connection.confirmTransaction({
    signature: sig,
    blockhash,
    lastValidBlockHeight,
  }, 'confirmed');
  
  if (confirmation.value.err) {
    console.log('❌ Failed:', JSON.stringify(confirmation.value.err));
  } else {
    console.log('✅ SELL SUCCESS!');
    
    await new Promise(r => setTimeout(r, 2000));
    const vaultAfter = await connection.getAccountInfo(creatorVault);
    const vaultBalanceAfter = vaultAfter ? vaultAfter.lamports / LAMPORTS_PER_SOL : 0;
    console.log('\nCreator vault after:', vaultBalanceAfter.toFixed(6), 'SOL');
    console.log('Fee earned from sell:', (vaultBalanceAfter - vaultBalanceBefore).toFixed(6), 'SOL');
    
    const newTokenBalance = await connection.getTokenAccountBalance(userAta);
    console.log('Remaining tokens:', newTokenBalance.value.uiAmountString);
  }
}

main().catch(e => console.error('Error:', e.message));
