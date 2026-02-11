-- Fee Claims Table
-- Logs every successful fee claim as a revenue ledger

CREATE TABLE IF NOT EXISTS fee_claims (
  claim_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_mint TEXT NOT NULL,
  amount_sol NUMERIC NOT NULL,
  tx_signature TEXT NOT NULL,
  wallet_balance_before NUMERIC,
  wallet_balance_after NUMERIC,
  claimed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_claims_token ON fee_claims(token_mint);
CREATE INDEX IF NOT EXISTS idx_fee_claims_date ON fee_claims(claimed_at DESC);

-- Add fee_config_status column to tokens table
-- Values: 'configured', 'pending', 'failed', 'not_eligible'
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS fee_config_status TEXT DEFAULT 'pending';

-- Index for efficient fee claiming queries
CREATE INDEX IF NOT EXISTS idx_tokens_fee_status ON tokens(fee_config_status);

-- Update existing tokens to 'pending' (they'll be checked on first claim-all)
UPDATE tokens SET fee_config_status = 'pending' WHERE fee_config_status IS NULL;
