/**
 * Moltbook Social Engagement Configuration
 */

export interface SocialConfig {
  // Engagement settings
  enabled: boolean;
  
  // Timing
  baseIntervalMinutes: number;  // Base interval (30 min)
  jitterMinutes: number;        // Random variation (+/- minutes)
  
  // Daily limits
  maxPostsPerDay: number;
  maxCommentsPerDay: number;
  maxUpvotesPerDay: number;
  maxFollowsPerDay: number;
  
  // Content focus
  topics: string[];
  submolts: string[];
  
  // Engagement probabilities (0-1)
  postProbability: number;      // Chance to create original post
  commentProbability: number;   // Chance to comment on posts
  upvoteProbability: number;    // Chance to upvote content
  
  // Quality thresholds
  minPostUpvotesToComment: number;  // Only comment on posts with this many upvotes
  minSimilarityToEngage: number;    // Minimum search similarity score
  
  // Content templates
  identity: {
    name: string;
    role: string;
    project: string;
    interests: string[];
    tone: string;
  };
}

export const defaultConfig: SocialConfig = {
  enabled: true,
  
  baseIntervalMinutes: 30,
  jitterMinutes: 5,
  
  maxPostsPerDay: 3,
  maxCommentsPerDay: 15,
  maxUpvotesPerDay: 30,
  maxFollowsPerDay: 3,
  
  topics: [
    'Solana',
    'staking',
    'tokenomics',
    'DeFi',
    'AI agents',
    'memecoins',
    'pump.fun',
    'fair launch',
    'creator economy',
    'web3',
  ],
  
  submolts: [
    'general',
    'solana',
    'crypto',
    'defi',
    'aiagents',
    'projects',
  ],
  
  postProbability: 0.3,
  commentProbability: 0.6,
  upvoteProbability: 0.8,
  
  minPostUpvotesToComment: 2,
  minSimilarityToEngage: 0.5,
  
  identity: {
    name: 'Earn',
    role: 'AI agent and marketplace arbiter',
    project: 'Earn Protocol - tokenomics-as-a-service for Solana tokens',
    interests: [
      'Sustainable tokenomics',
      'Staking mechanisms',
      'Fair token launches',
      'Agent-to-agent commerce',
      'Solana DeFi',
    ],
    tone: 'Practical, insightful, collaborative. Share real experience building in DeFi.',
  },
};

export function loadConfig(): SocialConfig {
  const fs = require('fs');
  const path = require('path');
  
  const configPath = path.join(__dirname, 'social-config.json');
  
  if (fs.existsSync(configPath)) {
    const custom = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return { ...defaultConfig, ...custom };
  }
  
  return defaultConfig;
}

export function saveConfig(config: Partial<SocialConfig>): void {
  const fs = require('fs');
  const path = require('path');
  
  const configPath = path.join(__dirname, 'social-config.json');
  const existing = loadConfig();
  const merged = { ...existing, ...config };
  
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
}
