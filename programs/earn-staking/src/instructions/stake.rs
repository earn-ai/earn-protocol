use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{StakingPool, StakeAccount};
use crate::errors::StakingError;

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        mut,
        seeds = [b"staking-pool", staking_pool.mint.as_ref()],
        bump = staking_pool.bump,
        constraint = !staking_pool.paused @ StakingError::PoolPaused
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = StakeAccount::SIZE,
        seeds = [b"stake-account", staking_pool.key().as_ref(), user.key().as_ref()],
        bump
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
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Stake>, amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.staking_pool;
    let stake_account = &mut ctx.accounts.stake_account;
    let clock = Clock::get()?;
    
    // Validate minimum stake
    require!(
        amount >= pool.min_stake_amount,
        StakingError::StakeBelowMinimum
    );
    
    // Update rewards before modifying stake
    let reward_per_token = pool.reward_per_token();
    stake_account.update_rewards(reward_per_token, stake_account.amount);
    
    // Initialize stake account if new
    let is_new_staker = stake_account.amount == 0 && stake_account.owner == Pubkey::default();
    if is_new_staker {
        stake_account.owner = ctx.accounts.user.key();
        stake_account.pool = pool.key();
        stake_account.staked_at = clock.unix_timestamp;
        stake_account.reward_per_token_paid = reward_per_token;
        stake_account.bump = ctx.bumps.stake_account;
        
        pool.staker_count = pool.staker_count.saturating_add(1);
    }
    
    // Transfer tokens from user to pool
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.pool_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;
    
    // Update stake amounts
    stake_account.amount = stake_account.amount.saturating_add(amount);
    pool.total_staked = pool.total_staked.saturating_add(amount);
    pool.last_update_time = clock.unix_timestamp;
    
    msg!("Staked {} tokens", amount);
    msg!("Total staked: {}", stake_account.amount);
    
    Ok(())
}
