/**
 * FanShare instruction builders for @solana/kit.
 * Manually encodes Anchor instructions using discriminators from the IDL.
 * Replace with Codama-generated client once codegen pipeline is wired up.
 */

import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
  type Instruction,
  type AccountMeta,
} from "@solana/kit";
import { PROGRAM_ID, BONDING_CURVE_SEED, STATS_ORACLE_SEED, EXIT_TREASURY_SEED, MARKET_STATUS_SEED, LEADERBOARD_SEED, SHARP_CALLS_TYPE, PROTOCOL_WALLET } from "./fanshare-program";

const TOKEN_PROGRAM_ID = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
const ASSOCIATED_TOKEN_PROGRAM_ID = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Derive the BondingCurveAccount PDA for a given mint. */
export async function getBondingCurvePda(mint: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(PROGRAM_ID),
    seeds: [getUtf8Encoder().encode(BONDING_CURVE_SEED), enc.encode(address(mint))],
  });
  return pda;
}

/** Derive the StatsOracleAccount PDA for a given mint. */
export async function getStatsOraclePda(mint: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(PROGRAM_ID),
    seeds: [getUtf8Encoder().encode(STATS_ORACLE_SEED), enc.encode(address(mint))],
  });
  return pda;
}

/** Derive the GlobalExitTreasury PDA (singleton). */
export async function getExitTreasuryPda(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(PROGRAM_ID),
    seeds: [getUtf8Encoder().encode(EXIT_TREASURY_SEED)],
  });
  return pda;
}

/** Derive the MarketStatus PDA for a given mint (per-player freeze guard). */
export async function getMarketStatusPda(mint: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(PROGRAM_ID),
    seeds: [getUtf8Encoder().encode(MARKET_STATUS_SEED), enc.encode(address(mint))],
  });
  return pda;
}

/** Derive the Sharp Calls LeaderboardAnchor PDA (global singleton). */
export async function getSharpLeaderboardPda(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(PROGRAM_ID),
    seeds: [getUtf8Encoder().encode(LEADERBOARD_SEED), new Uint8Array([SHARP_CALLS_TYPE])],
  });
  return pda;
}

/** Derive the associated token account address for owner + mint. */
export async function getAssociatedTokenAccount(
  owner: Address,
  mint: Address
): Promise<Address> {
  const enc = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [
      enc.encode(address(owner)),
      enc.encode(TOKEN_PROGRAM_ID),
      enc.encode(address(mint)),
    ],
  });
  return ata;
}

// Anchor discriminators from IDL
const BUY_WITH_SOL_DISCRIMINATOR = new Uint8Array([49, 57, 124, 194, 240, 20, 216, 102]);
const SELL_DISCRIMINATOR = new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]);

function encodeU64LE(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, value, true);
  return buf;
}

/**
 * Build `buy_with_sol` instruction.
 * User specifies SOL amount to spend; program calculates tokens received.
 * Fee (1.5%) is deducted from sol budget on-chain.
 */
export function getBuyWithSolInstruction({
  buyer,
  mint,
  bondingCurve,
  buyerTokenAccount,
  exitTreasury,
  protocolWallet,
  statsOracle,
  marketStatus,
  sharpLeaderboard,
  solAmount,
  minTokensOut,
}: {
  buyer: Address;
  mint: Address;
  bondingCurve: Address;
  buyerTokenAccount: Address;
  exitTreasury: Address;
  protocolWallet: Address;
  statsOracle: Address;
  marketStatus: Address;
  sharpLeaderboard: Address;
  solAmount: bigint;
  minTokensOut: bigint;
}): Instruction {
  const data = new Uint8Array(8 + 8 + 8);
  data.set(BUY_WITH_SOL_DISCRIMINATOR, 0);
  data.set(encodeU64LE(solAmount), 8);
  data.set(encodeU64LE(minTokensOut), 16);

  const accounts: AccountMeta[] = [
    { address: buyer, role: 3 },            // writable signer
    { address: mint, role: 1 },             // writable
    { address: bondingCurve, role: 1 },     // writable PDA
    { address: buyerTokenAccount, role: 1 },// writable ATA
    { address: SYSTEM_PROGRAM_ID, role: 0 },
    { address: TOKEN_PROGRAM_ID, role: 0 },
    { address: exitTreasury, role: 1 },     // writable PDA (treasury fee)
    { address: protocolWallet, role: 1 },   // writable (protocol fee)
    { address: statsOracle, role: 0 },      // readonly (spread calc)
    { address: marketStatus, role: 0 },     // readonly (freeze guard)
    { address: sharpLeaderboard, role: 0 }, // readonly (early access check)
  ];

  return {
    programAddress: address(PROGRAM_ID),
    accounts,
    data,
  };
}

