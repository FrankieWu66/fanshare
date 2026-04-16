/**
 * Reclaim SOL from demo wallets.
 * Sells all player tokens back to bonding curves, then transfers remaining SOL
 * to the deploy wallet.
 *
 * Usage:
 *   DEMO_SECRET_KEY='[200,144,...]' npx tsx scripts/reclaim-demo-sol.ts
 *
 * Uses the CURRENTLY DEPLOYED program (old sell — 6 accounts, no fees).
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
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

const PROGRAM_ID = new PublicKey("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");
const DEPLOY_WALLET = new PublicKey("CsGh5T7EzTUW3hmdpjMrJyzBVq1RPnDXMr9VYuHyXa83");
const SELL_DISC = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

// Player mints from player-mints.json
const PLAYER_MINTS: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../app/lib/player-mints.json"),
    "utf-8"
  )
);

function encodeU64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

function getBondingCurvePda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PROGRAM_ID
  );
}

function buildSellInstruction(
  seller: PublicKey,
  mint: PublicKey,
  bondingCurve: PublicKey,
  sellerTokenAccount: PublicKey,
  tokenAmount: bigint,
  minSolOut: bigint,
): TransactionInstruction {
  const data = Buffer.concat([
    SELL_DISC,
    encodeU64LE(tokenAmount),
    encodeU64LE(minSolOut),
  ]);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller,             isSigner: true,  isWritable: true  },
      { pubkey: mint,               isSigner: false, isWritable: true  },
      { pubkey: bondingCurve,       isSigner: false, isWritable: true  },
      { pubkey: sellerTokenAccount, isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,   isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");

  // Load demo wallet keypair from env
  const secretKeyJson = process.env.DEMO_SECRET_KEY;
  if (!secretKeyJson) {
    console.error("Set DEMO_SECRET_KEY env var to the JSON array of the demo wallet secret key");
    process.exit(1);
  }
  const demoWallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyJson)));
  console.log(`Demo wallet: ${demoWallet.publicKey.toBase58()}`);

  const balance = await conn.getBalance(demoWallet.publicKey);
  console.log(`SOL balance: ${balance / LAMPORTS_PER_SOL}`);

  // Check each player mint for token holdings
  let soldAny = false;
  for (const [playerId, mintStr] of Object.entries(PLAYER_MINTS)) {
    const mint = new PublicKey(mintStr);
    const ata = await getAssociatedTokenAddress(mint, demoWallet.publicKey);

    let tokenBalance: bigint;
    try {
      const resp = await conn.getTokenAccountBalance(ata);
      tokenBalance = BigInt(resp.value.amount);
    } catch {
      continue; // No ATA = no tokens
    }

    if (tokenBalance === 0n) continue;

    console.log(`\n${playerId}: ${tokenBalance} tokens — selling...`);

    const [bondingCurve] = getBondingCurvePda(mint);
    const ix = buildSellInstruction(
      demoWallet.publicKey,
      mint,
      bondingCurve,
      ata,
      tokenBalance,
      0n, // min_sol_out = 0 (no slippage protection needed, just dump everything)
    );

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [demoWallet]);
    console.log(`  ✓ Sold — tx: ${sig}`);
    soldAny = true;
  }

  if (!soldAny) {
    console.log("\nNo tokens to sell.");
  }

  // Transfer remaining SOL to deploy wallet (leave 5000 lamports for rent)
  const finalBalance = await conn.getBalance(demoWallet.publicKey);
  const transferAmount = finalBalance - 5000;
  if (transferAmount > 0) {
    console.log(`\nTransferring ${transferAmount / LAMPORTS_PER_SOL} SOL to deploy wallet...`);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: demoWallet.publicKey,
        toPubkey: DEPLOY_WALLET,
        lamports: transferAmount,
      })
    );
    const sig = await sendAndConfirmTransaction(conn, tx, [demoWallet]);
    console.log(`  ✓ Transferred — tx: ${sig}`);
  }

  const deployBalance = await conn.getBalance(DEPLOY_WALLET);
  console.log(`\nDeploy wallet balance: ${deployBalance / LAMPORTS_PER_SOL} SOL`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
