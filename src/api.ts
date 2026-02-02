import express, { Request, Response, NextFunction } from 'express';
import { PublicKey } from '@solana/web3.js';
import { EarnProtocol } from './protocol';
import { RegisterRequest, StakeRequest, UnstakeRequest } from './types';

const app = express();
app.use(express.json());

// Initialize protocol
const protocol = new EarnProtocol(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com');

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    return res.status(200).json({});
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', protocol: 'Earn Protocol v0.1.0' });
});

// ============================================
// TOKEN REGISTRATION
// ============================================

/**
 * POST /earn/register
 * Register a new token with Earn Protocol
 */
app.post('/earn/register', async (req: Request, res: Response) => {
  try {
    const body: RegisterRequest = req.body;
    
    if (!body.tokenMint || !body.config) {
      return res.status(400).json({ error: 'Missing tokenMint or config' });
    }

    // Get creator from auth header (simplified - would verify signature in production)
    const creatorAddress = req.headers['x-creator-wallet'] as string;
    if (!creatorAddress) {
      return res.status(401).json({ error: 'Missing x-creator-wallet header' });
    }

    const creator = new PublicKey(creatorAddress);
    const config = await protocol.registerToken(body, creator);

    res.json({
      success: true,
      message: 'Token registered with Earn Protocol',
      config: {
        tokenMint: config.tokenMint.toBase58(),
        creator: config.creator.toBase58(),
        feePercent: config.feePercent,
        earnCut: config.earnCut,
        creatorCut: config.creatorCut,
        buybackPercent: config.buybackPercent,
        stakingPercent: config.stakingPercent,
        registeredAt: config.registeredAt,
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /earn/token/:mint
 * Get token configuration and stats
 */
app.get('/earn/token/:mint', (req, res) => {
  try {
    const config = protocol.getTokenConfig(req.params.mint);
    const treasury = protocol.getTreasury(req.params.mint);
    const stakingPool = protocol.getStakingPool(req.params.mint);

    if (!config) {
      return res.status(404).json({ error: 'Token not registered' });
    }

    res.json({
      config: {
        tokenMint: config.tokenMint.toBase58(),
        creator: config.creator.toBase58(),
        feePercent: config.feePercent,
        earnCut: config.earnCut,
        creatorCut: config.creatorCut,
        buybackPercent: config.buybackPercent,
        stakingPercent: config.stakingPercent,
        registeredAt: config.registeredAt,
        active: config.active,
      },
      treasury: treasury ? {
        treasuryPDA: treasury.treasuryPDA.toBase58(),
        totalFeesCollected: treasury.totalFeesCollected.toString(),
        totalBuybacks: treasury.totalBuybacks.toString(),
        totalStakingRewards: treasury.totalStakingRewards.toString(),
        totalCreatorEarnings: treasury.totalCreatorEarnings.toString(),
        totalEarnEarnings: treasury.totalEarnEarnings.toString(),
        treasuryBalance: treasury.treasuryBalance.toString(),
      } : null,
      stakingPool: stakingPool ? {
        totalStaked: stakingPool.totalStaked.toString(),
        totalRewardsDistributed: stakingPool.totalRewardsDistributed.toString(),
        stakerCount: stakingPool.stakerCount,
      } : null,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /earn/tokens
 * List all registered tokens
 */
app.get('/earn/tokens', (req, res) => {
  const tokens = protocol.getAllTokens().map(t => ({
    tokenMint: t.tokenMint.toBase58(),
    creator: t.creator.toBase58(),
    feePercent: t.feePercent,
    registeredAt: t.registeredAt,
    active: t.active,
  }));

  res.json({ tokens, count: tokens.length });
});

// ============================================
// FEE COLLECTION (called by DEX or transfer hook)
// ============================================

/**
 * POST /earn/trade
 * Process a trade and collect fees
 * In production this would be called via webhook from DEX
 */
app.post('/earn/trade', async (req: Request, res: Response) => {
  try {
    const { tokenMint, amount, isBuy } = req.body;

    if (!tokenMint || !amount) {
      return res.status(400).json({ error: 'Missing tokenMint or amount' });
    }

    const distribution = await protocol.processTradeAndCollectFees(
      tokenMint,
      BigInt(amount),
      isBuy ?? true
    );

    res.json({
      success: true,
      feeDistribution: {
        totalFee: distribution.totalFee.toString(),
        earnAmount: distribution.earnAmount.toString(),
        creatorAmount: distribution.creatorAmount.toString(),
        buybackAmount: distribution.buybackAmount.toString(),
        stakingAmount: distribution.stakingAmount.toString(),
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /earn/quote
 * Get fee quote for a trade amount
 */
app.get('/earn/quote', (req, res) => {
  try {
    const { tokenMint, amount } = req.query;

    if (!tokenMint || !amount) {
      return res.status(400).json({ error: 'Missing tokenMint or amount' });
    }

    const distribution = protocol.calculateFeeDistribution(
      tokenMint as string,
      BigInt(amount as string)
    );

    res.json({
      tokenMint,
      tradeAmount: amount,
      feeDistribution: {
        totalFee: distribution.totalFee.toString(),
        earnAmount: distribution.earnAmount.toString(),
        creatorAmount: distribution.creatorAmount.toString(),
        buybackAmount: distribution.buybackAmount.toString(),
        stakingAmount: distribution.stakingAmount.toString(),
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// STAKING
// ============================================

/**
 * POST /earn/stake
 * Stake tokens
 */
app.post('/earn/stake', async (req: Request, res: Response) => {
  try {
    const { tokenMint, amount } = req.body as StakeRequest;
    const walletAddress = req.headers['x-wallet'] as string;

    if (!tokenMint || !amount || !walletAddress) {
      return res.status(400).json({ error: 'Missing tokenMint, amount, or x-wallet header' });
    }

    const wallet = new PublicKey(walletAddress);
    const position = await protocol.stake(tokenMint, wallet, BigInt(amount));

    res.json({
      success: true,
      position: {
        wallet: position.wallet.toBase58(),
        tokenMint: position.tokenMint.toBase58(),
        stakedAmount: position.stakedAmount.toString(),
        stakedAt: position.stakedAt,
        pendingRewards: position.pendingRewards.toString(),
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /earn/unstake
 * Unstake tokens
 */
app.post('/earn/unstake', async (req: Request, res: Response) => {
  try {
    const { tokenMint, amount } = req.body as UnstakeRequest;
    const walletAddress = req.headers['x-wallet'] as string;

    if (!tokenMint || !amount || !walletAddress) {
      return res.status(400).json({ error: 'Missing tokenMint, amount, or x-wallet header' });
    }

    const wallet = new PublicKey(walletAddress);
    const result = await protocol.unstake(tokenMint, wallet, BigInt(amount));

    res.json({
      success: true,
      unstaked: result.unstaked.toString(),
      rewardsClaimed: result.rewards.toString(),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /earn/rewards/:wallet
 * Get pending rewards for a wallet across all tokens
 */
app.get('/earn/rewards/:wallet', (req, res) => {
  try {
    const wallet = new PublicKey(req.params.wallet);
    const tokens = protocol.getAllTokens();
    
    const rewards = tokens.map(t => {
      const pending = protocol.calculatePendingRewards(t.tokenMint.toBase58(), wallet);
      const position = protocol.getStakingPosition(t.tokenMint.toBase58(), wallet);
      return {
        tokenMint: t.tokenMint.toBase58(),
        stakedAmount: position?.stakedAmount.toString() || '0',
        pendingRewards: pending.toString(),
      };
    }).filter(r => r.stakedAmount !== '0' || r.pendingRewards !== '0');

    res.json({ wallet: req.params.wallet, rewards });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /earn/claim
 * Claim staking rewards
 */
app.post('/earn/claim', async (req: Request, res: Response) => {
  try {
    const { tokenMint } = req.body;
    const walletAddress = req.headers['x-wallet'] as string;

    if (!tokenMint || !walletAddress) {
      return res.status(400).json({ error: 'Missing tokenMint or x-wallet header' });
    }

    const wallet = new PublicKey(walletAddress);
    const rewards = await protocol.claimRewards(tokenMint, wallet);

    res.json({
      success: true,
      claimed: rewards.toString(),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /earn/staking-stats/:mint
 * Get staking pool stats for a token
 */
app.get('/earn/staking-stats/:mint', (req, res) => {
  try {
    const stakingPool = protocol.getStakingPool(req.params.mint);

    if (!stakingPool) {
      return res.status(404).json({ error: 'Token not registered' });
    }

    res.json({
      tokenMint: req.params.mint,
      totalStaked: stakingPool.totalStaked.toString(),
      totalRewardsDistributed: stakingPool.totalRewardsDistributed.toString(),
      stakerCount: stakingPool.stakerCount,
      lastUpdateTime: stakingPool.lastUpdateTime,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// CREATOR DASHBOARD
// ============================================

/**
 * GET /earn/creator/:mint
 * Creator dashboard for a token
 */
app.get('/earn/creator/:mint', (req, res) => {
  try {
    const config = protocol.getTokenConfig(req.params.mint);
    const treasury = protocol.getTreasury(req.params.mint);
    const stakingPool = protocol.getStakingPool(req.params.mint);

    if (!config || !treasury || !stakingPool) {
      return res.status(404).json({ error: 'Token not registered' });
    }

    res.json({
      tokenMint: req.params.mint,
      creator: config.creator.toBase58(),
      config: {
        feePercent: config.feePercent,
        earnCut: config.earnCut,
        creatorCut: config.creatorCut,
        buybackPercent: config.buybackPercent,
        stakingPercent: config.stakingPercent,
      },
      earnings: {
        totalCreatorEarnings: treasury.totalCreatorEarnings.toString(),
        totalFeesCollected: treasury.totalFeesCollected.toString(),
      },
      treasury: {
        balance: treasury.treasuryBalance.toString(),
        totalBuybacks: treasury.totalBuybacks.toString(),
      },
      staking: {
        totalStaked: stakingPool.totalStaked.toString(),
        totalRewardsDistributed: stakingPool.totalRewardsDistributed.toString(),
        stakerCount: stakingPool.stakerCount,
      },
      registeredAt: config.registeredAt,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// PROTOCOL STATS
// ============================================

/**
 * GET /earn/stats
 * Earn Protocol global stats
 */
app.get('/earn/stats', (req, res) => {
  const stats = protocol.getProtocolStats();

  res.json({
    protocol: 'Earn Protocol',
    version: '0.1.0',
    stats: {
      totalTokensRegistered: stats.totalTokensRegistered,
      totalFeesCollected: stats.totalFeesCollected.toString(),
      totalEarnRevenue: stats.totalEarnRevenue.toString(),
      totalBuybacksExecuted: stats.totalBuybacksExecuted.toString(),
      totalStakingRewards: stats.totalStakingRewards.toString(),
      earnTreasury: stats.earnTreasury.toString(),
    },
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export { app, protocol };
