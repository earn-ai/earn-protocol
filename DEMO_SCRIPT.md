# Earn Protocol Demo Script
**Colosseum Hackathon Submission**

---

## 🎬 Opening (15 sec)

"Earn Protocol - Tokenomics-as-a-Service for Solana. One API call gives any memecoin instant staking, rewards, and creator revenue."

---

## 📍 Scene 1: The Problem (20 sec)

"Most memecoins launch, pump, and die. Why? No utility, no reason to hold. Earn fixes this by adding real tokenomics to any token in seconds."

---

## 📍 Scene 2: Landing Page (15 sec)

**Show:** https://earn.supply

- Dark premium UI
- "Make your memecoin immortal" tagline
- Explore tokens, Stats dashboard

---

## 📍 Scene 3: Launch a Token (45 sec)

**Show:** https://api.earn.supply → scroll to Launch Form

1. Fill in token details:
   - Name: "Demo Token"
   - Symbol: "DEMO"  
   - Description: "Testing Earn Protocol"
   - Upload image (drag & drop)

2. Click "Launch Token"

3. Show response with:
   - Token mint address
   - Pool created automatically
   - Staking ready immediately

**Say:** "One form. Token launched with full tokenomics built in."

---

## 📍 Scene 4: Staking Flow (60 sec)

**Use curl or show API docs:**

```bash
# Check the pool
curl https://api.earn.supply/api/pool/[MINT]
```

Show pool stats: total staked, APY, reward rate

```bash
# Stake tokens
curl -X POST https://api.earn.supply/api/stake \
  -d '{"pool": "[POOL]", "amount": 1000000}'
```

**Say:** "Users can stake tokens and earn rewards. No separate contract deployment needed."

```bash
# Check stake position
curl https://api.earn.supply/api/stake/[POOL]/[WALLET]
```

Show: staked amount, pending rewards, time staked

---

## 📍 Scene 5: Rewards & Fees (30 sec)

**Show:** Fee structure diagram or explain:

- 1% fee on transactions
- 50% to stakers (rewards)
- 30% for buyback & burn
- 20% to creator

**Say:** "Every trade feeds the ecosystem. Stakers earn passive income, supply deflates, creators get paid."

---

## 📍 Scene 6: AI Agent Integration (30 sec)

**Show:** https://api.earn.supply/llm.txt

**Say:** "Earn is built for AI agents. Any agent can read our LLM.txt, understand our API, and launch tokens programmatically. We're not just a tool - we're infrastructure for the agent economy."

---

## 📍 Scene 7: Explore & Stats (20 sec)

**Show:** 
- https://earn.supply/explore - Token grid with filters
- https://earn.supply/stats - Dashboard metrics

**Say:** "Full transparency. See all tokens, their staking stats, and protocol metrics."

---

## 📍 Scene 8: Technical Architecture (20 sec)

Quick flash of:
- Solana program (Anchor/Rust)
- Vercel API (TypeScript)
- Supabase for indexing
- On-chain staking with real PDAs

**Say:** "Built on Solana for speed. Anchor program handles all staking logic on-chain. API makes it accessible to anyone."

---

## 🎬 Closing (15 sec)

"Earn Protocol. Launch tokens that last. Built by AI, for the agent economy."

**Show:** 
- https://earn.supply
- https://api.earn.supply
- GitHub: github.com/earn-ai/earn-protocol

---

## 📝 Recording Notes

**Total time:** ~4 minutes

**Tools needed:**
- Screen recorder (OBS or Loom)
- Browser with tabs pre-loaded
- Terminal for curl commands (optional)

**Tips:**
- Use devnet (we're on devnet anyway)
- Have a test token already launched for smooth demo
- Keep energy up, show excitement
- Focus on the "why" not just "what"

---

## 🔗 Key URLs for Demo

| What | URL |
|------|-----|
| Landing | https://earn.supply |
| API/Launch | https://api.earn.supply |
| Explore | https://earn.supply/explore |
| Stats | https://earn.supply/stats |
| Docs | https://api.earn.supply/docs |
| LLM.txt | https://api.earn.supply/llm.txt |
| GitHub | https://github.com/earn-ai/earn-protocol |

---

## 💡 Key Talking Points

1. **One API call** - No smart contract deployment needed
2. **Built for AI agents** - LLM.txt, OpenAPI spec, simple REST
3. **Real tokenomics** - Not just a meme, actual utility
4. **Creator revenue** - 20% of fees, passive income
5. **Deflationary** - 30% buyback & burn
6. **Staking rewards** - 50% to holders who stake
