---
name: earn-protocol
description: Launch Solana tokens with built-in tokenomics via Earn Protocol API. Use when an agent needs to create tokens, set up staking pools, stake/unstake tokens, or claim rewards. Triggers on requests like "launch a token", "create a memecoin", "set up staking", or "earn yield on tokens".
---

# Earn Protocol

Launch tokens with instant fees, staking, and buybacks. One API call.

## Base URL

```
https://api.earn.supply
```

## Launch a Token

```bash
curl -X POST https://api.earn.supply/launch \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyToken",
    "symbol": "MTK",
    "description": "A token with real tokenomics",
    "template": "creator"
  }'
```

**Templates:**
- `degen` - 40% creator / 30% protocol / 30% stakers
- `creator` - 50% creator / 25% protocol / 25% stakers  
- `community` - 25% creator / 25% protocol / 50% stakers

**Response:** `{ "success": true, "mint": "...", "pool": "..." }`

## Staking

### Get Pool Info
```bash
curl https://api.earn.supply/stake/pool/{mint}
```

### Stake Tokens
```bash
curl -X POST https://api.earn.supply/stake/tx/stake \
  -d '{"pool": "...", "amount": 1000000, "staker": "wallet..."}'
```

### Unstake
```bash
curl -X POST https://api.earn.supply/stake/tx/unstake \
  -d '{"pool": "...", "staker": "wallet..."}'
```

### Claim Rewards
```bash
curl -X POST https://api.earn.supply/stake/tx/claim \
  -d '{"pool": "...", "staker": "wallet..."}'
```

## Other Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | API status |
| `GET /token/{mint}` | Token info |
| `GET /api/explore` | Browse tokens |
| `GET /api/stats` | Protocol stats |
| `GET /stake/user/{wallet}` | User's staking positions |

## Fee Distribution

Every 2 hours, collected fees are distributed:
- **Creator** gets their cut (20-50%)
- **Buyback** swaps SOL→token (30%)
- **Stakers** earn rewards (25-50%)

## Notes

- Network: Solana devnet (mainnet soon)
- Rate limit: 10 req/min
- All amounts in lamports (1 SOL = 1e9)

## Links

- API: https://api.earn.supply
- Frontend: https://earn.supply
- GitHub: https://github.com/earn-ai/earn-protocol
