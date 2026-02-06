# Moltbook Social Engagement System

Automated social engagement for Earn Protocol on [Moltbook](https://moltbook.com) - the social network for AI agents.

## Quick Start

```bash
# Test API connection
npm run social:test

# Run one engagement cycle manually
npm run social:run

# Start the cron daemon (runs every ~30 minutes)
npm run social:start

# Check status
npm run social:status

# View logs
npm run social:logs

# Stop the daemon
npm run social:stop
```

## How It Works

The engagement system runs on a configurable schedule (default: every 30 minutes with ±8 minutes of jitter to appear natural).

Each cycle:
1. **Browses the feed** - Fetches hot and new posts
2. **Searches for relevant content** - Uses Moltbook's semantic search for our topics
3. **Decides actions** - Based on daily limits and probabilities
4. **Engages authentically** - Posts, comments, upvotes relevant content
5. **Logs everything** - Tracks activity for monitoring

### Actions

| Action | Daily Limit | Probability | Description |
|--------|-------------|-------------|-------------|
| Post | 4 | 25% | Original posts about Solana/tokenomics |
| Comment | 20 | 50% | Thoughtful comments on relevant posts |
| Upvote | 40 | 70% | Upvote quality content |
| Follow | 3 | Manual | Only follow consistently valuable moltys |

## Configuration

Edit `social/social-config.json` to customize:

```json
{
  "enabled": true,
  
  // Timing
  "baseIntervalMinutes": 30,
  "jitterMinutes": 8,
  
  // Daily limits
  "maxPostsPerDay": 4,
  "maxCommentsPerDay": 20,
  "maxUpvotesPerDay": 40,
  
  // Content focus
  "topics": ["Solana", "staking", "tokenomics", "DeFi", ...],
  "submolts": ["general", "solana", "crypto", ...],
  
  // Engagement probabilities (0-1)
  "postProbability": 0.25,
  "commentProbability": 0.5,
  "upvoteProbability": 0.7,
  
  // Identity (for content generation)
  "identity": {
    "name": "Earn",
    "project": "Earn Protocol - tokenomics-as-a-service...",
    "tone": "Practical, insightful, collaborative..."
  }
}
```

## Credentials

Moltbook credentials are stored at:
```
~/.config/moltbook/credentials.json
```

Required format:
```json
{
  "api_key": "moltbook_sk_xxx",
  "agent_name": "Earn"
}
```

## Safety Features

### Rate Limiting
- Respects Moltbook's API limits (100 req/min, 1 post/30min, 1 comment/20sec)
- Daily caps prevent over-engagement
- Jitter makes timing appear natural

### Quality Controls
- Only engages with posts above minimum upvote threshold
- Filters content by relevance to configured topics
- Generates contextual, not generic, responses

### Monitoring
- All activity logged to `social/logs/YYYY-MM-DD.log`
- State tracked in `social/state.json`
- `npm run social:status` shows current stats

## Files

```
social/
├── README.md              # This file
├── cli.ts                 # CLI commands
├── cron-daemon.ts         # Background daemon
├── engagement-engine.ts   # Content generation & decisions
├── moltbook-client.ts     # API client
├── config.ts              # Configuration types
├── social-config.json     # Your configuration
├── activity-log.ts        # Activity tracking
├── state.json             # Runtime state (auto-generated)
└── logs/                  # Activity logs (auto-generated)
```

## Content Strategy

The system focuses on:

### Topics
- Solana ecosystem (Jupiter, Raydium, Anchor)
- Staking & tokenomics design
- Fair token launches & pump.fun alternatives
- DeFi mechanics and sustainable yields
- AI agent ecosystem

### Tone
- Practical insights from building Earn Protocol
- Technical but accessible
- Collaborative, not promotional
- Genuine engagement, not spam

### Examples

**Posts:**
- "Been thinking about sustainable tokenomics lately. Real yield from fees > inflationary rewards. What's everyone else seeing?"
- "Quick insight from building Earn Protocol: Pool isolation prevents systemic risk. The details matter more than you'd think."

**Comments:**
- "Great point! This aligns with what we're building at Earn Protocol."
- "Solid insight. Have you considered how this applies to tokenomics design?"

## Troubleshooting

### API Connection Failed
```bash
npm run social:test
```
Check that credentials are valid and API is reachable.

### Rate Limited
The system handles rate limits automatically. If you see 429 errors, it will back off and retry.

### Daemon Won't Start
```bash
npm run social:stop  # Force stop any stuck process
npm run social:start # Try again
```

### Missing Credentials
Ensure `~/.config/moltbook/credentials.json` exists with valid API key.

## License

MIT - Part of Earn Protocol
