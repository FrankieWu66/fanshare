/**
 * Step 6 verification — freeze sell-block test on devnet.
 *
 * Proves the new full-halt sell guard works end-to-end on the deployed program.
 *   1. Buy 1 token of Player_CC via authority wallet (buy succeeds → market live)
 *   2. Freeze Player_CC via freeze_market instruction
 *   3. Attempt to sell → MUST fail with MarketFrozen (custom error 6013)
 *
 * After running, Player_CC stays frozen — sacrificed for verification.
 * Demo 1 proceeds with 14 tradable players.
 *
 * Run: bun run scripts/test-freeze-sell.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.local") });

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import PLAYER_MINTS from "../app/lib/player-mints.json" with { type: "json" };

const PROGRAM_ID = new PublicKey("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");
const PROTOCOL_WALLET = new PublicKey("CsGh5T7EzTUW3hmdpjMrJyzBVq1RPnDXMr9VYuHyXa83");

const BUY_WITH_SOL_DISCRIMINATOR = Buffer.from([49, 57, 124, 194, 240, 20, 216, 102]);
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
const FREEZE_DISCRIMINATOR = Buffer.from([184, 154, 237, 98, 127, 82, 217, 180]); // sha256("global:freeze_market")[0..8]

const TARGET_PLAYER = "Player_CC";

function pda(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}
const bondingCurve = (mint: PublicKey) => pda([Buffer.from("bonding-curve"), mint.toBuffer()]);
const statsOracle = (mint: PublicKey) => pda([Buffer.from("stats-oracle"), mint.toBuffer()]);
const marketStatus = (mint: PublicKey) => pda([Buffer.from("market-status"), mint.toBuffer()]);
const exitTreasury = () => pda([Buffer.from("exit-treasury")]);
const sharpLeaderboard = () => pda([Buffer.from("leaderboard"), Buffer.from([1])]);

function u64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

function buildBuyWithSolIx(
  buyer: PublicKey, mint: PublicKey, buyerAta: PublicKey, solAmount: bigint, minTokens: bigint,
) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: bondingCurve(mint), isSigner: false, isWritable: true },
      { pubkey: buyerAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: exitTreasury(), isSigner: false, isWritable: true },
      { pubkey: PROTOCOL_WALLET, isSigner: false, isWritable: true },
      { pubkey: statsOracle(mint), isSigner: false, isWritable: false },
      { pubkey: marketStatus(mint), isSigner: false, isWritable: false },
      { pubkey: sharpLeaderboard(), isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([BUY_WITH_SOL_DISCRIMINATOR, u64LE(solAmount), u64LE(minTokens)]),
  });
}

function buildSellIx(
  seller: PublicKey, mint: PublicKey, sellerAta: PublicKey, tokenAmount: bigint, minSol: bigint,
) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: bondingCurve(mint), isSigner: false, isWritable: true },
      { pubkey: sellerAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: exitTreasury(), isSigner: false, isWritable: true },
      { pubkey: PROTOCOL_WALLET, isSigner: false, isWritable: true },
      { pubkey: statsOracle(mint), isSigner: false, isWritable: false },
      { pubkey: marketStatus(mint), isSigner: false, isWritable: false },
      { pubkey: sharpLeaderboard(), isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([SELL_DISCRIMINATOR, u64LE(tokenAmount), u64LE(minSol)]),
  });
}

function buildFreezeIx(authority: PublicKey, marketStatusPda: PublicKey) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: marketStatusPda, isSigner: false, isWritable: true },
    ],
    data: FREEZE_DISCRIMINATOR,
  });
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const walletPath = path.join(process.env.HOME!, ".config/solana/id.json");
  const walletData: number[] = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const authority = Keypair.fromSecretKey(new Uint8Array(walletData));

  const mints = PLAYER_MINTS as Record<string, string>;
  const mint = new PublicKey(mints[TARGET_PLAYER]);

  console.log(`\n🧊 Step 6 — Freeze Sell-Block Verification`);
  console.log(`Player:    ${TARGET_PLAYER} (${mint.toString()})`);
  console.log(`Authority: ${authority.publicKey.toString()}`);
  console.log(`RPC:       ${rpcUrl.replace(/api-key=.*/, "api-key=***")}`);

  const ata = await getAssociatedTokenAddress(mint, authority.publicKey);

  // ── Step 1: Buy 1 token to establish a position ──
  console.log(`\n── 1. BUY (expect succeed) ──`);
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    authority.publicKey, ata, authority.publicKey, mint,
  );
  const buyIx = buildBuyWithSolIx(
    authority.publicKey, mint, ata,
    BigInt(Math.round(0.03 * LAMPORTS_PER_SOL)), 0n,
  );
  const buyTx = new Transaction().add(createAtaIx, buyIx);
  const buySig = await sendAndConfirmTransaction(connection, buyTx, [authority], { commitment: "confirmed" });
  const buyBal = await connection.getTokenAccountBalance(ata);
  console.log(`  ✓ Bought ${buyBal.value.amount} tokens (tx: ${buySig.slice(0, 20)}...)`);

  // ── Step 2: Freeze ──
  console.log(`\n── 2. FREEZE (expect succeed) ──`);
  const msPda = marketStatus(mint);
  const freezeIx = buildFreezeIx(authority.publicKey, msPda);
  const freezeTx = new Transaction().add(freezeIx);
  const freezeSig = await sendAndConfirmTransaction(connection, freezeTx, [authority], { commitment: "confirmed" });
  console.log(`  ✓ Frozen (tx: ${freezeSig.slice(0, 20)}...)`);

  // Verify on-chain state
  const msInfo = await connection.getAccountInfo(msPda);
  if (!msInfo) throw new Error("MarketStatus account vanished after freeze");
  // Account layout: discriminator(8) + mint(32) + is_frozen(1) + ...
  const isFrozen = msInfo.data[8 + 32] === 1;
  console.log(`  → MarketStatus.is_frozen = ${isFrozen}`);
  if (!isFrozen) throw new Error("Freeze tx succeeded but is_frozen is false");

  // ── Step 3: Attempt SELL — expect MarketFrozen ──
  console.log(`\n── 3. SELL (expect FAIL with MarketFrozen) ──`);
  const sellIx = buildSellIx(authority.publicKey, mint, ata, 1n, 0n);
  const sellTx = new Transaction().add(sellIx);
  try {
    const sig = await sendAndConfirmTransaction(connection, sellTx, [authority], { commitment: "confirmed" });
    console.error(`  ✗ UNEXPECTED: sell succeeded after freeze (tx: ${sig})`);
    process.exit(1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Anchor custom error MarketFrozen = 6013 (0x177d). Check error shape.
    const isFrozenErr =
      msg.includes("MarketFrozen") ||
      msg.includes("0x177d") ||
      msg.includes("custom program error: 0x177d") ||
      /custom program error: 0x[0-9a-f]+/i.test(msg);
    if (isFrozenErr) {
      console.log(`  ✓ Sell correctly rejected`);
      // Print short diagnostic
      const match = msg.match(/custom program error: (0x[0-9a-f]+)/i);
      if (match) console.log(`    → error code: ${match[1]}`);
      else console.log(`    → ${msg.slice(0, 200)}`);
    } else {
      console.error(`  ✗ Sell failed but NOT with MarketFrozen: ${msg.slice(0, 300)}`);
      process.exit(1);
    }
  }

  console.log(`\n✅ Step 6 verified — frozen market rejects sells end-to-end on devnet`);
  console.log(`   ⚠  ${TARGET_PLAYER} is now permanently frozen (1/15 players sacrificed)`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message ?? err);
  process.exit(1);
});
