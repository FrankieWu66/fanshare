/**
 * Shared PDA derivations for the FanShare Anchor program.
 * Seed prefixes must match the Rust program exactly.
 */

import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");

export function getBondingCurvePda(mintPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mintPubkey.toBuffer()],
    PROGRAM_ID,
  );
}

export function getStatsOraclePda(mintPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stats-oracle"), mintPubkey.toBuffer()],
    PROGRAM_ID,
  );
}

export function getMarketStatusPda(mintPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market-status"), mintPubkey.toBuffer()],
    PROGRAM_ID,
  );
}
