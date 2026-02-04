use anchor_lang::prelude::*;
use crate::state::{StakingPool, StakeAccount};
use crate::errors::StakingError;

#[derive(Accounts)]
pub struct RequestUnstake<'info> {
    #[account(
        seeds = [b"staking-pool", staking_pool.mint.as_ref()],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [b"stake-account", staking_pool.key().as_ref(), user.key().as_ref()],
        bump = stake_account.bump,
        constraint = stake_account.owner == user.key() @ StakingError::Unauthorized
    )]
    pub stake_account: Account<'info, StakeAccount>,
    
    pub user: Signer<'info>,
}

/// Request to unstake tokens - starts the cooldown period
pub fn handler(ctx: Context<RequestUnstake>, amount: u64) -> Result<()> {
    let pool = &ctx.accounts.staking_pool;
    let stake_account = &mut ctx.accounts.stake_account;
    let clock = Clock::get()?;
    
    // Validate sufficient balance
    require!(
        stake_account.amount >= amount,
        StakingError::InsufficientStakedBalance
    );
    
    // Check if already has a pending request
    require!(
        stake_account.unstake_requested_at == 0,
        StakingError::AlreadyRequestedUnstake
    );
    
    // If no cooldown, they can unstake directly
    if pool.cooldown_seconds == 0 {
        msg!("No cooldown required - user can unstake directly");
        return Ok(());
    }
    
    // Record the unstake request
    stake_account.unstake_requested_at = clock.unix_timestamp;
    stake_account.unstake_amount = amount;
    
    let ready_at = clock.unix_timestamp + (pool.cooldown_seconds as i64);
    msg!("Unstake request recorded for {} tokens", amount);
    msg!("Cooldown: {} seconds", pool.cooldown_seconds);
    msg!("Can unstake after: {}", ready_at);
    
    Ok(())
}
