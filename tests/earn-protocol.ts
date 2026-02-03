import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { EarnProtocol } from "../target/types/earn_protocol";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";

describe("earn-protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.EarnProtocol as Program<EarnProtocol>;
  
  // Test accounts
  let tokenMint: PublicKey;
  let creator: Keypair;
  let user: Keypair;
  let userTokenAccount: PublicKey;
  let creatorTokenAccount: PublicKey;
  let protocolTokenAccount: PublicKey;
  let treasuryTokenAccount: PublicKey;
  let stakingPoolTokenAccount: PublicKey;

  // PDAs
  let tokenConfigPda: PublicKey;
  let treasuryPda: PublicKey;
  let stakingPoolPda: PublicKey;
  let masterTreasuryPda: PublicKey;

  const PROTOCOL_WALLET = new PublicKey("EARNsm7JPDHeYmmKkEYrzBVYkXot3tdiQW2Q2zWsiTZQ");

  before(async () => {
    // Create test accounts
    creator = Keypair.generate();
    user = Keypair.generate();

    // Airdrop SOL
    await provider.connection.requestAirdrop(creator.publicKey, 10 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
    
    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create test token
    tokenMint = await createMint(
      provider.connection,
      creator,
      creator.publicKey,
      null,
      9
    );

    // Create token accounts
    userTokenAccount = await createAccount(
      provider.connection,
      user,
      tokenMint,
      user.publicKey
    );

    creatorTokenAccount = await createAccount(
      provider.connection,
      creator,
      tokenMint,
      creator.publicKey
    );

    // Mint tokens to user for testing
    await mintTo(
      provider.connection,
      creator,
      tokenMint,
      userTokenAccount,
      creator,
      1_000_000_000_000 // 1000 tokens
    );

    // Derive PDAs
    [tokenConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), tokenMint.toBuffer()],
      program.programId
    );

    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), tokenMint.toBuffer()],
      program.programId
    );

    [stakingPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool"), tokenMint.toBuffer()],
      program.programId
    );

    [masterTreasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("earn_master")],
      program.programId
    );
  });

  describe("register", () => {
    it("registers a token with default config", async () => {
      const tx = await program.methods
        .register(
          200, // 2% fee
          null, // default creator cut
          null, // default buyback cut
          null  // default staking cut
        )
        .accounts({
          creator: creator.publicKey,
          tokenMint: tokenMint,
          tokenConfig: tokenConfigPda,
          treasury: treasuryPda,
          stakingPool: stakingPoolPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      console.log("Register tx:", tx);

      // Verify token config
      const config = await program.account.tokenConfig.fetch(tokenConfigPda);
      expect(config.tokenMint.toString()).to.equal(tokenMint.toString());
      expect(config.creator.toString()).to.equal(creator.publicKey.toString());
      expect(config.feeBasisPoints).to.equal(200);
      expect(config.isActive).to.be.true;
    });
  });

  describe("collect_fee_from_swap", () => {
    it("collects fees from a swap output", async () => {
      const swapOutputAmount = new anchor.BN(100_000_000_000); // 100 tokens

      // Get balances before
      const userBalanceBefore = (await getAccount(provider.connection, userTokenAccount)).amount;

      const tx = await program.methods
        .collectFeeFromSwap(swapOutputAmount)
        .accounts({
          user: user.publicKey,
          tokenMint: tokenMint,
          userTokenAccount: userTokenAccount,
          tokenConfig: tokenConfigPda,
          treasury: treasuryPda,
          stakingPoolState: stakingPoolPda,
          protocolTokenAccount: protocolTokenAccount,
          creatorTokenAccount: creatorTokenAccount,
          buybackPool: treasuryTokenAccount,
          stakingPool: stakingPoolTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log("Collect fee tx:", tx);

      // Get balances after
      const userBalanceAfter = (await getAccount(provider.connection, userTokenAccount)).amount;

      // User should have paid 2% fee
      const expectedFee = swapOutputAmount.toNumber() * 200 / 10000; // 2%
      const actualFee = Number(userBalanceBefore) - Number(userBalanceAfter);
      
      expect(actualFee).to.equal(expectedFee);
    });
  });

  describe("stake", () => {
    it("stakes tokens", async () => {
      const stakeAmount = new anchor.BN(10_000_000_000); // 10 tokens

      const tx = await program.methods
        .stake(stakeAmount)
        .accounts({
          user: user.publicKey,
          tokenMint: tokenMint,
          userTokenAccount: userTokenAccount,
          tokenConfig: tokenConfigPda,
          stakingPool: stakingPoolPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log("Stake tx:", tx);

      // Verify staking pool updated
      const pool = await program.account.stakingPool.fetch(stakingPoolPda);
      expect(pool.totalStaked.toNumber()).to.be.greaterThan(0);
    });
  });
});
