# @earn-protocol/cli

Launch tokens on Pump.fun with automatic revenue routing.

## Installation

```bash
npm i -g @earn-protocol/cli
# or
npx @earn-protocol/cli <command>
```

## Commands

### `launch` - Launch a new token

```bash
earn-cli launch \
  --ticker "AGC" \
  --name "Agent Coin" \
  --image ./logo.png \
  --tokenomics degen \
  --wallet ./wallet.json \
  [--description "..."] \
  [--website "https://..."] \
  [--twitter "https://x.com/..."] \
  [--network mainnet|devnet]
```

**What happens:**
1. Validates inputs
2. Uploads image to IPFS
3. Registers token with Earn Protocol (stores your wallet + tokenomics)
4. Calls Pump.fun to create the token
5. Returns mint address + Pump.fun link

### `earnings` - Check your earnings

```bash
earn-cli earnings --wallet ./wallet.json
```

Shows all tokens you've launched and your accumulated earnings.

### `token` - View token info

```bash
earn-cli token --ticker AGC
# or
earn-cli token --mint 7xKXt...abc123
```

### `stats` - Global protocol stats

```bash
earn-cli stats
```

Shows: total launches, total volume, total paid to agents.

### `claim` - Claim pending earnings (if not auto-sent)

```bash
earn-cli claim --wallet ./wallet.json
```

## Tokenomics Styles

| Style       | Fee  | Agent Cut | Earn Cut |
|-------------|------|-----------|----------|
| `degen`     | 2%   | 50%       | 50%      |
| `creator`   | 1.5% | 60%       | 40%      |
| `community` | 1%   | 40%       | 60%      |
| `lowfee`    | 0.5% | 50%       | 50%      |

## Environment Variables

```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
EARN_PROGRAM_ID=<program_address>
```

## Programmatic Usage

```typescript
import { EarnCLI } from '@earn-protocol/cli';

const cli = new EarnCLI({
  wallet: './wallet.json',
  network: 'mainnet'
});

// Launch a token
const result = await cli.launch({
  ticker: 'AGC',
  name: 'Agent Coin',
  image: './logo.png',
  tokenomics: 'degen',
  description: 'A coin by an AI agent'
});

console.log(result.mint); // Token mint address
console.log(result.pumpFunUrl); // https://pump.fun/...

// Check earnings
const earnings = await cli.earnings();
console.log(earnings.total); // 4.2 SOL
```

## How Fee Routing Works

1. You launch via `earn-cli launch`
2. Earn becomes the "creator" on Pump.fun
3. Pump.fun sends ~1% creator fee to Earn
4. Earn routes your cut (based on tokenomics) to your wallet
5. Happens automatically on every trade

## Links

- Earn Protocol: https://github.com/earn-ai/earn-protocol
- Dashboard: https://earn.supply
- SKILL.md: Full agent integration guide
