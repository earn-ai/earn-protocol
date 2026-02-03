# Earn Protocol - Agent Skill

**Deploy your own tokenomics infrastructure. No dependencies. You own everything.**

This skill teaches you to:
1. Deploy the Earn Protocol Anchor program
2. Register tokens with fee structures
3. Initialize staking pools
4. Collect fees from Jupiter swaps
5. Distribute rewards to stakers
6. Query all on-chain state

---

## Prerequisites

```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.29.0
avm use 0.29.0

# Install dependencies
npm install @solana/web3.js @coral-xyz/anchor @solana/spl-token
```

---

## 1. Deploy Your Own Program

Clone and deploy:

```bash
git clone https://github.com/earn-ai/earn-protocol
cd earn-protocol

# Set your keypair
solana config set --keypair ~/.config/solana/id.json
solana config set --url devnet  # or mainnet-beta

# Build and deploy
anchor build
anchor deploy

# Save your program ID
echo "Program ID: $(solana address -k target/deploy/earn_protocol-keypair.json)"
```

Update `Anchor.toml` and `lib.rs` with your program ID:

```toml
# Anchor.toml
[programs.devnet]
earn_protocol = "YOUR_PROGRAM_ID"
```

```rust
// lib.rs
declare_id!("YOUR_PROGRAM_ID");
```

---

## 2. Initialize Protocol (One-time Setup)

```typescript
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { IDL } from './target/types/earn_protocol';

const connection = new Connection('https://api.devnet.solana.com');
const wallet = new Wallet(YOUR_KEYPAIR);
const provider = new AnchorProvider(connection, wallet, {});
const program = new Program(IDL, YOUR_PROGRAM_ID, provider);

// Initialize master treasury (your protocol's revenue account)
async function initializeProtocol() {
  const [masterTreasury] = PublicKey.findProgramAddressSync(
    [Buffer.from('earn_master')],
    program.programId
  );

  await program.methods
    .initializeMasterTreasury()
    .accounts({
      authority: wallet.publicKey,
      earnMasterTreasury: masterTreasury,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log('Protocol initialized. Master treasury:', masterTreasury.toBase58());
}
```

---

## 3. Register a Token

```typescript
interface TokenConfig {
  feeBps: number;        // Fee on trades (200 = 2%)
  earnCutBps: number;    // Your protocol cut (1000 = 10%)
  creatorCutBps: number; // Creator cut (2000 = 20%)
  buybackCutBps: number; // Buyback allocation (3500 = 35%)
  stakingCutBps: number; // Staking rewards (3500 = 35%)
}

async function registerToken(
  tokenMint: PublicKey,
  creator: PublicKey,
  config: TokenConfig
) {
  // Derive PDAs
  const [tokenConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_config'), tokenMint.toBuffer()],
    program.programId
  );
  
  const [treasury] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury'), tokenMint.toBuffer()],
    program.programId
  );
  
  const [stakingPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool'), tokenMint.toBuffer()],
    program.programId
  );

  await program.methods
    .registerToken(
      config.feeBps,
      config.earnCutBps,
      config.creatorCutBps,
      config.buybackCutBps,
      config.stakingCutBps
    )
    .accounts({
      creator,
      tokenMint,
      tokenConfig,
      treasury,
      stakingPool,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log('Token registered!');
  console.log('  Config PDA:', tokenConfig.toBase58());
  console.log('  Treasury PDA:', treasury.toBase58());
  console.log('  Staking Pool PDA:', stakingPool.toBase58());
  
  return { tokenConfig, treasury, stakingPool };
}

// Templates for quick setup
const TEMPLATES = {
  degen: { feeBps: 300, earnCutBps: 1000, creatorCutBps: 1000, buybackCutBps: 5000, stakingCutBps: 3000 },
  creator: { feeBps: 200, earnCutBps: 1000, creatorCutBps: 3000, buybackCutBps: 3000, stakingCutBps: 3000 },
  community: { feeBps: 200, earnCutBps: 1000, creatorCutBps: 1000, buybackCutBps: 3000, stakingCutBps: 5000 },
};

// Usage
await registerToken(
  new PublicKey('YOUR_TOKEN_MINT'),
  wallet.publicKey,
  TEMPLATES.community
);
```

---

## 4. Collect Fees from Jupiter Swaps

The key insight: wrap Jupiter swaps with fee collection.

