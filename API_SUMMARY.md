# Earn Protocol API - Summary

## What's Built

### 1. API Server (`api/server.ts`)

**Endpoints:**
```
GET  /              → Returns skill.md
GET  /skill.md      → Agent instructions
GET  /health        → Health check
POST /launch        → Create token on Pump.fun
GET  /token/:mint   → Get token info
GET  /earnings/:wal → Check agent earnings
GET  /tokens        → List all tokens (dashboard)
GET  /tokenomics    → List presets
```

### 2. Launch Endpoint

**Request:**
```bash
curl -X POST https://api.earn.supply/launch \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Token",
    "ticker": "MTK",
    "image": "https://example.com/logo.png",
    "tokenomics": "degen",
    "agentWallet": "AGENT_SOLANA_WALLET"
  }'
```

**Response:**
```json
{
  "success": true,
  "mint": "HYp5GzxZ...",
  "name": "My Token",
  "symbol": "MTK",
  "pumpfun": "https://pump.fun/HYp5GzxZ...",
  "solscan": "https://solscan.io/token/HYp5GzxZ...",
  "agentWallet": "AGENT_SOLANA_WALLET",
  "tokenomics": "degen",
  "agentCut": "50%",
  "earnCut": "50%",
  "txSignature": "2oh8DG..."
}
```

### 3. SKILL.md (served at `/skill.md`)

Clean agent-friendly docs with:
- Quick start curl command
- Required/optional fields
- Tokenomics presets table
- How it works explanation

## What's Proven

✅ Created token on Pump.fun devnet: `HYp5GzxZ1HzsF4kjTpnLqw41mzAe6bknLXNRLtV55gjd`
✅ Earn wallet set as creator (receives fees)
✅ `@pump-fun/pump-sdk` works perfectly
✅ ~0.02 SOL per launch, ~200k CU

## Deployment

**For api.earn.supply:**

```bash
# Install deps
cd api && npm install

# Set env vars
export RPC_URL=https://api.mainnet-beta.solana.com  # or devnet
export EARN_WALLET=/path/to/earn-wallet.json
export PORT=3000

# Run
npm run dev   # development
npm start     # production
```

**Deploy to:**
- Render (current)
- Vercel (edge)
- Railway
- Any Node.js host

## What's Missing (TODO)

1. **IPFS Upload** - Currently requires image URL, should accept base64
2. **On-chain Registry** - Token configs stored in memory, need Solana program
3. **Fee Distribution** - Claim from Pump.fun's creator_vault, split to agents
4. **Dashboard Data** - Frontend needs token stats, earnings

## Files

```
earn-protocol/
├── api/
│   ├── server.ts      # API server
│   └── package.json   # Dependencies
├── scripts/
│   └── launch-token-pumpfun.ts  # Direct launch script
├── PUMPFUN_RESEARCH.md          # Integration research
├── ARCHITECTURE.md              # System design
└── SKILL-NEW.md                 # Agent skill doc
```

## Next Steps

1. Deploy `api/server.ts` to Render/Vercel as `api.earn.supply`
2. Wire up `earn.supply` frontend to read from `/tokens`
3. Add IPFS upload for images
4. Build fee distribution (claim + split)
