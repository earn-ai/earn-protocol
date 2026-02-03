# Pump.fun Integration Research

## Executive Summary

**Good news:** Pump.fun has native creator fee routing. We don't need to intercept fees.

**The Play:**
1. Earn calls `create` instruction
2. Earn passes **agent's wallet** as the `creator` param
3. Pump.fun automatically routes creator fees to agent's `creator_vault` PDA
4. Agent claims fees directly from Pump.fun (no Earn middleman)

**Earn's role becomes:**
- Launch service (create tokens for agents)
- Gas subsidy (pay for token creation)
- Discovery/dashboard (track Earn-launched tokens)
- Optionally take a cut by being a co-creator or taking launch fee upfront

---

## How Pump.fun Token Creation Works

### Program Details
- **Program ID:** `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (mainnet + devnet)
- **Official SDK:** `@pump-fun/pump-sdk` (npm)
- **Token Standard:** Token2022 (via `create_v2`) or legacy SPL (via `create`)

### The `create` Instruction

```rust
create(user, name, symbol, uri, creator)
```

**Key Parameters:**
- `user` - The signer who pays for the transaction (can be Earn)
- `name` - Token name (e.g., "Agent Coin")
- `symbol` - Token ticker (e.g., "AGC")
- `uri` - Metadata URI (IPFS/Arweave link to JSON with image)
- `creator` - **The wallet that receives creator fees** (this should be the AGENT)

**Critical Insight:** `user` and `creator` can be different!
> "In general, `user` and `creator` are the same pubkey, but they can be different, for example, on the `free coin creation` flow, when the first coin buyer also creates the coin on-chain."

This means:
- Earn wallet = `user` (pays gas)
- Agent wallet = `creator` (receives fees)

### Token Creation Flow

```
1. Earn receives agent's token request
   - Agent wallet, name, ticker, image

2. Earn uploads metadata
   - Image → IPFS
   - Create metadata JSON with name, symbol, image
   - Upload JSON → IPFS
   - Get URI

3. Earn calls Pump.fun create instruction
   - user: Earn wallet (signer, pays ~0.02 SOL)
   - name: Agent's token name
   - symbol: Agent's ticker
   - uri: IPFS metadata URI
   - creator: Agent's wallet

4. Token is live on Pump.fun
   - Bonding curve initialized
   - Agent's wallet set as creator
   - Trading enabled immediately
```

---

## Creator Fee Mechanism

### How Fees Work

When users trade on Pump.fun:
1. **Protocol fee:** ~1% to Pump.fun
2. **Creator fee:** Variable (set by `Global::creator_fee_basis_points`)

Creator fees accumulate in a **creator_vault** PDA:

```rust
#[account(
    seeds = [
        b"creator-vault",
        bonding_curve.creator.as_ref()
    ],
    bump
)]
pub creator_vault: AccountInfo
```

### Fee Collection

The creator (agent) can claim accumulated fees by calling:
```
collectCreatorFee(creator)
```

The `creator` must sign this transaction.

### Fee Tiers (Dynamic Fees)

Pump.fun uses dynamic fees based on market cap:

| Market Cap | Protocol Fee | Creator Fee |
|------------|--------------|-------------|
| < Tier 1   | X bps        | Y bps       |
| Tier 1-2   | X bps        | Y bps       |
| ...        | ...          | ...         |

(Exact tiers defined in their FeeConfig)

---

## Accounts Required for `create`

| Index | Account | Notes |
|-------|---------|-------|
| 1 | Mint | New token mint (Keypair, signer) |
| 2 | Mint Authority | PDA: `["mint-authority", PUMP_PROGRAM_ID]` |
| 3 | Bonding Curve | PDA: `["bonding-curve", mint, PUMP_PROGRAM_ID]` |
| 4 | Associated Bonding Curve | Token account for bonding curve |
| 5 | Global | PDA: `["global", PUMP_PROGRAM_ID]` |
| 6 | User | Signer (Earn wallet) |
| 7 | System Program | `11111111111111111111111111111111` |
| 8 | Token Program | Token2022 for `create_v2` |
| 9 | Associated Token Program | ATA program |
| 10 | Mayhem Program ID | `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e` |
| 11 | Global Params | PDA from Mayhem program |
| 12 | Sol Vault | PDA from Mayhem program |
| 13 | Mayhem State | PDA: `["mayhem-state", mint, MAYHEM_PROGRAM_ID]` |
| 14 | Mayhem Token Vault | Token2022 account |

### Global Account Address
`4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`

---

## Recommended Integration Approach

### Option A: Use Official SDK (Recommended)

```typescript
import { PumpSdk } from '@pump-fun/pump-sdk';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const pumpSdk = new PumpSdk(connection);

// Earn wallet (pays gas)
const earnWallet = Keypair.fromSecretKey(/* ... */);

// Agent wallet (receives fees)
const agentWallet = new PublicKey('AGENT_WALLET_ADDRESS');

// Create token
const { instructions, mint } = await pumpSdk.createTokenInstructions({
  user: earnWallet.publicKey,
  name: 'Agent Coin',
  symbol: 'AGC',
  uri: 'https://ipfs.io/ipfs/...', // Metadata JSON URI
  creator: agentWallet, // Agent gets the fees!
});

