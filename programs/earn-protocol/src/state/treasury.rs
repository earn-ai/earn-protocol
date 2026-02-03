use anchor_lang::prelude::*;

/// Treasury account for a registered token
/// Holds SOL/tokens for buybacks
/// PDA seeds: [b"treasury", token_mint.as_ref()]
#[account]
pub struct Treasury {
    /// The token this treasury belongs to
    pub token_mint: Pubkey,
    
    /// Current balance available for buybacks (in lamports or token units)
    pub balance: u64,
    
    /// Total amount used for buybacks lifetime
    pub total_buybacks: u64,
    
    /// Total tokens burned from buybacks
    pub total_burned: u64,
    
    /// Unix timestamp of last buyback execution
    pub last_buyback: i64,
    
    /// Minimum balance threshold to trigger buyback
    pub buyback_threshold: u64,
    
    /// PDA bump
    pub bump: u8,
}

impl Treasury {
    pub const SIZE: usize = 32 + // token_mint
                            8 +  // balance
                            8 +  // total_buybacks
                            8 +  // total_burned
                            8 +  // last_buyback
                            8 +  // buyback_threshold
                            1;   // bump
    
    /// Default buyback threshold: 0.1 SOL equivalent
    pub const DEFAULT_BUYBACK_THRESHOLD: u64 = 100_000_000; // 0.1 SOL in lamports
    
    /// Minimum cooldown between buybacks: 1 hour
    pub const BUYBACK_COOLDOWN_SECONDS: i64 = 3600;
    
    /// Maximum slippage allowed: 5%
    pub const MAX_SLIPPAGE_BPS: u64 = 500;
}

/// Earn Protocol Master Treasury
/// Holds all protocol revenue
/// PDA seeds: [b"earn_master"]
#[account]
pub struct EarnMasterTreasury {
    /// Authority that can withdraw (Earn's main wallet)
    pub authority: Pubkey,
    
    /// Total SOL collected
    pub total_sol_collected: u64,
    
    /// Total number of tokens registered
    pub total_tokens_registered: u32,
    
    /// Total fees collected across all tokens
    pub total_fees_processed: u64,
    
    /// PDA bump
    pub bump: u8,
}

impl EarnMasterTreasury {
    pub const SIZE: usize = 32 + // authority
                            8 +  // total_sol_collected
                            4 +  // total_tokens_registered
                            8 +  // total_fees_processed
                            1;   // bump
}

/// Seeds
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const EARN_MASTER_SEED: &[u8] = b"earn_master";
