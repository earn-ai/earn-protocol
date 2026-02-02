import { app, protocol } from './api';
import { PublicKey } from '@solana/web3.js';

const PORT = process.env.PORT || 3000;

// Demo mode: register a test token on startup
async function setupDemo() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   EARN PROTOCOL - Tokenomics-as-a-Service');
  console.log('   Turn any memecoin into a real economy');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Create a demo token registration
  if (process.env.DEMO_MODE === 'true') {
    console.log('📝 Registering demo token...');
    
    const demoMint = 'DemoTokenMint111111111111111111111111111111';
    const demoCreator = new PublicKey('EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ');

    try {
      await protocol.registerToken({
        tokenMint: demoMint,
        config: {
          feePercent: 2,        // 2% fee on trades
          earnCut: 10,          // 10% to Earn Protocol
          creatorCut: 20,       // 20% to creator
          buybackPercent: 50,   // 50% of remaining to buybacks
          stakingPercent: 50,   // 50% of remaining to stakers
        },
      }, demoCreator);

      // Simulate some trades
      console.log('');
      console.log('📊 Simulating trades...');
      
      for (let i = 0; i < 5; i++) {
        await protocol.processTradeAndCollectFees(
          demoMint,
          BigInt(1000000000), // 1 SOL equivalent
          i % 2 === 0 // alternate buy/sell
        );
      }

      // Simulate staking
      console.log('');
      console.log('📥 Simulating staking...');
      
      const staker = new PublicKey('11111111111111111111111111111111');
      await protocol.stake(demoMint, staker, BigInt(100000000));

      // Simulate more trades to accumulate rewards
      for (let i = 0; i < 3; i++) {
        await protocol.processTradeAndCollectFees(demoMint, BigInt(500000000), true);
      }

      console.log('');
      console.log('✅ Demo setup complete!');
    } catch (e) {
      console.log('Demo token already registered or error:', e);
    }
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Earn Protocol API listening on port ${PORT}`);
  console.log('');
  console.log('Available endpoints:');
  console.log('  GET  /health              - Health check');
  console.log('  GET  /earn/stats          - Protocol stats');
  console.log('  GET  /earn/tokens         - List all registered tokens');
  console.log('  GET  /earn/token/:mint    - Get token config and stats');
  console.log('  POST /earn/register       - Register a new token');
  console.log('  POST /earn/trade          - Process trade and collect fees');
  console.log('  GET  /earn/quote          - Get fee quote');
  console.log('  POST /earn/stake          - Stake tokens');
  console.log('  POST /earn/unstake        - Unstake tokens');
  console.log('  GET  /earn/rewards/:wallet - Get pending rewards');
  console.log('  POST /earn/claim          - Claim rewards');
  console.log('  GET  /earn/staking-stats/:mint - Staking pool stats');
  console.log('  GET  /earn/creator/:mint  - Creator dashboard');
  console.log('');

  await setupDemo();
});

export { app, protocol };
