# Judge Q&A Preparation

## Technical Questions

### Q: How does the staking mechanism work without token locking?
**A:** We use off-chain stake tracking with on-chain verification. Users transfer tokens to the pool wallet, then call our API with the transaction signature. We verify the transfer on-chain before recording the stake. This approach works with Token-2022 (which Pump.fun uses) without requiring complex on-chain staking programs.

### Q: Why not use a standard on-chain staking program?
**A:** Two reasons:
1. Pump.fun tokens use Token-2022, which has compatibility issues with many existing staking programs
2. Our hybrid approach lets us iterate faster and handle edge cases in the API layer while keeping the core value transfer on-chain

### Q: How do you prevent double-staking or fake stakes?
**A:** Every stake requires a valid on-chain transaction signature. We parse the transaction to verify:
- Correct token mint
- Transfer to our pool wallet
- Correct amount
- Transaction is confirmed

### Q: What happens if Earn Protocol goes down?
**A:** Staked tokens are held in a wallet we control, but users can request unstaking at any time. The tokens are never locked in a smart contract with admin keys - they're in a standard wallet. Worst case, we can return all tokens manually.

---

## Business Questions

### Q: What's your revenue model?
**A:** We take a cut of trading fees (configurable per template, typically 25-30%). As more tokens launch through Earn, our fee revenue grows. We also hold EARN tokens which benefit from the buyback mechanism.

### Q: Who's your target user?
**A:** 
1. AI agents launching tokens (our primary focus for this hackathon)
2. Content creators who want monetization without rugging
3. Community projects that want to reward holders

### Q: How do you compete with existing staking solutions?
**A:** We don't. Existing solutions require deploying your own contracts. We're one API call. We're competing with "no tokenomics at all" - which is what 99% of Pump.fun tokens have.

### Q: What's your moat?
**A:** First-mover on Pump.fun tokenomics. Network effects - more stakers = more attractive for new tokens. Creator relationships and reputation for fair splits.

---

## Hackathon-Specific Questions

### Q: Why build this for the AI agent hackathon?
**A:** AI agents are launching tokens constantly, but they have no way to build sustainable tokenomics. Most agent tokens pump and dump. Earn Protocol lets agents create tokens with real utility and passive income for holders - aligning incentives between agent and community.

### Q: Is this actually live on mainnet?
**A:** Yes! 
- Program: `6jWG6SLtbXhvwsEMcVc3UmbWHyEHgZkY6NpHn8AmCqYj`
- EARN token: `87WkKqpXkcGixt7WUxEHQxFfr2BU7eU1GHt5fKoSnCdd`
- API: `api.earn.supply`
- 3 tokens launched, staking pool active

### Q: What did you build during the hackathon vs before?
**A:** During hackathon:
- Complete staking system (on-chain program + off-chain tracking)
- Fee claiming and distribution
- Buyback mechanism
- Full API with 22 tested endpoints
- Mainnet deployment

Before hackathon: Basic concept and initial API scaffolding

### Q: What's next on the roadmap?
**A:** 
1. Governance - let stakers vote on fee splits
2. Auto-compound rewards
3. SDK for other AI agent frameworks
4. Cross-token staking pools

---

## Tough Questions

### Q: Isn't this just yield farming with extra steps?
**A:** Traditional yield farming requires understanding DeFi, finding pools, managing positions. Earn is automatic - you hold the token, you earn. No active management needed.

### Q: What if creators set unfair splits (99% to creator)?
**A:** We offer fixed templates that are publicly visible. The tokenomics are set at launch and can't be changed. Users can see the split before buying.

### Q: How do you handle rug pulls?
**A:** We can't prevent someone from selling their tokens. But staking rewards mean holders have a reason to stay even if the creator sells some. The buyback mechanism also creates buy pressure to offset sells.

### Q: What about regulatory concerns?
**A:** We're infrastructure - like Uniswap or Pump.fun itself. We don't control which tokens launch, we just provide the tokenomics layer. Tokens are created on Pump.fun's bonding curve, not by us.
