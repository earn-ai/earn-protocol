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

// ============================================
// TOKEN LAUNCH TEMPLATES
// ============================================

/**
 * Preset configurations for common token launch strategies
 */
export interface TokenTemplate {
  feeBps: number;        // Fee on trades in basis points (300 = 3%)
  earnCutBps: number;    // Earn Protocol cut (1000 = 10%)
  creatorCutBps: number; // Creator cut
  buybackCutBps: number; // Buyback allocation
  stakingCutBps: number; // Staking rewards allocation
}

/**
 * Available token templates
 */
export const TOKEN_TEMPLATES: Record<string, TokenTemplate> = {
  // High buyback for price support - good for degen/meme coins
  degen: {
    feeBps: 300,         // 3% fee
    earnCutBps: 1000,    // 10% to Earn (minimum)
    creatorCutBps: 1000, // 10% to creator
    buybackCutBps: 5000, // 50% to buyback (aggressive)
    stakingCutBps: 3000, // 30% to stakers
  },
  // High creator cut for sustainable projects
  creator: {
    feeBps: 200,         // 2% fee
    earnCutBps: 1000,    // 10% to Earn
    creatorCutBps: 3000, // 30% to creator (high)
    buybackCutBps: 3000, // 30% to buyback
    stakingCutBps: 3000, // 30% to stakers
  },
  // High staking rewards for community-driven tokens
  community: {
    feeBps: 200,         // 2% fee
    earnCutBps: 1000,    // 10% to Earn
    creatorCutBps: 1000, // 10% to creator
    buybackCutBps: 3000, // 30% to buyback
    stakingCutBps: 5000, // 50% to stakers (community focused)
  },
  // Minimal fees for high-volume tokens
  lowfee: {
    feeBps: 100,         // 1% fee
    earnCutBps: 1000,    // 10% to Earn
    creatorCutBps: 2000, // 20% to creator
    buybackCutBps: 4000, // 40% to buyback
    stakingCutBps: 3000, // 30% to stakers
  },
};

export type TemplateName = keyof typeof TOKEN_TEMPLATES;

// ============================================
// IDEMPOTENCY & OPERATION TRACKING
// ============================================

/**
 * Operation status for tracking async operations
 */
export type OperationStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Operation record for idempotency
 */
export interface OperationRecord {
  operationId: string;
  idempotencyKey: string;
  status: OperationStatus;
  type: 'register' | 'stake' | 'unstake' | 'claim' | 'trade' | 'buyback';
  request: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  txSignature?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Request with idempotency key
 */
export interface IdempotentRequest {
  idempotencyKey?: string;  // Client-generated, ensures same response for same key
}

/**
 * Register request with template support
 */
export interface RegisterWithTemplateRequest extends IdempotentRequest {
  tokenMint: string;
  template?: TemplateName;  // Use preset if provided
  config?: {                // Or custom config
    feePercent?: number;
    earnCut?: number;
    creatorCut?: number;
    buybackPercent?: number;
    stakingPercent?: number;
  };
}

/**
 * Stake request with idempotency
 */
export interface StakeRequestV2 extends StakeRequest, IdempotentRequest {}

/**
 * Unstake request with idempotency
 */
export interface UnstakeRequestV2 extends UnstakeRequest, IdempotentRequest {}

/**
 * Trade request with idempotency
 */
export interface TradeRequest extends IdempotentRequest {
  tokenMint: string;
  inputToken: string;
  outputToken: string;
  amount: string | number;
  slippageBps?: number;
  userWallet: string;
}

/**
 * Standard API response with operation tracking
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  operationId?: string;
  status?: OperationStatus;
  txSignature?: string;
  result?: T;
  error?: string;
}

// ============================================
// ONE-CLICK ONBOARDING
// ============================================

/**
 * Intent types for automatic template selection
 */
export type OnboardIntent = 'community' | 'creator' | 'degen' | 'auto';

/**
 * One-click onboarding request
 * Agent says "make my token legit" → done
 */
export interface OnboardRequest extends IdempotentRequest {
  tokenMint: string;
  creatorWallet?: string;  // Optional - defaults to Earn wallet
  intent: OnboardIntent;   // Which template strategy to use
  network?: 'mainnet' | 'devnet';  // Which network to check (default: tries both)
}

/**
 * Token verification result
 */
export interface TokenVerification {
  exists: boolean;
  mint: string;
  decimals?: number;
  supply?: string;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  holderCount?: number;
  topHolderConcentration?: number;  // % held by top 10 holders
}

/**
 * Onboarding response - everything an agent needs
 */
export interface OnboardResponse {
  status: 'live' | 'pending' | 'failed';
  tokenMint: string;
  template: TemplateName;
  stakingPool: string;           // PDA address
  dashboardUrl: string;          // earn.supply/token/ABC123
  nextSteps: {
    staking: string;             // "Users can stake at earn.supply/stake/ABC123"
    fees: string;                // "Automatic 2% on all swaps via Jupiter"
    rewards: string;             // "Staking rewards funded from fee pool"
    share: string;               // Twitter/social share link
  };
  config: {
    feePercent: number;
    earnCut: number;
    creatorCut: number;
    buybackPercent: number;
    stakingPercent: number;
  };
  verification: TokenVerification;
}
