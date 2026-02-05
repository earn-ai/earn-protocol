/**
 * Enhanced Data Endpoints
 * 
 * These endpoints combine Supabase (tokens) + Birdeye (prices) + On-chain (staking)
 * Import and use in server.ts
 */

import { Router, Request, Response } from 'express';
import { isSupabaseConfigured, getAllTokens, getToken, getStats, getTokensByAgent, TokenRecord } from './supabase';
import { getTokenPrice, getMultipleTokenPrices, isPriceApiAvailable, TokenPrice } from './birdeye';
import { StakingClient, getStakingPoolPDA } from './staking-client';
import { Connection, PublicKey } from '@solana/web3.js';

const router = Router();

// ============ ENRICHED TOKEN DATA ============

interface EnrichedToken extends TokenRecord {
  price?: number;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
  stakingPool?: {
    totalStaked: string;
    stakerCount: number;
    rewardsAvailable: string;
  } | null;
}

async function enrichTokenWithPrice(token: TokenRecord): Promise<EnrichedToken> {
  const enriched: EnrichedToken = { ...token };
  
  try {
    const price = await getTokenPrice(token.mint);
    if (price) {
      enriched.price = price.price;
      enriched.priceChange24h = price.priceChange24h;
      enriched.volume24h = price.volume24h;
      enriched.marketCap = price.marketCap;
    }
  } catch (e) {
    console.error(`Failed to get price for ${token.mint}:`, e);
  }
  
  return enriched;
}

async function enrichTokenWithStaking(
  token: EnrichedToken,
  stakingClient: StakingClient
): Promise<EnrichedToken> {
  try {
    const mint = new PublicKey(token.mint);
    const pool = await stakingClient.getStakingPool(mint);
    
    if (pool) {
      token.stakingPool = {
        totalStaked: pool.totalStaked.toString(),
        stakerCount: pool.stakerCount,
        rewardsAvailable: (Number(pool.rewardsAvailable) / 1e9).toFixed(4) + ' SOL',
      };
    } else {
      token.stakingPool = null;
    }
  } catch (e) {
    token.stakingPool = null;
  }
  
  return token;
}

// ============ EXPLORE PAGE ENDPOINT ============

