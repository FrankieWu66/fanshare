"use client";

import { useEffect } from "react";

/**
 * QA helper: visit any page with `?reset=1` to clear demo-local state so that
 * a tester can verify first-run analytics events (grant_claimed,
 * first_player_opened, first_buy_*, first_sell_succeeded) without opening an
 * incognito window.
 *
 * Clears:
 *   • fanshare_demo  (demo wallet keypair + address)
 *   • fs:ev:*        (trackOnce dedup keys)
 *   • fanshare_*     (any other app keys — local trade history, price cache)
 *
 * Then strips `reset` from the URL and reloads so the next page mount starts
 * fresh.
 */
export function QaReset() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") !== "1") return;

    try {
      const toDelete: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (
          k === "fanshare_demo" ||
          k.startsWith("fs:ev:") ||
          k.startsWith("fanshare_") ||
          k.startsWith("fs:")
        ) {
          toDelete.push(k);
        }
      }
      toDelete.forEach((k) => localStorage.removeItem(k));
      // eslint-disable-next-line no-console
      console.info(`[qa-reset] cleared ${toDelete.length} keys:`, toDelete);
    } catch {
      /* private mode / quota — best-effort */
    }

    // Strip the flag and reload into a clean state.
    params.delete("reset");
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : "");
    window.location.replace(url);
  }, []);

  return null;
}
