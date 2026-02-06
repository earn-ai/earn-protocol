/**
 * Chrome DevTools MCP Integration
 * 
 * This module provides programmatic access to Chrome DevTools via the 
 * Model Context Protocol (MCP) server.
 * 
 * @example
 * ```typescript
 * import { ChromeDevToolsClient } from '@earn-protocol/sdk/mcp';
 * 
 * const client = new ChromeDevToolsClient({ headless: true });
 * await client.connect();
 * await client.navigate('https://example.com');
 * const title = await client.getTitle();
 * await client.disconnect();
 * ```
 * 
 * @see ./README.md for full documentation
 */

export {
  ChromeDevToolsClient,
  type ChromeDevToolsConfig,
  type ScreenshotOptions,
  type NetworkRequest,
  type ConsoleMessage,
  type PerformanceMetrics
} from './chrome-devtools-client';

// Re-export config path for convenience
export const MCP_CONFIG_PATH = './mcp/mcp-config.json';
