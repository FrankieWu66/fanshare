/**
 * Local trade history — persisted to localStorage.
 * Stores the last 50 trades globally (all players) for the current device.
 */

export type TradeRecord = {
  id: string;
  playerId: string;
  playerName: string;
  type: "buy" | "sell";
  solAmount: number;    // SOL spent (buy) or received (sell)
  tokenAmount: number;  // tokens received (buy) or sold (sell)
  signature: string;
  timestamp: number;    // ms since epoch
};

const STORAGE_KEY = "fanshare_trades";
const MAX_RECORDS = 50;

export function loadTrades(): TradeRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TradeRecord[]) : [];
  } catch {
    return [];
  }
}

export function recordTrade(trade: Omit<TradeRecord, "id">): void {
  if (typeof window === "undefined") return;
  const existing = loadTrades();
  const record: TradeRecord = {
    ...trade,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const updated = [record, ...existing].slice(0, MAX_RECORDS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function loadTradesForPlayer(playerId: string): TradeRecord[] {
  return loadTrades().filter((t) => t.playerId === playerId);
}
