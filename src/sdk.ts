/**
 * Earn Protocol TypeScript SDK
 * 
 * Usage:
 *   import { EarnSDK } from '@earn-protocol/sdk';
 *   const earn = new EarnSDK({ baseUrl: 'https://earn-api.example.com' });
 */

import { Keypair, PublicKey } from '@solana/web3.js';

export interface EarnSDKConfig {
  baseUrl: string;
  network?: 'devnet' | 'mainnet';
}

export interface RegisterOptions {
  tokenMint: string;
  template?: 'degen' | 'creator' | 'community' | 'lowfee';
  config?: {
    feePercent?: number;
    earnCut?: number;
    creatorCut?: number;
    buybackPercent?: number;
    stakingPercent?: number;
  };
  creatorWallet: string | PublicKey | Keypair;
}

export interface TradeOptions {
  tokenMint: string;
  inputToken: string;
  outputToken?: string;
  amount: number | string;
  slippageBps?: number;
  userWallet: string | PublicKey | Keypair;
}

export interface StakeOptions {
  tokenMint: string;
  amount: number | string;
  userWallet: string | PublicKey | Keypair;
}

export interface UnstakeOptions {
  tokenMint: string;
  amount: number | string;
  userWallet: string | PublicKey | Keypair;
}

export interface ClaimOptions {
  tokenMint: string;
  userWallet: string | PublicKey | Keypair;
}

export interface OperationResult<T = unknown> {
  success: boolean;
  operationId?: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  txSignature?: string;
  result?: T;
  error?: string;
}

export interface TokenConfig {
  tokenMint: string;
  creator: string;
  feePercent: number;
  earnCut: number;
  creatorCut: number;
  buybackPercent: number;
  stakingPercent: number;
  registeredAt: number;
  active: boolean;
}

export interface TokenStats {
  tokenMint: string;
  fees: {
    totalCollected: string;
    earnEarnings: string;
    creatorEarnings: string;
  };
  buybacks: {
    totalExecuted: string;
    treasuryBalance: string;
  };
  staking: {
    totalStaked: string;
    totalRewardsDistributed: string;
    stakerCount: number;
    rewardRate: string;
  };
}

export interface StakePosition {
  tokenMint: string;
  wallet: string;
  stakedAmount: string;
  stakedAt: number | null;
  lastClaimAt?: number;
  pendingRewards: string;
}

export interface RewardsInfo {
  tokenMint: string;
  wallet: string;
  stakedAmount: string;
  pendingRewards: string;
}

function getWalletAddress(wallet: string | PublicKey | Keypair): string {
  if (typeof wallet === 'string') return wallet;
  if (wallet instanceof PublicKey) return wallet.toBase58();
  return wallet.publicKey.toBase58();
}

