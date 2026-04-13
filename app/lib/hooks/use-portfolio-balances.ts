"use client";

import useSWR from "swr";
import { type Address } from "@solana/kit";
import { useCluster } from "../../components/cluster-context";
import { useSolanaClient } from "../solana-client-context";

/**
 * Fetches all SPL token balances for a wallet in a single RPC call.
 * Returns a map of mint address → token amount (BigInt).
 */
export function usePortfolioBalances(owner?: Address) {
  const { cluster } = useCluster();
  const client = useSolanaClient();

  const { data, isLoading, mutate } = useSWR(
    owner ? (["portfolioBalances", cluster, owner] as const) : null,
    async ([, , ownerAddr]) => {
      const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
      const { value } = await client.rpc
        .getTokenAccountsByOwner(
          ownerAddr,
          { programId: TOKEN_PROGRAM_ID },
          { encoding: "jsonParsed" }
        )
        .send();

      const map = new Map<string, bigint>();
      for (const account of value) {
        const parsed = (account.account.data as {
          parsed: { info: { mint: string; tokenAmount: { amount: string } } };
        }).parsed;
        const { mint, tokenAmount } = parsed.info;
        const amount = BigInt(tokenAmount.amount);
        if (amount > 0n) {
          map.set(mint, amount);
        }
      }
      return map;
    },
    { refreshInterval: 30_000, revalidateOnFocus: true }
  );

  return {
    balances: data ?? new Map<string, bigint>(),
    isLoading,
    mutate,
  };
}
