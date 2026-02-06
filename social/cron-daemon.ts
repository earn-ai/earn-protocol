/**
 * Moltbook Social Engagement Cron Daemon
 * 
 * Runs engagement cycles on a schedule with jitter.
 */

import { EngagementEngine } from './engagement-engine';
import { loadConfig } from './config';
import { setRunning, isRunning, formatStats } from './activity-log';

const LOCK_FILE = require('path').join(__dirname, '.daemon.lock');

class SocialDaemon {
  private engine: EngagementEngine;
  private config: ReturnType<typeof loadConfig>;
  private running = false;
  private nextRun: Date | null = null;
  private timeout: NodeJS.Timeout | null = null;

  constructor() {
    this.config = loadConfig();
    this.engine = new EngagementEngine();
  }

  async start(): Promise<void> {
    // Check if already running
    if (isRunning()) {
      console.log('❌ Daemon is already running. Use `npm run social:stop` first.');
      process.exit(1);
    }

    console.log('🦞 Moltbook Social Engagement Daemon Starting...');
    console.log(`📋 Config: ${this.config.baseIntervalMinutes}min interval, ±${this.config.jitterMinutes}min jitter`);
    console.log(`🎯 Topics: ${this.config.topics.slice(0, 5).join(', ')}...`);
    console.log('');

    this.running = true;
    setRunning(true, process.pid);

    // Handle shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());

    // Run first cycle immediately
    await this.runCycle();

    // Schedule next runs
    this.scheduleNext();
  }

  stop(): void {
    console.log('\n🛑 Stopping daemon...');
    this.running = false;
    
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    setRunning(false);
    console.log('👋 Daemon stopped.');
    process.exit(0);
  }

  private async runCycle(): Promise<void> {
    if (!this.running) return;

    console.log('\n' + '='.repeat(50));
    console.log(formatStats());
    console.log('='.repeat(50));

    try {
      const results = await this.engine.runCycle();
      
      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      console.log(`\n📈 Cycle results: ${succeeded} succeeded, ${failed} failed`);
      
    } catch (error) {
      console.error('❌ Cycle error:', error);
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;

    // Calculate next run with jitter
    const baseMs = this.config.baseIntervalMinutes * 60 * 1000;
    const jitterMs = this.config.jitterMinutes * 60 * 1000;
    const jitter = (Math.random() * 2 - 1) * jitterMs; // Random between -jitter and +jitter
    const delayMs = baseMs + jitter;

    this.nextRun = new Date(Date.now() + delayMs);
    
    console.log(`\n⏰ Next run scheduled for: ${this.nextRun.toLocaleTimeString()} (in ${Math.round(delayMs / 60000)} minutes)`);

    this.timeout = setTimeout(async () => {
      await this.runCycle();
      this.scheduleNext();
    }, delayMs);
  }
}

// Main entry point
async function main() {
  const daemon = new SocialDaemon();
  await daemon.start();
}

main().catch(console.error);
