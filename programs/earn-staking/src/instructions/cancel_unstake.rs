use anchor_lang::prelude::*;
use crate::state::{StakingPool, StakeAccount};
use crate::errors::StakingError;

#[derive(Accounts)]
pub struct CancelUnstake<'info> {
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

/// Cancel a pending unstake request
pub fn handler(ctx: Context<CancelUnstake>) -> Result<()> {
    let stake_account = &mut ctx.accounts.stake_account;
    
    // Check if there's a pending request
    require!(
        stake_account.unstake_requested_at != 0,
        StakingError::NoUnstakeRequest
    );
    
    let cancelled_amount = stake_account.unstake_amount;
    
    // Clear the unstake request
    stake_account.unstake_requested_at = 0;
    stake_account.unstake_amount = 0;
    
    msg!("Cancelled unstake request for {} tokens", cancelled_amount);
    
    Ok(())
}
