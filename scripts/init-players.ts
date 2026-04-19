/**
 * FanShare — Initialize all 15 devnet player tokens.
 *
 * For each player:
 *   1. Resolve stats (live balldontlie, or --mock for hardcoded dev stats)
 *   2. Compute pillar usdPrice from the 4-pillar formula
 *   3. Create mint + bonding curve with base_price = usdToLamports(usdPrice)
 *   4. IMMEDIATELY write the first oracle tick with index_price = SAME lamports
 *
 * Because (3) and (4) share one in-memory `pillars` snapshot, base_price and
 * index_price are identical bytes → spread = 0 at T0. The formula is the
 * contract; no Jerry-benchmark override.
 *
 * Run:  npm run init-players           (live balldontlie)
 *       npm run init-players -- --mock (hardcoded stats from DEVNET_PLAYERS)
 *       npm run init-players -- --dry-run (preview, no on-chain calls)
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
import { DEVNET_PLAYERS } from "../app/lib/fanshare-program";
import { calculatePillarBreakdown, usdToLamports } from "../app/lib/oracle-weights";
import { resolveStats } from "../app/lib/shared/stats";
import { getBondingCurvePda, getStatsOraclePda, PROGRAM_ID } from "../app/lib/shared/pdas";
import {
  buildUpdateOracleInstruction,
  pillarLamportDeltas,
} from "../app/lib/shared/oracle-instruction";

// ── Constants ──────────────────────────────────────────────────────────────
const TOKEN_DECIMALS = 0; // integer tokens (no fractional)

// ── AMM liquidity parameters (Demo 1 brief + CEO gate, 2026-04-18) ────────
// Slope tiered by base_price:
//   expensive (usd ≥ $5) → 150,000 lamports/token
//   standard (usd < $5)  →  50,000 lamports/token
// Supply cap = 5,000 tokens/market.
const TOTAL_SUPPLY = 5_000n;

function slopeForUsd(usd: number): bigint {
  if (usd >= 5.0) return 150_000n;
  return 50_000n;
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
  const useMock = process.argv.includes("--mock");

  if (dryRun) {
    console.log(`\n🔍 FanShare — Init Players (DRY RUN — no on-chain calls)`);
    console.log(`Mode: ${useMock ? "MOCK (hardcoded stats)" : "LIVE (balldontlie.io API)"}`);
    console.log(`\nTier distribution preview (slope by usdPrice):`);
    console.log(`  expensive (≥$5)  → 150,000 lam/token`);
    console.log(`  standard  (<$5)  →  50,000 lam/token`);
    console.log(`\nSupply cap: ${TOTAL_SUPPLY.toLocaleString()} tokens/market`);
    console.log(`\nPer-player params:`);
    const tiers = { expensive: 0, standard: 0 };
    for (const player of DEVNET_PLAYERS) {
      const stats = await resolveStats(player.id, { mock: useMock });
      if (!stats) {
        console.log(`  ${player.id.padEnd(14)} — no stats resolved, SKIP`);
        continue;
      }
      const pillars = calculatePillarBreakdown(stats);
      const slope = slopeForUsd(pillars.usdPrice);
      const tier = slope === 150_000n ? "expensive" : "standard";
      tiers[tier]++;
      console.log(
        `  ${player.id.padEnd(14)} (${player.displayName.padEnd(24)}) ` +
        `$${pillars.usdPrice.toFixed(2).padStart(6)} → slope=${slope.toString().padStart(7)} ` +
        `supply=${TOTAL_SUPPLY} [${tier}]`
      );
    }
    console.log(`\nTier counts: expensive=${tiers.expensive} standard=${tiers.standard}`);
    return;
  }

  const rpcUrl = process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
  const connection = new Connection(rpcUrl, "confirmed");

  // Load authority keypair from Solana CLI default path
  const walletPath = path.join(process.env.HOME!, ".config/solana/id.json");
  if (!fs.existsSync(walletPath)) {
    throw new Error(`No keypair at ${walletPath}. Run: solana-keygen new`);
  }
  const walletData: number[] = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const authority = Keypair.fromSecretKey(new Uint8Array(walletData));

  console.log(`\n🏀 FanShare — Init Players`);
  console.log(`Mode:      ${useMock ? "MOCK (hardcoded stats)" : "LIVE (balldontlie.io API)"}`);
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
  const statsSourceDate = BigInt(Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000));

  for (const player of DEVNET_PLAYERS) {
    if (results[player.id]) {
      console.log(`\n⏭  ${player.id} already initialized (${results[player.id]})`);
      continue;
    }

    // Resolve stats → compute pillars ONCE. Both base_price (init_curve) and
    // index_price (update_oracle) derive from this same in-memory object,
    // guaranteeing spread = 0 at T0.
    const stats = await resolveStats(player.id, { mock: useMock });
    if (!stats) {
      console.log(`\n⏭  ${player.id} — no stats available, skipping`);
      continue;
    }
    const pillars = calculatePillarBreakdown(stats);
    const indexLamports = usdToLamports(pillars.usdPrice);
    const slope = slopeForUsd(pillars.usdPrice);

    console.log(`\n⏳ Initializing ${player.id} (${player.displayName})...`);
    console.log(`   Pillar price: $${pillars.usdPrice.toFixed(2)} | base=index=${indexLamports.toLocaleString()}L slope=${slope} supply=${TOTAL_SUPPLY.toLocaleString()}`);

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

    // Step 4: initialize_curve (writes base_price + creates stats_oracle PDA)
    console.log(`   Calling initialize_curve...`);
    const initIx = buildInitCurveInstruction(
      authority.publicKey,
      mintPubkey,
      bondingCurvePda,
      statsOraclePda,
      player.id,
      indexLamports, // base_price = pillar lamports
      slope,
      TOTAL_SUPPLY,
    );

    const initTx = new Transaction().add(initIx);
    const initSig = await sendAndConfirmTransaction(connection, initTx, [authority], {
      commitment: "confirmed",
    });
    console.log(`   ✓ initialize_curve — tx: ${initSig}`);

    // Step 5: update_oracle (writes index_price from THE SAME pillars)
    // This is the whole point: base_price === index_price byte-for-byte at T0.
    console.log(`   Calling update_oracle (first tick)...`);
    const deltas = pillarLamportDeltas(pillars);
    const oracleIx = buildUpdateOracleInstruction(
      authority.publicKey,
      statsOraclePda,
      indexLamports, // index_price = pillar lamports (== base_price)
      statsSourceDate,
      deltas.scoring,
      deltas.playmaking,
      deltas.defense,
      deltas.winning,
    );
    const oracleTx = new Transaction().add(oracleIx);
    const oracleSig = await sendAndConfirmTransaction(connection, oracleTx, [authority], {
      commitment: "confirmed",
    });
    console.log(`   ✓ update_oracle — tx: ${oracleSig}`);
    console.log(`   ✓ First oracle tick written (spread = 0 at T0)`);

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
