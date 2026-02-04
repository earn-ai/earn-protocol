# Staking Design for Earn Protocol

## The Challenge

Pump.fun tokens don't have built-in staking. We need to add it on top.

## Solution: Universal Staking Program

One Earn staking program that works for ALL tokens launched via Earn.

```
┌─────────────────────────────────────────────────────────────┐
│                    EARN STAKING PROGRAM                      │
├─────────────────────────────────────────────────────────────┤
│  Token A Pool    │  Token B Pool    │  Token C Pool    │ ...│
│  - Total staked  │  - Total staked  │  - Total staked  │    │
│  - Rewards pool  │  - Rewards pool  │  - Rewards pool  │    │
│  - APY           │  - APY           │  - APY           │    │
└─────────────────────────────────────────────────────────────┘
```

## Fee Flow with Staking

```
User trades on Pump.fun
        ↓
Creator fees → Earn's creator_vault (on Pump.fun)
        ↓
Earn claims fees periodically (crank)
        ↓
Fee Distribution:
┌────────────────────────────────┐
│  Agent Cut (e.g., 40%)         │ → Agent's wallet
│  Earn Cut (e.g., 30%)          │ → Earn treasury  
│  Staking Cut (e.g., 30%)       │ → Token's StakingPool
└────────────────────────────────┘
        ↓
Stakers claim rewards from pool
```

## Revised Tokenomics (with Staking)

| Style     | Agent | Earn | Stakers | Best For |
|-----------|-------|------|---------|----------|
| degen     | 40%   | 30%  | 30%     | High volume memes |
| creator   | 50%   | 25%  | 25%     | Content creators |
| community | 25%   | 25%  | 50%     | DAO-style projects |
| lowfee    | 40%   | 30%  | 30%     | Max trading volume |

## On-Chain Architecture

### PDAs

```rust
// Global config (one per program)
GlobalStakingConfig {
    authority: Pubkey,        // Earn admin
    earn_wallet: Pubkey,      // Treasury
    total_pools: u64,
    total_staked_value: u64,  // Across all pools (for stats)
}

// Per-token staking pool
StakingPool {
    mint: Pubkey,              // Token being staked
    token_config: Pubkey,      // Link to TokenConfig (agent wallet, etc.)
    
    total_staked: u64,         // Total tokens staked
    staker_count: u32,         // Number of stakers
    
    rewards_available: u64,    // SOL available for rewards
    rewards_distributed: u64,  // Total SOL distributed
    
    // Reward calculation
    reward_per_token: u128,    // Accumulated rewards per token (scaled)
    last_update_time: i64,
    
    // Pool settings
    min_stake_amount: u64,     // Minimum stake (anti-dust)
    cooldown_seconds: u32,     // Unstake cooldown (optional)
    
    created_at: i64,
    bump: u8,
}
// PDA: ["staking-pool", mint]

// Per-user stake account
StakeAccount {
    owner: Pubkey,
    pool: Pubkey,
    
    amount: u64,                    // Tokens staked
    reward_per_token_paid: u128,   // Last reward_per_token snapshot
    rewards_earned: u64,            // Unclaimed rewards (SOL)
    
    staked_at: i64,
    last_claim_at: i64,
    
    bump: u8,
}
// PDA: ["stake-account", pool, owner]
```

### Instructions

```rust
// Admin (called at token launch)
create_staking_pool {
    mint: Pubkey,
    token_config: Pubkey,  // Links to agent wallet, tokenomics
}

// User actions
stake {
    pool: Pubkey,
    amount: u64,
}

unstake {
    pool: Pubkey,
    amount: u64,
}

claim_rewards {
    pool: Pubkey,
}

// Crank (permissionless, called periodically)
deposit_rewards {
    pool: Pubkey,
    amount: u64,  // SOL from trading fees
}
```

## API Endpoints (New)

```
POST /launch
  → Now also creates StakingPool for the token

GET /stake/pools
  → List all staking pools with APY, total staked

GET /stake/pool/:mint
  → Pool details for specific token

GET /stake/user/:wallet
  → User's stakes across all pools

POST /stake/quote
  → Preview stake/unstake (gas estimate, rewards preview)
```

## Frontend: earn.supply/stake

