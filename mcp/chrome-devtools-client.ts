/**
 * Chrome DevTools MCP Client
 * 
 * A TypeScript wrapper for interacting with Chrome via the Chrome DevTools MCP server.
 * Provides programmatic access to browser automation, debugging, and performance analysis.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, ChildProcess } from 'child_process';

export interface ChromeDevToolsConfig {
  /** Browser WebSocket URL for remote debugging (default: auto-launch Chrome) */
  browserUrl?: string;
  /** Headless mode (default: true) */
  headless?: boolean;
  /** Disable usage statistics (default: true) */
  noUsageStatistics?: boolean;
  /** Custom Chrome executable path */
  chromePath?: string;
}

export interface ScreenshotOptions {
  /** Output format: 'png' | 'jpeg' | 'webp' */
  format?: 'png' | 'jpeg' | 'webp';
  /** Quality for jpeg/webp (0-100) */
  quality?: number;
  /** Capture full page */
  fullPage?: boolean;
  /** Capture specific element by selector */
  selector?: string;
}

export interface NetworkRequest {
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  headers: Record<string, string>;
  responseHeaders?: Record<string, string>;
  timing?: {
    requestTime: number;
    responseStart: number;
    responseEnd: number;
  };
}

export interface ConsoleMessage {
  type: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
  url?: string;
  lineNumber?: number;
  timestamp: number;
}

export interface PerformanceMetrics {
  domContentLoaded: number;
  loadTime: number;
  firstContentfulPaint?: number;
  largestContentfulPaint?: number;
  cumulativeLayoutShift?: number;
  totalBlockingTime?: number;
}

