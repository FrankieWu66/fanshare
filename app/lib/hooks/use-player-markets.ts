"use client";

import { useMemo } from "react";
import useSWR from "swr";
import {
  DEVNET_PLAYERS,
  PROGRAM_ID,
  BONDING_CURVE_SEED,
  STATS_ORACLE_SEED,
  DEFAULT_BASE_PRICE,
  DEFAULT_SLOPE,
  DEFAULT_TOTAL_SUPPLY,
  BONDING_CURVE_DISCRIMINATOR,
  STATS_ORACLE_DISCRIMINATOR,
  deserializeBondingCurve,
  deserializeStatsOracle,
  type PlayerMarketData,
  type PlayerConfig,
  type BondingCurveData,
  type StatsOracleData,
} from "../fanshare-program";
import { currentPrice, calculateSpread } from "../bonding-curve";
import { useSolanaClient } from "../solana-client-context";
import {
  address,
  getProgramDerivedAddress,
  getUtf8Encoder,
  getAddressEncoder,
  type Address,
} from "@solana/kit";

// Check if player-mints.json exists at build time (set via env var)
// When mints are available, the hook fetches real on-chain data.
// Otherwise, falls back to mock data.
let PLAYER_MINTS: Record<string, string> | null = null;
try {
  // Dynamic import at module level — bundler will include if the file exists
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PLAYER_MINTS = require("../player-mints.json");
} catch {
  // player-mints.json doesn't exist yet (pre-deploy) — use mock data
  PLAYER_MINTS = null;
}

/**
 * Hook to fetch all player market data.
 *
 * POST-DEPLOY: Fetches real on-chain bonding curve + oracle data via getMultipleAccounts.
 * PRE-DEPLOY:  Returns mock data based on bonding curve defaults.
 */
export function usePlayerMarkets(): {
  players: PlayerMarketData[];
  isLoading: boolean;
  error: unknown;
} {
  const client = useSolanaClient();

  const { data, error, isLoading } = useSWR(
    "player-markets",
    async () => {
      // If mints exist and client is available, fetch real on-chain data
      if (PLAYER_MINTS && client) {
        try {
          return await fetchOnChainData(client);
        } catch (err) {
          console.debug("On-chain fetch failed, falling back to mock:", err);
        }
      }
      // Fallback: mock data
      return DEVNET_PLAYERS.map((config, i) => mockPlayerData(config, i));
    },
    { refreshInterval: 5000, revalidateOnFocus: false, keepPreviousData: true }
  );

  return {
    players: data ?? [],
    isLoading,
    error,
  };
}

/**
 * Hook to fetch a single player's full data by player ID.
 */
export function usePlayerData(playerId: string): {
  player: PlayerMarketData | null;
  isLoading: boolean;
  error: unknown;
} {
  const { players, isLoading, error } = usePlayerMarkets();
  const player = useMemo(
    () => players.find((p) => p.config.id === playerId) ?? null,
    [players, playerId]
  );

  return { player, isLoading, error };
}

// ── On-chain fetcher ───────────────────────────────────────────────────────

const RPC_TIMEOUT_MS = 8000; // 8s — prevents infinite spinner on RPC hang

