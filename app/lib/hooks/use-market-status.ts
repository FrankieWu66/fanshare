"use client";

import useSWR from "swr";
import { address as toAddress, type Address } from "@solana/kit";
import { useSolanaClient } from "../solana-client-context";
import { getMarketStatusPda } from "../fanshare-instructions";
import {
  MARKET_STATUS_DISCRIMINATOR,
  deserializeMarketStatus,
  type MarketStatusData,
} from "../fanshare-program";

/**
 * Fetch the on-chain MarketStatus account for a given mint.
 * Returns null if the account does not exist (treat as not frozen).
 */
export function useMarketStatus(mintAddress: string | undefined): {
  marketStatus: MarketStatusData | null;
  isLoading: boolean;
} {
  const client = useSolanaClient();

  const { data, isLoading } = useSWR(
    mintAddress && !mintAddress.startsWith("mock-")
      ? `market-status:${mintAddress}`
      : null,
    async () => {
      if (!mintAddress) return null;

      const mint = toAddress(mintAddress) as Address;
      const pda = await getMarketStatusPda(mint);

      try {
        const { value: account } = await client.rpc
          .getAccountInfo(pda, { encoding: "base64" })
          .send();

        if (!account?.data) return null;

        const [b64, encoding] = account.data as [string, string];
        const raw =
          encoding === "base64"
            ? new Uint8Array(Buffer.from(b64, "base64"))
            : account.data instanceof Uint8Array
              ? account.data
              : new Uint8Array();

        if (raw.length < 8) return null;

        // Verify discriminator
        for (let i = 0; i < 8; i++) {
          if (raw[i] !== MARKET_STATUS_DISCRIMINATOR[i]) return null;
        }

        return deserializeMarketStatus(raw);
      } catch {
        // Account doesn't exist or RPC error — treat as not frozen
        return null;
      }
    },
    { refreshInterval: 10_000, revalidateOnFocus: false }
  );

  return { marketStatus: data ?? null, isLoading };
}
