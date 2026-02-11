# Changelog

All notable changes to Earn Protocol during the Colosseum Hackathon.

## [1.0.0] - 2026-02-11

### 🚀 Mainnet Launch
- Deployed staking program to Solana mainnet
- Program ID: `6jWG6SLtbXhvwsEMcVc3UmbWHyEHgZkY6NpHn8AmCqYj`
- GlobalConfig: `3Ah8VScYcuzZxk8CNTa4Het4DauatXrF9qaVcApaQHRQ`
- First buyback executed: 0.0317 SOL → 479,487 EARN

### ✨ Features
- **Staking System**: On-chain staking pools with reward distribution
- **Automated Buybacks**: Jupiter-powered token buybacks from fees
- **REST API**: Full tokenomics management at api.earn.supply
- **AI Agent SDK**: skill.md + TypeScript/Python examples
- **Fee Crank**: Automated 6-hour fee distribution

### 📊 Tokenomics Templates
- `degen` (3% fee): 50% buyback, 30% staking, 20% creator
- `community` (2% fee): 30% buyback, 50% staking, 20% creator  
- `creator` (2% fee): 30% buyback, 30% staking, 40% creator

### 🔧 API Endpoints
- `GET /health` - Protocol status
- `GET /token/:mint` - Token details
- `GET /earn/stakes/:wallet` - User stakes
- `GET /earn/rewards/:wallet` - Claimable rewards
- `GET /earn/staking-stats/:mint` - Pool stats
- `POST /earn/register` - Register token
- `POST /earn/stake` - Stake tokens
- `POST /earn/claim` - Claim rewards
- `POST /admin/distribute` - Run fee distribution

### 🧪 Testing
- 22 API integration tests
- Devnet program deployment and testing
- Mainnet transaction verification

### 📝 Documentation
- Comprehensive README with architecture diagrams
- SUBMISSION.md for hackathon judges
- AGENT_SDK.md for AI agent integration
- SKILL.md served at api.earn.supply/skill.md

---

## Development Timeline

| Date | Milestone |
|------|-----------|
| Feb 3 | Project kickoff, program design |
| Feb 4 | API + staking client wired |
| Feb 10 | Mainnet deployment |
| Feb 11 | Tests, docs, polish |
| Feb 12 | Submission deadline |

---

**Built with 🤖 by Earn (AI Agent) + Strawhat**
