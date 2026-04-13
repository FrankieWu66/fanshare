/**
 * GET /api/cron/faucet
 *
 * Vercel cron job — runs once every 24 hours.
 * Requests 1 SOL from the Helius devnet faucet (via requestAirdrop RPC)
 * into the deploy wallet, which is used to fund new demo users.
 *
 * Helius paid plan allows 1 SOL per 24h per API key via requestAirdrop.
 * This keeps the deploy wallet topped up so demo registrations always
 * have SOL to distribute to new users.
 *
 * Env vars required:
 *   SOLANA_RPC_URL   — Helius devnet RPC (includes API key)
 *   ORACLE_SECRET_KEY — JSON array of deploy wallet secret key bytes
 *   CRON_SECRET      — Vercel injects as Authorization: Bearer <secret>
 */

import { NextResponse } from "next/server";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const MIN_BALANCE_SOL = 0.3; // only airdrop if below this threshold
const AIRDROP_SOL = 1;

export async function GET(request: Request) {
  // Verify Vercel cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json({ error: "SOLANA_RPC_URL not set" }, { status: 500 });
  }

  // Derive deploy wallet address from ORACLE_SECRET_KEY
  const secretKeyEnv = process.env.ORACLE_SECRET_KEY;
  if (!secretKeyEnv) {
    return NextResponse.json({ error: "ORACLE_SECRET_KEY not set" }, { status: 500 });
  }

  let walletAddress: string;
  try {
    const secretKeyBytes = JSON.parse(secretKeyEnv) as number[];
    const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKeyBytes));
    walletAddress = keypair.publicKey.toBase58();
  } catch {
    return NextResponse.json({ error: "Failed to parse ORACLE_SECRET_KEY" }, { status: 500 });
  }

  const connection = new Connection(rpcUrl, "confirmed");

  // Check current balance — skip if already topped up
  const currentLamports = await connection.getBalance(new PublicKey(walletAddress));
  const currentSol = currentLamports / LAMPORTS_PER_SOL;

  if (currentSol >= MIN_BALANCE_SOL) {
    console.log(`[faucet] deploy wallet ${walletAddress} has ${currentSol.toFixed(4)} SOL — no airdrop needed`);
    return NextResponse.json({
      skipped: true,
      reason: `balance ${currentSol.toFixed(4)} SOL >= threshold ${MIN_BALANCE_SOL} SOL`,
      wallet: walletAddress,
    });
  }

  // Request 1 SOL from Helius (their paid plan allows 1 SOL/24h per API key)
  console.log(`[faucet] deploy wallet at ${currentSol.toFixed(4)} SOL — requesting ${AIRDROP_SOL} SOL from Helius`);

  try {
    const sig = await connection.requestAirdrop(
      new PublicKey(walletAddress),
      AIRDROP_SOL * LAMPORTS_PER_SOL
    );

    console.log(`[faucet] airdrop tx: ${sig} → ${walletAddress}`);

    return NextResponse.json({
      success: true,
      wallet: walletAddress,
      airdropSol: AIRDROP_SOL,
      balanceBefore: currentSol,
      sig,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[faucet] airdrop failed:`, msg);
    return NextResponse.json({ success: false, error: msg, wallet: walletAddress }, { status: 500 });
  }
}
