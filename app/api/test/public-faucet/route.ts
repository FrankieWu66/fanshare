/**
 * GET /api/test/public-faucet
 *
 * TEMPORARY — created 2026-04-21 to verify whether Vercel server IPs can
 * successfully hit Solana's PUBLIC devnet RPC requestAirdrop.
 * Delete this entire folder after the test.
 *
 * Why: existing /api/cron/faucet uses Helius RPC (paid, dedicated faucet pool).
 * If public faucet works from Vercel IPs, we'd have a free fallback path.
 * If it 429s or rate-limits, Helius stays the only option for the cron.
 *
 * No auth — one-shot test endpoint. Hit once, capture result, delete.
 */

import { NextResponse } from "next/server";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const PUBLIC_RPC = "https://api.devnet.solana.com";
const DEPLOY_WALLET = "CsGh5T7EzTUW3hmdpjMrJyzBVq1RPnDXMr9VYuHyXa83";
const AMOUNT_SOL = 1;

export async function GET() {
  const startTime = Date.now();
  const connection = new Connection(PUBLIC_RPC, "confirmed");
  const wallet = new PublicKey(DEPLOY_WALLET);

  let balanceBefore: number;
  try {
    balanceBefore = (await connection.getBalance(wallet)) / LAMPORTS_PER_SOL;
  } catch (err) {
    return NextResponse.json(
      {
        stage: "balance-check",
        success: false,
        error: err instanceof Error ? err.message : String(err),
        rpc: PUBLIC_RPC,
        durationMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }

  try {
    const sig = await connection.requestAirdrop(wallet, AMOUNT_SOL * LAMPORTS_PER_SOL);
    return NextResponse.json({
      stage: "airdrop",
      success: true,
      sig,
      wallet: DEPLOY_WALLET,
      amountSol: AMOUNT_SOL,
      balanceBeforeSol: balanceBefore,
      rpc: PUBLIC_RPC,
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    return NextResponse.json(
      {
        stage: "airdrop",
        success: false,
        error: err instanceof Error ? err.message : String(err),
        wallet: DEPLOY_WALLET,
        amountSol: AMOUNT_SOL,
        balanceBeforeSol: balanceBefore,
        rpc: PUBLIC_RPC,
        durationMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
