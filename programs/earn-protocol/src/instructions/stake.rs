use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::*;
use crate::errors::EarnError;

/// Stake tokens in the staking pool
pub fn stake(
    ctx: Context<Stake>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, EarnError::InvalidAmount);
    
    let config = &ctx.accounts.token_config;
    require!(config.is_active, EarnError::TokenNotActive);
    
    let staking_pool = &mut ctx.accounts.staking_pool;
    let stake_account = &mut ctx.accounts.stake_account;
    let clock = Clock::get()?;
    
    // Calculate and store pending rewards before updating stake
    if stake_account.staked_amount > 0 {
        let pending = stake_account.calculate_pending_rewards(staking_pool.reward_per_token_stored);
        stake_account.pending_rewards = pending;
    }
    
    // Update stake account
    let is_new_staker = stake_account.staked_amount == 0;
    stake_account.owner = ctx.accounts.staker.key();
    stake_account.token_mint = ctx.accounts.token_mint.key();
    stake_account.staked_amount = stake_account.staked_amount.checked_add(amount).unwrap();
    stake_account.reward_per_token_paid = staking_pool.reward_per_token_stored;
    
    if is_new_staker {
        stake_account.staked_at = clock.unix_timestamp;
        staking_pool.staker_count = staking_pool.staker_count.checked_add(1).unwrap();
    }
    
    // Update pool totals
    staking_pool.total_staked = staking_pool.total_staked.checked_add(amount).unwrap();
    staking_pool.last_update_time = clock.unix_timestamp;
    
    // Transfer tokens from staker to pool
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.staker_token_account.to_account_info(),
                to: ctx.accounts.staking_token_account.to_account_info(),
                authority: ctx.accounts.staker.to_account_info(),
            },
        ),
        amount,
    )?;
    
    // Emit event
    emit!(crate::events::Staked {
        user: ctx.accounts.staker.key(),
        token_mint: ctx.accounts.token_mint.key(),
        amount,
        new_total_staked: stake_account.staked_amount,
        pool_total_staked: staking_pool.total_staked,
        timestamp: clock.unix_timestamp,
    });
    
    msg!("Staked {} tokens. Total staked: {}", amount, staking_pool.total_staked);
    
    Ok(())
}

#[derive(Accounts)]
pub struct Stake<'info> {
    /// The user staking tokens
    #[account(mut)]
    pub staker: Signer<'info>,
    
    /// Token mint
    pub token_mint: Account<'info, anchor_spl::token::Mint>,
    
    /// Token config
    #[account(
        seeds = [TOKEN_CONFIG_SEED, token_mint.key().as_ref()],
        bump = token_config.config_bump,
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// Staking pool
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED, token_mint.key().as_ref()],
        bump = staking_pool.bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    /// User's stake account (created if doesn't exist)
    #[account(
        init_if_needed,
        payer = staker,
        space = 8 + StakeAccount::SIZE,
        seeds = [STAKE_ACCOUNT_SEED, token_mint.key().as_ref(), staker.key().as_ref()],
        bump,
    )]
    pub stake_account: Account<'info, StakeAccount>,
    
    /// Staker's token account
    #[account(
        mut,
        constraint = staker_token_account.owner == staker.key() @ EarnError::Unauthorized,
        constraint = staker_token_account.mint == token_mint.key() @ EarnError::InvalidTokenMint,
    )]
    pub staker_token_account: Account<'info, TokenAccount>,
    
    /// Pool's token account for staked tokens
    #[account(
        mut,
        constraint = staking_token_account.key() == staking_pool.stake_token_account @ EarnError::InvalidTokenMint,
    )]
    pub staking_token_account: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
