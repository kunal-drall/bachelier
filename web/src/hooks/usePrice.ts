import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchPrice } from "../lib/api";
import { chainPrice } from "../lib/chainRead";

export type PriceTick = "up" | "down" | "flat";

/** Live BTC price (API, falling back to the on-chain feed); polls every 30s. */
export function usePrice() {
  const query = useQuery({
    queryKey: ["price"],
    queryFn: ({ signal }) => fetchPrice(signal).catch(() => chainPrice()),
    refetchInterval: 30_000,
    staleTime: 5_000,
  });

  const prevRef = useRef<number | null>(null);
  const [tick, setTick] = useState<PriceTick>("flat");

  useEffect(() => {
    const px = query.data?.btcUsd;
    if (px === undefined) return;
    const prev = prevRef.current;
    if (prev !== null && px !== prev) {
      setTick(px > prev ? "up" : "down");
    }
    prevRef.current = px;
  }, [query.data?.btcUsd]);

  return { ...query, tick };
}
