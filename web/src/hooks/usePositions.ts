import { useQuery } from "@tanstack/react-query";
import { fetchPositions } from "../lib/api";

/** A connected user's vault position (real indexer data). Disabled when no address. */
export function usePositions(address: string | null) {
  return useQuery({
    queryKey: ["positions", address],
    queryFn: ({ signal }) => fetchPositions(address as string, signal),
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
