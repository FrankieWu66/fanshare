/**
 * FanShare — Initialize tokenomics accounts on devnet.
 *
 * Creates:
 *   1. GlobalExitTreasury PDA (singleton) — with protocol wallet set
 *   2. OracleConfigAccount PDA (singleton) — with current stat weights
 *   3. MarketStatus PDA per player — controls market open/freeze state
 *   4. Leaderboard PDAs (Top Traders + Sharp Calls) — global rankings
 *
 * All are one-time setup. Safe to re-run (skips if accounts already exist).
 *
 * Run:  npm run init-tokenomics
 * Req:  Devnet SOL in ~/.config/solana/id.json
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.local") });
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from "@solana/web3.js";

// ── Constants ──────────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("B69juh6rX1Z6WNN2qCkrhuHDnk6v5vrK8oJ2o6oHTVYz");

// Anchor discriminator helper: first 8 bytes of sha256("global:<method_name>")
function anchorDiscriminator(methodName: string): Buffer {
  const hash = crypto.createHash("sha256").update(`global:${methodName}`).digest();
  return hash.subarray(0, 8);
}

// Discriminators from new IDL
const INIT_EXIT_TREASURY_DISC = Buffer.from([219, 236, 175, 88, 105, 74, 102, 55]);
const INIT_ORACLE_CONFIG_DISC = Buffer.from([131, 55, 232, 105, 168, 248, 10, 102]);
const INIT_MARKET_STATUS_DISC = anchorDiscriminator("initialize_market_status");
const INIT_LEADERBOARD_DISC = anchorDiscriminator("initialize_leaderboard");

// Stat weights (must match oracle-weights.ts)
const STAT_WEIGHTS = {
  ppg: 1000n,
  rpg: 500n,
  apg: 700n,
  spg: 800n,
  bpg: 800n,
  fg_pct: 0n, // not used yet
};

// ── Helpers ────────────────────────────────────────────────────────────────
function encodeU64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

function encodeI64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(n);
  return buf;
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

function buildInitExitTreasuryInstruction(
  authority: PublicKey,
  exitTreasuryPda: PublicKey,
  protocolWallet: PublicKey,
): TransactionInstruction {
  // Args: protocol_wallet (Pubkey = 32 bytes)
  const data = Buffer.concat([
    INIT_EXIT_TREASURY_DISC,
    protocolWallet.toBuffer(),
  ]);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority,       isSigner: true,  isWritable: true  },
      { pubkey: exitTreasuryPda, isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildInitOracleConfigInstruction(
  authority: PublicKey,
  oracleConfigPda: PublicKey,
): TransactionInstruction {
  // Args: 6 x u64 weights
  const data = Buffer.concat([
    INIT_ORACLE_CONFIG_DISC,
    encodeU64LE(STAT_WEIGHTS.ppg),
    encodeU64LE(STAT_WEIGHTS.rpg),
    encodeU64LE(STAT_WEIGHTS.apg),
    encodeU64LE(STAT_WEIGHTS.spg),
    encodeU64LE(STAT_WEIGHTS.bpg),
    encodeU64LE(STAT_WEIGHTS.fg_pct),
  ]);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority,       isSigner: true,  isWritable: true  },
      { pubkey: oracleConfigPda, isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function getMarketStatusPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market-status"), mint.toBuffer()],
    PROGRAM_ID
  );
}

function getLeaderboardPda(leaderboardType: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("leaderboard"), Buffer.from([leaderboardType])],
    PROGRAM_ID
  );
}

function buildInitMarketStatusInstruction(
  authority: PublicKey,
  mint: PublicKey,
  marketStatusPda: PublicKey,
  openTime: bigint,
): TransactionInstruction {
  // Args: open_time as i64
  const data = Buffer.concat([
    INIT_MARKET_STATUS_DISC,
    encodeI64LE(openTime),
  ]);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority,       isSigner: true,  isWritable: true  },
      { pubkey: mint,            isSigner: false, isWritable: false },
      { pubkey: marketStatusPda, isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildInitLeaderboardInstruction(
  authority: PublicKey,
  leaderboardPda: PublicKey,
  leaderboardType: number,
): TransactionInstruction {
  // Args: leaderboard_type as u8
  const data = Buffer.concat([
    INIT_LEADERBOARD_DISC,
    Buffer.from([leaderboardType]),
  ]);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority,      isSigner: true,  isWritable: true  },
      { pubkey: leaderboardPda, isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");

  // Load authority keypair
  const keypairPath = process.env.ORACLE_KEYPAIR_PATH ?? path.join(
    process.env.HOME ?? "~",
    ".config/solana/id.json"
  );
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log(`Authority: ${authority.publicKey.toBase58()}`);

  const balance = await conn.getBalance(authority.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);

  // Protocol wallet = authority (devnet). On mainnet, change to a separate wallet.
  const protocolWallet = authority.publicKey;
  console.log(`Protocol wallet: ${protocolWallet.toBase58()}`);

  // 1. Initialize GlobalExitTreasury
  const [treasuryPda] = getExitTreasuryPda();
  console.log(`\nExit Treasury PDA: ${treasuryPda.toBase58()}`);

  const treasuryInfo = await conn.getAccountInfo(treasuryPda);
  if (treasuryInfo) {
    console.log("  ✓ Already initialized — skipping");
  } else {
    console.log("  Initializing exit treasury...");
    const ix = buildInitExitTreasuryInstruction(authority.publicKey, treasuryPda, protocolWallet);
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [authority]);
    console.log(`  ✓ Initialized — tx: ${sig}`);
  }

  // 2. Initialize OracleConfigAccount
  const [configPda] = getOracleConfigPda();
  console.log(`\nOracle Config PDA: ${configPda.toBase58()}`);

  const configInfo = await conn.getAccountInfo(configPda);
  if (configInfo) {
    console.log("  ✓ Already initialized — skipping");
  } else {
    console.log("  Initializing oracle config...");
    console.log(`  Weights: PPG=${STAT_WEIGHTS.ppg}, RPG=${STAT_WEIGHTS.rpg}, APG=${STAT_WEIGHTS.apg}, SPG=${STAT_WEIGHTS.spg}, BPG=${STAT_WEIGHTS.bpg}, FG%=${STAT_WEIGHTS.fg_pct}`);
    const ix = buildInitOracleConfigInstruction(authority.publicKey, configPda);
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [authority]);
    console.log(`  ✓ Initialized — tx: ${sig}`);
  }

  // 3. Initialize MarketStatus for each player
  const __scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const mintsPath = path.join(__scriptDir, "../app/lib/player-mints.json");
  if (!fs.existsSync(mintsPath)) {
    console.warn("\n⚠ player-mints.json not found — skipping MarketStatus init.");
    console.warn("  Run 'npm run init-players' first.\n");
  } else {
    const mints: Record<string, string> = JSON.parse(fs.readFileSync(mintsPath, "utf-8"));
    console.log(`\n── MarketStatus PDAs (${Object.keys(mints).length} players) ──`);

    for (const [playerId, mintAddress] of Object.entries(mints)) {
      const mint = new PublicKey(mintAddress);
      const [marketStatusPda] = getMarketStatusPda(mint);
      console.log(`\n${playerId} — MarketStatus PDA: ${marketStatusPda.toBase58()}`);

      const existingInfo = await conn.getAccountInfo(marketStatusPda);
      if (existingInfo) {
        console.log("  ✓ Already initialized — skipping");
        continue;
      }

      console.log("  Initializing market status (open_time = 0, open immediately)...");
      const ix = buildInitMarketStatusInstruction(
        authority.publicKey,
        mint,
        marketStatusPda,
        0n, // open_time = 0 → no early access gate
      );
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(conn, tx, [authority]);
      console.log(`  ✓ Initialized — tx: ${sig}`);

      // Rate limit kindness
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // 4. Initialize Leaderboard anchors (Top Traders = 0, Sharp Calls = 1)
  const LEADERBOARD_TYPES: Array<{ type: number; label: string }> = [
    { type: 0, label: "Top Traders" },
    { type: 1, label: "Sharp Calls" },
  ];

  console.log("\n── Leaderboard PDAs ──");

  for (const lb of LEADERBOARD_TYPES) {
    const [leaderboardPda] = getLeaderboardPda(lb.type);
    console.log(`\n${lb.label} (type=${lb.type}) — PDA: ${leaderboardPda.toBase58()}`);

    const lbInfo = await conn.getAccountInfo(leaderboardPda);
    if (lbInfo) {
      console.log("  ✓ Already initialized — skipping");
      continue;
    }

    console.log(`  Initializing ${lb.label} leaderboard...`);
    const ix = buildInitLeaderboardInstruction(
      authority.publicKey,
      leaderboardPda,
      lb.type,
    );
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [authority]);
    console.log(`  ✓ Initialized — tx: ${sig}`);
  }

  console.log("\nDone! Tokenomics accounts initialized (Phase 1-4).");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
