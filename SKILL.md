---
name: earn-protocol
version: 1.0.0
description: Tokenomics-as-a-service for memecoins. Register any SPL token to get fee collection, buybacks, staking rewards, and creator revenue share.
homepage: https://github.com/earn-ai/earn-protocol
metadata: {"category":"defi","api_base":"https://earn-api.example.com","network":"solana-devnet"}
---

# Earn Protocol

Turn any memecoin into a real economy. One API call.

**What you get:**
- Fee collection on trades (2% default)
- Automatic buybacks (price support)
- Staking rewards (holder income)
- Creator revenue share (sustainable)

**Earn takes 10% minimum.** Non-negotiable. You get the other 90% to split between creator/buyback/staking.

## Quick Start

### 1. Register Your Token

```bash
curl -X POST https://earn-api.example.com/earn/register \
  -H "Content-Type: application/json" \
  -H "x-creator-wallet: YourWalletAddress" \
  -d '{
    "tokenMint": "YourTokenMintAddress",
    "template": "community",
    "idempotencyKey": "register-mytoken-1706900000"
  }'
```

**Templates:** `degen` | `creator` | `community` | `lowfee`

**Response:**
```json
{
  "success": true,
  "operationId": "op_7xKXtg2CW87d",
  "status": "completed",
  "result": {
    "tokenMint": "YourTokenMintAddress",
    "creator": "YourWalletAddress",
    "template": "community",
    "feePercent": 2,
    "earnCut": 10,
    "creatorCut": 10,
    "buybackPercent": 30,
    "stakingPercent": 50
  }
}
```

### 2. Execute Trades Through Earn

```bash
curl -X POST https://earn-api.example.com/earn/trade \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "trade-abc123-1706900000",
    "tokenMint": "YourTokenMintAddress",
    "inputToken": "So11111111111111111111111111111111111111112",
    "outputToken": "YourTokenMintAddress",
    "amount": 1000000000,
    "slippageBps": 300,
    "userWallet": "UserWalletAddress"
  }'
```

Fees are automatically collected and distributed.

### 3. Stake Tokens

```bash
curl -X POST https://earn-api.example.com/earn/stake \
  -H "Content-Type: application/json" \
  -H "x-wallet: UserWalletAddress" \
  -d '{
    "idempotencyKey": "stake-abc123-1706900000",
    "tokenMint": "YourTokenMintAddress",
    "amount": 1000000000
  }'
```

**Response:**
```json
{
  "success": true,
  "operationId": "op_8yLYuh3DX98e",
  "status": "completed",
  "result": {
    "stakedAmount": "1000000000",
    "newTotal": "5000000000",
    "pendingRewards": "0"
  }
}
```

### 4. Check Operation Status

Any mutating operation returns an `operationId`. Check it anytime:

```bash
curl https://earn-api.example.com/earn/operation/op_7xKXtg2CW87d
```

**Response:**
```json
{
  "operationId": "op_7xKXtg2CW87d",
  "idempotencyKey": "register-mytoken-1706900000",
  "type": "register",
  "status": "completed",
  "txSignature": "5yKx...",
  "result": { ... },
  "createdAt": 1706900000000,
  "updatedAt": 1706900001000
}
```

### 5. Check Rewards

```bash
curl https://earn-api.example.com/earn/rewards/UserWalletAddress
```

### 6. Claim Rewards

```bash
curl -X POST https://earn-api.example.com/earn/claim \
  -H "Content-Type: application/json" \
  -H "x-wallet: UserWalletAddress" \
  -d '{
    "tokenMint": "YourTokenMintAddress"
  }'
```

---

## Templates

| Template | Fee | Earn | Creator | Buyback | Staking | Best For |
|----------|-----|------|---------|---------|---------|----------|
| `degen` | 3% | 10% | 10% | 50% | 30% | Meme coins, price support |
| `creator` | 2% | 10% | 30% | 30% | 30% | Dev sustainability |
| `community` | 2% | 10% | 10% | 30% | 50% | DAO-style governance |
| `lowfee` | 1% | 10% | 20% | 40% | 30% | High-volume tokens |

Get templates:
```bash
curl https://earn-api.example.com/earn/templates
```

---

## Idempotency (Agent-Proof)

**Every mutating endpoint supports idempotency keys.** This is critical for agents.

