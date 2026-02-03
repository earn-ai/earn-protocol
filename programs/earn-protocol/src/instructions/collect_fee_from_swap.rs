use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

use crate::state::*;
use crate::errors::EarnError;

/// Collect fee from a swap output and distribute to all parties
/// Called by: Swap transaction after Jupiter swap completes
/// 
/// This is the key instruction for the Fee Interception Layer.
/// It's added to the transaction AFTER the Jupiter swap instruction,
/// taking a fee from the swap output before it reaches the user.
pub fn collect_fee_from_swap(
    ctx: Context<CollectFeeFromSwap>,
    swap_output_amount: u64,
) -> Result<()> {
    let config = &ctx.accounts.token_config;
    
    require!(config.is_active, EarnError::TokenNotActive);
    require!(swap_output_amount > 0, EarnError::InvalidAmount);
    
    // Calculate total fee based on config
    let total_fee = swap_output_amount
        .checked_mul(config.fee_basis_points as u64)
        .unwrap()
        .checked_div(10000)
        .unwrap();
    
    if total_fee == 0 {
        return Ok(());
    }
    
    // Calculate splits (all in basis points out of 10000)
    let protocol_amount = total_fee
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
    
    // Stakers get the remainder to avoid rounding issues
    let staker_amount = total_fee
        .checked_sub(protocol_amount)
        .unwrap()
        .checked_sub(creator_amount)
        .unwrap()
        .checked_sub(buyback_amount)
        .unwrap();
    
    // Transfer to protocol wallet
    if protocol_amount > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.protocol_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            protocol_amount,
        )?;
    }
    
    // Transfer to creator wallet
    if creator_amount > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            creator_amount,
        )?;
    }
    
    // Transfer to buyback pool
    if buyback_amount > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.buyback_pool.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            buyback_amount,
        )?;
    }
    
    // Transfer to staking pool
    if staker_amount > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.staking_pool.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            staker_amount,
        )?;

        // Update staking pool rewards
        let staking_pool_state = &mut ctx.accounts.staking_pool_state;
        staking_pool_state.update_reward_per_token(staker_amount);
    }
    
    // Update stats
    let config = &mut ctx.accounts.token_config;
    config.total_fees_collected = config.total_fees_collected.checked_add(total_fee).unwrap();
    config.total_earn_fees = config.total_earn_fees.checked_add(protocol_amount).unwrap();
    config.total_creator_fees = config.total_creator_fees.checked_add(creator_amount).unwrap();
    
    let treasury = &mut ctx.accounts.treasury;
    treasury.balance = treasury.balance.checked_add(buyback_amount).unwrap();
    
    // Emit event
    emit!(crate::events::FeeCollectedFromSwap {
        token_mint: ctx.accounts.token_mint.key(),
        user: ctx.accounts.user.key(),
        swap_output_amount,
        total_fee,
        protocol_amount,
        creator_amount,
        buyback_amount,
        staker_amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    msg!("Fee collected from swap: {} total (Protocol: {}, Creator: {}, Buyback: {}, Stakers: {})",
        total_fee, protocol_amount, creator_amount, buyback_amount, staker_amount);
    
    Ok(())
}

#[derive(Accounts)]
pub struct CollectFeeFromSwap<'info> {
    /// The user who received the swap output (and pays the fee)
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// The token being traded (output of the swap)
    pub token_mint: Account<'info, Mint>,
    
    /// User's token account (has the swap output)
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ EarnError::Unauthorized,
        constraint = user_token_account.mint == token_mint.key() @ EarnError::InvalidTokenMint,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    /// Token config for this token (stores fee settings)
    #[account(
        mut,
        seeds = [TOKEN_CONFIG_SEED, token_mint.key().as_ref()],
        bump = token_config.config_bump,
        constraint = token_config.token_mint == token_mint.key() @ EarnError::InvalidTokenMint,
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// Treasury for this token (tracks buyback funds)
    #[account(
        mut,
        seeds = [TREASURY_SEED, token_mint.key().as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,
    
    /// Staking pool state for this token
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED, token_mint.key().as_ref()],
        bump = staking_pool_state.bump,
    )]
    pub staking_pool_state: Account<'info, StakingPool>,
    
    /// Protocol's token account (receives protocol fee)
    #[account(mut)]
    pub protocol_token_account: Account<'info, TokenAccount>,
    
    /// Creator's token account (receives creator fee)
    #[account(
        mut,
        constraint = creator_token_account.owner == token_config.creator @ EarnError::Unauthorized,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    
    /// Buyback pool token account
    #[account(mut)]
    pub buyback_pool: Account<'info, TokenAccount>,
    
    /// Staking pool token account (for rewards distribution)
    #[account(mut)]
    pub staking_pool: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}
