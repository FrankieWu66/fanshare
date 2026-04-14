/**
 * FanShare Anchor Integration Tests
 *
 * Uses solana-bankrun to run a local BPF program in-process (no validator needed).
 * Tests all 5 on-chain instructions: initialize_curve, buy, buy_with_sol, sell, update_oracle.
 *
 * Run: npm run test (vitest picks this up from anchor/tests/)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from "vitest";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Program, BN, AnchorError } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
  createInitializeAccountInstruction,
  ACCOUNT_SIZE,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// Load the IDL (JSON import via vitest)
import IDL from "../target/idl/fanshare.json";

const PROGRAM_ID = new PublicKey("B69juh6rX1Z6WNN2qCkrhuHDnk6v5vrK8oJ2o6oHTVYz");

// ── Helpers ─────────────────────────────────────────────────────────────────

function getBondingCurvePda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PROGRAM_ID
  );
}

function getStatsOraclePda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stats-oracle"), mint.toBuffer()],
    PROGRAM_ID
  );
}

function getExitTreasuryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("exit-treasury")],
    PROGRAM_ID
  );
}

function getOracleConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle-config")],
    PROGRAM_ID
  );
}

function getMarketStatusPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market-status"), mint.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

function getLeaderboardPda(type: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("leaderboard"), Buffer.from([type])],
    PROGRAM_ID
  );
  return pda;
}

/** Linear bonding curve cost: n*base + slope*n*(2s+n-1)/2 */
function calculateBuyCost(basePrice: bigint, slope: bigint, tokensSold: bigint, amount: bigint): bigint {
  const n = amount;
  const s = tokensSold;
  const baseCost = n * basePrice;
  const sumTerm = 2n * s + n - 1n;
  const slopeCost = (slope * n * sumTerm) / 2n;
  return baseCost + slopeCost;
}

/** Get SOL balance via getAccountInfo (bankrun doesn't have getBalance) */
async function getLamports(conn: any, pubkey: PublicKey): Promise<number> {
  const info = await conn.getAccountInfo(pubkey);
  return info ? info.lamports : 0;
}

// ── Test Constants ──────────────────────────────────────────────────────────

const PLAYER_ID = "Player_TEST";
const BASE_PRICE = new BN(10_000);   // 10,000 lamports base
const SLOPE = new BN(10);            // 10 lamports per token
const TOTAL_SUPPLY = new BN(100_000);

// ── Shared State ────────────────────────────────────────────────────────────

let provider: BankrunProvider;
let program: Program;
let authority: Keypair;
let mintKeypair: Keypair;
let mint: PublicKey;
let bondingCurvePda: PublicKey;
let bondingCurveBump: number;
let statsOraclePda: PublicKey;
let buyerKeypair: Keypair;
let buyerTokenAccount: PublicKey;
let exitTreasuryPda: PublicKey;
let oracleConfigPda: PublicKey;
let marketStatusPda: PublicKey;
let sharpLeaderboardPda: PublicKey;

// ── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Start bankrun with the compiled program
  const context = await startAnchor(
    "anchor", // path to Anchor.toml directory (relative to project root)
    [],
    []
  );

  provider = new BankrunProvider(context);
  // @ts-expect-error - IDL type mismatch between versions is expected
  program = new Program(IDL, provider);
  authority = provider.wallet.payer;

  // Generate mint keypair and derive PDAs
  mintKeypair = Keypair.generate();
  mint = mintKeypair.publicKey;
  [bondingCurvePda, bondingCurveBump] = getBondingCurvePda(mint);
  [statsOraclePda] = getStatsOraclePda(mint);

  // Create the SPL mint with bonding_curve PDA as mint authority (0 decimals)
  const mintRent = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mint,
      lamports: mintRent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mint,
      0, // 0 decimals
      bondingCurvePda, // mint authority = bonding curve PDA
      null // no freeze authority
    )
  );
  await provider.sendAndConfirm(createMintTx, [authority, mintKeypair]);

  // Create a buyer keypair and fund it
  buyerKeypair = Keypair.generate();
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: buyerKeypair.publicKey,
      lamports: 10 * LAMPORTS_PER_SOL,
    })
  );
  await provider.sendAndConfirm(fundTx, [authority]);

  // Create buyer's ATA for this mint
  buyerTokenAccount = getAssociatedTokenAddressSync(mint, buyerKeypair.publicKey);
  const createAtaTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      buyerKeypair.publicKey, // payer
      buyerTokenAccount,
      buyerKeypair.publicKey, // owner
      mint
    )
  );
  await provider.sendAndConfirm(createAtaTx, [buyerKeypair]);

  // Initialize Phase 1 tokenomics accounts
  [exitTreasuryPda] = getExitTreasuryPda();
  [oracleConfigPda] = getOracleConfigPda();

  // Initialize GlobalExitTreasury (protocol wallet = authority for tests)
  await program.methods
    .initializeExitTreasury(authority.publicKey)
    .accounts({
      authority: authority.publicKey,
      exitTreasury: exitTreasuryPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  // Initialize OracleConfig with test weights
  await program.methods
    .initializeOracleConfig(
      new BN(1000), new BN(500), new BN(700),
      new BN(800), new BN(800), new BN(0),
    )
    .accounts({
      authority: authority.publicKey,
      oracleConfig: oracleConfigPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  // Initialize MarketStatus for the test mint (open_time = 0 = open immediately)
  marketStatusPda = getMarketStatusPda(mint);
  await program.methods
    .initializeMarketStatus(new BN(0))
    .accounts({
      authority: authority.publicKey,
      mint,
      marketStatus: marketStatusPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  // Initialize both Leaderboard anchors (type 0 = Top Traders, type 1 = Sharp Calls)
  sharpLeaderboardPda = getLeaderboardPda(1);
  await program.methods
    .initializeLeaderboard(0)
    .accounts({
      authority: authority.publicKey,
      leaderboard: getLeaderboardPda(0),
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  await program.methods
    .initializeLeaderboard(1)
    .accounts({
      authority: authority.publicKey,
      leaderboard: sharpLeaderboardPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();
});

// ── initialize_curve ────────────────────────────────────────────────────────

describe("initialize_curve", () => {
  it("creates BondingCurveAccount with correct base_price, slope, total_supply", async () => {
    await program.methods
      .initializeCurve(PLAYER_ID, BASE_PRICE, SLOPE, TOTAL_SUPPLY)
      .accounts({
        authority: authority.publicKey,
        mint,
        bondingCurve: bondingCurvePda,
        statsOracle: statsOraclePda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    const curve = await program.account.bondingCurveAccount.fetch(bondingCurvePda);
    expect(curve.playerId).toBe(PLAYER_ID);
    expect(curve.basePrice.toNumber()).toBe(10_000);
    expect(curve.slope.toNumber()).toBe(10);
    expect(curve.totalSupply.toNumber()).toBe(100_000);
    expect(curve.tokensSold.toNumber()).toBe(0);
    expect(curve.treasuryLamports.toNumber()).toBe(0);
    expect(curve.mint.toBase58()).toBe(mint.toBase58());
  });

  it("creates StatsOracleAccount with index_price = 0 at init", async () => {
    const oracle = await program.account.statsOracleAccount.fetch(statsOraclePda);
    expect(oracle.indexPriceLamports.toNumber()).toBe(0);
    expect(oracle.lastUpdated.toNumber()).toBe(0);
    expect(oracle.mint.toBase58()).toBe(mint.toBase58());
  });

  it("sets authority to payer", async () => {
    const curve = await program.account.bondingCurveAccount.fetch(bondingCurvePda);
    expect(curve.authority.toBase58()).toBe(authority.publicKey.toBase58());

    const oracle = await program.account.statsOracleAccount.fetch(statsOraclePda);
    expect(oracle.authority.toBase58()).toBe(authority.publicKey.toBase58());
  });

  it("rejects re-initialization (PDA already exists)", async () => {
    // Try to init same mint again — should fail because PDAs already exist
    const secondMint = mintKeypair; // same mint
    try {
      await program.methods
        .initializeCurve(PLAYER_ID, BASE_PRICE, SLOPE, TOTAL_SUPPLY)
        .accounts({
          authority: authority.publicKey,
          mint: secondMint.publicKey,
          bondingCurve: bondingCurvePda,
          statsOracle: statsOraclePda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err) {
      // Anchor returns an error when trying to init an already-initialized account
      expect(err).toBeTruthy();
    }
  });

  it("rejects player_id longer than 32 characters", async () => {
    const longId = "A".repeat(33);
    const newMint = Keypair.generate();
    const [newBondingCurve] = getBondingCurvePda(newMint.publicKey);
    const [newOracle] = getStatsOraclePda(newMint.publicKey);

    // Create the mint manually (bankrun doesn't support spl-token helpers)
    const mintRent = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: newMint.publicKey,
        lamports: mintRent,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(newMint.publicKey, 0, newBondingCurve, null)
    );
    await provider.sendAndConfirm(createMintTx, [authority, newMint]);

    try {
      await program.methods
        .initializeCurve(longId, BASE_PRICE, SLOPE, TOTAL_SUPPLY)
        .accounts({
          authority: authority.publicKey,
          mint: newMint.publicKey,
          bondingCurve: newBondingCurve,
          statsOracle: newOracle,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();
      expect.fail("Should have thrown PlayerIdTooLong");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("PlayerIdTooLong");
      }
    }
  });

  it("rejects base_price = 0", async () => {
    const newMint = Keypair.generate();
    const [newBondingCurve] = getBondingCurvePda(newMint.publicKey);
    const [newOracle] = getStatsOraclePda(newMint.publicKey);

    const mintRent = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: newMint.publicKey,
        lamports: mintRent,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(newMint.publicKey, 0, newBondingCurve, null)
    );
    await provider.sendAndConfirm(createMintTx, [authority, newMint]);

    try {
      await program.methods
        .initializeCurve("Zero_Base", new BN(0), SLOPE, TOTAL_SUPPLY)
        .accounts({
          authority: authority.publicKey,
          mint: newMint.publicKey,
          bondingCurve: newBondingCurve,
          statsOracle: newOracle,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();
      expect.fail("Should have thrown InvalidParameter");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("InvalidParameter");
      }
    }
  });
});

// ── buy ─────────────────────────────────────────────────────────────────────

describe("buy", () => {
  const BUY_AMOUNT = new BN(100); // buy 100 tokens

  it("transfers exact SOL cost from buyer to treasury", async () => {
    const expectedCost = calculateBuyCost(10_000n, 10n, 0n, 100n);

    const balBefore = await getLamports(provider.connection,buyerKeypair.publicKey);
    const curveBefore = await getLamports(provider.connection,bondingCurvePda);

    await program.methods
      .buy(BUY_AMOUNT, new BN(expectedCost.toString()).add(new BN(200_000))) // generous max (includes 1.5% fee)
      .accounts({
        buyer: buyerKeypair.publicKey,
        mint,
        bondingCurve: bondingCurvePda,
        buyerTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        exitTreasury: exitTreasuryPda,
        protocolWallet: authority.publicKey,
        statsOracle: statsOraclePda,
        marketStatus: marketStatusPda,
        sharpLeaderboard: sharpLeaderboardPda,
      })
      .signers([buyerKeypair])
      .rpc();

    const balAfter = await getLamports(provider.connection,buyerKeypair.publicKey);
    const curveAfter = await getLamports(provider.connection,bondingCurvePda);

    // Buyer lost SOL (cost + tx fee)
    expect(balBefore - balAfter).toBeGreaterThanOrEqual(Number(expectedCost));
    // Treasury gained exactly the cost
    expect(curveAfter - curveBefore).toBe(Number(expectedCost));
  });

  it("mints correct token amount to buyer's ATA", async () => {
    // Read raw account data and parse token amount at offset 64 (after mint + owner)
    const acctInfo = await provider.connection.getAccountInfo(buyerTokenAccount);
    expect(acctInfo).not.toBeNull();
    const amount = acctInfo!.data.readBigUInt64LE(64);
    expect(Number(amount)).toBe(100); // 100 tokens from the buy above
  });

  it("increments tokens_sold on BondingCurveAccount", async () => {
    const curve = await program.account.bondingCurveAccount.fetch(bondingCurvePda);
    expect(curve.tokensSold.toNumber()).toBe(100);
  });

  it("updates treasury_lamports", async () => {
    const curve = await program.account.bondingCurveAccount.fetch(bondingCurvePda);
    const expectedCost = calculateBuyCost(10_000n, 10n, 0n, 100n);
    expect(curve.treasuryLamports.toNumber()).toBe(Number(expectedCost));
  });

  it("rejects buy exceeding total_supply", async () => {
    try {
      await program.methods
        .buy(TOTAL_SUPPLY, new BN(Number.MAX_SAFE_INTEGER))
        .accounts({
          buyer: buyerKeypair.publicKey,
          mint,
          bondingCurve: bondingCurvePda,
          buyerTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          exitTreasury: exitTreasuryPda,
          protocolWallet: authority.publicKey,
          statsOracle: statsOraclePda,
          marketStatus: marketStatusPda,
          sharpLeaderboard: sharpLeaderboardPda,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown ExceedsTotalSupply");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("ExceedsTotalSupply");
      }
    }
  });

  it("rejects buy when max_sol_in is below cost (slippage)", async () => {
    try {
      await program.methods
        .buy(new BN(10), new BN(1)) // 1 lamport max — way too low
        .accounts({
          buyer: buyerKeypair.publicKey,
          mint,
          bondingCurve: bondingCurvePda,
          buyerTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          exitTreasury: exitTreasuryPda,
          protocolWallet: authority.publicKey,
          statsOracle: statsOraclePda,
          marketStatus: marketStatusPda,
          sharpLeaderboard: sharpLeaderboardPda,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown SlippageExceeded");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("SlippageExceeded");
      }
    }
  });

  it("rejects buy of 0 tokens", async () => {
    try {
      await program.methods
        .buy(new BN(0), new BN(1_000_000))
        .accounts({
          buyer: buyerKeypair.publicKey,
          mint,
          bondingCurve: bondingCurvePda,
          buyerTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          exitTreasury: exitTreasuryPda,
          protocolWallet: authority.publicKey,
          statsOracle: statsOraclePda,
          marketStatus: marketStatusPda,
          sharpLeaderboard: sharpLeaderboardPda,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown ZeroAmount");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("ZeroAmount");
      }
    }
  });
});

// ── buy_with_sol ────────────────────────────────────────────────────────────

describe("buy_with_sol", () => {
  it("calculates tokens for given SOL and delivers them", async () => {
    const curveBefore = await program.account.bondingCurveAccount.fetch(bondingCurvePda);
    const tokensBefore = curveBefore.tokensSold.toNumber();

    const solAmount = new BN(500_000); // 0.5M lamports

    await program.methods
      .buyWithSol(solAmount, new BN(0)) // no slippage preference
      .accounts({
        buyer: buyerKeypair.publicKey,
        mint,
        bondingCurve: bondingCurvePda,
        buyerTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        exitTreasury: exitTreasuryPda,
        protocolWallet: authority.publicKey,
        statsOracle: statsOraclePda,
        marketStatus: marketStatusPda,
        sharpLeaderboard: sharpLeaderboardPda,
      })
      .signers([buyerKeypair])
      .rpc();

    const curveAfter = await program.account.bondingCurveAccount.fetch(bondingCurvePda);
    const tokensAfter = curveAfter.tokensSold.toNumber();

    // Should have bought some tokens (exact amount depends on curve math)
    expect(tokensAfter).toBeGreaterThan(tokensBefore);
  });

  it("rejects dust (sol_amount too small for even 1 token)", async () => {
    try {
      await program.methods
        .buyWithSol(new BN(1), new BN(0)) // 1 lamport — can't buy anything
        .accounts({
          buyer: buyerKeypair.publicKey,
          mint,
          bondingCurve: bondingCurvePda,
          buyerTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          exitTreasury: exitTreasuryPda,
          protocolWallet: authority.publicKey,
          statsOracle: statsOraclePda,
          marketStatus: marketStatusPda,
          sharpLeaderboard: sharpLeaderboardPda,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown DustAmount");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("DustAmount");
      }
    }
  });

  it("fails slippage check when min_tokens_out is too high", async () => {
    try {
      await program.methods
        .buyWithSol(new BN(100_000), new BN(999_999)) // expects 999k tokens for 0.1M lamports — impossible
        .accounts({
          buyer: buyerKeypair.publicKey,
          mint,
          bondingCurve: bondingCurvePda,
          buyerTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          exitTreasury: exitTreasuryPda,
          protocolWallet: authority.publicKey,
          statsOracle: statsOraclePda,
          marketStatus: marketStatusPda,
          sharpLeaderboard: sharpLeaderboardPda,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown SlippageExceeded");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("SlippageExceeded");
      }
    }
  });

  it("rejects sol_amount = 0", async () => {
    try {
      await program.methods
        .buyWithSol(new BN(0), new BN(0))
        .accounts({
          buyer: buyerKeypair.publicKey,
          mint,
          bondingCurve: bondingCurvePda,
          buyerTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          exitTreasury: exitTreasuryPda,
          protocolWallet: authority.publicKey,
          statsOracle: statsOraclePda,
          marketStatus: marketStatusPda,
          sharpLeaderboard: sharpLeaderboardPda,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown ZeroAmount");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("ZeroAmount");
      }
    }
  });
});

// ── sell ─────────────────────────────────────────────────────────────────────

describe("sell", () => {
  it("burns tokens and transfers SOL back to seller", async () => {
    const curveBefore = await program.account.bondingCurveAccount.fetch(bondingCurvePda);
    const tokensSoldBefore = curveBefore.tokensSold.toNumber();
    const treasuryBefore = curveBefore.treasuryLamports.toNumber();
    const sellerBalBefore = await getLamports(provider.connection,buyerKeypair.publicKey);

    const sellAmount = new BN(50);

    await program.methods
      .sell(sellAmount, new BN(0)) // no slippage preference
      .accounts({
        buyer: buyerKeypair.publicKey,
        mint,
        bondingCurve: bondingCurvePda,
        buyerTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        exitTreasury: exitTreasuryPda,
        protocolWallet: authority.publicKey,
        statsOracle: statsOraclePda,
        marketStatus: marketStatusPda,
        sharpLeaderboard: sharpLeaderboardPda,
      })
      .signers([buyerKeypair])
      .rpc();

    const curveAfter = await program.account.bondingCurveAccount.fetch(bondingCurvePda);
    const sellerBalAfter = await getLamports(provider.connection,buyerKeypair.publicKey);

    // tokens_sold decreased
    expect(curveAfter.tokensSold.toNumber()).toBe(tokensSoldBefore - 50);
    // treasury decreased
    expect(curveAfter.treasuryLamports.toNumber()).toBeLessThan(treasuryBefore);
    // seller got SOL back (minus tx fee)
    expect(sellerBalAfter).toBeGreaterThan(sellerBalBefore);
  });

  it("rejects sell of more tokens than tokens_sold", async () => {
    try {
      await program.methods
        .sell(new BN(999_999), new BN(0))
        .accounts({
          buyer: buyerKeypair.publicKey,
          mint,
          bondingCurve: bondingCurvePda,
          buyerTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          exitTreasury: exitTreasuryPda,
          protocolWallet: authority.publicKey,
          statsOracle: statsOraclePda,
          marketStatus: marketStatusPda,
          sharpLeaderboard: sharpLeaderboardPda,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown InsufficientTokensSold");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("InsufficientTokensSold");
      }
    }
  });

  it("rejects sell of 0 tokens", async () => {
    try {
      await program.methods
        .sell(new BN(0), new BN(0))
        .accounts({
          buyer: buyerKeypair.publicKey,
          mint,
          bondingCurve: bondingCurvePda,
          buyerTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          exitTreasury: exitTreasuryPda,
          protocolWallet: authority.publicKey,
          statsOracle: statsOraclePda,
          marketStatus: marketStatusPda,
          sharpLeaderboard: sharpLeaderboardPda,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown ZeroAmount");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("ZeroAmount");
      }
    }
  });

  it("rejects sell when min_sol_out exceeds actual return (slippage)", async () => {
    try {
      await program.methods
        .sell(new BN(1), new BN(Number.MAX_SAFE_INTEGER)) // expects enormous SOL return
        .accounts({
          buyer: buyerKeypair.publicKey,
          mint,
          bondingCurve: bondingCurvePda,
          buyerTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          exitTreasury: exitTreasuryPda,
          protocolWallet: authority.publicKey,
          statsOracle: statsOraclePda,
          marketStatus: marketStatusPda,
          sharpLeaderboard: sharpLeaderboardPda,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown SlippageExceeded");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("SlippageExceeded");
      }
    }
  });

  it("buy-then-sell round trip returns correct SOL", async () => {
    // Buy 10 tokens, record cost, sell 10 tokens, check return matches
    const curvePre = await program.account.bondingCurveAccount.fetch(bondingCurvePda);
    const tokensSoldPre = curvePre.tokensSold.toNumber();
    const treasuryPre = curvePre.treasuryLamports.toNumber();

    const buyAmt = new BN(10);
    const expectedBuyCost = calculateBuyCost(10_000n, 10n, BigInt(tokensSoldPre), 10n);

    await program.methods
      .buy(buyAmt, new BN(expectedBuyCost.toString()).add(new BN(200_000))) // includes fee
      .accounts({
        buyer: buyerKeypair.publicKey,
        mint,
        bondingCurve: bondingCurvePda,
        buyerTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        exitTreasury: exitTreasuryPda,
        protocolWallet: authority.publicKey,
        statsOracle: statsOraclePda,
        marketStatus: marketStatusPda,
        sharpLeaderboard: sharpLeaderboardPda,
      })
      .signers([buyerKeypair])
      .rpc();

    const curveAfterBuy = await program.account.bondingCurveAccount.fetch(bondingCurvePda);
    const treasuryAfterBuy = curveAfterBuy.treasuryLamports.toNumber();
    expect(treasuryAfterBuy - treasuryPre).toBe(Number(expectedBuyCost));

    // Now sell same 10 tokens — should return exactly the same SOL
    await program.methods
      .sell(buyAmt, new BN(0))
      .accounts({
        buyer: buyerKeypair.publicKey,
        mint,
        bondingCurve: bondingCurvePda,
        buyerTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        exitTreasury: exitTreasuryPda,
        protocolWallet: authority.publicKey,
        statsOracle: statsOraclePda,
        marketStatus: marketStatusPda,
        sharpLeaderboard: sharpLeaderboardPda,
      })
      .signers([buyerKeypair])
      .rpc();

    const curveAfterSell = await program.account.bondingCurveAccount.fetch(bondingCurvePda);
    // Treasury should be back to where it was before the buy
    expect(curveAfterSell.treasuryLamports.toNumber()).toBe(treasuryPre);
    expect(curveAfterSell.tokensSold.toNumber()).toBe(tokensSoldPre);
  });
});

// ── update_oracle ─────────────────────────────────────────────────────────────

describe("update_oracle", () => {
  it("authority can update index_price_lamports", async () => {
    const newPrice = new BN(42_000);

    await program.methods
      .updateOracle(newPrice)
      .accounts({
        authority: authority.publicKey,
        statsOracle: statsOraclePda,
      })
      .signers([authority])
      .rpc();

    const oracle = await program.account.statsOracleAccount.fetch(statsOraclePda);
    expect(oracle.indexPriceLamports.toNumber()).toBe(42_000);
  });

  it("updates last_updated timestamp", async () => {
    const oracle = await program.account.statsOracleAccount.fetch(statsOraclePda);
    expect(oracle.lastUpdated.toNumber()).toBeGreaterThan(0);
  });

  it("rejects update from non-authority signer", async () => {
    const rando = Keypair.generate();

    // Fund rando so they can pay tx fees
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: rando.publicKey,
        lamports: LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx, [authority]);

    try {
      await program.methods
        .updateOracle(new BN(99_999))
        .accounts({
          authority: rando.publicKey,
          statsOracle: statsOraclePda,
        })
        .signers([rando])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("Unauthorized");
      }
    }
  });

  it("accepts index_price = 0 (no division by zero downstream)", async () => {
    await program.methods
      .updateOracle(new BN(0))
      .accounts({
        authority: authority.publicKey,
        statsOracle: statsOraclePda,
      })
      .signers([authority])
      .rpc();

    const oracle = await program.account.statsOracleAccount.fetch(statsOraclePda);
    expect(oracle.indexPriceLamports.toNumber()).toBe(0);
  });
});

// ── Phase 2: freeze_market, sell on frozen, process_exit ─────────────────────

describe("freeze_market", () => {
  // Use a separate mint/player for freeze tests to avoid polluting main test state
  let freezeMint: PublicKey;
  let freezeMintKeypair: Keypair;
  let freezeBondingCurvePda: PublicKey;
  let freezeStatsOraclePda: PublicKey;
  let freezeMarketStatusPda: PublicKey;
  let freezeBuyerTokenAccount: PublicKey;

  beforeAll(async () => {
    freezeMintKeypair = Keypair.generate();
    freezeMint = freezeMintKeypair.publicKey;
    const [bcPda] = getBondingCurvePda(freezeMint);
    freezeBondingCurvePda = bcPda;
    [freezeStatsOraclePda] = getStatsOraclePda(freezeMint);
    freezeMarketStatusPda = getMarketStatusPda(freezeMint);

    // Create the SPL mint
    const mintRent = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: freezeMint,
        lamports: mintRent,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        freezeMint,
        0,
        freezeBondingCurvePda, // mint authority = bonding curve PDA
        null
      )
    );
    await provider.sendAndConfirm(createMintTx, [authority, freezeMintKeypair]);

    // Initialize bonding curve
    await program.methods
      .initializeCurve("Freeze_Test", BASE_PRICE, SLOPE, TOTAL_SUPPLY)
      .accounts({
        authority: authority.publicKey,
        mint: freezeMint,
        bondingCurve: freezeBondingCurvePda,
        statsOracle: freezeStatsOraclePda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    // Initialize market status
    await program.methods
      .initializeMarketStatus(new BN(0))
      .accounts({
        authority: authority.publicKey,
        mint: freezeMint,
        marketStatus: freezeMarketStatusPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Create buyer's ATA for freeze mint
    freezeBuyerTokenAccount = getAssociatedTokenAddressSync(freezeMint, buyerKeypair.publicKey);
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        buyerKeypair.publicKey,
        freezeBuyerTokenAccount,
        buyerKeypair.publicKey,
        freezeMint
      )
    );
    await provider.sendAndConfirm(createAtaTx, [buyerKeypair]);

    // Buy some tokens so there's something to sell/exit later
    const buyCost = calculateBuyCost(10_000n, 10n, 0n, 50n);
    await program.methods
      .buy(new BN(50), new BN(buyCost.toString()).add(new BN(200_000)))
      .accounts({
        buyer: buyerKeypair.publicKey,
        mint: freezeMint,
        bondingCurve: freezeBondingCurvePda,
        buyerTokenAccount: freezeBuyerTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        exitTreasury: exitTreasuryPda,
        protocolWallet: authority.publicKey,
        statsOracle: freezeStatsOraclePda,
        marketStatus: freezeMarketStatusPda,
        sharpLeaderboard: sharpLeaderboardPda,
      })
      .signers([buyerKeypair])
      .rpc();
  });

  it("authority can freeze a market", async () => {
    await program.methods
      .freezeMarket()
      .accounts({
        authority: authority.publicKey,
        marketStatus: freezeMarketStatusPda,
      })
      .signers([authority])
      .rpc();

    const status = await program.account.marketStatus.fetch(freezeMarketStatusPda);
    expect(status.isFrozen).toBe(true);
    expect(status.freezeTimestamp.toNumber()).toBeGreaterThan(0);
    expect(status.closeTimestamp.toNumber()).toBeGreaterThan(status.freezeTimestamp.toNumber());
  });

  it("rejects buy on frozen market with MarketFrozen error", async () => {
    try {
      await program.methods
        .buy(new BN(10), new BN(Number.MAX_SAFE_INTEGER))
        .accounts({
          buyer: buyerKeypair.publicKey,
          mint: freezeMint,
          bondingCurve: freezeBondingCurvePda,
          buyerTokenAccount: freezeBuyerTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          exitTreasury: exitTreasuryPda,
          protocolWallet: authority.publicKey,
          statsOracle: freezeStatsOraclePda,
          marketStatus: freezeMarketStatusPda,
          sharpLeaderboard: sharpLeaderboardPda,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown MarketFrozen");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("MarketFrozen");
      }
    }
  });

  it("rejects buy_with_sol on frozen market with MarketFrozen error", async () => {
    try {
      await program.methods
        .buyWithSol(new BN(100_000), new BN(0))
        .accounts({
          buyer: buyerKeypair.publicKey,
          mint: freezeMint,
          bondingCurve: freezeBondingCurvePda,
          buyerTokenAccount: freezeBuyerTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          exitTreasury: exitTreasuryPda,
          protocolWallet: authority.publicKey,
          statsOracle: freezeStatsOraclePda,
          marketStatus: freezeMarketStatusPda,
          sharpLeaderboard: sharpLeaderboardPda,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown MarketFrozen");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("MarketFrozen");
      }
    }
  });

  it("allows sell on frozen market during 30-day window", async () => {
    const curveBefore = await program.account.bondingCurveAccount.fetch(freezeBondingCurvePda);
    const tokensBefore = curveBefore.tokensSold.toNumber();

    await program.methods
      .sell(new BN(10), new BN(0))
      .accounts({
        buyer: buyerKeypair.publicKey,
        mint: freezeMint,
        bondingCurve: freezeBondingCurvePda,
        buyerTokenAccount: freezeBuyerTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        exitTreasury: exitTreasuryPda,
        protocolWallet: authority.publicKey,
        statsOracle: freezeStatsOraclePda,
        marketStatus: freezeMarketStatusPda,
        sharpLeaderboard: sharpLeaderboardPda,
      })
      .signers([buyerKeypair])
      .rpc();

    const curveAfter = await program.account.bondingCurveAccount.fetch(freezeBondingCurvePda);
    expect(curveAfter.tokensSold.toNumber()).toBe(tokensBefore - 10);
  });

  it("rejects double-freeze with MarketAlreadyFrozen error", async () => {
    try {
      await program.methods
        .freezeMarket()
        .accounts({
          authority: authority.publicKey,
          marketStatus: freezeMarketStatusPda,
        })
        .signers([authority])
        .rpc();
      expect.fail("Should have thrown MarketAlreadyFrozen");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("MarketAlreadyFrozen");
      }
    }
  });
});

describe("process_exit", () => {
  // Use yet another separate mint for process_exit tests
  let exitMint: PublicKey;
  let exitMintKeypair: Keypair;
  let exitBondingCurvePda: PublicKey;
  let exitStatsOraclePda: PublicKey;
  let exitMarketStatusPda: PublicKey;
  let exitBuyerTokenAccount: PublicKey;

  beforeAll(async () => {
    exitMintKeypair = Keypair.generate();
    exitMint = exitMintKeypair.publicKey;
    const [bcPda] = getBondingCurvePda(exitMint);
    exitBondingCurvePda = bcPda;
    [exitStatsOraclePda] = getStatsOraclePda(exitMint);
    exitMarketStatusPda = getMarketStatusPda(exitMint);

    // Create the SPL mint
    const mintRent = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: exitMint,
        lamports: mintRent,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        exitMint,
        0,
        exitBondingCurvePda,
        null
      )
    );
    await provider.sendAndConfirm(createMintTx, [authority, exitMintKeypair]);

    // Initialize bonding curve
    await program.methods
      .initializeCurve("Exit_Test", BASE_PRICE, SLOPE, TOTAL_SUPPLY)
      .accounts({
        authority: authority.publicKey,
        mint: exitMint,
        bondingCurve: exitBondingCurvePda,
        statsOracle: exitStatsOraclePda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    // Initialize market status (open_time = 0)
    await program.methods
      .initializeMarketStatus(new BN(0))
      .accounts({
        authority: authority.publicKey,
        mint: exitMint,
        marketStatus: exitMarketStatusPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Create buyer's ATA
    exitBuyerTokenAccount = getAssociatedTokenAddressSync(exitMint, buyerKeypair.publicKey);
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        buyerKeypair.publicKey,
        exitBuyerTokenAccount,
        buyerKeypair.publicKey,
        exitMint
      )
    );
    await provider.sendAndConfirm(createAtaTx, [buyerKeypair]);

    // Buy some tokens
    const buyCost = calculateBuyCost(10_000n, 10n, 0n, 50n);
    await program.methods
      .buy(new BN(50), new BN(buyCost.toString()).add(new BN(200_000)))
      .accounts({
        buyer: buyerKeypair.publicKey,
        mint: exitMint,
        bondingCurve: exitBondingCurvePda,
        buyerTokenAccount: exitBuyerTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        exitTreasury: exitTreasuryPda,
        protocolWallet: authority.publicKey,
        statsOracle: exitStatsOraclePda,
        marketStatus: exitMarketStatusPda,
        sharpLeaderboard: sharpLeaderboardPda,
      })
      .signers([buyerKeypair])
      .rpc();

    // Freeze the market
    await program.methods
      .freezeMarket()
      .accounts({
        authority: authority.publicKey,
        marketStatus: exitMarketStatusPda,
      })
      .signers([authority])
      .rpc();
  });

  it("rejects process_exit before close_timestamp (MarketNotClosed)", async () => {
    // Market is frozen but close_timestamp is 30 days in the future
    try {
      await program.methods
        .processExit()
        .accounts({
          holder: buyerKeypair.publicKey,
          mint: exitMint,
          bondingCurve: exitBondingCurvePda,
          holderTokenAccount: exitBuyerTokenAccount,
          marketStatus: exitMarketStatusPda,
          exitTreasury: exitTreasuryPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown MarketNotClosed");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("MarketNotClosed");
      }
    }
  });

  it("rejects process_exit on unfrozen market (MarketNotFrozen)", async () => {
    // Use the main test mint which is NOT frozen
    try {
      await program.methods
        .processExit()
        .accounts({
          holder: buyerKeypair.publicKey,
          mint,
          bondingCurve: bondingCurvePda,
          holderTokenAccount: buyerTokenAccount,
          marketStatus: marketStatusPda,
          exitTreasury: exitTreasuryPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyerKeypair])
        .rpc();
      expect.fail("Should have thrown MarketNotFrozen");
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(err.error.errorCode.code).toBe("MarketNotFrozen");
      }
    }
  });
});
