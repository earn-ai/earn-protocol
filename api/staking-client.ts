/**
 * Earn Staking Client
 * 
 * Client for interacting with the on-chain staking program.
 * Handles PDA derivation, transaction building, and account fetching.
 */

import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import * as borsh from 'borsh';

// Program ID (deployed on devnet)
export const STAKING_PROGRAM_ID = new PublicKey('E7JsJuQWGaEYC34AkEv8dcmkKUxR1KqUnje17mNCuTiY');

// PDA Seeds
const GLOBAL_CONFIG_SEED = 'global-config';
const STAKING_POOL_SEED = 'staking-pool';
const STAKE_ACCOUNT_SEED = 'stake-account';
const POOL_TOKEN_ACCOUNT_SEED = 'pool-token-account';
const REWARD_VAULT_SEED = 'rewards-vault';
const POOL_AUTHORITY_SEED = 'pool-authority';

// ============ PDA DERIVATION ============

export function getGlobalConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(GLOBAL_CONFIG_SEED)],
    STAKING_PROGRAM_ID
  );
}

export function getStakingPoolPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(STAKING_POOL_SEED), mint.toBuffer()],
    STAKING_PROGRAM_ID
  );
}

export function getStakeAccountPDA(pool: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(STAKE_ACCOUNT_SEED), pool.toBuffer(), owner.toBuffer()],
    STAKING_PROGRAM_ID
  );
}

export function getPoolTokenAccountPDA(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_TOKEN_ACCOUNT_SEED), pool.toBuffer()],
    STAKING_PROGRAM_ID
  );
}

export function getRewardVaultPDA(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(REWARD_VAULT_SEED), pool.toBuffer()],
    STAKING_PROGRAM_ID
  );
}

export function getPoolAuthorityPDA(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_AUTHORITY_SEED), pool.toBuffer()],
    STAKING_PROGRAM_ID
  );
}

// ============ ACCOUNT SCHEMAS ============

// Anchor discriminators (first 8 bytes of sha256("account:<Name>"))
const GLOBAL_CONFIG_DISCRIMINATOR = Buffer.from([149, 8, 156, 202, 160, 252, 176, 217]);
const STAKING_POOL_DISCRIMINATOR = Buffer.from([203, 19, 214, 220, 220, 154, 24, 102]);
const STAKE_ACCOUNT_DISCRIMINATOR = Buffer.from([80, 158, 67, 124, 50, 189, 192, 255]);

export interface GlobalConfig {
  authority: PublicKey;
  earnWallet: PublicKey;
  totalPools: bigint;
  totalStakedValue: bigint;
  totalRewardsDistributed: bigint;
  bump: number;
}

export interface StakingPool {
  mint: PublicKey;
  agentWallet: PublicKey;
  totalStaked: bigint;
  stakerCount: number;
  rewardsAvailable: bigint;
  rewardsDistributed: bigint;
  rewardPerTokenStored: bigint;
  lastUpdateTime: bigint;
  minStakeAmount: bigint;
  cooldownSeconds: number;
  createdAt: bigint;
  paused: boolean;
  bump: number;
}

export interface StakeAccount {
  owner: PublicKey;
  pool: PublicKey;
  amount: bigint;
  rewardPerTokenPaid: bigint;
  rewardsEarned: bigint;
  stakedAt: bigint;
  lastClaimAt: bigint;
  unstakeRequestedAt: bigint;
  unstakeAmount: bigint;
  bump: number;
}

// ============ ACCOUNT PARSING ============

export function parseGlobalConfig(data: Buffer): GlobalConfig | null {
  if (data.length < 8 || !data.subarray(0, 8).equals(GLOBAL_CONFIG_DISCRIMINATOR)) {
    return null;
  }
  
  let offset = 8;
  const authority = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const earnWallet = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const totalPools = data.readBigUInt64LE(offset); offset += 8;
  const totalStakedValue = data.readBigUInt64LE(offset); offset += 8;
  const totalRewardsDistributed = data.readBigUInt64LE(offset); offset += 8;
  const bump = data.readUInt8(offset);
  
  return { authority, earnWallet, totalPools, totalStakedValue, totalRewardsDistributed, bump };
}