function generateIdempotencyKey(operation: string): string {
  return `${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class EarnSDK {
  private baseUrl: string;
  private network: string;

  constructor(config: EarnSDKConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.network = config.network || 'devnet';
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options?: {
      body?: Record<string, unknown>;
      headers?: Record<string, string>;
      idempotencyKey?: string;
    }
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await response.json() as { error?: string } & T;

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data as T;
  }

  // ============================================
  // TOKEN MANAGEMENT
  // ============================================

  /**
   * Register a token with Earn Protocol
   */
  async register(options: RegisterOptions): Promise<OperationResult<TokenConfig>> {
    const walletAddress = getWalletAddress(options.creatorWallet);
    
    return this.request('POST', '/earn/register', {
      body: {
        tokenMint: options.tokenMint,
        template: options.template,
        config: options.config,
      },
      headers: {
        'x-creator-wallet': walletAddress,
      },
      idempotencyKey: generateIdempotencyKey('register'),
    });
  }

  /**
   * Get token configuration
   */
  async getToken(tokenMint: string): Promise<{ config: TokenConfig }> {
    return this.request('GET', `/earn/token/${tokenMint}`);
  }

  /**
   * Get detailed token stats
   */
  async getTokenStats(tokenMint: string): Promise<TokenStats> {
    return this.request('GET', `/earn/token/${tokenMint}/stats`);
  }

  /**
   * List all registered tokens
   */
  async listTokens(): Promise<{ tokens: TokenConfig[]; count: number }> {
    return this.request('GET', '/earn/tokens');
  }

  /**
   * Get token leaderboard
   */
  async getLeaderboard(options?: { sort?: 'fees' | 'staked' | 'stakers'; limit?: number }): Promise<{
    leaderboard: Array<{
      rank: number;
      tokenMint: string;
      creator: string;
      totalFees: string;
      totalStaked: string;
      stakerCount: number;
    }>;
    sortBy: string;
    total: number;
  }> {
    const params = new URLSearchParams();
    if (options?.sort) params.set('sort', options.sort);
    if (options?.limit) params.set('limit', options.limit.toString());
    const query = params.toString() ? `?${params}` : '';
    return this.request('GET', `/earn/leaderboard${query}`);
  }

  // ============================================
  // TRADING & FEES
  // ============================================

  /**
   * Execute a trade with fee collection
   */
  async trade(options: TradeOptions): Promise<OperationResult<{ feeDistribution: Record<string, string> }>> {
    const walletAddress = getWalletAddress(options.userWallet);
    
    return this.request('POST', '/earn/trade', {
      body: {
        tokenMint: options.tokenMint,
        inputToken: options.inputToken,
        outputToken: options.outputToken || options.tokenMint,
        amount: options.amount.toString(),
        slippageBps: options.slippageBps || 300,
        userWallet: walletAddress,
      },
      idempotencyKey: generateIdempotencyKey('trade'),
    });
  }

  /**
   * Get fee quote for a trade
   */
  async getQuote(tokenMint: string, amount: number | string): Promise<{
    tokenMint: string;
    tradeAmount: string;
    feeDistribution: {
      totalFee: string;
      earnAmount: string;
      creatorAmount: string;
      buybackAmount: string;
      stakingAmount: string;
    };
  }> {
    return this.request('GET', `/earn/quote?tokenMint=${tokenMint}&amount=${amount}`);
  }

  // ============================================
  // STAKING
  // ============================================

  /**
   * Stake tokens
   */
  async stake(options: StakeOptions): Promise<OperationResult<{
    stakedAmount: string;
    newTotal: string;
    pendingRewards: string;
  }>> {
    const walletAddress = getWalletAddress(options.userWallet);
    
    return this.request('POST', '/earn/stake', {
      body: {
        tokenMint: options.tokenMint,
        amount: options.amount.toString(),
      },
      headers: {
        'x-wallet': walletAddress,
      },
      idempotencyKey: generateIdempotencyKey('stake'),
    });
  }

  /**
   * Unstake tokens
   */
  async unstake(options: UnstakeOptions): Promise<OperationResult<{
    unstaked: string;
    rewardsClaimed: string;
  }>> {
    const walletAddress = getWalletAddress(options.userWallet);
    
    return this.request('POST', '/earn/unstake', {
      body: {
        tokenMint: options.tokenMint,
        amount: options.amount.toString(),
      },
      headers: {
        'x-wallet': walletAddress,
      },
      idempotencyKey: generateIdempotencyKey('unstake'),
    });
  }

  /**
   * Get stake position for a wallet
   */
  async getStakePosition(tokenMint: string, wallet: string | PublicKey | Keypair): Promise<StakePosition> {
    const walletAddress = getWalletAddress(wallet);
    return this.request('GET', `/earn/stake/${tokenMint}/${walletAddress}`);
  }

  /**
   * Get pending rewards for a wallet
   */
  async getRewards(tokenMint: string, wallet: string | PublicKey | Keypair): Promise<RewardsInfo> {
    const walletAddress = getWalletAddress(wallet);
    return this.request('GET', `/earn/rewards/${tokenMint}/${walletAddress}`);
  }

  /**
   * Claim staking rewards
   */
  async claim(options: ClaimOptions): Promise<OperationResult<{ claimed: string }>> {
    const walletAddress = getWalletAddress(options.userWallet);
    
    return this.request('POST', '/earn/claim', {
      body: {
        tokenMint: options.tokenMint,
      },
      headers: {
        'x-wallet': walletAddress,
      },
      idempotencyKey: generateIdempotencyKey('claim'),
    });
  }

  // ============================================
  // BUYBACKS
  // ============================================

  /**
   * Trigger a buyback (permissionless)
   */
  async triggerBuyback(tokenMint: string): Promise<OperationResult<{
    tokenMint: string;
    buybackAmount: string;
    message: string;
  }>> {
    return this.request('POST', `/earn/buyback/${tokenMint}`, {
      idempotencyKey: generateIdempotencyKey('buyback'),
    });
  }

  // ============================================
  // OPERATIONS
  // ============================================

  /**
   * Check operation status
   */
  async getOperation(operationId: string): Promise<{
    operationId: string;
    idempotencyKey: string;
    type: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    txSignature?: string;
    result?: unknown;
    error?: string;
    createdAt: number;
    updatedAt: number;
  }> {
    return this.request('GET', `/earn/operation/${operationId}`);
  }

  /**
   * Get protocol-wide stats
   */
  async getProtocolStats(): Promise<{
    protocol: string;
    version: string;
    stats: {
      totalTokensRegistered: number;
      totalFeesCollected: string;
      totalEarnRevenue: string;
      totalBuybacksExecuted: string;
      totalStakingRewards: string;
      earnTreasury: string;
    };
  }> {
    return this.request('GET', '/earn/stats');
  }

  /**
   * Get available templates
   */
  async getTemplates(): Promise<{
    templates: Array<{
      name: string;
      description: string;
      config: {
        feeBps: number;
        earnCutBps: number;
        creatorCutBps: number;
        buybackCutBps: number;
        stakingCutBps: number;
      };
      readable: {
        fee: string;
        earnCut: string;
        creatorCut: string;
        buybackCut: string;
        stakingCut: string;
      };
    }>;
  }> {
    return this.request('GET', '/earn/templates');
  }
}

export default EarnSDK;
