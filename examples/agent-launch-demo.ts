/**
 * AGENT TOKEN LAUNCH DEMO
 * 
 * This script demonstrates an AI agent launching a token with 
 * Earn Protocol tokenomics - end to end.
 * 
 * Run: npx ts-node examples/agent-launch-demo.ts
 */

const EARN_API = 'https://earn-protocol.onrender.com';

// Demo configuration
const DEMO_CONFIG = {
  // Use a real token mint for actual testing, or this placeholder for demo
  tokenMint: process.env.TOKEN_MINT || 'DemoToken111111111111111111111111111111111',
  creatorWallet: process.env.CREATOR_WALLET || 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ',
  template: 'community' as const,
};

interface RegisterResponse {
  success: boolean;
  operationId: string;
  tokenMint: string;
  creator: string;
  feePercent: number;
  earnCut: number;
  creatorCut: number;
  buybackPercent: number;
  stakingPercent: number;
  template: string;
}

interface TokenStats {
  tokenMint: string;
  fees: {
    totalCollected: string;
    earnEarnings: string;
    creatorEarnings: string;
  };
  buybacks: {
    totalExecuted: string;
    treasuryBalance: string;
  };
  staking: {
    totalStaked: string;
    totalRewardsDistributed: string;
    stakerCount: number;
  };
  config: {
    feePercent: number;
    earnCut: number;
    creatorCut: number;
    buybackPercent: number;
    stakingPercent: number;
  };
}

interface SwapQuote {
  inputAmount: number;
  outputAmount: number;
  feeAmount: number;
  feeSplits: {
    protocol: number;
    creator: number;
    buyback: number;
    stakers: number;
  };
  priceImpact: number;
}

