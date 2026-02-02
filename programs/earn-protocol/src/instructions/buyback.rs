use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Burn};

use crate::state::*;
use crate::errors::EarnError;

/// Execute a buyback using treasury funds
/// Permissionless - anyone can trigger when threshold is met
/// In production: would CPI to Jupiter for actual swap
pub fn execute_buyback(
    ctx: Context<ExecuteBuyback>,
    amount: u64,
    _min_tokens_out: u64, // For Jupiter slippage protection
) -> Result<()> {
    let treasury = &mut ctx.accounts.treasury;
    let clock = Clock::get()?;
    
    require!(
        treasury.balance >= treasury.buyback_threshold,
        EarnError::BelowBuybackThreshold
    );
    
    require!(
        amount <= treasury.balance,
        EarnError::InsufficientBalance
    );
    
    // In production, this would:
    // 1. CPI to Jupiter to swap SOL/USDC for the token
    // 2. Receive tokens back
    // 3. Burn them or add to LP
    
    // For now, we'll simulate by just burning tokens from a provided account
    // The actual Jupiter integration would be added in a real deployment
    
    // Update treasury state
    treasury.balance = treasury.balance.checked_sub(amount).unwrap();
    treasury.total_buybacks = treasury.total_buybacks.checked_add(amount).unwrap();
    treasury.last_buyback = clock.unix_timestamp;
    
    // Burn the tokens (assuming we received them from the swap)
    let tokens_to_burn = ctx.accounts.tokens_to_burn.amount;
    if tokens_to_burn > 0 {
        let token_mint_key = ctx.accounts.token_mint.key();
        let seeds = &[
            TREASURY_SEED,
            token_mint_key.as_ref(),
            &[treasury.bump],
        ];
        let signer = &[&seeds[..]];
        
        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.token_mint.to_account_info(),
                    from: ctx.accounts.tokens_to_burn.to_account_info(),
                    authority: ctx.accounts.treasury.to_account_info(),
                },
                signer,
            ),
            tokens_to_burn,
        )?;
        
        treasury.total_burned = treasury.total_burned.checked_add(tokens_to_burn).unwrap();
        
        msg!("Buyback executed: {} SOL spent, {} tokens burned", amount, tokens_to_burn);
    } else {
        msg!("Buyback executed: {} SOL spent (no tokens to burn yet)", amount);
    }
    
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteBuyback<'info> {
    /// Anyone can trigger buyback (permissionless)
    pub executor: Signer<'info>,
    
    /// Token mint
    #[account(mut)] // Mutable for burning
    pub token_mint: Account<'info, anchor_spl::token::Mint>,
    
    /// Token config
    #[account(
        seeds = [TOKEN_CONFIG_SEED, token_mint.key().as_ref()],
        bump = token_config.config_bump,
    )]
    pub token_config: Account<'info, TokenConfig>,
    
    /// Treasury for this token
    #[account(
        mut,
        seeds = [TREASURY_SEED, token_mint.key().as_ref()],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,
    
    /// Treasury's token account (holds tokens to burn)
    #[account(
        mut,
        constraint = tokens_to_burn.owner == treasury.key(),
    )]
    pub tokens_to_burn: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    // In production, would also need Jupiter program accounts for CPI
}

/// Initialize the Earn master treasury (one-time setup)
pub fn initialize_master_treasury(ctx: Context<InitializeMasterTreasury>) -> Result<()> {
    let master = &mut ctx.accounts.earn_master_treasury;
    master.authority = ctx.accounts.authority.key();
    master.total_sol_collected = 0;
    master.total_tokens_registered = 0;
    master.total_fees_processed = 0;
    master.bump = ctx.bumps.earn_master_treasury;
    
    msg!("Earn Master Treasury initialized");
    
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeMasterTreasury<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + EarnMasterTreasury::SIZE,
        seeds = [EARN_MASTER_SEED],
        bump,
    )]
    pub earn_master_treasury: Account<'info, EarnMasterTreasury>,
    
    pub system_program: Program<'info, System>,
}
