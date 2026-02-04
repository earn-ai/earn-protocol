import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import { PumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';

async function main() {
  console.log('🛒 BUYING TOKENS ON PUMP.FUN (DEVNET)\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const pumpSdk = new PumpSdk();
  
  // Load test wallet
  const testWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/test-wallet.json', 'utf-8'));
  const testWallet = Keypair.fromSecretKey(Uint8Array.from(testWalletData));
  
  console.log('Wallet:', testWallet.publicKey.toString());
  
  // Check balance
  let balance = await connection.getBalance(testWallet.publicKey);
  console.log('Balance:', (balance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  
  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.log('\n🪂 Requesting airdrop...');
    const sig = await connection.requestAirdrop(testWallet.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
    balance = await connection.getBalance(testWallet.publicKey);
    console.log('New balance:', (balance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  }
  
  // Token to buy
  const tokenMint = new PublicKey('EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1');
  console.log('\nToken:', tokenMint.toString());
  
  // Get bonding curve
  const bcPda = bondingCurvePda(tokenMint);
  const bondingCurve = Array.isArray(bcPda) ? bcPda[0] : bcPda;
  console.log('Bonding Curve:', bondingCurve.toString());
  
  // User's ATA for this token
  const userAta = getAssociatedTokenAddressSync(
    tokenMint,
    testWallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  console.log('User ATA:', userAta.toString());
  
  // Buy amount
  const buyAmountSol = 0.05; // 0.05 SOL
  const buyAmountLamports = buyAmountSol * LAMPORTS_PER_SOL;
  console.log(`\nBuying with ${buyAmountSol} SOL...`);
  
  try {
    // Create ATA if needed
    const ataIx = createAssociatedTokenAccountIdempotentInstruction(
      testWallet.publicKey,
      userAta,
      testWallet.publicKey,
      tokenMint,
      TOKEN_2022_PROGRAM_ID
    );
    
    // Build buy instructions using the SDK
    const buyInstructions = await pumpSdk.buyInstructions({
      mint: tokenMint,
      user: testWallet.publicKey,
      solAmount: BigInt(buyAmountLamports),
      slippageBps: 500, // 5% slippage
    });
    
    // Build transaction
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
    tx.add(ataIx);
    
    // Add all buy instructions
    for (const ix of buyInstructions) {
      tx.add(ix);
    }
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = testWallet.publicKey;
    tx.sign(testWallet);
    
    console.log('Sending transaction...');
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    console.log('TX:', sig);
    console.log('Confirming...');
    
    const confirmation = await connection.confirmTransaction({
      signature: sig,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    
    if (confirmation.value.err) {
      console.log('❌ Transaction failed:', JSON.stringify(confirmation.value.err));
    } else {
      console.log('✅ Buy successful!');
      console.log('Solscan:', `https://solscan.io/tx/${sig}?cluster=devnet`);
      
      // Check new balance
      const newBalance = await connection.getBalance(testWallet.publicKey);
      console.log('\nNew SOL balance:', (newBalance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
      console.log('SOL spent:', ((balance - newBalance) / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
    }
  } catch (e: any) {
    console.log('❌ Error:', e.message);
    if (e.logs) {
      console.log('Logs:', e.logs.slice(-5).join('\n'));
    }
  }
}

main().catch(console.error);
