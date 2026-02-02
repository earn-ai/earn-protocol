use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::*;
use crate::errors::EarnError;

/// Claim pending staking rewards without unstaking
pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let staking_pool = &ctx.accounts.staking_pool;
    let stake_account = &mut ctx.accounts.stake_account;
    let clock = Clock::get()?;
    
    // Calculate pending rewards
    let pending_rewards = stake_account.calculate_pending_rewards(staking_pool.reward_per_token_stored);
    
    require!(pending_rewards > 0, EarnError::NoRewardsToClaim);
    
    // Update stake account
    stake_account.reward_per_token_paid = staking_pool.reward_per_token_stored;
    stake_account.pending_rewards = 0;
    stake_account.last_claim_at = clock.unix_timestamp;
    
    // Transfer rewards
    let token_mint_key = ctx.accounts.token_mint.key();
    let seeds = &[
        STAKING_POOL_SEED,
        token_mint_key.as_ref(),
        &[staking_pool.bump],
    ];
    let signer = &[&seeds[..]];
    
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.rewards_token_account.to_account_info(),
                to: ctx.accounts.staker_token_account.to_account_info(),
                authority: ctx.accounts.staking_pool.to_account_info(),
            },
            signer,
        ),
        pending_rewards,
    )?;
    
    msg!("Claimed {} rewards", pending_rewards);
    
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    /// The staker claiming rewards
    pub staker: Signer<'info>,
    
    /// Token mint
    pub token_mint: Account<'info, anchor_spl::token::Mint>,
    
    /// Staking pool
    #[account(
        seeds = [STAKING_POOL_SEED, token_mint.key().as_ref()],
        bump = staking_pool.bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    /// User's stake account
    #[account(
        mut,
        seeds = [STAKE_ACCOUNT_SEED, token_mint.key().as_ref(), staker.key().as_ref()],
        bump = stake_account.bump,
        constraint = stake_account.owner == staker.key() @ EarnError::Unauthorized,
    )]
    pub stake_account: Account<'info, StakeAccount>,
    
    /// Staker's token account to receive rewards
    #[account(
        mut,
        constraint = staker_token_account.owner == staker.key() @ EarnError::Unauthorized,
    )]
    pub staker_token_account: Account<'info, TokenAccount>,
    
    /// Pool's rewards token account
    #[account(mut)]
    pub rewards_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}
