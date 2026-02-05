/**
 * Token Data Module
 * 
 * Unified interface for token prices and market data.
 * 
 * Data Sources:
 * - DexScreener: Prices, volume, market cap (free, no auth)
 * - Helius: Token metadata, balances, transactions (requires API key)
 * 
 * DexScreener is used for all price data because:
 * - Free, no API key needed
 * - Good coverage of Solana tokens
 * - Real-time DEX data
 */

import * as helius from './helius';

// Types
export interface TokenPrice {
  mint: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  lastUpdated: number;
}

export interface TokenInfo {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  image?: string;
  description?: string;
  price?: number;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
  liquidity?: number;
}

// Cache to avoid rate limits (30 second TTL)
const priceCache = new Map<string, { data: TokenPrice; expires: number }>();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

// ============ DEXSCREENER API (Primary for prices) ============

const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest';

export async function getTokenPriceDexScreener(mint: string): Promise<TokenPrice | null> {
  try {
    const response = await fetch(`${DEXSCREENER_BASE}/dex/tokens/${mint}`);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return null;
    }
    
    // Get the pair with highest liquidity
    const pair = data.pairs.sort((a: any, b: any) => 
      (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];
    
    return {
      mint,
      price: parseFloat(pair.priceUsd) || 0,
      priceChange24h: pair.priceChange?.h24 || 0,
      volume24h: pair.volume?.h24 || 0,
      marketCap: pair.fdv || 0,
      liquidity: pair.liquidity?.usd || 0,
      lastUpdated: Date.now(),
    };
  } catch (e) {
    console.error(`DexScreener fetch failed for ${mint}:`, e);
    return null;
  }
}

export async function searchTokensDexScreener(query: string): Promise<TokenPrice[]> {
  try {
    const response = await fetch(`${DEXSCREENER_BASE}/dex/search?q=${encodeURIComponent(query)}`);
    
    if (!response.ok) {
      return [];
    }
    
    const data = await response.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return [];
    }
    
    // Filter for Solana pairs and dedupe by token
    const seen = new Set<string>();
    const results: TokenPrice[] = [];
    
    for (const pair of data.pairs) {
      if (pair.chainId !== 'solana') continue;
      
      const mint = pair.baseToken?.address;
      if (!mint || seen.has(mint)) continue;
      seen.add(mint);
      
      results.push({
        mint,
        price: parseFloat(pair.priceUsd) || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
        volume24h: pair.volume?.h24 || 0,
        marketCap: pair.fdv || 0,
        liquidity: pair.liquidity?.usd || 0,
        lastUpdated: Date.now(),
      });
    }
    
    return results;
  } catch (e) {
    console.error(`DexScreener search failed for ${query}:`, e);
    return [];
  }
}

// ============ CACHED GETTER ============

export async function getTokenPrice(mint: string): Promise<TokenPrice | null> {
  // Check cache
  const cached = priceCache.get(mint);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  
  // Fetch from DexScreener
  const price = await getTokenPriceDexScreener(mint);
  
  // Cache result
  if (price) {
    priceCache.set(mint, { data: price, expires: Date.now() + CACHE_TTL_MS });
  }
  
  return price;
}

export async function getMultipleTokenPrices(mints: string[]): Promise<Map<string, TokenPrice>> {
  const results = new Map<string, TokenPrice>();
  const uncached: string[] = [];
  
  // Check cache first
  for (const mint of mints) {
    const cached = priceCache.get(mint);
    if (cached && cached.expires > Date.now()) {
      results.set(mint, cached.data);
    } else {
      uncached.push(mint);
    }
  }
  
  // Fetch uncached from DexScreener (one at a time, rate limit friendly)
  for (const mint of uncached) {
    const price = await getTokenPriceDexScreener(mint);
    
    if (price) {
      results.set(mint, price);
      priceCache.set(mint, { data: price, expires: Date.now() + CACHE_TTL_MS });
    }
    
    // Small delay to be rate limit friendly
    if (uncached.length > 5) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  return results;
}

// ============ COMBINED TOKEN INFO ============

export async function getFullTokenInfo(mint: string): Promise<TokenInfo | null> {
  // Get price data from DexScreener
  const priceData = await getTokenPrice(mint);
  
  // Get metadata from Helius if available
  let metadata = null;
  if (helius.isHeliusConfigured()) {
    metadata = await helius.getTokenMetadata(mint);
  }
  
  // Combine data
  if (!priceData && !metadata) {
    return null;
  }
  
  return {
    mint,
    name: metadata?.name || 'Unknown',
    symbol: metadata?.symbol || 'UNK',
    decimals: metadata?.decimals || 9,
    image: metadata?.image,
    description: metadata?.description,
    price: priceData?.price,
    priceChange24h: priceData?.priceChange24h,
    volume24h: priceData?.volume24h,
    marketCap: priceData?.marketCap,
    liquidity: priceData?.liquidity,
  };
}

// ============ JUPITER PRICE API (Alternative) ============

const JUPITER_PRICE_API = 'https://price.jup.ag/v4';

export async function getTokenPriceJupiter(mint: string): Promise<number | null> {
  try {
    const response = await fetch(`${JUPITER_PRICE_API}/price?ids=${mint}`);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return data.data?.[mint]?.price || null;
  } catch (e) {
    console.error(`Jupiter price fetch failed for ${mint}:`, e);
    return null;
  }
}

// ============ STATUS CHECK ============

export function isPriceApiAvailable(): boolean {
  return true; // DexScreener always available (no auth needed)
}

export function isMetadataApiAvailable(): boolean {
  return helius.isHeliusConfigured();
}

export { helius };
