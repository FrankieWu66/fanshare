/**
 * Trade instruction builders + send helpers used by the game-night orchestrator.
 *
 * Mirrors the buildBuyIx / buildSellIx / buy / sell helpers in
 * scripts/multi-user-qa.ts but without that file's top-level main() side
 * effects. Kept local to scripts/qa/ so the rehearsal module graph is
 * self-contained for reviewers.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import PLAYER_MINTS from "../../app/lib/player-mints.json" with { type: "json" };
import { PROGRAM_ID } from "../../app/lib/shared/pdas";

const PROTOCOL_WALLET = new PublicKey("CsGh5T7EzTUW3hmdpjMrJyzBVq1RPnDXMr9VYuHyXa83");

// Anchor instruction discriminators (must match the IDL).
const BUY_DISC = Buffer.from([49, 57, 124, 194, 240, 20, 216, 102]);
const SELL_DISC = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

// Expected errors we may hit and want to classify cleanly.
export const DUST_AMOUNT_ERR = "0x1783"; // 6003

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

export function buildBuyIx(
  buyer: PublicKey,
  mint: PublicKey,
  buyerAta: PublicKey,
  solLamports: bigint,
  minTokens: bigint,
): TransactionInstruction {
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
    data: Buffer.concat([BUY_DISC, u64LE(solLamports), u64LE(minTokens)]),
  });
}

export function buildSellIx(
  seller: PublicKey,
  mint: PublicKey,
  sellerAta: PublicKey,
  tokenAmount: bigint,
  minSolLamports: bigint,
): TransactionInstruction {
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
    data: Buffer.concat([SELL_DISC, u64LE(tokenAmount), u64LE(minSolLamports)]),
  });
}

export interface TradeWallet {
  address: string;
  keypair: Keypair;
}

export interface BuyResult {
  ok: boolean;
  sig?: string;
  tokensAfter?: string; // raw u64 string
  error?: string;
  errorCode?: string;
}

export interface SellResult {
  ok: boolean;
  sig?: string;
  error?: string;
  errorCode?: string;
}

export function mintFor(playerId: string): PublicKey {
  const mints = PLAYER_MINTS as Record<string, string>;
  const mintStr = mints[playerId];
  if (!mintStr) throw new Error(`no mint for player ${playerId}`);
  return new PublicKey(mintStr);
}

export async function buy(
  connection: Connection,
  wallet: TradeWallet,
  playerId: string,
  solLamports: bigint,
): Promise<BuyResult> {
  const mint = mintFor(playerId);
  const ata = await getAssociatedTokenAddress(mint, wallet.keypair.publicKey);
  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    wallet.keypair.publicKey,
    ata,
    wallet.keypair.publicKey,
    mint,
  );
  const ix = buildBuyIx(wallet.keypair.publicKey, mint, ata, solLamports, 0n);
  const tx = new Transaction().add(createAtaIx, ix);
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet.keypair], {
      commitment: "confirmed",
    });
    const bal = await connection.getTokenAccountBalance(ata).catch(() => ({ value: { amount: "0" } }));
    return { ok: true, sig, tokensAfter: bal.value.amount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, errorCode: extractErrCode(msg) };
  }
}

export async function sell(
  connection: Connection,
  wallet: TradeWallet,
  playerId: string,
  tokenAmount: bigint,
): Promise<SellResult> {
  const mint = mintFor(playerId);
  const ata = await getAssociatedTokenAddress(mint, wallet.keypair.publicKey);
  const ix = buildSellIx(wallet.keypair.publicKey, mint, ata, tokenAmount, 0n);
  const tx = new Transaction().add(ix);
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet.keypair], {
      commitment: "confirmed",
    });
    return { ok: true, sig };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, errorCode: extractErrCode(msg) };
  }
}

function extractErrCode(msg: string): string | undefined {
  const m = msg.match(/0x[0-9a-fA-F]+/);
  return m?.[0];
}

export async function tokenBalance(
  connection: Connection,
  wallet: TradeWallet,
  playerId: string,
): Promise<bigint> {
  const mint = mintFor(playerId);
  const ata = await getAssociatedTokenAddress(mint, wallet.keypair.publicKey);
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    return BigInt(bal.value.amount);
  } catch {
    return 0n;
  }
}
