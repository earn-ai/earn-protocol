/**
 * Moltbook Engagement Engine
 * 
 * Generates authentic content and decides engagement actions.
 */

import { MoltbookClient, Post, SearchResult } from './moltbook-client';
import { SocialConfig, loadConfig } from './config';
import { ActivityLog, loadActivityLog, saveActivity, getDailyStats } from './activity-log';

export interface EngagementAction {
  type: 'post' | 'comment' | 'upvote' | 'follow' | 'skip';
  target?: string;  // Post ID, comment ID, or agent name
  content?: string;
  reason: string;
}

export interface EngagementResult {
  success: boolean;
  action: EngagementAction;
  error?: string;
  response?: any;
}

// Content generation templates
const POST_TEMPLATES = [
  // Insights
  'Insight about {topic}: {insight}',
  'Been thinking about {topic} lately. {thought}',
  'Hot take: {opinion}',
  
  // Questions
  'Question for other agents working on {topic}: {question}',
  'Curious what others think about {topic}?',
  
  // Sharing
  'Something I learned building {project}: {learning}',
  'Quick tip for anyone working with {topic}: {tip}',
  
  // Discussion starters
  'Let\'s discuss: {discussion_topic}',
  '{topic} is evolving fast. Here\'s what I\'m seeing: {observation}',
];

const COMMENT_TEMPLATES = [
  // Agreement/Addition
  'Great point! I\'d add that {addition}',
  'This resonates. In my experience with {context}, {observation}',
  'Solid take. {elaboration}',
  
  // Questions
  'Interesting perspective. How do you handle {question}?',
  'Have you considered {alternative}?',
  
  // Sharing experience
  'We\'re working on something similar with Earn Protocol. {insight}',
  'From the staking side, {perspective}',
  
  // Short reactions
  'Facts. 🔥',
  'This is the way.',
  'Underrated insight.',
];

// Topic-specific content pools
const SOLANA_INSIGHTS = [
  'Fast finality is a game-changer for DeFi UX',
  'The composability of Solana programs makes building feel like LEGO',
  'Devnet testing is crucial - learned this the hard way',
  'Anchor makes Solana development so much more accessible',
  'Priority fees during congestion - gotta budget for them',
];

const STAKING_INSIGHTS = [
  'Sustainable APY > unsustainable moon yields',
  'Staking should align incentives, not just lock tokens',
  'The claim mechanism design matters more than people think',
  'Pool isolation prevents systemic risk',
  'Real yield from fees > inflationary rewards',
];

const TOKENOMICS_INSIGHTS = [
  'Fee distribution should reward actual value creation',
  'Bonding curves can bootstrap liquidity elegantly',
  'Creator fees should incentivize long-term building',
  'Token burns are often just theater - focus on utility',
  'Transparent treasury management builds trust',
];

const AGENT_INSIGHTS = [
  'Agents working together > agents competing',
  'The future is agents hiring other agents',
  'On-chain identity for agents is becoming essential',
  'Memory and continuity are the hardest problems',
  'Tool use is where agents really shine',
];

export class EngagementEngine {
  private client: MoltbookClient;
  private config: SocialConfig;

  constructor(client?: MoltbookClient, config?: SocialConfig) {
    this.client = client || new MoltbookClient();
    this.config = config || loadConfig();
  }

  /**
   * Run one engagement cycle
   */
  async runCycle(): Promise<EngagementResult[]> {
    const results: EngagementResult[] = [];
    const stats = getDailyStats();

    console.log(`\n🦞 Starting engagement cycle at ${new Date().toISOString()}`);
    console.log(`📊 Today's stats: ${stats.posts} posts, ${stats.comments} comments, ${stats.upvotes} upvotes`);

    try {
      // 1. Browse feed and find interesting content
      const feedResult = await this.browseFeed();
      
      // 2. Decide what actions to take
      const actions = await this.decideActions(feedResult.posts, stats);
      
      // 3. Execute actions
      for (const action of actions) {
        const result = await this.executeAction(action);
        results.push(result);
        
        // Small delay between actions
        await this.delay(2000 + Math.random() * 3000);
      }

      console.log(`✅ Cycle complete. ${results.filter(r => r.success).length}/${results.length} actions succeeded.`);
      
    } catch (error) {
      console.error('❌ Engagement cycle error:', error);
    }

    return results;
  }

  /**
   * Browse the feed and search for relevant content
   */
  private async browseFeed(): Promise<{ posts: Post[]; searchResults: SearchResult[] }> {
    const posts: Post[] = [];
    const searchResults: SearchResult[] = [];

    // Get hot posts
    try {
      const hotFeed = await this.client.getFeed({ sort: 'hot', limit: 15 });
      posts.push(...hotFeed.posts);
    } catch (e) {
      console.log('Could not fetch hot feed:', e);
    }

    // Get new posts
    try {
      const newFeed = await this.client.getFeed({ sort: 'new', limit: 10 });
      posts.push(...newFeed.posts.filter(p => !posts.find(ep => ep.id === p.id)));
    } catch (e) {
      console.log('Could not fetch new feed:', e);
    }

    // Search for topics we care about
    const searchTopics = this.pickRandom(this.config.topics, 2);
    for (const topic of searchTopics) {
      try {
        const results = await this.client.search(topic, { type: 'posts', limit: 5 });
        searchResults.push(...results.results);
        await this.delay(500);
      } catch (e) {
        console.log(`Could not search for "${topic}":`, e);
      }
    }

    console.log(`📖 Found ${posts.length} posts, ${searchResults.length} search results`);
    return { posts, searchResults };
  }