export class ChromeDevToolsClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private mcpProcess: ChildProcess | null = null;
  private config: ChromeDevToolsConfig;
  private isConnected = false;

  constructor(config: ChromeDevToolsConfig = {}) {
    this.config = {
      headless: true,
      noUsageStatistics: true,
      ...config
    };
  }

  /**
   * Connect to Chrome DevTools MCP server
   */
  async connect(): Promise<void> {
    if (this.isConnected) return;

    const args = ['-y', 'chrome-devtools-mcp@latest'];
    
    if (this.config.browserUrl) {
      args.push(`--browser-url=${this.config.browserUrl}`);
    }
    
    if (this.config.noUsageStatistics) {
      args.push('--no-usage-statistics');
    }

    if (this.config.headless === false) {
      args.push('--no-headless');
    }

    // Spawn the MCP server process
    this.mcpProcess = spawn('npx', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: this.config.noUsageStatistics ? 'true' : ''
      }
    });

    // Create transport and client
    this.transport = new StdioClientTransport({
      command: 'npx',
      args
    });

    this.client = new Client(
      { name: 'earn-protocol-chrome-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
    this.isConnected = true;
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    if (this.mcpProcess) {
      this.mcpProcess.kill();
      this.mcpProcess = null;
    }
    this.isConnected = false;
  }

  /**
   * Call an MCP tool
   */
  private async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.client || !this.isConnected) {
      throw new Error('Not connected to Chrome DevTools MCP server');
    }

    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  // ============================================================
  // Navigation & Page Control
  // ============================================================

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<void> {
    await this.callTool('navigate', { url });
  }

  /**
   * Go back in browser history
   */
  async goBack(): Promise<void> {
    await this.callTool('go_back', {});
  }

  /**
   * Go forward in browser history
   */
  async goForward(): Promise<void> {
    await this.callTool('go_forward', {});
  }

  /**
   * Reload the current page
   */
  async reload(ignoreCache = false): Promise<void> {
    await this.callTool('reload', { ignoreCache });
  }

  // ============================================================
  // JavaScript Execution
  // ============================================================

  /**
   * Execute JavaScript in the browser context
   */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.callTool('evaluate', { expression });
    return result as T;
  }

  /**
   * Execute JavaScript with await support
   */
  async evaluateAsync<T = unknown>(expression: string): Promise<T> {
    const result = await this.callTool('evaluate', { 
      expression,
      awaitPromise: true 
    });
    return result as T;
  }

  // ============================================================
  // DOM Inspection & Manipulation
  // ============================================================

  /**
   * Get the DOM snapshot/accessibility tree
   */
  async getAccessibilityTree(): Promise<unknown> {
    return await this.callTool('accessibility_snapshot', {});
  }

  /**
   * Query DOM elements by selector
   */
  async querySelector(selector: string): Promise<unknown> {
    return await this.evaluate(`document.querySelector('${selector}')`);
  }

  /**
   * Query all matching DOM elements
   */
  async querySelectorAll(selector: string): Promise<unknown> {
    return await this.evaluate(`
      Array.from(document.querySelectorAll('${selector}')).map(el => ({
        tagName: el.tagName,
        id: el.id,
        className: el.className,
        textContent: el.textContent?.substring(0, 100)
      }))
    `);
  }

  /**
   * Get element's computed styles
   */
  async getComputedStyles(selector: string): Promise<Record<string, string>> {
    return await this.evaluate(`
      (() => {
        const el = document.querySelector('${selector}');
        if (!el) return null;
        const styles = window.getComputedStyle(el);
        const result = {};
        for (let i = 0; i < styles.length; i++) {
          const prop = styles[i];
          result[prop] = styles.getPropertyValue(prop);
        }
        return result;
      })()
    `);
  }

  /**
   * Modify element's style
   */
  async setStyle(selector: string, property: string, value: string): Promise<void> {
    await this.evaluate(`
      document.querySelector('${selector}').style['${property}'] = '${value}'
    `);
  }

  /**
   * Click an element
   */
  async click(selector: string): Promise<void> {
    await this.callTool('click', { selector });
  }

  /**
   * Type text into an input element
   */
  async type(selector: string, text: string): Promise<void> {
    await this.callTool('type', { selector, text });
  }

  /**
   * Hover over an element
   */
  async hover(selector: string): Promise<void> {
    await this.callTool('hover', { selector });
  }

  /**
   * Scroll to an element or position
   */
  async scroll(options: { selector?: string; x?: number; y?: number }): Promise<void> {
    if (options.selector) {
      await this.evaluate(`document.querySelector('${options.selector}').scrollIntoView()`);
    } else {
      await this.evaluate(`window.scrollTo(${options.x || 0}, ${options.y || 0})`);
    }
  }

  // ============================================================
  // Network Monitoring
  // ============================================================

  /**
   * Get network requests log
   */
  async getNetworkRequests(): Promise<NetworkRequest[]> {
    const result = await this.callTool('get_network_log', {});
    return result as NetworkRequest[];
  }

  /**
   * Clear network log
   */
  async clearNetworkLog(): Promise<void> {
    await this.callTool('clear_network_log', {});
  }

  /**
   * Intercept and modify network requests (requires setup)
   */
  async setRequestInterception(patterns: string[]): Promise<void> {
    await this.callTool('set_request_interception', { patterns });
  }

  // ============================================================
  // Console & Errors
  // ============================================================

  /**
   * Get console messages
   */
  async getConsoleLogs(): Promise<ConsoleMessage[]> {
    const result = await this.callTool('get_console_log', {});
    return result as ConsoleMessage[];
  }

  /**
   * Clear console log
   */
  async clearConsoleLogs(): Promise<void> {
    await this.callTool('clear_console_log', {});
  }

  // ============================================================
  // Screenshots & PDFs
  // ============================================================

  /**
   * Take a screenshot
   */
  async screenshot(options: ScreenshotOptions = {}): Promise<string> {
    const result = await this.callTool('screenshot', {
      format: options.format || 'png',
      quality: options.quality,
      fullPage: options.fullPage,
      selector: options.selector
    });
    return result as string;
  }

  /**
   * Generate PDF of the page
   */
  async pdf(options: {
    path?: string;
    format?: 'A4' | 'Letter' | 'Legal';
    landscape?: boolean;
    printBackground?: boolean;
  } = {}): Promise<string> {
    const result = await this.callTool('pdf', {
      format: options.format || 'A4',
      landscape: options.landscape || false,
      printBackground: options.printBackground || true
    });
    return result as string;
  }

  // ============================================================
  // Performance Analysis
  // ============================================================

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const result = await this.evaluate(`
      (() => {
        const timing = performance.timing;
        const paint = performance.getEntriesByType('paint');
        const fcp = paint.find(e => e.name === 'first-contentful-paint');
        
        return {
          domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
          loadTime: timing.loadEventEnd - timing.navigationStart,
          firstContentfulPaint: fcp ? fcp.startTime : null
        };
      })()
    `);
    return result as PerformanceMetrics;
  }

  /**
   * Start performance tracing
   */
  async startTrace(): Promise<void> {
    await this.callTool('start_trace', {});
  }

  /**
   * Stop tracing and get results
   */
  async stopTrace(): Promise<unknown> {
    return await this.callTool('stop_trace', {});
  }

  /**
   * Get performance insights (CPU, memory, etc.)
   */
  async getPerformanceInsights(): Promise<unknown> {
    return await this.callTool('get_performance_insights', {});
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Wait for a specific amount of time
   */
  async wait(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for an element to appear
   */
  async waitForSelector(selector: string, timeout = 30000): Promise<void> {
    await this.callTool('wait_for_selector', { selector, timeout });
  }

  /**
   * Wait for navigation to complete
   */
  async waitForNavigation(): Promise<void> {
    await this.callTool('wait_for_navigation', {});
  }

  /**
   * Get current URL
   */
  async getCurrentUrl(): Promise<string> {
    return await this.evaluate('window.location.href');
  }

  /**
   * Get page title
   */
  async getTitle(): Promise<string> {
    return await this.evaluate('document.title');
  }

  /**
   * Get page HTML
   */
  async getPageHTML(): Promise<string> {
    return await this.evaluate('document.documentElement.outerHTML');
  }

  /**
   * Get list of available tools from the MCP server
   */
  async listTools(): Promise<unknown> {
    if (!this.client) {
      throw new Error('Not connected');
    }
    return await this.client.listTools();
  }
}

export default ChromeDevToolsClient;
