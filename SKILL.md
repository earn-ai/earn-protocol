# Earn Protocol — Agent Integration Skill

> **Tokenomics-as-a-Service**: Add fees, buybacks, staking, and creator rewards to any token in one API call.

## Quick Start

```bash
# Register your token
curl -X POST https://api.earn.ai/earn/register \
  -H "Content-Type: application/json" \
  -d '{
    "tokenMint": "YOUR_TOKEN_MINT",
    "creatorWallet": "YOUR_WALLET",
    "config": { "feePercent": 2 }
  }'

# Done. Your token now has real tokenomics.
```

---

## Why Use Earn?

| Problem | Earn Solution |
|---------|---------------|
| Tokens pump and dump | Automatic buybacks support price |
| No reason to hold | Staking rewards pay holders |
| Creator makes nothing | Creator revenue share on every trade |
| Building is hard | One API call, done |

---

## Core Endpoints

### 1. Register Token

```
POST /earn/register
```

**Request:**
```json
{
  "tokenMint": "YourTokenMint...",
  "creatorWallet": "YourWallet...",
  "config": {
    "feePercent": 2,        // 1-5% (required)
    "earnCut": 10,          // 10% min to Earn (default)
    "creatorCut": 20,       // 0-30% to you (default: 20%)
    "buybackPercent": 50,   // % of remainder for buybacks
    "stakingPercent": 50    // % of remainder for stakers
  }
}
```

**Response:**
```json
{
  "success": true,
  "tokenMint": "YourTokenMint...",
  "treasuryPDA": "TreasuryPDA...",
  "config": { ... }
}
```

### 2. Process Trade (Collect Fees)

```
POST /earn/trade
```

**Request:**
```json
{
  "tokenMint": "YourTokenMint...",
  "tradeAmount": 1000000000,
  "tradeType": "buy"
}
```

**Response:**
```json
{
  "success": true,
  "feeCollected": 20000000,
  "distribution": {
    "earn": 2000000,
    "creator": 4000000,
    "buyback": 7000000,
    "staking": 7000000
  }
}
```

### 3. Get Token Stats

```
GET /earn/token/:mint
```

**Response:**
```json
{
  "tokenMint": "...",
  "config": { ... },
  "treasury": {
    "totalFeesCollected": 1000000000,
    "totalBuybacks": 350000000,
    "totalStakingRewards": 350000000,
    "treasuryBalance": 200000000
  },
  "stakingPool": {
    "totalStaked": 5000000000,
    "stakerCount": 42,
    "apy": 12.5
  }
}
```

### 4. Stake Tokens

```
POST /earn/stake
Headers: x-wallet: UserWallet...
```

**Request:**
```json
{
  "tokenMint": "YourTokenMint...",
  "amount": 1000000000
}
```

### 5. Claim Rewards

```
POST /earn/claim
Headers: x-wallet: UserWallet...
```

**Request:**
```json
{
  "tokenMint": "YourTokenMint..."
}
```

---

## Integration Patterns

### Pattern A: Token Launch Agent

```typescript
// Your agent launches a token, then registers with Earn
async function launchWithEarn(tokenMint: string) {
  // 1. Launch token on pump.fun / Raydium / etc
  const mint = await launchToken();
  
  // 2. Register with Earn for instant tokenomics
  await fetch('https://api.earn.ai/earn/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tokenMint: mint,
      creatorWallet: AGENT_WALLET,
      config: { feePercent: 2, creatorCut: 20 }
    })
  });
  
  // Your token now has buybacks, staking, and you earn 20% of fees!
}
```

### Pattern B: DEX/Trading Agent

```typescript
// Route trades through Earn to collect fees
async function executeTradeWithFees(trade: Trade) {
  // 1. Call Earn's trade endpoint (wraps Jupiter)
  const result = await fetch('https://api.earn.ai/earn/trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tokenMint: trade.tokenMint,
      tradeAmount: trade.amount,
      tradeType: trade.side
    })
  });
  
  // Fees automatically distributed to creator, stakers, buybacks
}
```

### Pattern C: Staking Frontend

```typescript
// Let users stake tokens registered with Earn
async function stakeForUser(wallet: string, mint: string, amount: number) {
  const response = await fetch('https://api.earn.ai/earn/stake', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-wallet': wallet
    },
    body: JSON.stringify({ tokenMint: mint, amount })
  });
  
  // User now earns time-weighted rewards!
}
```

---

## Fee Distribution Breakdown

```
2% fee on $1000 trade = $20 collected

┌────────────────────────────────┐
│ $2  (10%) → Earn Protocol      │
│ $4  (20%) → Token Creator      │
│ $7  (35%) → Buyback Pool       │
│ $7  (35%) → Staking Rewards    │
└────────────────────────────────┘
```

**Configurable within limits:**
- `feePercent`: 1-5%
- `earnCut`: 10% minimum (non-negotiable)
- `creatorCut`: 0-30%
- `buybackPercent` + `stakingPercent` = 100% of remainder

---

## Safety Features

### Buyback Protection
- 3% max slippage
- $10k minimum pool liquidity
- 5% max pool impact per buyback
- 1 hour cooldown between buybacks
- Circuit breaker on >20% volatility

### Anti-Farm Staking
- Time-weighted rewards (1x → 3x over 90 days)
- 5% early exit penalty if unstake < 7 days
- Penalties go to loyal stakers

### Creator Security
- Creator address immutable after registration
- Proof of ownership required (mint/metadata authority)

---

## Error Handling

| Error Code | Meaning | Fix |
|------------|---------|-----|
| `TOKEN_NOT_REGISTERED` | Token not in Earn | Call `/earn/register` first |
| `INVALID_FEE_CONFIG` | Fee params out of bounds | Check limits above |
| `INSUFFICIENT_STAKE` | Not enough tokens | Check balance |
| `COOLDOWN_ACTIVE` | Buyback cooldown | Wait 1 hour |
| `CREATOR_MISMATCH` | Wrong creator wallet | Use original wallet |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Register | 10/hour per wallet |
| Trade | 100/minute per token |
| Stake/Unstake | 20/minute per wallet |
| Read endpoints | 1000/minute |

---

## Webhooks (Coming Soon)

```json
POST your-webhook-url
{
  "event": "fee_collected",
  "tokenMint": "...",
  "amount": 20000000,
  "distribution": { ... },
  "timestamp": 1706918400
}
```

Events: `fee_collected`, `buyback_executed`, `stake_created`, `rewards_claimed`

---

## SDK (Coming Soon)

```typescript
import { EarnSDK } from '@earn-ai/sdk';

const earn = new EarnSDK({ wallet: myWallet });

// One-liner registration
await earn.register(tokenMint, { feePercent: 2 });

// One-liner staking
await earn.stake(tokenMint, amount);
```

---

## Questions?

- **GitHub**: https://github.com/earn-ai/earn-protocol
- **Moltbook**: https://moltbook.com/m/earn
- **Wallet**: `EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ`

---

*Built for the Colosseum Agent Hackathon 2026*
