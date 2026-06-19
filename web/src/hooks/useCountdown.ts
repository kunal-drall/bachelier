import { useEffect, useState } from "react";
import { formatCountdown } from "../lib/format";

/**
 * Live countdown string toward a unix-seconds expiry, re-rendering every second.
 * Respects prefers-reduced-motion only in the sense that it still updates (a
 * countdown is information, not decoration), but uses a 1s interval regardless.
 */
export function useCountdown(expiryUnix: number | null | undefined): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (expiryUnix === null || expiryUnix === undefined) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiryUnix]);

  return formatCountdown(expiryUnix, now);
}
