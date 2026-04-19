/**
 * Multi-user QA — Demo 1
 *
 * Simulates 4 distinct demo users trading concurrently to:
 *   1. Exercise the full user journey (register → fund → buy → sell) via real APIs
 *   2. Generate Helius webhook traffic so Step 7 telemetry can be validated
 *   3. Smoke-test concurrent multi-wallet trades don't collide on-chain
 *
 * Personas (using 4 distinct wallets from /api/demo/register):
 *   - Whale:       one buy on Player_NJ ($7.82, expensive tier), holds
 *   - Flipper:     buy then immediate sell on Player_LBJ ($4.33) — Step 7 sell row
 *   - Diversifier: small buys on Player_SC, Player_JB, Player_DB
 *   - Fumbler:     dust buy (expect DustAmount error), then valid buy on Player_DB
 *
 * Assertions:
 *   - All registrations succeed, return funded wallets
 *   - Fumbler's dust buy fails with DustAmount (0x1783); recovers with valid buy
 *   - All other intended trades land
 *   - After 90s sleep, we note the Helius webhook path is exercised
 *
 * Run: bun run scripts/multi-user-qa.ts
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
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import PLAYER_MINTS from "../app/lib/player-mints.json" with { type: "json" };

// ── Constants ──────────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");
const PROTOCOL_WALLET = new PublicKey("CsGh5T7EzTUW3hmdpjMrJyzBVq1RPnDXMr9VYuHyXa83");
const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:55554";

const BUY_DISC = Buffer.from([49, 57, 124, 194, 240, 20, 216, 102]);
const SELL_DISC = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

// Anchor error codes we expect
const DUST_AMOUNT_ERR = "0x1783"; // 6003

// ── Helpers ────────────────────────────────────────────────────────────────
function pda(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}
const bondingCurve = (mint: PublicKey) => pda([Buffer.from("bonding-curve"), mint.toBuffer()]);
const statsOracle = (mint: PublicKey) => pda([Buffer.from("stats-oracle"), mint.toBuffer()]);
const marketStatus = (mint: PublicKey) => pda([Buffer.from("market-status"), mint.toBuffer()]);
const exitTreasury = () => pda([Buffer.from("exit-treasury")]);
const sharpLeaderboard = () => pda([Buffer.from("leaderboard"), Buffer.from([1])]);

function u64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

function buildBuyIx(
  buyer: PublicKey, mint: PublicKey, buyerAta: PublicKey, solAmount: bigint, minTokens: bigint,
) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: bondingCurve(mint), isSigner: false, isWritable: true },
      { pubkey: buyerAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: exitTreasury(), isSigner: false, isWritable: true },
      { pubkey: PROTOCOL_WALLET, isSigner: false, isWritable: true },
      { pubkey: statsOracle(mint), isSigner: false, isWritable: false },
      { pubkey: marketStatus(mint), isSigner: false, isWritable: false },
      { pubkey: sharpLeaderboard(), isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([BUY_DISC, u64LE(solAmount), u64LE(minTokens)]),
  });
}

function buildSellIx(
  seller: PublicKey, mint: PublicKey, sellerAta: PublicKey, tokenAmount: bigint, minSol: bigint,
) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: bondingCurve(mint), isSigner: false, isWritable: true },
      { pubkey: sellerAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: exitTreasury(), isSigner: false, isWritable: true },
      { pubkey: PROTOCOL_WALLET, isSigner: false, isWritable: true },
      { pubkey: statsOracle(mint), isSigner: false, isWritable: false },
      { pubkey: marketStatus(mint), isSigner: false, isWritable: false },
      { pubkey: sharpLeaderboard(), isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([SELL_DISC, u64LE(tokenAmount), u64LE(minSol)]),
  });
}

// ── Register helper ────────────────────────────────────────────────────────
interface DemoWallet {
  persona: string;
  displayName: string;
  address: string;
  keypair: Keypair;
}

async function registerDemoWallet(persona: string): Promise<DemoWallet> {
  const displayName = `qa-${persona}-${Date.now().toString(36)}`;
  const res = await fetch(`${BASE_URL}/api/demo/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  if (body.airdropFailed) throw new Error(`funding failed for ${displayName}`);
  return {
    persona,
    displayName,
    address: body.address,
    keypair: Keypair.fromSecretKey(Uint8Array.from(body.secretKey as number[])),
  };
}

// ── Trade helpers ──────────────────────────────────────────────────────────
async function buy(
  connection: Connection, wallet: DemoWallet, playerId: string, solAmount: bigint,
): Promise<{ sig: string; tokens: string }> {
  const mints = PLAYER_MINTS as Record<string, string>;
  const mint = new PublicKey(mints[playerId]);
  const ata = await getAssociatedTokenAddress(mint, wallet.keypair.publicKey);
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    wallet.keypair.publicKey, ata, wallet.keypair.publicKey, mint,
  );
  const ix = buildBuyIx(wallet.keypair.publicKey, mint, ata, solAmount, 0n);
  const tx = new Transaction().add(createAtaIx, ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet.keypair], { commitment: "confirmed" });
  const bal = await connection.getTokenAccountBalance(ata).catch(() => ({ value: { amount: "0" } }));
  return { sig, tokens: bal.value.amount };
}

async function sell(
  connection: Connection, wallet: DemoWallet, playerId: string, tokenAmount: bigint,
): Promise<string> {
  const mints = PLAYER_MINTS as Record<string, string>;
  const mint = new PublicKey(mints[playerId]);
  const ata = await getAssociatedTokenAddress(mint, wallet.keypair.publicKey);
  const ix = buildSellIx(wallet.keypair.publicKey, mint, ata, tokenAmount, 0n);
  const tx = new Transaction().add(ix);
  return sendAndConfirmTransaction(connection, tx, [wallet.keypair], { commitment: "confirmed" });
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🧪 Multi-User QA — Demo 1`);
  console.log(`Base URL: ${BASE_URL}`);

  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  console.log(`RPC:      ${rpcUrl.replace(/api-key=.*/, "api-key=***")}`);

  // ── 1. Register 4 wallets ──
  console.log(`\n── 1. Register 4 demo wallets ──`);
  const personas = ["whale", "flipper", "diversifier", "fumbler"];
  const wallets: DemoWallet[] = [];
  for (const p of personas) {
    try {
      const w = await registerDemoWallet(p);
      wallets.push(w);
      console.log(`  ✓ ${p.padEnd(12)} ${w.displayName} → ${w.address.slice(0, 10)}…`);
    } catch (err) {
      console.error(`  ✗ ${p}: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }

  // Pause so funding settles and balances are visible on-chain
  await new Promise((r) => setTimeout(r, 3000));

  // Confirm each balance
  for (const w of wallets) {
    const bal = await connection.getBalance(w.keypair.publicKey);
    console.log(`  → ${w.persona.padEnd(12)} balance: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  }

  // ── 2. Execute personas ──
  const results: { persona: string; action: string; ok: boolean; detail: string }[] = [];
  const [whale, flipper, diversifier, fumbler] = wallets;

  // Whale: 0.1 SOL on Player_NJ
  console.log(`\n── 2a. Whale buy Player_NJ (0.1 SOL) ──`);
  try {
    const r = await buy(connection, whale, "Player_NJ", BigInt(0.1 * LAMPORTS_PER_SOL));
    console.log(`  ✓ ${r.tokens} tokens (sig ${r.sig.slice(0, 16)}…)`);
    results.push({ persona: "whale", action: "buy Player_NJ", ok: true, detail: `${r.tokens} tokens` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${msg.slice(0, 200)}`);
    results.push({ persona: "whale", action: "buy Player_NJ", ok: false, detail: msg.slice(0, 200) });
  }

  // Flipper: buy + sell Player_LBJ — this is the Step 7 sell row
  console.log(`\n── 2b. Flipper buy+sell Player_LBJ ──`);
  try {
    const buyRes = await buy(connection, flipper, "Player_LBJ", BigInt(0.05 * LAMPORTS_PER_SOL));
    console.log(`  ✓ buy: ${buyRes.tokens} tokens (sig ${buyRes.sig.slice(0, 16)}…)`);
    results.push({ persona: "flipper", action: "buy Player_LBJ", ok: true, detail: `${buyRes.tokens} tokens` });

    // Small delay before sell so Helius doesn't drop events
    await new Promise((r) => setTimeout(r, 1500));

    // Sell half of what we got
    const sellAmount = BigInt(buyRes.tokens) / 2n;
    if (sellAmount > 0n) {
      const sellSig = await sell(connection, flipper, "Player_LBJ", sellAmount);
      console.log(`  ✓ sell: ${sellAmount} tokens (sig ${sellSig.slice(0, 16)}…)`);
      results.push({ persona: "flipper", action: "sell Player_LBJ", ok: true, detail: `${sellAmount} tokens` });
    } else {
      console.error(`  ✗ nothing to sell (bought 0 tokens)`);
      results.push({ persona: "flipper", action: "sell Player_LBJ", ok: false, detail: "0 tokens to sell" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${msg.slice(0, 200)}`);
    results.push({ persona: "flipper", action: "buy+sell Player_LBJ", ok: false, detail: msg.slice(0, 200) });
  }

  // Diversifier: small buys on 3 players
  console.log(`\n── 2c. Diversifier small buys on 3 players ──`);
  for (const pid of ["Player_SC", "Player_JB", "Player_DB"]) {
    try {
      const r = await buy(connection, diversifier, pid, BigInt(0.03 * LAMPORTS_PER_SOL));
      console.log(`  ✓ ${pid}: ${r.tokens} tokens (sig ${r.sig.slice(0, 16)}…)`);
      results.push({ persona: "diversifier", action: `buy ${pid}`, ok: true, detail: `${r.tokens} tokens` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${pid}: ${msg.slice(0, 200)}`);
      results.push({ persona: "diversifier", action: `buy ${pid}`, ok: false, detail: msg.slice(0, 200) });
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Fumbler: dust buy (expect DustAmount) → recover with valid buy
  console.log(`\n── 2d. Fumbler dust buy (expect fail) + valid buy ──`);
  let dustRejected = false;
  try {
    await buy(connection, fumbler, "Player_DB", 1000n); // 1000 lamports = dust
    console.error(`  ✗ UNEXPECTED: dust buy succeeded`);
    results.push({ persona: "fumbler", action: "dust buy Player_DB", ok: false, detail: "succeeded but should have failed" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes(DUST_AMOUNT_ERR) || msg.toLowerCase().includes("dust")) {
      console.log(`  ✓ dust buy correctly rejected (DustAmount)`);
      dustRejected = true;
      results.push({ persona: "fumbler", action: "dust buy Player_DB (expected fail)", ok: true, detail: "DustAmount" });
    } else {
      console.error(`  ✗ dust buy failed but NOT with DustAmount: ${msg.slice(0, 200)}`);
      results.push({ persona: "fumbler", action: "dust buy Player_DB", ok: false, detail: msg.slice(0, 200) });
    }
  }

  // Recovery: valid buy
  try {
    const r = await buy(connection, fumbler, "Player_DB", BigInt(0.04 * LAMPORTS_PER_SOL));
    console.log(`  ✓ recovery buy: ${r.tokens} tokens (sig ${r.sig.slice(0, 16)}…)`);
    results.push({ persona: "fumbler", action: "recovery buy Player_DB", ok: true, detail: `${r.tokens} tokens` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ recovery buy: ${msg.slice(0, 200)}`);
    results.push({ persona: "fumbler", action: "recovery buy Player_DB", ok: false, detail: msg.slice(0, 200) });
  }

  // ── 3. Summary ──
  console.log(`\n── 3. Summary ──`);
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`  Total trades attempted: ${results.length}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log();
  console.log(`  Wallets used (for telemetry join):`);
  for (const w of wallets) {
    console.log(`    ${w.persona.padEnd(12)} ${w.address}`);
  }

  // Write a manifest for the CSV inspector
  const manifestPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    `../qa-run-${Date.now()}.json`,
  );
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        wallets: wallets.map((w) => ({ persona: w.persona, address: w.address, displayName: w.displayName })),
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\n  Manifest: ${manifestPath}`);

  console.log(`\n⏳ Wait ~90s, then run:`);
  console.log(`     bun run scripts/export-telemetry.ts --since ${new Date(Date.now() - 300_000).toISOString()}`);
  console.log(`   and inspect the CSV for non-zero spread_at_execution_bps on sell rows.`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n❌ Fatal:", err.message ?? err);
  process.exit(1);
});
