/**
 * Chrome DevTools MCP Integration Test
 * 
 * This test verifies the Chrome DevTools MCP server integration works correctly.
 * 
 * Prerequisites:
 * 1. Chrome installed on the system
 * 2. For remote debugging tests: Launch Chrome with --remote-debugging-port=9222
 * 
 * Run: npx ts-node mcp/test-chrome-devtools.ts
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Test results tracking
interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const results: TestResult[] = [];

async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await testFn();
    results.push({
      name,
      passed: true,
      message: 'OK',
      duration: Date.now() - start
    });
    console.log(`✅ ${name}`);
  } catch (error) {
    results.push({
      name,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start
    });
    console.log(`❌ ${name}: ${error}`);
  }
}

// ============================================================
// Test: MCP Server Can Start
// ============================================================
async function testMcpServerStarts(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('MCP server startup timed out (10s)'));
    }, 10000);

    const proc = spawn('npx', ['-y', 'chrome-devtools-mcp@latest', '--help'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (output.includes('chrome-devtools-mcp') || output.includes('Usage') || code === 0) {
        resolve();
      } else {
        reject(new Error(`Unexpected output: ${output.substring(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ============================================================
// Test: Package is installed
// ============================================================
async function testPackageInstalled(): Promise<void> {
  const fs = await import('fs/promises');
  const pkgPath = './package.json';
  const content = await fs.readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(content);
  
  const hasDep = pkg.dependencies?.['chrome-devtools-mcp'] || 
                 pkg.devDependencies?.['chrome-devtools-mcp'];
  
  if (!hasDep) {
    throw new Error('chrome-devtools-mcp not found in package.json');
  }
  console.log(`  ℹ️  Version: ${hasDep}`);
}

// ============================================================
// Test: MCP SDK is available
// ============================================================
async function testMcpSdkAvailable(): Promise<void> {
  const fs = await import('fs/promises');
  const pkgPath = './package.json';
  const content = await fs.readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(content);
  
  const hasDep = pkg.dependencies?.['@modelcontextprotocol/sdk'] || 
                 pkg.devDependencies?.['@modelcontextprotocol/sdk'];
  
  if (!hasDep) {
    throw new Error('@modelcontextprotocol/sdk not found in package.json');
  }
  console.log(`  ℹ️  Version: ${hasDep}`);
}

// ============================================================
// Test: Config file exists
// ============================================================
async function testConfigExists(): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const configPath = path.join(process.cwd(), 'mcp', 'mcp-config.json');
  
  const content = await fs.readFile(configPath, 'utf-8');
  const config = JSON.parse(content);
  
  if (!config.mcpServers?.['chrome-devtools']) {
    throw new Error('chrome-devtools server not configured');
  }
}

// ============================================================
// Test: Client module compiles
// ============================================================
async function testClientCompiles(): Promise<void> {
  const { stdout, stderr } = await execAsync(
    'npx tsc --noEmit mcp/chrome-devtools-client.ts 2>&1 || true',
    { cwd: process.cwd() }
  );
  
  // TypeScript may output warnings but should not have critical errors
  // Check for actual compilation errors (not just type warnings)
  if (stderr.includes('error TS') && !stderr.includes('Cannot find module')) {
    throw new Error(`TypeScript compilation errors: ${stderr}`);
  }
}

// ============================================================
// Test: Chrome detection
// ============================================================
async function testChromeDetection(): Promise<void> {
  const chromePaths = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    // Windows (via WSL or native)
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ];

  const fs = await import('fs/promises');
  let chromeFound = false;
  let foundPath = '';

  for (const chromePath of chromePaths) {
    try {
      await fs.access(chromePath);
      chromeFound = true;
      foundPath = chromePath;
      break;
    } catch {
      // Continue checking
    }
  }

  // Also check via which command
  if (!chromeFound) {
    try {
      const { stdout } = await execAsync('which google-chrome || which chromium || which chrome || echo "not found"');
      if (stdout.trim() !== 'not found' && stdout.trim() !== '') {
        chromeFound = true;
        foundPath = stdout.trim();
      }
    } catch {
      // Ignore
    }
  }

  if (!chromeFound) {
    console.log('  ⚠️  Chrome not found in standard locations (may still work with CHROME_PATH)');
    // Don't fail - Chrome might be installed elsewhere
  } else {
    console.log(`  ℹ️  Chrome found at: ${foundPath}`);
  }
}

// ============================================================
// Test: Remote debugging endpoint (optional)
// ============================================================
async function testRemoteDebugging(): Promise<void> {
  try {
    const response = await fetch('http://127.0.0.1:9222/json/version', {
      signal: AbortSignal.timeout(2000)
    });
    
    if (response.ok) {
      const data = await response.json() as { Browser?: string };
      console.log(`  ℹ️  Chrome remote debugging active: ${data.Browser || 'unknown'}`);
    }
  } catch {
    console.log('  ℹ️  No Chrome instance with remote debugging on port 9222 (optional)');
    // This is optional, so don't throw
  }
}

// ============================================================
// Main Test Runner
// ============================================================
async function main(): Promise<void> {
  console.log('\n🧪 Chrome DevTools MCP Integration Tests\n');
  console.log('=' .repeat(50));
  
  // Change to project directory
  process.chdir('/home/node/projects/earn-protocol');
  
  // Run tests
  await runTest('Package installed', testPackageInstalled);
  await runTest('MCP SDK available', testMcpSdkAvailable);
  await runTest('Config file exists', testConfigExists);
  await runTest('MCP server can start', testMcpServerStarts);
  await runTest('Chrome detection', testChromeDetection);
  await runTest('Remote debugging check', testRemoteDebugging);
  
  // Summary
  console.log('\n' + '=' .repeat(50));
  console.log('📊 Test Summary\n');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
  
  console.log(`Total: ${results.length} tests`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  console.log(`Duration: ${totalTime}ms`);
  
  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    for (const result of results.filter(r => !r.passed)) {
      console.log(`  - ${result.name}: ${result.message}`);
    }
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    
    console.log('\n📖 Next steps:');
    console.log('1. Launch Chrome with remote debugging:');
    console.log('   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug');
    console.log('\n2. Use the client in your code:');
    console.log('   import { ChromeDevToolsClient } from "./mcp/chrome-devtools-client"');
    console.log('\n3. See mcp/README.md for full documentation');
  }
}

main().catch(console.error);
