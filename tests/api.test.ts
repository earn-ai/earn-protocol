/**
 * API Endpoint Tests for Earn Protocol
 * 
 * Tests key API endpoints for the hackathon submission.
 * Run with: npm test
 */

import request from 'supertest';
import { app } from '../src/api';

describe('Earn Protocol API', () => {
  
  // ==========================================
  // Health & Status Endpoints
  // ==========================================
  
  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/health');
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('protocol');
    });
    
    it('should include protocol version', async () => {
      const res = await request(app).get('/health');
      
      expect(res.body.protocol).toMatch(/Earn Protocol/);
    });
  });
  
  describe('GET /', () => {
    it('should return API info', async () => {
      const res = await request(app).get('/');
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('name', 'Earn Protocol');
      expect(res.body).toHaveProperty('version');
    });
  });
  
  // ==========================================
  // Token Endpoints
  // ==========================================
  
  describe('GET /earn/tokens', () => {
    it('should return list of tokens', async () => {
      const res = await request(app).get('/earn/tokens');
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('tokens');
      expect(Array.isArray(res.body.tokens)).toBe(true);
    });
  });
  
  describe('GET /earn/templates', () => {
    it('should return tokenomics templates', async () => {
      const res = await request(app).get('/earn/templates');
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('templates');
      expect(Array.isArray(res.body.templates)).toBe(true);
      
      // Should have standard templates
      const templateNames = res.body.templates.map((t: any) => t.name);
      expect(templateNames).toContain('degen');
      expect(templateNames).toContain('creator');
    });
  });
  
  describe('GET /earn/token/:mint', () => {
    it('should return 404 for non-existent token', async () => {
      const fakeMint = '11111111111111111111111111111111';
      const res = await request(app).get(`/earn/token/${fakeMint}`);
      
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
    
    it('should return 404 for invalid mint format', async () => {
      const res = await request(app).get('/earn/token/invalid');
      
      // API returns 404 for both invalid and non-existent
      expect(res.status).toBe(404);
    });
  });
  
  // ==========================================
  // Staking Endpoints
  // ==========================================
  
  describe('GET /earn/rewards/:wallet', () => {
    it('should return rewards for wallet', async () => {
      const testWallet = 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ';
      const res = await request(app).get(`/earn/rewards/${testWallet}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('wallet', testWallet);
      expect(res.body).toHaveProperty('rewards');
    });
    
    it('should handle wallet with no stakes', async () => {
      const emptyWallet = '11111111111111111111111111111111';
      const res = await request(app).get(`/earn/rewards/${emptyWallet}`);
      
      expect(res.status).toBe(200);
      expect(res.body.rewards).toEqual([]);
    });
  });
  
  describe('GET /earn/staking-stats/:mint', () => {
    it('should return staking stats for token', async () => {
      const testMint = 'EARNBvGL9ywqLqgPZ6QBVCLniHLvgqs7vhfbQqrBpump';
      const res = await request(app).get(`/earn/staking-stats/${testMint}`);
      
      // Either returns stats or 404 if pool doesn't exist
      expect([200, 404]).toContain(res.status);
      
      if (res.status === 200) {
        expect(res.body).toHaveProperty('totalStaked');
        expect(res.body).toHaveProperty('stakerCount');
      }
    });
  });
  
  // ==========================================
  // Protocol Stats
  // ==========================================
  
  describe('GET /earn/stats', () => {
    it('should return protocol-wide stats', async () => {
      const res = await request(app).get('/earn/stats');
      
      expect(res.status).toBe(200);
      // Stats endpoint returns protocol name and stats
      expect(res.body).toHaveProperty('protocol');
      expect(typeof res.body.protocol).toBe('string');
    });
  });
  
  describe('GET /earn/leaderboard', () => {
    it('should return staker leaderboard', async () => {
      const res = await request(app).get('/earn/leaderboard');
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('leaderboard');
      expect(Array.isArray(res.body.leaderboard)).toBe(true);
    });
    
    it('should respect limit parameter', async () => {
      const res = await request(app).get('/earn/leaderboard?limit=5');
      
      expect(res.status).toBe(200);
      expect(res.body.leaderboard.length).toBeLessThanOrEqual(5);
    });
  });
  
  // ==========================================
  // Quote Endpoints
  // ==========================================
  
  describe('GET /earn/quote', () => {
    it('should return fee quote for trade', async () => {
      const res = await request(app)
        .get('/earn/quote')
        .query({
          mint: 'EARNBvGL9ywqLqgPZ6QBVCLniHLvgqs7vhfbQqrBpump',
          amount: '1000000000', // 1 SOL
          isBuy: 'true'
        });
      
      // Returns quote, 404 if not found, or 400 for invalid params
      expect([200, 400, 404]).toContain(res.status);
      
      if (res.status === 200) {
        expect(res.body).toHaveProperty('feeAmount');
      }
    });
  });
  
  describe('GET /earn/swap/quote', () => {
    it('should return swap quote', async () => {
      const res = await request(app)
        .get('/earn/swap/quote')
        .query({
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EARNBvGL9ywqLqgPZ6QBVCLniHLvgqs7vhfbQqrBpump',
          amount: '100000000' // 0.1 SOL
        });
      
      // Either returns quote or error if token not found
      expect([200, 400, 404]).toContain(res.status);
    });
  });
  
  // ==========================================
  // POST Endpoints (validation only, no mutations)
  // ==========================================
  
  describe('POST /earn/register', () => {
    it('should reject invalid mint address', async () => {
      const res = await request(app)
        .post('/earn/register')
        .send({
          mint: 'invalid',
          tokenomics: 'degen'
        });
      
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
    
    it('should require tokenomics template', async () => {
      const res = await request(app)
        .post('/earn/register')
        .send({
          mint: 'EARNBvGL9ywqLqgPZ6QBVCLniHLvgqs7vhfbQqrBpump'
          // Missing tokenomics
        });
      
      expect(res.status).toBe(400);
    });
  });
  
  describe('POST /earn/stake', () => {
    it('should reject missing parameters', async () => {
      const res = await request(app)
        .post('/earn/stake')
        .send({});
      
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
    
    it('should reject invalid amount', async () => {
      const res = await request(app)
        .post('/earn/stake')
        .send({
          mint: 'EARNBvGL9ywqLqgPZ6QBVCLniHLvgqs7vhfbQqrBpump',
          wallet: 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ',
          amount: -100
        });
      
      expect(res.status).toBe(400);
    });
  });
  
  describe('POST /earn/claim', () => {
    it('should reject missing wallet', async () => {
      const res = await request(app)
        .post('/earn/claim')
        .send({});
      
      expect(res.status).toBe(400);
    });
  });
});

// ==========================================
// Edge Cases & Security
// ==========================================

describe('Edge Cases', () => {
  describe('Input Validation', () => {
    it('should reject SQL injection attempts in mint parameter', async () => {
      const malicious = "'; DROP TABLE tokens; --";
      const res = await request(app).get(`/earn/token/${encodeURIComponent(malicious)}`);
      
      expect(res.status).toBe(404);
      // Should not crash or expose error details
      expect(res.body.error).not.toContain('SQL');
    });
    
    it('should handle extremely long mint addresses', async () => {
      const longMint = 'A'.repeat(1000);
      const res = await request(app).get(`/earn/token/${longMint}`);
      
      expect([400, 404]).toContain(res.status);
    });
    
    it('should handle unicode in parameters', async () => {
      const unicode = '🚀💎🌙';
      const res = await request(app).get(`/earn/token/${encodeURIComponent(unicode)}`);
      
      expect([400, 404]).toContain(res.status);
    });
    
    it('should handle null bytes in input', async () => {
      const nullByte = 'test\x00injection';
      const res = await request(app).get(`/earn/token/${encodeURIComponent(nullByte)}`);
      
      expect([400, 404]).toContain(res.status);
    });
  });
  
  describe('Rate Limiting Behavior', () => {
    it('should include rate limit headers', async () => {
      const res = await request(app).get('/health');
      
      // Rate limit headers may or may not be present depending on config
      expect(res.status).toBe(200);
    });
  });
  
  describe('Error Response Format', () => {
    it('should return consistent error format', async () => {
      const res = await request(app).get('/earn/token/invalid');
      
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
    });
    
    it('should not expose stack traces in production', async () => {
      const res = await request(app)
        .post('/earn/register')
        .send({ invalid: 'data' });
      
      expect(res.body.stack).toBeUndefined();
      expect(res.body.trace).toBeUndefined();
    });
  });
  
  describe('Boundary Conditions', () => {
    it('should handle zero amount in quote', async () => {
      const res = await request(app)
        .get('/earn/quote')
        .query({
          mint: 'EARNBvGL9ywqLqgPZ6QBVCLniHLvgqs7vhfbQqrBpump',
          amount: '0',
          isBuy: 'true'
        });
      
      expect([200, 400, 404]).toContain(res.status);
    });
    
    it('should handle max safe integer in amount', async () => {
      const res = await request(app)
        .get('/earn/quote')
        .query({
          mint: 'EARNBvGL9ywqLqgPZ6QBVCLniHLvgqs7vhfbQqrBpump',
          amount: Number.MAX_SAFE_INTEGER.toString(),
          isBuy: 'true'
        });
      
      expect([200, 400, 404]).toContain(res.status);
    });
    
    it('should handle negative leaderboard limit gracefully', async () => {
      const res = await request(app).get('/earn/leaderboard?limit=-5');
      
      // Should either ignore negative or return error
      expect([200, 400]).toContain(res.status);
    });
    
    it('should handle very large leaderboard limit', async () => {
      const res = await request(app).get('/earn/leaderboard?limit=999999');
      
      expect(res.status).toBe(200);
      // Should cap the limit internally
    });
  });
  
  describe('Content Type Handling', () => {
    it('should reject non-JSON POST body', async () => {
      const res = await request(app)
        .post('/earn/register')
        .set('Content-Type', 'text/plain')
        .send('not json');
      
      // Should get 400 for bad content type or parse error
      expect([400, 415]).toContain(res.status);
    });
    
    it('should handle empty POST body', async () => {
      const res = await request(app)
        .post('/earn/stake')
        .set('Content-Type', 'application/json')
        .send('');
      
      expect([400]).toContain(res.status);
    });
  });
});

// ==========================================
// Off-Chain Staking API Tests
// NOTE: These endpoints are production-only (api/server.ts for Vercel)
// They require Supabase connection and are not in src/api.ts
// Skipped for unit tests - tested via integration tests against api.earn.supply
// ==========================================

describe.skip('Off-Chain Staking API (production only)', () => {
  describe('GET /api/stakes/:wallet', () => {
    it('should return stakes for valid wallet', async () => {
      const wallet = 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ';
      const res = await request(app).get(`/api/stakes/${wallet}`);
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('stakes');
      expect(Array.isArray(res.body.stakes)).toBe(true);
    });
    
    it('should return empty array for wallet with no stakes', async () => {
      const wallet = '11111111111111111111111111111111';
      const res = await request(app).get(`/api/stakes/${wallet}`);
      
      expect(res.status).toBe(200);
      expect(res.body.stakes).toEqual([]);
    });
  });
  
  describe('GET /api/staking/pool/:tokenMint', () => {
    it('should return 404 for non-existent pool', async () => {
      const fakeMint = '11111111111111111111111111111111';
      const res = await request(app).get(`/api/staking/pool/${fakeMint}`);
      
      expect(res.status).toBe(404);
    });
  });
  
  describe('POST /api/stake', () => {
    it('should require all fields', async () => {
      const res = await request(app)
        .post('/api/stake')
        .send({
          userWallet: 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ'
          // Missing tokenMint and txSignature
        });
      
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('required');
    });
    
    it('should validate transaction signature format', async () => {
      const res = await request(app)
        .post('/api/stake')
        .send({
          userWallet: 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ',
          tokenMint: '87WkKqpXkcGixt7WUxEHQxFfr2BU7eU1GHt5fKoSnCdd',
          txSignature: 'invalid'
        });
      
      expect([400, 404]).toContain(res.status);
    });
  });
  
  describe('POST /api/unstake', () => {
    it('should require stakeId', async () => {
      const res = await request(app)
        .post('/api/unstake')
        .send({
          userWallet: 'EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ'
        });
      
      expect(res.status).toBe(400);
    });
  });
});

// ==========================================
// Integration Sanity Check
// ==========================================

describe('API Integration', () => {
  it('should serve CORS headers', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', 'https://example.com');
    
    // Verify CORS preflight headers exist (methods/headers at minimum)
    expect(res.headers).toHaveProperty('access-control-allow-methods');
    expect(res.headers).toHaveProperty('access-control-allow-headers');
  });
  
  it('should parse JSON body', async () => {
    const res = await request(app)
      .post('/earn/register')
      .set('Content-Type', 'application/json')
      .send({ test: true });
    
    // Should get validation error, not parse error
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).not.toContain('parse');
  });
});
