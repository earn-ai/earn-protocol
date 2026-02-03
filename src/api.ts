import express, { Request, Response, NextFunction } from 'express';
import { PublicKey } from '@solana/web3.js';
import crypto from 'crypto';
import { EarnProtocol } from './protocol';
import { 
  RegisterRequest, 
  StakeRequest, 
  UnstakeRequest,
  OperationRecord,
  OperationStatus,
  TOKEN_TEMPLATES,
  TemplateName,
  RegisterWithTemplateRequest,
  StakeRequestV2,
  UnstakeRequestV2,
  TradeRequest,
  ApiResponse,
} from './types';

const app = express();
app.use(express.json());

// CORS middleware - allow earn.supply frontend
app.use((req: Request, res: Response, next: NextFunction) => {
  const allowedOrigins = [
    'https://earn.supply',
    'https://www.earn.supply',
    'http://localhost:3000',
    'http://localhost:3001'
  ];
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-wallet, x-idempotency-key');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Initialize protocol
const protocol = new EarnProtocol(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com');

// ============================================
// IDEMPOTENCY STORE
// ============================================

// In-memory store (would be Redis/DB in production)
const operationStore = new Map<string, OperationRecord>();
const idempotencyIndex = new Map<string, string>(); // idempotencyKey -> operationId

function generateOperationId(): string {
  return `op_${crypto.randomBytes(12).toString('base64url')}`;
}

function getOrCreateOperation(
  idempotencyKey: string | undefined,
  type: OperationRecord['type'],
  request: Record<string, unknown>
): { operation: OperationRecord; isNew: boolean } {
  // If idempotencyKey provided, check for existing operation
  if (idempotencyKey) {
    const existingOpId = idempotencyIndex.get(idempotencyKey);
    if (existingOpId) {
      const existing = operationStore.get(existingOpId);
      if (existing) {
        return { operation: existing, isNew: false };
      }
    }
  }

  // Create new operation
  const operationId = generateOperationId();
  const now = Date.now();
  const operation: OperationRecord = {
    operationId,
    idempotencyKey: idempotencyKey || operationId,
    status: 'pending',
    type,
    request,
    createdAt: now,
    updatedAt: now,
  };

  operationStore.set(operationId, operation);
  if (idempotencyKey) {
    idempotencyIndex.set(idempotencyKey, operationId);
  }

  return { operation, isNew: true };
}

function updateOperation(
  operationId: string,
  updates: Partial<Pick<OperationRecord, 'status' | 'result' | 'error' | 'txSignature'>>
): OperationRecord | null {
  const operation = operationStore.get(operationId);
  if (!operation) return null;

  Object.assign(operation, updates, { updatedAt: Date.now() });
  return operation;
}

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

// Root - API info
app.get('/', (req, res) => {
  res.json({
    name: 'Earn Protocol',
    description: 'Tokenomics-as-a-service for memecoins',
    docs: 'https://github.com/earn-ai/earn-protocol',
    endpoints: {
      health: '/health',
      stats: '/earn/stats',
      tokens: '/earn/tokens',
      register: 'POST /earn/register',
      trade: 'POST /earn/trade',
      stake: 'POST /earn/stake'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', protocol: 'Earn Protocol v0.1.0' });
});

// ============================================
// OPERATION TRACKING (Agent-Proof)
// ============================================

/**
 * GET /earn/operation/:operationId
 * Check status of any operation by ID
 */
app.get('/earn/operation/:operationId', (req, res) => {
  const operation = operationStore.get(req.params.operationId);
  
  if (!operation) {
    return res.status(404).json({ error: 'Operation not found' });
  }

  res.json({
    operationId: operation.operationId,
    idempotencyKey: operation.idempotencyKey,
    type: operation.type,
    status: operation.status,
    txSignature: operation.txSignature,
    result: operation.result,
    error: operation.error,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  });
});

/**
 * GET /earn/templates
 * List available token launch templates
 */
app.get('/earn/templates', (req, res) => {
  const templates = Object.entries(TOKEN_TEMPLATES).map(([name, config]) => ({
    name,
    description: getTemplateDescription(name),
    config: {
      feeBps: config.feeBps,
      earnCutBps: config.earnCutBps,
      creatorCutBps: config.creatorCutBps,
      buybackCutBps: config.buybackCutBps,
      stakingCutBps: config.stakingCutBps,
    },
    // Convert to percentages for readability
    readable: {
      fee: `${config.feeBps / 100}%`,
      earnCut: `${config.earnCutBps / 100}%`,
      creatorCut: `${config.creatorCutBps / 100}%`,
      buybackCut: `${config.buybackCutBps / 100}%`,
      stakingCut: `${config.stakingCutBps / 100}%`,
    },
  }));

  res.json({ templates });
});

function getTemplateDescription(name: string): string {
  const descriptions: Record<string, string> = {
    degen: 'High buyback (50%) for aggressive price support. Good for meme coins.',
    creator: 'High creator cut (30%) for sustainable development income.',
    community: 'High staking rewards (50%) for community-driven governance.',
    lowfee: 'Minimal 1% fee for high-volume tokens.',
  };
  return descriptions[name] || 'Custom template';
}

// Helper to get idempotency key from header or body
function getIdempotencyKey(req: Request): string | undefined {
  return (req.headers['idempotency-key'] as string) || req.body?.idempotencyKey;
}

// ============================================
// ADDITIONAL PUBLIC ENDPOINTS
// ============================================

/**
 * GET /earn/token/:mint/stats
 * Detailed stats for a token (fees, staking, buybacks)
 */
app.get('/earn/token/:mint/stats', (req, res) => {
  try {
    const config = protocol.getTokenConfig(req.params.mint);
    const treasury = protocol.getTreasury(req.params.mint);
    const stakingPool = protocol.getStakingPool(req.params.mint);

    if (!config || !treasury || !stakingPool) {
      return res.status(404).json({ error: 'Token not registered' });
    }

    res.json({
      tokenMint: req.params.mint,
      fees: {
        totalCollected: treasury.totalFeesCollected.toString(),
        earnEarnings: treasury.totalEarnEarnings.toString(),
        creatorEarnings: treasury.totalCreatorEarnings.toString(),
      },
      buybacks: {
        totalExecuted: treasury.totalBuybacks.toString(),
        treasuryBalance: treasury.treasuryBalance.toString(),
      },
      staking: {
        totalStaked: stakingPool.totalStaked.toString(),
        totalRewardsDistributed: stakingPool.totalRewardsDistributed.toString(),
        stakerCount: stakingPool.stakerCount,
        rewardRate: stakingPool.rewardsPerTokenStored.toString(),
      },
      config: {
        feePercent: config.feePercent,
        earnCut: config.earnCut,
        creatorCut: config.creatorCut,
        buybackPercent: config.buybackPercent,
        stakingPercent: config.stakingPercent,
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /earn/stake/:mint/:wallet
 * Check stake position for a wallet
 */
app.get('/earn/stake/:mint/:wallet', (req, res) => {
  try {
    const wallet = new PublicKey(req.params.wallet);
    const position = protocol.getStakingPosition(req.params.mint, wallet);
    const pendingRewards = protocol.calculatePendingRewards(req.params.mint, wallet);

    if (!position) {
      return res.json({
        tokenMint: req.params.mint,
        wallet: req.params.wallet,
        stakedAmount: '0',
        stakedAt: null,
        pendingRewards: '0',
      });
    }

    res.json({
      tokenMint: req.params.mint,
      wallet: req.params.wallet,
      stakedAmount: position.stakedAmount.toString(),
      stakedAt: position.stakedAt,
      lastClaimAt: position.lastClaimAt,
      pendingRewards: pendingRewards.toString(),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /earn/rewards/:mint/:wallet
 * Check pending rewards for a specific token
 */
app.get('/earn/rewards/:mint/:wallet', (req, res) => {
  try {
    const wallet = new PublicKey(req.params.wallet);
    const pending = protocol.calculatePendingRewards(req.params.mint, wallet);
    const position = protocol.getStakingPosition(req.params.mint, wallet);

    res.json({
      tokenMint: req.params.mint,
      wallet: req.params.wallet,
      stakedAmount: position?.stakedAmount.toString() || '0',
      pendingRewards: pending.toString(),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /earn/leaderboard
 * Top tokens by volume, staking, or fees
 */
app.get('/earn/leaderboard', (req, res) => {
  try {
    const sortBy = (req.query.sort as string) || 'fees';
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const tokens = protocol.getAllTokens();
    const tokenStats = tokens.map(t => {
      const treasury = protocol.getTreasury(t.tokenMint.toBase58());
      const stakingPool = protocol.getStakingPool(t.tokenMint.toBase58());
      return {
        tokenMint: t.tokenMint.toBase58(),
        creator: t.creator.toBase58(),
        totalFees: treasury?.totalFeesCollected || BigInt(0),
        totalStaked: stakingPool?.totalStaked || BigInt(0),
        stakerCount: stakingPool?.stakerCount || 0,
        registeredAt: t.registeredAt,
      };
    });

    // Sort by selected metric
    tokenStats.sort((a, b) => {
      if (sortBy === 'staked') {
        return Number(b.totalStaked - a.totalStaked);
      } else if (sortBy === 'stakers') {
        return b.stakerCount - a.stakerCount;
      } else {
        return Number(b.totalFees - a.totalFees);
      }
    });

    res.json({
      leaderboard: tokenStats.slice(0, limit).map((t, i) => ({
        rank: i + 1,
        tokenMint: t.tokenMint,
        creator: t.creator,
        totalFees: t.totalFees.toString(),
        totalStaked: t.totalStaked.toString(),
        stakerCount: t.stakerCount,
      })),
      sortBy,
      total: tokens.length,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /earn/buyback/:mint
 * Trigger a buyback (permissionless - anyone can call)
 */
app.post('/earn/buyback/:mint', async (req: Request, res: Response) => {
  try {
    const idempotencyKey = getIdempotencyKey(req);
    const { operation, isNew } = getOrCreateOperation(
      idempotencyKey,
      'buyback',
      { tokenMint: req.params.mint }
    );

    if (!isNew && operation.status === 'completed') {
      return res.json({
        success: true,
        operationId: operation.operationId,
        status: operation.status,
        txSignature: operation.txSignature,
        result: operation.result,
      });
    }

    const treasury = protocol.getTreasury(req.params.mint);
    if (!treasury) {
      return res.status(404).json({ error: 'Token not registered' });
    }

    updateOperation(operation.operationId, { status: 'processing' });

    // In production, this would execute via Jupiter CPI
    // For now, simulate buyback
    const buybackAmount = treasury.treasuryBalance / BigInt(10); // 10% of treasury
    
    const result = {
      tokenMint: req.params.mint,
      buybackAmount: buybackAmount.toString(),
      message: 'Buyback queued (simulation)',
    };

    updateOperation(operation.operationId, {
      status: 'completed',
      result,
    });

    res.json({
      success: true,
      operationId: operation.operationId,
      status: 'completed',
      result,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// TOKEN REGISTRATION
// ============================================

/**
 * POST /earn/register
 * Register a new token with Earn Protocol
 * Supports templates for quick setup
 */
app.post('/earn/register', async (req: Request, res: Response) => {
  try {
    const body: RegisterWithTemplateRequest = req.body;
    
    if (!body.tokenMint) {
      return res.status(400).json({ error: 'Missing tokenMint' });
    }

    // Get creator from auth header (simplified - would verify signature in production)
    const creatorAddress = req.headers['x-creator-wallet'] as string;
    if (!creatorAddress) {
      return res.status(401).json({ error: 'Missing x-creator-wallet header' });
    }

    // Check idempotency (header or body)
    const { operation, isNew } = getOrCreateOperation(
      getIdempotencyKey(req),
      'register',
      body as unknown as Record<string, unknown>
    );

    // If operation already exists and completed, return cached result
    if (!isNew && operation.status === 'completed') {
      return res.json({
        success: true,
        operationId: operation.operationId,
        status: operation.status,
        txSignature: operation.txSignature,
        result: operation.result,
        message: 'Token already registered (idempotent)',
      });
    }

    // Build config from template or custom settings
    let configToUse: RegisterRequest['config'];
    
    if (body.template && TOKEN_TEMPLATES[body.template]) {
      const template = TOKEN_TEMPLATES[body.template];
      configToUse = {
        feePercent: template.feeBps / 100,
        earnCut: template.earnCutBps / 100,
        creatorCut: template.creatorCutBps / 100,
        buybackPercent: template.buybackCutBps / 100,
        stakingPercent: template.stakingCutBps / 100,
      };
    } else if (body.config) {
      configToUse = {
        feePercent: body.config.feePercent ?? 2,
        earnCut: body.config.earnCut,
        creatorCut: body.config.creatorCut,
        buybackPercent: body.config.buybackPercent,
        stakingPercent: body.config.stakingPercent,
      };
    } else {
      // Default to community template
      const template = TOKEN_TEMPLATES.community;
      configToUse = {
        feePercent: template.feeBps / 100,
        earnCut: template.earnCutBps / 100,
        creatorCut: template.creatorCutBps / 100,
        buybackPercent: template.buybackCutBps / 100,
        stakingPercent: template.stakingCutBps / 100,
      };
    }

    updateOperation(operation.operationId, { status: 'processing' });

    const creator = new PublicKey(creatorAddress);
    const registerReq: RegisterRequest = {
      tokenMint: body.tokenMint,
      config: configToUse,
    };
    const config = await protocol.registerToken(registerReq, creator);

    const result = {
      tokenMint: config.tokenMint.toBase58(),
      creator: config.creator.toBase58(),
      feePercent: config.feePercent,
      earnCut: config.earnCut,
      creatorCut: config.creatorCut,
      buybackPercent: config.buybackPercent,
      stakingPercent: config.stakingPercent,
      registeredAt: config.registeredAt,
      template: body.template || 'custom',
    };

    updateOperation(operation.operationId, {
      status: 'completed',
      result,
      // txSignature would come from actual on-chain transaction
    });

    res.json({
      success: true,
      operationId: operation.operationId,
      status: 'completed',
      message: 'Token registered with Earn Protocol',
      result,
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
 * Process a trade and collect fees (with idempotency support)
 * In production this would be called via webhook from DEX
 */
app.post('/earn/trade', async (req: Request, res: Response) => {
  try {
    const { tokenMint, amount, isBuy, idempotencyKey, inputToken, outputToken, slippageBps, userWallet } = req.body as TradeRequest & { isBuy?: boolean };

    if (!tokenMint || !amount) {
      return res.status(400).json({ error: 'Missing tokenMint or amount' });
    }

    // Check idempotency (header or body)
    const { operation, isNew } = getOrCreateOperation(
      getIdempotencyKey(req),
      'trade',
      { tokenMint, amount, isBuy, inputToken, outputToken, slippageBps, userWallet }
    );

    if (!isNew && operation.status === 'completed') {
      return res.json({
        success: true,
        operationId: operation.operationId,
        status: operation.status,
        txSignature: operation.txSignature,
        result: operation.result,
      });
    }

    updateOperation(operation.operationId, { status: 'processing' });

    const distribution = await protocol.processTradeAndCollectFees(
      tokenMint,
      BigInt(amount),
      isBuy ?? true
    );

    const result = {
      feeDistribution: {
        totalFee: distribution.totalFee.toString(),
        earnAmount: distribution.earnAmount.toString(),
        creatorAmount: distribution.creatorAmount.toString(),
        buybackAmount: distribution.buybackAmount.toString(),
        stakingAmount: distribution.stakingAmount.toString(),
      },
    };

    updateOperation(operation.operationId, {
      status: 'completed',
      result,
    });

    res.json({
      success: true,
      operationId: operation.operationId,
      status: 'completed',
      result,
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
 * Stake tokens (with idempotency support)
 */
app.post('/earn/stake', async (req: Request, res: Response) => {
  try {
    const { tokenMint, amount, idempotencyKey } = req.body as StakeRequestV2;
    const walletAddress = req.headers['x-wallet'] as string;

    if (!tokenMint || !amount || !walletAddress) {
      return res.status(400).json({ error: 'Missing tokenMint, amount, or x-wallet header' });
    }

    // Check idempotency (header or body)
    const { operation, isNew } = getOrCreateOperation(
      getIdempotencyKey(req),
      'stake',
      { tokenMint, amount, wallet: walletAddress }
    );

    if (!isNew && operation.status === 'completed') {
      return res.json({
        success: true,
        operationId: operation.operationId,
        status: operation.status,
        txSignature: operation.txSignature,
        result: operation.result,
      });
    }

    updateOperation(operation.operationId, { status: 'processing' });

    const wallet = new PublicKey(walletAddress);
    const position = await protocol.stake(tokenMint, wallet, BigInt(amount));

    const result = {
      stakedAmount: position.stakedAmount.toString(),
      newTotal: position.stakedAmount.toString(),
      wallet: position.wallet.toBase58(),
      tokenMint: position.tokenMint.toBase58(),
      stakedAt: position.stakedAt,
      pendingRewards: position.pendingRewards.toString(),
    };

    updateOperation(operation.operationId, {
      status: 'completed',
      result,
    });

    res.json({
      success: true,
      operationId: operation.operationId,
      status: 'completed',
      result,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /earn/unstake
 * Unstake tokens (with idempotency support)
 */
app.post('/earn/unstake', async (req: Request, res: Response) => {
  try {
    const { tokenMint, amount, idempotencyKey } = req.body as UnstakeRequestV2;
    const walletAddress = req.headers['x-wallet'] as string;

    if (!tokenMint || !amount || !walletAddress) {
      return res.status(400).json({ error: 'Missing tokenMint, amount, or x-wallet header' });
    }

    // Check idempotency (header or body)
    const { operation, isNew } = getOrCreateOperation(
      getIdempotencyKey(req),
      'unstake',
      { tokenMint, amount, wallet: walletAddress }
    );

    if (!isNew && operation.status === 'completed') {
      return res.json({
        success: true,
        operationId: operation.operationId,
        status: operation.status,
        txSignature: operation.txSignature,
        result: operation.result,
      });
    }

    updateOperation(operation.operationId, { status: 'processing' });

    const wallet = new PublicKey(walletAddress);
    const unstakeResult = await protocol.unstake(tokenMint, wallet, BigInt(amount));

    const result = {
      unstaked: unstakeResult.unstaked.toString(),
      rewardsClaimed: unstakeResult.rewards.toString(),
    };

    updateOperation(operation.operationId, {
      status: 'completed',
      result,
    });

    res.json({
      success: true,
      operationId: operation.operationId,
      status: 'completed',
      result,
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
