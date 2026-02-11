/**
 * Supabase Client for Token Registry
 * 
 * Replaces in-memory Map with persistent Supabase storage.
 * Set SUPABASE_URL and SUPABASE_KEY in environment variables.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Types
export interface TokenRecord {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  agent_wallet: string;
  tokenomics: string;
  agent_cut_bps: number;
  earn_cut_bps: number;
  staking_cut_bps: number;
  created_at: string;
  tx_signature: string;
  description?: string;
  website?: string;
  twitter?: string;
  launch_number: number;
}

export interface StakingPool {
  pool_id: string;
  token_mint: string;
  pool_wallet: string;
  total_staked: number;
  total_stakers: number;
  min_stake_amount: number;
  last_crank_at: string | null;
  created_at: string;
}

export interface Stake {
  stake_id: string;
  user_wallet: string;
  token_mint: string;
  amount: number;
  staked_at: string;
  unstaked_at: string | null;
  status: 'active' | 'unstaking' | 'unstaked';
  tx_signature: string;
  unstake_tx_signature: string | null;
}

export interface StakingReward {
  reward_id: string;
  stake_id: string;
  user_wallet: string;
  token_mint: string;
  amount_lamports: number;
  distributed_at: string;
  tx_signature: string | null;
}

// Initialize client
let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    
    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_KEY environment variables');
    }
    
    supabase = createClient(url, key);
  }
  return supabase;
}

// Check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
}

// ============ TOKEN OPERATIONS ============

export async function insertToken(token: TokenRecord): Promise<void> {
  const { error } = await getSupabase()
    .from('tokens')
    .insert(token);
  
  if (error) throw new Error(`Failed to insert token: ${error.message}`);
}

export async function getToken(mint: string): Promise<TokenRecord | null> {
  const { data, error } = await getSupabase()
    .from('tokens')
    .select('*')
    .eq('mint', mint)
    .single();
  
  if (error && error.code !== 'PGRST116') { // PGRST116 = not found
    throw new Error(`Failed to get token: ${error.message}`);
  }
  
  return data;
}

export async function getAllTokens(options: {
  page?: number;
  limit?: number;
  tokenomics?: string;
  agent?: string;
  search?: string;
  sort?: 'newest' | 'oldest';
} = {}): Promise<{ tokens: TokenRecord[]; total: number }> {
  const { page = 1, limit = 20, tokenomics, agent, search, sort = 'newest' } = options;
  const offset = (page - 1) * limit;
  
  let query = getSupabase()
    .from('tokens')
    .select('*', { count: 'exact' });
  
  // Exclude mock/devnet test tokens from production
  query = query.not('tx_signature', 'like', 'mock_%');
  
  // Filters
  if (tokenomics) {
    query = query.eq('tokenomics', tokenomics);
  }
  if (agent) {
    query = query.eq('agent_wallet', agent);
  }
  if (search) {
    query = query.or(`name.ilike.%${search}%,symbol.ilike.%${search}%`);
  }
  
  // Sort
  query = query.order('created_at', { ascending: sort === 'oldest' });
  
  // Pagination
  query = query.range(offset, offset + limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) throw new Error(`Failed to get tokens: ${error.message}`);
  
  return { tokens: data || [], total: count || 0 };
}

export async function getTokensByAgent(agentWallet: string): Promise<TokenRecord[]> {
  const { data, error } = await getSupabase()
    .from('tokens')
    .select('*')
    .eq('agent_wallet', agentWallet)
    .order('created_at', { ascending: false });
  
  if (error) throw new Error(`Failed to get agent tokens: ${error.message}`);
  
  return data || [];
}

export async function getTokenCount(): Promise<number> {
  const { count, error } = await getSupabase()
    .from('tokens')
    .select('*', { count: 'exact', head: true });
  
  if (error) throw new Error(`Failed to get token count: ${error.message}`);
  
  return count || 0;
}

export async function getStats(): Promise<{
  totalLaunches: number;
  totalAgents: number;
  launchesByTokenomics: Record<string, number>;
  lastLaunch: string | null;
}> {
  const db = getSupabase();
  
  // Total launches (exclude mock/devnet test tokens)
  const { count: totalLaunches } = await db
    .from('tokens')
    .select('*', { count: 'exact', head: true })
    .not('tx_signature', 'like', 'mock_%');
  
  // Unique agents (exclude mock tokens)
  const { data: agentData } = await db
    .from('tokens')
    .select('agent_wallet')
    .not('tx_signature', 'like', 'mock_%');
  const uniqueAgents = new Set(agentData?.map(t => t.agent_wallet) || []);
  
  // By tokenomics (exclude mock tokens)
  const { data: tokenomicsData } = await db
    .from('tokens')
    .select('tokenomics')
    .not('tx_signature', 'like', 'mock_%');
  const launchesByTokenomics: Record<string, number> = {};
  tokenomicsData?.forEach(t => {
    launchesByTokenomics[t.tokenomics] = (launchesByTokenomics[t.tokenomics] || 0) + 1;
  });
  
  // Last launch (exclude mock tokens)
  const { data: lastData } = await db
    .from('tokens')
    .select('created_at')
    .not('tx_signature', 'like', 'mock_%')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  return {
    totalLaunches: totalLaunches || 0,
    totalAgents: uniqueAgents.size,
    launchesByTokenomics,
    lastLaunch: lastData?.created_at || null,
  };
}

// ============ STAKING FUNCTIONS ============

export async function getOrCreateStakingPool(tokenMint: string, poolWallet: string): Promise<StakingPool> {
  const db = getSupabase();
  
  // Try to get existing pool
  const { data: existing } = await db
    .from('staking_pools')
    .select('*')
    .eq('token_mint', tokenMint)
    .single();
  
  if (existing) return existing as StakingPool;
  
  // Create new pool
  const { data: newPool, error } = await db
    .from('staking_pools')
    .insert({
      token_mint: tokenMint,
      pool_wallet: poolWallet,
      total_staked: 0,
      total_stakers: 0,
      min_stake_amount: 1000000, // 1 token with 6 decimals
    })
    .select()
    .single();
  
  if (error) throw new Error(`Failed to create staking pool: ${error.message}`);
  return newPool as StakingPool;
}

export async function getStakingPool(tokenMint: string): Promise<StakingPool | null> {
  const db = getSupabase();
  const { data } = await db
    .from('staking_pools')
    .select('*')
    .eq('token_mint', tokenMint)
    .single();
  return data as StakingPool | null;
}

export async function recordStake(
  userWallet: string,
  tokenMint: string,
  amount: number,
  txSignature: string
): Promise<Stake> {
  const db = getSupabase();
  
  // Insert stake record
  const { data: stake, error } = await db
    .from('stakes')
    .insert({
      user_wallet: userWallet,
      token_mint: tokenMint,
      amount,
      tx_signature: txSignature,
      status: 'active',
    })
    .select()
    .single();
  
  if (error) throw new Error(`Failed to record stake: ${error.message}`);
  
  // Update pool totals
  await db.rpc('increment_pool_stake', { 
    p_token_mint: tokenMint, 
    p_amount: amount 
  }).catch(() => {
    // Fallback if RPC doesn't exist - manual update
    db.from('staking_pools')
      .update({ 
        total_staked: db.rpc('add', { a: 'total_staked', b: amount }),
      })
      .eq('token_mint', tokenMint);
  });
  
  return stake as Stake;
}

export async function getActiveStakesByUser(userWallet: string): Promise<Stake[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from('stakes')
    .select('*')
    .eq('user_wallet', userWallet)
    .eq('status', 'active')
    .order('staked_at', { ascending: false });
  
  if (error) throw new Error(`Failed to get stakes: ${error.message}`);
  return (data || []) as Stake[];
}

export async function getActiveStakesByToken(tokenMint: string): Promise<Stake[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from('stakes')
    .select('*')
    .eq('token_mint', tokenMint)
    .eq('status', 'active')
    .order('staked_at', { ascending: false });
  
  if (error) throw new Error(`Failed to get stakes: ${error.message}`);
  return (data || []) as Stake[];
}

export async function getStakeById(stakeId: string): Promise<Stake | null> {
  const db = getSupabase();
  const { data } = await db
    .from('stakes')
    .select('*')
    .eq('stake_id', stakeId)
    .single();
  return data as Stake | null;
}

export async function updateStakeStatus(
  stakeId: string, 
  status: 'active' | 'unstaking' | 'unstaked',
  unstakeTxSignature?: string
): Promise<void> {
  const db = getSupabase();
  const updates: any = { status };
  if (status === 'unstaked') {
    updates.unstaked_at = new Date().toISOString();
  }
  if (unstakeTxSignature) {
    updates.unstake_tx_signature = unstakeTxSignature;
  }
  
  const { error } = await db
    .from('stakes')
    .update(updates)
    .eq('stake_id', stakeId);
  
  if (error) throw new Error(`Failed to update stake: ${error.message}`);
}

export async function updatePoolTotals(tokenMint: string): Promise<void> {
  const db = getSupabase();
  
  // Calculate totals from active stakes
  const { data: stakes } = await db
    .from('stakes')
    .select('amount, user_wallet')
    .eq('token_mint', tokenMint)
    .eq('status', 'active');
  
  const totalStaked = stakes?.reduce((sum, s) => sum + s.amount, 0) || 0;
  const uniqueStakers = new Set(stakes?.map(s => s.user_wallet) || []);
  
  await db
    .from('staking_pools')
    .update({
      total_staked: totalStaked,
      total_stakers: uniqueStakers.size,
    })
    .eq('token_mint', tokenMint);
}

export async function recordReward(
  stakeId: string,
  userWallet: string,
  tokenMint: string,
  amountLamports: number,
  txSignature?: string
): Promise<StakingReward> {
  const db = getSupabase();
  
  const { data, error } = await db
    .from('staking_rewards')
    .insert({
      stake_id: stakeId,
      user_wallet: userWallet,
      token_mint: tokenMint,
      amount_lamports: amountLamports,
      tx_signature: txSignature,
    })
    .select()
    .single();
  
  if (error) throw new Error(`Failed to record reward: ${error.message}`);
  return data as StakingReward;
}

export async function getRewardsByUser(userWallet: string): Promise<StakingReward[]> {
  const db = getSupabase();
  const { data } = await db
    .from('staking_rewards')
    .select('*')
    .eq('user_wallet', userWallet)
    .order('distributed_at', { ascending: false });
  return (data || []) as StakingReward[];
}

export async function updatePoolLastCrank(tokenMint: string): Promise<void> {
  const db = getSupabase();
  await db
    .from('staking_pools')
    .update({ last_crank_at: new Date().toISOString() })
    .eq('token_mint', tokenMint);
}

// ============ SCHEMA (for reference) ============
/*
CREATE TABLE tokens (
  mint TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  uri TEXT,
  agent_wallet TEXT NOT NULL,
  tokenomics TEXT NOT NULL,
  agent_cut_bps INTEGER NOT NULL,
  earn_cut_bps INTEGER NOT NULL,
  staking_cut_bps INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  tx_signature TEXT,
  description TEXT,
  website TEXT,
  twitter TEXT,
  launch_number INTEGER
);

CREATE INDEX idx_tokens_agent ON tokens(agent_wallet);
CREATE INDEX idx_tokens_tokenomics ON tokens(tokenomics);
CREATE INDEX idx_tokens_created ON tokens(created_at DESC);

-- Staking tables (off-chain tracking)
CREATE TABLE staking_pools (
  pool_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_mint TEXT NOT NULL UNIQUE REFERENCES tokens(mint),
  pool_wallet TEXT NOT NULL,
  total_staked BIGINT DEFAULT 0,
  total_stakers INTEGER DEFAULT 0,
  min_stake_amount BIGINT DEFAULT 1000000, -- 1 token with 6 decimals
  last_crank_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stakes (
  stake_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet TEXT NOT NULL,
  token_mint TEXT NOT NULL REFERENCES tokens(mint),
  amount BIGINT NOT NULL,
  staked_at TIMESTAMPTZ DEFAULT NOW(),
  unstaked_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'unstaking', 'unstaked')),
  tx_signature TEXT NOT NULL,
  unstake_tx_signature TEXT
);

CREATE INDEX idx_stakes_user ON stakes(user_wallet);
CREATE INDEX idx_stakes_token ON stakes(token_mint);
CREATE INDEX idx_stakes_status ON stakes(status);

CREATE TABLE staking_rewards (
  reward_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stake_id UUID REFERENCES stakes(stake_id),
  user_wallet TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  amount_lamports BIGINT NOT NULL,
  distributed_at TIMESTAMPTZ DEFAULT NOW(),
  tx_signature TEXT
);

CREATE INDEX idx_rewards_user ON staking_rewards(user_wallet);
CREATE INDEX idx_rewards_token ON staking_rewards(token_mint);
*/
