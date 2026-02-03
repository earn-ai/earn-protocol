import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
} from '@solana/spl-token';

// Jupiter API endpoints
const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_API = 'https://quote-api.jup.ag/v6/swap';

export interface SwapRequest {
  tokenMint: string;           // Earn-registered token
  inputMint: string;           // What user is selling
  outputMint: string;          // What user is buying
  amount: number;              // Input amount in smallest unit
  userPublicKey: string;       // User's wallet
  slippageBps?: number;        // Default 100 (1%)
  priorityFee?: number;        // Compute unit price in microlamports
}

export interface SwapResponse {
  transaction: string;         // Base64 serialized transaction
  quote: {
    inputAmount: number;
    outputAmount: number;      // Net output after fees
    feeAmount: number;
    feeSplits: {
      protocol: number;
      creator: number;
      buyback: number;
      stakers: number;
    };
    priceImpact: number;
    route: string[];           // Jupiter route labels
  };
  expiresAt: number;           // Unix timestamp (1 min expiry)
}

export interface SwapError {
  error: string;
  code: 'TOKEN_NOT_REGISTERED' | 'INSUFFICIENT_LIQUIDITY' | 'SLIPPAGE_EXCEEDED' | 'QUOTE_FAILED';
  details?: any;
}

export interface TokenConfig {
  tokenMint: string;
  creator: string;
  feePercent: number;
  earnCut: number;
  creatorCut: number;
  buybackPercent: number;
  stakingPercent: number;
  treasuryAddress?: string;
  stakingPoolAddress?: string;
}

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
  contextSlot?: number;
  timeTaken?: number;
}

export class SwapBuilder {
  private connection: Connection;
  private earnProtocolWallet: PublicKey;
  
  constructor(connection: Connection, earnProtocolWallet: string) {
    this.connection = connection;
    this.earnProtocolWallet = new PublicKey(earnProtocolWallet);
  }

