# Earn Protocol Refactor Plan

## The New Model

```
Agent → Earn → Pump.fun → Users trade → Fees → Agent gets paid
```

Earn = Pump.fun wrapper + tokenomics router + revenue distribution

## What We're Building

| Component | Purpose | Status |
|-----------|---------|--------|
| Earn Program (Solana) | Store agent configs, distribute fees | Needs simplification |
| earn-cli | Agent-facing CLI tool | Needs building |
| earn.supply | Dashboard (reads from chain only) | Needs refactor |
| SKILL.md | Simple agent instructions | ✅ Draft ready |

## What We're Deleting

- [ ] `src/api.ts` - Express server
- [ ] `src/swap.ts` - Jupiter integration
- [ ] `src/protocol.ts` - TypeScript SDK
- [ ] `src/types.ts` - API types
- [ ] All `/earn/*` REST endpoints
- [ ] Vercel deployment (api.earn.supply)
- [ ] Any backend/database code

## Solana Program Changes

**Current (complex):**
- register, collect_fee, stake, unstake, claim_rewards, execute_buyback
- Staking pools, buybacks, creator cuts

**New (simple):**
```rust
// PDAs
GlobalConfig { total_launches, total_volume, earn_wallet }
TokenConfig { mint, agent_wallet, tokenomics_style, total_earned, pump_fun_data }

// Instructions
initialize_global_config()      // One-time setup
register_token(agent_wallet, tokenomics_style, pump_fun_mint)
distribute_fees(amount)         // Called when fees arrive from Pump.fun
claim_earnings()                // Agent withdraws (if not auto-sent)
```

## earn-cli Structure

```
cli/
├── package.json          # @earn-protocol/cli
├── src/
│   ├── index.ts          # CLI entry point
│   ├── commands/
│   │   ├── launch.ts     # Launch token on Pump.fun
│   │   ├── earnings.ts   # Check earnings
│   │   ├── token.ts      # View token info
│   │   └── stats.ts      # Global stats
│   ├── lib/
│   │   ├── pumpfun.ts    # Pump.fun SDK integration
│   │   ├── ipfs.ts       # Image upload
│   │   ├── earn.ts       # Earn program client
│   │   └── wallet.ts     # Wallet handling
│   └── types.ts
├── README.md
└── tsconfig.json
```

## earn.supply Changes

**Current:** Reads from Render API
**New:** Reads from chain only

```typescript
// src/lib/chain.ts
import { Connection, PublicKey } from '@solana/web3.js';

export async function getGlobalStats() {
  const globalConfig = await program.account.globalConfig.fetch(GLOBAL_CONFIG_PDA);
  return {
    totalLaunches: globalConfig.totalLaunches.toNumber(),
    totalVolume: globalConfig.totalVolume.toNumber(),
    totalPaid: globalConfig.totalDistributed.toNumber()
  };
}

export async function getAllTokens() {
  // Fetch all TokenConfig accounts
  const tokens = await program.account.tokenConfig.all();
  return tokens.map(t => ({
    mint: t.account.mint.toString(),
    agentWallet: t.account.agentWallet.toString(),
    tokenomics: t.account.tokenomicsStyle,
    earned: t.account.totalEarned.toNumber()
  }));
}
```

## 🔴 OPEN QUESTIONS (Need Research)

### 1. Pump.fun Launch Mechanism
**Question:** How do we programmatically create a token on Pump.fun?
**Options:**
- A) Pump.fun has a public SDK/API
- B) Call their Solana program directly
- C) Use their website with automation (bad)

**Research needed:** Find Pump.fun program ID, IDL, or SDK

### 2. Pump.fun Fee Mechanism
**Question:** How does the creator get fees?
**What we know:** Pump.fun has ~1% creator fee
**Need to confirm:** 
- Is it sent per-trade or batched?
- Is the creator set at token creation?
- Can we set Earn wallet as creator?

### 3. Image Hosting
**Question:** Where do token images live?
**Options:**
- A) Pump.fun handles it (ideal)
- B) IPFS via NFT.Storage (free)
- C) Arweave (permanent, costs SOL)

**Recommendation:** IPFS via NFT.Storage → pass URI to Pump.fun

### 4. Custom Fee Percentages
**Question:** Pump.fun's creator fee is ~1%. Our tokenomics styles have 0.5-2%.
**Options:**
- A) Use Pump.fun's 1% as base, only vary agent/earn split
- B) Add additional fee layer via Jupiter routing
- C) Wait for Raydium graduation for custom fees

**Recommendation:** Start with (A), agent cut varies within Pump.fun's 1%

### 5. Raydium Graduation
**Question:** When token graduates to Raydium (~$69k mcap), how do we keep routing fees?
**Options:**
- A) Jupiter routing wrapper for Raydium trades
- B) Different fee mechanism for graduated tokens
- C) Fees stop at graduation (bad)

## Task Order

1. **Research Pump.fun** - Find SDK/program/API
2. **Simplify Solana program** - Strip to register + distribute
3. **Build earn-cli** - Launch command first
4. **Refactor earn.supply** - Chain reads only
5. **Delete backend** - Remove Render, API, etc.
6. **Test on devnet** - Full flow
7. **Deploy to mainnet** - Launch!

## Timeline (8 days to hackathon end)

| Day | Task |
|-----|------|
| 1 | Research Pump.fun integration |
| 2 | Simplify Solana program |
| 3 | Build earn-cli (launch command) |
| 4 | Build earn-cli (other commands) |
| 5 | Refactor earn.supply |
| 6 | Delete backend, test devnet |
| 7 | Test, fix bugs |
| 8 | Deploy mainnet, submit |

## Files Ready

- [x] `ARCHITECTURE.md` - High-level design
- [x] `SKILL-NEW.md` - Agent instructions (draft)
- [x] `cli/README.md` - CLI spec
- [x] `REFACTOR-PLAN.md` - This file
