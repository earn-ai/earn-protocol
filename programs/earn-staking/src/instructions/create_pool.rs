use anchor_lang::prelude::*;
use crate::state::{GlobalConfig, StakingPool};

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(
        mut,
        seeds = [b"global-config"],
        bump = global_config.bump,
        has_one = authority
    )]
    pub global_config: Account<'info, GlobalConfig>,
    
    #[account(
        init,
        payer = authority,
        space = StakingPool::SIZE,
        seeds = [b"staking-pool", mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    /// The token mint for this staking pool
    pub mint: Account<'info, anchor_spl::token::Mint>,
    
    /// CHECK: Agent wallet that created the token
    pub agent_wallet: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreatePool>,
    min_stake_amount: u64,
    cooldown_seconds: u32,
) -> Result<()> {
    let pool = &mut ctx.accounts.staking_pool;
    let config = &mut ctx.accounts.global_config;
    let clock = Clock::get()?;
    
    pool.mint = ctx.accounts.mint.key();
    pool.agent_wallet = ctx.accounts.agent_wallet.key();
    pool.total_staked = 0;
    pool.staker_count = 0;
    pool.rewards_available = 0;
    pool.rewards_distributed = 0;
    pool.reward_per_token_stored = 0;
    pool.last_update_time = clock.unix_timestamp;
    pool.min_stake_amount = min_stake_amount;
    pool.cooldown_seconds = cooldown_seconds;
    pool.created_at = clock.unix_timestamp;
    pool.paused = false;
    pool.bump = ctx.bumps.staking_pool;
    
    // Update global config
    config.total_pools = config.total_pools.saturating_add(1);
    
    msg!("Created staking pool for mint: {}", pool.mint);
    msg!("Agent wallet: {}", pool.agent_wallet);
    msg!("Min stake: {}, Cooldown: {}s", min_stake_amount, cooldown_seconds);
    
    Ok(())
}