export function parseStakingPool(data: Buffer): StakingPool | null {
  if (data.length < 8 || !data.subarray(0, 8).equals(STAKING_POOL_DISCRIMINATOR)) {
    return null;
  }
  
  let offset = 8;
  const mint = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const agentWallet = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const totalStaked = data.readBigUInt64LE(offset); offset += 8;
  const stakerCount = data.readUInt32LE(offset); offset += 4;
  const rewardsAvailable = data.readBigUInt64LE(offset); offset += 8;
  const rewardsDistributed = data.readBigUInt64LE(offset); offset += 8;
  // u128 - read as two u64s
  const rewardPerTokenLow = data.readBigUInt64LE(offset); offset += 8;
  const rewardPerTokenHigh = data.readBigUInt64LE(offset); offset += 8;
  const rewardPerTokenStored = rewardPerTokenLow + (rewardPerTokenHigh << 64n);
  const lastUpdateTime = data.readBigInt64LE(offset); offset += 8;
  const minStakeAmount = data.readBigUInt64LE(offset); offset += 8;
  const cooldownSeconds = data.readUInt32LE(offset); offset += 4;
  const createdAt = data.readBigInt64LE(offset); offset += 8;
  const paused = data.readUInt8(offset) !== 0; offset += 1;
  const bump = data.readUInt8(offset);
  
  return {
    mint, agentWallet, totalStaked, stakerCount, rewardsAvailable, rewardsDistributed,
    rewardPerTokenStored, lastUpdateTime, minStakeAmount, cooldownSeconds, createdAt, paused, bump
  };
}

export function parseStakeAccount(data: Buffer): StakeAccount | null {
  if (data.length < 8 || !data.subarray(0, 8).equals(STAKE_ACCOUNT_DISCRIMINATOR)) {
    return null;
  }
  
  let offset = 8;
  const owner = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const pool = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const amount = data.readBigUInt64LE(offset); offset += 8;
  // u128
  const rewardPerTokenPaidLow = data.readBigUInt64LE(offset); offset += 8;
  const rewardPerTokenPaidHigh = data.readBigUInt64LE(offset); offset += 8;
  const rewardPerTokenPaid = rewardPerTokenPaidLow + (rewardPerTokenPaidHigh << 64n);
  const rewardsEarned = data.readBigUInt64LE(offset); offset += 8;
  const stakedAt = data.readBigInt64LE(offset); offset += 8;
  const lastClaimAt = data.readBigInt64LE(offset); offset += 8;
  const unstakeRequestedAt = data.readBigInt64LE(offset); offset += 8;
  const unstakeAmount = data.readBigUInt64LE(offset); offset += 8;
  const bump = data.readUInt8(offset);
  
  return {
    owner, pool, amount, rewardPerTokenPaid, rewardsEarned,
    stakedAt, lastClaimAt, unstakeRequestedAt, unstakeAmount, bump
  };
}

// ============ STAKING CLIENT CLASS ============

export class StakingClient {
  connection: Connection;
  
  constructor(connection: Connection) {
    this.connection = connection;
  }
  
  // ========== FETCH METHODS ==========
  
  async getGlobalConfig(): Promise<GlobalConfig | null> {
    const [pda] = getGlobalConfigPDA();
    const info = await this.connection.getAccountInfo(pda);
    if (!info) return null;
    return parseGlobalConfig(info.data);
  }
  
  async getStakingPool(mint: PublicKey): Promise<StakingPool | null> {
    const [pda] = getStakingPoolPDA(mint);
    const info = await this.connection.getAccountInfo(pda);
    if (!info) return null;
    return parseStakingPool(info.data);
  }
  
  async getStakeAccount(pool: PublicKey, owner: PublicKey): Promise<StakeAccount | null> {
    const [pda] = getStakeAccountPDA(pool, owner);
    const info = await this.connection.getAccountInfo(pda);
    if (!info) return null;
    return parseStakeAccount(info.data);
  }
  