```typescript
import { Jupiter } from '@jup-ag/core';

async function swapWithFees(
  tokenMint: PublicKey,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: number,
  userWallet: PublicKey
) {
  // 1. Get token config for fee calculation
  const [tokenConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_config'), tokenMint.toBuffer()],
    program.programId
  );
  const config = await program.account.tokenConfig.fetch(tokenConfigPDA);
  
  // 2. Get Jupiter quote
  const jupiter = await Jupiter.load({ connection, user: userWallet });
  const routes = await jupiter.computeRoutes({
    inputMint,
    outputMint,
    amount,
    slippageBps: 100,
  });
  
  const bestRoute = routes.routesInfos[0];
  
  // 3. Calculate fee from output
  const outputAmount = BigInt(bestRoute.outAmount);
  const feeBps = config.feeBps;
  const totalFee = (outputAmount * BigInt(feeBps)) / 10000n;
  
  // 4. Build atomic transaction: Jupiter swap + fee collection
  const { swapTransaction } = await jupiter.exchange({ routeInfo: bestRoute });
  
  // 5. Add fee collection instruction
  const feeInstruction = await program.methods
    .collectFeeFromSwap(totalFee)
    .accounts({
      tokenMint,
      tokenConfig: tokenConfigPDA,
      userTokenAccount: getAssociatedTokenAddress(tokenMint, userWallet),
      treasuryTokenAccount: getTreasuryTokenAccount(tokenMint),
      stakingRewardsAccount: getStakingRewardsAccount(tokenMint),
      creatorTokenAccount: getCreatorTokenAccount(config.creator, tokenMint),
      earnTokenAccount: getEarnTokenAccount(tokenMint),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  
  // 6. Combine into single atomic transaction
  const transaction = new Transaction();
  transaction.add(...swapTransaction.instructions);
  transaction.add(feeInstruction);
  
  return transaction;
}
```

---

## 5. Staking System

### Initialize Staking Pool (done during registerToken)

The staking pool is created automatically when you register a token.

### User Stakes Tokens

```typescript
async function stake(
  tokenMint: PublicKey,
  userWallet: PublicKey,
  amount: bigint
) {
  const [stakingPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool'), tokenMint.toBuffer()],
    program.programId
  );
  
  const [stakeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake'), tokenMint.toBuffer(), userWallet.toBuffer()],
    program.programId
  );

  await program.methods
    .stake(amount)
    .accounts({
      staker: userWallet,
      tokenMint,
      stakingPool,
      stakeAccount,
      stakerTokenAccount: getAssociatedTokenAddress(tokenMint, userWallet),
      stakingTokenAccount: getStakingTokenAccount(tokenMint),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}
```

### User Unstakes + Claims Rewards

```typescript
async function unstake(
  tokenMint: PublicKey,
  userWallet: PublicKey,
  amount: bigint
) {
  const [stakingPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool'), tokenMint.toBuffer()],
    program.programId
  );
  
  const [stakeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake'), tokenMint.toBuffer(), userWallet.toBuffer()],
    program.programId
  );

  // Unstake returns tokens + any pending rewards
  await program.methods
    .unstake(amount)
    .accounts({
      staker: userWallet,
      tokenMint,
      stakingPool,
      stakeAccount,
      stakerTokenAccount: getAssociatedTokenAddress(tokenMint, userWallet),
      stakingTokenAccount: getStakingTokenAccount(tokenMint),
      rewardsTokenAccount: getRewardsTokenAccount(tokenMint),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}
```

### Calculate Pending Rewards

```typescript
async function getPendingRewards(
  tokenMint: PublicKey,
  userWallet: PublicKey
): Promise<bigint> {
  const [stakingPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool'), tokenMint.toBuffer()],
    program.programId
  );
  
  const [stakeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake'), tokenMint.toBuffer(), userWallet.toBuffer()],
    program.programId
  );

  const pool = await program.account.stakingPool.fetch(stakingPool);
  const stake = await program.account.stakeAccount.fetch(stakeAccount);
  
  // Reward calculation: (stakedAmount * (currentRewardPerToken - paidRewardPerToken)) / PRECISION
  const PRECISION = 1_000_000_000_000_000_000n; // 1e18
  const rewardPerTokenDelta = pool.rewardPerTokenStored - stake.rewardPerTokenPaid;
  const newRewards = (stake.stakedAmount * rewardPerTokenDelta) / PRECISION;
  
  return stake.pendingRewards + newRewards;
}
```

---

## 6. Query On-Chain State

