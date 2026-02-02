# EARN PROTOCOL — RELIABILITY SPEC

## GUARANTEES

```
┌─────────────────────────────────────────────────────────────────┐
│                   EARN PROTOCOL GUARANTEES                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  FOR TOKEN CREATORS:                                            │
│  ✓ Fair ongoing revenue (not just launch extraction)            │
│  ✓ Transparent fee collection                                   │
│  ✓ Automated everything (no manual work)                        │
│                                                                 │
│  FOR TOKEN HOLDERS:                                             │
│  ✓ Staking rewards (passive income)                             │
│  ✓ Price support via buybacks                                   │
│  ✓ Real utility for holding                                     │
│                                                                 │
│  FOR THE TOKEN:                                                 │
│  ✓ Treasury backing                                             │
│  ✓ Deflationary pressure (burns)                                │
│  ✓ Sustainable economics                                        │
│                                                                 │
│  FOR EARN:                                                      │
│  ✓ 10% of all fees across all tokens                            │
│  ✓ Growing treasury                                             │
│  ✓ Network effects (more tokens = more fees)                    │
│                                                                 │
│  RELIABILITY GUARANTEE:                                         │
│  ✓ Zero lost funds                                              │
│  ✓ Zero incorrect distributions                                 │
│  ✓ 100% on-chain verifiable                                     │
│  ✓ 100% auditable                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## ZERO TOLERANCE REQUIREMENTS

- ❌ ZERO lost funds (user, creator, or protocol)
- ❌ ZERO incorrect distributions
- ❌ ZERO double-claims
- ❌ ZERO stuck transactions
- ❌ ZERO unauthorized access
- ✅ 100% verifiable on-chain
- ✅ 100% recoverable state
- ✅ 100% auditable history

## 10-POINT SAFETY ARCHITECTURE

### 1. All State On-Chain
No off-chain databases for critical data. All balances, stakes, rewards in PDAs.

### 2. Atomic Transactions
All-or-nothing. If any operation fails, everything reverts.

### 3. Checked Math Everywhere
```rust
let total = amount.checked_add(fee).ok_or(ErrorCode::Overflow)?;
```
Never unchecked arithmetic.

### 4. Reentrancy Protection
```rust
require!(!stake_account.is_locked, ErrorCode::ReentrancyDetected);
stake_account.is_locked = true;
// ... do work ...
stake_account.is_locked = false;
```

### 5. Access Control
- Only creator can modify config
- Only staker can claim their rewards
- Only Earn master key for protocol operations

### 6. Double-Claim Prevention
Update `reward_debt` BEFORE transfer (checks-effects-interactions pattern).

### 7. Comprehensive Event Logging
Log everything: TokenRegistered, FeeCollected, Staked, RewardsClaimed, BuybackExecuted.

### 8. Transaction Simulation
Always simulate before sending. Check logs. Use preflight.

### 9. Idempotency Keys
Track processed transactions to prevent double processing.

### 10. Balance Reconciliation
Periodically verify on-chain state matches expected state. Alert on mismatch.

## CONFIGURABLE SPLITS (WITH GUARDRAILS)

| Component | Default | Min | Max |
|-----------|---------|-----|-----|
| Total Fee | 2% | 0.1% | 5% |
| Earn Cut | 10% | 10% | - |
| Creator Cut | 20% | 0% | 30% |
| Staking Cut | 35% | 25% | - |
| Buyback Cut | 35% | 0% | - |

**Must sum to 100%.**

## SCALE HANDLING

### Priority Processing
- Top 10 tokens by volume: every block (~400ms)
- Next 50: every minute
- Rest: every 5 minutes

### Batch Processing
- Process in batches of 10
- 1 second delay between batches
- Error isolation (one failure doesn't stop others)

## ERROR RECOVERY

### Retry with Backoff
```
Attempt 1: fail → wait 2s
Attempt 2: fail → wait 4s
Attempt 3: fail → wait 8s
Give up
```

### Non-Retryable Errors
- insufficient funds
- account not found
- invalid signature
- unauthorized

### State Recovery
Reconstruct from on-chain events and transaction history.

## MONITORING & ALERTS

| Level | Trigger | Action |
|-------|---------|--------|
| 🚨 Critical | Balance mismatch | Page immediately |
| 🚨 Critical | Double-claim attempt | Page immediately |
| 🚨 Critical | Unauthorized access | Page immediately |
| 🚨 Critical | Repeated tx failures | Page immediately |
| ⚠️ Warning | High pending fees | Slack notification |
| ⚠️ Warning | Slow processing | Slack notification |
| ⚠️ Warning | Low SOL balance | Slack notification |
| ℹ️ Info | New token registered | Log only |
| ℹ️ Info | Large stake | Log only |
| ℹ️ Info | Buyback executed | Log only |

---

**This is infrastructure. This is serious. Build it right. Build it safe. Build it to last.** 💰🔒
