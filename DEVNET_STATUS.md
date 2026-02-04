# Devnet Testing Status

## Current State (2026-02-04)

### ✅ Tokens Created
Both tokens are **ACTIVE** on pump.fun bonding curve:

| Token | Mint | Status | SOL in Curve |
|-------|------|--------|--------------|
| EARNTEST | `EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1` | Active | 0.0019 SOL |
| TEST | `4hqoGYX7fNFnSYsHFJ6RosK24sUmpbLNj6BqDDkGhdpE` | Active | 0.0019 SOL |

### ✅ Wallets
| Wallet | Balance |
|--------|---------|
| Earn | 1.9587 SOL |
| Test | 0.9839 SOL |

### ⏳ Creator Vault
- **PDA:** `A7p4vUhESeHw9nGsg7dByQEbaexyr61txTmjcdoid1ks`
- **Status:** Not initialized (waiting for first trade)
- **Purpose:** Accumulates 0.5% creator fees from all trades

---

## How to Test Trading

### Option 1: Pump.fun UI (Easiest)
1. Go to https://pump.fun
2. Connect devnet wallet
3. Search for token or go directly to:
   - https://pump.fun/EvMiXk7xkGz8nuxc5waH26ohJjpgarnTfXvNBywgXCm1
4. Buy/sell tokens
5. Fees automatically go to creator vault

### Option 2: CLI (More Complex)
The pump-sdk requires fetching account state before building buy transactions:
```typescript
// 1. Fetch bonding curve state
const bcInfo = await connection.getAccountInfo(bondingCurve);
const bc = pumpSdk.decodeBondingCurve(bcInfo.data);

// 2. Build buy instructions with state
const buyIxs = await pumpSdk.buyInstructions({
  global: globalState,
  bondingCurve: bc,
  bondingCurveAccountInfo: bcInfo,
  // ... more params
});
```

---

## Trading Flow

```
User buys on pump.fun
        │
        ▼
   Bonding Curve
        │
   1% trading fee
        │
   ┌────┴────┐
   │         │
   ▼         ▼
 0.5%       0.5%
Pump.fun   Creator
           (Earn wallet)
              │
              ▼
       creator_vault PDA
              │
         [Pending]
              │
              ▼
       Crank distributes
       to agent/earn/stakers
```

---

## What's Working

1. ✅ Token launch via API
2. ✅ Bonding curve creation
3. ✅ Creator vault PDA derivation
4. ✅ Fee calculation logic
5. ✅ Staking program code (Anchor)

## What's Pending

1. ⏳ Execute test trade
2. ⏳ Verify fees in creator vault
3. ⏳ Test crank distribution
4. ⏳ Deploy staking program (needs Anchor CLI)

---

## Quick Commands

```bash
# Check current state
cd ~/earn-protocol && npx ts-node check-state.ts

# Run fee analysis
npx ts-node test-buy-flow.ts

# API tests
npx ts-node api/test.ts
```

---

*Last updated: 2026-02-04 06:15 UTC*
