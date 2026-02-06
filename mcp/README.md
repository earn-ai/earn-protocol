# Chrome DevTools MCP Integration

This module integrates the [Chrome DevTools MCP server](https://github.com/nicholasoxford/chrome-devtools-mcp) into the Earn Protocol project, enabling AI-powered browser automation, debugging, and performance analysis.

## Overview

The Chrome DevTools MCP (Model Context Protocol) server allows AI coding assistants to control and inspect a live Chrome browser. This integration provides:

- **JavaScript Execution**: Run code in browser context
- **DOM/CSS Inspection**: Query and manipulate elements
- **Network Monitoring**: Intercept and analyze HTTP traffic
- **Console Access**: View logs and errors
- **Screenshots/PDFs**: Capture visual output
- **Performance Analysis**: Profile and trace execution

## Prerequisites

### 1. Node.js
- Node.js v20.19 or newer (LTS recommended)
- npm installed

### 2. Chrome Browser
- Chrome stable version installed
- For remote debugging: Launch Chrome with debugging enabled

### 3. Package Installation
The MCP packages are already in `devDependencies`:
```bash
npm install
```

## Configuration

### MCP Config File
The MCP server configuration is in `mcp/mcp-config.json`:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--no-usage-statistics"]
    },
    "chrome-devtools-remote": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--browser-url=http://127.0.0.1:9222",
        "--no-usage-statistics"
      ]
    }
  }
}
```

### Environment Variables
```bash
# Disable Google usage statistics collection
export CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=true

# Custom Chrome path (optional)
export CHROME_PATH=/path/to/chrome
```

## Launching Chrome with Remote Debugging

### macOS
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug
```

### Linux
```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug
```

### Windows
```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir=%TEMP%\chrome-debug
```

### Docker / Headless
```bash
google-chrome \
  --headless=new \
  --remote-debugging-port=9222 \
  --no-sandbox \
  --disable-gpu
```

## Usage Examples

### Basic Usage with TypeScript Client

```typescript
import { ChromeDevToolsClient } from './mcp/chrome-devtools-client';

async function main() {
  const client = new ChromeDevToolsClient({
    headless: true,
    noUsageStatistics: true
  });

  try {
    await client.connect();
    
    // Navigate to a page
    await client.navigate('https://example.com');
    
    // Get page title
    const title = await client.getTitle();
    console.log('Page title:', title);
    
    // Execute JavaScript
    const result = await client.evaluate('1 + 1');
    console.log('Result:', result);
    
  } finally {
    await client.disconnect();
  }
}

main();
```

### JavaScript Execution

```typescript
// Simple expression
const sum = await client.evaluate('2 + 2');

// Async execution with await
const data = await client.evaluateAsync(`
  fetch('https://api.example.com/data')
    .then(r => r.json())
`);

// Access DOM
const bodyText = await client.evaluate('document.body.innerText');
```

### DOM Inspection & Manipulation

```typescript
// Query single element
const header = await client.querySelector('h1');

// Query all elements
const links = await client.querySelectorAll('a');

// Get computed styles
const styles = await client.getComputedStyles('.my-element');
console.log('Font size:', styles['font-size']);

// Modify styles
await client.setStyle('.my-element', 'backgroundColor', 'red');

// Click element
await client.click('button.submit');

// Type into input
await client.type('input[name="email"]', 'test@example.com');

// Scroll to element
await client.scroll({ selector: '#footer' });
```

### Network Monitoring

```typescript
// Navigate and collect network requests
await client.navigate('https://example.com');
await client.wait(2000); // Wait for requests

// Get all network requests
const requests = await client.getNetworkRequests();
for (const req of requests) {
  console.log(`${req.method} ${req.url} - ${req.status}`);
}

// Clear logs
await client.clearNetworkLog();
```

### Console Logs & Errors

```typescript
// Execute code that logs
await client.evaluate('console.log("Hello from browser!")');
await client.evaluate('console.error("This is an error")');

// Get console messages
const logs = await client.getConsoleLogs();
for (const log of logs) {
  console.log(`[${log.type}] ${log.text}`);
}
```

### Screenshots & PDFs

```typescript
// Take screenshot
const screenshotBase64 = await client.screenshot({
  format: 'png',
  fullPage: true
});

// Screenshot of specific element
const elementShot = await client.screenshot({
  selector: '#main-content',
  format: 'jpeg',
  quality: 80
});

// Generate PDF
const pdfBase64 = await client.pdf({
  format: 'A4',
  printBackground: true,
  landscape: false
});
```

### Performance Analysis

```typescript
// Get basic performance metrics
const metrics = await client.getPerformanceMetrics();
console.log('DOM Content Loaded:', metrics.domContentLoaded, 'ms');
console.log('Page Load Time:', metrics.loadTime, 'ms');
console.log('First Contentful Paint:', metrics.firstContentfulPaint, 'ms');

// Performance tracing
await client.startTrace();
await client.navigate('https://example.com');
await client.wait(3000);
const trace = await client.stopTrace();

// Get detailed performance insights
const insights = await client.getPerformanceInsights();
```

## Running with AI Assistants

### Claude Desktop
Add to `~/.config/claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

### Cursor
Add to Cursor MCP settings via the install button or manually configure.

### VS Code Copilot
```bash
code --add-mcp '{"name":"chrome-devtools","command":"npx","args":["-y","chrome-devtools-mcp"]}'
```

## Available Tools

The MCP server exposes these tools:

| Tool | Description |
|------|-------------|
| `navigate` | Navigate to a URL |
| `go_back` / `go_forward` | Browser history navigation |
| `reload` | Reload current page |
| `evaluate` | Execute JavaScript |
| `click` | Click an element |
| `type` | Type text into an element |
| `hover` | Hover over an element |
| `screenshot` | Capture screenshot |
| `pdf` | Generate PDF |
| `get_network_log` | Get network requests |
| `get_console_log` | Get console messages |
| `accessibility_snapshot` | Get DOM/accessibility tree |
| `start_trace` / `stop_trace` | Performance tracing |
| `get_performance_insights` | Performance analysis |

## Troubleshooting

### Chrome not found
Set the `CHROME_PATH` environment variable:
```bash
export CHROME_PATH=/usr/bin/google-chrome
```

### Connection refused (port 9222)
1. Ensure Chrome is running with `--remote-debugging-port=9222`
2. Check if another process is using the port
3. Try a different port

### Timeout errors
Increase the startup timeout in your MCP client config:
```json
"startup_timeout_ms": 30000
```

### Sandbox errors (Linux/Docker)
Add `--no-sandbox` flag when launching Chrome:
```bash
google-chrome --no-sandbox --remote-debugging-port=9222
```

## Security Notes

⚠️ **Important**: The Chrome DevTools MCP exposes browser content to MCP clients. Avoid:
- Logging into sensitive accounts while MCP is active
- Exposing API keys or credentials in browser context
- Running on untrusted networks without proper security

## License

Apache-2.0 (chrome-devtools-mcp)
MIT (Earn Protocol integration)
