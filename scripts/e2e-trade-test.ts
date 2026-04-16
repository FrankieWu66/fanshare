/**
 * E2E Trade Test — Real multi-user buy/sell flow on devnet.
 *
 * 1. Register 2 demo users via /api/demo/register
 * 2. User A buys tokens for 3 players
 * 3. User B buys tokens for 2 players
 * 4. Both users sell some tokens
 * 5. Verify token balances
 * 6. Print results for QA report
 *
 * Run: npx tsx scripts/e2e-trade-test.ts
 */

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
import { getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import PLAYER_MINTS from "../app/lib/player-mints.json" with { type: "json" };

// ── Constants ──────────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");
const PROTOCOL_WALLET = new PublicKey("CsGh5T7EzTUW3hmdpjMrJyzBVq1RPnDXMr9VYuHyXa83");

const BUY_WITH_SOL_DISCRIMINATOR = Buffer.from([49, 57, 124, 194, 240, 20, 216, 102]);
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

const API_BASE = "https://fanshare-1.vercel.app";

// ── PDA derivation ─────────────────────────────────────────────────────────
function getPDA(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}
function bondingCurvePDA(mint: PublicKey): PublicKey {
  return getPDA([Buffer.from("bonding-curve"), mint.toBuffer()]);
}
function statsOraclePDA(mint: PublicKey): PublicKey {
  return getPDA([Buffer.from("stats-oracle"), mint.toBuffer()]);
}
function exitTreasuryPDA(): PublicKey {
  return getPDA([Buffer.from("exit-treasury")]);
}
function marketStatusPDA(mint: PublicKey): PublicKey {
  return getPDA([Buffer.from("market-status"), mint.toBuffer()]);
}
function sharpLeaderboardPDA(): PublicKey {
  return getPDA([Buffer.from("leaderboard"), Buffer.from([1])]);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function encodeU64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

function buildBuyWithSolIx(
  buyer: PublicKey, mint: PublicKey, buyerAta: PublicKey,
  solAmount: bigint, minTokensOut: bigint
): TransactionInstruction {
  const data = Buffer.concat([
    BUY_WITH_SOL_DISCRIMINATOR,
    encodeU64LE(solAmount),
    encodeU64LE(minTokensOut),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: bondingCurvePDA(mint), isSigner: false, isWritable: true },
      { pubkey: buyerAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: exitTreasuryPDA(), isSigner: false, isWritable: true },
      { pubkey: PROTOCOL_WALLET, isSigner: false, isWritable: true },
      { pubkey: statsOraclePDA(mint), isSigner: false, isWritable: false },
      { pubkey: marketStatusPDA(mint), isSigner: false, isWritable: false },
      { pubkey: sharpLeaderboardPDA(), isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildSellIx(
  seller: PublicKey, mint: PublicKey, sellerAta: PublicKey,
  tokenAmount: bigint, minSolOut: bigint
): TransactionInstruction {
  const data = Buffer.concat([
    SELL_DISCRIMINATOR,
    encodeU64LE(tokenAmount),
    encodeU64LE(minSolOut),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: bondingCurvePDA(mint), isSigner: false, isWritable: true },
      { pubkey: sellerAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: exitTreasuryPDA(), isSigner: false, isWritable: true },
      { pubkey: PROTOCOL_WALLET, isSigner: false, isWritable: true },
      { pubkey: statsOraclePDA(mint), isSigner: false, isWritable: false },
      { pubkey: marketStatusPDA(mint), isSigner: false, isWritable: false },
      { pubkey: sharpLeaderboardPDA(), isSigner: false, isWritable: false },
    ],
    data,
  });
}

interface DemoUser {
  name: string;
  keypair: Keypair;
  address: string;
}

async function registerDemo(name: string): Promise<DemoUser> {
  const res = await fetch(`${API_BASE}/api/demo/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: name }),
  });
  const data = await res.json();
  if (!data.address || !data.secretKey) throw new Error(`Register failed: ${JSON.stringify(data)}`);
  const keypair = Keypair.fromSecretKey(Uint8Array.from(data.secretKey));
  console.log(`  ✓ ${name}: ${data.address} (${data.returning ? "returning" : "new"}, funded=${!data.airdropFailed})`);
  return { name, keypair, address: data.address };
}

async function getTokenBalance(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const info = await connection.getTokenAccountBalance(ata);
    return BigInt(info.value.amount);
  } catch {
    return 0n;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  const mints = PLAYER_MINTS as Record<string, string>;

  console.log("\n🏀 FanShare E2E Trade Test");
  console.log(`RPC: ${rpcUrl.replace(/api-key=.*/, "api-key=***")}`);
  console.log(`Program: ${PROGRAM_ID.toString()}`);

  // ── Step 1: Register demo users ──────────────────────────────────────
  console.log("\n── Step 1: Register demo users ──");
  const userA = await registerDemo("E2E_Trader_Alpha");
  const userB = await registerDemo("E2E_Trader_Beta");

  // Check balances
  const balA = await connection.getBalance(userA.keypair.publicKey);
  const balB = await connection.getBalance(userB.keypair.publicKey);
  console.log(`  User A balance: ${balA / LAMPORTS_PER_SOL} SOL`);
  console.log(`  User B balance: ${balB / LAMPORTS_PER_SOL} SOL`);

  if (balA < 0.1 * LAMPORTS_PER_SOL || balB < 0.1 * LAMPORTS_PER_SOL) {
    throw new Error("Insufficient SOL in demo wallets. Deploy wallet may be dry.");
  }

  // ── Step 2: User A buys tokens for 3 players ────────────────────────
  const buyPlayers = ["Player_NJ", "Player_JE", "Player_VW"];
  const buySolAmount = BigInt(Math.round(0.05 * LAMPORTS_PER_SOL)); // 0.05 SOL each

  console.log("\n── Step 2: User A buys tokens ──");
  for (const playerId of buyPlayers) {
    const mint = new PublicKey(mints[playerId]);
    const ata = await getAssociatedTokenAddress(mint, userA.keypair.publicKey);

    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      userA.keypair.publicKey, ata, userA.keypair.publicKey, mint
    );
    const buyIx = buildBuyWithSolIx(userA.keypair.publicKey, mint, ata, buySolAmount, 0n);

    const tx = new Transaction().add(createAtaIx, buyIx);
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [userA.keypair], { commitment: "confirmed" });
      const balance = await getTokenBalance(connection, userA.keypair.publicKey, mint);
      console.log(`  ✓ ${playerId}: bought ${balance} tokens for 0.05 SOL (tx: ${sig.slice(0, 20)}...)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${playerId}: FAILED — ${msg.slice(0, 200)}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Step 3: User B buys tokens for 2 players ────────────────────────
  const buyPlayersB = ["Player_NJ", "Player_GA"];

  console.log("\n── Step 3: User B buys tokens ──");
  for (const playerId of buyPlayersB) {
    const mint = new PublicKey(mints[playerId]);
    const ata = await getAssociatedTokenAddress(mint, userB.keypair.publicKey);

    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      userB.keypair.publicKey, ata, userB.keypair.publicKey, mint
    );
    const buyIx = buildBuyWithSolIx(userB.keypair.publicKey, mint, ata, buySolAmount, 0n);

    const tx = new Transaction().add(createAtaIx, buyIx);
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [userB.keypair], { commitment: "confirmed" });
      const balance = await getTokenBalance(connection, userB.keypair.publicKey, mint);
      console.log(`  ✓ ${playerId}: bought ${balance} tokens for 0.05 SOL (tx: ${sig.slice(0, 20)}...)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${playerId}: FAILED — ${msg.slice(0, 200)}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Step 4: User A sells half their NJ tokens ───────────────────────
  console.log("\n── Step 4: User A sells half NJ tokens ──");
  {
    const mint = new PublicKey(mints["Player_NJ"]);
    const ata = await getAssociatedTokenAddress(mint, userA.keypair.publicKey);
    const balance = await getTokenBalance(connection, userA.keypair.publicKey, mint);
    const sellAmount = balance / 2n;
    if (sellAmount > 0n) {
      const sellIx = buildSellIx(userA.keypair.publicKey, mint, ata, sellAmount, 0n);
      const tx = new Transaction().add(sellIx);
      try {
        const sig = await sendAndConfirmTransaction(connection, tx, [userA.keypair], { commitment: "confirmed" });
        const newBalance = await getTokenBalance(connection, userA.keypair.publicKey, mint);
        console.log(`  ✓ Sold ${sellAmount} NJ tokens (had ${balance}, now ${newBalance}) (tx: ${sig.slice(0, 20)}...)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ Sell FAILED — ${msg.slice(0, 200)}`);
      }
    } else {
      console.log("  ⚠ No NJ tokens to sell");
    }
  }

  // ── Step 5: User B sells all GA tokens ───────────────────────────────
  console.log("\n── Step 5: User B sells all GA tokens ──");
  {
    const mint = new PublicKey(mints["Player_GA"]);
    const ata = await getAssociatedTokenAddress(mint, userB.keypair.publicKey);
    const balance = await getTokenBalance(connection, userB.keypair.publicKey, mint);
    if (balance > 0n) {
      const sellIx = buildSellIx(userB.keypair.publicKey, mint, ata, balance, 0n);
      const tx = new Transaction().add(sellIx);
      try {
        const sig = await sendAndConfirmTransaction(connection, tx, [userB.keypair], { commitment: "confirmed" });
        const newBalance = await getTokenBalance(connection, userB.keypair.publicKey, mint);
        console.log(`  ✓ Sold ${balance} GA tokens (now ${newBalance}) (tx: ${sig.slice(0, 20)}...)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ Sell FAILED — ${msg.slice(0, 200)}`);
      }
    } else {
      console.log("  ⚠ No GA tokens to sell");
    }
  }

  // ── Step 6: Final balance check ──────────────────────────────────────
  console.log("\n── Step 6: Final balances ──");
  const checkPlayers = ["Player_NJ", "Player_JE", "Player_VW", "Player_GA"];
  for (const playerId of checkPlayers) {
    const mint = new PublicKey(mints[playerId]);
    const balanceA = await getTokenBalance(connection, userA.keypair.publicKey, mint);
    const balanceB = await getTokenBalance(connection, userB.keypair.publicKey, mint);
    console.log(`  ${playerId}: User A = ${balanceA} tokens, User B = ${balanceB} tokens`);
  }

  // SOL balances
  const finalBalA = await connection.getBalance(userA.keypair.publicKey);
  const finalBalB = await connection.getBalance(userB.keypair.publicKey);
  console.log(`\n  User A SOL: ${(finalBalA / LAMPORTS_PER_SOL).toFixed(4)} (spent ${((balA - finalBalA) / LAMPORTS_PER_SOL).toFixed(4)})`);
  console.log(`  User B SOL: ${(finalBalB / LAMPORTS_PER_SOL).toFixed(4)} (spent ${((balB - finalBalB) / LAMPORTS_PER_SOL).toFixed(4)})`);

  console.log("\n✅ E2E trade test complete!\n");
  console.log("User A address:", userA.address);
  console.log("User B address:", userB.address);
}

main().catch(err => {
  console.error("\n❌ E2E test failed:", err);
  process.exit(1);
});
