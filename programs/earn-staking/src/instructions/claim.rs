use anchor_lang::prelude::*;
use crate::state::{GlobalConfig, StakingPool, StakeAccount};
use crate::errors::StakingError;

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(
        mut,
        seeds = [b"global-config"],
        bump = global_config.bump
    )]
    pub global_config: Account<'info, GlobalConfig>,
    
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
    
    /// CHECK: Pool rewards vault (holds SOL for rewards)
    #[account(
        mut,
        seeds = [b"rewards-vault", staking_pool.key().as_ref()],
        bump
    )]
    pub rewards_vault: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimRewards>) -> Result<()> {
    let pool = &mut ctx.accounts.staking_pool;
    let stake_account = &mut ctx.accounts.stake_account;
    let global_config = &mut ctx.accounts.global_config;
    let clock = Clock::get()?;
    
    // Update rewards
    let reward_per_token = pool.reward_per_token();
    stake_account.update_rewards(reward_per_token, stake_account.amount);
    
    let rewards_to_claim = stake_account.rewards_earned;
    
    require!(rewards_to_claim > 0, StakingError::NoRewardsToClaim);
    
    // Transfer SOL rewards from vault to user
    let pool_key = pool.key();
    let seeds = &[
        b"rewards-vault",
        pool_key.as_ref(),
        &[ctx.bumps.rewards_vault],
    ];
    
    **ctx.accounts.rewards_vault.try_borrow_mut_lamports()? -= rewards_to_claim;
    **ctx.accounts.user.try_borrow_mut_lamports()? += rewards_to_claim;
    
    // Update state
    stake_account.rewards_earned = 0;
    stake_account.last_claim_at = clock.unix_timestamp;
    pool.rewards_distributed = pool.rewards_distributed.saturating_add(rewards_to_claim);
    global_config.total_rewards_distributed = global_config
        .total_rewards_distributed
        .saturating_add(rewards_to_claim);
    
    msg!("Claimed {} lamports in rewards", rewards_to_claim);
    
    Ok(())
}
