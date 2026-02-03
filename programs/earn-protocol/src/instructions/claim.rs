use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::*;
use crate::errors::EarnError;

/// Claim pending staking rewards without unstaking
pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let staking_pool = &ctx.accounts.staking_pool;
    let stake_account = &mut ctx.accounts.stake_account;
    let clock = Clock::get()?;
    
    // Reentrancy protection
    require!(!stake_account.is_locked, EarnError::Unauthorized); // Using Unauthorized for reentrancy
    stake_account.is_locked = true;
    
    // Calculate pending rewards
    let pending_rewards = stake_account.calculate_pending_rewards(staking_pool.reward_per_token_stored);
    
    require!(pending_rewards > 0, EarnError::NoRewardsToClaim);
    
    // Update stake account
    stake_account.reward_per_token_paid = staking_pool.reward_per_token_stored;
    stake_account.pending_rewards = 0;
    stake_account.last_claim_at = clock.unix_timestamp;
    
    // Transfer rewards (check balance first to prevent insolvency drain)
    let available_rewards = ctx.accounts.rewards_token_account.amount;
    let rewards_to_pay = pending_rewards.min(available_rewards);
    
    require!(rewards_to_pay > 0, EarnError::InsufficientBalance);
    
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
        rewards_to_pay,
    )?;
    
    if rewards_to_pay < pending_rewards {
        msg!("Warning: Only {} of {} rewards available", rewards_to_pay, pending_rewards);
    }
    
    // Release reentrancy lock
    let stake_account = &mut ctx.accounts.stake_account;
    stake_account.is_locked = false;
    
    // Emit event
    emit!(crate::events::RewardsClaimed {
        user: ctx.accounts.staker.key(),
        token_mint: ctx.accounts.token_mint.key(),
        amount: pending_rewards,
        timestamp: clock.unix_timestamp,
    });
    
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
    
    /// Pool's rewards token account (must match the token mint)
    #[account(
        mut,
        constraint = rewards_token_account.mint == token_mint.key() @ EarnError::InvalidTokenAccount,
    )]
    pub rewards_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}
