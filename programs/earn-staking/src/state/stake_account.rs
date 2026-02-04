use anchor_lang::prelude::*;

/// Individual user's stake in a pool
/// PDA: ["stake-account", pool, owner]
#[account]
#[derive(Default)]
pub struct StakeAccount {
    /// Owner of this stake account
    pub owner: Pubkey,
    
    /// The pool this stake belongs to
    pub pool: Pubkey,
    
    /// Amount of tokens staked
    pub amount: u64,
    
    /// Snapshot of reward_per_token at last interaction
    /// Used to calculate earned rewards since last claim/stake/unstake
    pub reward_per_token_paid: u128,
    
    /// Unclaimed rewards accumulated (SOL lamports)
    pub rewards_earned: u64,
    
    /// Timestamp when tokens were first staked
    pub staked_at: i64,
    
    /// Timestamp of last claim
    pub last_claim_at: i64,
    
    /// Timestamp when unstake was requested (for cooldown)
    pub unstake_requested_at: i64,
    
    /// Amount requested to unstake (during cooldown)
    pub unstake_amount: u64,
    
    /// Bump seed for PDA derivation
    pub bump: u8,
    
    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl StakeAccount {
    pub const SIZE: usize = 8 + // discriminator
        32 + // owner
        32 + // pool
        8 +  // amount
        16 + // reward_per_token_paid
        8 +  // rewards_earned
        8 +  // staked_at
        8 +  // last_claim_at
        8 +  // unstake_requested_at
        8 +  // unstake_amount
        1 +  // bump
        32;  // reserved
        
    /// Check if cooldown period has passed
    pub fn can_unstake(&self, cooldown_seconds: u32, current_time: i64) -> bool {
        if cooldown_seconds == 0 {
            return true;
        }
        
        if self.unstake_requested_at == 0 {
            return false; // Must request unstake first
        }
        
        current_time >= self.unstake_requested_at + (cooldown_seconds as i64)
    }
    
    /// Update rewards based on current pool state
    pub fn update_rewards(&mut self, pool_reward_per_token: u128, stake_amount: u64) {
        let earned = self.calculate_earned(pool_reward_per_token, stake_amount);
        self.rewards_earned = self.rewards_earned.saturating_add(earned);
        self.reward_per_token_paid = pool_reward_per_token;
    }
    
    /// Calculate earned rewards since last update
    pub fn calculate_earned(&self, pool_reward_per_token: u128, stake_amount: u64) -> u64 {
        let reward_delta = pool_reward_per_token.saturating_sub(self.reward_per_token_paid);
        ((stake_amount as u128) * reward_delta / 1_000_000_000_000_000_000) as u64
    }
}