// Sign and send
const tx = new Transaction().add(...instructions);
tx.sign(earnWallet, mint);
await connection.sendTransaction(tx);
```

### Option B: Direct Program Call

If SDK doesn't support `creator` param override, call the program directly:

```typescript
import { Program } from '@coral-xyz/anchor';
import { PUMP_PROGRAM_ID, PUMP_IDL } from './pump-idl';

const program = new Program(PUMP_IDL, PUMP_PROGRAM_ID, provider);

await program.methods
  .create(
    name,
    symbol,
    uri,
    agentWallet // creator
  )
  .accounts({
    mint: mintKeypair.publicKey,
    user: earnWallet.publicKey,
    // ... other accounts
  })
  .signers([earnWallet, mintKeypair])
  .rpc();
```

---

## Metadata Handling

### Metadata JSON Format

```json
{
  "name": "Agent Coin",
  "symbol": "AGC",
  "description": "A coin launched by an AI agent",
  "image": "https://ipfs.io/ipfs/QmXyz.../logo.png",
  "external_url": "https://agentcoin.xyz",
  "attributes": [
    { "trait_type": "Launched By", "value": "Earn Protocol" }
  ]
}
```

### Image Hosting Options

1. **IPFS via NFT.Storage** (Recommended)
   - Free
   - Decentralized
   - Use `nft.storage` npm package

2. **Arweave**
   - Permanent
   - Costs SOL/AR
   - More robust

3. **Pump.fun's storage** (if available)
   - Need to check if their API accepts direct uploads

### Upload Flow

```typescript
import { NFTStorage, File } from 'nft.storage';

const client = new NFTStorage({ token: NFT_STORAGE_KEY });

// Upload image
const imageFile = new File([imageBuffer], 'logo.png', { type: 'image/png' });
const imageCid = await client.storeBlob(imageFile);
const imageUrl = `https://ipfs.io/ipfs/${imageCid}`;

// Upload metadata
const metadata = {
  name: 'Agent Coin',
  symbol: 'AGC',
  image: imageUrl,
  // ...
};
const metadataCid = await client.storeBlob(
  new Blob([JSON.stringify(metadata)], { type: 'application/json' })
);
const metadataUri = `https://ipfs.io/ipfs/${metadataCid}`;
```

---

## Earn's Revenue Model Options

Since Pump.fun routes fees directly to the creator, Earn has options:

### Option 1: Upfront Launch Fee
- Agent pays Earn X SOL to launch
- Simple, no ongoing tracking needed

### Option 2: Split Creator Address
- Use a PDA that Earn controls
- Earn distributes to agent (minus cut)
- More complex, requires ongoing distribution

### Option 3: Earn as Co-Creator
- Some tokens might support multiple creators
- Need to verify if Pump.fun supports this

### Option 4: Gas Subsidy + Discovery Value
- Earn pays gas, gets brand exposure
- Revenue from dashboard/premium features
- Simplest, most agent-friendly

**Recommendation:** Start with Option 1 (upfront fee) or Option 4 (free, subsidized).

---

## What Happens at Graduation?

When a token reaches ~$69k market cap:
1. `BondingCurve::complete` becomes `true`
2. Anyone can call `migrate` instruction
3. Liquidity moves to PumpSwap AMM
4. LP tokens are burned
5. **Creator fees continue** on PumpSwap for "canonical pools"

Canonical pools are pools created by the `migrate` instruction (not manually created pools).

---

## Risks & Blockers

### 1. SDK `creator` Parameter
**Risk:** Official SDK might not expose `creator` override
**Mitigation:** Call program directly if needed

### 2. Gas Costs
**Risk:** Earn needs SOL to pay for creates
**Mitigation:** Charge launch fee or have treasury

### 3. Creator Fee Rate Changes
**Risk:** Pump.fun can change `creator_fee_basis_points`
**Mitigation:** This affects all tokens equally, not Earn-specific

### 4. Token2022 Complexity
**Risk:** `create_v2` uses Token2022, more complex
**Mitigation:** Use official SDK which handles this

### 5. Mayhem Mode
**Risk:** New tokens may have `is_mayhem_mode = true`
**Mitigation:** Follow docs for fee recipient handling

---

## Implementation Checklist

1. [ ] Install `@pump-fun/pump-sdk`
2. [ ] Test on devnet: create token with different `user` and `creator`
3. [ ] Verify creator_vault receives fees
4. [ ] Test `collectCreatorFee` from agent wallet
5. [ ] Implement IPFS upload for metadata
6. [ ] Build earn-cli `launch` command
7. [ ] Test full flow: launch → trade → claim fees
8. [ ] Deploy to mainnet

---

## Key Addresses

```
Pump Program: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
Global Config: 4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf
Mayhem Program: MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e

Earn Treasury: EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ
```

---

## Conclusion

**Pump.fun integration is simpler than expected.**

The native creator fee mechanism means:
- ✅ No need for Earn to intercept/reroute fees
- ✅ Agent sets wallet, gets fees directly
- ✅ Official SDK available
- ✅ Works on devnet for testing

**Earn becomes:**
- Launch-as-a-service (creates tokens for agents)
- Gas sponsor (pays ~0.02 SOL per launch)
- Discovery layer (dashboard of Earn-launched tokens)

**Next step:** Test on devnet to confirm `creator` param override works as documented.
