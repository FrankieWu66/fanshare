/**
 * POST /api/demo/register
 *
 * Creates a demo devnet wallet for non-crypto users.
 * Generates a fresh keypair, transfers SOL from the deploy wallet,
 * and returns the secret key so the browser can sign transactions
 * directly without Phantom.
 *
 * SOL funding strategy:
 *   - Transfer 0.05 SOL from the deploy wallet (ORACLE_SECRET_KEY) to the new wallet.
 *   - This is reliable and instant — no airdrop rate limits.
 *   - The deploy wallet is topped up daily by /api/cron/faucet (1 SOL/day via Helius).
 *   - 1 SOL supports ~20 new demo users per day. More than enough for a demo app.
 *
 * Request body: { displayName: string }
 * Response:     { address, secretKey, displayName, fundingTx?, fundingFailed? }
 *
 * The secretKey is 64 bytes (seed[0:32] + pubkey[32:64]) — compatible with
 * @solana/kit's createKeyPairSignerFromBytes on the client side.
 */

import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const FUND_SOL = 0.05; // SOL to send to each new demo wallet

export async function POST(req: Request) {
  let displayName: string | undefined;
  try {
    const body = await req.json();
    displayName = typeof body?.displayName === "string" ? body.displayName.trim() : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!displayName || displayName.length < 1) {
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }
  if (displayName.length > 32) {
    return NextResponse.json({ error: "displayName too long (max 32 chars)" }, { status: 400 });
  }

  const rpcUrl =
    process.env.SOLANA_RPC_URL ||
    (process.env.NEXT_PUBLIC_HELIUS_API_KEY
      ? `https://devnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
      : "https://api.devnet.solana.com");

  // Generate a fresh devnet keypair for this demo user
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  const secretKey = Array.from(keypair.secretKey); // 64 bytes

  // Fund the new wallet from the deploy wallet
  // This is a server-to-user transfer — no airdrop rate limits apply.
  let fundingTx: string | null = null;
  let fundingFailed = false;

  const secretKeyEnv = process.env.ORACLE_SECRET_KEY;
  if (secretKeyEnv) {
    try {
      const deployKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(secretKeyEnv) as number[])
      );
      const connection = new Connection(rpcUrl, "confirmed");

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: deployKeypair.publicKey,
          toPubkey: new PublicKey(address),
          lamports: FUND_SOL * LAMPORTS_PER_SOL,
        })
      );

      // Race with 8s timeout — Helius devnet is fast, but give it room
      const transferPromise = sendAndConfirmTransaction(connection, tx, [deployKeypair]);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("transfer timeout")), 8000)
      );

      fundingTx = await Promise.race([transferPromise, timeout]);
      console.log(`[demo/register] funded ${address} with ${FUND_SOL} SOL — tx: ${fundingTx}`);
    } catch (err) {
      console.error("[demo/register] funding failed:", err instanceof Error ? err.message : err);
      fundingFailed = true;
    }
  } else {
    console.warn("[demo/register] ORACLE_SECRET_KEY not set — skipping funding");
    fundingFailed = true;
  }

  return NextResponse.json({
    address,
    secretKey,
    displayName,
    airdropSig: fundingTx,   // keep field name for client compatibility
    airdropFailed: fundingFailed,
  });
}
