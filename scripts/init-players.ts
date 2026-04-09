/**
 * FanShare — Initialize all 15 devnet player tokens.
 *
 * For each player:
 *   1. Generate a fresh mint keypair
 *   2. Derive bonding_curve PDA  ← used as mint authority
 *   3. Create the SPL mint (0 decimals, bonding_curve PDA as authority)
 *   4. Call initialize_curve(player_id, base_price=1000, slope=10, total_supply=1_000_000)
 *
 * Saves mint addresses to app/lib/player-mints.json so the frontend can reference them.
 *
 * Run:  npm run init-players
 * Req:  Devnet SOL in ~/.config/solana/id.json  (2–3 SOL covers all 15 players)
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
} from "@solana/web3.js";
import { createMint } from "@solana/spl-token";

// ── Constants ──────────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("B69juh6rX1Z6WNN2qCkrhuHDnk6v5vrK8oJ2o6oHTVYz");
const TOKEN_DECIMALS = 0; // integer tokens (no fractional)

// ── Stats-anchored pricing (CEO review 2026-04-06) ─────────────────────────
// base_price is set once at init from player stats. Never mutated by oracle.
// formula: oracle_score = PPG×1000 + RPG×500 + APG×700 + SPG×800 + BPG×800
//          base_price   = round(oracle_score × 0.5)  [lamports]
// tier (slope + supply) derived from oracle_score:
//   Stars  (≥40k): slope=50,  supply=500,000
//   Second (≥25k): slope=20,  supply=750,000
//   Rising (<25k): slope=8,   supply=1,000,000
interface PlayerInitStats { ppg: number; rpg: number; apg: number; spg: number; bpg: number; }

function getPlayerParams(stats: PlayerInitStats): { basePrice: bigint; slope: bigint; totalSupply: bigint } {
  const score = stats.ppg * 1000 + stats.rpg * 500 + stats.apg * 700 + stats.spg * 800 + stats.bpg * 800;
  const basePrice = BigInt(Math.round(score * 0.5));
  if (score >= 40_000) return { basePrice, slope: 50n, totalSupply: 500_000n };
  if (score >= 25_000) return { basePrice, slope: 20n, totalSupply: 750_000n };
  return { basePrice, slope: 8n, totalSupply: 1_000_000n };
}

// initialize_curve discriminator from IDL — DO NOT CHANGE
const INIT_CURVE_DISCRIMINATOR = Buffer.from([170, 84, 186, 253, 131, 149, 95, 213]);

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// ── Player roster with stats for pricing formula ────────────────────────────
const DEVNET_PLAYERS = [
  { id: "Player_LD",  displayName: "The Maverick",    stats: { ppg: 33.9, rpg: 9.2,  apg: 9.8,  spg: 1.4, bpg: 0.5 } },
  { id: "Player_JE",  displayName: "The Process",     stats: { ppg: 34.7, rpg: 11.0, apg: 5.6,  spg: 1.2, bpg: 1.7 } },
  { id: "Player_GA",  displayName: "The Greek Freak", stats: { ppg: 30.4, rpg: 11.5, apg: 6.5,  spg: 1.2, bpg: 1.1 } },
  { id: "Player_NJ",  displayName: "The Joker",       stats: { ppg: 26.4, rpg: 12.4, apg: 9.0,  spg: 1.4, bpg: 0.9 } },
  { id: "Player_SGA", displayName: "The Shai",        stats: { ppg: 30.1, rpg: 5.5,  apg: 6.2,  spg: 2.0, bpg: 0.7 } },
  { id: "Player_LBJ", displayName: "The King",        stats: { ppg: 25.7, rpg: 7.3,  apg: 8.3,  spg: 1.3, bpg: 0.5 } },
  { id: "Player_AD",  displayName: "The Brow",        stats: { ppg: 24.7, rpg: 12.6, apg: 3.5,  spg: 1.2, bpg: 2.3 } },
  { id: "Player_KD",  displayName: "The Slim Reaper", stats: { ppg: 27.1, rpg: 6.6,  apg: 5.0,  spg: 0.9, bpg: 1.4 } },
  { id: "Player_JT",  displayName: "The Jaybird",     stats: { ppg: 26.9, rpg: 8.1,  apg: 4.9,  spg: 1.0, bpg: 0.6 } },
  { id: "Player_DB",  displayName: "The Book",        stats: { ppg: 27.1, rpg: 4.5,  apg: 6.9,  spg: 0.9, bpg: 0.3 } },
  { id: "Player_SC",  displayName: "The Chef",        stats: { ppg: 26.4, rpg: 4.5,  apg: 6.1,  spg: 0.7, bpg: 0.4 } },
  { id: "Player_TH",  displayName: "The Hali",        stats: { ppg: 20.7, rpg: 3.7,  apg: 10.9, spg: 1.2, bpg: 0.7 } },
  { id: "Player_CC",  displayName: "The Cade",        stats: { ppg: 22.7, rpg: 4.3,  apg: 7.5,  spg: 0.9, bpg: 0.3 } },
  { id: "Player_VW",  displayName: "The Alien",       stats: { ppg: 21.4, rpg: 10.6, apg: 3.9,  spg: 1.2, bpg: 3.6 } },
  { id: "Player_JB",  displayName: "The Jet",         stats: { ppg: 23.0, rpg: 5.5,  apg: 3.6,  spg: 1.2, bpg: 0.5 } },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function encodeU64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

/** Encode an Anchor string: 4-byte LE length prefix + UTF-8 bytes */
function encodeAnchorString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf-8");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([prefix, bytes]);
}