```
┌─────────────────────────────────────────────────────────────┐
│  🔒 STAKING PORTAL                                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Your Total Staked Value: $X,XXX                            │
│  Your Unclaimed Rewards: X.XX SOL                           │
│                                                              │
│  [Claim All Rewards]                                        │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  AVAILABLE POOLS                                             │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│  Token   │  APY     │  Staked  │  Your $  │  Action         │
├──────────┼──────────┼──────────┼──────────┼─────────────────┤
│  AGC 🔥  │  142%    │  $45K    │  $500    │  [Stake] [—]    │
│  MEME    │  89%     │  $23K    │  $0      │  [Stake]        │
│  COPE    │  234%    │  $12K    │  $1,200  │  [Stake] [—]    │
└──────────┴──────────┴──────────┴──────────┴─────────────────┘
│                                                              │
│  [Load More]                                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘

When user clicks [Stake]:
┌─────────────────────────────────────────────────────────────┐
│  Stake AGC                                                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Your Balance: 10,000 AGC                                   │
│                                                              │
│  Amount: [__________] [MAX]                                 │
│                                                              │
│  You'll Earn: ~0.5 SOL/day (estimated)                      │
│  Current APY: 142%                                          │
│                                                              │
│  [Approve AGC] → [Stake]                                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Reward Calculation

Using "reward per token" model (same as Synthetix staking):

```typescript
// When rewards are deposited:
if (totalStaked > 0) {
  rewardPerToken += (rewardsDeposited * 1e18) / totalStaked;
}

// When user stakes/unstakes/claims:
earned = stakeAmount * (rewardPerToken - userRewardPerTokenPaid) / 1e18;
userRewardPerTokenPaid = rewardPerToken;
userRewardsEarned += earned;
```

This ensures:
- Fair distribution based on stake size
- No "flash stake" exploits
- Gas-efficient (no loops)

## APY Calculation

```typescript
// For display
const dailyRewards = last24hFeesCollected * stakingCutPercent;
const annualRewards = dailyRewards * 365;
const apy = (annualRewards / totalStakedValue) * 100;
```

## Integration with Token Launch

When `/launch` is called:

```typescript
// 1. Create token on Pump.fun (existing)
const mint = await createPumpFunToken(...);

// 2. Register with Earn (existing)
await registerToken(mint, agentWallet, tokenomics);

// 3. NEW: Create staking pool
await createStakingPool(mint);

// Response includes staking info
return {
  mint,
  pumpfun: `https://pump.fun/${mint}`,
  staking: `https://earn.supply/stake/${mint}`,
  stakingPool: stakingPoolPDA,
};
```

## Crank: Fee Distribution

Runs periodically (every hour or on-demand):

```typescript
async function distributeFees() {
  // 1. Claim from Pump.fun creator_vault
  const fees = await claimCreatorFees();
  
  // 2. For each token with accumulated fees:
  for (const token of tokensWithFees) {
    const config = await getTokenConfig(token.mint);
    
    // Split according to tokenomics
    const agentAmount = fees * (config.agentCutBps / 10000);
    const earnAmount = fees * (config.earnCutBps / 10000);
    const stakingAmount = fees * (config.stakingCutBps / 10000);
    
    // 3. Send to agent
    await transfer(agentAmount, config.agentWallet);
    
    // 4. Send to Earn treasury
    await transfer(earnAmount, EARN_TREASURY);
    
    // 5. Deposit to staking pool
    await depositRewards(token.stakingPool, stakingAmount);
  }
}
```

## Implementation Order

1. **Phase 1: Staking Program** (Solana/Anchor)
   - GlobalStakingConfig
   - StakingPool
   - StakeAccount
   - stake/unstake/claim instructions

2. **Phase 2: API Integration**
   - Create pool on launch
   - /stake/* endpoints
   - Crank for fee distribution

3. **Phase 3: Frontend**
   - earn.supply/stake page
   - Pool list, stake modal, claim button

## Open Questions

1. **Rewards in SOL or tokens?**
   - SOL is simpler (no need for token buybacks)
   - Tokens would require buyback mechanism
   - **Recommendation:** SOL rewards

2. **Unstake cooldown?**
   - Prevents stake-before-fee, unstake-after gaming
   - 24h cooldown is common
   - **Recommendation:** Optional per-tokenomics style

3. **Minimum stake?**
   - Prevents dust attacks
   - **Recommendation:** 0.001 SOL equivalent

4. **Compound rewards?**
   - Auto-restake earned rewards
   - More complex
   - **Recommendation:** Manual claim for v1

## Summary

```
LAUNCH → Creates Token + StakingPool
TRADE  → Fees → Earn claims → Split to Agent/Earn/Stakers
STAKE  → User stakes tokens → Earns SOL rewards
CLAIM  → User withdraws earned SOL
```

One program. Works for all tokens. Staking portal at earn.supply/stake.
