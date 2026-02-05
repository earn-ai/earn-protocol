/**
 * Birdeye API Integration
 * 
 * Fetches price, volume, and market data for tokens.
 * Set BIRDEYE_API_KEY in environment variables.
 * Falls back to DexScreener if Birdeye fails.
 */

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

// Cache to avoid rate limits (30 second TTL)
const priceCache = new Map<string, { data: TokenPrice; expires: number }>();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

// ============ BIRDEYE API ============

const BIRDEYE_BASE = 'https://public-api.birdeye.so';

async function fetchBirdeye(endpoint: string): Promise<any> {
  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) {
    throw new Error('BIRDEYE_API_KEY not configured');
  }
  
  const response = await fetch(`${BIRDEYE_BASE}${endpoint}`, {
    headers: {
      'X-API-KEY': apiKey,
      'x-chain': 'solana',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Birdeye API error: ${response.status}`);
  }
  
  return response.json();
}

export async function getTokenPriceBirdeye(mint: string): Promise<TokenPrice | null> {
  try {
    const data = await fetchBirdeye(`/defi/token_overview?address=${mint}`);
    
    if (!data.success || !data.data) {
      return null;
    }
    
    const token = data.data;
    return {
      mint,
      price: token.price || 0,
      priceChange24h: token.priceChange24hPercent || 0,
      volume24h: token.v24hUSD || 0,
      marketCap: token.mc || 0,
      liquidity: token.liquidity || 0,
      lastUpdated: Date.now(),
    };
  } catch (e) {
    console.error(`Birdeye fetch failed for ${mint}:`, e);
    return null;
  }
}

export async function getMultipleTokenPricesBirdeye(mints: string[]): Promise<Map<string, TokenPrice>> {
  const results = new Map<string, TokenPrice>();
  
  // Birdeye supports batch requests
  try {
    const data = await fetchBirdeye(`/defi/multi_price?list_address=${mints.join(',')}`);
    
    if (data.success && data.data) {
      for (const [mint, info] of Object.entries(data.data) as [string, any][]) {
        results.set(mint, {
          mint,
          price: info.value || 0,
          priceChange24h: info.priceChange24h || 0,
          volume24h: 0, // Not in multi_price response
          marketCap: 0,
          liquidity: 0,
          lastUpdated: Date.now(),
        });
      }
    }
  } catch (e) {
    console.error('Birdeye multi-price fetch failed:', e);
  }
  
  return results;
}

// ============ DEXSCREENER FALLBACK ============

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

// ============ CACHED GETTER (with fallback) ============

export async function getTokenPrice(mint: string): Promise<TokenPrice | null> {
  // Check cache
  const cached = priceCache.get(mint);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  
  // Try Birdeye first
  let price = await getTokenPriceBirdeye(mint);
  
  // Fallback to DexScreener
  if (!price) {
    price = await getTokenPriceDexScreener(mint);
  }
  
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
  
  if (uncached.length === 0) {
    return results;
  }
  
  // Fetch uncached from Birdeye
  const birdeyeResults = await getMultipleTokenPricesBirdeye(uncached);
  
  // For any that failed, try DexScreener individually
  for (const mint of uncached) {
    let price = birdeyeResults.get(mint);
    
    if (!price) {
      price = await getTokenPriceDexScreener(mint);
    }
    
    if (price) {
      results.set(mint, price);
      priceCache.set(mint, { data: price, expires: Date.now() + CACHE_TTL_MS });
    }
  }
  
  return results;
}

// ============ CHECK CONFIG ============

export function isBirdeyeConfigured(): boolean {
  return !!process.env.BIRDEYE_API_KEY;
}

// DexScreener is public, no key needed
export function isPriceApiAvailable(): boolean {
  return true; // DexScreener always available as fallback
}
