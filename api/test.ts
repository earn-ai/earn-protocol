/**
 * API Integration Tests
 * 
 * Run: npx ts-node api/test.ts
 * 
 * Tests all API endpoints against a running server.
 * Start server first: npx ts-node api/server.ts
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`✅ ${name}`);
  } catch (e: any) {
    results.push({ name, passed: false, error: e.message, duration: Date.now() - start });
    console.log(`❌ ${name}: ${e.message}`);
  }
}

async function fetchJson(path: string, options?: RequestInit): Promise<{ success?: boolean; error?: string; [key: string]: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  return res.json();
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ============ TESTS ============

async function runTests() {
  console.log(`\n🧪 Testing API at ${API_URL}\n`);
  console.log('─'.repeat(50));

  // Health check
  await test('GET /health returns ok', async () => {
    const res = await fetchJson('/health');
    assert(res.status === 'ok', `Expected status ok, got ${res.status}`);
    assert(!!res.wallet, 'Missing wallet in response');
  });

  // Skill.md
  await test('GET /skill.md returns markdown', async () => {
    const res = await fetch(`${API_URL}/skill.md`);
    const text = await res.text();
    assert(text.includes('# Earn Protocol'), 'Missing expected content');
    assert(text.includes('curl'), 'Missing curl example');
  });

  // Root returns skill.md
  await test('GET / returns skill.md', async () => {
    const res = await fetch(`${API_URL}/`);
    const text = await res.text();
    assert(text.includes('# Earn Protocol'), 'Root should return skill.md');
  });

  // Stats endpoint
  await test('GET /stats returns statistics', async () => {
    const res = await fetchJson('/stats');
    assert(res.success === true, 'Expected success true');
    assert(typeof res.totalLaunches === 'number', 'Missing totalLaunches');
    assert(!!res.earnWallet, 'Missing earnWallet');
  });

  // Tokenomics endpoint
  await test('GET /tokenomics returns presets', async () => {
    const res = await fetchJson('/tokenomics');
    assert(res.success === true, 'Expected success true');
    assert(Array.isArray(res.presets), 'presets should be array');
    assert(res.presets.length >= 4, 'Should have at least 4 presets');
    
    const degen = res.presets.find((p: any) => p.id === 'degen');
    assert(degen, 'Missing degen preset');
    assert(degen.stakingCut, 'Missing stakingCut in preset');
  });

  // Tokens list
  await test('GET /tokens returns array', async () => {
    const res = await fetchJson('/tokens');
    assert(res.success === true, 'Expected success true');
    assert(Array.isArray(res.tokens), 'tokens should be array');
    assert(typeof res.count === 'number', 'Missing count');
  });

  // Staking pools
  await test('GET /stake/pools returns pools', async () => {
    const res = await fetchJson('/stake/pools');
    assert(res.success === true, 'Expected success true');
    assert(Array.isArray(res.pools), 'pools should be array');
  });

  // Invalid wallet for earnings
  await test('GET /earnings/invalid returns error', async () => {
    const res = await fetchJson('/earnings/invalid-wallet');
    assert(res.success === false, 'Should return success false');
    assert(!!res.error, 'Should have error message');
  });

  // Valid wallet format for earnings (may have no tokens)
  await test('GET /earnings/:wallet accepts valid wallet', async () => {
    const res = await fetchJson('/earnings/EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ');
    assert(res.success === true, 'Expected success true');
    assert(!!res.wallet, 'Should return wallet');
  });

  // 404 for unknown routes
  await test('GET /unknown returns 404', async () => {
    const res = await fetch(`${API_URL}/unknown-route-xyz`);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    const json = await res.json() as { success?: boolean };
    assert(json.success === false, 'Should return success false');
  });

  // Launch validation - missing fields
  await test('POST /launch rejects missing fields', async () => {
    const res = await fetchJson('/launch', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test' }), // Missing other required fields
    });
    assert(res.success === false, 'Should reject incomplete request');
    assert(!!res.error, 'Should have error message');
  });

  // Launch validation - invalid tokenomics
  await test('POST /launch rejects invalid tokenomics', async () => {
    const res = await fetchJson('/launch', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Token',
        ticker: 'TEST',
        image: 'https://example.com/img.png',
        tokenomics: 'invalid-style',
        agentWallet: 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ',
      }),
    });
    assert(res.success === false, 'Should reject invalid tokenomics');
    assert(res.error?.includes('Invalid tokenomics'), 'Error should mention tokenomics');
  });

  // Launch validation - invalid ticker
  await test('POST /launch rejects invalid ticker', async () => {
    const res = await fetchJson('/launch', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Token',
        ticker: 'INVALID123', // Has numbers
        image: 'https://example.com/img.png',
        tokenomics: 'degen',
        agentWallet: 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ',
      }),
    });
    assert(res.success === false, 'Should reject invalid ticker');
  });

  // Launch validation - invalid name characters
  await test('POST /launch rejects invalid name characters', async () => {
    const res = await fetchJson('/launch', {
      method: 'POST',
      body: JSON.stringify({
        name: '<script>alert(1)</script>', // XSS attempt
        ticker: 'TEST',
        image: 'https://example.com/img.png',
        tokenomics: 'degen',
        agentWallet: 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ',
      }),
    });
    assert(res.success === false, 'Should reject XSS in name');
  });

  // Stake quote
  await test('POST /stake/quote validates input', async () => {
    const res = await fetchJson('/stake/quote', {
      method: 'POST',
      body: JSON.stringify({}), // Missing fields
    });
    assert(res.success === false, 'Should reject missing fields');
  });

  // Distribution history
  await test('GET /admin/distributions returns history', async () => {
    const res = await fetchJson('/admin/distributions');
    assert(res.success === true, 'Expected success true');
    assert(Array.isArray(res.distributions), 'distributions should be array');
  });

  // Admin status
  await test('GET /admin/status returns system metrics', async () => {
    const res = await fetchJson('/admin/status');
    assert(res.success === true, 'Expected success true');
    assert(!!res.system, 'Should have system info');
    assert(!!res.wallet, 'Should have wallet info');
    assert(typeof res.registry?.tokens === 'number', 'Should have token count');
  });

  // Admin wallet
  await test('GET /admin/wallet returns balance', async () => {
    const res = await fetchJson('/admin/wallet');
    assert(res.success === true, 'Expected success true');
    assert(!!res.address, 'Should have address');
    assert(typeof res.balanceLamports === 'number', 'Should have balance');
  });

  // ============ SUMMARY ============

  console.log('\n' + '─'.repeat(50));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  console.log(`⏱️ Total time: ${totalTime}ms`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

// Run tests
runTests().catch(e => {
  console.error('Test runner failed:', e);
  process.exit(1);
});
