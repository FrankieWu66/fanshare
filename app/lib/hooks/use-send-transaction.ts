"use client";

import { useState, useCallback, useMemo } from "react";
import { useSWRConfig } from "swr";
import type { Instruction, TransactionSigner } from "@solana/kit";
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstruction,
  setTransactionMessageLifetimeUsingBlockhash,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  assertIsTransactionWithBlockhashLifetime,
} from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { useWallet } from "../wallet/context";
import { useCluster } from "../../components/cluster-context";
import { getClusterUrl, getClusterWsConfig, type ClusterMoniker } from "../solana-client";

/**
 * Fixed CU budget for demo-wallet transactions.
 * createAtaIdempotent + buy_with_sol ≈ 70–120k CUs on devnet;
 * 300k gives plenty of headroom without the simulation overhead.
 */
const DEMO_COMPUTE_UNIT_LIMIT = 300_000;

/**
 * Build and send a transaction manually for KeyPairSigner (demo wallet).
 *
 * The @solana/kit-client-rpc pipeline always adds a provisory CU limit of 0
 * and then simulates the transaction to estimate actual CU usage. For demo
 * wallets (KeyPairSigner / TransactionPartialSigner) this simulation fails
 * with SOLANA_ERROR__TRANSACTION_ERROR__INVALID_ACCOUNT_INDEX, preventing any
 * trade from completing. Bypassing CU estimation with a fixed generous limit
 * avoids the issue entirely.
 */
async function sendWithKeypairSigner({
  signer,
  instructions,
  cluster,
}: {
  signer: TransactionSigner;
  instructions: readonly Instruction[];
  cluster: ClusterMoniker;
}): Promise<string> {
  const url = getClusterUrl(cluster);
  // Derive WebSocket URL: https → wss, http → ws (works for Helius + public endpoints).
  // getClusterWsConfig only returns a config for localnet; for other clusters the
  // ws URL is derived from the http URL by the subscription client itself.
  const wsConfig = getClusterWsConfig(cluster);
  const wsUrl = wsConfig?.url ?? url.replace(/^http/, "ws");

  const rpc = createSolanaRpc(url);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);

  const { value: { blockhash, lastValidBlockHeight } } =
    await rpc.getLatestBlockhash().send();

  // Build the transaction message step-by-step.
  // We prepend a fixed CU limit instruction so CU estimation is not needed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message: any = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => appendTransactionMessageInstruction(
      getSetComputeUnitLimitInstruction({ units: DEMO_COMPUTE_UNIT_LIMIT }),
      tx,
    ),
    (tx) => instructions.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (acc: any, ix) => appendTransactionMessageInstruction(ix, acc),
      tx,
    ),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(
      { blockhash, lastValidBlockHeight },
      tx,
    ),
  );

  // Sign with the KeyPairSigner (fee payer = buyer, covers all writable-signer accounts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signedTx = await signTransactionMessageWithSigners(message as any);

  assertIsTransactionWithBlockhashLifetime(signedTx);

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  await sendAndConfirm(signedTx, { commitment: "confirmed" });

  return getSignatureFromTransaction(signedTx) as string;
}

export function useSendTransaction() {
  const { signer, isDemoMode } = useWallet();
  const { cluster } = useCluster();
  const { mutate } = useSWRConfig();
  const [isSending, setIsSending] = useState(false);

  // Only create the kit-client-rpc pipeline for Phantom / real wallets.
  // Demo wallets (KeyPairSigner) use the manual path in `send` below.
  const txClient = useMemo(
    () =>
      signer && !isDemoMode
        ? createClient({
            url: getClusterUrl(cluster),
            rpcSubscriptionsConfig: getClusterWsConfig(cluster),
            payer: signer,
          })
        : null,
    [cluster, signer, isDemoMode],
  );

  const send = useCallback(
    async ({ instructions }: { instructions: readonly Instruction[] }) => {
      if (!signer) throw new Error("Wallet not connected");

      setIsSending(true);
      try {
        let signature: string;

        if (isDemoMode) {
          // Demo wallet: build transaction manually, bypassing CU estimation.
          signature = await sendWithKeypairSigner({ signer, instructions, cluster });
        } else {
          if (!txClient) throw new Error("Wallet not connected");
          const result = await txClient.sendTransaction([...instructions]);
          signature = result.context.signature as string;
        }

        // Refresh SOL balance, token balance, and bonding curve data
        mutate((key: unknown) => {
          if (!Array.isArray(key)) return key === "player-markets";
          return key[0] === "balance" || key[0] === "tokenBalance";
        });
        return signature;
      } finally {
        setIsSending(false);
      }
    },
    [txClient, signer, isDemoMode, cluster, mutate],
  );

  return { send, isSending };
}
