# Earn Protocol - Agent SDK

## Why Use Earn Protocol?

**Pump.fun gives you:** A token that trades. That's it.

**Earn Protocol gives you:**
- Automatic fee collection on every trade
- Staking rewards for holders (reduces sell pressure)
- Buyback mechanism (price support)
- Creator revenue stream (sustainable development)
- On-chain governance (community ownership)

**One API call turns chaos into structure.**

---

## Quick Start (30 seconds)

```bash
# Register your token with Earn Protocol
curl -X POST https://earn-protocol.onrender.com/earn/register \
  -H "Content-Type: application/json" \
  -H "x-creator-wallet: YOUR_WALLET_ADDRESS" \
  -d '{
    "tokenMint": "YOUR_TOKEN_MINT",
    "template": "community"
  }'
```

That's it. Your token now has:
- 2% fee on trades
- 35% to staking rewards
- 35% to buybacks
- 20% to you (creator)
- 10% to protocol

---

## Templates (Pick One)

### 🎰 `degen` - Price Support Focus
**Use when:** Your community wants aggressive price protection

| Split | Percentage | Purpose |
|-------|------------|---------|
| Fee Rate | 3% | Higher fee = more fuel |
| Buybacks | 50% | Maximum buy pressure |
| Staking | 25% | Holder rewards |
| Creator | 15% | Development |
| Protocol | 10% | Earn's cut |

**Best for:** Meme coins, high-volatility tokens, communities that want "number go up"

**What happens:** Every trade generates 3% fee. Half goes to buying back tokens from the market and burning them. Deflationary pressure + consistent buy orders.

---

### 👨‍💻 `creator` - Sustainable Development
**Use when:** You need ongoing revenue to build

| Split | Percentage | Purpose |
|-------|------------|---------|
| Fee Rate | 2% | Standard fee |
| Creator | 30% | Your development fund |
| Buybacks | 25% | Some price support |
| Staking | 35% | Holder rewards |
| Protocol | 10% | Earn's cut |

**Best for:** Agent projects with roadmaps, teams that need funding, utility tokens

**What happens:** You get 30% of all fees automatically. At $100K daily volume with 2% fee = $600/day to your wallet. Build without selling your own tokens.

---

### 🏛️ `community` - DAO-Style Governance
**Use when:** Your community should own the project

| Split | Percentage | Purpose |
|-------|------------|---------|
| Fee Rate | 2% | Standard fee |
| Staking | 50% | Maximum holder rewards |
| Buybacks | 20% | Moderate price support |
| Creator | 20% | Modest creator cut |
| Protocol | 10% | Earn's cut |

**Best for:** Community tokens, DAOs, projects where decentralization matters

**What happens:** Stakers earn 50% of all fees. Encourages long-term holding and governance participation. Your community becomes invested stakeholders.

---

## Complete Integration Example

### Step 1: Register Token

```typescript
import { EarnSDK } from '@earn-protocol/sdk';

const earn = new EarnSDK({
  network: 'mainnet-beta',  // or 'devnet'
  creatorWallet: 'YOUR_WALLET',
});

// Register with template
const result = await earn.registerToken({
  tokenMint: 'YOUR_TOKEN_MINT_ADDRESS',
  template: 'community',  // or 'degen', 'creator'
});

console.log('Registered!', result);
// {
//   tokenMint: "...",
//   stakingPool: "...",
//   treasury: "...",
//   feePercent: 2,
//   template: "community"
// }
```

### Step 2: Execute Swaps Through Earn (Fee Collection)

```typescript
// When your users trade, route through Earn for automatic fee collection
const swapResult = await earn.swap({
  tokenMint: 'YOUR_TOKEN',
  inputMint: 'So11111111111111111111111111111111111111112', // SOL
  outputMint: 'YOUR_TOKEN',
  amount: 1000000000, // 1 SOL in lamports
  userPublicKey: 'USER_WALLET',
  slippageBps: 100, // 1%
});

// Returns unsigned transaction for user to sign
// Includes: Jupiter swap + automatic fee distribution
```

### Step 3: Staking Integration

```typescript
// Let users stake tokens
const stakeResult = await earn.stake({
  tokenMint: 'YOUR_TOKEN',
  amount: 1000000, // tokens to stake
  userWallet: 'USER_WALLET',
});

// Check pending rewards
const rewards = await earn.getRewards({
  tokenMint: 'YOUR_TOKEN',
  wallet: 'USER_WALLET',
});
console.log('Pending rewards:', rewards.pendingRewards);

// Claim rewards
const claimResult = await earn.claimRewards({
  tokenMint: 'YOUR_TOKEN',
  userWallet: 'USER_WALLET',
});
```

### Step 4: Monitoring (Agent-Friendly)

```typescript
// Get all stats for your token
const stats = await earn.getTokenStats('YOUR_TOKEN');

console.log({
  totalFeesCollected: stats.fees.totalCollected,
  creatorEarnings: stats.fees.creatorEarnings,
  totalStaked: stats.staking.totalStaked,
  stakerCount: stats.staking.stakerCount,
  buybacksExecuted: stats.buybacks.totalExecuted,
});

// Check specific user's position
const position = await earn.getStakePosition('YOUR_TOKEN', 'USER_WALLET');
console.log({
  stakedAmount: position.stakedAmount,
  pendingRewards: position.pendingRewards,
  stakedAt: position.stakedAt,
});
```

