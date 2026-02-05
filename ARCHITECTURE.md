# Earn Protocol Architecture

## What Earn Does

Earn launches tokens on Pump.fun on behalf of agents, then routes revenue automatically.

```
Agent provides:          Earn handles:              Agent receives:
─────────────────────    ──────────────────────     ─────────────────
• Wallet address         • Pump.fun launch          • Passive income
• Ticker, name, image    • Fee collection           • Automatic payouts
• Tokenomics style       • Revenue distribution     • Earnings dashboard
```

## The Flow

```
1. Agent runs: earn-cli launch --ticker AGC --name "Agent Coin" --image logo.png --tokenomics degen

2. Earn receives request
   → Validates inputs
   → Uploads image to storage
   → Creates TokenConfig PDA (stores agent wallet + tokenomics)
   → Calls Pump.fun to launch token (Earn wallet = creator)
   → Returns token mint address

3. Token is live on Pump.fun
   → Users trade normally
   → Pump.fun sends creator fees (1%) to Earn wallet

4. Earn distributes fees
   → Agent cut → Agent wallet (based on tokenomics style)
   → Earn cut → Earn treasury

5. Agent checks earnings: earn-cli earnings
   → "You've earned 4.2 SOL from AGC"
```

## Tokenomics Styles

| Style     | Fee  | Agent Cut | Earn Cut | Best For               |
|-----------|------|-----------|----------|------------------------|
| Degen     | 2%*  | 50%       | 50%      | High volume memes      |
| Creator   | 1.5%*| 60%       | 40%      | Content creators       |
| Community | 1%*  | 40%       | 30%+30%  | Long-term projects     |
| Low Fee   | 0.5%*| 50%       | 50%      | Maximum trading volume |

*Note: Pump.fun's native creator fee is ~1%. "Fee" here means what Earn takes from that 1%.
For higher fee styles, Earn may add a wrapper or use Jupiter routing.

## Components

### 1. Earn Program (Solana)

**PDAs:**
```
GlobalConfig
├── authority: Earn multisig
├── total_launches: u64
├── total_volume: u64
├── total_distributed: u64
└── earn_wallet: Pubkey

TokenConfig (per token)
├── mint: Pubkey
├── agent_wallet: Pubkey
├── tokenomics_style: enum
├── total_earned: u64
├── total_claimed: u64
├── created_at: i64
└── pump_fun_created: bool
```

**Instructions:**
- `register_token` - Store agent wallet + tokenomics for a token
- `distribute_fees` - Route accumulated fees to agent
- `claim_earnings` - Agent withdraws their balance
- `update_stats` - Crank to update global stats

### 2. earn-cli (NPM Package)

```bash
npm i -g @earn-protocol/cli

# Launch a token
earn-cli launch \
  --ticker "AGC" \
  --name "Agent Coin" \
  --image ./logo.png \
  --tokenomics degen \
  --wallet ./wallet.json

# Check earnings
earn-cli earnings --wallet ./wallet.json

# View token stats
earn-cli token --mint <TOKEN_MINT>

# Global protocol stats
earn-cli stats
```

### 3. earn.supply Frontend

**Reads from chain only (no backend):**
- GlobalConfig PDA → total launches, volume, earnings
- TokenConfig PDAs → all registered tokens
- Pump.fun API → trading activity, prices

**Shows:**
- All tokens launched via Earn
- Per-token: volume, agent earnings, tokenomics style
- Global: total launches, total paid to agents
- Launch form (same as CLI)

### 4. SKILL.md

Simple agent instructions:
1. Create wallet
2. Get SOL for gas
3. Run `earn-cli launch`
4. Receive passive income

## Pump.fun Integration

### Option A: Creator Fee Routing (Simplest)
- Earn wallet is the "creator" on Pump.fun
- Pump.fun sends 1% creator fee to Earn
- Earn program distributes to agents

**Pros:** Simple, uses Pump.fun's native mechanism
**Cons:** Limited to 1% fee, can't customize per-token

### Option B: Jupiter Routing (Current)
- Wrap trades through Jupiter
- Add custom fee on top of Pump.fun
- More control over fee percentage

**Pros:** Flexible fees, can implement tokenomics styles
**Cons:** More complex, users must route through Earn

### Option C: Hybrid
- Use Pump.fun native for launches
- Offer Jupiter routing for "premium" tokenomics
- Agent chooses at launch time

**Recommendation:** Start with Option A (creator fee routing), add Option B later.

## Image Hosting

Options:
1. **Pump.fun handles it** - If their API accepts images
2. **IPFS via NFT.Storage** - Free, decentralized
3. **Arweave** - Permanent, costs SOL
4. **Shadow Drive** - Solana-native storage

**Recommendation:** IPFS via NFT.Storage (free + decentralized)

## What Gets Deleted

- ❌ Vercel API (api.earn.supply)
- ❌ Express server (src/api.ts)
- ❌ All backend routes
- ❌ Database/state management
- ❌ Jupiter swap integration (for now)

## What Gets Built

- ✅ Simplified Solana program (register + distribute)
- ✅ earn-cli NPM package
- ✅ Pump.fun launch integration
- ✅ Chain-reading frontend
- ✅ Clear SKILL.md

## Key Addresses

```
Earn Program: <TO_BE_DEPLOYED>
Earn Treasury: EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ
Network: mainnet-beta (devnet for testing)
```

## Open Questions

1. **Pump.fun API access** - Do they have a programmatic launch API, or do we need to reverse-engineer?
2. **Fee timing** - When do Pump.fun creator fees arrive? Per-trade or batched?
3. **Graduation handling** - What happens to fee routing when token graduates to Raydium?
