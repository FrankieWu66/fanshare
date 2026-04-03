"use client";

import useSWR from "swr";
import { type Address } from "@solana/kit";
import { useCluster } from "../../components/cluster-context";
import { useSolanaClient } from "../solana-client-context";

/**
 * Returns the SPL token balance (as BigInt) for a given wallet + mint.
 * Falls back to null when the wallet has no token account for this mint.
 */
export function useTokenBalance(owner?: Address, mint?: Address) {
  const { cluster } = useCluster();
  const client = useSolanaClient();

  const { data, isLoading, error, mutate } = useSWR(
    owner && mint ? (["tokenBalance", cluster, owner, mint] as const) : null,
    async ([, , ownerAddr, mintAddr]) => {
      const { value } = await client.rpc
        .getTokenAccountsByOwner(
          ownerAddr,
          { mint: mintAddr },
          { encoding: "jsonParsed" }
        )
        .send();

      if (value.length === 0) return 0n;

      // Pick the first (and normally only) ATA for this mint
      const parsed = (value[0].account.data as { parsed: { info: { tokenAmount: { amount: string } } } }).parsed;
      return BigInt(parsed.info.tokenAmount.amount);
    },
    { refreshInterval: 30_000, revalidateOnFocus: true }
  );

  return {
    tokenAmount: data ?? null as bigint | null,
    isLoading,
    error,
    mutate,
  };
}
