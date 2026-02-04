use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;
pub mod errors;

use instructions::*;

declare_id!("EarnStak1111111111111111111111111111111111111");

/// Earn Staking Program
/// 
/// Universal staking for all tokens launched via Earn Protocol.
/// Stakers deposit tokens and earn SOL rewards from trading fees.
#[program]
pub mod earn_staking {
    use super::*;

    /// Initialize global staking config (one-time admin setup)
    pub fn initialize(ctx: Context<Initialize>, bump: u8) -> Result<()> {
        instructions::initialize::handler(ctx, bump)
    }

    /// Create a staking pool for a token
    pub fn create_pool(
        ctx: Context<CreatePool>,
        min_stake_amount: u64,
        cooldown_seconds: u32,
    ) -> Result<()> {
        instructions::create_pool::handler(ctx, min_stake_amount, cooldown_seconds)
    }

    /// Stake tokens into a pool
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        instructions::stake::handler(ctx, amount)
    }

    /// Unstake tokens from a pool
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        instructions::unstake::handler(ctx, amount)
    }

    /// Claim accumulated rewards
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::claim::handler(ctx)
    }

    /// Deposit rewards into a pool (called by crank after fee distribution)
    pub fn deposit_rewards(ctx: Context<DepositRewards>, amount: u64) -> Result<()> {
        instructions::deposit_rewards::handler(ctx, amount)
    }

    /// Update pool reward rate (permissionless crank)
    pub fn update_rewards(ctx: Context<UpdateRewards>) -> Result<()> {
        instructions::update_rewards::handler(ctx)
    }
}
