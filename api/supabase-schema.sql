-- Supabase Schema for Earn Protocol
-- Run this in your Supabase SQL editor

-- ============ TOKENS TABLE ============
CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  uri TEXT,
  agent_wallet TEXT NOT NULL,
  tokenomics TEXT NOT NULL CHECK (tokenomics IN ('degen', 'creator', 'community', 'lowfee')),
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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tokens_agent ON tokens(agent_wallet);
CREATE INDEX IF NOT EXISTS idx_tokens_tokenomics ON tokens(tokenomics);
CREATE INDEX IF NOT EXISTS idx_tokens_created ON tokens(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol);

-- ============ STATS VIEW ============
CREATE OR REPLACE VIEW token_stats AS
SELECT 
  COUNT(*) as total_tokens,
  COUNT(DISTINCT agent_wallet) as total_agents,
  MAX(created_at) as last_launch,
  COUNT(*) FILTER (WHERE tokenomics = 'degen') as degen_count,
  COUNT(*) FILTER (WHERE tokenomics = 'creator') as creator_count,
  COUNT(*) FILTER (WHERE tokenomics = 'community') as community_count,
  COUNT(*) FILTER (WHERE tokenomics = 'lowfee') as lowfee_count
FROM tokens;

-- ============ DAILY LAUNCHES VIEW ============
CREATE OR REPLACE VIEW daily_launches AS
SELECT 
  DATE(created_at) as date,
  COUNT(*) as launches
FROM tokens
GROUP BY DATE(created_at)
ORDER BY date DESC
LIMIT 30;

-- ============ ROW LEVEL SECURITY ============
-- Enable RLS
ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Public read access" ON tokens
  FOR SELECT USING (true);

-- Only service role can insert/update
CREATE POLICY "Service role insert" ON tokens
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role update" ON tokens
  FOR UPDATE USING (true);

-- ============ FUNCTION: Get token count by day ============
CREATE OR REPLACE FUNCTION get_launches_by_day(days_back INTEGER DEFAULT 7)
RETURNS TABLE (date DATE, count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(created_at) as date,
    COUNT(*) as count
  FROM tokens
  WHERE created_at >= NOW() - (days_back || ' days')::INTERVAL
  GROUP BY DATE(created_at)
  ORDER BY date DESC;
END;
$$ LANGUAGE plpgsql;
