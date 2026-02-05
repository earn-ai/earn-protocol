# Supabase + Birdeye Setup Guide

## 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Go to **Settings > API** and copy:
   - `Project URL` → This is your `SUPABASE_URL`
   - `service_role key` (secret) → This is your `SUPABASE_KEY`

## 2. Run Schema

1. Go to **SQL Editor** in Supabase
2. Copy contents of `api/supabase-schema.sql`
3. Run the query to create the `tokens` table

## 3. Get Birdeye API Key

1. Go to [birdeye.so](https://birdeye.so) and sign up
2. Get your API key from the dashboard
3. This is your `BIRDEYE_API_KEY`

## 4. Add Environment Variables to Vercel

In Vercel project settings, add:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGc...your-service-role-key
BIRDEYE_API_KEY=your-birdeye-key
```

Also keep existing:
```
EARN_WALLET_KEY=...your-existing-wallet-key
RPC_URL=https://api.devnet.solana.com
```

## 5. Redeploy

Push to GitHub or trigger redeploy in Vercel.

---

## New API Endpoints

After setup, you'll have:

### Explore Page
```
GET /explore?page=1&limit=20&tokenomics=degen&includePrice=true
```
Returns tokens with price/volume data from Birdeye.

### Enhanced Stats
```
GET /stats
```
Returns total tokens, volume, top tokens by volume, staking stats.

### Token Detail
```
GET /token/:mint
```
Returns full token info + price + staking pool data.

### Agent Earnings
```
GET /earnings/:wallet
```
Returns agent's tokens with volume and estimated earnings.

---

## Frontend Integration

```javascript
// Explore page
const { tokens, total } = await fetch(
  'https://api.earn.supply/explore?page=1&includePrice=true'
).then(r => r.json());

// Stats
const stats = await fetch('https://api.earn.supply/stats').then(r => r.json());

// Token detail
const token = await fetch(`https://api.earn.supply/token/${mint}`).then(r => r.json());
```

---

## Notes

- **Price caching**: Birdeye responses cached for 30 seconds to avoid rate limits
- **Fallback**: If Birdeye fails, DexScreener is used (no API key needed)
- **Staking data**: Comes from on-chain (our Solana program), always real-time
