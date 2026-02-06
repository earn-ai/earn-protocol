/**
 * Chrome DevTools MCP - Basic Usage Examples
 * 
 * This file demonstrates the core capabilities of the Chrome DevTools MCP integration.
 * 
 * Prerequisites:
 * 1. Install dependencies: npm install
 * 2. Launch Chrome with debugging: 
 *    google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
 * 
 * Run: npx ts-node mcp/examples/basic-usage.ts
 */

import { spawn } from 'child_process';

// Helper to run MCP server and execute commands
async function runMcpExample(): Promise<void> {
  console.log('🚀 Chrome DevTools MCP - Basic Usage Examples\n');
  console.log('=' .repeat(60));
  
  // Example 1: JavaScript Execution
  console.log('\n📌 Example 1: JavaScript Execution');
  console.log('-'.repeat(40));
  console.log(`
// Execute JavaScript in browser context
await client.evaluate('2 + 2');                    // => 4
await client.evaluate('document.title');           // => page title
await client.evaluate('window.location.href');     // => current URL

// Async execution
await client.evaluateAsync(\`
  fetch('https://api.example.com/data')
    .then(r => r.json())
\`);
`);

  // Example 2: DOM Inspection
  console.log('\n📌 Example 2: DOM/CSS Inspection');
  console.log('-'.repeat(40));
  console.log(`
// Query elements
const header = await client.querySelector('h1');
const links = await client.querySelectorAll('a[href]');

// Get computed styles
const styles = await client.getComputedStyles('.button');
console.log('Background:', styles['background-color']);

// Modify styles
await client.setStyle('.button', 'backgroundColor', '#ff0000');
await client.setStyle('#logo', 'transform', 'rotate(180deg)');
`);

  // Example 3: User Interactions
  console.log('\n📌 Example 3: User Interactions');
  console.log('-'.repeat(40));
  console.log(`
// Click elements
await client.click('button.submit');
await client.click('#login-btn');

// Type text
await client.type('input[name="email"]', 'user@example.com');
await client.type('#search', 'search query');

// Hover
await client.hover('.dropdown-trigger');

// Scroll
await client.scroll({ selector: '#footer' });
await client.scroll({ y: 1000 });
`);

  // Example 4: Network Monitoring
  console.log('\n📌 Example 4: Network Monitoring');
  console.log('-'.repeat(40));
  console.log(`
// Navigate and collect requests
await client.navigate('https://example.com');
await client.wait(2000);

// Get network log
const requests = await client.getNetworkRequests();
for (const req of requests) {
  console.log(\`\${req.method} \${req.url} - \${req.status}\`);
}

// Filter by type
const apiCalls = requests.filter(r => r.url.includes('/api/'));
const images = requests.filter(r => r.url.match(/\\.(png|jpg|gif)/));
`);

  // Example 5: Console Logs
  console.log('\n📌 Example 5: Console Logs & Errors');
  console.log('-'.repeat(40));
  console.log(`
// Inject console logs
await client.evaluate('console.log("Hello from MCP!")');
await client.evaluate('console.error("Test error")');

// Read console messages
const logs = await client.getConsoleLogs();
for (const log of logs) {
  console.log(\`[\${log.type}] \${log.text}\`);
}

// Filter errors
const errors = logs.filter(l => l.type === 'error');
`);

  // Example 6: Screenshots & PDFs
  console.log('\n📌 Example 6: Screenshots & PDFs');
  console.log('-'.repeat(40));
  console.log(`
// Full page screenshot
const screenshot = await client.screenshot({
  format: 'png',
  fullPage: true
});

// Element screenshot
const elementShot = await client.screenshot({
  selector: '#hero-section',
  format: 'jpeg',
  quality: 85
});

// Generate PDF
const pdf = await client.pdf({
  format: 'A4',
  printBackground: true,
  landscape: false
});

// Save to file
import { writeFileSync } from 'fs';
writeFileSync('page.png', Buffer.from(screenshot, 'base64'));
writeFileSync('page.pdf', Buffer.from(pdf, 'base64'));
`);

  // Example 7: Performance Analysis
  console.log('\n📌 Example 7: Performance Analysis');
  console.log('-'.repeat(40));
  console.log(`
// Get performance metrics
const metrics = await client.getPerformanceMetrics();
console.log('DOM Content Loaded:', metrics.domContentLoaded, 'ms');
console.log('Page Load Time:', metrics.loadTime, 'ms');
console.log('First Contentful Paint:', metrics.firstContentfulPaint, 'ms');

// Performance tracing
await client.startTrace();
await client.navigate('https://example.com');
await client.wait(3000);
const trace = await client.stopTrace();

// Get detailed insights
const insights = await client.getPerformanceInsights();
`);

  // Example 8: Complete Workflow
  console.log('\n📌 Example 8: Complete Automation Workflow');
  console.log('-'.repeat(40));
  console.log(`
import { ChromeDevToolsClient } from '../chrome-devtools-client';

async function automateLogin() {
  const client = new ChromeDevToolsClient({
    browserUrl: 'http://127.0.0.1:9222',
    noUsageStatistics: true
  });

  try {
    await client.connect();
    
    // Navigate to login page
    await client.navigate('https://app.example.com/login');
    await client.waitForSelector('input[name="email"]');
    
    // Fill login form
    await client.type('input[name="email"]', 'user@example.com');
    await client.type('input[name="password"]', 'secret123');
    
    // Submit
    await client.click('button[type="submit"]');
    await client.waitForNavigation();
    
    // Verify login
    const url = await client.getCurrentUrl();
    if (url.includes('/dashboard')) {
      console.log('✅ Login successful!');
      
      // Take screenshot
      const shot = await client.screenshot({ fullPage: true });
      console.log('Screenshot captured');
    }
    
    // Check for errors
    const logs = await client.getConsoleLogs();
    const errors = logs.filter(l => l.type === 'error');
    if (errors.length > 0) {
      console.warn('⚠️ Console errors detected:', errors);
    }
    
  } finally {
    await client.disconnect();
  }
}
`);

  console.log('\n' + '='.repeat(60));
  console.log('📖 Full documentation: mcp/README.md');
  console.log('🔧 Configuration: mcp/mcp-config.json');
  console.log('✅ Tests: npm run mcp:test');
}

runMcpExample().catch(console.error);
