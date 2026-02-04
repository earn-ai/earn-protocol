use anchor_lang::prelude::*;
use crate::state::{GlobalConfig, StakingPool};

#[derive(Accounts)]
pub struct DepositRewards<'info> {
    #[account(
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
    
    /// CHECK: Pool rewards vault (holds SOL for rewards)
    #[account(
        mut,
        seeds = [b"rewards-vault", staking_pool.key().as_ref()],
        bump
    )]
    pub rewards_vault: UncheckedAccount<'info>,
    
    /// Depositor (usually the crank/Earn wallet)
    #[account(mut)]
    pub depositor: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<DepositRewards>, amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.staking_pool;
    let clock = Clock::get()?;
    
    // Transfer SOL from depositor to rewards vault
    let ix = anchor_lang::solana_program::system_instruction::transfer(
        &ctx.accounts.depositor.key(),
        &ctx.accounts.rewards_vault.key(),
        amount,
    );
    
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.depositor.to_account_info(),
            ctx.accounts.rewards_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;
    
    // Update reward per token if there are stakers
    if pool.total_staked > 0 {
        // Add to reward_per_token_stored
        // reward_per_token += amount * 1e18 / total_staked
        // Use saturating arithmetic to prevent panics on overflow
        let scaled_amount = (amount as u128).saturating_mul(1_000_000_000_000_000_000);
        let reward_increase = scaled_amount
            .checked_div(pool.total_staked as u128)
            .unwrap_or(0);
        
        pool.reward_per_token_stored = pool
            .reward_per_token_stored
            .saturating_add(reward_increase);
    }
    
    pool.rewards_available = pool.rewards_available.saturating_add(amount);
    pool.last_update_time = clock.unix_timestamp;
    
    msg!("Deposited {} lamports as rewards", amount);
    msg!("New reward_per_token: {}", pool.reward_per_token_stored);
    
    Ok(())
}
