import { createEmptyClient } from "@solana/kit";
import { rpc, rpcAirdrop } from "@solana/kit-plugin-rpc";

export type ClusterMoniker = "devnet" | "testnet" | "mainnet" | "localnet";

export const CLUSTERS: ClusterMoniker[] = [
  "devnet",
  "testnet",
  "mainnet",
  "localnet",
];

// When NEXT_PUBLIC_HELIUS_API_KEY is set, devnet/mainnet use Helius RPC for
// reliability (public endpoints are rate-limited and often congested).
function buildClusterUrls(): Record<ClusterMoniker, string> {
  const heliusKey =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_HELIUS_API_KEY
      : undefined;
  return {
    devnet: heliusKey
      ? `https://devnet.helius-rpc.com/?api-key=${heliusKey}`
      : "https://api.devnet.solana.com",
    testnet: "https://api.testnet.solana.com",
    mainnet: heliusKey
      ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
      : "https://api.mainnet-beta.solana.com",
    localnet: "http://localhost:8899",
  };
}

function buildWsUrls(): Record<ClusterMoniker, string> {
  const heliusKey =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_HELIUS_API_KEY
      : undefined;
  return {
    devnet: heliusKey
      ? `wss://devnet.helius-rpc.com/?api-key=${heliusKey}`
      : "wss://api.devnet.solana.com",
    testnet: "wss://api.testnet.solana.com",
    mainnet: heliusKey
      ? `wss://mainnet.helius-rpc.com/?api-key=${heliusKey}`
      : "wss://api.mainnet-beta.solana.com",
    localnet: "ws://localhost:8900",
  };
}

export function getClusterUrl(cluster: ClusterMoniker) {
  return buildClusterUrls()[cluster];
}

export function getClusterWsConfig(cluster: ClusterMoniker) {
  return cluster === "localnet"
    ? { url: buildWsUrls()[cluster] }
    : undefined;
}

export function createSolanaClient(cluster: ClusterMoniker) {
  const urls = buildClusterUrls();
  const wsUrls = buildWsUrls();
  const url = urls[cluster];
  const wsUrl = wsUrls[cluster];
  return createEmptyClient()
    .use(rpc(url, { url: wsUrl }))
    .use(rpcAirdrop());
}

export type SolanaClient = ReturnType<typeof createSolanaClient>;
