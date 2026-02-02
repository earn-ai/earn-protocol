use anchor_lang::prelude::*;

/// Emitted when a new token is registered with Earn Protocol
#[event]
pub struct TokenRegistered {
    pub token_mint: Pubkey,
    pub creator: Pubkey,
    pub fee_basis_points: u16,
    pub earn_cut_bps: u16,
    pub creator_cut_bps: u16,
    pub buyback_cut_bps: u16,
    pub staking_cut_bps: u16,
    pub treasury_pda: Pubkey,
    pub staking_pool_pda: Pubkey,
    pub timestamp: i64,
}

/// Emitted when fees are collected and distributed
#[event]
pub struct FeeCollected {
    pub token_mint: Pubkey,
    pub trade_amount: u64,
    pub total_fee: u64,
    pub earn_amount: u64,
    pub creator_amount: u64,
    pub buyback_amount: u64,
    pub staking_amount: u64,
    pub timestamp: i64,
}

/// Emitted when a user stakes tokens
#[event]
pub struct Staked {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub new_total_staked: u64,
    pub pool_total_staked: u64,
    pub timestamp: i64,
}

/// Emitted when a user unstakes tokens
#[event]
pub struct Unstaked {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub rewards_claimed: u64,
    pub remaining_stake: u64,
    pub timestamp: i64,
}

/// Emitted when rewards are claimed
#[event]
pub struct RewardsClaimed {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

/// Emitted when a buyback is executed
#[event]
pub struct BuybackExecuted {
    pub token_mint: Pubkey,
    pub sol_spent: u64,
    pub tokens_bought: u64,
    pub tokens_burned: u64,
    pub treasury_balance_after: u64,
    pub timestamp: i64,
}

/// Emitted when token config is updated
#[event]
pub struct ConfigUpdated {
    pub token_mint: Pubkey,
    pub updater: Pubkey,
    pub field: String,
    pub old_value: u64,
    pub new_value: u64,
    pub timestamp: i64,
}

/// Emitted on any suspicious activity
#[event]
pub struct SecurityAlert {
    pub alert_type: String,
    pub token_mint: Pubkey,
    pub user: Pubkey,
    pub details: String,
    pub timestamp: i64,
}