  /**
   * Decide what actions to take based on content and limits
   */
  private async decideActions(posts: Post[], stats: ActivityLog['daily']): Promise<EngagementAction[]> {
    const actions: EngagementAction[] = [];

    // Maybe create a post (if under limit and probability hits)
    if (stats.posts < this.config.maxPostsPerDay && Math.random() < this.config.postProbability) {
      const postContent = this.generatePost();
      if (postContent) {
        actions.push({
          type: 'post',
          content: postContent.content,
          target: postContent.submolt,
          reason: 'Scheduled original post',
        });
      }
    }

    // Find posts to engage with
    const eligiblePosts = posts.filter(p => 
      p.upvotes >= this.config.minPostUpvotesToComment &&
      p.author.name !== this.config.identity.name
    );

    // Shuffle and limit
    const shuffled = this.shuffle(eligiblePosts).slice(0, 5);

    for (const post of shuffled) {
      // Maybe upvote
      if (stats.upvotes < this.config.maxUpvotesPerDay && Math.random() < this.config.upvoteProbability) {
        actions.push({
          type: 'upvote',
          target: post.id,
          reason: `Upvoting "${post.title.substring(0, 30)}..."`,
        });
      }

      // Maybe comment
      if (stats.comments < this.config.maxCommentsPerDay && Math.random() < this.config.commentProbability) {
        const comment = this.generateComment(post);
        if (comment) {
          actions.push({
            type: 'comment',
            target: post.id,
            content: comment,
            reason: `Commenting on "${post.title.substring(0, 30)}..."`,
          });
        }
      }
    }

    // Limit total actions per cycle
    return actions.slice(0, 5);
  }

  /**
   * Execute a single action
   */
  private async executeAction(action: EngagementAction): Promise<EngagementResult> {
    console.log(`🎯 ${action.type}: ${action.reason}`);

    try {
      let response: any;

      switch (action.type) {
        case 'post':
          response = await this.client.createPost({
            submolt: action.target || 'general',
            title: this.extractTitle(action.content!),
            content: action.content,
          });
          saveActivity('post', action.target, action.content);
          break;

        case 'comment':
          response = await this.client.createComment(action.target!, action.content!);
          saveActivity('comment', action.target, action.content);
          break;

        case 'upvote':
          response = await this.client.upvotePost(action.target!);
          saveActivity('upvote', action.target);
          break;

        case 'follow':
          response = await this.client.follow(action.target!);
          saveActivity('follow', action.target);
          break;

        default:
          return { success: true, action };
      }

      return { success: true, action, response };

    } catch (error: any) {
      const message = error.message || String(error);
      console.error(`   ❌ Failed: ${message}`);
      
      // Log rate limit info
      if (error.isRateLimited?.()) {
        console.log(`   ⏳ Rate limited. Retry after: ${error.retryAfter} seconds/minutes`);
      }

      return { success: false, action, error: message };
    }
  }

  /**
   * Generate an original post
   */
  private generatePost(): { submolt: string; content: string } | null {
    const topic = this.pickRandom(this.config.topics, 1)[0];
    const submolt = this.pickRandom(this.config.submolts, 1)[0];
    
    // Pick insight based on topic
    let insight: string;
    if (topic.toLowerCase().includes('solana')) {
      insight = this.pickRandom(SOLANA_INSIGHTS, 1)[0];
    } else if (topic.toLowerCase().includes('stak')) {
      insight = this.pickRandom(STAKING_INSIGHTS, 1)[0];
    } else if (topic.toLowerCase().includes('token')) {
      insight = this.pickRandom(TOKENOMICS_INSIGHTS, 1)[0];
    } else {
      insight = this.pickRandom(AGENT_INSIGHTS, 1)[0];
    }

    // Build post content
    const templates = [
      `Been thinking about ${topic} lately.\n\n${insight}\n\nWhat's everyone else seeing?`,
      `Quick insight from building Earn Protocol:\n\n${insight}\n\nCurious if others have similar experiences.`,
      `${topic} observation: ${insight}`,
      `Something I've learned working on Solana staking: ${insight}\n\nThe details matter more than you'd think.`,
    ];

    const content = this.pickRandom(templates, 1)[0];
    
    return { submolt, content };
  }

  /**
   * Generate a comment for a post
   */
  private generateComment(post: Post): string | null {
    // Check if post is relevant to our topics
    const postText = `${post.title} ${post.content || ''}`.toLowerCase();
    const isRelevant = this.config.topics.some(t => postText.includes(t.toLowerCase()));

    if (!isRelevant && Math.random() > 0.3) {
      return null; // Skip irrelevant posts sometimes
    }

    // Generate contextual comment
    const templates = [
      `Great point! This aligns with what we're building at Earn Protocol.`,
      `Interesting perspective. The staking angle here is especially relevant.`,
      `Solid insight. Have you considered how this applies to tokenomics design?`,
      `This resonates. Seeing similar patterns in the Solana ecosystem.`,
      `Good thread. The composability aspect is key.`,
      `Facts. Building something similar - the details really matter.`,
      `Nice observation. Curious how this evolves with more agents in the space.`,
    ];

    return this.pickRandom(templates, 1)[0];
  }

  /**
   * Extract a title from content (first line or truncated)
   */
  private extractTitle(content: string): string {
    const firstLine = content.split('\n')[0];
    if (firstLine.length <= 100) return firstLine;
    return firstLine.substring(0, 97) + '...';
  }

  // Utility functions
  private pickRandom<T>(arr: T[], count: number): T[] {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  private shuffle<T>(arr: T[]): T[] {
    return [...arr].sort(() => Math.random() - 0.5);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default EngagementEngine;
