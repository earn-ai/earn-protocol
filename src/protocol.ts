import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TokenConfig,
  TokenTreasury,
  StakingPosition,
  StakingPool,
  FeeDistribution,
  RegisterRequest,
  EarnProtocolStats,
} from './types';

// Earn Protocol wallet (receives protocol fees)
const EARN_PROTOCOL_WALLET = new PublicKey('EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ');

// PDA seeds
const TREASURY_SEED = 'earn_treasury';
const STAKING_SEED = 'earn_staking';

/**
 * Earn Protocol - Tokenomics-as-a-Service
 */
export class EarnProtocol {
  private connection: Connection;
  private registeredTokens: Map<string, TokenConfig> = new Map();
  private treasuries: Map<string, TokenTreasury> = new Map();
  private stakingPools: Map<string, StakingPool> = new Map();
  private stakingPositions: Map<string, StakingPosition[]> = new Map();
  private protocolStats: EarnProtocolStats;

  constructor(rpcUrl: string = 'https://api.devnet.solana.com') {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.protocolStats = {
      totalTokensRegistered: 0,
      totalFeesCollected: BigInt(0),
      totalEarnRevenue: BigInt(0),
      totalBuybacksExecuted: BigInt(0),
      totalStakingRewards: BigInt(0),
      earnTreasury: BigInt(0),
    };
  }

