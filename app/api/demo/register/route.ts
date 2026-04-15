/**
 * POST /api/demo/register
 *
 * Creates a demo devnet wallet for non-crypto users.
 * - If a user with the same displayName already exists in KV, returns their
 *   existing wallet (returning user flow).
 * - Otherwise generates a fresh keypair, transfers SOL from deploy wallet,
 *   and stores the keypair in Vercel KV for custodial management.
 *
 * SOL funding strategy:
 *   - Transfer 0.05 SOL from the deploy wallet (ORACLE_SECRET_KEY) to the new wallet.
 *   - This is reliable and instant, no airdrop rate limits.
 *   - The deploy wallet is topped up daily by /api/cron/faucet (1 SOL/day via Helius).
 *   - 1 SOL supports ~20 new demo users per day.
 *
 * KV keys:
 *   demo:name:{displayName}  -> address (name lookup)
 *   demo:wallet:{address}    -> { address, secretKey, displayName, createdAt }
 *   demo:wallets              -> SET of all demo wallet addresses (for reclaim script)
 *
 * Request body: { displayName: string }
 * Response:     { address, secretKey, displayName, returning?, fundingTx?, fundingFailed? }
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

// Lazy KV import — graceful when KV is not configured (local dev)
async function getKV() {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
    const { kv } = await import("@vercel/kv");
    return kv;
  } catch {
    return null;
  }
}

interface StoredWallet {
  address: string;
  secretKey: number[];
  displayName: string;
  createdAt: string;
}

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

  const kvClient = await getKV();

  // ── Returning user flow ─────────────────────────────────────────
  // Check if this displayName already has a wallet in KV
  if (kvClient) {
    try {
      const nameKey = `demo:name:${displayName.toLowerCase()}`;
      const existingAddress: string | null = await kvClient.get(nameKey);

      if (existingAddress) {
        const walletKey = `demo:wallet:${existingAddress}`;
        const stored: StoredWallet | null = await kvClient.get(walletKey);

        if (stored) {
          console.log(`[demo/register] returning user: ${displayName} -> ${existingAddress}`);
          return NextResponse.json({
            address: stored.address,
            secretKey: stored.secretKey,
            displayName: stored.displayName,
            returning: true,
            airdropFailed: false,
          });
        }
      }
    } catch (err) {
      console.warn("[demo/register] KV lookup failed, creating new wallet:", err);
    }
  }

  // ── New user flow ───────────────────────────────────────────────
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  const secretKey = Array.from(keypair.secretKey); // 64 bytes

  // Fund the new wallet from the deploy wallet
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

  // ── Store in KV for custodial management ────────────────────────
  if (kvClient) {
    try {
      const walletData: StoredWallet = {
        address,
        secretKey,
        displayName,
        createdAt: new Date().toISOString(),
      };
      const nameKey = `demo:name:${displayName.toLowerCase()}`;
      const walletKey = `demo:wallet:${address}`;

      await Promise.all([
        kvClient.set(nameKey, address),
        kvClient.set(walletKey, walletData),
        kvClient.sadd("demo:wallets", address),
      ]);
      console.log(`[demo/register] stored wallet in KV: ${address} (${displayName})`);
    } catch (err) {
      // Non-fatal — wallet still works even if KV storage fails
      console.error("[demo/register] KV store failed:", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({
    address,
    secretKey,
    displayName,
    airdropSig: fundingTx,
    airdropFailed: fundingFailed,
  });
}