async function fetchOnChainData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
): Promise<PlayerMarketData[]> {
  if (!PLAYER_MINTS) return [];

  // Build PDA addresses for all players
  const pdaAddresses: Address[] = [];
  const playerOrder: PlayerConfig[] = [];

  for (const config of DEVNET_PLAYERS) {
    const mintAddr = PLAYER_MINTS[config.id];
    if (!mintAddr) continue;

    const mint = address(mintAddr);
    const utf8 = getUtf8Encoder();
    const addrEncoder = getAddressEncoder();
    const mintBytes = addrEncoder.encode(mint); // 32-byte decoded pubkey

    const [bondingPda] = await getProgramDerivedAddress({
      programAddress: address(PROGRAM_ID),
      seeds: [utf8.encode(BONDING_CURVE_SEED), mintBytes],
    });

    const [oraclePda] = await getProgramDerivedAddress({
      programAddress: address(PROGRAM_ID),
      seeds: [utf8.encode(STATS_ORACLE_SEED), mintBytes],
    });

    pdaAddresses.push(bondingPda, oraclePda);
    playerOrder.push(config);
  }

  // Batch fetch all accounts in one RPC call — with timeout guard
  // @solana/kit returns base64-encoded data as [dataBase64, "base64"]
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`RPC timeout after ${RPC_TIMEOUT_MS}ms`)), RPC_TIMEOUT_MS)
  );
  const { value: accounts } = await Promise.race([
    client.rpc.getMultipleAccounts(pdaAddresses, { encoding: "base64" }).send(),
    timeoutPromise,
  ]);

  // Parse results — every 2 accounts = [bondingCurve, statsOracle] for one player
  const results: PlayerMarketData[] = [];

  for (let i = 0; i < playerOrder.length; i++) {
    const config = playerOrder[i];
    const curveAccount = accounts[i * 2];
    const oracleAccount = accounts[i * 2 + 1];

    let curve: BondingCurveData | null = null;
    let oracle: StatsOracleData | null = null;

    if (curveAccount?.data) {
      // data is [base64String, "base64"] tuple from the RPC
      const [b64, encoding] = curveAccount.data as [string, string];
      const raw = encoding === "base64"
        ? new Uint8Array(Buffer.from(b64, "base64"))
        : curveAccount.data instanceof Uint8Array
          ? curveAccount.data
          : new Uint8Array();
      if (matchesDiscriminator(raw, BONDING_CURVE_DISCRIMINATOR)) {
        curve = deserializeBondingCurve(raw);
      }
    }

    if (oracleAccount?.data) {
      const [b64, encoding] = oracleAccount.data as [string, string];
      const raw = encoding === "base64"
        ? new Uint8Array(Buffer.from(b64, "base64"))
        : oracleAccount.data instanceof Uint8Array
          ? oracleAccount.data
          : new Uint8Array();
      if (matchesDiscriminator(raw, STATS_ORACLE_DISCRIMINATOR)) {
        oracle = deserializeStatsOracle(raw);
      }
    }

    const tokensSold = curve?.tokensSold ?? 0n;
    const basePrice = curve?.basePrice ?? DEFAULT_BASE_PRICE;
    const slope = curve?.slope ?? DEFAULT_SLOPE;
    const price = currentPrice(basePrice, slope, tokensSold);
    const indexPrice = oracle?.indexPriceLamports ?? 0n;
    const spread = calculateSpread(price, indexPrice);

    results.push({
      config,
      curve,
      oracle,
      currentPrice: price,
      spreadPercent: spread,
    });
  }

  return results;
}

function matchesDiscriminator(data: Uint8Array, expected: Uint8Array): boolean {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== expected[i]) return false;
  }
  return true;
}

// ── Mock data (pre-deploy fallback) ────────────────────────────────────────

const MOCK_TOKENS_SOLD = [
  0n, 5000n, 12000n, 800n, 25000n,
  3200n, 18000n, 450n, 31000n, 7600n,
  1100n, 9800n, 22000n, 650n, 41000n,
];
const MOCK_INDEX_PRICES = [
  50000n, 60000n, 45000n, 30000n, 120000n,
  35000n, 85000n, 28000n, 95000n, 55000n,
  22000n, 70000n, 110000n, 18000n, 200000n,
];

function mockPlayerData(config: PlayerConfig, index: number): PlayerMarketData {
  const mockTokensSold = MOCK_TOKENS_SOLD[index] ?? 0n;
  const price = currentPrice(DEFAULT_BASE_PRICE, DEFAULT_SLOPE, mockTokensSold);
  const indexPrice = MOCK_INDEX_PRICES[index] ?? 0n;

  const spread = calculateSpread(price, indexPrice);

  return {
    config,
    curve: {
      playerId: config.id,
      mint: `mock-mint-${index}`,
      basePrice: DEFAULT_BASE_PRICE,
      slope: DEFAULT_SLOPE,
      totalSupply: DEFAULT_TOTAL_SUPPLY,
      tokensSold: mockTokensSold,
      treasuryLamports: 0n,
      authority: "mock-authority",
      bump: 255,
    },
    oracle: {
      mint: `mock-mint-${index}`,
      indexPriceLamports: indexPrice,
      lastUpdated: BigInt(Math.floor(Date.now() / 1000)),
      statsSourceDate: BigInt(Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000)),
      authority: "mock-oracle-authority",
      bump: 254,
    },
    currentPrice: price,
    spreadPercent: spread,
  };
}

// Re-export defaults for use in components
export { DEFAULT_BASE_PRICE, DEFAULT_SLOPE, DEFAULT_TOTAL_SUPPLY };
