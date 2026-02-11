import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction, TOKEN_2022_PROGRAM_ID, getMint, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import * as fs from 'fs';
import bs58 from 'bs58';

const RPC = 'https://api.mainnet-beta.solana.com';
const EARN_MINT = new PublicKey('87WkKqpXkcGixt7WUxEHQxFfr2BU7eU1GHt5fKoSnCdd');

// Load wallet from JSON with private_key field
const walletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/earn-wallet.json', 'utf-8'));
const EARN_WALLET = Keypair.fromSecretKey(bs58.decode(walletData.private_key));

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  
  console.log('Earn wallet:', EARN_WALLET.publicKey.toString());
  
  // Create test wallet
  const testWallet = Keypair.generate();
  console.log('Test wallet:', testWallet.publicKey.toString());
  
  // Get ATAs
  const earnAta = getAssociatedTokenAddressSync(EARN_MINT, EARN_WALLET.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const testAta = getAssociatedTokenAddressSync(EARN_MINT, testWallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  
  // Get mint info for decimals
  const mintInfo = await getMint(connection, EARN_MINT, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const decimals = mintInfo.decimals;
  
  // Amount to stake: 100k tokens
  const amount = BigInt(100_000 * 10 ** decimals);
  
  // Step 1: Fund test wallet with SOL and transfer EARN to it
  console.log('Step 1: Funding test wallet with SOL + 100k EARN...');
  const tx1 = new Transaction();
  tx1.add(SystemProgram.transfer({
    fromPubkey: EARN_WALLET.publicKey,
    toPubkey: testWallet.publicKey,
    lamports: 5000000,
  }));
  tx1.add(createAssociatedTokenAccountIdempotentInstruction(
    EARN_WALLET.publicKey,
    testAta,
    testWallet.publicKey,
    EARN_MINT,
    TOKEN_2022_PROGRAM_ID
  ));
  tx1.add(createTransferCheckedInstruction(
    earnAta,
    EARN_MINT,
    testAta,
    EARN_WALLET.publicKey,
    amount,
    decimals,
    [],
    TOKEN_2022_PROGRAM_ID
  ));
  
  const sig1 = await sendAndConfirmTransaction(connection, tx1, [EARN_WALLET]);
  console.log('Funded test wallet:', sig1);
  
  // Step 2: Stake (transfer from test wallet to pool/earn wallet)
  console.log('Step 2: Staking 100k EARN (transfer to pool wallet)...');
  const tx2 = new Transaction();
  tx2.add(createTransferCheckedInstruction(
    testAta,
    EARN_MINT,
    earnAta,
    testWallet.publicKey,
    amount,
    decimals,
    [],
    TOKEN_2022_PROGRAM_ID
  ));
  
  const sig2 = await sendAndConfirmTransaction(connection, tx2, [testWallet]);
  console.log('Stake tx:', sig2);
  console.log('');
  console.log('=== API CALL DATA ===');
  console.log('userWallet:', testWallet.publicKey.toString());
  console.log('tokenMint:', EARN_MINT.toString());
  console.log('txSignature:', sig2);
}

main().catch(console.error);
