/**
 * Test Earn Protocol Flow on Devnet
 * 
 * Tests:
 * 1. API health check
 * 2. Token launch via /launch endpoint
 * 3. Token verification via /token/:mint
 * 4. Staking pool check via /stake/pool/:mint
 * 
 * Run: npx ts-node test-pumpfun-flow.ts
 */

const API_BASE = process.env.API_URL || 'http://localhost:3000';

interface LaunchResponse {
  success: boolean;
  requestId?: string;
  launchNumber?: number;
  mint?: string;
  name?: string;
  symbol?: string;
  pumpfun?: string;
  solscan?: string;
  staking?: string;
  agentWallet?: string;
  tokenomics?: string;
  feeSplit?: {
    agent: string;
    earn: string;
    stakers: string;
  };
  txSignature?: string;
  network?: string;
  error?: string;
}

async function main() {
  console.log('🧪 Testing Earn Protocol on Devnet\n');
  console.log(`API: ${API_BASE}\n`);
  console.log('━'.repeat(50));

  // Step 1: Health check
  console.log('\n📋 STEP 1: Health Check\n');
  
  try {
    const healthRes = await fetch(`${API_BASE}/health`);
    const health = await healthRes.json() as any;
    
    if (health.status !== 'ok') {
      console.log('❌ API health check failed');
      return;
    }
    
    console.log('✅ API Status:', health.status);
    console.log('   Network:', health.network);
    console.log('   Wallet:', health.wallet);
    console.log('   Tokens launched:', health.tokensLaunched);
    console.log('   IPFS:', health.ipfsEnabled ? 'enabled' : 'disabled');
  } catch (e: any) {
    console.log('❌ Cannot reach API:', e.message);
    return;
  }

  // Step 2: Test launch (dry run - will fail without SOL but validates request)
  console.log('\n━'.repeat(50));
  console.log('\n🚀 STEP 2: Test Token Launch\n');
  
  const testWallet = 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ';
  const testToken = {
    name: `Test Token ${Date.now()}`,
    ticker: 'TEST',
    image: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
    tokenomics: 'degen',
    agentWallet: testWallet,
    description: 'Automated test token for Earn Protocol',
  };
  
  console.log('Request:', JSON.stringify(testToken, null, 2));
  
  try {
    const launchRes = await fetch(`${API_BASE}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testToken),
    });
    
    const launch = await launchRes.json() as LaunchResponse;
    
    if (launch.success) {
      console.log('\n✅ Token launched successfully!');
      console.log('   Mint:', launch.mint);
      console.log('   Launch #:', launch.launchNumber);
      console.log('   Network:', launch.network);
      console.log('   Pump.fun:', launch.pumpfun);
      console.log('   Fee split:', JSON.stringify(launch.feeSplit));
      console.log('   TX:', launch.txSignature);
      
      // Step 3: Verify token
      console.log('\n━'.repeat(50));
      console.log('\n🔍 STEP 3: Verify Token Config\n');
      
      const tokenRes = await fetch(`${API_BASE}/token/${launch.mint}`);
      const tokenData = await tokenRes.json() as any;
      
      if (tokenData.success) {
        console.log('✅ Token verified:');
        console.log('   Name:', tokenData.name);
        console.log('   Symbol:', tokenData.symbol);
        console.log('   Tokenomics:', tokenData.tokenomics);
        console.log('   Agent cut:', tokenData.agentCutBps / 100 + '%');
        console.log('   Earn cut:', tokenData.earnCutBps / 100 + '%');
        console.log('   Staking cut:', tokenData.stakingCutBps / 100 + '%');
      }
      
      // Step 4: Check staking pool
      console.log('\n━'.repeat(50));
      console.log('\n💰 STEP 4: Check Staking Pool\n');
      
      const poolRes = await fetch(`${API_BASE}/stake/pool/${launch.mint}`);
      const pool = await poolRes.json() as any;
      
      if (pool.success) {
        console.log('✅ Staking pool ready:');
        console.log('   APY:', pool.stats.apy);
        console.log('   Total staked:', pool.pool.totalStaked);
        console.log('   Staker count:', pool.pool.stakerCount);
        console.log('   Staking URL:', pool.stakingUrl);
      }
      
    } else {
      console.log('\n⚠️ Launch failed (expected without devnet SOL):');
      console.log('   Error:', launch.error);
      console.log('   Request ID:', launch.requestId);
      console.log('\n   This is normal if the Earn wallet has no devnet SOL.');
      console.log('   To test: airdrop SOL to', testWallet);
    }
  } catch (e: any) {
    console.log('❌ Launch request failed:', e.message);
  }

  // Step 5: Check stats
  console.log('\n━'.repeat(50));
  console.log('\n📊 STEP 5: Global Stats\n');
  
  try {
    const statsRes = await fetch(`${API_BASE}/stats`);
    const stats = await statsRes.json() as any;
    
    if (stats.success) {
      console.log('✅ Protocol stats:');
      console.log('   Total launches:', stats.totalLaunches);
      console.log('   Total agents:', stats.totalAgents);
      console.log('   Network:', stats.network);
      console.log('   By tokenomics:', JSON.stringify(stats.launchesByTokenomics));
    }
  } catch (e: any) {
    console.log('❌ Stats failed:', e.message);
  }

  console.log('\n━'.repeat(50));
  console.log('\n✅ Test complete!\n');
}

main().catch(e => console.error('Error:', e.message));
