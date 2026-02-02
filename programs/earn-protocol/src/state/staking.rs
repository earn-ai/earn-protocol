use anchor_lang::prelude::*;

/// Staking pool for a registered token
/// PDA seeds: [b"staking_pool", token_mint.as_ref()]
#[account]
pub struct StakingPool {
    /// The token mint this pool is for
    pub token_mint: Pubkey,
    
    /// Total tokens currently staked
    pub total_staked: u64,
    
    /// Accumulated reward per token (scaled by 1e18 for precision)
    /// This increases each time fees are distributed
    pub reward_per_token_stored: u128,
    
    /// Total rewards distributed lifetime
    pub total_rewards_distributed: u64,
    
    /// Number of unique stakers
    pub staker_count: u32,
    
    /// Last time rewards were updated
    pub last_update_time: i64,
    
    /// Token account holding staked tokens
    pub stake_token_account: Pubkey,
    
    /// PDA bump
    pub bump: u8,
}

impl StakingPool {
    pub const SIZE: usize = 32 +  // token_mint
                            8 +   // total_staked
                            16 +  // reward_per_token_stored (u128)
                            8 +   // total_rewards_distributed
                            4 +   // staker_count
                            8 +   // last_update_time
                            32 +  // stake_token_account
                            1;    // bump
    
    /// Precision multiplier for reward calculations
    pub const PRECISION: u128 = 1_000_000_000_000_000_000; // 1e18
    
    /// Update reward per token when new fees come in
    pub fn update_reward_per_token(&mut self, reward_amount: u64) {
        if self.total_staked > 0 {
            let reward_per_token_increase = (reward_amount as u128)
                .checked_mul(Self::PRECISION)
                .unwrap()
                .checked_div(self.total_staked as u128)
                .unwrap();
            
            self.reward_per_token_stored = self.reward_per_token_stored
                .checked_add(reward_per_token_increase)
                .unwrap();
        }
        self.total_rewards_distributed = self.total_rewards_distributed
            .checked_add(reward_amount)
            .unwrap();
        self.last_update_time = Clock::get().unwrap().unix_timestamp;
    }
}

/// Individual user's stake account
/// PDA seeds: [b"stake", token_mint.as_ref(), user.as_ref()]
#[account]
pub struct StakeAccount {
    /// Owner of this stake
    pub owner: Pubkey,
    
    /// Token mint this stake is for
    pub token_mint: Pubkey,
    
    /// Amount of tokens staked
    pub staked_amount: u64,
    
    /// Reward per token at time of last action (for calculating owed rewards)
    pub reward_per_token_paid: u128,
    
    /// Rewards accumulated but not yet claimed
    pub pending_rewards: u64,
    
    /// Unix timestamp when first staked
    pub staked_at: i64,
    
    /// Last time rewards were claimed
    pub last_claim_at: i64,
    
    /// PDA bump
    pub bump: u8,
}

impl StakeAccount {
    pub const SIZE: usize = 32 +  // owner
                            32 +  // token_mint
                            8 +   // staked_amount
                            16 +  // reward_per_token_paid (u128)
                            8 +   // pending_rewards
                            8 +   // staked_at
                            8 +   // last_claim_at
                            1;    // bump
    
    /// Calculate pending rewards for this account
    pub fn calculate_pending_rewards(&self, current_reward_per_token: u128) -> u64 {
        let reward_per_token_delta = current_reward_per_token
            .checked_sub(self.reward_per_token_paid)
            .unwrap_or(0);
        
        let new_rewards = (self.staked_amount as u128)
            .checked_mul(reward_per_token_delta)
            .unwrap()
            .checked_div(StakingPool::PRECISION)
            .unwrap() as u64;
        
        self.pending_rewards.checked_add(new_rewards).unwrap()
    }
}

/// Seeds
pub const STAKING_POOL_SEED: &[u8] = b"staking_pool";
pub const STAKE_ACCOUNT_SEED: &[u8] = b"stake";
