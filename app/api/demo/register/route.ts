/**
 * POST /api/demo/register
 *
 * Creates a demo devnet wallet for non-crypto users.
 * Generates a fresh keypair, airdrops 2 SOL, and returns the secret key
 * so the browser can sign transactions directly without Phantom.
 *
 * Request body: { displayName: string }
 * Response:     { address: string, secretKey: number[], displayName: string }
 *
 * The secretKey is 64 bytes (seed[0:32] + pubkey[32:64]) — compatible with
 * @solana/kit's createKeyPairSignerFromBytes on the client side.
 */

import { NextResponse } from "next/server";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";

const AIRDROP_SOL = 2;

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

  // Generate a fresh devnet keypair
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  const secretKey = Array.from(keypair.secretKey); // 64 bytes

  // Airdrop via our Helius RPC (more reliable than public faucet)
  const rpcUrl =
    process.env.SOLANA_RPC_URL ||
    (process.env.NEXT_PUBLIC_HELIUS_API_KEY
      ? `https://devnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
      : "https://api.devnet.solana.com");

  // Fire-and-forget airdrop — don't block the response on confirmation.
  // Vercel serverless + devnet confirmation can take >10s and timeout.
  // The client will detect 0 balance and auto-request again if needed.
  let airdropSig: string | null = null;
  try {
    const connection = new Connection(rpcUrl, "confirmed");
    // requestAirdrop sends the tx to the network immediately.
    // We intentionally skip confirmTransaction to avoid Vercel timeouts.
    airdropSig = await connection.requestAirdrop(
      keypair.publicKey,
      AIRDROP_SOL * LAMPORTS_PER_SOL
    );
    console.log("[demo/register] airdrop sent:", airdropSig, "→", address);
  } catch (err) {
    console.error("[demo/register] airdrop failed:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({
    address,
    secretKey,
    displayName,
    airdropSig,
    airdropFailed: airdropSig === null,
  });
}
