/**
 * Programmatic buying on Pump.fun bonding curve
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, ComputeBudgetProgram, AccountInfo } from '@solana/web3.js';
import { PumpSdk, bondingCurvePda, GLOBAL_PDA } from '@pump-fun/pump-sdk';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';

async function main() {
  console.log('🔧 PROGRAMMATIC BUY TEST\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const pumpSdk = new PumpSdk();
  
  // Load wallet
  const testWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/test-wallet.json', 'utf-8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(testWalletData));
  console.log('Wallet:', wallet.publicKey.toString());
  
  const balance = await connection.getBalance(wallet.publicKey);
  console.log('Balance:', (balance / LAMPORTS_PER_SOL).toFixed(4), 'SOL\n');
  
  // Token
  const tokenMint = new PublicKey('EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1');
  console.log('Token:', tokenMint.toString());
  
  // Get PDAs
  const bcPda = bondingCurvePda(tokenMint);
  const bondingCurve = Array.isArray(bcPda) ? bcPda[0] : bcPda;
  console.log('Bonding Curve:', bondingCurve.toString());
  
  // Fetch account state
  console.log('\nFetching account state...');
  
  const globalInfo = await connection.getAccountInfo(GLOBAL_PDA) as AccountInfo<Buffer>;
  if (!globalInfo) throw new Error('Global account not found');
  const global = pumpSdk.decodeGlobal(globalInfo);
  console.log('✅ Global state loaded');
  
  const bcInfo = await connection.getAccountInfo(bondingCurve) as AccountInfo<Buffer>;
  if (!bcInfo) throw new Error('Bonding curve not found');
  const bc = pumpSdk.decodeBondingCurve(bcInfo);
  console.log('✅ Bonding curve loaded');
  console.log('   Virtual SOL:', bc.virtualSolReserves.toString());
  console.log('   Virtual Token:', bc.virtualTokenReserves.toString());
  
  // User's ATA
  const userAta = getAssociatedTokenAddressSync(
    tokenMint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  const ataInfo = await connection.getAccountInfo(userAta) as AccountInfo<Buffer> | null;
  console.log('User ATA:', userAta.toString(), ataInfo ? '(exists)' : '(needs creation)');
  
  // Buy amount - use BN instead of BigInt
  const tokenAmount = new BN(1_000_000_000); // 1 token
  const maxSolAmount = new BN(0.05 * LAMPORTS_PER_SOL);
  console.log('\nBuying tokens...');
  console.log('Token amount:', tokenAmount.toString());
  console.log('Max SOL:', maxSolAmount.toNumber() / LAMPORTS_PER_SOL);
  
  // Build buy instructions
  console.log('\nBuilding buy instructions...');
  
  const buyIxs = await pumpSdk.buyInstructions({
    global,
    bondingCurve: bc,
    bondingCurveAccountInfo: bcInfo,
    associatedUserAccountInfo: ataInfo,
    mint: tokenMint,
    user: wallet.publicKey,
    amount: tokenAmount,
    solAmount: maxSolAmount,
    slippage: 0.5,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  
  console.log('✅ Got', buyIxs.length, 'instructions');
  
  // Build transaction
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));
  
  if (!ataInfo) {
    console.log('Adding ATA creation...');
    tx.add(createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey,
      userAta,
      wallet.publicKey,
      tokenMint,
      TOKEN_2022_PROGRAM_ID
    ));
  }
  
  for (const ix of buyIxs) {
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
  
  console.log('\nConfirming...');
  const confirmation = await connection.confirmTransaction({
    signature: sig,
    blockhash,
    lastValidBlockHeight,
  }, 'confirmed');
  
  if (confirmation.value.err) {
    console.log('❌ Failed:', JSON.stringify(confirmation.value.err));
    const txDetails = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
    if (txDetails?.meta?.logMessages) {
      console.log('\nLogs:');
      txDetails.meta.logMessages.slice(-15).forEach(log => console.log('  ', log));
    }
  } else {
    console.log('✅ BUY SUCCESS!');
    
    const newSolBalance = await connection.getBalance(wallet.publicKey);
    console.log('\nNew SOL balance:', (newSolBalance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
    console.log('SOL spent:', ((balance - newSolBalance) / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
    
    // Wait a moment then check token balance
    await new Promise(r => setTimeout(r, 2000));
    try {
      const tokenAccount = await connection.getTokenAccountBalance(userAta);
      console.log('Tokens received:', tokenAccount.value.uiAmountString);
    } catch (e) {
      console.log('Token balance check failed');
    }
    
    // Check if creator vault now has fees
    console.log('\n--- Checking fees ---');
    const { creatorVaultPda } = await import('@pump-fun/pump-sdk');
    const earnWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/earn-wallet.json', 'utf-8'));
    const earnPubkey = new PublicKey(earnWalletData.public_address);
    const vaultPda = creatorVaultPda(earnPubkey);
    const creatorVault = Array.isArray(vaultPda) ? vaultPda[0] : vaultPda;
    
    const vaultInfo = await connection.getAccountInfo(creatorVault);
    if (vaultInfo) {
      console.log('Creator vault balance:', (vaultInfo.lamports / LAMPORTS_PER_SOL).toFixed(6), 'SOL');
      console.log('✅ FEES ARE ACCUMULATING!');
    } else {
      console.log('Creator vault not yet initialized');
    }
  }
}

main().catch(e => {
  console.error('Error:', e.message);
});
