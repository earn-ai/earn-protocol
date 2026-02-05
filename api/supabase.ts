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
  
  // Total launches
  const { count: totalLaunches } = await db
    .from('tokens')
    .select('*', { count: 'exact', head: true });
  
  // Unique agents
  const { data: agentData } = await db
    .from('tokens')
    .select('agent_wallet');
  const uniqueAgents = new Set(agentData?.map(t => t.agent_wallet) || []);
  
  // By tokenomics
  const { data: tokenomicsData } = await db
    .from('tokens')
    .select('tokenomics');
  const launchesByTokenomics: Record<string, number> = {};
  tokenomicsData?.forEach(t => {
    launchesByTokenomics[t.tokenomics] = (launchesByTokenomics[t.tokenomics] || 0) + 1;
  });
  
  // Last launch
  const { data: lastData } = await db
    .from('tokens')
    .select('created_at')
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
*/
