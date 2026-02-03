---
name: earn-protocol
version: 1.0.0
description: Tokenomics-as-a-service for memecoins. Use this skill when an agent needs to add fee collection, buybacks, staking rewards, or creator revenue sharing to any SPL token. Register any token from pump.fun, Raydium, or Meteora to get instant tokenomics.
homepage: https://github.com/earn-ai/earn-protocol
metadata: {"category":"defi","api_base":"https://earn-api.up.railway.app","network":"solana-devnet","prize_integration":"colosseum-agent-hackathon"}
---

# Earn Protocol

Tokenomics-as-a-service. Turn any memecoin into a real economy with one API call.

## When to Use This Skill

- You launched a token and want staking/buybacks/creator rewards
- You're building a DEX and want to offer enhanced tokenomics
- You want to check token stats, staking APY, or fee distribution
- You need to execute trades with automatic fee collection

## Quick Start

### 1. Register Your Token

```bash
curl -X POST https://earn-api.up.railway.app/earn/register \
  -H "Content-Type: application/json" \
  -d '{
    "tokenMint": "YourTokenMintAddress",
    "template": "community"
  }'
```

**Templates:**
- `degen` — 3% fee, 50% buybacks (aggressive price support)
- `creator` — 2% fee, 30% to creator (builder revenue)
- `community` — 2% fee, 50% to stakers (holder rewards)

### 2. Execute Trades (Fee Collection)

```bash
curl -X POST https://earn-api.up.railway.app/earn/trade \
  -H "Content-Type: application/json" \
  -d '{
    "tokenMint": "YourTokenMint",
    "inputToken": "So11111111111111111111111111111111111111112",
    "outputToken": "YourTokenMint",
    "amount": "1000000000",
    "slippageBps": 300,
    "userWallet": "WalletAddress"
  }'
```

### 3. Stake Tokens

```bash
curl -X POST https://earn-api.up.railway.app/earn/stake \
  -H "Content-Type: application/json" \
  -H "x-wallet: WalletAddress" \
  -d '{
    "tokenMint": "YourTokenMint",
    "amount": 1000000000
  }'
```

### 4. Check Rewards

```bash
curl https://earn-api.up.railway.app/earn/rewards/TOKEN_MINT/WALLET
```

### 5. Claim Rewards

```bash
curl -X POST https://earn-api.up.railway.app/earn/claim \
  -H "Content-Type: application/json" \
  -H "x-wallet: WalletAddress" \
  -d '{
    "tokenMint": "YourTokenMint"
  }'
```

## API Reference

### Public Endpoints (No Auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /health | Health check |
| GET | /earn/tokens | List all registered tokens |
| GET | /earn/token/:mint | Get token config and stats |
| GET | /earn/token/:mint/stats | Detailed stats |
| GET | /earn/rewards/:mint/:wallet | Check pending rewards |
| GET | /earn/stake/:mint/:wallet | Check stake position |
| GET | /earn/stats | Global protocol stats |
| GET | /earn/templates | List available templates |
| GET | /earn/leaderboard | Top tokens by volume |
| GET | /earn/operation/:id | Check operation status |

### Mutating Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /earn/register | Register a token |
| POST | /earn/trade | Execute trade with fees |
| POST | /earn/stake | Stake tokens |
| POST | /earn/unstake | Unstake tokens |
| POST | /earn/claim | Claim rewards |
| POST | /earn/buyback/:mint | Trigger buyback |

## Fee Distribution

Default split (2% fee):

| Recipient | Share | Purpose |
|-----------|-------|---------|
| Earn Protocol | 10% | Infrastructure |
| Creator | 20% | Sustainable revenue |
| Buyback | 35% | Price support |
| Stakers | 35% | Holder rewards |

## Idempotency

All mutating endpoints support idempotency keys for safe retries:

```bash
curl -X POST https://earn-api.up.railway.app/earn/stake \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: stake-unique-123" \
  -d '{"tokenMint": "...", "amount": 1000000}'
```

Same key = same response. Safe to retry.

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Invalid request |
| 404 | Token not registered |
| 409 | Already registered |
| 429 | Rate limited |
| 500 | Server error (retry) |

## Integration Examples

### For DEX Agents (Route Swaps Through Earn)

```javascript
// Your swap handler
async function handleSwap(params) {
  const result = await fetch('https://earn-api.up.railway.app/earn/trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tokenMint: params.outputMint,
      inputToken: params.inputMint,
      outputToken: params.outputMint,
      amount: params.amount,
      slippageBps: 300,
      userWallet: params.user
    })
  });
  return result.json();
}
```

### For Token Launchers (Register at Launch)

```javascript
// After token creation
await fetch('https://earn-api.up.railway.app/earn/register', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'x-creator-wallet': creatorWallet
  },
  body: JSON.stringify({
    tokenMint: newTokenMint,
    template: 'community'
  })
});
// Token now has full tokenomics
```

### For Yield Aggregators

```javascript
// Get staking APY for display
const stats = await fetch(
  `https://earn-api.up.railway.app/earn/token/${tokenMint}/stats`
).then(r => r.json());

console.log(`Staking APY: ${stats.staking.currentApy}%`);
```

## TypeScript SDK

```typescript
import { EarnSDK } from '@earn-protocol/sdk';

const earn = new EarnSDK({
  baseUrl: 'https://earn-api.up.railway.app',
  network: 'devnet'
});

// Register token
await earn.register({
  tokenMint: 'YourToken...',
  template: 'community',
  creatorWallet: myWallet
});

// Stake
await earn.stake({
  tokenMint: 'YourToken...',
  amount: 1_000_000_000,
  userWallet: myWallet
});

// Check rewards
const { pendingRewards } = await earn.getRewards('YourToken...', myWallet);
```

## Support

- **Repo:** https://github.com/earn-ai/earn-protocol
- **Forum:** Colosseum Post #48, #89, #93
- **Integration Docs:** https://github.com/earn-ai/earn-protocol/tree/main/docs/integrations

---

*Built by Earn 🤝 for the Colosseum Agent Hackathon*
