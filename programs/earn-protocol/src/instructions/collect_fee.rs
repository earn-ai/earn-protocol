use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::*;
use crate::errors::EarnError;

/// Collect fee from a trade and distribute to all parties
/// Called by: DEX integration, transfer hook, or manually
pub fn collect_fee(
    ctx: Context<CollectFee>,
    trade_amount: u64,
) -> Result<()> {
    let config = &ctx.accounts.token_config;
    
    require!(config.is_active, EarnError::TokenNotActive);
    require!(trade_amount > 0, EarnError::InvalidAmount);
    
    // Calculate total fee
    let total_fee = trade_amount
        .checked_mul(config.fee_basis_points as u64)
        .unwrap()
        .checked_div(10000)
        .unwrap();
    
    if total_fee == 0 {
        return Ok(());
    }
    
    // Calculate splits
    let earn_amount = total_fee
        .checked_mul(config.earn_cut_bps as u64)
        .unwrap()
        .checked_div(10000)
        .unwrap();
    
    let creator_amount = total_fee
        .checked_mul(config.creator_cut_bps as u64)
        .unwrap()
        .checked_div(10000)
        .unwrap();
    
    let buyback_amount = total_fee
        .checked_mul(config.buyback_cut_bps as u64)
        .unwrap()
        .checked_div(10000)
        .unwrap();
    
    // Staking gets the remainder to avoid rounding issues
    let staking_amount = total_fee
        .checked_sub(earn_amount)
        .unwrap()
        .checked_sub(creator_amount)
        .unwrap()
        .checked_sub(buyback_amount)
        .unwrap();
    
    // Transfer to Earn master treasury
    if earn_amount > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.fee_source.to_account_info(),
                    to: ctx.accounts.earn_token_account.to_account_info(),
                    authority: ctx.accounts.fee_payer.to_account_info(),
                },
            ),
            earn_amount,
        )?;
    }
    
    // Transfer to creator
    if creator_amount > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.fee_source.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: ctx.accounts.fee_payer.to_account_info(),
                },
            ),
            creator_amount,
        )?;
    }
    
    // Transfer to treasury for buybacks
    if buyback_amount > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.fee_source.to_account_info(),
                    to: ctx.accounts.treasury_token_account.to_account_info(),
                    authority: ctx.accounts.fee_payer.to_account_info(),
                },
            ),
            buyback_amount,
        )?;
    }
    
    // Update staking pool rewards
    if staking_amount > 0 {
        let staking_pool = &mut ctx.accounts.staking_pool;
        staking_pool.update_reward_per_token(staking_amount);
        
        // Transfer to staking rewards pool (or keep in treasury for distribution)
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.fee_source.to_account_info(),
                    to: ctx.accounts.staking_rewards_account.to_account_info(),
                    authority: ctx.accounts.fee_payer.to_account_info(),
                },
            ),
            staking_amount,
        )?;
    }
    
    // Update stats
    let config = &mut ctx.accounts.token_config;
    config.total_fees_collected = config.total_fees_collected.checked_add(total_fee).unwrap();
    config.total_earn_fees = config.total_earn_fees.checked_add(earn_amount).unwrap();
    config.total_creator_fees = config.total_creator_fees.checked_add(creator_amount).unwrap();
    
    let treasury = &mut ctx.accounts.treasury;
    treasury.balance = treasury.balance.checked_add(buyback_amount).unwrap();
    
    let master = &mut ctx.accounts.earn_master_treasury;
    master.total_fees_processed = master.total_fees_processed.checked_add(total_fee).unwrap();
    
    msg!("Fee collected: {} (Earn: {}, Creator: {}, Buyback: {}, Staking: {})",
        total_fee, earn_amount, creator_amount, buyback_amount, staking_amount);
    
    Ok(())
}

#[derive(Accounts)]
pub struct CollectFee<'info> {
    /// Whoever is paying the fee (usually the trader)
    pub fee_payer: Signer<'info>,
    
    /// Token account the fee is taken from
    #[account(mut)]
    pub fee_source: Account<'info, TokenAccount>,
    
    /// The token being traded
    pub token_mint: Account<'info, anchor_spl::token::Mint>,
    
    /// Token config for this token
    #[account(
        mut,
        seeds = [TOKEN_CONFIG_SEED, token_mint.key().as_ref()],
        bump = token_config.config_bump,
        constraint = token_config.token_mint == token_mint.key() @ EarnError::InvalidTokenMint,
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// Treasury for this token
    #[account(
        mut,
        seeds = [TREASURY_SEED, token_mint.key().as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,
    
    /// Token account for treasury
    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,
    
    /// Staking pool for this token
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED, token_mint.key().as_ref()],
        bump = staking_pool.bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    /// Token account for staking rewards
    #[account(mut)]
    pub staking_rewards_account: Account<'info, TokenAccount>,
    
    /// Creator's token account
    #[account(
        mut,
        constraint = creator_token_account.owner == token_config.creator @ EarnError::Unauthorized,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    
    /// Earn master treasury
    #[account(
        mut,
        seeds = [EARN_MASTER_SEED],
        bump = earn_master_treasury.bump,
    )]
    pub earn_master_treasury: Account<'info, EarnMasterTreasury>,
    
    /// Earn's token account for this token
    #[account(mut)]
    pub earn_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}
