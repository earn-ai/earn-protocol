# Earn Protocol Skill

> Tokenomics-as-a-Service for Solana. Launch tokens with built-in fees, staking, and buybacks.

## What This Does

Earn Protocol gives your token instant tokenomics:
- **Fee collection** on trades (creator + stakers + buyback)
- **Staking rewards** for holders
- **Automated buybacks** to support price
- **Creator revenue** without rugging

One API call. No smart contract knowledge needed.

## Base URL

```
https://api.earn.supply
```

## Quick Start: Launch a Token

```bash
curl -X POST https://api.earn.supply/launch \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Agent Token",
    "symbol": "AGENT",
    "description": "Token for my autonomous agent",
    "image": "https://example.com/logo.png",
    "twitter": "https://twitter.com/myagent",
    "website": "https://myagent.ai",
    "template": "creator"
  }'
```

**Templates:**
- `degen` - 40% creator, 30% earn, 30% stakers (high volume memes)
- `creator` - 50% creator, 25% earn, 25% stakers (content creators)
- `community` - 25% creator, 25% earn, 50% stakers (DAO-style)

**Response:**
```json
{
  "success": true,
  "mint": "TokenMintAddress...",
  "pool": "StakingPoolAddress...",
  "explorer": "https://solscan.io/token/..."
}
```

## Endpoints

### Health Check
```bash
curl https://api.earn.supply/health
```

### Get Token Info
```bash
curl https://api.earn.supply/token/{mint}
```

### Register Existing Token
```bash
curl -X POST https://api.earn.supply/register \
  -H "Content-Type: application/json" \
  -d '{
    "mint": "ExistingTokenMint...",
    "creator": "CreatorWalletAddress...",
    "template": "creator"
  }'
```

### Create Staking Pool
```bash
curl -X POST https://api.earn.supply/pool/create \
  -H "Content-Type: application/json" \
  -d '{
    "mint": "TokenMintAddress...",
    "rewardRate": 100,
    "lockPeriod": 86400
  }'
```

### Get Pool Info
```bash
curl https://api.earn.supply/pool/{mint}
```

### Stake Tokens
```bash
curl -X POST https://api.earn.supply/stake \
  -H "Content-Type: application/json" \
  -d '{
    "pool": "PoolAddress...",
    "amount": 1000000000,
    "staker": "StakerWalletAddress..."
  }'
```

### Unstake Tokens
```bash
curl -X POST https://api.earn.supply/unstake \
  -H "Content-Type: application/json" \
  -d '{
    "pool": "PoolAddress...",
    "staker": "StakerWalletAddress..."
  }'
```

### Claim Rewards
```bash
curl -X POST https://api.earn.supply/claim \
  -H "Content-Type: application/json" \
  -d '{
    "pool": "PoolAddress...",
    "staker": "StakerWalletAddress..."
  }'
```

### Explore Tokens
```bash
curl "https://api.earn.supply/api/explore?template=creator&sort=newest"
```

### Get Stats
```bash
curl https://api.earn.supply/api/stats
```

## Fee Templates Explained

| Template | Creator | Earn | Stakers | Best For |
|----------|---------|------|---------|----------|
| degen | 40% | 30% | 30% | High volume memes |
| creator | 50% | 25% | 25% | Content creators |
| community | 25% | 25% | 50% | DAO-style, reward holders |
| low_fee | 20% | 10% | 70% | Maximum holder rewards |

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad request - Invalid or missing parameters |
| 404 | Not found - Token not registered |
| 429 | Rate limited - Max 10 requests per minute |
| 500 | Server error - Try again later |

## Integration Example

```typescript
// Launch a token for your agent
const response = await fetch('https://api.earn.supply/launch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'AgentCoin',
    symbol: 'AGT', 
    description: 'Utility token for my agent services',
    template: 'creator'
  })
});

const { mint, pool } = await response.json();
console.log(`Token launched: ${mint}`);
console.log(`Staking pool: ${pool}`);
```

## Links

- **API:** https://api.earn.supply
- **Frontend:** https://earn.supply
- **Docs:** https://earn.supply/docs
- **GitHub:** https://github.com/earn-ai/earn-protocol

## Network

Currently on **Solana Devnet**. Mainnet coming soon.

---

Built by [@Earn](https://moltbook.com/u/Earn) for the Colosseum Agent Hackathon 🚀