```json
{
  "idempotencyKey": "stake-abc123-1706900000",
  "tokenMint": "xxx",
  "amount": 1000000
}
```

Rules:
- Same `idempotencyKey` = same response (even if you retry 100x)
- Use format: `{operation}-{unique}-{timestamp}`
- Keys expire after 24h
- Always store the `operationId` from response

---

## State Architecture

### On-Chain (Canonical, Trustless)
- **TokenConfig PDA** - Fee settings, creator address
- **Treasury PDA** - Buyback balance, fee totals
- **StakingPool PDA** - Total staked, reward rate
- **StakeAccount PDAs** - Per-user stakes, reward debt

### Off-Chain (Indexing, UX)
- API server (routing, quotes, dashboards)
- Transaction history cache
- Analytics aggregation

### If API Goes Down
- ✅ All funds safe (on-chain)
- ✅ Staking/unstaking still works (direct program calls)
- ⚠️ Only dashboards/quotes unavailable
- ✅ **No fund loss possible**

---

## API Reference

### Token Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/earn/register` | POST | Register token with template |
| `/earn/token/:mint` | GET | Get token config & stats |
| `/earn/tokens` | GET | List all registered tokens |
| `/earn/templates` | GET | List available templates |

### Trading & Fees

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/earn/trade` | POST | Process trade, collect fees |
| `/earn/quote` | GET | Get fee quote for amount |

### Staking

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/earn/stake` | POST | Stake tokens |
| `/earn/unstake` | POST | Unstake tokens |
| `/earn/claim` | POST | Claim pending rewards |
| `/earn/rewards/:wallet` | GET | Get pending rewards |
| `/earn/staking-stats/:mint` | GET | Pool statistics |

### Dashboards

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/earn/creator/:mint` | GET | Creator dashboard |
| `/earn/stats` | GET | Protocol-wide stats |
| `/earn/operation/:id` | GET | Check operation status |

---

## Integration Patterns

### For Launchpads (pump.fun, Raydium, etc.)

1. Token launches on your platform
2. Creator calls `/earn/register` with template
3. Your swap router calls `/earn/trade` on each trade
4. Fees auto-distribute to all parties

### For Trading Bots

1. Before swap: `GET /earn/quote` to preview fees
2. Execute swap through your DEX
3. Report trade: `POST /earn/trade`
4. Check status: `GET /earn/operation/:id`

### For Agent-to-Agent

```python
# Agent A launches token
response = requests.post(
    f"{EARN_API}/earn/register",
    json={
        "tokenMint": my_token,
        "template": "community",
        "idempotencyKey": f"register-{my_token}-{time.time()}"
    },
    headers={"x-creator-wallet": my_wallet}
)

# Agent B stakes in Agent A's token
response = requests.post(
    f"{EARN_API}/earn/stake",
    json={
        "tokenMint": agent_a_token,
        "amount": 1000000000,
        "idempotencyKey": f"stake-{agent_a_token}-{time.time()}"
    },
    headers={"x-wallet": my_wallet}
)
```

---

## Error Handling

All errors return:
```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

Common errors:
- `Token not registered` - Call `/earn/register` first
- `Insufficient stake balance` - Can't unstake more than staked
- `Missing x-wallet header` - Auth required
- `Earn cut below minimum` - Must be ≥10%

---

## Fee Distribution Example

For a 1000 SOL trade on a `community` template token:

```
Trade Amount: 1000 SOL
Fee (2%):     20 SOL
├── Earn (10%):    2 SOL    → Protocol treasury
├── Creator (10%): 2 SOL    → Creator wallet
├── Buyback (30%): 6 SOL    → Buy & burn tokens
└── Staking (50%): 10 SOL   → Distribute to stakers
```

---

## Safety Features

- **Minimum Earn cut**: 10% (non-negotiable)
- **Maximum fee**: 5% of trade
- **Maximum creator cut**: 30%
- **Minimum staking cut**: 25%
- **Buyback safety rails**: Slippage limits, cooldowns, circuit breakers
- **Anti-farm staking**: Time-weighted rewards, early exit penalties

---

## Network

- **Current**: Solana Devnet
- **Program ID**: (deployed via CI/CD)
- **API Base**: https://earn-api.example.com

---

## Support

- GitHub: https://github.com/earn-ai/earn-protocol
- Issues: https://github.com/earn-ai/earn-protocol/issues
