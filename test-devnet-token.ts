import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import * as fs from 'fs';

async function main() {
  // Try different RPC endpoints
  const rpcs = [
    'https://api.devnet.solana.com',
    'https://devnet.helius-rpc.com/?api-key=1d8740dc-e5f4-421c-b823-e1bad1889eff',
  ];
  
  let connection: Connection | null = null;
  for (const rpc of rpcs) {
    try {
      const c = new Connection(rpc, 'confirmed');
      await c.getSlot();
      connection = c;
      console.log('🔗 Connected to:', rpc.split('?')[0]);
      break;
    } catch (e) {
      console.log('❌ Failed:', rpc.split('?')[0]);
    }
  }
  
  if (!connection) {
    console.log('Could not connect to any RPC');
    return;
  }
  
  const walletPath = '/home/node/.config/solana/test-wallet.json';
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  console.log('📂 Wallet:', wallet.publicKey.toBase58());
  
  let balance = await connection.getBalance(wallet.publicKey);
  console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
  
  if (balance < LAMPORTS_PER_SOL) {
    console.log('🪂 Requesting airdrop (attempt 1)...');
    for (let i = 0; i < 3; i++) {
      try {
        const sig = await connection.requestAirdrop(wallet.publicKey, LAMPORTS_PER_SOL);
        console.log('   Signature:', sig.slice(0, 20) + '...');
        const result = await connection.confirmTransaction(sig, 'confirmed');
        if (!result.value.err) {
          balance = await connection.getBalance(wallet.publicKey);
          console.log('✅ Airdrop success! Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
          break;
        }
      } catch (e: any) {
        console.log('   Attempt', i + 1, 'failed:', e.message?.slice(0, 50));
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  
  if (balance >= 0.01 * LAMPORTS_PER_SOL) {
    console.log('\n🪙 Creating TEST token...');
    const mint = await createMint(connection, wallet, wallet.publicKey, wallet.publicKey, 9);
    console.log('✅ Mint:', mint.toBase58());
    
    const ata = await getOrCreateAssociatedTokenAccount(connection, wallet, mint, wallet.publicKey);
    console.log('✅ ATA:', ata.address.toBase58());
    
    await mintTo(connection, wallet, mint, ata.address, wallet, 1_000_000_000_000_000n);
    console.log('✅ Minted 1M tokens');
    console.log('\n🎉 TEST token ready for Earn Protocol!');
    console.log('   Use this mint address:', mint.toBase58());
  }
}

main().catch(e => console.log('Error:', e.message));