async function main() {
  console.log('\n🤖 AGENT TOKEN LAUNCH DEMO\n');
  console.log('=' .repeat(50));

  // Step 1: Check available templates
  console.log('\n📋 Step 1: Fetching available tokenomics templates...\n');
  
  const templatesRes = await fetch(`${EARN_API}/earn/templates`);
  const templates = await templatesRes.json() as { templates: any[] };
  
  console.log('Available templates:');
  for (const t of templates.templates) {
    console.log(`\n  ${t.name.toUpperCase()}`);
    console.log(`  └─ ${t.description}`);
    console.log(`  └─ Fee: ${t.readable.fee}, Staking: ${t.readable.stakingCut}, Buyback: ${t.readable.buybackCut}`);
  }

  // Step 2: Register token with Earn Protocol
  console.log('\n\n📝 Step 2: Registering token with Earn Protocol...\n');
  console.log(`  Token: ${DEMO_CONFIG.tokenMint}`);
  console.log(`  Creator: ${DEMO_CONFIG.creatorWallet}`);
  console.log(`  Template: ${DEMO_CONFIG.template}`);
  
  const registerRes = await fetch(`${EARN_API}/earn/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-creator-wallet': DEMO_CONFIG.creatorWallet,
      'x-idempotency-key': `demo-${DEMO_CONFIG.tokenMint}-${Date.now()}`,
    },
    body: JSON.stringify({
      tokenMint: DEMO_CONFIG.tokenMint,
      template: DEMO_CONFIG.template,
    }),
  });
  
  const registration = await registerRes.json() as RegisterResponse;
  
  if (registration.success) {
    console.log('\n  ✅ Registration successful!\n');
    console.log('  Token Configuration:');
    console.log(`  ├─ Fee Rate: ${registration.feePercent}%`);
    console.log(`  ├─ Earn Cut: ${registration.earnCut}%`);
    console.log(`  ├─ Creator Cut: ${registration.creatorCut}%`);
    console.log(`  ├─ Buyback: ${registration.buybackPercent}%`);
    console.log(`  └─ Staking: ${registration.stakingPercent}%`);
  } else {
    console.log('  ⚠️ Registration response:', registration);
  }

  // Step 3: Simulate what happens when trades occur
  console.log('\n\n💱 Step 3: Simulating fee distribution on trades...\n');
  
  const tradeAmounts = [100, 1000, 10000]; // In tokens
  
  for (const amount of tradeAmounts) {
    const feePercent = registration.feePercent || 2;
    const totalFee = amount * (feePercent / 100);
    
    const earnAmount = totalFee * (registration.earnCut / 100);
    const creatorAmount = totalFee * (registration.creatorCut / 100);
    const buybackAmount = totalFee * (registration.buybackPercent / 100);
    const stakingAmount = totalFee * (registration.stakingPercent / 100);
    
    console.log(`  Trade: ${amount} tokens`);
    console.log(`  ├─ Total Fee: ${totalFee.toFixed(2)} tokens`);
    console.log(`  ├─ → Earn Protocol: ${earnAmount.toFixed(2)}`);
    console.log(`  ├─ → Creator: ${creatorAmount.toFixed(2)}`);
    console.log(`  ├─ → Buyback Pool: ${buybackAmount.toFixed(2)}`);
    console.log(`  └─ → Staking Rewards: ${stakingAmount.toFixed(2)}`);
    console.log('');
  }

  // Step 4: Show swap quote endpoint
  console.log('\n📊 Step 4: Getting swap quote with fee preview...\n');
  
  try {
    const quoteRes = await fetch(
      `${EARN_API}/earn/swap/quote?` + new URLSearchParams({
        tokenMint: DEMO_CONFIG.tokenMint,
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: DEMO_CONFIG.tokenMint,
        amount: '1000000000', // 1 SOL
        userPublicKey: DEMO_CONFIG.creatorWallet,
      })
    );
    
    const quote = await quoteRes.json() as { quote?: SwapQuote; error?: string };
    
    if (quote.quote) {
      console.log('  Swap: 1 SOL → Token');
      console.log(`  ├─ Output (before fee): ~${(quote.quote.outputAmount + quote.quote.feeAmount).toLocaleString()}`);
      console.log(`  ├─ Fee: ${quote.quote.feeAmount.toLocaleString()}`);
      console.log(`  ├─ Output (after fee): ${quote.quote.outputAmount.toLocaleString()}`);
      console.log('  └─ Fee Distribution:');
      console.log(`      ├─ Protocol: ${quote.quote.feeSplits.protocol}`);
      console.log(`      ├─ Creator: ${quote.quote.feeSplits.creator}`);
      console.log(`      ├─ Buyback: ${quote.quote.feeSplits.buyback}`);
      console.log(`      └─ Stakers: ${quote.quote.feeSplits.stakers}`);
    } else {
      console.log('  ⚠️ Quote unavailable (token may not have liquidity yet)');
      console.log('  Response:', JSON.stringify(quote, null, 2));
    }
  } catch (e) {
    console.log('  ⚠️ Could not fetch quote:', e);
  }

  // Step 5: Show monitoring capabilities
  console.log('\n\n📈 Step 5: Agent monitoring capabilities...\n');
  
  console.log('  Endpoints for programmatic monitoring:\n');
  
  console.log('  GET /earn/token/{mint}/stats');
  console.log('  └─ Returns: fees collected, staking stats, buyback history\n');
  
  console.log('  GET /earn/stake/{mint}/{wallet}');
  console.log('  └─ Returns: staked amount, pending rewards, stake timestamp\n');
  
  console.log('  GET /earn/rewards/{mint}/{wallet}');
  console.log('  └─ Returns: pending rewards for a specific wallet\n');
  
  console.log('  GET /earn/leaderboard');
  console.log('  └─ Returns: top tokens by fees, volume, staking\n');

  // Step 6: Show what this enables vs raw pump.fun
  console.log('\n🎯 Step 6: What Earn Protocol enables vs raw pump.fun\n');
  
  console.log('  ┌─────────────────────┬────────────┬────────────────┐');
  console.log('  │ Capability          │ Pump.fun   │ Earn Protocol  │');
  console.log('  ├─────────────────────┼────────────┼────────────────┤');
  console.log('  │ Token trading       │     ✅     │       ✅       │');
  console.log('  │ Automatic fees      │     ❌     │       ✅       │');
  console.log('  │ Staking rewards     │     ❌     │       ✅       │');
  console.log('  │ Buyback mechanism   │     ❌     │       ✅       │');
  console.log('  │ Creator revenue     │     ❌     │       ✅       │');
  console.log('  │ Verifiable on-chain │     ❌     │       ✅       │');
  console.log('  └─────────────────────┴────────────┴────────────────┘');

  // Summary
  console.log('\n\n' + '=' .repeat(50));
  console.log('\n✅ DEMO COMPLETE\n');
  console.log('Your token now has:');
  console.log('  • Automatic 2% fee on all trades');
  console.log('  • 50% of fees → staking rewards for holders');
  console.log('  • 20% of fees → buybacks (price support)');
  console.log('  • 20% of fees → your wallet (creator revenue)');
  console.log('  • 10% of fees → Earn Protocol');
  console.log('\nAnnounce to your community:');
  console.log(`  "🚀 $TOKEN now has REAL tokenomics via @EarnProtocol!`);
  console.log(`   Stake to earn, fees support price. Verifiable on-chain."`);
  console.log('\n');
}

main().catch(console.error);
