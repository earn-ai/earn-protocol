use anchor_lang::prelude::*;

/// Per-token staking pool
/// PDA: ["staking-pool", mint]
#[account]
#[derive(Default)]
pub struct StakingPool {
    /// Token mint that can be staked in this pool
    pub mint: Pubkey,
    
    /// Agent wallet (creator of the token)
    pub agent_wallet: Pubkey,
    
    /// Total tokens currently staked
    pub total_staked: u64,
    
    /// Number of unique stakers
    pub staker_count: u32,
    
    /// SOL rewards available for distribution (lamports)
    pub rewards_available: u64,
    
    /// Total SOL rewards distributed historically (lamports)
    pub rewards_distributed: u64,
    
    /// Accumulated reward per token (scaled by 1e18 for precision)
    /// Used for fair reward distribution calculation
    pub reward_per_token_stored: u128,
    
    /// Last timestamp when rewards were updated
    pub last_update_time: i64,
    
    /// Minimum stake amount (prevents dust attacks)
    pub min_stake_amount: u64,
    
    /// Cooldown period in seconds before unstaking (0 = no cooldown)
    pub cooldown_seconds: u32,
    
    /// Pool creation timestamp
    pub created_at: i64,
    
    /// Whether the pool is paused
    pub paused: bool,
    
    /// Bump seed for PDA derivation
    pub bump: u8,
    
    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl StakingPool {
    pub const SIZE: usize = 8 + // discriminator
        32 + // mint
        32 + // agent_wallet
        8 +  // total_staked
        4 +  // staker_count
        8 +  // rewards_available
        8 +  // rewards_distributed
        16 + // reward_per_token_stored
        8 +  // last_update_time
        8 +  // min_stake_amount
        4 +  // cooldown_seconds
        8 +  // created_at
        1 +  // paused
        1 +  // bump
        32;  // reserved
        
    /// Calculate current reward per token
    pub fn reward_per_token(&self) -> u128 {
        if self.total_staked == 0 {
            return self.reward_per_token_stored;
        }
        
        // rewards_available is added to the pool, distributed per token
        // This is a simplified model - in production, track time-based distribution
        self.reward_per_token_stored
    }
    
    /// Calculate earned rewards for a given stake amount and last reward snapshot
    pub fn earned(&self, stake_amount: u64, user_reward_per_token_paid: u128) -> u64 {
        let reward_per_token = self.reward_per_token();
        let reward_delta = reward_per_token.saturating_sub(user_reward_per_token_paid);
        
        // earned = stake_amount * (reward_per_token - user_paid) / 1e18
        ((stake_amount as u128) * reward_delta / 1_000_000_000_000_000_000) as u64
    }
}
