# Earn Protocol - API Documentation

Everything you need to launch tokens and earn from trading fees.

---

## Quick Start

Launch a token with a single API call. No authentication required.

```bash
curl -X POST https://api.earn.supply/launch \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Token",
    "ticker": "MTK",
    "image": "https://example.com/logo.png",
    "tokenomics": "degen"
  }'
```

That's it. Earn creates your token on Pump.fun, collects trading fees, and distributes your cut automatically.

---

## Base URL

```
https://api.earn.supply
```

No authentication required. All endpoints are public.

---

## Launch Token

Create a new token on Pump.fun.

**POST** `/launch`

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | ✅ | Token name (2-32 characters) |
| ticker | string | ✅ | Token symbol (2-10 letters) |
| image | string | ✅ | Image URL or base64 encoded |
| tokenomics | string | ✅ | Fee split template (see below) |
| agentWallet | string | ❌ | Your Solana wallet (defaults to Earn) |
| description | string | ❌ | Token description (max 500 chars) |
| website | string | ❌ | Project website URL |
| twitter | string | ❌ | Twitter/X handle or URL |

### Example Request

```bash
curl -X POST https://api.earn.supply/launch \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Degen Cat",
    "ticker": "DCAT",
    "image": "https://i.imgur.com/abc123.png",
    "tokenomics": "degen",
    "agentWallet": "YourSolanaWalletAddress"
  }'
```

### Example Response

```json
{
  "success": true,
  "mint": "ABC123...",
  "name": "Degen Cat",
  "symbol": "DCAT",
  "pumpfun": "https://pump.fun/ABC123...",
  "staking": "https://earn.supply/stake/ABC123...",
  "agentWallet": "YourSolanaWalletAddress",
  "tokenomics": "degen",
  "feeSplit": {
    "agent": "40%",
    "earn": "30%",
    "stakers": "30%"
  },
  "txSignature": "5xYz..."
}
```

---

## Tokenomics Templates

Choose how trading fees are split between you, Earn, and stakers.

| Template | You (Agent) | Earn | Stakers | Best For |
|----------|-------------|------|---------|----------|
| **degen** | 40% | 30% | 30% | High volume meme coins |
| **creator** | 50% | 25% | 25% | Content creators, max earnings |
| **community** | 25% | 25% | 50% | DAO-style, reward holders |

**How it works:**
1. Users trade your token on Pump.fun
2. Creator fees (1%) flow to Earn wallet
3. Earn distributes according to your chosen split
4. Stakers earn by staking your token on earn.supply

---

## Get Token

Retrieve details for a registered token.

**GET** `/token/:mint`

### Example

```bash
curl https://api.earn.supply/token/ABC123...
```

### Response

```json
{
  "success": true,
  "mint": "ABC123...",
  "name": "Degen Cat",
  "symbol": "DCAT",
  "tokenomics": "degen",
  "agentWallet": "...",
  "agentCutBps": 4000,
  "earnCutBps": 3000,
  "stakingCutBps": 3000,
  "createdAt": "2024-01-15T12:00:00Z",
  "pumpfun": "https://pump.fun/ABC123..."
}
```

---

## List All Tokens

Get all tokens launched through Earn.

**GET** `/tokens`

### Query Parameters

| Param | Description |
|-------|-------------|
| page | Page number (default: 1) |
| limit | Results per page (default: 20, max: 100) |
| tokenomics | Filter by template (degen/creator/community) |
| agent | Filter by agent wallet address |
| search | Search by name or symbol |
| sort | Sort order (newest/oldest) |

### Example

```bash
curl "https://api.earn.supply/tokens?tokenomics=degen&limit=10"
```

---

## Get Stats

Global protocol statistics.

**GET** `/stats`

### Response

```json
{
  "success": true,
  "earnWallet": "EARN...",
  "network": "mainnet",
  "totalLaunches": 150,
  "totalAgents": 42,
  "launchesByTokenomics": {
    "degen": 80,
    "creator": 50,
    "community": 20
  },
  "lastLaunch": "2024-01-15T12:00:00Z"
}
```

---

## Staking

### Get All Staking Pools

**GET** `/stake/pools`

Returns all active staking pools with stats.

### Get Pool Details

**GET** `/stake/pool/:mint`

Get details for a specific token's staking pool.

### Get User Stakes

**GET** `/stake/user/:wallet`

Get all staking positions for a wallet.

### Example

```bash
curl https://api.earn.supply/stake/pools
```

### Response

```json
{
  "success": true,
  "count": 5,
  "pools": [
    {
      "mint": "ABC123...",
      "symbol": "DCAT",
      "totalStaked": "1000000",
      "stakerCount": 25,
      "rewardsAvailable": "0.5000 SOL",
      "stakingUrl": "https://earn.supply/stake/ABC123..."
    }
  ]
}
```

---

## Agent Earnings

Check earnings for an agent wallet.

**GET** `/earnings/:wallet`

### Example

```bash
curl https://api.earn.supply/earnings/YourWalletAddress
```

### Response

```json
{
  "success": true,
  "wallet": "YourWalletAddress",
  "tokensLaunched": 3,
  "tokens": [
    {
      "mint": "ABC123...",
      "name": "Degen Cat",
      "symbol": "DCAT",
      "tokenomics": "degen",
      "agentCut": "40%"
    }
  ],
  "totalEarned": "1.5 SOL",
  "pendingClaim": "0.2 SOL"
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad request - Invalid or missing parameters |
| 404 | Not found - Token not registered |
| 429 | Too many requests - Rate limited (10/min) |
| 500 | Server error - Try again later |

### Error Response Format

```json
{
  "success": false,
  "error": "Description of what went wrong",
  "requestId": "abc123"
}
```

---

## Rate Limits

- **10 requests per minute** per IP
- Applies to POST endpoints only
- GET endpoints are unlimited

---

## Earn Wallet

All fees flow through the Earn wallet:

```
EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ
```

This wallet:
- 💰 Collects creator fees from Pump.fun
- 📤 Distributes earnings to agents
- 🔄 Performs token buybacks
- 💎 Pays staking rewards

---

## Need Help?

- **Interactive Form**: [api.earn.supply](https://api.earn.supply)
- **Dashboard**: [earn.supply](https://earn.supply)
- **GitHub**: [github.com/earn-ai/earn-protocol](https://github.com/earn-ai/earn-protocol)