  /**
   * Derive treasury PDA for a token
   */
  async deriveTreasuryPDA(tokenMint: PublicKey): Promise<[PublicKey, number]> {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(TREASURY_SEED), tokenMint.toBuffer()],
      SystemProgram.programId // Would be our program ID in production
    );
  }

  /**
   * Derive staking pool PDA for a token
   */
  async deriveStakingPDA(tokenMint: PublicKey): Promise<[PublicKey, number]> {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(STAKING_SEED), tokenMint.toBuffer()],
      SystemProgram.programId // Would be our program ID in production
    );
  }

  /**
   * Register a new token with Earn Protocol
   */
  async registerToken(request: RegisterRequest, creator: PublicKey): Promise<TokenConfig> {
    const tokenMint = new PublicKey(request.tokenMint);
    
    // Check if already registered
    if (this.registeredTokens.has(request.tokenMint)) {
      throw new Error('Token already registered');
    }

    // Validate config
    const config = request.config;
    if (config.feePercent < 0.1 || config.feePercent > 10) {
      throw new Error('Fee percent must be between 0.1% and 10%');
    }

    // Default values
    const earnCut = config.earnCut ?? 10;       // 10% to Earn
    const creatorCut = config.creatorCut ?? 20; // 20% to Creator
    const remaining = 100 - earnCut - creatorCut;
    const buybackPercent = config.buybackPercent ?? 50; // 50% of remaining
    const stakingPercent = config.stakingPercent ?? 50; // 50% of remaining

    if (buybackPercent + stakingPercent !== 100) {
      throw new Error('Buyback + staking must equal 100%');
    }

    // Create token config
    const tokenConfig: TokenConfig = {
      tokenMint,
      creator,
      feePercent: config.feePercent,
      earnCut,
      creatorCut,
      buybackPercent,
      stakingPercent,
      registeredAt: Date.now(),
      active: true,
    };

    // Derive PDAs
    const [treasuryPDA] = await this.deriveTreasuryPDA(tokenMint);

    // Initialize treasury
    const treasury: TokenTreasury = {
      tokenMint,
      treasuryPDA,
      totalFeesCollected: BigInt(0),
      totalBuybacks: BigInt(0),
      totalStakingRewards: BigInt(0),
      totalCreatorEarnings: BigInt(0),
      totalEarnEarnings: BigInt(0),
      treasuryBalance: BigInt(0),
    };

    // Initialize staking pool
    const stakingPool: StakingPool = {
      tokenMint,
      totalStaked: BigInt(0),
      rewardsPerTokenStored: BigInt(0),
      lastUpdateTime: Date.now(),
      totalRewardsDistributed: BigInt(0),
      stakerCount: 0,
    };

    // Store
    this.registeredTokens.set(request.tokenMint, tokenConfig);
    this.treasuries.set(request.tokenMint, treasury);
    this.stakingPools.set(request.tokenMint, stakingPool);
    this.stakingPositions.set(request.tokenMint, []);

    // Update protocol stats
    this.protocolStats.totalTokensRegistered++;

    console.log(`✅ Registered token: ${request.tokenMint}`);
    console.log(`   Treasury PDA: ${treasuryPDA.toBase58()}`);
    console.log(`   Fee: ${config.feePercent}%`);
    console.log(`   Distribution: Earn ${earnCut}% | Creator ${creatorCut}% | Buyback ${buybackPercent * remaining / 100}% | Staking ${stakingPercent * remaining / 100}%`);

    return tokenConfig;
  }

  /**
   * Calculate fee distribution for a trade
   */
  calculateFeeDistribution(tokenMint: string, tradeAmount: bigint): FeeDistribution {
    const config = this.registeredTokens.get(tokenMint);
    if (!config) {
      throw new Error('Token not registered');
    }

    const totalFee = (tradeAmount * BigInt(Math.floor(config.feePercent * 100))) / BigInt(10000);
    
    const earnAmount = (totalFee * BigInt(config.earnCut)) / BigInt(100);
    const creatorAmount = (totalFee * BigInt(config.creatorCut)) / BigInt(100);
    const remaining = totalFee - earnAmount - creatorAmount;
    const buybackAmount = (remaining * BigInt(config.buybackPercent)) / BigInt(100);
    const stakingAmount = remaining - buybackAmount;

    return {
      totalFee,
      earnAmount,
      creatorAmount,
      buybackAmount,
      stakingAmount,
    };
  }

  /**
   * Process a trade and collect fees
   * In production this would be called via transfer hook or DEX integration
   */
  async processTradeAndCollectFees(
    tokenMint: string,
    tradeAmount: bigint,
    isBuy: boolean
  ): Promise<FeeDistribution> {
    const config = this.registeredTokens.get(tokenMint);
    if (!config || !config.active) {
      throw new Error('Token not registered or inactive');
    }

    const distribution = this.calculateFeeDistribution(tokenMint, tradeAmount);
    const treasury = this.treasuries.get(tokenMint)!;
    const stakingPool = this.stakingPools.get(tokenMint)!;

    // Update treasury
    treasury.totalFeesCollected += distribution.totalFee;
    treasury.totalEarnEarnings += distribution.earnAmount;
    treasury.totalCreatorEarnings += distribution.creatorAmount;
    treasury.treasuryBalance += distribution.buybackAmount;

    // Update staking rewards
    if (stakingPool.totalStaked > BigInt(0)) {
      const rewardPerToken = (distribution.stakingAmount * BigInt(1e18)) / stakingPool.totalStaked;
      stakingPool.rewardsPerTokenStored += rewardPerToken;
      stakingPool.totalRewardsDistributed += distribution.stakingAmount;
      treasury.totalStakingRewards += distribution.stakingAmount;
    } else {
      // No stakers - add to treasury for later
      treasury.treasuryBalance += distribution.stakingAmount;
    }

    // Update protocol stats
    this.protocolStats.totalFeesCollected += distribution.totalFee;
    this.protocolStats.totalEarnRevenue += distribution.earnAmount;
    this.protocolStats.earnTreasury += distribution.earnAmount;
    this.protocolStats.totalStakingRewards += distribution.stakingAmount;

    console.log(`💰 Fee collected: ${distribution.totalFee} (${isBuy ? 'BUY' : 'SELL'})`);
    console.log(`   Earn: ${distribution.earnAmount} | Creator: ${distribution.creatorAmount}`);
    console.log(`   Buyback: ${distribution.buybackAmount} | Staking: ${distribution.stakingAmount}`);

    return distribution;
  }

  /**
   * Stake tokens
   */
  async stake(
    tokenMint: string,
    wallet: PublicKey,
    amount: bigint
  ): Promise<StakingPosition> {
    const stakingPool = this.stakingPools.get(tokenMint);
    if (!stakingPool) {
      throw new Error('Token not registered');
    }

    const positions = this.stakingPositions.get(tokenMint)!;
    let position = positions.find(p => p.wallet.equals(wallet));

    if (position) {
      // Update existing position
      position.pendingRewards = this.calculatePendingRewards(tokenMint, wallet);
      position.stakedAmount += amount;
      position.lastClaimAt = Date.now();
    } else {
      // Create new position
      position = {
        wallet,
        tokenMint: new PublicKey(tokenMint),
        stakedAmount: amount,
        stakedAt: Date.now(),
        lastClaimAt: Date.now(),
        pendingRewards: BigInt(0),
      };
      positions.push(position);
      stakingPool.stakerCount++;
    }

    stakingPool.totalStaked += amount;
    stakingPool.lastUpdateTime = Date.now();

    console.log(`📥 Staked ${amount} tokens for ${wallet.toBase58().slice(0, 8)}...`);

    return position;
  }

  /**
   * Unstake tokens
   */
  async unstake(
    tokenMint: string,
    wallet: PublicKey,
    amount: bigint
  ): Promise<{ unstaked: bigint; rewards: bigint }> {
    const stakingPool = this.stakingPools.get(tokenMint);
    if (!stakingPool) {
      throw new Error('Token not registered');
    }

    const positions = this.stakingPositions.get(tokenMint)!;
    const position = positions.find(p => p.wallet.equals(wallet));

    if (!position || position.stakedAmount < amount) {
      throw new Error('Insufficient staked balance');
    }

    // Calculate rewards before unstaking
    const rewards = this.calculatePendingRewards(tokenMint, wallet);

    position.stakedAmount -= amount;
    position.pendingRewards = BigInt(0);
    position.lastClaimAt = Date.now();

    stakingPool.totalStaked -= amount;
    stakingPool.lastUpdateTime = Date.now();

    if (position.stakedAmount === BigInt(0)) {
      // Remove position
      const idx = positions.indexOf(position);
      positions.splice(idx, 1);
      stakingPool.stakerCount--;
    }

    console.log(`📤 Unstaked ${amount} tokens + ${rewards} rewards for ${wallet.toBase58().slice(0, 8)}...`);

    return { unstaked: amount, rewards };
  }

  /**
   * Calculate pending rewards for a staker
   */
  calculatePendingRewards(tokenMint: string, wallet: PublicKey): bigint {
    const stakingPool = this.stakingPools.get(tokenMint);
    const positions = this.stakingPositions.get(tokenMint);
    
    if (!stakingPool || !positions) return BigInt(0);

    const position = positions.find(p => p.wallet.equals(wallet));
    if (!position) return BigInt(0);

    // Simple rewards calculation based on stake proportion and time
    // In production this would use the actual rewardsPerTokenStored delta
    const rewards = position.pendingRewards + 
      (position.stakedAmount * stakingPool.rewardsPerTokenStored) / BigInt(1e18);

    return rewards;
  }

  /**
   * Claim staking rewards
   */
  async claimRewards(tokenMint: string, wallet: PublicKey): Promise<bigint> {
    const rewards = this.calculatePendingRewards(tokenMint, wallet);
    
    const positions = this.stakingPositions.get(tokenMint)!;
    const position = positions.find(p => p.wallet.equals(wallet));
    
    if (position) {
      position.pendingRewards = BigInt(0);
      position.lastClaimAt = Date.now();
    }

    console.log(`💎 Claimed ${rewards} rewards for ${wallet.toBase58().slice(0, 8)}...`);

    return rewards;
  }

  /**
   * Execute buyback (convert treasury to token purchases)
   */
  async executeBuyback(tokenMint: string, amount: bigint): Promise<void> {
    const treasury = this.treasuries.get(tokenMint);
    if (!treasury) {
      throw new Error('Token not registered');
    }

    if (treasury.treasuryBalance < amount) {
      throw new Error('Insufficient treasury balance');
    }

    treasury.treasuryBalance -= amount;
    treasury.totalBuybacks += amount;
    this.protocolStats.totalBuybacksExecuted += amount;

    console.log(`🔄 Executed buyback: ${amount} for ${tokenMint.slice(0, 8)}...`);
    // In production: Execute Jupiter swap here
  }

  /**
   * Get token config
   */
  getTokenConfig(tokenMint: string): TokenConfig | undefined {
    return this.registeredTokens.get(tokenMint);
  }

  /**
   * Get treasury state
   */
  getTreasury(tokenMint: string): TokenTreasury | undefined {
    return this.treasuries.get(tokenMint);
  }

  /**
   * Get staking pool stats
   */
  getStakingPool(tokenMint: string): StakingPool | undefined {
    return this.stakingPools.get(tokenMint);
  }

  /**
   * Get staking position for a wallet
   */
  getStakingPosition(tokenMint: string, wallet: PublicKey): StakingPosition | undefined {
    const positions = this.stakingPositions.get(tokenMint);
    return positions?.find(p => p.wallet.equals(wallet));
  }

  /**
   * Get all registered tokens
   */
  getAllTokens(): TokenConfig[] {
    return Array.from(this.registeredTokens.values());
  }

  /**
   * Get protocol stats
   */
  getProtocolStats(): EarnProtocolStats {
    return { ...this.protocolStats };
  }
}
