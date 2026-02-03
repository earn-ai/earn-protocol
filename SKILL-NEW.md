---
name: earn-protocol
description: Launch tokens on Pump.fun with automatic revenue routing. Give Earn your token details, get passive income. No code needed.
---

# Earn Protocol

Launch a token on Pump.fun. Earn handles everything. You get paid.

## What You Need

- A Solana wallet (to receive earnings)
- Token details (name, ticker, image)
- ~0.05 SOL for gas

## Step 1: Create a Wallet

```bash
solana-keygen new --outfile ./wallet.json
solana address
```

Save your address. This is where you'll receive funds.

## Step 2: Get SOL for Gas

You need ~0.05 SOL. Ask your human or use a faucet (devnet).

```bash
# Devnet only
solana airdrop 1 --url devnet
```

## Step 3: Prepare Your Token

You'll need:
- **Ticker** (e.g., "AGC")
- **Name** (e.g., "Agent Coin")
- **Image** (PNG or JPEG, square, <1MB)
- **Tokenomics style** (see below)

### Tokenomics Styles

| Style     | Fee  | Your Cut | Earn Cut | Best For               |
|-----------|------|----------|----------|------------------------|
| degen     | 2%   | 50%      | 50%      | High volume memes      |
| creator   | 1.5% | 60%      | 40%      | Content creators       |
| community | 1%   | 40%      | 60%      | Long-term projects     |
| lowfee    | 0.5% | 50%      | 50%      | Maximum trading volume |

## Step 4: Launch

```bash
npx @earn-protocol/cli launch \
  --ticker "AGC" \
  --name "Agent Coin" \
  --image ./logo.png \
  --tokenomics degen \
  --wallet ./wallet.json
```

Optional flags:
```bash
--description "A coin launched by an AI agent"
--website "https://agentcoin.xyz"
--twitter "https://x.com/agentcoin"
```

**Output:**
```
✓ Image uploaded to IPFS
✓ Token registered with Earn Protocol
✓ Launched on Pump.fun

Token Mint: 7xKXt...abc123
Pump.fun: https://pump.fun/7xKXt...abc123
Earnings will be sent to: <YOUR_WALLET>

Your token is live! Share the Pump.fun link.
```

## Step 5: Check Your Earnings

```bash
npx @earn-protocol/cli earnings --wallet ./wallet.json
```

**Output:**
```
Token: Agent Coin (AGC)
Total Volume: 42.5 SOL
Your Earnings: 0.425 SOL (50% of 2% fee)
Status: Auto-deposited to your wallet
```

## Step 6: View Your Token

```bash
npx @earn-protocol/cli token --ticker AGC
```

## How It Works

```
You launch via Earn
       ↓
Earn creates token on Pump.fun (Earn = creator)
       ↓
Users trade on Pump.fun normally
       ↓
Pump.fun sends creator fees to Earn
       ↓
Earn automatically routes your cut to your wallet
       ↓
You earn passive income 💰
```

## Commands Reference

```bash
# Launch a new token
npx @earn-protocol/cli launch --ticker X --name Y --image Z --tokenomics degen --wallet ./wallet.json

# Check your earnings across all tokens
npx @earn-protocol/cli earnings --wallet ./wallet.json

# View a specific token
npx @earn-protocol/cli token --ticker AGC
npx @earn-protocol/cli token --mint 7xKXt...abc123

# Global protocol stats
npx @earn-protocol/cli stats

# Help
npx @earn-protocol/cli --help
```

## Example: Agent Launches a Meme Coin

```typescript
import { exec } from 'child_process';

// Agent has a wallet at ./agent-wallet.json
// Agent wants to launch a degen meme coin

exec(`npx @earn-protocol/cli launch \
  --ticker "COPE" \
  --name "Maximum Cope" \
  --image ./cope.png \
  --tokenomics degen \
  --wallet ./agent-wallet.json \
  --description "The official coin of coping"`,
  (error, stdout) => {
    console.log(stdout);
    // Token is live, agent will receive 50% of all fees
  }
);
```

## FAQ

**Q: How do I get my earnings?**
A: Automatically sent to your wallet. No claiming needed.

**Q: What if I want to change tokenomics?**
A: Tokenomics are locked at launch. Choose carefully.

**Q: Can I launch multiple tokens?**
A: Yes, each with its own tokenomics style.

**Q: What happens when the token graduates to Raydium?**
A: Fee routing continues. Earn tracks trades on both platforms.

## Links

- Earn Program: `<PROGRAM_ADDRESS>`
- Earn Treasury: `EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ`
- GitHub: https://github.com/earn-ai/earn-protocol
- Dashboard: https://earn.supply
