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

// ── AMM liquidity parameters (Demo 1 brief + CEO gate, 2026-04-18) ────────
// base_price = 4-pillar index price at launch (Jerry's formula, 2026-04-15), frozen.
// Slope tiered by base_price (CEO gate 2026-04-18, revised 2026-04-18 v2):
// Flat slope produces ~99% price impact on cheap players ($1 base) and ~6% on
// expensive ($6.88 base). Tiering equalizes perceived demo spread.
//
// Demo 1 uses 2 tiers because the 15-player roster has no base prices under $2:
//   expensive (usd ≥ $5)   → 150,000 lamports/token
//   standard (usd < $5)    →  50,000 lamports/token
//
// Demo 2 will reintroduce a 3rd cheap tier (8,000 lamports) once the roster
// expands to 100+ players and floor players ($0.25–$2.49) actually exist.
//
// Supply cap = 5,000 tokens/market (was 1M). Tightened for 10–15 user invite demo.
// Slope + supply frozen at init (same immutability rule as base_price).
// Curves NEVER migrate to external AMMs — oracle anchor is the product.
const TOTAL_SUPPLY = 5_000n;

function slopeForUsd(usd: number): bigint {
  if (usd >= 5.0) return 150_000n;
  return 50_000n;
}

// ── Jerry's benchmark base prices (2026-04-18, locked for Demo 1) ──────────
// Source: jerryzhu/output/Index Price Formula.md simulation table.
// Jerry ran the 4-pillar formula against 2024-25 StatMuse stats for 14 of our
// 15 players. Our `DEVNET_PLAYERS` stat lines in fanshare-program.ts are
// hand-typed placeholders that drift per-player (Cade -40%, LeBron +29%, KD
// +26%). We override with Jerry's published benchmarks so Demo 1 launches on
// the source-of-truth numbers. Embiid isn't in Jerry's 17-player sim — falls
// back to the computed value (roughly MVP-tier, lands in expensive slope).
//
// Demo 2 migration: replace this table with a live balldontlie GOAT-tier
// (`/v1/stats/advanced` with ?season=YYYY) fetch at init time. Re-init is not
// allowed on existing markets — base prices are immutable per market — so
// Demo 2 will either launch new markets or keep these frozen values.
const BENCHMARK_PRICES_USD: Record<string, number> = {
  Player_NJ:  7.82, // Nikola Jokić
  Player_SGA: 7.29, // Shai Gilgeous-Alexander
  Player_GA:  6.69, // Giannis Antetokounmpo
  Player_VW:  6.16, // Victor Wembanyama
  Player_AD:  5.94, // Anthony Davis
  Player_JT:  5.51, // Jayson Tatum
  Player_LD:  5.14, // Luka Dončić
  Player_TH:  5.13, // Tyrese Haliburton
  Player_KD:  4.58, // Kevin Durant
  Player_SC:  4.41, // Stephen Curry
  Player_LBJ: 4.33, // LeBron James
  Player_CC:  4.23, // Cade Cunningham
  Player_JB:  4.07, // Jaylen Brown
  Player_DB:  3.90, // Devin Booker
};

function getPlayerParams(
  playerId: string,
  stats: typeof DEVNET_PLAYERS[number]["stats"],
): { basePrice: bigint; slope: bigint; totalSupply: bigint; usdPrice: number; source: "benchmark" | "computed" } {
  const benchmark = BENCHMARK_PRICES_USD[playerId];
  if (benchmark !== undefined) {
    return {
      basePrice: usdToLamports(benchmark),
      slope: slopeForUsd(benchmark),
      totalSupply: TOTAL_SUPPLY,
      usdPrice: benchmark,
      source: "benchmark",
    };
  }
  const pillars = calculatePillarBreakdown(stats);
  return {
    basePrice: usdToLamports(pillars.usdPrice),
    slope: slopeForUsd(pillars.usdPrice),
    totalSupply: TOTAL_SUPPLY,
    usdPrice: pillars.usdPrice,
    source: "computed",
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
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    console.log(`\n🔍 FanShare — Init Players (DRY RUN — no on-chain calls)`);
    console.log(`\nTier distribution preview (slope by usdPrice):`);
    console.log(`  expensive (≥$5)  → 150,000 lam/token`);
    console.log(`  standard  (<$5)  →  50,000 lam/token`);
    console.log(`  (cheap tier deferred to Demo 2 — no roster players under $2)`);
    console.log(`\nSupply cap: ${TOTAL_SUPPLY.toLocaleString()} tokens/market`);
    console.log(`\nPer-player params:`);
    const tiers = { expensive: 0, standard: 0 };
    for (const player of DEVNET_PLAYERS) {
      const { basePrice, slope, totalSupply, usdPrice, source } = getPlayerParams(player.id, player.stats);
      const tier = slope === 150_000n ? "expensive" : "standard";
      tiers[tier]++;
      const srcTag = source === "benchmark" ? "[Jerry]" : "[computed]";
      console.log(`  ${player.id.padEnd(14)} (${player.displayName.padEnd(24)}) $${usdPrice.toFixed(2).padStart(6)} → slope=${slope.toString().padStart(7)} supply=${totalSupply} [${tier}] ${srcTag}`);
    }
    console.log(`\nTier counts: expensive=${tiers.expensive} standard=${tiers.standard}`);
    return;
  }

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

    const { basePrice, slope, totalSupply, usdPrice, source } = getPlayerParams(player.id, player.stats);
    console.log(`\n⏳ Initializing ${player.id} (${player.displayName})...`);
    console.log(`   Index price: $${usdPrice.toFixed(2)} [${source}] | base=${basePrice.toLocaleString()}L slope=${slope} supply=${totalSupply.toLocaleString()}`);

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