  /**
   * Get quote from Jupiter
   */
  async getJupiterQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 100
  ): Promise<JupiterQuote> {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString(),
      swapMode: 'ExactIn',
    });

    const response = await fetch(`${JUPITER_QUOTE_API}?${params}`);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter quote failed: ${error}`);
    }

    const data = await response.json() as JupiterQuote;
    return data;
  }

  /**
   * Get swap transaction from Jupiter
   */
  async getJupiterSwapTransaction(
    quote: JupiterQuote,
    userPublicKey: string,
    priorityFee?: number
  ): Promise<{ swapTransaction: string; lastValidBlockHeight: number }> {
    const body: any = {
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    };

    if (priorityFee) {
      body.prioritizationFeeLamports = priorityFee;
    }

    const response = await fetch(JUPITER_SWAP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter swap failed: ${error}`);
    }

    const data = await response.json() as { swapTransaction: string; lastValidBlockHeight: number };
    return data;
  }

  /**
   * Build fee collection instructions
   * These get appended to the Jupiter swap transaction
   */
  async buildFeeInstructions(
    tokenMint: PublicKey,
    userPublicKey: PublicKey,
    outputAmount: bigint,
    config: TokenConfig
  ): Promise<TransactionInstruction[]> {
    const instructions: TransactionInstruction[] = [];
    
    // Calculate fee amount
    const feePercent = config.feePercent / 100; // e.g., 2 = 2%
    const totalFee = (outputAmount * BigInt(Math.floor(feePercent * 100))) / 10000n;
    
    if (totalFee === 0n) {
      return instructions;
    }

    // Calculate splits (in basis points, out of 10000)
    const earnShare = (totalFee * BigInt(config.earnCut * 100)) / 10000n;
    const creatorShare = (totalFee * BigInt(config.creatorCut * 100)) / 10000n;
    const buybackShare = (totalFee * BigInt(config.buybackPercent * 100)) / 10000n;
    const stakingShare = totalFee - earnShare - creatorShare - buybackShare;

    // Get user's token account
    const userTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      userPublicKey
    );

    // Earn Protocol's token account
    const earnTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      this.earnProtocolWallet
    );

    // Creator's token account
    const creatorPubkey = new PublicKey(config.creator);
    const creatorTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      creatorPubkey
    );

    // Treasury (for buybacks) - use creator for now, should be PDA
    const treasuryPubkey = config.treasuryAddress 
      ? new PublicKey(config.treasuryAddress)
      : creatorPubkey;
    const treasuryTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      treasuryPubkey
    );

    // Staking pool - use creator for now, should be PDA
    const stakingPoolPubkey = config.stakingPoolAddress
      ? new PublicKey(config.stakingPoolAddress)
      : creatorPubkey;
    const stakingPoolTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      stakingPoolPubkey
    );

    // Add transfer instructions for each split
    if (earnShare > 0n) {
      instructions.push(
        createTransferInstruction(
          userTokenAccount,
          earnTokenAccount,
          userPublicKey,
          earnShare,
          [],
          TOKEN_PROGRAM_ID
        )
      );
    }

    if (creatorShare > 0n) {
      instructions.push(
        createTransferInstruction(
          userTokenAccount,
          creatorTokenAccount,
          userPublicKey,
          creatorShare,
          [],
          TOKEN_PROGRAM_ID
        )
      );
    }

    if (buybackShare > 0n) {
      instructions.push(
        createTransferInstruction(
          userTokenAccount,
          treasuryTokenAccount,
          userPublicKey,
          buybackShare,
          [],
          TOKEN_PROGRAM_ID
        )
      );
    }

    if (stakingShare > 0n) {
      instructions.push(
        createTransferInstruction(
          userTokenAccount,
          stakingPoolTokenAccount,
          userPublicKey,
          stakingShare,
          [],
          TOKEN_PROGRAM_ID
        )
      );
    }

    return instructions;
  }

  /**
   * Build complete swap + fee transaction
   */
  async buildSwapWithFees(
    request: SwapRequest,
    config: TokenConfig
  ): Promise<SwapResponse> {
    const userPubkey = new PublicKey(request.userPublicKey);
    const slippageBps = request.slippageBps || 100;

    // 1. Get Jupiter quote
    const quote = await this.getJupiterQuote(
      request.inputMint,
      request.outputMint,
      request.amount,
      slippageBps
    );

    // 2. Get Jupiter swap transaction
    const { swapTransaction, lastValidBlockHeight } = await this.getJupiterSwapTransaction(
      quote,
      request.userPublicKey,
      request.priorityFee
    );

    // 3. Deserialize Jupiter transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    const jupiterTx = VersionedTransaction.deserialize(swapTransactionBuf);

    // 4. Calculate fee amounts
    const outputAmount = BigInt(quote.outAmount);
    const feePercent = config.feePercent / 100;
    const totalFee = (outputAmount * BigInt(Math.floor(feePercent * 100))) / 10000n;
    
    const earnShare = (totalFee * BigInt(config.earnCut * 100)) / 10000n;
    const creatorShare = (totalFee * BigInt(config.creatorCut * 100)) / 10000n;
    const buybackShare = (totalFee * BigInt(config.buybackPercent * 100)) / 10000n;
    const stakingShare = totalFee - earnShare - creatorShare - buybackShare;

    // 5. Build fee instructions
    const tokenMint = new PublicKey(
      request.outputMint === config.tokenMint ? request.outputMint : request.inputMint
    );
    
    const feeInstructions = await this.buildFeeInstructions(
      tokenMint,
      userPubkey,
      outputAmount,
      config
    );

    // 6. Combine transactions
    // For VersionedTransaction, we need to create a new transaction with combined instructions
    // This is complex because Jupiter uses lookup tables - for now, return them separately
    // and let the client combine, or use legacy transactions
    
    // Get recent blockhash
    const { blockhash, lastValidBlockHeight: newBlockHeight } = 
      await this.connection.getLatestBlockhash();

    // Create legacy transaction with fee instructions
    const feeTransaction = new Transaction();
    feeTransaction.recentBlockhash = blockhash;
    feeTransaction.feePayer = userPubkey;
    feeInstructions.forEach(ix => feeTransaction.add(ix));

    // Serialize fee transaction
    const feeTransactionBase64 = feeTransaction
      .serialize({ requireAllSignatures: false })
      .toString('base64');

    // Extract route labels
    const routeLabels = quote.routePlan?.map((r: any) => r.swapInfo?.label || 'Unknown') || [];
    const netOutput = Number(outputAmount - totalFee);

    return {
      // Note: This returns Jupiter transaction only - fee instructions separate
      // Use buildAtomicSwapWithFees for combined atomic transaction
      transaction: swapTransaction,
      quote: {
        inputAmount: request.amount,
        outputAmount: netOutput,
        feeAmount: Number(totalFee),
        feeSplits: {
          protocol: Number(earnShare),
          creator: Number(creatorShare),
          buyback: Number(buybackShare),
          stakers: Number(stakingShare),
        },
        priceImpact: parseFloat(quote.priceImpactPct || '0'),
        route: routeLabels,
      },
      expiresAt: Date.now() + 60000,
    };
  }

  /**
   * Build swap + fee as atomic transaction (legacy format)
   * This combines everything into one transaction the user signs
   */
  async buildAtomicSwapWithFees(
    request: SwapRequest,
    config: TokenConfig
  ): Promise<SwapResponse> {
    const userPubkey = new PublicKey(request.userPublicKey);
    const slippageBps = request.slippageBps || 100;

    // 1. Get Jupiter quote
    const quote = await this.getJupiterQuote(
      request.inputMint,
      request.outputMint,
      request.amount,
      slippageBps
    );

    // 2. Get Jupiter swap instructions (not full transaction)
    const jupiterResponse = await fetch('https://quote-api.jup.ag/v6/swap-instructions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: request.userPublicKey,
        wrapAndUnwrapSol: true,
      }),
    });

    if (!jupiterResponse.ok) {
      // Fall back to regular swap if instructions API fails
      return this.buildSwapWithFees(request, config);
    }

    interface JupiterSwapInstructions {
      setupInstructions?: any[];
      swapInstruction?: any;
      cleanupInstruction?: any;
      addressLookupTableAddresses?: string[];
    }
    
    const jupiterInstructions: JupiterSwapInstructions = await jupiterResponse.json();

    // 3. Calculate fee amounts
    const outputAmount = BigInt(quote.outAmount);
    const feePercent = config.feePercent / 100;
    const totalFee = (outputAmount * BigInt(Math.floor(feePercent * 100))) / 10000n;
    
    const earnShare = (totalFee * BigInt(config.earnCut * 100)) / 10000n;
    const creatorShare = (totalFee * BigInt(config.creatorCut * 100)) / 10000n;
    const buybackShare = (totalFee * BigInt(config.buybackPercent * 100)) / 10000n;
    const stakingShare = totalFee - earnShare - creatorShare - buybackShare;

    // 4. Build fee instructions
    const tokenMint = new PublicKey(
      request.outputMint === config.tokenMint ? request.outputMint : request.inputMint
    );
    
    const feeInstructions = await this.buildFeeInstructions(
      tokenMint,
      userPubkey,
      outputAmount,
      config
    );

    // 5. Combine all instructions into one transaction
    const { blockhash, lastValidBlockHeight } = 
      await this.connection.getLatestBlockhash();

    // Deserialize Jupiter instructions
    const deserializeInstruction = (ix: any): TransactionInstruction => {
      return new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map((acc: any) => ({
          pubkey: new PublicKey(acc.pubkey),
          isSigner: acc.isSigner,
          isWritable: acc.isWritable,
        })),
        data: Buffer.from(ix.data, 'base64'),
      });
    };

    const transaction = new Transaction();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPubkey;

    // Add setup instructions (if any)
    if (jupiterInstructions.setupInstructions) {
      jupiterInstructions.setupInstructions.forEach((ix: any) => {
        transaction.add(deserializeInstruction(ix));
      });
    }

    // Add swap instruction
    if (jupiterInstructions.swapInstruction) {
      transaction.add(deserializeInstruction(jupiterInstructions.swapInstruction));
    }

    // Add fee collection instructions (AFTER swap)
    feeInstructions.forEach(ix => transaction.add(ix));

    // Add cleanup instructions (if any)
    if (jupiterInstructions.cleanupInstruction) {
      transaction.add(deserializeInstruction(jupiterInstructions.cleanupInstruction));
    }

    // Serialize
    const serializedTx = transaction
      .serialize({ requireAllSignatures: false })
      .toString('base64');

    // Extract route labels from Jupiter route plan
    const routeLabels = quote.routePlan?.map((r: any) => r.swapInfo?.label || 'Unknown') || [];

    // Net output after fees
    const netOutput = Number(outputAmount - totalFee);

    return {
      transaction: serializedTx,
      quote: {
        inputAmount: request.amount,
        outputAmount: netOutput,
        feeAmount: Number(totalFee),
        feeSplits: {
          protocol: Number(earnShare),
          creator: Number(creatorShare),
          buyback: Number(buybackShare),
          stakers: Number(stakingShare),
        },
        priceImpact: parseFloat(quote.priceImpactPct || '0'),
        route: routeLabels,
      },
      expiresAt: Date.now() + 60000, // 1 minute expiry
    };
  }
}

export default SwapBuilder;