```typescript
// Get token config
async function getTokenConfig(tokenMint: PublicKey) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_config'), tokenMint.toBuffer()],
    program.programId
  );
  return program.account.tokenConfig.fetch(pda);
}

// Get treasury stats
async function getTreasury(tokenMint: PublicKey) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury'), tokenMint.toBuffer()],
    program.programId
  );
  return program.account.treasury.fetch(pda);
}

// Get staking pool stats
async function getStakingPool(tokenMint: PublicKey) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool'), tokenMint.toBuffer()],
    program.programId
  );
  return program.account.stakingPool.fetch(pda);
}

// Get user's stake position
async function getStakePosition(tokenMint: PublicKey, userWallet: PublicKey) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake'), tokenMint.toBuffer(), userWallet.toBuffer()],
    program.programId
  );
  return program.account.stakeAccount.fetch(pda);
}

// List all registered tokens
async function getAllTokens() {
  return program.account.tokenConfig.all();
}

// Get all stakers for a token
async function getStakers(tokenMint: PublicKey) {
  return program.account.stakeAccount.all([
    {
      memcmp: {
        offset: 8 + 32, // After discriminator + owner
        bytes: tokenMint.toBase58(),
      },
    },
  ]);
}
```

---

## 7. Execute Buybacks

```typescript
async function executeBuyback(
  tokenMint: PublicKey,
  amount: bigint,
  minTokensOut: bigint
) {
  const [treasury] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury'), tokenMint.toBuffer()],
    program.programId
  );

  await program.methods
    .executeBuyback(amount, minTokensOut)
    .accounts({
      executor: wallet.publicKey, // Permissionless - anyone can trigger
      tokenMint,
      tokenConfig: getTokenConfigPDA(tokenMint),
      treasury,
      tokensToBurn: getTreasuryTokenAccount(tokenMint),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}
```

---

## Complete Integration: Agent Token Launch

```typescript
/**
 * Full flow: Agent launches token and adds Earn Protocol structure
 */
async function launchStructuredToken(
  tokenMint: PublicKey,
  template: 'degen' | 'creator' | 'community' = 'community'
) {
  const config = TEMPLATES[template];
  
  console.log('🚀 Launching structured token...');
  
  // 1. Register with Earn Protocol
  const { tokenConfig, treasury, stakingPool } = await registerToken(
    tokenMint,
    wallet.publicKey,
    config
  );
  
  console.log('✅ Token registered');
  console.log('   Fee:', config.feeBps / 100, '%');
  console.log('   Staking rewards:', config.stakingCutBps / 100, '%');
  console.log('   Buybacks:', config.buybackCutBps / 100, '%');
  
  // 2. Return everything the agent needs
  return {
    tokenMint: tokenMint.toBase58(),
    pdas: {
      tokenConfig: tokenConfig.toBase58(),
      treasury: treasury.toBase58(),
      stakingPool: stakingPool.toBase58(),
    },
    config,
    
    // Helper functions the agent can use
    swap: (input, output, amount, user) => swapWithFees(tokenMint, input, output, amount, user),
    stake: (user, amount) => stake(tokenMint, user, amount),
    unstake: (user, amount) => unstake(tokenMint, user, amount),
    getRewards: (user) => getPendingRewards(tokenMint, user),
    getStats: () => getStakingPool(tokenMint),
    executeBuyback: (amount, minOut) => executeBuyback(tokenMint, amount, minOut),
  };
}

// Usage
const myToken = await launchStructuredToken(
  new PublicKey('MY_TOKEN_MINT'),
  'community'
);

// Now agent has full control:
await myToken.stake(userWallet, 1000000n);
const rewards = await myToken.getRewards(userWallet);
console.log('Pending rewards:', rewards);
```

---

## File Structure

```
earn-protocol/
├── programs/earn-protocol/
│   └── src/
│       ├── lib.rs              # Program entry
│       ├── state.rs            # Account structures
│       ├── errors.rs           # Error codes
│       └── instructions/
│           ├── register.rs     # Token registration
│           ├── stake.rs        # Staking
│           ├── unstake.rs      # Unstaking + rewards
│           ├── claim.rs        # Claim rewards only
│           ├── collect_fee.rs  # Fee collection
│           └── buyback.rs      # Buyback execution
├── src/
│   ├── client.ts               # TypeScript client
│   └── types.ts                # Type definitions
├── tests/
│   └── earn-protocol.ts        # Integration tests
├── Anchor.toml
└── SKILL.md                    # This file
```

---

## Security Notes

1. **Reentrancy Protection**: Stake accounts have `is_locked` field
2. **Balance Checks**: Rewards capped to available balance
3. **Mint Validation**: Rewards account must match token mint
4. **Cooldowns**: 1 hour between buybacks
5. **Slippage Protection**: `min_tokens_out` enforced on buybacks

---

## You Own Everything

Once deployed:
- ✅ Your program ID
- ✅ Your PDAs
- ✅ Your treasury
- ✅ Your staking pools
- ✅ Your fee revenue

No dependency on any external service. Pure on-chain infrastructure.

---

## Need Help?

- GitHub: https://github.com/earn-ai/earn-protocol
- Docs: https://earn.supply/docs
- Example deployment: See `tests/earn-protocol.ts`
