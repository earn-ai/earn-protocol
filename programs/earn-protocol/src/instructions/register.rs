use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;

use crate::state::*;
use crate::errors::EarnError;

/// Register a new token with Earn Protocol
/// Creates: TokenConfig, Treasury, StakingPool PDAs
pub fn register(
    ctx: Context<Register>,
    fee_basis_points: u16,
    creator_cut_bps: Option<u16>,
    buyback_cut_bps: Option<u16>,
    staking_cut_bps: Option<u16>,
) -> Result<()> {
    // Validate fee
    require!(
        fee_basis_points <= TokenConfig::MAX_FEE_BPS,
        EarnError::FeeTooHigh
    );
    
    // Set cuts with defaults
    let creator_cut = creator_cut_bps.unwrap_or(TokenConfig::DEFAULT_CREATOR_CUT_BPS);
    let buyback_cut = buyback_cut_bps.unwrap_or(TokenConfig::DEFAULT_BUYBACK_CUT_BPS);
    let staking_cut = staking_cut_bps.unwrap_or(TokenConfig::DEFAULT_STAKING_CUT_BPS);
    let earn_cut = TokenConfig::DEFAULT_EARN_CUT_BPS;
    
    // Validate cuts sum to 100%
    require!(
        earn_cut + creator_cut + buyback_cut + staking_cut == 10000,
        EarnError::InvalidFeeSplits
    );
    
    let clock = Clock::get()?;
    
    // Initialize TokenConfig
    let config = &mut ctx.accounts.token_config;
    config.token_mint = ctx.accounts.token_mint.key();
    config.creator = ctx.accounts.creator.key();
    config.fee_basis_points = fee_basis_points;
    config.earn_cut_bps = earn_cut;
    config.creator_cut_bps = creator_cut;
    config.buyback_cut_bps = buyback_cut;
    config.staking_cut_bps = staking_cut;
    config.treasury_bump = ctx.bumps.treasury;
    config.staking_pool_bump = ctx.bumps.staking_pool;
    config.config_bump = ctx.bumps.token_config;
    config.total_fees_collected = 0;
    config.total_earn_fees = 0;
    config.total_creator_fees = 0;
    config.is_active = true;
    config.created_at = clock.unix_timestamp;
    
    // Initialize Treasury
    let treasury = &mut ctx.accounts.treasury;
    treasury.token_mint = ctx.accounts.token_mint.key();
    treasury.balance = 0;
    treasury.total_buybacks = 0;
    treasury.total_burned = 0;
    treasury.last_buyback = 0;
    treasury.buyback_threshold = Treasury::DEFAULT_BUYBACK_THRESHOLD;
    treasury.bump = ctx.bumps.treasury;
    
    // Initialize Staking Pool
    let staking_pool = &mut ctx.accounts.staking_pool;
    staking_pool.token_mint = ctx.accounts.token_mint.key();
    staking_pool.total_staked = 0;
    staking_pool.reward_per_token_stored = 0;
    staking_pool.total_rewards_distributed = 0;
    staking_pool.staker_count = 0;
    staking_pool.last_update_time = clock.unix_timestamp;
    staking_pool.stake_token_account = ctx.accounts.staking_token_account.key();
    staking_pool.bump = ctx.bumps.staking_pool;
    
    // Update master treasury stats
    let master = &mut ctx.accounts.earn_master_treasury;
    master.total_tokens_registered = master.total_tokens_registered.checked_add(1).unwrap();
    
    msg!("Token registered: {}", ctx.accounts.token_mint.key());
    msg!("Fee: {}bps, Creator: {}bps, Buyback: {}bps, Staking: {}bps",
        fee_basis_points, creator_cut, buyback_cut, staking_cut);
    
    Ok(())
}

#[derive(Accounts)]
pub struct Register<'info> {
    /// Creator registering the token (pays for account creation)
    #[account(mut)]
    pub creator: Signer<'info>,
    
    /// The token mint being registered
    pub token_mint: Account<'info, Mint>,
    
    /// Token config PDA
    #[account(
        init,
        payer = creator,
        space = 8 + TokenConfig::SIZE,
        seeds = [TOKEN_CONFIG_SEED, token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// Treasury PDA for this token
    #[account(
        init,
        payer = creator,
        space = 8 + Treasury::SIZE,
        seeds = [TREASURY_SEED, token_mint.key().as_ref()],
        bump
    )]
    pub treasury: Account<'info, Treasury>,
    
    /// Staking pool PDA
    #[account(
        init,
        payer = creator,
        space = 8 + StakingPool::SIZE,
        seeds = [STAKING_POOL_SEED, token_mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    /// Token account for the staking pool to hold staked tokens
    #[account(
        init,
        payer = creator,
        associated_token::mint = token_mint,
        associated_token::authority = staking_pool,
    )]
    pub staking_token_account: Account<'info, TokenAccount>,
    
    /// Earn Protocol master treasury (must exist - initialized separately)
    #[account(
        mut,
        seeds = [EARN_MASTER_SEED],
        bump = earn_master_treasury.bump,
    )]
    pub earn_master_treasury: Account<'info, EarnMasterTreasury>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}
