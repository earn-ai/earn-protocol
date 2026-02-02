use anchor_lang::prelude::*;

/// Configuration for a token registered with Earn Protocol
/// PDA seeds: [b"config", token_mint.as_ref()]
#[account]
pub struct TokenConfig {
    /// The SPL token mint address
    pub token_mint: Pubkey,
    
    /// Creator wallet that receives creator cut
    pub creator: Pubkey,
    
    /// Fee charged on trades in basis points (200 = 2%)
    pub fee_basis_points: u16,
    
    /// Earn Protocol's cut of fees in basis points (1000 = 10%)
    pub earn_cut_bps: u16,
    
    /// Creator's cut of fees in basis points (2000 = 20%)
    pub creator_cut_bps: u16,
    
    /// Buyback allocation in basis points (3500 = 35%)
    pub buyback_cut_bps: u16,
    
    /// Staking rewards allocation in basis points (3500 = 35%)
    pub staking_cut_bps: u16,
    
    /// Bump for the treasury PDA
    pub treasury_bump: u8,
    
    /// Bump for the staking pool PDA
    pub staking_pool_bump: u8,
    
    /// Bump for this config PDA
    pub config_bump: u8,
    
    /// Total fees collected lifetime (in token's smallest unit)
    pub total_fees_collected: u64,
    
    /// Total fees sent to Earn Protocol
    pub total_earn_fees: u64,
    
    /// Total fees sent to creator
    pub total_creator_fees: u64,
    
    /// Whether the token is actively collecting fees
    pub is_active: bool,
    
    /// Unix timestamp when registered
    pub created_at: i64,
}

impl TokenConfig {
    pub const SIZE: usize = 32 + // token_mint
                            32 + // creator
                            2 +  // fee_basis_points
                            2 +  // earn_cut_bps
                            2 +  // creator_cut_bps
                            2 +  // buyback_cut_bps
                            2 +  // staking_cut_bps
                            1 +  // treasury_bump
                            1 +  // staking_pool_bump
                            1 +  // config_bump
                            8 +  // total_fees_collected
                            8 +  // total_earn_fees
                            8 +  // total_creator_fees
                            1 +  // is_active
                            8;   // created_at
    
    /// Default Earn Protocol cut: 10%
    pub const DEFAULT_EARN_CUT_BPS: u16 = 1000;
    
    /// Default creator cut: 20%
    pub const DEFAULT_CREATOR_CUT_BPS: u16 = 2000;
    
    /// Default buyback allocation: 35%
    pub const DEFAULT_BUYBACK_CUT_BPS: u16 = 3500;
    
    /// Default staking allocation: 35%
    pub const DEFAULT_STAKING_CUT_BPS: u16 = 3500;
    
    /// Maximum fee: 10%
    pub const MAX_FEE_BPS: u16 = 1000;
    
    /// Validate that cuts sum to 100%
    pub fn validate_cuts(&self) -> bool {
        self.earn_cut_bps + self.creator_cut_bps + self.buyback_cut_bps + self.staking_cut_bps == 10000
    }
}

/// Seeds for TokenConfig PDA
pub const TOKEN_CONFIG_SEED: &[u8] = b"config";
