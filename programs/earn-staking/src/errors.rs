use anchor_lang::prelude::*;

#[error_code]
pub enum StakingError {
    #[msg("Stake amount is below minimum")]
    StakeBelowMinimum,
    
    #[msg("Insufficient staked balance")]
    InsufficientStakedBalance,
    
    #[msg("Cooldown period has not passed")]
    CooldownNotPassed,
    
    #[msg("No rewards to claim")]
    NoRewardsToClaim,
    
    #[msg("Insufficient rewards in vault")]
    InsufficientRewards,
    
    #[msg("Pool is paused")]
    PoolPaused,
    
    #[msg("Unauthorized")]
    Unauthorized,
    
    #[msg("Invalid pool for this token")]
    InvalidPool,
    
    #[msg("Arithmetic overflow")]
    Overflow,
    
    #[msg("Must request unstake before cooldown")]
    MustRequestUnstake,
    
    #[msg("Already requested unstake")]
    AlreadyRequestedUnstake,
    
    #[msg("No unstake request pending")]
    NoUnstakeRequest,
}
