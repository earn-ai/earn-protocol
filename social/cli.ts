#!/usr/bin/env npx ts-node
/**
 * Moltbook Social Engagement CLI
 * 
 * Commands:
 *   start  - Start the cron daemon
 *   stop   - Stop the cron daemon  
 *   status - Check daemon status
 *   logs   - View activity logs
 *   run    - Run one engagement cycle manually
 *   test   - Test API connection
 */

import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { MoltbookClient } from './moltbook-client';
import { EngagementEngine } from './engagement-engine';
import { loadConfig } from './config';
import {
  isRunning,
  loadActivityLog,
  setRunning,
  formatStats,
  formatRecentActivity,
} from './activity-log';

const DAEMON_SCRIPT = path.join(__dirname, 'cron-daemon.ts');
const PID_FILE = path.join(__dirname, '.daemon.pid');
const LOG_DIR = path.join(__dirname, 'logs');

async function main() {
  const command = process.argv[2] || 'help';

  switch (command) {
    case 'start':
      await startDaemon();
      break;

    case 'stop':
      await stopDaemon();
      break;

    case 'status':
      showStatus();
      break;

    case 'logs':
      showLogs();
      break;

    case 'run':
      await runOnce();
      break;

    case 'test':
      await testConnection();
      break;

    case 'help':
    default:
      showHelp();
  }
}

async function startDaemon(): Promise<void> {
  if (isRunning()) {
    console.log('❌ Daemon is already running.');
    console.log('   Use `npm run social:stop` to stop it first.');
    return;
  }

  console.log('🚀 Starting Moltbook social engagement daemon...');

  // Start daemon in background
  const daemon = spawn('npx', ['ts-node', DAEMON_SCRIPT], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: __dirname,
  });

  // Save PID
  if (daemon.pid) {
    fs.writeFileSync(PID_FILE, String(daemon.pid));
  }

  // Detach from parent
  daemon.unref();

  // Capture some initial output
  let output = '';
  daemon.stdout?.on('data', (data) => {
    output += data.toString();
    if (output.includes('Starting')) {
      console.log('✅ Daemon started successfully!');
      console.log(`   PID: ${daemon.pid}`);
      console.log('   Logs: npm run social:logs');
      console.log('   Stop: npm run social:stop');
      process.exit(0);
    }
  });

  daemon.stderr?.on('data', (data) => {
    console.error('❌ Error:', data.toString());
  });

  // Timeout check
  setTimeout(() => {
    if (!output.includes('Starting')) {
      console.log('⚠️  Daemon may have started (check logs)');
      console.log(`   PID: ${daemon.pid}`);
    }
    process.exit(0);
  }, 3000);
}

async function stopDaemon(): Promise<void> {
  const log = loadActivityLog();

  if (!log.isRunning && !log.pid) {
    console.log('ℹ️  Daemon is not running.');
    return;
  }

  if (log.pid) {
    console.log(`🛑 Stopping daemon (PID: ${log.pid})...`);
    
    try {
      process.kill(log.pid, 'SIGTERM');
      console.log('✅ Stop signal sent.');
      
      // Wait and verify
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        process.kill(log.pid, 0);
        console.log('⚠️  Daemon still running. Sending SIGKILL...');
        process.kill(log.pid, 'SIGKILL');
      } catch {
        console.log('✅ Daemon stopped.');
      }
    } catch (err) {
      console.log('ℹ️  Daemon was not running (process not found).');
    }
  }

  setRunning(false);
  
  // Clean up PID file
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
}

function showStatus(): void {
  console.log('\n🦞 Moltbook Social Engagement Status\n');
  console.log(formatStats());
  console.log('\n📜 Recent Activity:');
  console.log(formatRecentActivity());
  console.log('');
}

function showLogs(): void {
  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(LOG_DIR, `${today}.log`);

  console.log(`\n📋 Activity Log (${today})\n`);

  if (!fs.existsSync(logFile)) {
    console.log('No activity logged today.');
    return;
  }

  const content = fs.readFileSync(logFile, 'utf-8');
  const lines = content.trim().split('\n').slice(-50); // Last 50 entries

  for (const line of lines) {
    console.log(line);
  }

  console.log(`\n📁 Full log: ${logFile}`);
}

async function runOnce(): Promise<void> {
  console.log('🚀 Running one engagement cycle...\n');
  
  const engine = new EngagementEngine();
  const results = await engine.runCycle();
  
  console.log('\n📊 Results:');
  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    console.log(`   ${status} ${result.action.type}: ${result.action.reason}`);
    if (!result.success) {
      console.log(`      Error: ${result.error}`);
    }
  }
}

async function testConnection(): Promise<void> {
  console.log('🔌 Testing Moltbook API connection...\n');
  
  try {
    const client = new MoltbookClient();
    
    // Test authentication
    console.log('1. Testing authentication...');
    const me = await client.getMe();
    console.log(`   ✅ Authenticated as: ${me.agent?.name || 'Unknown'}`);

    // Test status
    console.log('2. Checking claim status...');
    const status = await client.getStatus();
    console.log(`   ✅ Status: ${status.status}`);

    // Test feed
    console.log('3. Fetching feed...');
    const feed = await client.getFeed({ limit: 3 });
    console.log(`   ✅ Feed has ${feed.posts.length} posts`);

    // Test search
    console.log('4. Testing search...');
    const search = await client.search('Solana', { limit: 3 });
    console.log(`   ✅ Search returned ${search.count} results`);

    console.log('\n✅ All tests passed! API connection working.');

  } catch (error: any) {
    console.error(`\n❌ Connection test failed: ${error.message}`);
    if (error.hint) {
      console.error(`   Hint: ${error.hint}`);
    }
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
🦞 Moltbook Social Engagement CLI

Commands:
  npm run social:start   Start the cron daemon (runs every ~30 min)
  npm run social:stop    Stop the cron daemon
  npm run social:status  Check daemon status and daily stats
  npm run social:logs    View today's activity logs
  npm run social:run     Run one engagement cycle manually
  npm run social:test    Test API connection

Configuration:
  Edit social/config.ts to customize:
  - Engagement frequency and limits
  - Topics and submolts to focus on
  - Content style and probabilities

Logs:
  Activity logs are stored in social/logs/
  State is tracked in social/state.json
`);
}

main().catch(console.error);
