# Earn Protocol Demo Script
**Duration:** 2-3 minutes

---

## INTRO (15 sec)
> "Earn Protocol gives every Pump.fun token instant tokenomics - staking rewards, automated buybacks, and creator revenue sharing. One API call, zero smart contract knowledge needed."

---

## PART 1: The Problem (20 sec)
> "Right now, 99% of Pump.fun tokens fail. Why? No utility, no reason to hold. Creators dump, holders get rugged. We fix that."

**Show:** Pump.fun homepage (quick scroll of tokens)

---

## PART 2: Launch a Token (45 sec)
> "Watch how easy this is. One API call to launch a token with built-in tokenomics."

**Show terminal:**
```bash
curl -X POST https://api.earn.supply/launch \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Demo Token",
    "symbol": "DEMO", 
    "description": "Hackathon demo",
    "template": "community"
  }'
```

> "Template 'community' means 25% to creator, 25% to Earn protocol, and 50% to stakers. The token is live on Pump.fun instantly."

**Show:** Response with mint address, then Pump.fun page

---

## PART 3: Staking Flow (45 sec)
> "Now holders can stake their tokens and earn SOL from trading fees."

**Show:** API calls or earn.supply UI
```bash
# Check staking pool
curl https://api.earn.supply/api/staking/pool/[MINT]

# User stakes (after transferring tokens)
curl -X POST https://api.earn.supply/api/stake \
  -d '{"userWallet": "...", "tokenMint": "...", "txSignature": "..."}'
```

> "Every trade generates fees. Those fees get distributed to stakers proportionally. Passive income for holders."

---

## PART 4: The Flywheel (30 sec)
> "Here's the magic: trading fees fund buybacks AND staking rewards. More trading means more rewards, which attracts more stakers, which reduces sell pressure, which means more trading. It's a positive flywheel."

**Show:** Architecture diagram from README or SUBMISSION.md

---

## PART 5: Live on Mainnet (20 sec)
> "This isn't a demo - it's live on Solana mainnet right now."

**Show:** 
- Solscan: Program `6jWG6SLtbXhvwsEMcVc3UmbWHyEHgZkY6NpHn8AmCqYj`
- API: `https://api.earn.supply/health` showing mainnet
- EARN token on Pump.fun

---

## CLOSE (15 sec)
> "Earn Protocol: tokenomics-as-a-service for Solana. Give your token a reason to exist."

**Show:** earn.supply landing page

---

## KEY POINTS TO HIT
- ✅ One API call to launch
- ✅ Built-in staking rewards
- ✅ Automated fee distribution
- ✅ Live on mainnet (not testnet!)
- ✅ Works with any Pump.fun token

## LINKS TO SHOW
- https://earn.supply
- https://api.earn.supply/health
- https://pump.fun/87WkKqpXkcGixt7WUxEHQxFfr2BU7eU1GHt5fKoSnCdd (EARN token)
- https://solscan.io/account/6jWG6SLtbXhvwsEMcVc3UmbWHyEHgZkY6NpHn8AmCqYj
