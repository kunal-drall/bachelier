import { useQuery } from "@tanstack/react-query";
import { fetchPositions } from "../lib/api";
import { chainPositions } from "../lib/chainRead";

/**
 * A connected user's vault position. Prefers the indexer (includes deposit
 * history); falls back to a live chain read of vault.get-user.
 */
export function usePositions(address: string | null) {
  return useQuery({
    queryKey: ["positions", address],
    queryFn: ({ signal }) =>
      fetchPositions(address as string, signal).catch(() => chainPositions(address as string)),
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
