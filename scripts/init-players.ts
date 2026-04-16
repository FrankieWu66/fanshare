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
import { DEVNET_PLAYERS } from "../app/lib/fanshare-program.js";
import { calculatePillarBreakdown, usdToLamports } from "../app/lib/oracle-weights.js";

// ── Constants ──────────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");
const TOKEN_DECIMALS = 0; // integer tokens (no fractional)

// ── Stats-anchored pricing (Jerry's 4-pillar formula, 2026-04-15) ──────────
// base_price = the 4-pillar index price at launch. Spread = 0% at open.
// AMM (slope + supply) moves market price from there as buyers/sellers trade.
// Slope + supply are placeholders for now — AMM tuning deferred until post-launch.
const PLACEHOLDER_SLOPE = 1n;
const PLACEHOLDER_TOTAL_SUPPLY = 1_000_000n;

function getPlayerParams(stats: typeof DEVNET_PLAYERS[number]["stats"]): { basePrice: bigint; slope: bigint; totalSupply: bigint; usdPrice: number } {
  const pillars = calculatePillarBreakdown(stats);
  return {
    basePrice: usdToLamports(pillars.usdPrice),
    slope: PLACEHOLDER_SLOPE,
    totalSupply: PLACEHOLDER_TOTAL_SUPPLY,
    usdPrice: pillars.usdPrice,
  };
}

// initialize_curve discriminator from IDL — DO NOT CHANGE
const INIT_CURVE_DISCRIMINATOR = Buffer.from([170, 84, 186, 253, 131, 149, 95, 213]);

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

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

    const { basePrice, slope, totalSupply, usdPrice } = getPlayerParams(player.stats);
    console.log(`\n⏳ Initializing ${player.id} (${player.displayName})...`);
    console.log(`   Index price: $${usdPrice.toFixed(2)} | base=${basePrice.toLocaleString()}L slope=${slope} supply=${totalSupply.toLocaleString()}`);

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
