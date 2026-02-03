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

/**
 * Buyback safety configuration
 */
export interface BuybackConfig {
  maxSlippageBps: number;      // e.g., 300 = 3% max slippage
  minLiquidityUsd: number;     // Don't buyback if pool < this (e.g., 10000)
  maxBuybackPct: number;       // Max % of pool per buyback (e.g., 5 = 5%)
  cooldownSeconds: number;     // Min time between buybacks
  chunkSize: number;           // Split large buybacks into chunks (in tokens)
  circuitBreaker: {
    volatilityThreshold: number; // Pause if price moved >X% in 1hr (e.g., 20)
    enabled: boolean;
  };
}

/**
 * Default buyback config with safety rails
 */
export const DEFAULT_BUYBACK_CONFIG: BuybackConfig = {
  maxSlippageBps: 300,         // 3% max slippage
  minLiquidityUsd: 10000,      // Min $10k liquidity
  maxBuybackPct: 5,            // Max 5% of pool per buyback
  cooldownSeconds: 3600,       // 1 hour minimum between buybacks
  chunkSize: 1000000000,       // 1B tokens per chunk
  circuitBreaker: {
    volatilityThreshold: 20,   // Pause if >20% price move in 1hr
    enabled: true,
  },
};

/**
 * Staking position with time-weighted rewards
 */
export interface StakingPositionV2 extends StakingPosition {
  // Time-weighted multiplier (1x day 0 → 2x day 30 → 3x day 90)
  timeMultiplier: number;
  // Calculated at unstake time if < 7 days
  earlyExitPenalty: number;
}

/**
 * Creator verification proof
 */
export interface CreatorProof {
  // Option A: Signature from mint authority
  mintAuthoritySignature?: string;
  // Option B: Signature from metadata update authority  
  metadataAuthoritySignature?: string;
  // Option C: On-chain transaction proving ownership
  proofTxSignature?: string;
}

/**
 * Registration request with creator verification
 */
export interface RegisterRequestV2 extends RegisterRequest {
  creatorWallet: string;
  proof?: CreatorProof;  // Required in production, optional for hackathon
}
