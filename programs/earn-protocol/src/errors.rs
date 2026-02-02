use anchor_lang::prelude::*;

#[error_code]
pub enum EarnError {
    #[msg("Fee basis points exceeds maximum (10%)")]
    FeeTooHigh,
    
    #[msg("Fee splits must sum to 10000 basis points (100%)")]
    InvalidFeeSplits,
    
    #[msg("Token is already registered")]
    TokenAlreadyRegistered,
    
    #[msg("Token is not registered")]
    TokenNotRegistered,
    
    #[msg("Token is not active")]
    TokenNotActive,
    
    #[msg("Insufficient balance for operation")]
    InsufficientBalance,
    
    #[msg("Insufficient staked amount")]
    InsufficientStake,
    
    #[msg("No rewards to claim")]
    NoRewardsToClaim,
    
    #[msg("Treasury balance below buyback threshold")]
    BelowBuybackThreshold,
    
    #[msg("Arithmetic overflow")]
    Overflow,
    
    #[msg("Unauthorized")]
    Unauthorized,
    
    #[msg("Invalid token mint")]
    InvalidTokenMint,
    
    #[msg("Invalid amount")]
    InvalidAmount,
}
