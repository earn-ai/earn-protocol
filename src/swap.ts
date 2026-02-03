import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
  getMint,
} from '@solana/spl-token';

// Constants
const SOL_MINT = 'So11111111111111111111111111111111111111112';

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
   * Append instructions to a VersionedTransaction
   * This is the key method for atomic swap + fee collection
   */
  async appendToVersionedTransaction(
    versionedTx: VersionedTransaction,
    additionalInstructions: TransactionInstruction[],
    payer: PublicKey
  ): Promise<VersionedTransaction> {
    // Get the message from the versioned transaction
    const message = versionedTx.message;
    
    // Fetch address lookup tables if present
    const lookupTableAccounts: AddressLookupTableAccount[] = [];
    if (message.addressTableLookups && message.addressTableLookups.length > 0) {
      for (const lookup of message.addressTableLookups) {
        const accountInfo = await this.connection.getAddressLookupTable(lookup.accountKey);
        if (accountInfo.value) {
          lookupTableAccounts.push(accountInfo.value);
        }
      }
    }

    // Decompile the message to get instructions
    const decompiledInstructions = TransactionMessage.decompile(message, {
      addressLookupTableAccounts: lookupTableAccounts,
    }).instructions;

    // Combine all instructions
    const allInstructions = [...decompiledInstructions, ...additionalInstructions];

    // Get fresh blockhash
    const { blockhash } = await this.connection.getLatestBlockhash();

    // Create new message with all instructions
    const newMessage = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message(lookupTableAccounts);

    // Create new versioned transaction
    return new VersionedTransaction(newMessage);
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
   * Detect if a token uses Token-2022 program
   */
  async getTokenProgram(tokenMint: PublicKey): Promise<PublicKey> {
    try {
      // Try to get mint info - if it fails with TOKEN_PROGRAM_ID, try TOKEN_2022
      const mintInfo = await getMint(this.connection, tokenMint, 'confirmed', TOKEN_PROGRAM_ID);
      return TOKEN_PROGRAM_ID;
    } catch (error) {
      try {
        const mintInfo = await getMint(this.connection, tokenMint, 'confirmed', TOKEN_2022_PROGRAM_ID);
        return TOKEN_2022_PROGRAM_ID;
      } catch {
        // Default to standard token program
        return TOKEN_PROGRAM_ID;
      }
    }
  }

  /**
   * Build fee collection instructions
   * These get appended to the Jupiter swap transaction
   * 
   * Fee is collected on OUTPUT token regardless of swap direction:
   * - BUY (SOL → TOKEN): fee on TOKEN output
   * - SELL (TOKEN → SOL): fee on SOL output
   */
  async buildFeeInstructions(
    tokenMint: PublicKey,
    userPublicKey: PublicKey,
    outputAmount: bigint,
    config: TokenConfig
  ): Promise<TransactionInstruction[]> {
    const instructions: TransactionInstruction[] = [];
    
    // Calculate fee amount (config.feePercent is already in whole percentage, e.g., 2 = 2%)
    const feeBps = config.feePercent * 100; // Convert to basis points (2% = 200 bps)
    const totalFee = (outputAmount * BigInt(feeBps)) / 10000n;
    
    if (totalFee === 0n) {
      return instructions;
    }

    // Calculate splits (config values are in whole percentages, e.g., 10 = 10%)
    const earnShare = (totalFee * BigInt(config.earnCut * 100)) / 10000n;
    const creatorShare = (totalFee * BigInt(config.creatorCut * 100)) / 10000n;
    const buybackShare = (totalFee * BigInt(config.buybackPercent * 100)) / 10000n;
    const stakingShare = totalFee - earnShare - creatorShare - buybackShare;

    // Detect token program (Token or Token-2022)
    const tokenProgram = await this.getTokenProgram(tokenMint);

    // Get user's token account
    const userTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      userPublicKey,
      false,
      tokenProgram
    );

    // Earn Protocol's token account
    const earnTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      this.earnProtocolWallet,
      false,
      tokenProgram
    );

    // Creator's token account
    const creatorPubkey = new PublicKey(config.creator);
    const creatorTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      creatorPubkey,
      false,
      tokenProgram
    );

    // Treasury (for buybacks) - use creator for now, should be PDA
    const treasuryPubkey = config.treasuryAddress 
      ? new PublicKey(config.treasuryAddress)
      : creatorPubkey;
    const treasuryTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      treasuryPubkey,
      false,
      tokenProgram
    );

    // Staking pool - use creator for now, should be PDA
    const stakingPoolPubkey = config.stakingPoolAddress
      ? new PublicKey(config.stakingPoolAddress)
      : creatorPubkey;
    const stakingPoolTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      stakingPoolPubkey,
      false,
      tokenProgram
    );

    // Add transfer instructions for each split (use detected token program)
    if (earnShare > 0n) {
      instructions.push(
        createTransferInstruction(
          userTokenAccount,
          earnTokenAccount,
          userPublicKey,
          earnShare,
          [],
          tokenProgram
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
          tokenProgram
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
          tokenProgram
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
          tokenProgram
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

    // 6. Combine Jupiter swap + fee instructions into ONE atomic transaction
    let finalTransaction: string;
    
    try {
      // Append fee instructions to Jupiter's VersionedTransaction
      const combinedTx = await this.appendToVersionedTransaction(
        jupiterTx,
        feeInstructions,
        userPubkey
      );
      finalTransaction = Buffer.from(combinedTx.serialize()).toString('base64');
    } catch (error) {
      console.warn('Failed to combine versioned transaction, falling back to separate txs:', error);
      // Fallback: return Jupiter transaction only (fee instructions would need separate handling)
      finalTransaction = swapTransaction;
    }

    // Extract route labels
    const routeLabels = quote.routePlan?.map((r: any) => r.swapInfo?.label || 'Unknown') || [];
    const netOutput = Number(outputAmount - totalFee);

    return {
      // Combined atomic transaction: Jupiter swap + fee collection
      transaction: finalTransaction,
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
