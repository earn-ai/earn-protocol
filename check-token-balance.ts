import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import { Keypair } from '@solana/web3.js';

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  const testWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/test-wallet.json', 'utf-8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(testWalletData));
  
  const tokenMint = new PublicKey('EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1');
  
  const userAta = getAssociatedTokenAddressSync(
    tokenMint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  const tokenBalance = await connection.getTokenAccountBalance(userAta);
  console.log('Token balance:');
  console.log('  amount (raw):', tokenBalance.value.amount);
  console.log('  decimals:', tokenBalance.value.decimals);
  console.log('  uiAmount:', tokenBalance.value.uiAmount);
  console.log('  uiAmountString:', tokenBalance.value.uiAmountString);
}

main().catch(console.error);
