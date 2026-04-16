/**
 * Freeze a player market on devnet for QA testing.
 *
 * Usage:
 *   npx tsx scripts/freeze-market.ts Player_DM
 *
 * Requires .env.local with SOLANA_RPC_URL (or defaults to devnet).
 * Uses ~/.config/solana/id.json as the authority keypair.
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
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");

function anchorDiscriminator(methodName: string): Buffer {
  const hash = crypto.createHash("sha256").update(`global:${methodName}`).digest();
  return hash.subarray(0, 8);
}

const FREEZE_MARKET_DISC = anchorDiscriminator("freeze_market");

function getMarketStatusPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market-status"), mint.toBuffer()],
    PROGRAM_ID
  );
}

async function main() {
  const playerId = process.argv[2];
  if (!playerId) {
    console.error("Usage: npx tsx scripts/freeze-market.ts <Player_XX>");
    console.error("Example: npx tsx scripts/freeze-market.ts Player_DM");
    process.exit(1);
  }

  const __scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const mintsPath = path.join(__scriptDir, "../app/lib/player-mints.json");
  const mints: Record<string, string> = JSON.parse(fs.readFileSync(mintsPath, "utf-8"));

  const mintStr = mints[playerId];
  if (!mintStr) {
    console.error(`Player ${playerId} not found in player-mints.json`);
    console.error(`Available: ${Object.keys(mints).join(", ")}`);
    process.exit(1);
  }

  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");

  const keypairPath = process.env.ORACLE_KEYPAIR_PATH ?? path.join(
    process.env.HOME ?? "~",
    ".config/solana/id.json"
  );
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  const mint = new PublicKey(mintStr);
  const [marketStatusPda] = getMarketStatusPda(mint);

  console.log(`Freezing market for ${playerId}`);
  console.log(`  Mint: ${mintStr}`);
  console.log(`  MarketStatus PDA: ${marketStatusPda.toBase58()}`);
  console.log(`  Authority: ${authority.publicKey.toBase58()}`);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: marketStatusPda, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(FREEZE_MARKET_DISC),
  });

  try {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [authority]);
    console.log(`\n  Frozen! tx: ${sig}`);
    console.log(`\n  Market is now in sell-only mode for 30 days.`);
    console.log(`  Visit https://fanshare-1.vercel.app/trade/${playerId} to see the frozen banner.`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("already")) {
      console.log(`\n  Market already frozen.`);
    } else {
      console.error(`\n  Failed:`, err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
