# Earn Protocol API - Summary

## Current Status

✅ **API fully functional on devnet**  
✅ **2 tokens launched successfully**  
✅ **18 integration tests passing**  

## What's Built

### API Server (`api/server.ts`)

**Core Endpoints:**
```
GET  /              → Returns skill.md (agent docs)
GET  /skill.md      → Agent instructions
GET  /health        → Health check + wallet info
GET  /stats         → Global protocol statistics
POST /launch        → Create token on Pump.fun
GET  /token/:mint   → Get token info
GET  /tokens        → List all tokens
GET  /earnings/:wal → Check agent earnings
GET  /tokenomics    → List presets
```

**Staking Endpoints (Mock Data):**
```
GET  /stake/pools         → All staking pools with APY
GET  /stake/pool/:mint    → Single pool details
GET  /stake/user/:wallet  → User's staking positions
POST /stake/quote         → Preview stake/unstake rewards
```

**Admin Endpoints:**
```
GET  /admin/status        → System metrics (uptime, memory, wallet)
GET  /admin/wallet        → Wallet balance + airdrop command
GET  /admin/distributions → Fee distribution history
POST /admin/distribute    → Trigger fee distribution (auth required)
```

### Launch Endpoint

**Request:**
```bash
curl -X POST https://api.earn.supply/launch \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Token",
    "ticker": "MTK",
    "image": "https://example.com/logo.png",
    "tokenomics": "degen",
    "agentWallet": "YOUR_SOLANA_WALLET"
  }'
```

**Response:**
```json
{
  "success": true,
  "requestId": "ab497f04c1d4b7ce",
  "launchNumber": 1,
  "mint": "EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1",
  "name": "My Token",
  "symbol": "MTK",
  "pumpfun": "https://pump.fun/EvMiXk...",
  "solscan": "https://solscan.io/token/EvMiXk...?cluster=devnet",
  "staking": "https://earn.supply/stake/EvMiXk...",
  "agentWallet": "YOUR_WALLET",
  "tokenomics": "degen",
  "feeSplit": {
    "agent": "40%",
    "earn": "30%",
    "stakers": "30%"
  },
  "txSignature": "w7wDDhon...",
  "network": "devnet"
}
```

## Features Implemented

### Security
- Input sanitization (XSS protection)
- Rate limiting (10 req/min per IP)
- Wallet validation
- Request ID tracking

### Performance
- Stats caching (10s TTL)
- Rate limit cleanup (prevents memory leak)
- File-based persistence (survives restarts)

### Reliability
- Graceful shutdown (saves tokens)
- Configurable CORS
- Better error messages

### Staking Program (Anchor)
Complete instruction set:
- `initialize` - Global config setup
- `create_pool` - Per-token staking pool
- `stake` - Deposit tokens
- `request_unstake` - Start cooldown
- `cancel_unstake` - Cancel request
- `unstake` - Withdraw tokens
- `claim_rewards` - Claim SOL rewards
- `deposit_rewards` - Crank deposits
- `update_rewards` - Permissionless update

## Test Results

```
✅ GET /health returns ok
✅ GET /skill.md returns markdown
✅ GET / returns skill.md
✅ GET /stats returns statistics
✅ GET /tokenomics returns presets
✅ GET /tokens returns array
✅ GET /stake/pools returns pools
✅ GET /earnings/invalid returns error
✅ GET /earnings/:wallet accepts valid wallet
✅ GET /unknown returns 404
✅ POST /launch rejects missing fields
✅ POST /launch rejects invalid tokenomics
✅ POST /launch rejects invalid ticker
✅ POST /launch rejects invalid name characters
✅ POST /stake/quote validates input
✅ GET /admin/distributions returns history
✅ GET /admin/status returns system metrics
✅ GET /admin/wallet returns balance

📊 Results: 18 passed, 0 failed
```

## Deployment

**For api.earn.supply:**

```bash
cd earn-protocol
npm install

# Environment
export RPC_URL=https://api.devnet.solana.com
export EARN_WALLET=/path/to/earn-wallet.json
export PORT=3000
export CORS_ORIGINS=https://earn.supply  # Optional

# Run
npx ts-node api/server.ts
```

## Tokens Launched (Devnet)

1. `EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1` - EARNTEST
2. `4hqoGYX7fNFnSYsHFJ6RosK24sUmpbLNj6BqDDkGhdpE` - TEST

## What's Missing (TODO)

1. **Git push** - 6 commits waiting (need GitHub token)
2. **Anchor build** - Need Anchor CLI to compile program
3. **Production deploy** - Deploy to api.earn.supply
4. **IPFS upload** - nft.storage key needed
5. **On-chain staking** - Anchor program not deployed yet

## Files

```
earn-protocol/
├── api/
│   ├── server.ts      # Main API (1100+ lines)
│   ├── crank.ts       # Fee distribution crank
│   └── test.ts        # 18 integration tests
├── programs/
│   └── earn-staking/  # Anchor staking program
├── data/              # Persistent storage
│   ├── tokens.json    # Token registry
│   └── distributions.json
└── *.md               # Documentation
```

## Recent Commits

```
eb854e2 security: Input sanitization for token metadata
111a8f7 chore: Configurable CORS, debug logging, graceful shutdown
64452b9 feat: Add admin status and wallet endpoints
d5c0518 feat: Add request_unstake and cancel_unstake instructions
ceb0c56 perf: Rate limit cleanup, stats caching, better error handling
7979d01 fix: Overflow protection, safer claim logic
```
