/**
 * Helius API Integration
 * 
 * Solana-native data: token metadata, balances, transactions via DAS API.
 * 
 * AI agents can self-provision keys:
 *   npm install -g helius-cli && helius login
 * 
 * Or get a key at: https://dev.helius.xyz
 * 
 * Set HELIUS_API_KEY in environment variables.
 * RPC URL: https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
 * DAS URL: https://api.helius.xyz/v0
 */

// Types
export interface TokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  image?: string;
  description?: string;
  attributes?: Record<string, any>;
  creators?: Array<{ address: string; share: number }>;
  royaltyBps?: number;
  supply?: bigint;
}

export interface TokenBalance {
  mint: string;
  owner: string;
  amount: bigint;
  decimals: number;
  uiAmount: number;
}

export interface TransactionInfo {
  signature: string;
  slot: number;
  timestamp: number;
  type: string;
  fee: number;
  status: 'success' | 'failed';
  accounts: string[];
}

// ============ CONFIG ============

function getHeliusConfig() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    return null;
  }
  
  return {
    apiKey,
    rpcUrl: `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
    dasUrl: `https://api.helius.xyz/v0`,
  };
}

export function isHeliusConfigured(): boolean {
  return !!process.env.HELIUS_API_KEY;
}

export function getHeliusRpcUrl(): string | null {
  const config = getHeliusConfig();
  return config?.rpcUrl || null;
}

// ============ DAS API (Digital Asset Standard) ============

async function fetchDas(method: string, params: any): Promise<any> {
  const config = getHeliusConfig();
  if (!config) {
    throw new Error('HELIUS_API_KEY not configured');
  }
  
  const response = await fetch(`${config.dasUrl}/${method}?api-key=${config.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) {
    throw new Error(`Helius DAS error: ${response.status}`);
  }
  
  return response.json();
}

async function fetchRpc(method: string, params: any[]): Promise<any> {
  const config = getHeliusConfig();
  if (!config) {
    throw new Error('HELIUS_API_KEY not configured');
  }
  
  const response = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Helius RPC error: ${response.status}`);
  }
  
  const data = await response.json();
  if (data.error) {
    throw new Error(`Helius RPC error: ${data.error.message}`);
  }
  
  return data.result;
}

// ============ TOKEN METADATA ============

export async function getTokenMetadata(mint: string): Promise<TokenMetadata | null> {
  try {
    const data = await fetchDas('getAsset', { id: mint });
    
    if (!data) {
      return null;
    }
    
    return {
      mint,
      name: data.content?.metadata?.name || 'Unknown',
      symbol: data.content?.metadata?.symbol || 'UNK',
      decimals: data.token_info?.decimals || 9,
      image: data.content?.links?.image || data.content?.files?.[0]?.uri,
      description: data.content?.metadata?.description,
      attributes: data.content?.metadata?.attributes,
      creators: data.creators?.map((c: any) => ({
        address: c.address,
        share: c.share,
      })),
      royaltyBps: data.royalty?.basis_points,
      supply: data.token_info?.supply ? BigInt(data.token_info.supply) : undefined,
    };
  } catch (e) {
    console.error(`Helius getAsset failed for ${mint}:`, e);
    return null;
  }
}

export async function getMultipleTokenMetadata(mints: string[]): Promise<Map<string, TokenMetadata>> {
  const results = new Map<string, TokenMetadata>();
  
  try {
    const data = await fetchDas('getAssetBatch', { ids: mints });
    
    if (Array.isArray(data)) {
      for (const asset of data) {
        if (asset?.id) {
          results.set(asset.id, {
            mint: asset.id,
            name: asset.content?.metadata?.name || 'Unknown',
            symbol: asset.content?.metadata?.symbol || 'UNK',
            decimals: asset.token_info?.decimals || 9,
            image: asset.content?.links?.image || asset.content?.files?.[0]?.uri,
            description: asset.content?.metadata?.description,
            creators: asset.creators?.map((c: any) => ({
              address: c.address,
              share: c.share,
            })),
          });
        }
      }
    }
  } catch (e) {
    console.error('Helius getAssetBatch failed:', e);
  }
  
  return results;
}

// ============ TOKEN BALANCES ============

export async function getTokenBalances(owner: string): Promise<TokenBalance[]> {
  try {
    const result = await fetchRpc('getTokenAccountsByOwner', [
      owner,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' },
    ]);
    
    if (!result?.value) {
      return [];
    }
    
    return result.value.map((account: any) => {
      const info = account.account.data.parsed.info;
      return {
        mint: info.mint,
        owner: info.owner,
        amount: BigInt(info.tokenAmount.amount),
        decimals: info.tokenAmount.decimals,
        uiAmount: info.tokenAmount.uiAmount || 0,
      };
    });
  } catch (e) {
    console.error(`Helius getTokenAccountsByOwner failed for ${owner}:`, e);
    return [];
  }
}

export async function getTokenBalance(mint: string, owner: string): Promise<TokenBalance | null> {
  const balances = await getTokenBalances(owner);
  return balances.find(b => b.mint === mint) || null;
}

// ============ TRANSACTIONS ============

export async function getRecentTransactions(
  address: string, 
  limit: number = 10
): Promise<TransactionInfo[]> {
  try {
    // Get signatures
    const signatures = await fetchRpc('getSignaturesForAddress', [
      address,
      { limit },
    ]);
    
    if (!signatures || signatures.length === 0) {
      return [];
    }
    
    // Get transaction details
    const txs: TransactionInfo[] = [];
    
    for (const sig of signatures) {
      try {
        const tx = await fetchRpc('getTransaction', [
          sig.signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
        ]);
        
        if (tx) {
          txs.push({
            signature: sig.signature,
            slot: tx.slot,
            timestamp: tx.blockTime || 0,
            type: parseTransactionType(tx),
            fee: tx.meta?.fee || 0,
            status: tx.meta?.err ? 'failed' : 'success',
            accounts: tx.transaction?.message?.accountKeys?.map((k: any) => 
              typeof k === 'string' ? k : k.pubkey
            ) || [],
          });
        }
      } catch (e) {
        // Skip failed transaction fetches
      }
    }
    
    return txs;
  } catch (e) {
    console.error(`Helius getSignaturesForAddress failed for ${address}:`, e);
    return [];
  }
}

function parseTransactionType(tx: any): string {
  // Simple heuristic - could be expanded
  const instructions = tx.transaction?.message?.instructions || [];
  
  for (const ix of instructions) {
    if (ix.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
      if (ix.parsed?.type) {
        return ix.parsed.type; // transfer, mint, burn, etc.
      }
    }
  }
  
  return 'unknown';
}

// ============ ACCOUNT INFO ============

export async function getAccountInfo(address: string): Promise<any> {
  try {
    return await fetchRpc('getAccountInfo', [
      address,
      { encoding: 'jsonParsed' },
    ]);
  } catch (e) {
    console.error(`Helius getAccountInfo failed for ${address}:`, e);
    return null;
  }
}

export async function getSolBalance(address: string): Promise<number> {
  try {
    const result = await fetchRpc('getBalance', [address]);
    return (result || 0) / 1e9; // Convert lamports to SOL
  } catch (e) {
    console.error(`Helius getBalance failed for ${address}:`, e);
    return 0;
  }
}
