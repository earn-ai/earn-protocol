# Earn Protocol Fee Analysis

## Overview

Earn Protocol routes creator fees from Pump.fun to three destinations:
1. **Agent** (token launcher) - passive income
2. **Earn Protocol** - treasury
3. **Stakers** - yield for holding

---

## Pump.fun Fee Structure

| Fee Type | Rate | Recipient |
|----------|------|-----------|
| Trading Fee | 1% total | Split below |
| Protocol Fee | 0.5% | Pump.fun |
| Creator Fee | 0.5% | Token creator (us) |

**Key insight:** When we launch tokens, the Earn wallet is the creator, so we receive 0.5% of all trading volume.

---

## Earn Protocol Tokenomics (degen preset)

| Split | Percentage | Of 0.5% creator fee |
|-------|------------|---------------------|
| Agent | 40% | 0.20% of volume |
| Earn | 30% | 0.15% of volume |
| Stakers | 30% | 0.15% of volume |

---

## Earnings Per Transaction

| Buy Amount | Creator Fee | Agent Gets | Earn Gets | Stakers Get |
|------------|-------------|------------|-----------|-------------|
| 0.01 SOL | 0.00005 SOL | 0.00002 SOL | 0.000015 SOL | 0.000015 SOL |
| 0.1 SOL | 0.0005 SOL | 0.0002 SOL | 0.00015 SOL | 0.00015 SOL |
| 0.5 SOL | 0.0025 SOL | 0.001 SOL | 0.00075 SOL | 0.00075 SOL |
| 1 SOL | 0.005 SOL | 0.002 SOL | 0.0015 SOL | 0.0015 SOL |
| 5 SOL | 0.025 SOL | 0.01 SOL | 0.0075 SOL | 0.0075 SOL |
| 10 SOL | 0.05 SOL | 0.02 SOL | 0.015 SOL | 0.015 SOL |

---

## Daily Earnings Projection

| Daily Volume | Creator Fee | Agent | Earn | Stakers |
|--------------|-------------|-------|------|---------|
| 100 SOL | 0.50 SOL | 0.20 SOL | 0.15 SOL | 0.15 SOL |
| 500 SOL | 2.50 SOL | 1.00 SOL | 0.75 SOL | 0.75 SOL |
| 1,000 SOL | 5.00 SOL | 2.00 SOL | 1.50 SOL | 1.50 SOL |
| 5,000 SOL | 25.00 SOL | 10.00 SOL | 7.50 SOL | 7.50 SOL |
| 10,000 SOL | 50.00 SOL | 20.00 SOL | 15.00 SOL | 15.00 SOL |

---

## Staking APY Example

**Assumptions:**
- Daily volume: 1,000 SOL
- Total staked: 1,000,000 tokens
- Token price: ~0.00001 SOL
- Staked value: ~10 SOL

**Calculation:**
```
Daily staking rewards = 1000 × 0.005 × 0.3 = 1.5 SOL
Daily return = 1.5 / 10 = 15%
APY = 15% × 365 = 5,475%
```

**Note:** APY is dynamic and depends on:
- Trading volume (more volume → more rewards)
- Total staked (more stakers → lower individual APY)
- Token price fluctuations

---

## Fee Flow

```
User trades on Pump.fun
         │
         ▼
    1% trading fee
         │
    ┌────┴────┐
    │         │
    ▼         ▼
 0.5%       0.5%
Protocol   Creator
(pump.fun) (Earn wallet)
              │
              ▼
       creator_vault PDA
              │
         [CRANK runs]
              │
    ┌─────────┼─────────┐
    │         │         │
    ▼         ▼         ▼
  Agent     Earn     Staking
   40%       30%      Pool
                       30%
                        │
                        ▼
               reward_per_token
                   updated
                        │
                        ▼
               Stakers claim
```

---

## Key PDAs

| PDA | Seeds | Purpose |
|-----|-------|---------|
| Creator Vault | `["creator_vault", creator_pubkey]` | Accumulates fees from pump.fun |
| Bonding Curve | `["bonding_curve", mint]` | Pump.fun AMM curve |
| Staking Pool | `["staking-pool", mint]` | Per-token staking pool |
| Stake Account | `["stake-account", pool, user]` | User's stake position |

---

## Current Status

### ✅ Working
- Token launch via API
- Fee accumulation in creator_vault
- Fee calculation logic
- API endpoints

### ⏳ Pending
- Anchor staking program deployment
- Crank automation (fee distribution)
- Live trading test (devnet RPC was down)

---

## Testing Checklist

- [x] Launch token via API
- [x] Verify bonding curve created
- [ ] Buy tokens (RPC down during test)
- [ ] Check creator_vault balance
- [ ] Run distribution crank
- [ ] Verify agent receives funds
- [ ] Stake tokens
- [ ] Claim staking rewards
- [ ] Request unstake
- [ ] Complete unstake after cooldown

---

## Files

| File | Purpose |
|------|---------|
| `api/server.ts` | Main API (launch, stats, etc.) |
| `api/crank.ts` | Fee distribution crank |
| `programs/earn-staking/` | Anchor staking program |
| `tests/full-flow-test.ts` | Complete flow test |

---

*Generated: 2026-02-04*
