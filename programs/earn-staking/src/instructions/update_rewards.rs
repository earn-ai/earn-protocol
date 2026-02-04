use anchor_lang::prelude::*;
use crate::state::StakingPool;

/// Permissionless instruction to update pool rewards state
/// Anyone can call this to keep reward calculations up to date
#[derive(Accounts)]
pub struct UpdateRewards<'info> {
    #[account(
        mut,
        seeds = [b"staking-pool", staking_pool.mint.as_ref()],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
}

pub fn handler(ctx: Context<UpdateRewards>) -> Result<()> {
    let pool = &mut ctx.accounts.staking_pool;
    let clock = Clock::get()?;
    
    // Simply update the timestamp
    // Reward calculation happens in reward_per_token() based on rewards_available
    pool.last_update_time = clock.unix_timestamp;
    
    msg!("Updated pool rewards state");
    msg!("Total staked: {}", pool.total_staked);
    msg!("Rewards available: {}", pool.rewards_available);
    msg!("Reward per token: {}", pool.reward_per_token_stored);
    
    Ok(())
}