export function createExploreEndpoint(stakingClient: StakingClient) {
  return async (req: Request, res: Response) => {
    try {
      const {
        page = '1',
        limit = '20',
        tokenomics,
        sort = 'newest',
        search,
        includePrice = 'true',
        includeStaking = 'false',
      } = req.query;
      
      // Get tokens from Supabase
      const { tokens, total } = await getAllTokens({
        page: parseInt(page as string),
        limit: Math.min(parseInt(limit as string), 100),
        tokenomics: tokenomics as string,
        search: search as string,
        sort: sort as 'newest' | 'oldest',
      });
      
      let enrichedTokens: EnrichedToken[] = tokens;
      
      // Enrich with prices
      if (includePrice === 'true' && tokens.length > 0) {
        const mints = tokens.map(t => t.mint);
        const prices = await getMultipleTokenPrices(mints);
        
        enrichedTokens = tokens.map(token => {
          const price = prices.get(token.mint);
          return {
            ...token,
            price: price?.price,
            priceChange24h: price?.priceChange24h,
            volume24h: price?.volume24h,
            marketCap: price?.marketCap,
          };
        });
        
        // Sort by volume if requested
        if (sort === 'volume') {
          enrichedTokens.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
        }
      }
      
      // Enrich with staking data (optional, slower)
      if (includeStaking === 'true') {
        enrichedTokens = await Promise.all(
          enrichedTokens.map(t => enrichTokenWithStaking(t, stakingClient))
        );
      }
      
      res.json({
        success: true,
        tokens: enrichedTokens,
        total,
        page: parseInt(page as string),
        pages: Math.ceil(total / parseInt(limit as string)),
        priceDataAvailable: isPriceApiAvailable(),
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  };
}

// ============ ENHANCED STATS ENDPOINT ============

export function createStatsEndpoint(stakingClient: StakingClient, earnWallet: PublicKey) {
  return async (req: Request, res: Response) => {
    try {
      // Get basic stats from Supabase
      const dbStats = await getStats();
      
      // Get top tokens by volume
      const { tokens } = await getAllTokens({ limit: 10 });
      const mints = tokens.map(t => t.mint);
      const prices = await getMultipleTokenPrices(mints);
      
      // Calculate total volume
      let totalVolume24h = 0;
      const topByVolume = tokens
        .map(t => ({
          mint: t.mint,
          name: t.name,
          symbol: t.symbol,
          volume24h: prices.get(t.mint)?.volume24h || 0,
        }))
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, 5);
      
      topByVolume.forEach(t => totalVolume24h += t.volume24h);
      
      // Get staking stats
      let stakingStats = null;
      try {
        const globalConfig = await stakingClient.getGlobalConfig();
        if (globalConfig) {
          stakingStats = {
            totalPools: globalConfig.totalPools.toString(),
            totalStakedValue: globalConfig.totalStakedValue.toString(),
            totalRewardsDistributed: (Number(globalConfig.totalRewardsDistributed) / 1e9).toFixed(4) + ' SOL',
          };
        }
      } catch (e) {
        // Staking not available
      }
      
      res.json({
        success: true,
        earnWallet: earnWallet.toString(),
        ...dbStats,
        totalVolume24h,
        topByVolume,
        staking: stakingStats,
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  };
}

// ============ TOKEN DETAIL ENDPOINT ============

export function createTokenDetailEndpoint(stakingClient: StakingClient) {
  return async (req: Request, res: Response) => {
    try {
      const { mint } = req.params;
      
      // Get token from Supabase
      const token = await getToken(mint);
      if (!token) {
        return res.status(404).json({ success: false, error: 'Token not found' });
      }
      
      // Enrich with price
      let enriched = await enrichTokenWithPrice(token);
      
      // Enrich with staking
      enriched = await enrichTokenWithStaking(enriched, stakingClient);
      
      res.json({
        success: true,
        ...enriched,
        pumpfun: `https://pump.fun/${mint}`,
        solscan: `https://solscan.io/token/${mint}`,
        stakingUrl: `https://earn.supply/stake/${mint}`,
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  };
}

// ============ AGENT EARNINGS ENDPOINT ============

export function createEarningsEndpoint(stakingClient: StakingClient) {
  return async (req: Request, res: Response) => {
    try {
      const { wallet } = req.params;
      
      // Get agent's tokens
      const tokens = await getTokensByAgent(wallet);
      
      // Get prices for all tokens
      const mints = tokens.map(t => t.mint);
      const prices = await getMultipleTokenPrices(mints);
      
      // Calculate totals
      let totalVolume24h = 0;
      const enrichedTokens = tokens.map(t => {
        const price = prices.get(t.mint);
        const vol = price?.volume24h || 0;
        totalVolume24h += vol;
        
        // Estimate earnings (volume * 1% fee * agent cut)
        const estimatedFees = vol * 0.01 * (t.agent_cut_bps / 10000);
        
        return {
          mint: t.mint,
          name: t.name,
          symbol: t.symbol,
          tokenomics: t.tokenomics,
          agentCut: `${t.agent_cut_bps / 100}%`,
          volume24h: vol,
          estimatedEarnings24h: estimatedFees,
          createdAt: t.created_at,
        };
      });
      
      // Total estimated earnings
      const totalEstimatedEarnings = enrichedTokens.reduce(
        (sum, t) => sum + t.estimatedEarnings24h, 0
      );
      
      res.json({
        success: true,
        wallet,
        tokensLaunched: tokens.length,
        tokens: enrichedTokens,
        totalVolume24h,
        totalEstimatedEarnings24h: totalEstimatedEarnings.toFixed(4) + ' USD',
        note: 'Earnings are estimates based on 24h volume. Actual earnings depend on trade timing.',
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  };
}

export default router;
