use anchor_lang::prelude::*;

/// Global configuration for the staking program
/// PDA: ["global-config"]
#[account]
#[derive(Default)]
pub struct GlobalConfig {
    /// Program authority (can create pools, update config)
    pub authority: Pubkey,
    
    /// Earn treasury wallet
    pub earn_wallet: Pubkey,
    
    /// Total number of staking pools created
    pub total_pools: u64,
    
    /// Total value staked across all pools (in lamports equivalent)
    pub total_staked_value: u64,
    
    /// Total rewards distributed (SOL lamports)
    pub total_rewards_distributed: u64,
    
    /// Bump seed for PDA derivation
    pub bump: u8,
    
    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl GlobalConfig {
    pub const SIZE: usize = 8 + // discriminator
        32 + // authority
        32 + // earn_wallet
        8 +  // total_pools
        8 +  // total_staked_value
        8 +  // total_rewards_distributed
        1 +  // bump
        32;  // reserved
}
