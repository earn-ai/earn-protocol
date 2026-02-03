# AgentDEX Integration Guide

Route AgentDEX swaps through Earn Protocol to give users automatic tokenomics benefits.

## Overview

```
User wants to swap SOL → MEME
         ↓
AgentDEX calls Earn /earn/trade
         ↓
Earn checks if MEME is registered
         ↓
┌─────────────────────────────────────┐
│ If registered:                      │
│ • Earn executes swap via Jupiter    │
│ • Collects fee (2%)                 │
│ • Distributes to buyback/staking    │
│ • Returns swap result to AgentDEX   │
├─────────────────────────────────────┤
│ If not registered:                  │
│ • Pass through to Jupiter directly  │
│ • No fee (token hasn't opted in)    │
└─────────────────────────────────────┘
```

## Endpoint

### POST /earn/trade

**Headers:**
```
Content-Type: application/json
Idempotency-Key: trade-{unique}-{timestamp}  (optional, recommended)
```

**Request:**
```json
{
  "tokenMint": "YourTokenMint...",
  "inputToken": "So11111111111111111111111111111111111111112",
  "outputToken": "YourTokenMint...",
  "amount": "1000000000",
  "slippageBps": 300,
  "userWallet": "UserWalletPubkey..."
}
```

**Response (Token Registered):**
```json
{
  "success": true,
  "operationId": "op_7xKXtg2CW87d",
  "status": "completed",
  "result": {
    "feeDistribution": {
      "totalFee": "20000000",
      "earnAmount": "2000000",
      "creatorAmount": "4000000",
      "buybackAmount": "7000000",
      "stakingAmount": "7000000"
    }
  }
}
```

**Response (Token Not Registered):**
```json
{
  "success": true,
  "operationId": "op_8yLYuh3DX98e",
  "status": "completed",
  "result": {
    "feeDistribution": {
      "totalFee": "0",
      "earnAmount": "0",
      "creatorAmount": "0",
      "buybackAmount": "0",
      "stakingAmount": "0"
    },
    "passthrough": true,
    "reason": "Token not registered with Earn"
  }
}
```

## TypeScript Integration

```typescript
import { EarnSDK } from '@earn-protocol/sdk';

const earn = new EarnSDK({
  baseUrl: 'https://earn-protocol.onrender.com',
  network: 'devnet'
});

// In your swap handler
async function handleSwap(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippage: number;
  user: string;
}) {
  const result = await earn.trade({
    tokenMint: params.outputMint,  // The token being bought
    inputToken: params.inputMint,
    outputToken: params.outputMint,
    amount: params.amount,
    slippageBps: params.slippage,
    userWallet: params.user
  });

  // Result includes fee breakdown if token is registered
  console.log('Trade result:', result);
  
  if (result.result?.feeDistribution) {
    console.log('Fees collected:', result.result.feeDistribution.totalFee);
  }

  return result;
}
```

## cURL Example

```bash
# Execute trade through Earn
curl -X POST https://earn-protocol.onrender.com/earn/trade \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: trade-agentdex-$(date +%s)" \
  -d '{
    "tokenMint": "TokenMintAddress...",
    "inputToken": "So11111111111111111111111111111111111111112",
    "outputToken": "TokenMintAddress...",
    "amount": "1000000000",
    "slippageBps": 300,
    "userWallet": "UserWallet..."
  }'
```

## Check If Token Is Registered

Before routing through Earn, you can check if a token has tokenomics enabled:

```bash
curl https://earn-protocol.onrender.com/earn/token/TokenMintAddress...
```

**Response (Registered):**
```json
{
  "config": {
    "tokenMint": "TokenMintAddress...",
    "feePercent": 2,
    "active": true
  }
}
```

**Response (Not Registered):**
```json
{
  "error": "Token not registered"
}
```

## Benefits for AgentDEX Users

| Feature | Without Earn | With Earn |
|---------|--------------|-----------|
| Swap execution | Jupiter | Jupiter (same quality) |
| Staking rewards | ❌ | ✅ Auto-accumulate |
| Price support | ❌ | ✅ Buybacks |
| Creator revenue | ❌ | ✅ Sustainable |
| Fee transparency | ❌ | ✅ On-chain breakdown |

## Integration Modes

### 1. Always Route Through Earn (Recommended)
Route all swaps through Earn. Unregistered tokens pass through with no fee.

```typescript
// Simple: always call Earn
const result = await earn.trade(swapParams);
```

### 2. Check First, Then Route
Check if token is registered before deciding routing.

```typescript
const tokenInfo = await earn.getToken(outputMint);
if (tokenInfo.config?.active) {
  // Route through Earn for fee collection
  return earn.trade(swapParams);
} else {
  // Route directly to Jupiter
  return jupiter.swap(swapParams);
}
```

### 3. User Choice
Let users opt-in to Earn-enabled swaps.

```typescript
if (user.wantsEarnBenefits) {
  return earn.trade(swapParams);
} else {
  return jupiter.swap(swapParams);
}
```

## Idempotency

All trades support idempotency keys for safe retries:

```typescript
const result = await earn.trade({
  ...swapParams,
  idempotencyKey: `trade-${txId}-${Date.now()}`
});

// Same key = same result, even if called multiple times
```

## Error Handling

```typescript
try {
  const result = await earn.trade(swapParams);
  if (!result.success) {
    console.error('Trade failed:', result.error);
  }
} catch (error) {
  // Network error, retry with same idempotency key
}
```

## Questions?

- **Forum:** Ping @earn on Colosseum
- **GitHub:** https://github.com/earn-ai/earn-protocol/issues
- **SDK:** https://github.com/earn-ai/earn-protocol/blob/main/SKILL.md

---

*Let's be the first live integration in this hackathon.* 🤝
