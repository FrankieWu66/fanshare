/**
 * Shared update_oracle instruction builder.
 *
 * Used by both scripts/oracle.ts (daily cron) and scripts/init-players.ts
 * (first oracle tick at launch, same in-memory pillars → spread=0 at T0).
 */

import {
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import type { PillarBreakdown } from "../../app/lib/oracle-weights";
import { PROGRAM_ID } from "./pdas";

// update_oracle discriminator from IDL — DO NOT CHANGE
export const UPDATE_ORACLE_DISCRIMINATOR = Buffer.from([112, 41, 209, 18, 248, 226, 252, 188]);

function encodeU64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

function encodeI64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(n);
  return buf;
}

/**
 * Pillar lamport deltas for OracleUpdateEvent.
 * Mirrors the math that previously lived inline in scripts/oracle.ts.
 */
export function pillarLamportDeltas(pillars: PillarBreakdown): {
  scoring: bigint;
  playmaking: bigint;
  defense: bigint;
  winning: bigint;
} {
  return {
    scoring:    BigInt(Math.round(pillars.scoring    * 0.12 / 150 * 1_000_000_000)),
    playmaking: BigInt(Math.round(pillars.playmaking * 0.12 / 150 * 1_000_000_000)),
    defense:    BigInt(Math.round(pillars.defense    * 0.12 / 150 * 1_000_000_000)),
    winning:    BigInt(Math.round(pillars.winning    * 0.12 / 150 * 1_000_000_000)),
  };
}

/**
 * Build the update_oracle instruction.
 * Signature: update_oracle(index_price_lamports, stats_source_date,
 *   delta_scoring, delta_playmaking, delta_defense, delta_winning)
 */
export function buildUpdateOracleInstruction(
  authority: PublicKey,
  statsOraclePda: PublicKey,
  indexPriceLamports: bigint,
  statsSourceDate: bigint,
  deltaScoring: bigint,
  deltaPlaymaking: bigint,
  deltaDefense: bigint,
  deltaWinning: bigint,
): TransactionInstruction {
  const data = Buffer.concat([
    UPDATE_ORACLE_DISCRIMINATOR,
    encodeU64LE(indexPriceLamports),
    encodeI64LE(statsSourceDate),
    encodeI64LE(deltaScoring),
    encodeI64LE(deltaPlaymaking),
    encodeI64LE(deltaDefense),
    encodeI64LE(deltaWinning),
  ]);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority,      isSigner: true,  isWritable: false },
      { pubkey: statsOraclePda, isSigner: false, isWritable: true  },
    ],
    data,
  });
}
