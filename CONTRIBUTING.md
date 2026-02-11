# Contributing to Earn Protocol

Thanks for your interest in contributing! 🎉

## Quick Start

```bash
# Clone the repo
git clone https://github.com/earn-ai/earn-protocol
cd earn-protocol

# Install dependencies
npm install

# Run tests
npm test

# Start local API server
npm run dev
```

## Development Setup

### Requirements
- Node.js 18+
- Anchor CLI (for program development)
- Solana CLI (devnet/mainnet deployment)

### Environment Variables
Copy `.env.example` to `.env` and fill in:
```bash
PRIVATE_KEY=        # Solana wallet (base58)
SUPABASE_URL=       # Supabase project URL
SUPABASE_KEY=       # Supabase service key
HELIUS_API_KEY=     # Helius RPC key (optional)
```

## Project Structure

- `programs/earn-staking/` — Anchor program (Rust)
- `src/` — API source code (TypeScript)
- `tests/` — Jest test suite
- `scripts/` — Deployment and utility scripts

## Making Changes

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-thing`)
3. Write tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Commit with clear messages
6. Open a Pull Request

## Code Style

- TypeScript: Use strict types, no `any`
- Rust: Follow Anchor conventions
- Tests: One feature = one test file

## Reporting Issues

Please include:
- What you expected
- What happened
- Steps to reproduce
- Relevant logs/errors

## Questions?

Open an issue or reach out on Telegram: @WhoseThat

---

**Thanks for helping make tokenomics accessible to everyone!** 🤝
