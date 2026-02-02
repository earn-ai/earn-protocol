use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;
pub mod errors;

use instructions::*;

// Replace with actual program ID after first deployment
declare_id!("EarnProt111111111111111111111111111111111111");

/// Earn Protocol - Tokenomics-as-a-Service for Memecoins
/// 
/// Turn any memecoin into a real economy with:
/// - Fee collection on trades
/// - Automatic buybacks
/// - Staking rewards
/// - Creator revenue share
#[program]
pub mod earn_protocol {
    use super::*;

    /// Initialize the Earn master treasury (one-time admin setup)
    pub fn initialize_master_treasury(ctx: Context<InitializeMasterTreasury>) -> Result<()> {
        instructions::buyback::initialize_master_treasury(ctx)
    }

    /// Register a new token with Earn Protocol
    /// 
    /// Creates TokenConfig, Treasury, and StakingPool PDAs
    /// 
    /// # Arguments
    /// * `fee_basis_points` - Fee charged on trades (max 1000 = 10%)
    /// * `creator_cut_bps` - Creator's share of fees (default 2000 = 20%)
    /// * `buyback_cut_bps` - Buyback allocation (default 3500 = 35%)
    /// * `staking_cut_bps` - Staking rewards allocation (default 3500 = 35%)
    pub fn register(
        ctx: Context<Register>,
        fee_basis_points: u16,
        creator_cut_bps: Option<u16>,
        buyback_cut_bps: Option<u16>,
        staking_cut_bps: Option<u16>,
    ) -> Result<()> {
        instructions::register::register(
            ctx,
            fee_basis_points,
            creator_cut_bps,
            buyback_cut_bps,
            staking_cut_bps,
        )
    }

    /// Collect and distribute fees from a trade
    /// 
    /// Called by DEX integration or transfer hook
    /// Distributes to: Earn, Creator, Treasury (buybacks), Staking Pool
    pub fn collect_fee(ctx: Context<CollectFee>, trade_amount: u64) -> Result<()> {
        instructions::collect_fee::collect_fee(ctx, trade_amount)
    }

    /// Stake tokens in the staking pool
    /// 
    /// Creates StakeAccount PDA if first time staking
    /// Starts accruing rewards immediately
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        instructions::stake::stake(ctx, amount)
    }

    /// Unstake tokens and claim pending rewards
    /// 
    /// Returns staked tokens plus any accumulated rewards
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        instructions::unstake::unstake(ctx, amount)
    }

    /// Claim pending rewards without unstaking
    /// 
    /// Transfers accumulated rewards to staker
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::claim::claim_rewards(ctx)
    }

    /// Execute a buyback using treasury funds
    /// 
    /// Permissionless - anyone can trigger when threshold is met
    /// Swaps treasury funds for tokens and burns them
    pub fn execute_buyback(
        ctx: Context<ExecuteBuyback>,
        amount: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        instructions::buyback::execute_buyback(ctx, amount, min_tokens_out)
    }
}
