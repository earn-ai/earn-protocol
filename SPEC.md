# EARN PROTOCOL — FULL BUILD SPEC

## ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│                        EARN PROTOCOL                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
│  │   Token     │   │  Treasury   │   │  Staking    │           │
│  │  Registry   │──▶│  Manager    │──▶│   Pool      │           │
│  └─────────────┘   └─────────────┘   └─────────────┘           │
│         │                │                  │                   │
│         ▼                ▼                  ▼                   │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
│  │    Fee      │   │  Buyback    │   │   Reward    │           │
│  │  Collector  │──▶│  Engine     │──▶│ Distributor │           │
│  └─────────────┘   └─────────────┘   └─────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Earn Master    │
                    │   Treasury      │
                    │ (Your Wallet)   │
                    └─────────────────┘
```

## DATA FLOW

1. **REGISTRATION**: Agent calls POST /register → Creates TokenConfig, Treasury, StakingPool PDAs
2. **FEE COLLECTION**: Swap happens → 2% fee → Split: 10% Earn, 20% Creator, 35% Buyback, 35% Stakers
3. **STAKING**: Holder stakes → Tokens locked in pool → Earns share of rewards
4. **BUYBACK**: Treasury threshold hit → Jupiter swap → Burn tokens
5. **REWARDS**: Staking pool accumulates fees → Pro-rata distribution → Claimable anytime

---

## ON-CHAIN ACCOUNTS (Anchor)

### TokenConfig (PDA per token)
```rust
#[account]
pub struct TokenConfig {
    pub token_mint: Pubkey,
    pub creator: Pubkey,
    pub fee_basis_points: u16,      // 200 = 2%
    pub earn_cut_bps: u16,          // 1000 = 10%
    pub creator_cut_bps: u16,       // 2000 = 20%
    pub buyback_cut_bps: u16,       // 3500 = 35%
    pub staking_cut_bps: u16,       // 3500 = 35%
    pub treasury_bump: u8,
    pub staking_pool_bump: u8,
    pub total_fees_collected: u64,
    pub is_active: bool,
    pub created_at: i64,
}
```

### Treasury (PDA per token)
```rust
#[account]
pub struct Treasury {
    pub token_mint: Pubkey,
    pub balance: u64,
    pub total_buybacks: u64,
    pub total_burned: u64,
    pub last_buyback: i64,
    pub bump: u8,
}
```

### StakingPool (PDA per token)
```rust
#[account]
pub struct StakingPool {
    pub token_mint: Pubkey,
    pub total_staked: u64,
    pub reward_per_token: u128,     // Scaled by 1e18
    pub total_rewards_distributed: u64,
    pub bump: u8,
}
```

### StakeAccount (PDA per user per token)
```rust
#[account]
pub struct StakeAccount {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub staked_amount: u64,
    pub reward_debt: u128,
    pub pending_rewards: u64,
    pub staked_at: i64,
    pub bump: u8,
}
```

## PDA SEEDS

```rust
// Token Config
seeds = [b"config", token_mint.as_ref()]

// Treasury
seeds = [b"treasury", token_mint.as_ref()]

// Staking Pool
seeds = [b"staking_pool", token_mint.as_ref()]

// User Stake Account
seeds = [b"stake", token_mint.as_ref(), user.as_ref()]

// Earn Master Treasury (global)
seeds = [b"earn_master"]
```

---

## INSTRUCTIONS

### 1. Register Token
```rust
pub fn register(
    ctx: Context<Register>,
    fee_basis_points: u16,
    creator_cut_bps: u16,
) -> Result<()>
```

### 2. Collect Fee
```rust
pub fn collect_fee(
    ctx: Context<CollectFee>,
    amount: u64,
) -> Result<()> {
    let fee = amount * config.fee_basis_points / 10000;
    let earn_amount = fee * config.earn_cut_bps / 10000;
    let creator_amount = fee * config.creator_cut_bps / 10000;
    let buyback_amount = fee * config.buyback_cut_bps / 10000;
    let staking_amount = fee - earn_amount - creator_amount - buyback_amount;
    // Transfer to each destination
}
```

### 3. Stake
```rust
pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()>
```

### 4. Unstake
```rust
pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()>
```

### 5. Claim Rewards
```rust
pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()>
```

### 6. Execute Buyback
```rust
pub fn execute_buyback(ctx: Context<ExecuteBuyback>, min_tokens_out: u64) -> Result<()>
```

---

## API ENDPOINTS

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /health | Health check |
| POST | /register | Register token |
| GET | /token/:mint | Token info |
| GET | /tokens | List all tokens |
| POST | /stake | Stake tokens |
| POST | /unstake | Unstake tokens |
| POST | /claim | Claim rewards |
| GET | /stake/:mint/:wallet | User stake info |
| POST | /buyback/:mint | Execute buyback |
| GET | /buyback/:mint/history | Buyback history |
| GET | /stats | Protocol stats |
| GET | /stats/:mint | Token stats |
| GET | /creator/:wallet | Creator dashboard |

---

## 8-DAY BUILD PLAN

| Day | Focus | Deliverable |
|-----|-------|-------------|
| 1 | Foundation | Anchor setup, account structs, register instruction working on devnet |
| 2 | Staking | stake/unstake/claim working on devnet |
| 3 | Fee Collection | Fee splitting working, stakers see rewards |
| 4 | Buyback | Jupiter CPI, tokens bought and burned |
| 5 | API Layer | Express API deployed, all endpoints working |
| 6 | Demo Token | Live demo with real token, one integration |
| 7 | Polish | Demo video, README, code cleanup |
| 8 | Submit | Final testing, submit project |

---

## SUCCESS CRITERIA

### MVP (Must Have)
- [ ] Register a token with Earn
- [ ] Stake tokens
- [ ] See rewards accumulate
- [ ] Claim rewards
- [ ] Show Earn treasury growing

### Impressive (Nice to Have)
- [ ] Multiple tokens registered
- [ ] Buyback executing
- [ ] Real fee collection on swaps
- [ ] Dashboard or CLI
- [ ] Other agents using API

### Winning (Shoot for This)
- [ ] Live integration with another hackathon project
- [ ] Real tokens flowing through protocol
- [ ] Clear path to mainnet
- [ ] "Earn earns" — treasury balance growing

---

## GOTCHAS

### Solana
- Always store PDA bumps in account state
- Account space = 8 + struct size (discriminator)
- Use Associated Token Accounts
- Handle token decimals (6-9 usually)

### Math
- Use scaled integers (1e18) for reward calculations
- Basis points: 10000 = 100%
- Multiply before dividing
- Use u128 for intermediate calculations

### Testing
- Test on both localnet and devnet
- Devnet airdrops are rate-limited
- Use upgradeable programs

---

## RESOURCES

- Anchor Book: https://book.anchor-lang.com/
- Solana Cookbook: https://solanacookbook.com/
- Marinade (reference): https://github.com/marinade-finance/liquid-staking-program
