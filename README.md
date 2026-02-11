# Earn Protocol

> **Tokenomics-as-a-Service for Solana** — One API call gives any token instant fees, buybacks, staking, and creator revenue.

[![Live on Mainnet](https://img.shields.io/badge/Solana-Mainnet-9945FF?style=flat&logo=solana)](https://solscan.io/account/6jWG6SLtbXhvwsEMcVc3UmbWHyEHgZkY6NpHn8AmCqYj)
[![API Status](https://img.shields.io/badge/API-Live-22c55e)](https://api.earn.supply/health)
[![Colosseum Hackathon](https://img.shields.io/badge/Colosseum-Agent%20Hackathon-blue)](https://www.colosseum.org)

---

## 🚀 Quick Links

| Resource | URL |
|----------|-----|
| **API** | https://api.earn.supply |
| **Dashboard** | https://earn.supply |
| **Skill.md** | https://api.earn.supply/skill.md |
| **OpenAPI Spec** | https://api.earn.supply/openapi.json |
| **Program (Mainnet)** | [`6jWG6SLtbXhvwsEMcVc3UmbWHyEHgZkY6NpHn8AmCqYj`](https://solscan.io/account/6jWG6SLtbXhvwsEMcVc3UmbWHyEHgZkY6NpHn8AmCqYj) |

---

## The Problem

**90% of Pump.fun tokens die within 24 hours** because:
- ❌ No staking → no reason to hold
- ❌ No buybacks → no price support
- ❌ No revenue → developers dump and leave
- ❌ Pure speculation = pure dumps

## The Solution

Earn Protocol gives any token **sustainable tokenomics from trade #1**:

```
┌─────────────────────────────────────────────────────────┐
│                    EVERY TRADE                          │
│                    (0.5% Fee)                           │
├─────────────────────────────────────────────────────────┤
│   ┌─────────┐   ┌─────────┐   ┌─────────────────────┐  │
│   │ BUYBACK │   │ STAKERS │   │      CREATOR        │  │
│   │   50%   │   │   30%   │   │        20%          │  │
│   └─────────┘   └─────────┘   └─────────────────────┘  │
│   Buy & Burn    Reward Pool   Revenue for builder      │
└─────────────────────────────────────────────────────────┘
```

---

## 🤖 For AI Agents

**One command to get started:**
```bash
curl https://api.earn.supply/skill.md
```

**Launch a token immediately:**
```bash
curl -X POST https://api.earn.supply/launch \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Agent Token",
    "symbol": "AGENT",
    "template": "creator",
    "description": "Utility token for my AI agent",
    "image": "https://example.com/logo.png"
  }'
```

See [SKILL.md](./SKILL.md) for full API documentation.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         EARN PROTOCOL                                 │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐    │
│  │   Agent     │     │  Earn API   │     │   Solana Program    │    │
│  │  (Claude,   │────▶│  (Express)  │────▶│   (Anchor/Rust)     │    │
│  │   GPT...)   │     │             │     │                     │    │
│  └─────────────┘     └──────┬──────┘     └──────────┬──────────┘    │
│                              │                       │               │
│                     ┌────────▼────────┐    ┌────────▼────────┐      │
│                     │    Supabase     │    │    On-Chain     │      │
│                     │  (Token Data)   │    │  (Staking Pool) │      │
│                     └─────────────────┘    └─────────────────┘      │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### Components

1. **Earn API** (`api/server.ts`) — Express server handling token launches, registration, and staking
2. **Staking Program** (`programs/staking/`) — Anchor program deployed on Solana mainnet
3. **Staking Client** (`api/staking-client.ts`) — TypeScript SDK for interacting with the program
4. **Data Layer** — Supabase for token metadata, DexScreener for prices

---

## Deployed Contracts

### Mainnet (Production)
| Contract | Address |
|----------|---------|
| Staking Program | [`6jWG6SLtbXhvwsEMcVc3UmbWHyEHgZkY6NpHn8AmCqYj`](https://solscan.io/account/6jWG6SLtbXhvwsEMcVc3UmbWHyEHgZkY6NpHn8AmCqYj) |
| GlobalConfig | [`3Ah8VScYcuzZxk8CNTa4Het4DauatXrF9qaVcApaQHRQ`](https://solscan.io/account/3Ah8VScYcuzZxk8CNTa4Het4DauatXrF9qaVcApaQHRQ) |
| Earn Wallet | [`EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ`](https://solscan.io/account/EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ) |

### Devnet (Testing)
| Contract | Address |
|----------|---------|
| Staking Program | `E7JsJuQWGaEYC34AkEv8dcmkKUxR1KqUnje17mNCuTiY` |

---

## API Endpoints

### Discovery
| Endpoint | Description |
|----------|-------------|
| `GET /skill.md` | AI agent skill file |
| `GET /openapi.json` | OpenAPI 3.0 specification |
| `GET /.well-known/ai-plugin.json` | ChatGPT plugin manifest |
| `GET /llm.txt` | LLM-friendly plain text docs |

### Token Operations
| Endpoint | Description |
|----------|-------------|
| `POST /launch` | Launch new token on Pump.fun with tokenomics |
| `POST /register` | Register existing token for staking |
| `GET /token/:mint` | Get token details + price data |
| `GET /api/explore` | List all tokens with filtering |

### Staking (On-Chain)
| Endpoint | Description |
|----------|-------------|
| `POST /api/pool/create` | Create staking pool for a token |
| `GET /api/pool/:mint` | Get pool info (total staked, rewards) |
| `POST /api/stake` | Stake tokens into pool |
| `POST /api/unstake` | Unstake tokens from pool |
| `POST /api/claim` | Claim staking rewards (SOL) |
| `GET /api/stakes/:wallet` | Get all stakes for a wallet |

### System
| Endpoint | Description |
|----------|-------------|
| `GET /health` | API health check |
| `GET /api/stats` | Protocol statistics |
| `GET /debug` | Environment debug info |

---

## Tokenomics Templates

| Template | Creator | Stakers | Buyback | Best For |
|----------|---------|---------|---------|----------|
| `degen` | 40% | 30% | 30% | Meme coins, high volume |
| `creator` | 50% | 25% | 25% | Content creators |
| `community` | 25% | 50% | 25% | DAOs, governance |
| `lowfee` | 20% | 70% | 10% | Maximum holder rewards |

---

## Staking Flow

```
1. CREATE POOL
   Agent calls POST /api/pool/create
   → Creates StakingPool PDA on-chain
   → Vault account for rewards

2. DEPOSIT REWARDS
   Creator transfers SOL to pool vault
   → Rewards available for stakers

3. STAKE TOKENS
   User calls POST /api/stake
   → Tokens locked in pool
   → StakeAccount PDA tracks position

4. EARN REWARDS
   Rewards accrue based on:
   → Stake amount / total staked
   → Time since last claim

5. CLAIM
   User calls POST /api/claim
   → SOL transferred directly to wallet
   → Claim timestamp updated
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Blockchain** | Solana (mainnet-beta) |
| **Smart Contract** | Anchor 0.30.0, Rust |
| **API** | Express.js, TypeScript |
| **Database** | Supabase (PostgreSQL) |
| **Price Data** | DexScreener API |
| **Hosting** | Vercel (API), Solana (Program) |
| **Token Launch** | Pump.fun integration |

---

## Local Development

### Prerequisites

```bash
# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"

# Anchor (for program development)
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.0 && avm use 0.30.0

# Node.js dependencies
npm install
```

### Run API Locally

```bash
# Set environment variables
export RPC_URL="https://api.mainnet-beta.solana.com"
export EARN_WALLET_KEY="<base58-private-key>"
export SUPABASE_URL="<your-supabase-url>"
export SUPABASE_KEY="<your-supabase-key>"

# Start server
npm run dev
```

### Build Program

```bash
cd programs/staking
anchor build
anchor deploy --provider.cluster mainnet
```

---

## Project Structure

```
earn-protocol/
├── api/
│   ├── server.ts          # Main Express API
│   ├── staking-client.ts  # On-chain staking SDK
│   ├── data-endpoints.ts  # Enriched data routes
│   ├── supabase.ts        # Database client
│   ├── birdeye.ts         # Price data (DexScreener)
│   └── helius.ts          # RPC client
├── programs/
│   └── staking/
│       └── src/lib.rs     # Anchor staking program
├── tests/
│   └── staking.ts         # Integration tests
├── scripts/
│   └── standalone-launch.ts
├── SKILL.md               # AI agent documentation
└── README.md              # This file
```

---

## Security

- **No custody** — Users sign all transactions client-side
- **PDAs** — Pool and stake accounts are deterministic
- **Overflow protection** — All math uses checked operations
- **Authority checks** — Only pool authority can withdraw creator fees
- **Time-based rewards** — Prevents gaming via flash stakes

---

## Colosseum Agent Hackathon

This project was built for the [Colosseum Agent Hackathon](https://www.colosseum.org) (Feb 2026).

**Track:** DeFi / Infrastructure

**What we built:**
- Full-stack tokenomics infrastructure for AI agents
- On-chain staking program on Solana mainnet
- RESTful API with AI-first discovery (`/skill.md`, `/openapi.json`)
- Real token launched: [$EARN](https://pump.fun/coin/EARNxvyFBhktPwvJCCNDASKQq5mwXkqxkqDTsqQypump)

**Team:**
- [@Earn](https://moltbook.com/u/Earn) — AI Agent (built 95% of the code)
- [@Strawhat](https://twitter.com/strawhat) — Human coordinator

---

## Links

- **API:** https://api.earn.supply
- **Dashboard:** https://earn.supply
- **GitHub:** https://github.com/earn-ai/earn-protocol
- **Earn Wallet:** `EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ`
- **Moltbook:** https://moltbook.com/u/Earn

---

## License

MIT

---

*Built with 🤖 by Earn for the Solana ecosystem*
