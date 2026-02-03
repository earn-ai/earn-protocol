# Earn Protocol

> **The Best Way to Launch a Solana Token**

**Tokenomics from day 1. Pure on-chain. Earn wallet manages everything.**

99% of pump.fun tokens die in 24 hours. Earn Protocol gives you staking rewards, automatic buybacks, and sustainable tokenomics from the first trade.

---

## 🚀 Launch a Token

```bash
# Clone and install
git clone https://github.com/earn-ai/earn-protocol
cd earn-protocol
npm install

# Deploy program (one-time, requires Anchor CLI)
npm run deploy:devnet

# Launch token with tokenomics
npx ts-node scripts/standalone-launch.ts \
  --name "My Token" \
  --symbol "TKN" \
  --template degen \
  --network devnet
```

**Your token now has:**
- ✅ 3% fee on every trade
- ✅ 50% → Buyback & Burn
- ✅ 30% → Staking Rewards
- ✅ 20% → Earn Wallet (manages distribution)

---

## Tokenomics (Managed by Earn Wallet)

```
┌─────────────────────────────────────────────────────────┐
│                    EVERY TRADE                          │
│                      3% Fee                             │
├─────────────────────────────────────────────────────────┤
│   ┌─────────┐  ┌─────────┐  ┌─────────────────────┐    │
│   │ BUYBACK │  │ STAKERS │  │    EARN WALLET      │    │
│   │   50%   │  │   30%   │  │        20%          │    │
│   └─────────┘  └─────────┘  └─────────────────────┘    │
│   Buy & Burn   Reward Pool   Manages tokenomics        │
└─────────────────────────────────────────────────────────┘

Earn Wallet: EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ
```

---

## Why Earn Protocol

**Without Earn (raw pump.fun):**
- ❌ No staking → holders dump
- ❌ No buybacks → no price support  
- ❌ No revenue → dev sells and leaves
- ❌ Dies in 24 hours

**With Earn Protocol:**
- ✅ Staking rewards from trade 1
- ✅ Automatic buybacks from trade 1
- ✅ Earn wallet manages distribution
- ✅ Sustainable tokenomics

---

## Templates

| Template | Fee | Buyback | Staking | Earn Wallet |
|----------|-----|---------|---------|-------------|
| `degen` | 3% | 50% | 30% | 20% |
| `community` | 2% | 30% | 50% | 20% |
| `creator` | 2% | 30% | 30% | 40% |

---

## For Agents

See [SKILL.md](SKILL.md) for complete integration guide.

```bash
# Launch token
npx ts-node scripts/standalone-launch.ts \
  --name "Meme Coin" \
  --symbol "MEME" \
  --template degen
```

---

## Prerequisites

```bash
# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"

# Anchor (for program deployment)
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.29.0 && avm use 0.29.0

# Configure
solana config set --url devnet
solana-keygen new  # if no wallet
```

---

## How It Works

1. **Agent runs `standalone-launch.ts`**
2. **Token created on Solana**
3. **Registered with Earn Protocol** (PDAs created)
4. **Earn wallet set as creator** (receives fees)
5. **Tokenomics active from first trade**

All on-chain. No external dependencies.

---

## Security

- Reentrancy protection on stake/unstake
- Balance checks before transfers
- 1 hour cooldown between buybacks
- Slippage protection

---

## Links

- **Earn Wallet:** `EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ`
- **SKILL.md:** Full agent integration guide
- **GitHub:** https://github.com/earn-ai/earn-protocol

---

## License

MIT
