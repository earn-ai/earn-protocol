import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const PROGRAM_ID = new PublicKey('E7JsJuQWGaEYC34AkEv8dcmkKUxR1KqUnje17mNCuTiY');
const EARN_WALLET = new PublicKey('EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ');

async function main() {
  // Load keypair
  const keypairPath = '/tmp/earn-keypair.json';
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  console.log('Payer:', payer.publicKey.toBase58());
  
  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Derive GlobalConfig PDA
  const [globalConfigPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('global-config')],
    PROGRAM_ID
  );
  
  console.log('GlobalConfig PDA:', globalConfigPda.toBase58());
  console.log('Bump:', bump);
  
  // Check if already initialized
  const existingAccount = await connection.getAccountInfo(globalConfigPda);
  if (existingAccount) {
    console.log('GlobalConfig already exists! Size:', existingAccount.data.length);
    return;
  }
  
  // Build initialize instruction
  // Anchor discriminator for "initialize" = first 8 bytes of sha256("global:initialize")
  // Actually for Anchor it's sha256("global:initialize")[0..8]
  // Let's use the standard Anchor approach: sha256("global:initialize")
  const crypto = await import('crypto');
  const discriminator = crypto.createHash('sha256')
    .update('global:initialize')
    .digest()
    .slice(0, 8);
  
  // Instruction data: discriminator (8 bytes) + bump (1 byte)
  const data = Buffer.alloc(9);
  discriminator.copy(data, 0);
  data.writeUInt8(bump, 8);
  
  const initializeIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: globalConfigPda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: EARN_WALLET, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  
  // Send transaction
  const tx = new Transaction().add(initializeIx);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  
  console.log('Sending initialize transaction...');
  
  try {
    const sig = await connection.sendRawTransaction(tx.serialize());
    console.log('Transaction sent:', sig);
    
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('✅ GlobalConfig initialized!');
    
    // Verify
    const account = await connection.getAccountInfo(globalConfigPda);
    console.log('Account size:', account?.data.length);
  } catch (err: any) {
    console.error('Error:', err.message);
    if (err.logs) {
      console.error('Logs:', err.logs);
    }
  }
}

main().catch(console.error);
