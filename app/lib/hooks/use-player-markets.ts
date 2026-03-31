"use client";

import { useMemo } from "react";
import useSWR from "swr";
import {
  DEVNET_PLAYERS,
  DEFAULT_BASE_PRICE,
  DEFAULT_SLOPE,
  DEFAULT_TOTAL_SUPPLY,
  type PlayerMarketData,
  type PlayerConfig,
} from "../fanshare-program";
import { currentPrice, calculateSpread } from "../bonding-curve";

/**
 * Hook to fetch all player market data.
 *
 * PRE-DEPLOY: Returns mock data based on bonding curve defaults.
 * POST-DEPLOY: Will use getMultipleAccounts to batch-fetch all PDAs.
 */
export function usePlayerMarkets(): {
  players: PlayerMarketData[];
  isLoading: boolean;
  error: unknown;
} {
  // TODO: Replace with real on-chain fetch after devnet deploy
  // Will use getMultipleAccounts for batch RPC (design decision #7)
  const { data, error, isLoading } = useSWR(
    "player-markets",
    async () => {
      // Pre-deploy: generate mock market data from curve defaults
      return DEVNET_PLAYERS.map((config, i) => mockPlayerData(config, i));
    },
    { refreshInterval: 5000 }
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

// Mock data generator — simulates different curve positions per player
function mockPlayerData(config: PlayerConfig, index: number): PlayerMarketData {
  // Each player has a different number of "tokens sold" to show varied prices
  const mockTokensSold = BigInt([0, 5000, 12000, 800, 25000][index] ?? 0);

  const price = currentPrice(DEFAULT_BASE_PRICE, DEFAULT_SLOPE, mockTokensSold);

  // Mock oracle index prices (simulating stats-based valuation)
  const mockIndexPrices = [50000n, 60000n, 45000n, 30000n, 120000n];
  const indexPrice = mockIndexPrices[index] ?? 0n;

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
      authority: "mock-oracle-authority",
      bump: 254,
    },
    currentPrice: price,
    spreadPercent: spread,
  };
}

// Re-export defaults for use in components
export { DEFAULT_BASE_PRICE, DEFAULT_SLOPE, DEFAULT_TOTAL_SUPPLY };
