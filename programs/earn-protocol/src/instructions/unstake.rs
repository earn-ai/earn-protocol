use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::*;
use crate::errors::EarnError;

/// Unstake tokens and claim any pending rewards
pub fn unstake(
    ctx: Context<Unstake>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, EarnError::InvalidAmount);
    
    let stake_account = &ctx.accounts.stake_account;
    require!(
        stake_account.staked_amount >= amount,
        EarnError::InsufficientStake
    );
    
    let staking_pool = &mut ctx.accounts.staking_pool;
    let stake_account = &mut ctx.accounts.stake_account;
    let clock = Clock::get()?;
    
    // Calculate pending rewards before unstaking
    let pending_rewards = stake_account.calculate_pending_rewards(staking_pool.reward_per_token_stored);
    
    // Update stake account
    stake_account.staked_amount = stake_account.staked_amount.checked_sub(amount).unwrap();
    stake_account.reward_per_token_paid = staking_pool.reward_per_token_stored;
    stake_account.pending_rewards = 0; // Will be transferred
    stake_account.last_claim_at = clock.unix_timestamp;
    
    // Update pool
    staking_pool.total_staked = staking_pool.total_staked.checked_sub(amount).unwrap();
    staking_pool.last_update_time = clock.unix_timestamp;
    
    // If fully unstaked, decrement staker count
    if stake_account.staked_amount == 0 {
        staking_pool.staker_count = staking_pool.staker_count.saturating_sub(1);
    }
    
    // Transfer staked tokens back to user
    // Need PDA signer for the staking pool
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
                from: ctx.accounts.staking_token_account.to_account_info(),
                to: ctx.accounts.staker_token_account.to_account_info(),
                authority: staking_pool.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;
    
    // Transfer rewards if any
    if pending_rewards > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.rewards_token_account.to_account_info(),
                    to: ctx.accounts.staker_token_account.to_account_info(),
                    authority: staking_pool.to_account_info(),
                },
                signer,
            ),
            pending_rewards,
        )?;
    }
    
    msg!("Unstaked {} tokens. Rewards claimed: {}", amount, pending_rewards);
    
    Ok(())
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    /// The user unstaking
    #[account(mut)]
    pub staker: Signer<'info>,
    
    /// Token mint
    pub token_mint: Account<'info, anchor_spl::token::Mint>,
    
    /// Staking pool
    #[account(
        mut,
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
    
    /// Staker's token account
    #[account(
        mut,
        constraint = staker_token_account.owner == staker.key() @ EarnError::Unauthorized,
    )]
    pub staker_token_account: Account<'info, TokenAccount>,
    
    /// Pool's staked token account
    #[account(
        mut,
        constraint = staking_token_account.key() == staking_pool.stake_token_account,
    )]
    pub staking_token_account: Account<'info, TokenAccount>,
    
    /// Pool's rewards token account
    #[account(mut)]
    pub rewards_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}