function getBondingCurvePda(mintPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mintPubkey.toBuffer()],
    PROGRAM_ID
  );
}

function getStatsOraclePda(mintPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stats-oracle"), mintPubkey.toBuffer()],
    PROGRAM_ID
  );
}

function buildInitCurveInstruction(
  authority: PublicKey,
  mint: PublicKey,
  bondingCurvePda: PublicKey,
  statsOraclePda: PublicKey,
  playerId: string,
  basePrice: bigint,
  slope: bigint,
  totalSupply: bigint,
): TransactionInstruction {
  const data = Buffer.concat([
    INIT_CURVE_DISCRIMINATOR,
    encodeAnchorString(playerId),
    encodeU64LE(basePrice),
    encodeU64LE(slope),
    encodeU64LE(totalSupply),
  ]);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority,       isSigner: true,  isWritable: true  }, // authority
      { pubkey: mint,            isSigner: false, isWritable: true  }, // mint
      { pubkey: bondingCurvePda, isSigner: false, isWritable: true  }, // bonding_curve PDA
      { pubkey: statsOraclePda,  isSigner: false, isWritable: true  }, // stats_oracle PDA
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,        isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "http://localhost:8899"; // localnet default — matches Anchor.toml
  const connection = new Connection(rpcUrl, "confirmed");

  // Load authority keypair from Solana CLI default path
  const walletPath = path.join(process.env.HOME!, ".config/solana/id.json");
  if (!fs.existsSync(walletPath)) {
    throw new Error(`No keypair at ${walletPath}. Run: solana-keygen new`);
  }
  const walletData: number[] = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const authority = Keypair.fromSecretKey(new Uint8Array(walletData));

  console.log(`\n🏀 FanShare — Init Players`);
  console.log(`Authority: ${authority.publicKey.toString()}`);

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`Balance:   ${balance / 1e9} SOL`);
  if (balance < 0.2e9) {
    throw new Error(
      `Insufficient SOL. Need at least 0.5 SOL, have ${balance / 1e9}.\n` +
      `Visit https://faucet.solana.com and airdrop to: ${authority.publicKey.toString()}`
    );
  }

  // Load or initialize output file (resume-safe: skip already-initialized players)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outputPath = path.join(__dirname, "../app/lib/player-mints.json");
  const existingMints: Record<string, string> = fs.existsSync(outputPath)
    ? JSON.parse(fs.readFileSync(outputPath, "utf-8"))
    : {};

  const results: Record<string, string> = { ...existingMints };

  for (const player of DEVNET_PLAYERS) {
    if (results[player.id]) {
      console.log(`\n⏭  ${player.id} already initialized (${results[player.id]})`);
      continue;
    }

    const { basePrice, slope, totalSupply } = getPlayerParams(player.stats);
    const score = Math.round(player.stats.ppg * 1000 + player.stats.rpg * 500 + player.stats.apg * 700 + player.stats.spg * 800 + player.stats.bpg * 800);
    const tier = score >= 40_000 ? "Stars" : score >= 25_000 ? "Second" : "Rising";
    console.log(`\n⏳ Initializing ${player.id} (${player.displayName})...`);
    console.log(`   Score: ${score} → ${tier} tier | base=${basePrice}L slope=${slope} supply=${totalSupply.toLocaleString()}`);

    // Step 1: Generate mint keypair
    const mintKeypair = Keypair.generate();
    const mintPubkey = mintKeypair.publicKey;

    // Step 2: Derive PDAs
    const [bondingCurvePda] = getBondingCurvePda(mintPubkey);
    const [statsOraclePda]  = getStatsOraclePda(mintPubkey);

    console.log(`   Mint:          ${mintPubkey.toString()}`);
    console.log(`   BondingCurve:  ${bondingCurvePda.toString()}`);
    console.log(`   StatsOracle:   ${statsOraclePda.toString()}`);

    // Step 3: Create the SPL mint (bonding_curve PDA is mint authority)
    console.log(`   Creating mint...`);
    await createMint(
      connection,
      authority,       // payer
      bondingCurvePda, // mint authority — MUST be bonding_curve PDA per constraint
      null,            // freeze authority — none
      TOKEN_DECIMALS,  // 0 decimals = integer tokens
      mintKeypair      // mint account keypair
    );
    console.log(`   ✓ Mint created`);

    // Step 4: Call initialize_curve
    console.log(`   Calling initialize_curve...`);
    const ix = buildInitCurveInstruction(
      authority.publicKey,
      mintPubkey,
      bondingCurvePda,
      statsOraclePda,
      player.id,
      basePrice,
      slope,
      totalSupply,
    );

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
      commitment: "confirmed",
    });
    console.log(`   ✓ Initialized — tx: ${sig}`);

    results[player.id] = mintPubkey.toString();

    // Write after each player so the file is always up to date (resume-safe)
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

    // 1 second between players to be kind to the RPC
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n✅ All ${DEVNET_PLAYERS.length} players initialized!`);
  console.log(`Mint addresses saved to: ${outputPath}`);
  console.log(`\nMint map:`);
  for (const [id, mint] of Object.entries(results)) {
    console.log(`  ${id.padEnd(12)} ${mint}`);
  }
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message ?? err);
  process.exit(1);
});
