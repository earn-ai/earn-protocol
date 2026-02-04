import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { bondingCurvePda, creatorVaultPda } from '@pump-fun/pump-sdk';
import * as fs from 'fs';

// Try multiple RPCs
const RPC_ENDPOINTS = [
  'https://api.devnet.solana.com',
  'https://devnet.helius-rpc.com/?api-key=demo',
  'https://rpc.ankr.com/solana_devnet',
];

async function getWorkingConnection(): Promise<Connection> {
  for (const rpc of RPC_ENDPOINTS) {
    try {
      const conn = new Connection(rpc, 'confirmed');
      await conn.getSlot();
      console.log('✅ Connected to:', rpc);
      return conn;
    } catch {
      console.log('❌ Failed:', rpc);
    }
  }
  throw new Error('All RPCs unavailable');
}

async function main() {
  console.log('🧪 EARN PROTOCOL - FEE ANALYSIS\n');
  console.log('='.repeat(50));
  
  let connection: Connection;
  try {
    connection = await getWorkingConnection();
  } catch (e) {
    console.log('\n⚠️ All devnet RPCs unavailable. Proceeding with calculations only.\n');
    connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  }
  
  // Token we launched
  const tokenMint = new PublicKey('EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1');
  console.log('\n📊 TOKEN: EARNTEST');
  console.log('   Mint:', tokenMint.toString());
  
  // Get bonding curve PDA
  const bondingCurvePdaResult = bondingCurvePda(tokenMint);
  const bondingCurve = Array.isArray(bondingCurvePdaResult) ? bondingCurvePdaResult[0] : bondingCurvePdaResult;
  console.log('   Bonding Curve:', bondingCurve.toString());
  
  // === FEE CALCULATIONS ===
  console.log('\n' + '='.repeat(50));
  console.log('💸 FEE STRUCTURE ANALYSIS');
  console.log('='.repeat(50));
  
  console.log('\n📌 PUMP.FUN FEES (from their docs):');
  console.log('   • Trading fee: 1% total');
  console.log('   • Creator receives: 0.5% of each trade');
  console.log('   • Protocol receives: 0.5% of each trade');
  console.log('   • Our tokens: Earn wallet = creator');
  
  console.log('\n📌 EARN PROTOCOL TOKENOMICS (degen preset):');
  console.log('   • Total creator fee received: 0.5%');
  console.log('   • Split:');
  console.log('     ├─ Agent (token launcher): 40% of 0.5% = 0.20%');
  console.log('     ├─ Earn Protocol: 30% of 0.5% = 0.15%');
  console.log('     └─ Staking Pool: 30% of 0.5% = 0.15%');
  
  console.log('\n📌 EARNINGS PER TRANSACTION:');
  console.log('');
  
  const txAmounts = [0.01, 0.1, 0.5, 1, 5, 10];
  console.log('   Buy Amount │ Creator Fee │  Agent  │   Earn   │ Stakers');
  console.log('   ───────────┼─────────────┼─────────┼──────────┼─────────');
  
  for (const amount of txAmounts) {
    const creatorFee = amount * 0.005;
    const agent = creatorFee * 0.4;
    const earn = creatorFee * 0.3;
    const stakers = creatorFee * 0.3;
    
    console.log(`   ${amount.toFixed(2).padStart(9)} SOL │ ${creatorFee.toFixed(6).padStart(10)} │ ${agent.toFixed(6).padStart(7)} │ ${earn.toFixed(6).padStart(8)} │ ${stakers.toFixed(6)}`);
  }
  
  console.log('\n📌 DAILY EARNINGS PROJECTION:');
  console.log('');
  
  const dailyVolumes = [100, 500, 1000, 5000, 10000];
  console.log('   Daily Volume │ Creator Fee │   Agent   │    Earn    │  Stakers');
  console.log('   ─────────────┼─────────────┼───────────┼────────────┼───────────');
  
  for (const volume of dailyVolumes) {
    const creatorFee = volume * 0.005;
    const agent = creatorFee * 0.4;
    const earn = creatorFee * 0.3;
    const stakers = creatorFee * 0.3;
    
    console.log(`   ${volume.toString().padStart(11)} SOL │ ${creatorFee.toFixed(2).padStart(10)} │ ${agent.toFixed(2).padStart(9)} │ ${earn.toFixed(2).padStart(10)} │ ${stakers.toFixed(2).padStart(9)}`);
  }
  
  // Earn wallet creator vault
  console.log('\n' + '='.repeat(50));
  console.log('🏦 CREATOR VAULT (where fees accumulate)');
  console.log('='.repeat(50));
  
  const earnWalletData = JSON.parse(fs.readFileSync('/home/node/.config/solana/earn-wallet.json', 'utf-8'));
  const earnPubkey = new PublicKey(earnWalletData.public_address);
  
  const creatorVaultPdaResult = creatorVaultPda(earnPubkey);
  const creatorVault = Array.isArray(creatorVaultPdaResult) ? creatorVaultPdaResult[0] : creatorVaultPdaResult;
  
  console.log('\n   Earn Wallet:', earnPubkey.toString());
  console.log('   Creator Vault PDA:', creatorVault.toString());
  
  try {
    const vaultInfo = await connection.getAccountInfo(creatorVault);
    if (vaultInfo) {
      const vaultBalance = vaultInfo.lamports / LAMPORTS_PER_SOL;
      console.log('   Vault Balance:', vaultBalance.toFixed(6), 'SOL');
      
      if (vaultBalance > 0) {
        const agentShare = vaultBalance * 0.4;
        const earnShare = vaultBalance * 0.3;
        const stakersShare = vaultBalance * 0.3;
        console.log('\n   Pending distribution:');
        console.log(`     ├─ Agent: ${agentShare.toFixed(6)} SOL`);
        console.log(`     ├─ Earn: ${earnShare.toFixed(6)} SOL`);
        console.log(`     └─ Stakers: ${stakersShare.toFixed(6)} SOL`);
      }
    } else {
      console.log('   Vault: Not initialized (no trades yet)');
    }
  } catch (e: any) {
    console.log('   ⚠️ RPC unavailable, cannot check vault');
  }
  
  // Check bonding curve status
  console.log('\n' + '='.repeat(50));
  console.log('📈 BONDING CURVE STATUS');
  console.log('='.repeat(50));
  
  try {
    const bcInfo = await connection.getAccountInfo(bondingCurve);
    if (bcInfo) {
      console.log('\n   Status: ACTIVE');
      console.log('   SOL in curve:', (bcInfo.lamports / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
      console.log('   Token is tradeable on pump.fun!');
    } else {
      console.log('\n   Status: Not found');
      console.log('   Token may not have been created via pump.fun SDK');
    }
  } catch (e: any) {
    console.log('\n   ⚠️ RPC unavailable');
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('🔄 STAKING FLOW');
  console.log('='.repeat(50));
  
  console.log('\n   STAKE FLOW:');
  console.log('   1. User calls stake(amount) on earn-staking program');
  console.log('   2. Tokens transferred to pool vault');
  console.log('   3. StakeAccount PDA created/updated');
  console.log('   4. User starts earning proportional rewards');
  
  console.log('\n   UNSTAKE FLOW (with cooldown):');
  console.log('   1. User calls request_unstake(amount)');
  console.log('   2. Cooldown timer starts');
  console.log('   3. Wait cooldown_seconds');
  console.log('   4. User calls unstake(amount)');
  console.log('   5. Tokens returned + rewards claimed');
  
  console.log('\n   REWARD DISTRIBUTION:');
  console.log('   1. Crank calls claim on pump.fun creator_vault');
  console.log('   2. SOL received to Earn wallet');
  console.log('   3. Split per tokenomics (agent/earn/stakers)');
  console.log('   4. Staking portion → deposit_rewards()');
  console.log('   5. reward_per_token_stored updated');
  console.log('   6. Stakers claim anytime via claim_rewards()');
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 APY CALCULATION');
  console.log('='.repeat(50));
  
  // Example APY calculation
  console.log('\n   Example: Token with 1000 SOL daily volume');
  console.log('   Assumptions:');
  console.log('   - Total staked: 1,000,000 tokens');
  console.log('   - Token price: ~0.00001 SOL');
  console.log('   - Staked value: ~10 SOL');
  
  const dailyVolume = 1000;
  const dailyStakingReward = dailyVolume * 0.005 * 0.3; // 0.5% * 30%
  const stakedValue = 10; // SOL
  const dailyReturn = dailyStakingReward / stakedValue;
  const apy = dailyReturn * 365 * 100;
  
  console.log(`\n   Daily staking rewards: ${dailyStakingReward.toFixed(4)} SOL`);
  console.log(`   Staked value: ${stakedValue} SOL`);
  console.log(`   Daily return: ${(dailyReturn * 100).toFixed(2)}%`);
  console.log(`   APY: ${apy.toFixed(0)}%`);
  
  console.log('\n   ⚠️ APY varies with volume and staked amount');
  console.log('   Higher volume → higher rewards');
  console.log('   More stakers → lower individual APY');
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ ANALYSIS COMPLETE');
  console.log('='.repeat(50));
  
  console.log('\n📝 SUMMARY:');
  console.log('   • Fee collection: Automatic via pump.fun creator_vault');
  console.log('   • Distribution: Manual crank or scheduled');
  console.log('   • Staking: On-chain program (needs Anchor deploy)');
  console.log('   • Agent earnings: Sent directly to their wallet');
  console.log('');
}

main().catch(console.error);
