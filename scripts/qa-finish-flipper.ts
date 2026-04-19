/**
 * One-shot: finish the multi-user QA by selling Flipper's full balance
 * on Player_LBJ. Needed because the main script's "sell half" rounded to 0
 * when flipper only bought 1 token.
 *
 * Re-registers flipper by displayName (returning-user flow) to retrieve
 * the stored secret, then sells all tokens to produce a real sell row
 * with non-zero spread for Step 7 telemetry validation.
 */

import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.local") });

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import PLAYER_MINTS from "../app/lib/player-mints.json" with { type: "json" };

const PROGRAM_ID = new PublicKey("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");
const PROTOCOL_WALLET = new PublicKey("CsGh5T7EzTUW3hmdpjMrJyzBVq1RPnDXMr9VYuHyXa83");
const SELL_DISC = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:55554";
const FLIPPER_NAME = process.argv[2]; // pass displayName from prior run

if (!FLIPPER_NAME) {
  console.error("Usage: bun run scripts/qa-finish-flipper.ts <flipper-displayName>");
  process.exit(1);
}

function pda(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

function u64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

async function main() {
  // Retrieve flipper keypair via returning-user flow
  const res = await fetch(`${BASE_URL}/api/demo/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: FLIPPER_NAME }),
  });
  const body = await res.json();
  if (!body.returning) {
    console.error("Expected returning=true but got:", body);
    process.exit(1);
  }
  const keypair = Keypair.fromSecretKey(Uint8Array.from(body.secretKey as number[]));
  console.log(`Flipper: ${keypair.publicKey.toBase58()}`);

  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const mints = PLAYER_MINTS as Record<string, string>;
  const mint = new PublicKey(mints.Player_LBJ);
  const ata = await getAssociatedTokenAddress(mint, keypair.publicKey);
  const bal = await connection.getTokenAccountBalance(ata);
  console.log(`Balance: ${bal.value.amount} tokens`);
  if (bal.value.amount === "0") {
    console.log("Nothing to sell.");
    return;
  }

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
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
    ],
    data: Buffer.concat([SELL_DISC, u64LE(BigInt(bal.value.amount)), u64LE(0n)]),
  });
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [keypair], { commitment: "confirmed" });
  console.log(`✓ sold ${bal.value.amount} tokens — sig ${sig}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
