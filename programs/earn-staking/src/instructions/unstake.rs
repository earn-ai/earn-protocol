use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{StakingPool, StakeAccount};
use crate::errors::StakingError;

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(
        mut,
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
    
    #[account(
        mut,
        constraint = user_token_account.mint == staking_pool.mint,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = pool_token_account.mint == staking_pool.mint
    )]
    pub pool_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: Pool authority for signing transfers
    #[account(
        seeds = [b"pool-authority", staking_pool.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.staking_pool;
    let stake_account = &mut ctx.accounts.stake_account;
    let clock = Clock::get()?;
    
    // Validate sufficient balance
    require!(
        stake_account.amount >= amount,
        StakingError::InsufficientStakedBalance
    );
    
    // Check cooldown if applicable
    if pool.cooldown_seconds > 0 {
        require!(
            stake_account.can_unstake(pool.cooldown_seconds, clock.unix_timestamp),
            StakingError::CooldownNotPassed
        );
    }
    
    // Update rewards before modifying stake
    let reward_per_token = pool.reward_per_token();
    stake_account.update_rewards(reward_per_token, stake_account.amount);
    
    // Transfer tokens back to user
    let pool_key = pool.key();
    let seeds = &[
        b"pool-authority",
        pool_key.as_ref(),
        &[ctx.bumps.pool_authority],
    ];
    let signer_seeds = &[&seeds[..]];
    
    let cpi_accounts = Transfer {
        from: ctx.accounts.pool_token_account.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.pool_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, amount)?;
    
    // Update stake amounts
    stake_account.amount = stake_account.amount.saturating_sub(amount);
    pool.total_staked = pool.total_staked.saturating_sub(amount);
    pool.last_update_time = clock.unix_timestamp;
    
    // Reset unstake request
    stake_account.unstake_requested_at = 0;
    stake_account.unstake_amount = 0;
    
    // Update staker count if fully unstaked
    if stake_account.amount == 0 {
        pool.staker_count = pool.staker_count.saturating_sub(1);
    }
    
    msg!("Unstaked {} tokens", amount);
    msg!("Remaining: {}", stake_account.amount);
    
    Ok(())
}
