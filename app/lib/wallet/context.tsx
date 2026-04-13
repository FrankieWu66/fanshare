"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type PropsWithChildren,
} from "react";
import type { TransactionSigner } from "@solana/kit";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import type { WalletConnector, WalletSession } from "./types";
import { discoverWallets, watchWallets } from "./standard";
import { createWalletSigner } from "./signer";
import { useCluster } from "../../components/cluster-context";

const WALLET_STATUS = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
} as const;

type WalletStatus = (typeof WALLET_STATUS)[keyof typeof WALLET_STATUS];

/** Key stored in localStorage for persisted demo sessions. */
const DEMO_STORAGE_KEY = "fanshare_demo";
/** Key stored in localStorage for the last real wallet connector. */
const STORAGE_KEY = "solana:last-connector";

type WalletContextValue = {
  connectors: WalletConnector[];
  status: WalletStatus;
  wallet: WalletSession | undefined;
  signer: TransactionSigner | undefined;
  error: unknown;
  connect: (connectorId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  isReady: boolean;
  // Demo wallet
  isDemoMode: boolean;
  connectDemo: (displayName: string) => Promise<void>;
  disconnectDemo: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: PropsWithChildren) {
  const { cluster } = useCluster();
  const chain = `solana:${cluster}`;

  const [connectors, setConnectors] = useState<WalletConnector[]>(() =>
    typeof window === "undefined" ? [] : discoverWallets()
  );
  const [session, setSession] = useState<WalletSession | undefined>();
  const [status, setStatus] = useState<WalletStatus>(
    WALLET_STATUS.DISCONNECTED
  );
  const [error, setError] = useState<unknown>();
  const isReady = typeof window !== "undefined";

  // Demo wallet state
  const [demoSession, setDemoSession] = useState<WalletSession | undefined>();
  const [demoSigner, setDemoSigner] = useState<TransactionSigner | undefined>();

  const connectorsRef = useRef<WalletConnector[]>(connectors);
  const autoConnectAttempted = useRef(false);

  const handleWalletsChanged = useCallback((updated: WalletConnector[]) => {
    connectorsRef.current = updated;
    setConnectors(updated);
  }, []);

  // Restore demo session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!stored) return;

    let parsed: { secretKey: number[]; displayName: string; address: string } | null = null;
    try {
      parsed = JSON.parse(stored);
    } catch {
      localStorage.removeItem(DEMO_STORAGE_KEY);
      return;
    }
    if (!parsed?.secretKey || !parsed?.address) {
      localStorage.removeItem(DEMO_STORAGE_KEY);
      return;
    }

    createKeyPairSignerFromBytes(Uint8Array.from(parsed.secretKey))
      .then((signer) => {
        setDemoSigner(signer);
        setDemoSession({
          account: {
            address: signer.address,
            publicKey: Uint8Array.from(parsed!.secretKey.slice(32)),
            label: `Demo: ${parsed!.displayName}`,
          },
          connector: { id: "demo", name: "Demo Mode" },
          disconnect: async () => {
            // handled below in disconnectDemo
          },
        });
      })
      .catch(() => {
        localStorage.removeItem(DEMO_STORAGE_KEY);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAutoConnect = useCallback(async (connector: WalletConnector) => {
    setStatus(WALLET_STATUS.CONNECTING);
    try {
      const s = await connector.connect({ silent: true });
      setSession(s);
      setStatus(WALLET_STATUS.CONNECTED);
    } catch {
      setStatus(WALLET_STATUS.DISCONNECTED);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = watchWallets(handleWalletsChanged);

    const lastId = localStorage.getItem(STORAGE_KEY);
    if (lastId && !autoConnectAttempted.current) {
      autoConnectAttempted.current = true;
      const connector = connectorsRef.current.find((c) => c.id === lastId);
      if (connector) {
        void runAutoConnect(connector);
      }
    }

    return unsubscribe;
  }, [handleWalletsChanged, runAutoConnect]);

  const connect = useCallback(async (connectorId: string) => {
    const connector = connectorsRef.current.find((c) => c.id === connectorId);
    if (!connector) throw new Error(`Unknown connector: ${connectorId}`);

    setStatus(WALLET_STATUS.CONNECTING);
    setError(undefined);

    try {
      const s = await connector.connect();
      setSession(s);
      setStatus(WALLET_STATUS.CONNECTED);
      localStorage.setItem(STORAGE_KEY, connectorId);
    } catch (err) {
      setError(err);
      setStatus(WALLET_STATUS.ERROR);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (session) {
      try {
        await session.disconnect();
      } catch {
        /* ignore disconnect errors */
      }
    }
    setSession(undefined);
    setStatus(WALLET_STATUS.DISCONNECTED);
    setError(undefined);
    localStorage.removeItem(STORAGE_KEY);
  }, [session]);

  /**
   * Create a demo wallet: calls /api/demo/register, stores the keypair
   * in localStorage, and activates demo mode.
   */
  const connectDemo = useCallback(async (displayName: string) => {
    const res = await fetch("/api/demo/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? "Registration failed");
    }

    const data = (await res.json()) as {
      address: string;
      secretKey: number[];
      displayName: string;
      airdropFailed?: boolean;
    };

    // Persist to localStorage for reload recovery
    localStorage.setItem(
      DEMO_STORAGE_KEY,
      JSON.stringify({
        secretKey: data.secretKey,
        displayName: data.displayName,
        address: data.address,
      })
    );

    const signer = await createKeyPairSignerFromBytes(Uint8Array.from(data.secretKey));

    setDemoSigner(signer);
    setDemoSession({
      account: {
        address: signer.address,
        publicKey: Uint8Array.from(data.secretKey.slice(32)),
        label: `Demo: ${data.displayName}`,
      },
      connector: { id: "demo", name: "Demo Mode" },
      disconnect: async () => {
        // handled by disconnectDemo
      },
    });
  }, []);

  /** Clear demo session and return to disconnected state. */
  const disconnectDemo = useCallback(() => {
    localStorage.removeItem(DEMO_STORAGE_KEY);
    setDemoSession(undefined);
    setDemoSigner(undefined);
  }, []);

  // When demo is active, it takes precedence over real wallet for display
  const effectiveSession = demoSession ?? session;
  const isDemoMode = !!demoSession;

  // Signer: prefer demoSigner, then real wallet signer
  const signer = useMemo<TransactionSigner | undefined>(() => {
    if (demoSigner) return demoSigner;
    return session ? createWalletSigner(session, chain) : undefined;
  }, [demoSigner, session, chain]);

  // Status: demo counts as connected
  const effectiveStatus: WalletStatus = isDemoMode
    ? WALLET_STATUS.CONNECTED
    : status;

  const value = useMemo<WalletContextValue>(
    () => ({
      connectors,
      status: effectiveStatus,
      wallet: effectiveSession,
      signer,
      error,
      connect,
      disconnect,
      isReady,
      isDemoMode,
      connectDemo,
      disconnectDemo,
    }),
    [
      connectors,
      effectiveStatus,
      effectiveSession,
      signer,
      error,
      connect,
      disconnect,
      isReady,
      isDemoMode,
      connectDemo,
      disconnectDemo,
    ]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