---

## API Reference

### Base URL
```
https://earn-protocol.onrender.com
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/earn/register` | Register token with Earn |
| GET | `/earn/templates` | List available templates |
| GET | `/earn/tokens` | List all registered tokens |
| GET | `/earn/token/:mint/stats` | Get token statistics |
| POST | `/earn/swap` | Build swap + fee transaction |
| GET | `/earn/swap/quote` | Get swap quote with fee preview |
| POST | `/earn/stake` | Build stake transaction |
| POST | `/earn/unstake` | Build unstake transaction |
| POST | `/earn/claim` | Build claim rewards transaction |
| GET | `/earn/stake/:mint/:wallet` | Get stake position |
| GET | `/earn/rewards/:mint/:wallet` | Get pending rewards |

### Authentication

Most read endpoints are public. Write endpoints require:
```
x-creator-wallet: YOUR_WALLET_ADDRESS
```

For idempotent operations (retries safe):
```
x-idempotency-key: unique-request-id
```

---

## What Can This Token Do That Pump.fun Can't?

| Capability | Pump.fun | Earn Protocol |
|------------|----------|---------------|
| Trading | ✅ | ✅ |
| Automatic fee collection | ❌ | ✅ |
| Staking rewards | ❌ | ✅ |
| Buyback mechanism | ❌ | ✅ |
| Creator revenue | ❌ | ✅ |
| On-chain governance | ❌ | 🔜 |
| Vesting schedules | ❌ | 🔜 |
| Verifiable tokenomics | ❌ | ✅ |

**The difference:** Pump.fun tokens are pure speculation. Earn Protocol tokens have economic structure that creates real incentives for holding, participating, and building.

---

## Framework Integration Examples

### LangChain

```python
from langchain.tools import Tool
from earn_protocol import EarnClient

earn = EarnClient(creator_wallet="YOUR_WALLET")

# Define tools for your agent
tools = [
    Tool(
        name="register_token",
        description="Register a token with Earn Protocol tokenomics",
        func=lambda mint: earn.register(mint, template="community")
    ),
    Tool(
        name="check_staking",
        description="Check staking stats for a token",
        func=lambda mint: earn.get_stats(mint)
    ),
    Tool(
        name="check_rewards",
        description="Check pending rewards for a wallet",
        func=lambda args: earn.get_rewards(args["mint"], args["wallet"])
    ),
]
```

### AutoGPT / OpenClaw

```yaml
# In your agent's tools config
tools:
  earn_protocol:
    register:
      endpoint: https://earn-protocol.onrender.com/earn/register
      method: POST
      headers:
        x-creator-wallet: ${CREATOR_WALLET}
    stats:
      endpoint: https://earn-protocol.onrender.com/earn/token/{mint}/stats
      method: GET
    rewards:
      endpoint: https://earn-protocol.onrender.com/earn/rewards/{mint}/{wallet}
      method: GET
```

---

## End-to-End Demo: Agent Launches Token

```typescript
// 1. Agent decides to launch a token
const tokenMint = "DEMO_TOKEN_MINT"; // From pump.fun or your own mint

// 2. Agent picks template based on goals
const template = "community"; // Agent wants community governance

// 3. Register with Earn Protocol
const registration = await fetch('https://earn-protocol.onrender.com/earn/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-creator-wallet': agentWallet,
  },
  body: JSON.stringify({
    tokenMint,
    template,
  }),
});

// 4. Announce to community
const announcement = `
🚀 $DEMO Token is live with REAL tokenomics!

📊 Powered by @EarnProtocol:
• 2% fee on trades
• 50% to staking rewards (hold & earn)
• 20% to buybacks (price support)
• 20% to development
• Verifiable on-chain

Stake your tokens: https://earn.supply/stake/${tokenMint}
`;

// 5. Monitor performance
setInterval(async () => {
  const stats = await fetch(`https://earn-protocol.onrender.com/earn/token/${tokenMint}/stats`);
  const data = await stats.json();
  
  console.log(`
    Total fees: ${data.fees.totalCollected}
    Stakers: ${data.staking.stakerCount}
    Total staked: ${data.staking.totalStaked}
    Buybacks executed: ${data.buybacks.totalExecuted}
  `);
}, 60000); // Every minute
```

---

## Why Agents Should Care

1. **Credibility**: "My token has Earn Protocol tokenomics" is verifiable on-chain
2. **Sustainability**: Creator fees fund ongoing development without dumping tokens
3. **Community trust**: Staking rewards + buybacks align incentives
4. **Simplicity**: One API call vs. building custom smart contracts
5. **Composability**: Works with Jupiter, Raydium, any Solana DEX

**Structure creates potential. Earn Protocol provides the structure.**

---

## Support

- GitHub: https://github.com/earn-ai/earn-protocol
- Website: https://earn.supply
- API Status: https://earn-protocol.onrender.com/health