  async getAllPools(): Promise<{ pubkey: PublicKey; pool: StakingPool }[]> {
    // Fetch all accounts owned by the program with StakingPool discriminator
    // Use bs58 encoding for the discriminator bytes
    const bs58 = await import('bs58');
    const accounts = await this.connection.getProgramAccounts(STAKING_PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: bs58.default.encode(STAKING_POOL_DISCRIMINATOR) } }
      ]
    });
    
    const pools: { pubkey: PublicKey; pool: StakingPool }[] = [];
    for (const { pubkey, account } of accounts) {
      const pool = parseStakingPool(account.data);
      if (pool) {
        pools.push({ pubkey, pool });
      }
    }
    return pools;
  }
  
  async getUserStakes(owner: PublicKey): Promise<{ pubkey: PublicKey; stake: StakeAccount }[]> {
    // Fetch all stake accounts for this owner
    const bs58 = await import('bs58');
    const accounts = await this.connection.getProgramAccounts(STAKING_PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: bs58.default.encode(STAKE_ACCOUNT_DISCRIMINATOR) } },
        { memcmp: { offset: 8, bytes: owner.toBase58() } } // owner is at offset 8 after discriminator
      ]
    });
    
    const stakes: { pubkey: PublicKey; stake: StakeAccount }[] = [];
    for (const { pubkey, account } of accounts) {
      const stake = parseStakeAccount(account.data);
      if (stake) {
        stakes.push({ pubkey, stake });
      }
    }
    return stakes;
  }
  
  // ========== TRANSACTION BUILDERS ==========
  
  /**
   * Build create pool transaction
   */
  buildCreatePoolTx(
    mint: PublicKey,
    agentWallet: PublicKey,
    authority: PublicKey,
    minStakeAmount: bigint = 1000000n, // 0.001 tokens (assuming 9 decimals)
    cooldownSeconds: number = 0
  ): { transaction: Transaction; poolPDA: PublicKey } {
    const [globalConfig] = getGlobalConfigPDA();
    const [poolPDA, poolBump] = getStakingPoolPDA(mint);
    
    // Instruction data: [discriminator(8)] + [min_stake_amount(8)] + [cooldown_seconds(4)]
    // Anchor discriminator for "create_pool": sha256("global:create_pool")[0..8]
    const discriminator = Buffer.from([233, 146, 209, 142, 207, 104, 64, 188]); // create_pool
    const data = Buffer.alloc(8 + 8 + 4);
    discriminator.copy(data, 0);
    data.writeBigUInt64LE(minStakeAmount, 8);
    data.writeUInt32LE(cooldownSeconds, 16);
    
    // Account order must match Anchor's CreatePool struct:
    // 1. global_config (mut)
    // 2. staking_pool (init, mut)
    // 3. mint
    // 4. agent_wallet
    // 5. authority (signer, mut)
    // 6. system_program
    const ix = new TransactionInstruction({
      programId: STAKING_PROGRAM_ID,
      keys: [
        { pubkey: globalConfig, isSigner: false, isWritable: true },
        { pubkey: poolPDA, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: agentWallet, isSigner: false, isWritable: false },
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    
    const transaction = new Transaction().add(ix);
    return { transaction, poolPDA };
  }
  
  /**
   * Build stake transaction
   * Automatically derives pool token account (ATA of pool authority)
   */
  buildStakeTx(
    mint: PublicKey,
    owner: PublicKey,
    amount: bigint
  ): { transaction: Transaction; stakeAccountPDA: PublicKey; poolTokenAccount: PublicKey } {
    const [poolPDA] = getStakingPoolPDA(mint);
    const [stakeAccountPDA] = getStakeAccountPDA(poolPDA, owner);
    const [poolAuthority] = getPoolAuthorityPDA(poolPDA);
    
    // Pool token account is the ATA of the pool authority for this mint
    const poolTokenAccount = getAssociatedTokenAddressSync(mint, poolAuthority, true); // allowOwnerOffCurve=true for PDA
    const userTokenAccount = getAssociatedTokenAddressSync(mint, owner);
    
    // Instruction data: [discriminator(8)] + [amount(8)]
    const discriminator = Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]); // stake
    const data = Buffer.alloc(8 + 8);
    discriminator.copy(data, 0);
    data.writeBigUInt64LE(amount, 8);
    
    // Account order must match Anchor's Stake struct:
    // 1. staking_pool (mut)
    // 2. stake_account (init_if_needed, mut)
    // 3. user_token_account (mut)
    // 4. pool_token_account (mut)
    // 5. user (signer, mut)
    // 6. token_program
    // 7. system_program
    const ix = new TransactionInstruction({
      programId: STAKING_PROGRAM_ID,
      keys: [
        { pubkey: poolPDA, isSigner: false, isWritable: true },
        { pubkey: stakeAccountPDA, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    
    const transaction = new Transaction().add(ix);
    return { transaction, stakeAccountPDA, poolTokenAccount };
  }
  
  /**
   * Build unstake transaction (no cooldown or after cooldown)
   * Automatically derives pool token account (ATA of pool authority)
   */
  buildUnstakeTx(
    mint: PublicKey,
    owner: PublicKey,
    amount: bigint
  ): Transaction {
    const [poolPDA] = getStakingPoolPDA(mint);
    const [stakeAccountPDA] = getStakeAccountPDA(poolPDA, owner);
    const [poolAuthority] = getPoolAuthorityPDA(poolPDA);
    
    // Pool token account is the ATA of the pool authority for this mint
    const poolTokenAccount = getAssociatedTokenAddressSync(mint, poolAuthority, true);
    const userTokenAccount = getAssociatedTokenAddressSync(mint, owner);
    
    // Instruction data: [discriminator(8)] + [amount(8)]
    const discriminator = Buffer.from([90, 95, 107, 42, 205, 124, 50, 225]); // unstake
    const data = Buffer.alloc(8 + 8);
    discriminator.copy(data, 0);
    data.writeBigUInt64LE(amount, 8);
    
    // Account order must match Anchor's Unstake struct:
    // 1. staking_pool (mut)
    // 2. stake_account (mut)
    // 3. user_token_account (mut)
    // 4. pool_token_account (mut)
    // 5. pool_authority (PDA)
    // 6. user (signer, mut)
    // 7. token_program
    const ix = new TransactionInstruction({
      programId: STAKING_PROGRAM_ID,
      keys: [
        { pubkey: poolPDA, isSigner: false, isWritable: true },
        { pubkey: stakeAccountPDA, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
        { pubkey: poolAuthority, isSigner: false, isWritable: false },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });
    
    return new Transaction().add(ix);
  }
  
  /**
   * Build claim rewards transaction
   */
  buildClaimTx(
    mint: PublicKey,
    owner: PublicKey
  ): Transaction {
    const [globalConfig] = getGlobalConfigPDA();
    const [poolPDA] = getStakingPoolPDA(mint);
    const [stakeAccountPDA] = getStakeAccountPDA(poolPDA, owner);
    const [rewardsVault] = getRewardVaultPDA(poolPDA);
    
    // Instruction data: [discriminator(8)]
    const discriminator = Buffer.from([4, 144, 132, 71, 116, 23, 151, 80]); // claim_rewards
    const data = discriminator;
    
    // Account order must match Anchor's ClaimRewards struct:
    // 1. global_config (mut)
    // 2. staking_pool (mut)
    // 3. stake_account (mut)
    // 4. rewards_vault (mut, PDA)
    // 5. user (signer, mut)
    // 6. system_program
    const ix = new TransactionInstruction({
      programId: STAKING_PROGRAM_ID,
      keys: [
        { pubkey: globalConfig, isSigner: false, isWritable: true },
        { pubkey: poolPDA, isSigner: false, isWritable: true },
        { pubkey: stakeAccountPDA, isSigner: false, isWritable: true },
        { pubkey: rewardsVault, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    
    return new Transaction().add(ix);
  }
  
  /**
   * Build request unstake transaction (starts cooldown)
   */
  buildRequestUnstakeTx(
    mint: PublicKey,
    owner: PublicKey,
    amount: bigint
  ): Transaction {
    const [poolPDA] = getStakingPoolPDA(mint);
    const [stakeAccountPDA] = getStakeAccountPDA(poolPDA, owner);
    
    // Instruction data: [discriminator(8)] + [amount(8)]
    const discriminator = Buffer.from([44, 154, 110, 253, 160, 202, 54, 34]); // request_unstake
    const data = Buffer.alloc(8 + 8);
    discriminator.copy(data, 0);
    data.writeBigUInt64LE(amount, 8);
    
    const ix = new TransactionInstruction({
      programId: STAKING_PROGRAM_ID,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: false },
        { pubkey: poolPDA, isSigner: false, isWritable: false },
        { pubkey: stakeAccountPDA, isSigner: false, isWritable: true },
      ],
      data,
    });
    
    return new Transaction().add(ix);
  }
}

// Export singleton helper
let clientInstance: StakingClient | null = null;

export function getStakingClient(connection: Connection): StakingClient {
  if (!clientInstance) {
    clientInstance = new StakingClient(connection);
  }
  return clientInstance;
}
