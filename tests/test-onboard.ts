/**
 * Test script for ONE-CLICK ONBOARDING
 * 
 * Usage: npx ts-node tests/test-onboard.ts
 */

const API_BASE = process.env.API_URL || 'http://localhost:3000';

// Example token mints for testing
const TEST_TOKENS = {
  // Real token on devnet/mainnet
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  // Test mint (may not exist)
  FAKE: 'FAKExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx111111',
};

async function testOnboard() {
  console.log('🚀 Testing ONE-CLICK ONBOARDING\n');
  console.log(`API: ${API_BASE}\n`);

  // Test 1: Onboard with auto intent
  console.log('📋 Test 1: Onboard with auto intent');
  console.log('-----------------------------------');
  
  try {
    const response = await fetch(`${API_BASE}/earn/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenMint: TEST_TOKENS.BONK,
        intent: 'auto',
      }),
    });

    const result = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n');

  // Test 2: Onboard with specific intent
  console.log('📋 Test 2: Onboard with degen intent');
  console.log('------------------------------------');
  
  try {
    const response = await fetch(`${API_BASE}/earn/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenMint: TEST_TOKENS.BONK,
        creatorWallet: 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ',
        intent: 'degen',
      }),
    });

    const result = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n');

  // Test 3: Try to onboard non-existent token
  console.log('📋 Test 3: Onboard non-existent token');
  console.log('-------------------------------------');
  
  try {
    const response = await fetch(`${API_BASE}/earn/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenMint: TEST_TOKENS.FAKE,
        intent: 'community',
      }),
    });

    const result = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n');

  // Test 4: Check idempotency (same request twice)
  console.log('📋 Test 4: Idempotency test');
  console.log('---------------------------');
  
  const idempotencyKey = `test-${Date.now()}`;
  
  try {
    // First request
    const response1 = await fetch(`${API_BASE}/earn/onboard`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        tokenMint: TEST_TOKENS.BONK,
        intent: 'creator',
      }),
    });

    const result1 = await response1.json();
    console.log('First request status:', response1.status);

    // Second request (same idempotency key)
    const response2 = await fetch(`${API_BASE}/earn/onboard`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        tokenMint: TEST_TOKENS.BONK,
        intent: 'creator',
      }),
    });

    const result2 = await response2.json();
    console.log('Second request status:', response2.status);
    console.log('Same response?', JSON.stringify(result1) === JSON.stringify(result2) ? 'YES ✅' : 'NO ❌');
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n✅ Tests complete!');
}

// Run tests
testOnboard().catch(console.error);
