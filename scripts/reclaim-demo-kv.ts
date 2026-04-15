/**
 * Reclaim SOL from custodial demo wallets stored in Vercel KV.
 *
 * Reads all demo wallet keypairs from KV, sells any player tokens back
 * to bonding curves, then transfers remaining SOL to the deploy wallet.
 *
 * Usage:
 *   npx tsx scripts/reclaim-demo-kv.ts
 *
 * Requires .env.local with:
 *   KV_REST_API_URL, KV_REST_API_TOKEN, SOLANA_RPC_URL
 *
 * Uses the CURRENTLY DEPLOYED program (new sell — 11 accounts, with fees).
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

const PROGRAM_ID = new PublicKey("B69juh6rX1Z6WNN2qCkrhuHDnk6v5vrK8oJ2o6oHTVYz");
const DEPLOY_WALLET = new PublicKey("CsGh5T7EzTUW3hmdpjMrJyzBVq1RPnDXMr9VYuHyXa83");
const SELL_DISC = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

// Player mints
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

function getExitTreasuryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("exit-treasury")],
    PROGRAM_ID
  );
}

function getStatsOraclePda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stats-oracle"), mint.toBuffer()],
    PROGRAM_ID
  );
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

function buildSellInstruction(
  seller: PublicKey,
  mint: PublicKey,
  bondingCurve: PublicKey,
  sellerTokenAccount: PublicKey,
  exitTreasury: PublicKey,
  protocolWallet: PublicKey,
  statsOracle: PublicKey,
  marketStatus: PublicKey,
  sharpLeaderboard: PublicKey,
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
      { pubkey: exitTreasury,       isSigner: false, isWritable: true  },
      { pubkey: protocolWallet,     isSigner: false, isWritable: true  },
      { pubkey: statsOracle,        isSigner: false, isWritable: false },
      { pubkey: marketStatus,       isSigner: false, isWritable: false },
      { pubkey: sharpLeaderboard,   isSigner: false, isWritable: false },
    ],
    data,
  });
}

interface StoredWallet {
  address: string;
  secretKey: number[];
  displayName: string;
  createdAt: string;
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");

  // Read demo wallets from KV
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    console.error("KV_REST_API_URL and KV_REST_API_TOKEN required");
    process.exit(1);
  }

  console.log("Fetching demo wallets from KV...");

  // Get all demo wallet addresses from the set
  const setRes = await fetch(`${kvUrl}/smembers/demo:wallets`, {
    headers: { Authorization: `Bearer ${kvToken}` },
  });
  const setJson = await setRes.json();
  const addresses: string[] = setJson.result ?? [];

  console.log(`Found ${addresses.length} demo wallets in KV`);

  const [exitTreasury] = getExitTreasuryPda();
  const [sharpLeaderboard] = getLeaderboardPda(1);

  let totalReclaimed = 0;

  for (const addr of addresses) {
    // Fetch wallet data from KV
    const walletRes = await fetch(`${kvUrl}/get/demo:wallet:${addr}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    const walletJson = await walletRes.json();
    const stored: StoredWallet | null = walletJson.result
      ? (typeof walletJson.result === "string" ? JSON.parse(walletJson.result) : walletJson.result)
      : null;

    if (!stored) {
      console.log(`  ${addr}: no wallet data in KV, skipping`);
      continue;
    }

    const wallet = Keypair.fromSecretKey(Uint8Array.from(stored.secretKey));
    console.log(`\n${stored.displayName} (${addr}):`);

    const balance = await conn.getBalance(wallet.publicKey);
    console.log(`  SOL: ${balance / LAMPORTS_PER_SOL}`);

    // Sell all tokens
    for (const [playerId, mintStr] of Object.entries(PLAYER_MINTS)) {
      const mint = new PublicKey(mintStr);
      const ata = await getAssociatedTokenAddress(mint, wallet.publicKey);

      let tokenBalance: bigint;
      try {
        const resp = await conn.getTokenAccountBalance(ata);
        tokenBalance = BigInt(resp.value.amount);
      } catch {
        continue; // No ATA
      }

      if (tokenBalance === 0n) continue;

      console.log(`  ${playerId}: ${tokenBalance} tokens — selling...`);

      const [bondingCurve] = getBondingCurvePda(mint);
      const [statsOracle] = getStatsOraclePda(mint);
      const [marketStatus] = getMarketStatusPda(mint);

      const ix = buildSellInstruction(
        wallet.publicKey,
        mint,
        bondingCurve,
        ata,
        exitTreasury,
        DEPLOY_WALLET,
        statsOracle,
        marketStatus,
        sharpLeaderboard,
        tokenBalance,
        0n, // min_sol_out = 0
      );

      try {
        const tx = new Transaction().add(ix);
        const sig = await sendAndConfirmTransaction(conn, tx, [wallet]);
        console.log(`    ✓ Sold — tx: ${sig}`);
      } catch (err) {
        console.error(`    ✗ Sell failed:`, err instanceof Error ? err.message : err);
      }
    }

    // Transfer remaining SOL to deploy wallet
    const finalBalance = await conn.getBalance(wallet.publicKey);
    const transferAmount = finalBalance - 5000; // leave 5000 lamports for rent
    if (transferAmount > 0) {
      console.log(`  Transferring ${transferAmount / LAMPORTS_PER_SOL} SOL to deploy wallet...`);
      try {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: DEPLOY_WALLET,
            lamports: transferAmount,
          })
        );
        const sig = await sendAndConfirmTransaction(conn, tx, [wallet]);
        console.log(`    ✓ Transferred — tx: ${sig}`);
        totalReclaimed += transferAmount;
      } catch (err) {
        console.error(`    ✗ Transfer failed:`, err instanceof Error ? err.message : err);
      }
    }

    await new Promise((r) => setTimeout(r, 200)); // rate limit
  }

  console.log(`\nTotal reclaimed: ${totalReclaimed / LAMPORTS_PER_SOL} SOL`);

  const deployBalance = await conn.getBalance(DEPLOY_WALLET);
  console.log(`Deploy wallet balance: ${deployBalance / LAMPORTS_PER_SOL} SOL`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
