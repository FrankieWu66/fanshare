/**
 * Triggers a buy + sell on Player_LBJ from the authority wallet to validate
 * the newly-fixed Helius webhook pipeline.
 *
 * The 7 trades from the multi-user-qa run won't appear in telemetry because
 * they happened before the webhook was repointed at the real program ID.
 * This run produces one buy and one sell for Step 7 spread validation.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.local") });

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import PLAYER_MINTS from "../app/lib/player-mints.json" with { type: "json" };

const PROGRAM_ID = new PublicKey("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");
const PROTOCOL_WALLET = new PublicKey("CsGh5T7EzTUW3hmdpjMrJyzBVq1RPnDXMr9VYuHyXa83");
const BUY_DISC = Buffer.from([49, 57, 124, 194, 240, 20, 216, 102]);
const SELL_DISC = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

function pda(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}
function u64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

function tradeKeys(mint: PublicKey, actor: PublicKey, ata: PublicKey) {
  return [
    { pubkey: actor, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: pda([Buffer.from("bonding-curve"), mint.toBuffer()]), isSigner: false, isWritable: true },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: pda([Buffer.from("exit-treasury")]), isSigner: false, isWritable: true },
    { pubkey: PROTOCOL_WALLET, isSigner: false, isWritable: true },
    { pubkey: pda([Buffer.from("stats-oracle"), mint.toBuffer()]), isSigner: false, isWritable: false },
    { pubkey: pda([Buffer.from("market-status"), mint.toBuffer()]), isSigner: false, isWritable: false },
    { pubkey: pda([Buffer.from("leaderboard"), Buffer.from([1])]), isSigner: false, isWritable: false },
  ];
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL!;
  const connection = new Connection(rpcUrl, "confirmed");
  const walletPath = path.join(process.env.HOME!, ".config/solana/id.json");
  const auth = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8"))));

  const mint = new PublicKey((PLAYER_MINTS as Record<string, string>).Player_LBJ);
  const ata = await getAssociatedTokenAddress(mint, auth.publicKey);

  console.log("── BUY Player_LBJ (0.05 SOL) ──");
  const buyTx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(auth.publicKey, ata, auth.publicKey, mint),
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: tradeKeys(mint, auth.publicKey, ata),
      data: Buffer.concat([BUY_DISC, u64LE(BigInt(0.05 * LAMPORTS_PER_SOL)), u64LE(0n)]),
    }),
  );
  const buySig = await sendAndConfirmTransaction(connection, buyTx, [auth], { commitment: "confirmed" });
  const bal = await connection.getTokenAccountBalance(ata);
  console.log(`  ✓ bought ${bal.value.amount} tokens (sig ${buySig.slice(0, 16)}…)`);

  // Brief pause so Helius doesn't compress events together
  await new Promise((r) => setTimeout(r, 3000));

  console.log("\n── SELL Player_LBJ (all tokens) ──");
  const sellTx = new Transaction().add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: tradeKeys(mint, auth.publicKey, ata),
      data: Buffer.concat([SELL_DISC, u64LE(BigInt(bal.value.amount)), u64LE(0n)]),
    }),
  );
  const sellSig = await sendAndConfirmTransaction(connection, sellTx, [auth], { commitment: "confirmed" });
  console.log(`  ✓ sold ${bal.value.amount} tokens (sig ${sellSig.slice(0, 16)}…)`);

  console.log("\n✅ Trades submitted. Wait ~60s then run:");
  console.log(`   bun run scripts/export-telemetry.ts --since ${new Date(Date.now() - 120_000).toISOString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
