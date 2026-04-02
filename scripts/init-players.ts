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

// ── Constants (LOCKED — match lib.rs and bonding-curve.ts) ─────────────────
const PROGRAM_ID = new PublicKey("B69juh6rX1Z6WNN2qCkrhuHDnk6v5vrK8oJ2o6oHTVYz");
const BASE_PRICE = 1000n;       // lamports  — LOCKED
const SLOPE = 10n;              // lamports per token — LOCKED
const TOTAL_SUPPLY = 1_000_000n; // tokens per player — LOCKED
const TOKEN_DECIMALS = 0;        // integer tokens (no fractional)

// initialize_curve discriminator from IDL — DO NOT CHANGE
const INIT_CURVE_DISCRIMINATOR = Buffer.from([170, 84, 186, 253, 131, 149, 95, 213]);

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// ── Player roster (mirrors fanshare-program.ts) ────────────────────────────
const DEVNET_PLAYERS = [
  { id: "Player_LBJ", displayName: "The King",       emoji: "👑", position: "SF", team: "LAL" },
  { id: "Player_SC",  displayName: "The Chef",        emoji: "🍛", position: "PG", team: "GSW" },
  { id: "Player_LD",  displayName: "The Maverick",    emoji: "⚡", position: "PG", team: "DAL" },
  { id: "Player_NJ",  displayName: "The Joker",       emoji: "🃏", position: "C",  team: "DEN" },
  { id: "Player_JT",  displayName: "The Jaybird",     emoji: "🦅", position: "SF", team: "BOS" },
  { id: "Player_SGA", displayName: "The Shai",        emoji: "🌩", position: "PG", team: "OKC" },
  { id: "Player_GA",  displayName: "The Greek Freak", emoji: "🦌", position: "PF", team: "MIL" },
  { id: "Player_JE",  displayName: "The Process",     emoji: "🔨", position: "C",  team: "PHI" },
  { id: "Player_KD",  displayName: "The Slim Reaper", emoji: "🪄", position: "SF", team: "PHX" },
  { id: "Player_JB",  displayName: "The Jet",         emoji: "✈️", position: "SG", team: "BOS" },
  { id: "Player_DB",  displayName: "The Book",        emoji: "📖", position: "SG", team: "PHX" },
  { id: "Player_AD",  displayName: "The Brow",        emoji: "🦾", position: "PF", team: "LAL" },
  { id: "Player_VW",  displayName: "The Alien",       emoji: "👽", position: "C",  team: "SAS" },
  { id: "Player_CC",  displayName: "The Cade",        emoji: "🎯", position: "PG", team: "DET" },
  { id: "Player_TH",  displayName: "The Hali",        emoji: "💧", position: "PG", team: "IND" },
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
  playerId: string
): TransactionInstruction {
  const data = Buffer.concat([
    INIT_CURVE_DISCRIMINATOR,
    encodeAnchorString(playerId),
    encodeU64LE(BASE_PRICE),
    encodeU64LE(SLOPE),
    encodeU64LE(TOTAL_SUPPLY),
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
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
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
  if (balance < 0.5e9) {
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

    console.log(`\n⏳ Initializing ${player.id} (${player.displayName})...`);

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
      player.id
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