/**
 * Build `sell` instruction.
 * User specifies token amount to sell; program calculates SOL received.
 * Fee (1.5%) is deducted from SOL return on-chain.
 */
export function getSellInstruction({
  buyer: seller,
  mint,
  bondingCurve,
  buyerTokenAccount: sellerTokenAccount,
  exitTreasury,
  protocolWallet,
  statsOracle,
  marketStatus,
  sharpLeaderboard,
  tokenAmount,
  minSolOut,
}: {
  buyer: Address;
  mint: Address;
  bondingCurve: Address;
  buyerTokenAccount: Address;
  exitTreasury: Address;
  protocolWallet: Address;
  statsOracle: Address;
  marketStatus: Address;
  sharpLeaderboard: Address;
  tokenAmount: bigint;
  minSolOut: bigint;
}): Instruction {
  const data = new Uint8Array(8 + 8 + 8);
  data.set(SELL_DISCRIMINATOR, 0);
  data.set(encodeU64LE(tokenAmount), 8);
  data.set(encodeU64LE(minSolOut), 16);

  const accounts: AccountMeta[] = [
    { address: seller, role: 3 },
    { address: mint, role: 1 },
    { address: bondingCurve, role: 1 },
    { address: sellerTokenAccount, role: 1 },
    { address: SYSTEM_PROGRAM_ID, role: 0 },
    { address: TOKEN_PROGRAM_ID, role: 0 },
    { address: exitTreasury, role: 1 },     // writable PDA (treasury fee)
    { address: protocolWallet, role: 1 },   // writable (protocol fee)
    { address: statsOracle, role: 0 },      // readonly (spread calc)
    { address: marketStatus, role: 0 },     // readonly (freeze guard)
    { address: sharpLeaderboard, role: 0 }, // readonly (early access check)
  ];

  return {
    programAddress: address(PROGRAM_ID),
    accounts,
    data,
  };
}

/**
 * Build `createAssociatedTokenAccountIdempotent` instruction.
 * Instruction discriminator 1 = CreateIdempotent (no-op if account already exists).
 * Always safe to prepend to buy transactions — costs ~0.002 SOL the first time,
 * nothing thereafter.
 */
export function getCreateAtaIdempotentInstruction({
  payer,
  owner,
  mint,
  ata,
}: {
  payer: Address;
  owner: Address;
  mint: Address;
  ata: Address;
}): Instruction {
  const accounts: AccountMeta[] = [
    { address: payer, role: 3 },       // writable signer (pays rent)
    { address: ata, role: 1 },         // writable (the ATA to create)
    { address: owner, role: 0 },       // readonly (wallet address)
    { address: mint, role: 0 },        // readonly (token mint)
    { address: SYSTEM_PROGRAM_ID, role: 0 },
    { address: TOKEN_PROGRAM_ID, role: 0 },
  ];

  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts,
    data: new Uint8Array([1]), // 1 = CreateIdempotent
  };
}

/** Slippage: apply a tolerance percentage to a base amount. */
export function applySlippage(amount: bigint, tolerancePct: number): bigint {
  const factor = BigInt(Math.floor((1 - tolerancePct / 100) * 10000));
  return (amount * factor) / 10000n;
}
