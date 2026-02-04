use anchor_lang::prelude::*;
use crate::state::GlobalConfig;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = GlobalConfig::SIZE,
        seeds = [b"global-config"],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// CHECK: Earn treasury wallet
    pub earn_wallet: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, bump: u8) -> Result<()> {
    let config = &mut ctx.accounts.global_config;
    
    config.authority = ctx.accounts.authority.key();
    config.earn_wallet = ctx.accounts.earn_wallet.key();
    config.total_pools = 0;
    config.total_staked_value = 0;
    config.total_rewards_distributed = 0;
    config.bump = bump;
    
    msg!("Initialized global staking config");
    msg!("Authority: {}", config.authority);
    msg!("Earn Wallet: {}", config.earn_wallet);
    
    Ok(())
}
