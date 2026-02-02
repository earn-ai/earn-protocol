import { PublicKey } from '@solana/web3.js';

/**
 * Configuration for a registered token
 */
export interface TokenConfig {
  tokenMint: PublicKey;
  creator: PublicKey;
  feePercent: number;        // Fee on trades (e.g., 2 = 2%)
  earnCut: number;           // % of fees to Earn Protocol (e.g., 10 = 10% of fees)
  creatorCut: number;        // % of fees to creator
  buybackPercent: number;    // % of remaining fees for buybacks
  stakingPercent: number;    // % of remaining fees for stakers
  registeredAt: number;      // Unix timestamp
  active: boolean;
}

/**
 * Token treasury state
 */
export interface TokenTreasury {
  tokenMint: PublicKey;
  treasuryPDA: PublicKey;
  totalFeesCollected: bigint;
  totalBuybacks: bigint;
  totalStakingRewards: bigint;
  totalCreatorEarnings: bigint;
  totalEarnEarnings: bigint;
  treasuryBalance: bigint;   // Tokens held for buybacks
}

/**
 * Staking position for a holder
 */
export interface StakingPosition {
  wallet: PublicKey;
  tokenMint: PublicKey;
  stakedAmount: bigint;
  stakedAt: number;
  lastClaimAt: number;
  pendingRewards: bigint;
}

/**
 * Staking pool stats for a token
 */
export interface StakingPool {
  tokenMint: PublicKey;
  totalStaked: bigint;
  rewardsPerTokenStored: bigint;
  lastUpdateTime: number;
  totalRewardsDistributed: bigint;
  stakerCount: number;
}

/**
 * Fee distribution breakdown
 */
export interface FeeDistribution {
  totalFee: bigint;
  earnAmount: bigint;
  creatorAmount: bigint;
  buybackAmount: bigint;
  stakingAmount: bigint;
}

/**
 * Registration request
 */
export interface RegisterRequest {
  tokenMint: string;
  config: {
    feePercent: number;
    earnCut?: number;        // Default: 10%
    creatorCut?: number;     // Default: 20%
    buybackPercent?: number; // Default: 50%
    stakingPercent?: number; // Default: 50%
  };
}

/**
 * Stake request
 */
export interface StakeRequest {
  tokenMint: string;
  amount: number;
}

/**
 * Unstake request
 */
export interface UnstakeRequest {
  tokenMint: string;
  amount: number;
}

/**
 * Creator dashboard data
 */
export interface CreatorDashboard {
  tokenMint: string;
  config: TokenConfig;
  treasury: TokenTreasury;
  stakingPool: StakingPool;
  earnings: {
    total: bigint;
    last24h: bigint;
    last7d: bigint;
  };
}

/**
 * Earn Protocol global stats
 */
export interface EarnProtocolStats {
  totalTokensRegistered: number;
  totalFeesCollected: bigint;
  totalEarnRevenue: bigint;
  totalBuybacksExecuted: bigint;
  totalStakingRewards: bigint;
  earnTreasury: bigint;
}
