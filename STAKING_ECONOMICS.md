# Staking Economics

## Key Insight: APY is Dynamic, Not Fixed

Staking rewards come from **trading fees**, not token inflation. This means:
- No minting new tokens (sustainable)
- APY depends on trading volume
- Self-balancing mechanism

## The Formula

```
Daily Rewards = Daily Volume × Pump.fun Fee × Staking Cut
APY = (Daily Rewards × 365) / Total Staked × 100
```

**Variables:**
- Pump.fun creator fee: ~1% of trades
- Our staking cut: 25-50% (depends on tokenomics)
- Trading volume: varies by token
- Total staked: varies by participation

## Example Scenarios

### Token with $100K Daily Volume (Active)

**Tokenomics: Degen (30% to stakers)**

| Total Staked | Daily Rewards | APY |
|--------------|--------------|-----|
| $10K | $300 | **1,095%** 🔥 |
| $50K | $300 | **219%** |
| $100K | $300 | **110%** |
| $200K | $300 | **55%** |

**Tokenomics: Community (50% to stakers)**

| Total Staked | Daily Rewards | APY |
|--------------|--------------|-----|
| $10K | $500 | **1,825%** 🔥🔥 |
| $50K | $500 | **365%** |
| $100K | $500 | **182%** |
| $200K | $500 | **91%** |

### Token with $10K Daily Volume (Moderate)

**Tokenomics: Degen (30% to stakers)**

| Total Staked | Daily Rewards | APY |
|--------------|--------------|-----|
| $5K | $30 | **219%** |
| $10K | $30 | **110%** |
| $25K | $30 | **44%** |
| $50K | $30 | **22%** |

### Token with $1K Daily Volume (Low)

**Tokenomics: Degen (30% to stakers)**

| Total Staked | Daily Rewards | APY |
|--------------|--------------|-----|
| $1K | $3 | **110%** |
| $5K | $3 | **22%** |
| $10K | $3 | **11%** |

## Self-Balancing Mechanism

```
High APY → More people stake → Diluted rewards → APY drops
Low APY → People unstake → Concentrated rewards → APY rises
```

This naturally finds equilibrium without us setting fixed rates!

## Comparison to Typical DeFi

| Category | Typical APY | Source |
|----------|-------------|--------|
| Stablecoins | 3-8% | Lending interest |
| Blue chips (ETH/SOL) | 5-15% | Validator rewards |
| LP tokens | 20-50% | Trading fees |
| Governance tokens | 10-30% | Protocol revenue |
| **Memecoins** | **50-500%** | Trading fees (high volume) |

**Our model is sustainable because:**
1. No inflation (rewards = trading fees)
2. Self-balancing APY
3. Rewards track actual usage

## Recommended Tokenomics

Based on sustainability analysis:

| Style | Staking Cut | Target Scenario |
|-------|-------------|-----------------|
| degen | 30% | High volume, moderate APY |
| creator | 25% | Creator gets more, less to stakers |
| **community** | **50%** | **Max staker rewards, DAO-style** |
| lowfee | 30% | Balanced |

**Community style** is best for tokens that want strong holder incentives.

## Edge Cases

### What if volume drops to zero?
- APY goes to 0%
- No rewards distributed
- Stakers can unstake anytime
- No loss, just no yield

### What if everyone unstakes?
- Pool has fewer stakers
- Remaining stakers get higher APY
- Incentivizes staying

### What if no one stakes?
- Staking rewards accumulate in pool
- First stakers get bonus
- APY appears very high, attracts stakers

## Display on Frontend

Show users:
1. **Current APY** (based on 7-day average volume)
2. **Your estimated earnings** (per day/week/month)
3. **Total staked** (how diluted the pool is)
4. **24h volume** (indicates sustainability)

```
┌─────────────────────────────────────┐
│  AGC Staking Pool                   │
├─────────────────────────────────────┤
│  APY: 142%          (7-day avg)     │
│  24h Volume: $45,230                │
│  Total Staked: $23,400              │
│  Stakers: 127                       │
├─────────────────────────────────────┤
│  Your Stake: 5,000 AGC ($250)       │
│  Est. Daily: $0.97                  │
│  Est. Monthly: $29.15               │
│  Unclaimed: 0.42 SOL                │
└─────────────────────────────────────┘
```

## Summary

| Question | Answer |
|----------|--------|
| Who sets the rate? | Market (volume + staking participation) |
| Is it sustainable? | Yes - no inflation, fee-based |
| Typical APY range | 20-200% for active tokens |
| What if volume dies? | APY → 0, no losses |
| Best for holders? | Community tokenomics (50% to stakers) |

**Bottom line:** We don't set a rate. The rate emerges from trading activity. More trading = more rewards. More stakers = lower individual APY. It's self-balancing and sustainable.
