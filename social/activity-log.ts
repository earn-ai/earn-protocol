/**
 * Activity Log
 * 
 * Tracks engagement activity to enforce daily limits and avoid duplicates.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(__dirname, 'logs');
const STATE_FILE = path.join(__dirname, 'state.json');

export interface ActivityEntry {
  timestamp: string;
  type: 'post' | 'comment' | 'upvote' | 'follow';
  target?: string;
  content?: string;
}

export interface ActivityLog {
  daily: {
    date: string;
    posts: number;
    comments: number;
    upvotes: number;
    follows: number;
  };
  recentActivity: ActivityEntry[];
  lastRun?: string;
  isRunning: boolean;
  pid?: number;
}

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

export function loadActivityLog(): ActivityLog {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      daily: {
        date: getToday(),
        posts: 0,
        comments: 0,
        upvotes: 0,
        follows: 0,
      },
      recentActivity: [],
      isRunning: false,
    };
  }

  const log = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as ActivityLog;
  
  // Reset daily counts if new day
  if (log.daily.date !== getToday()) {
    log.daily = {
      date: getToday(),
      posts: 0,
      comments: 0,
      upvotes: 0,
      follows: 0,
    };
    // Keep only last 50 activities
    log.recentActivity = log.recentActivity.slice(-50);
  }

  return log;
}

export function saveActivityLog(log: ActivityLog): void {
  ensureLogDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(log, null, 2));
}

export function saveActivity(
  type: 'post' | 'comment' | 'upvote' | 'follow',
  target?: string,
  content?: string
): void {
  const log = loadActivityLog();
  
  // Update daily counts
  switch (type) {
    case 'post': log.daily.posts++; break;
    case 'comment': log.daily.comments++; break;
    case 'upvote': log.daily.upvotes++; break;
    case 'follow': log.daily.follows++; break;
  }

  // Add to recent activity
  log.recentActivity.push({
    timestamp: new Date().toISOString(),
    type,
    target,
    content: content?.substring(0, 200),
  });

  // Keep only last 100 entries
  if (log.recentActivity.length > 100) {
    log.recentActivity = log.recentActivity.slice(-100);
  }

  log.lastRun = new Date().toISOString();
  saveActivityLog(log);

  // Also write to daily log file
  writeToDailyLog(type, target, content);
}

function writeToDailyLog(
  type: string,
  target?: string,
  content?: string
): void {
  ensureLogDir();
  
  const today = getToday();
  const logFile = path.join(LOG_DIR, `${today}.log`);
  
  const entry = [
    new Date().toISOString(),
    type.toUpperCase().padEnd(8),
    target || '-',
    content ? content.substring(0, 100).replace(/\n/g, ' ') : '-',
  ].join(' | ');

  fs.appendFileSync(logFile, entry + '\n');
}

export function getDailyStats(): ActivityLog['daily'] {
  return loadActivityLog().daily;
}

export function getRecentActivity(limit = 20): ActivityEntry[] {
  const log = loadActivityLog();
  return log.recentActivity.slice(-limit);
}

export function setRunning(running: boolean, pid?: number): void {
  const log = loadActivityLog();
  log.isRunning = running;
  log.pid = pid;
  saveActivityLog(log);
}

export function isRunning(): boolean {
  const log = loadActivityLog();
  
  // Check if PID is still active
  if (log.isRunning && log.pid) {
    try {
      process.kill(log.pid, 0); // Signal 0 = check if process exists
      return true;
    } catch {
      // Process not running
      log.isRunning = false;
      log.pid = undefined;
      saveActivityLog(log);
      return false;
    }
  }
  
  return log.isRunning;
}

export function formatStats(): string {
  const log = loadActivityLog();
  const stats = log.daily;
  
  return [
    `📊 Daily Stats (${stats.date})`,
    `   Posts: ${stats.posts}`,
    `   Comments: ${stats.comments}`,
    `   Upvotes: ${stats.upvotes}`,
    `   Follows: ${stats.follows}`,
    ``,
    `   Last run: ${log.lastRun || 'Never'}`,
    `   Status: ${log.isRunning ? '🟢 Running' : '🔴 Stopped'}`,
  ].join('\n');
}

export function formatRecentActivity(): string {
  const recent = getRecentActivity(10);
  
  if (recent.length === 0) {
    return 'No recent activity';
  }

  return recent.map(a => {
    const time = new Date(a.timestamp).toLocaleTimeString();
    const content = a.content ? `: ${a.content.substring(0, 50)}...` : '';
    return `[${time}] ${a.type}${content}`;
  }).join('\n');
}
