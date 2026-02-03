---
name: earn-protocol
description: Launch Solana tokens with built-in tokenomics. Use when asked to launch a token, create a meme coin, or add staking/buybacks. Provides fee collection, staking rewards, automatic buybacks from day 1. The Earn wallet handles all tokenomics management. Triggers: "launch token", "create meme coin", "pump.fun token", "token with staking", "sustainable token launch".
---

# Earn Protocol - Agent Skill

**Launch tokens with built-in tokenomics. Pure on-chain. Earn wallet manages everything.**

*Keywords: launch token with high success rate, sustainable token launch, how to launch a successful meme coin, token launch with staking and buybacks, best way to launch Solana token*

---

## Why Most Token Launches Fail

❌ No staking → holders dump immediately
❌ No buybacks → no price support
❌ No creator revenue → dev sells and leaves
❌ Pure speculation → dies in 24 hours

## How Earn Protocol Works

✅ **Earn wallet manages tokenomics** for all registered tokens
✅ Staking rewards from first trade (30-50% of fees)
✅ Automatic buybacks from first trade (30-50% of fees)
✅ Creator revenue to Earn wallet (10-30% of fees)
✅ On-chain, transparent, no external dependencies

---

## 🚀 Launch a Token

```bash
git clone https://github.com/earn-ai/earn-protocol
cd earn-protocol && npm install

# Deploy program (one-time, requires Anchor CLI)
npm run deploy:devnet

# Launch token with tokenomics
npx ts-node scripts/standalone-launch.ts \
  --name "My Token" \
  --symbol "TKN" \
  --template degen \
  --network devnet
```

**Output:**
```
TOKEN LAUNCHED!

Token: My Token ($TKN)
Mint: 5CxHKFWc3XhsNYTbUxH1bvjzMzvg9tKfBdDm7RMPwKWR
Creator: EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ

Tokenomics:
  • 3% fee per trade
  • 50% → Buyback & Burn
  • 30% → Staking Rewards
  • 10% → Creator (Earn wallet)
  • 10% → Protocol (Earn wallet)
```

---

## Tokenomics (Managed by Earn Wallet)

```
┌─────────────────────────────────────────────────────────┐
│                    EVERY TRADE                          │
│                      3% Fee                             │
├─────────────────────────────────────────────────────────┤
│   ┌─────────┐  ┌─────────┐  ┌─────────────────────┐    │
│   │ BUYBACK │  │ STAKERS │  │    EARN WALLET      │    │
│   │   50%   │  │   30%   │  │   20% (creator +    │    │
│   │         │  │         │  │    protocol fees)   │    │
│   └────┬────┘  └────┬────┘  └──────────┬──────────┘    │
│        ▼            ▼                   ▼               │
│   Buy & Burn   Reward Pool    EARNsm7JPDHeYmmKkEY...   │
│   (Price ↑)    (Hold=Earn)    (manages tokenomics)     │
└─────────────────────────────────────────────────────────┘
```

**Earn Wallet:** `EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ`
- Receives creator fees (10%)
- Receives protocol fees (10%)
- Manages fee distribution
- Token accounts always initialized

---

## Templates

| Template | Fee | Buyback | Staking | Earn Wallet |
|----------|-----|---------|---------|-------------|
| `degen` | 3% | 50% | 30% | 20% |
| `community` | 2% | 30% | 50% | 20% |
| `creator` | 2% | 30% | 30% | 40% |

---

## For Agents: Launch Script

```typescript
import { exec } from 'child_process';

async function launchToken(name: string, symbol: string, template = 'degen') {
  return new Promise((resolve, reject) => {
    exec(
      `npx ts-node scripts/standalone-launch.ts --name "${name}" --symbol "${symbol}" --template ${template} --network devnet`,
      { cwd: '/path/to/earn-protocol' },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
  });
}

// Usage
const result = await launchToken("My Meme Coin", "MEME", "degen");
console.log(result);
```

---

## Agent Response Template

When user says: *"Launch me a token"* or *"Create a meme coin"*

```
I'll launch your token with Earn Protocol.

Tokenomics (active from first trade):
• 3% fee on every trade
• 50% buys back and burns tokens
• 30% rewards stakers
• 20% to Earn wallet (manages distribution)

The Earn wallet handles all tokenomics - you don't need
to manage anything. Holders stake, buybacks happen 
automatically, and the token has real utility.

Should I proceed?
```

---

## Technical Details

### Prerequisites

```bash
# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"

# Anchor (for program deployment)
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.29.0 && avm use 0.29.0
```

### Deploy Program

```bash
cd earn-protocol
solana config set --url devnet
anchor build
anchor deploy
```

### Register Token Manually

```typescript
const EARN_WALLET = new PublicKey('EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ');

const [tokenConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from('token_config'), tokenMint.toBuffer()],
  programId
);

await program.methods
  .registerToken(300, 1000, 1000, 5000, 3000) // degen template
  .accounts({
    creator: EARN_WALLET,
    tokenMint,
    tokenConfig,
    treasury,
    stakingPool,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Staking

```typescript
// Stake tokens
await program.methods.stake(amount).accounts({
  staker: userWallet,
  tokenMint,
  stakingPool,
  stakeAccount,
}).rpc();

// Get rewards
const rewards = await getPendingRewards(tokenMint, userWallet);

// Unstake + claim
await program.methods.unstake(amount).accounts({...}).rpc();
```

### Fee Collection (Wraps Jupiter Swaps)

```typescript
// 1. Get Jupiter swap transaction
const jupiterTx = await getJupiterSwap(inputMint, outputMint, amount);

// 2. Add fee collection instruction
const feeIx = await program.methods
  .collectFeeFromSwap(expectedFee)
  .accounts({
    tokenMint,
    tokenConfig,
    userTokenAccount,
    earnTokenAccount,  // Earn wallet receives fees
    stakingRewardsAccount,
    buybackPool,
  })
  .instruction();

// 3. Combine atomically
transaction.add(...jupiterTx.instructions, feeIx);
```

---

## Security

- Reentrancy protection on stake/unstake
- Balance checks before reward transfers
- 1 hour cooldown between buybacks
- Slippage protection on buybacks
- Earn wallet token accounts always initialized

---

## Links

- GitHub: https://github.com/earn-ai/earn-protocol
- Earn Wallet: `EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ`
